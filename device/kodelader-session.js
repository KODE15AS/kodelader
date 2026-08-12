/**
 * KODELADER — Shelly-script (UTKAST, testes i fase 2 på testbenk)
 *
 * Kjører på Shelly Pro 3EM (Gen2, innebygd Shelly Scripting — ingen omflashing).
 * Rollen til scriptet er LOKAL AUTONOMI: serveren styrer start/stopp via
 * utgående WebSocket, men hvis internett/serveren faller ut skal enheten
 * selv slå av kontaktoren når grensene er nådd.
 *
 * Grensene settes av serveren i KVS (Key-Value Store) ved øktstart:
 *   kodelader.max_kwh      f.eks. "20"     (maksimal energi for økten)
 *   kodelader.max_minutes  f.eks. "720"    (makstid)
 *   kodelader.idle_w       f.eks. "100"    (ferdig-terskel)
 *   kodelader.idle_min     f.eks. "10"     (ferdig-varighet)
 */

var SWITCH_ID = 100; // Switch Add-on
var CHECK_EVERY_S = 30;

var state = {
  startWh: null,
  startTs: null,
  lastAboveIdleTs: null,
  limits: { maxKwh: 999, maxMin: 720, idleW: 100, idleMin: 10 }
};

function loadLimits() {
  Shelly.call("KVS.GetMany", { match: "kodelader.*" }, function (res) {
    if (!res || !res.items) return;
    var it = res.items;
    if (it["kodelader.max_kwh"]) state.limits.maxKwh = parseFloat(it["kodelader.max_kwh"].value);
    if (it["kodelader.max_minutes"]) state.limits.maxMin = parseFloat(it["kodelader.max_minutes"].value);
    if (it["kodelader.idle_w"]) state.limits.idleW = parseFloat(it["kodelader.idle_w"].value);
    if (it["kodelader.idle_min"]) state.limits.idleMin = parseFloat(it["kodelader.idle_min"].value);
  });
}

// Følg med på kontaktoren: nullstill øktdata ved påslag
Shelly.addStatusHandler(function (ev) {
  if (ev.component === "switch:" + SWITCH_ID && ev.delta && typeof ev.delta.output === "boolean") {
    if (ev.delta.output) {
      state.startTs = Date.now();
      state.lastAboveIdleTs = Date.now();
      loadLimits();
      Shelly.call("EMData.GetStatus", { id: 0 }, function (res) {
        state.startWh = res ? res.total_act : null;
      });
      print("kodelader: økt startet lokalt");
    } else {
      state.startWh = null;
      state.startTs = null;
    }
  }
});

Timer.set(CHECK_EVERY_S * 1000, true, function () {
  Shelly.call("Switch.GetStatus", { id: SWITCH_ID }, function (sw) {
    if (!sw || !sw.output || state.startTs === null) return;

    Shelly.call("EM.GetStatus", { id: 0 }, function (em) {
      var power = em ? em.total_act_power : 0;
      if (power >= state.limits.idleW) state.lastAboveIdleTs = Date.now();

      var minutes = (Date.now() - state.startTs) / 60000;
      var idleMinutes = (Date.now() - state.lastAboveIdleTs) / 60000;

      Shelly.call("EMData.GetStatus", { id: 0 }, function (emd) {
        var kwh = (state.startWh !== null && emd) ? (emd.total_act - state.startWh) / 1000 : 0;
        var reason = null;
        if (kwh >= state.limits.maxKwh) reason = "maks kWh";
        else if (minutes >= state.limits.maxMin) reason = "makstid";
        else if (idleMinutes >= state.limits.idleMin && minutes > state.limits.idleMin) reason = "bil ferdig";

        if (reason) {
          print("kodelader: lokal autonomi slår av (" + reason + ")");
          Shelly.call("Switch.Set", { id: SWITCH_ID, on: false });
        }
      });
    });
  });
});

loadLimits();
print("kodelader: autonomi-script lastet");
