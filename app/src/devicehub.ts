import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
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
