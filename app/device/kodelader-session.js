/**
 * KODELADER — autonomi-script for Shelly Pro 3EM (Gen2, Shelly Scripting — ingen omflashing)
 *
 * Rollen til scriptet er LOKAL AUTONOMI: serveren styrer start/stopp via
 * utgående WebSocket, men hvis internett/serveren faller ut skal enheten
 * selv slå av kontaktoren når grensene er nådd.
 *
 * Grensene skrives av serveren til KVS (Key-Value Store) ved hver øktstart,
 * FØR kontaktoren slås på:
 *   kodelader.max_kwh      f.eks. "20"     (maksimal energi for økten)
 *   kodelader.max_minutes  f.eks. "720"    (makstid)
 *   kodelader.idle_w       f.eks. "100"    (ferdig-terskel)
 *   kodelader.idle_min     f.eks. "10"     (ferdig-varighet)
 *
 * Installeres/oppdateres fra admin-grensesnittet over samme WebSocket
 * (Script.PutCode) — se app/src/devicehub.ts. Versjon: se VERSION under.
 */

var VERSION = "2026-08-21.1";
var SWITCH_ID = 100; // Switch Add-on
var CHECK_EVERY_S = 30;

// All tid måles i sekunder siden boot (sys.uptime) — monoton, upåvirket av
// NTP-hopp etter strøm-/nettbrudd. Date.now() er derfor bevisst IKKE brukt.
function nowS() {
  return Shelly.getComponentStatus("sys").uptime;
}

var state = {
  active: false,
  startWh: null,          // målerstand ved øktstart (emdata total_act)
  startS: null,           // uptime ved øktstart
  lastAboveIdleS: null,   // uptime sist effekt >= idleW
  limits: { maxKwh: 999, maxMin: 720, idleW: 100, idleMin: 10 }
};

// KVS.GetMany: fastvare < 1.4 svarer med objekt {key: {value}}, >= 1.4 med
// array [{key, value}]. Håndter begge.
function kvsValue(items, key) {
  if (items.length !== undefined) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].key === key) return items[i].value;
    }
    return null;
  }
  return items[key] ? items[key].value : null;
}

function loadLimits() {
  Shelly.call("KVS.GetMany", { match: "kodelader.*" }, function (res) {
    if (!res || !res.items) return;
    var v;
    v = kvsValue(res.items, "kodelader.max_kwh");
    if (v !== null) state.limits.maxKwh = parseFloat(v);
    v = kvsValue(res.items, "kodelader.max_minutes");
    if (v !== null) state.limits.maxMin = parseFloat(v);
    v = kvsValue(res.items, "kodelader.idle_w");
    if (v !== null) state.limits.idleW = parseFloat(v);
    v = kvsValue(res.items, "kodelader.idle_min");
    if (v !== null) state.limits.idleMin = parseFloat(v);
    print("kodelader: grenser " + JSON.stringify(state.limits));
  });
}

function beginWatch(resumed) {
  state.active = true;
  state.startS = nowS();
  state.lastAboveIdleS = nowS();
  loadLimits();
  Shelly.call("EMData.GetStatus", { id: 0 }, function (res) {
    state.startWh = res ? res.total_act : null;
  });
  print("kodelader: overvåking " + (resumed ? "gjenopptatt (kontaktor sto på ved oppstart)" : "startet"));
}

function endWatch() {
  state.active = false;
  state.startWh = null;
  state.startS = null;
}

function autonomousOff(reason, kwh) {
  print("kodelader: lokal autonomi slår av (" + reason + ")");
  Shelly.call("Switch.Set", { id: SWITCH_ID, on: false });
  // Når/hvis WebSocket-forbindelsen er oppe når dette skjer, får serveren
  // beskjed umiddelbart og kan avslutte økten ryddig (capture + SMS).
  Shelly.emitEvent("kodelader_autostopp", { reason: reason, kwh: kwh, version: VERSION });
}

// Følg med på kontaktoren: start/stopp overvåking ved på-/avslag
Shelly.addStatusHandler(function (ev) {
  if (ev.component === "switch:" + SWITCH_ID && ev.delta && typeof ev.delta.output === "boolean") {
    if (ev.delta.output) beginWatch(false);
    else endWatch();
  }
});

Timer.set(CHECK_EVERY_S * 1000, true, function () {
  if (!state.active || state.startS === null) return;

  Shelly.call("EM.GetStatus", { id: 0 }, function (em) {
    var power = em ? em.total_act_power : 0;
    if (power >= state.limits.idleW) state.lastAboveIdleS = nowS();

    var minutes = (nowS() - state.startS) / 60;
    var idleMinutes = (nowS() - state.lastAboveIdleS) / 60;

    Shelly.call("EMData.GetStatus", { id: 0 }, function (emd) {
      var kwh = (state.startWh !== null && emd) ? (emd.total_act - state.startWh) / 1000 : 0;
      var reason = null;
      if (kwh >= state.limits.maxKwh) reason = "maks kWh";
      else if (minutes >= state.limits.maxMin) reason = "makstid";
      else if (idleMinutes >= state.limits.idleMin && minutes > state.limits.idleMin) reason = "bil ferdig";

      if (reason) autonomousOff(reason, kwh);
    });
  });
});

// Ved script-/enhetsoppstart: står kontaktoren allerede på (omstart midt i en
// økt), gjenopptas overvåkingen. Målerstand og tid regnes da fra nå — grensene
// håndheves konservativt videre i stedet for å stå uten sikkerhetsnett.
Shelly.call("Switch.GetStatus", { id: SWITCH_ID }, function (sw) {
  if (sw && sw.output) beginWatch(true);
});

print("kodelader: autonomi-script v" + VERSION + " lastet");
