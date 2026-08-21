#!/usr/bin/env node
/**
 * Simulert Shelly Pro 3EM med Switch Add-on.
 * Oppfører seg som en Gen2-enhet med utgående WebSocket:
 *  - identifiserer seg med src=shellypro3em-sim001
 *  - svarer på Switch.Set / Switch.GetStatus / EMData.GetStatus / EM.GetStatus
 *  - lader med ~11 kW når kontaktoren er på, faller til ~50 W når "bilen er full"
 *  - svarer på KVS.* og Script.* (som autonomi-scriptet bruker), og etterligner
 *    scriptets lokale autonomi: slår av selv ved kodelader.max_kwh og sender
 *    NotifyEvent kodelader_autostopp — akkurat som den ekte enheten
 *
 * Bruk:  node device/simulator.mjs [ws-url] [--full-etter-kwh=0.05]
 * Standard-URL: ws://localhost:8096/ws
 */
import WebSocket from "ws";

const url = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "ws://localhost:8096/ws";
const fullArg = process.argv.find((a) => a.startsWith("--full-etter-kwh="));
const fullAfterKwh = fullArg ? parseFloat(fullArg.split("=")[1]) : Infinity;

const ID = "shellypro3em-sim001";
let switchOn = false;
let energyWh = 123456; // vilkårlig målerstand
let sessionStartWh = 0;
const powerWhenCharging = 11000;
const powerWhenFull = 50;

const kvs = {};               // KVS-lageret (kodelader.max_kwh m.m.)
const scripts = [];           // [{id, name, enable, running, codeLen}]
let activeWs = null;          // for NotifyEvent fra "autonomi-scriptet"

function currentPower() {
  if (!switchOn) return 0;
  const sessionKwh = (energyWh - sessionStartWh) / 1000;
  return sessionKwh >= fullAfterKwh ? powerWhenFull : powerWhenCharging;
}

function connect() {
  const ws = new WebSocket(url);
  ws.on("open", () => {
    console.log(`[sim] tilkoblet ${url} som ${ID} (full etter ${fullAfterKwh} kWh)`);
    notifyFull(ws);
  });
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (typeof msg.id !== "number" || !msg.method) return;
    const reply = (result) => ws.send(JSON.stringify({ id: msg.id, src: ID, dst: msg.src, result }));
    switch (msg.method) {
      case "Switch.Set": {
        const was = switchOn;
        switchOn = !!msg.params?.on;
        if (switchOn && !was) sessionStartWh = energyWh;
        console.log(`[sim] Switch.Set -> ${switchOn ? "PÅ" : "AV"}`);
        reply({ was_on: was });
        notifyFull(ws);
        break;
      }
      case "Switch.GetStatus":
        reply({ id: msg.params?.id ?? 100, output: switchOn, apower: currentPower() });
        break;
      case "EMData.GetStatus":
        reply({ id: 0, total_act: energyWh });
        break;
      case "EM.GetStatus":
        reply({ id: 0, total_act_power: currentPower() });
        break;
      case "Shelly.GetDeviceInfo":
        reply({ id: ID, model: "SIMULATOR", gen: 2, app: "Pro3EMM" });
        break;
      case "KVS.Set": {
        kvs[msg.params.key] = String(msg.params.value);
        console.log(`[sim] KVS.Set ${msg.params.key} = ${msg.params.value}`);
        reply({ etag: "sim", rev: Object.keys(kvs).length });
        break;
      }
      case "KVS.GetMany": {
        // Array-format som fastvare >= 1.4
        const prefix = (msg.params?.match ?? "*").replace(/\*$/, "");
        const items = Object.entries(kvs)
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, value]) => ({ key, value }));
        reply({ items, offset: 0, total: items.length });
        break;
      }
      case "Script.List":
        reply({ scripts: scripts.map((s) => ({ id: s.id, name: s.name, enable: s.enable, running: s.running })) });
        break;
      case "Script.Create": {
        const script = { id: scripts.length + 1, name: msg.params.name, enable: false, running: false, codeLen: 0 };
        scripts.push(script);
        console.log(`[sim] Script.Create "${script.name}" -> id ${script.id}`);
        reply({ id: script.id });
        break;
      }
      case "Script.PutCode": {
        const s = scripts.find((x) => x.id === msg.params.id);
        if (!s) break;
        s.codeLen = (msg.params.append ? s.codeLen : 0) + msg.params.code.length;
        reply({ len: s.codeLen });
        break;
      }
      case "Script.SetConfig": {
        const s = scripts.find((x) => x.id === msg.params.id);
        if (s) s.enable = !!msg.params.config?.enable;
        reply({ restart_required: false });
        break;
      }
      case "Script.Start":
      case "Script.Stop": {
        const s = scripts.find((x) => x.id === msg.params.id);
        if (s) s.running = msg.method === "Script.Start";
        if (s) console.log(`[sim] ${msg.method} "${s.name}" (${s.codeLen} tegn)`);
        reply({ was_running: false });
        break;
      }
      case "Script.GetStatus": {
        const s = scripts.find((x) => x.id === msg.params.id);
        reply({ id: msg.params.id, running: !!s?.running });
        break;
      }
      default:
        ws.send(JSON.stringify({ id: msg.id, src: ID, dst: msg.src, error: { code: 404, message: "ukjent metode" } }));
    }
  });
  ws.on("close", () => {
    console.log("[sim] frakoblet — prøver igjen om 5 s");
    setTimeout(connect, 5000);
  });
  ws.on("error", (err) => console.log(`[sim] feil: ${err.message}`));

  activeWs = ws;
}

// Energi tikker hvert 2. sekund; status hvert 10. Intervallene lever på
// modulnivå — connect() kalles på nytt ved hver rekobling, og intervaller
// der ville blitt duplisert for hver gang (energien tikket dobbelt/trippelt)
setInterval(() => {
  energyWh += (currentPower() * 2) / 3600;
  checkAutonomy();
}, 2000);
setInterval(() => {
  if (activeWs?.readyState === WebSocket.OPEN) notifyFull(activeWs);
}, 10000);

// Etterligner autonomi-scriptet: slå av lokalt når kodelader.max_kwh er nådd
// (kjører selv om serveren er borte — det er hele poenget med scriptet)
function checkAutonomy() {
  if (!switchOn) return;
  const script = scripts.find((s) => s.name === "kodelader-session");
  if (!script?.running) return;
  const maxKwh = parseFloat(kvs["kodelader.max_kwh"] ?? "999");
  const kwh = (energyWh - sessionStartWh) / 1000;
  if (kwh >= maxKwh) {
    switchOn = false;
    console.log(`[sim] LOKAL AUTONOMI: slår av ved ${kwh.toFixed(3)} kWh (grense ${maxKwh})`);
    if (activeWs?.readyState === WebSocket.OPEN) {
      activeWs.send(JSON.stringify({
        src: ID,
        dst: "kodelader-server",
        method: "NotifyEvent",
        params: {
          ts: Date.now() / 1000,
          events: [{ component: `script:${script.id}`, id: script.id, event: "kodelader_autostopp",
                     data: { reason: "maks kWh", kwh }, ts: Date.now() / 1000 }]
        }
      }));
      notifyFull(activeWs);
    }
  }
}

function notifyFull(ws) {
  ws.send(JSON.stringify({
    src: ID,
    dst: "kodelader-server",
    method: "NotifyFullStatus",
    params: {
      ts: Date.now() / 1000,
      "em:0": { id: 0, total_act_power: currentPower() },
      "emdata:0": { id: 0, total_act: energyWh },
      "switch:100": { id: 100, output: switchOn }
    }
  }));
}

connect();
