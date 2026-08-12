#!/usr/bin/env node
/**
 * Simulert Shelly Pro 3EM med Switch Add-on.
 * Oppfører seg som en Gen2-enhet med utgående WebSocket:
 *  - identifiserer seg med src=shellypro3em-sim001
 *  - svarer på Switch.Set / Switch.GetStatus / EMData.GetStatus / EM.GetStatus
 *  - lader med ~11 kW når kontaktoren er på, faller til ~50 W når "bilen er full"
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
      default:
        ws.send(JSON.stringify({ id: msg.id, src: ID, dst: msg.src, error: { code: 404, message: "ukjent metode" } }));
    }
  });
  ws.on("close", () => {
    console.log("[sim] frakoblet — prøver igjen om 5 s");
    setTimeout(connect, 5000);
  });
  ws.on("error", (err) => console.log(`[sim] feil: ${err.message}`));

  // Energi tikker hvert 2. sekund; status hvert 10.
  setInterval(() => {
    energyWh += (currentPower() * 2) / 3600;
  }, 2000);
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) notifyFull(ws);
  }, 10000);
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
