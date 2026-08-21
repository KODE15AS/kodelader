import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, logEvent, setCheck } from "./db.js";

/**
 * Mottar utgående WebSocket-forbindelser fra Shelly Gen2-enheter
 * (Settings → Outbound WebSocket på enheten). Protokollen er JSON-RPC 2.0:
 * enheten sender NotifyStatus/NotifyFullStatus/NotifyEvent med src=<shelly-id>,
 * og vi kan kalle RPC-metoder (Switch.Set, EMData.GetStatus, ...) på samme socket.
 */

interface DeviceConn {
  shellyId: string;
  socket: WebSocket;
  lastSeen: number;
  power: number | null;     // total aktiv effekt (W)
  energyWh: number | null;  // akkumulert energi (Wh)
  switchOn: boolean | null;
}

const conns = new Map<string, DeviceConn>(); // shellyId -> conn
let rpcId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

export function attachDeviceHub(server: Server, paths: string[]): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (!paths.includes(pathname)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (socket: WebSocket) => {
    let shellyId: string | null = null;
    socket.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // Første melding fra enheten identifiserer den (src = shelly-id)
      if (!shellyId && typeof msg.src === "string" && msg.src.startsWith("shelly")) {
        const sid: string = msg.src;
        shellyId = sid;
        conns.set(sid, { shellyId: sid, socket, lastSeen: Date.now(), power: null, energyWh: null, switchOn: null });
        db.prepare("UPDATE devices SET last_seen=? WHERE shelly_id=?").run(new Date().toISOString(), sid);
        logEvent("enhet", `Enhet tilkoblet via WebSocket: ${sid}`);
        if (!sid.includes("sim")) setCheck("device_ws", "green", sid);
      }
      if (!shellyId) return;
      const conn = conns.get(shellyId);
      if (!conn) return;
      conn.lastSeen = Date.now();

      // Svar på våre RPC-kall
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(`RPC-feil: ${JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
        return;
      }

      // Hendelser fra enheten — bl.a. autonomi-scriptets "kodelader_autostopp"
      // (Shelly.emitEvent) når enheten slår av lokalt fordi en grense er nådd
      if (msg.method === "NotifyEvent") {
        for (const ev of msg.params?.events ?? []) {
          if (ev?.event === "kodelader_autostopp") {
            logEvent("enhet", `Lokal autonomi slo av ${shellyId}: ${ev.data?.reason ?? "ukjent årsak"}`, undefined, ev.data);
            autonomyStopHandler?.(shellyId, String(ev.data?.reason ?? "grense nådd"));
          }
        }
      }

      // Statusvarsler fra enheten
      if (msg.method === "NotifyStatus" || msg.method === "NotifyFullStatus") {
        const s = msg.params ?? {};
        const em = s["em:0"];
        if (em && typeof em.total_act_power === "number") conn.power = em.total_act_power;
        const emdata = s["emdata:0"];
        if (emdata && typeof emdata.total_act === "number") conn.energyWh = emdata.total_act;
        const sw = s["switch:100"] ?? s["switch:0"];
        if (sw && typeof sw.output === "boolean") conn.switchOn = sw.output;
      }
    });
    socket.on("close", () => {
      if (shellyId && conns.get(shellyId)?.socket === socket) {
        conns.delete(shellyId);
        logEvent("enhet", `Enhet frakoblet: ${shellyId}`);
      }
    });
    socket.on("error", () => socket.close());
  });
}

/** RPC-kall til en tilkoblet enhet. */
export function rpc(shellyId: string, method: string, params?: unknown, timeoutMs = 8000): Promise<any> {
  const conn = conns.get(shellyId);
  if (!conn || conn.socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`Enheten ${shellyId} er ikke tilkoblet`));
  }
  const id = rpcId++;
  const frame = { jsonrpc: "2.0", id, src: "kodelader-server", method, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC-timeout for ${method} mot ${shellyId}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    conn.socket.send(JSON.stringify(frame));
  });
}

export function isOnline(shellyId: string): boolean {
  const c = conns.get(shellyId);
  return !!c && c.socket.readyState === WebSocket.OPEN && Date.now() - c.lastSeen < 120_000;
}

export function cachedStatus(shellyId: string): { power: number | null; energyWh: number | null; switchOn: boolean | null } {
  const c = conns.get(shellyId);
  return { power: c?.power ?? null, energyWh: c?.energyWh ?? null, switchOn: c?.switchOn ?? null };
}

/** Slår kontaktoren av/på via Switch-komponenten (Add-on = id 100). */
export async function setSwitch(shellyId: string, switchId: number, on: boolean): Promise<void> {
  await rpc(shellyId, "Switch.Set", { id: switchId, on });
}

/** Leser akkumulert energi (Wh) — prøver cache først, deretter direkte RPC. */
export async function readEnergyWh(shellyId: string): Promise<number> {
  try {
    const res = await rpc(shellyId, "EMData.GetStatus", { id: 0 });
    if (typeof res?.total_act === "number") return res.total_act;
  } catch { /* fall tilbake til cache */ }
  const cached = cachedStatus(shellyId).energyWh;
  if (cached === null) throw new Error(`Ingen energimåling tilgjengelig for ${shellyId}`);
  return cached;
}

// ---- Lokal autonomi: KVS-grenser og scriptinstallasjon over WebSocket ----

let autonomyStopHandler: ((shellyId: string, reason: string) => void) | null = null;

/** Registrer håndtering av enhetens autostopp-hendelse (settes fra index.ts
 *  for å unngå sirkulær import mot sessions.ts). */
export function onAutonomyStop(fn: (shellyId: string, reason: string) => void): void {
  autonomyStopHandler = fn;
}

export interface AutonomyLimits {
  maxKwh: number;
  maxMinutes: number;
  idleW: number;
  idleMin: number;
}

/** Skriver øktens grenser til enhetens KVS. MÅ kalles før kontaktoren slås på —
 *  autonomi-scriptet leser grensene i det bryteren går PÅ. */
export async function writeAutonomyLimits(shellyId: string, limits: AutonomyLimits): Promise<void> {
  const entries: [string, number][] = [
    ["kodelader.max_kwh", Math.round(limits.maxKwh * 1000) / 1000],
    ["kodelader.max_minutes", limits.maxMinutes],
    ["kodelader.idle_w", limits.idleW],
    ["kodelader.idle_min", limits.idleMin]
  ];
  for (const [key, value] of entries) {
    await rpc(shellyId, "KVS.Set", { key, value: String(value) });
  }
}

const SCRIPT_NAME = "kodelader-session";
const here = dirname(fileURLToPath(import.meta.url));
// dist/../device fungerer både lokalt (app/device) og i containeren (/app/device)
const scriptPath = resolve(here, "../device/kodelader-session.js");

export interface ScriptStatus {
  installed: boolean;
  running: boolean;
  scriptId: number | null;
}

/** Sjekker om autonomi-scriptet finnes og kjører på enheten. */
export async function autonomyScriptStatus(shellyId: string): Promise<ScriptStatus> {
  const list = await rpc(shellyId, "Script.List");
  const script = (list?.scripts ?? []).find((s: any) => s.name === SCRIPT_NAME);
  if (!script) return { installed: false, running: false, scriptId: null };
  return { installed: true, running: !!script.running, scriptId: script.id };
}

/** Installerer/oppdaterer autonomi-scriptet på enheten over WebSocket-forbindelsen
 *  (Script.PutCode i biter) og starter det med autostart ved boot. */
export async function installAutonomyScript(shellyId: string): Promise<ScriptStatus> {
  const code = readFileSync(scriptPath, "utf8");
  const existing = await autonomyScriptStatus(shellyId);

  let scriptId = existing.scriptId;
  if (scriptId === null) {
    const created = await rpc(shellyId, "Script.Create", { name: SCRIPT_NAME });
    scriptId = created.id;
  } else if (existing.running) {
    await rpc(shellyId, "Script.Stop", { id: scriptId });
  }

  const CHUNK = 1024;
  for (let i = 0; i < code.length; i += CHUNK) {
    await rpc(shellyId, "Script.PutCode", { id: scriptId, code: code.slice(i, i + CHUNK), append: i > 0 });
  }

  await rpc(shellyId, "Script.SetConfig", { id: scriptId, config: { enable: true } }); // autostart ved boot
  await rpc(shellyId, "Script.Start", { id: scriptId });
  const status = await rpc(shellyId, "Script.GetStatus", { id: scriptId });
  return { installed: true, running: !!status?.running, scriptId };
}
