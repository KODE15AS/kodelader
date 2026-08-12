import { Router } from "express";
import { db, allSettings, setSetting, setCheck, logEvent } from "../db.js";
import { config } from "../config.js";
import { testKeys } from "../nexi.js";
import { endSession, deviceOnline } from "../sessions.js";
import { setSwitch, cachedStatus } from "../devicehub.js";

export const adminRouter = Router();

/** Oversikt: miljø, enheter med lamper, aktive økter. */
adminRouter.get("/api/overview", (_req, res) => {
  const devices = (db.prepare("SELECT * FROM devices").all() as any[]).map((d) => ({
    id: d.id,
    name: d.name,
    shellyId: d.shelly_id,
    lastSeen: d.last_seen,
    online: deviceOnline(d.id),
    status: cachedStatus(d.shelly_id),
    activeSession: db.prepare("SELECT id FROM sessions WHERE device_id=? AND status='active'").get(d.id) ?? null
  }));
  res.json({
    env: config.isLive() ? "SKARP" : "SANDKASSE",
    apiBase: config.nexiApiBase,
    baseUrl: config.baseUrl,
    sveveConfigured: !!config.sveve.user,
    devices
  });
});

/** Innstillinger og produkter (pris per kWh per QR-kode). */
adminRouter.get("/api/settings", (_req, res) => {
  res.json({
    settings: allSettings(),
    products: db.prepare("SELECT * FROM products ORDER BY max_amount_ore").all()
  });
});
adminRouter.put("/api/settings", (req, res) => {
  const { settings, products } = req.body ?? {};
  if (settings) for (const [k, v] of Object.entries(settings)) setSetting(k, String(v));
  if (Array.isArray(products)) {
    const upd = db.prepare("UPDATE products SET label=?, max_amount_ore=?, price_per_kwh_ore=?, active=? WHERE id=?");
    for (const p of products) upd.run(p.label, p.max_amount_ore, p.price_per_kwh_ore, p.active ? 1 : 0, p.id);
  }
  logEvent("admin", "Innstillinger oppdatert");
  res.json({ ok: true });
});

/** Økter (full historikk, mobilnumre i klartekst — kun tailnett). */
adminRouter.get("/api/sessions", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
  res.json(db.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?").all(limit));
});
adminRouter.post("/api/sessions/:id/stop", async (req, res) => {
  await endSession(req.params.id, "avsluttet fra admin");
  res.json({ ok: true });
});

/** Etablering: sjekkpunkter + manuell bekreftelse + nøkkeltest. */
adminRouter.get("/api/checks", (_req, res) => {
  res.json(db.prepare("SELECT * FROM checks ORDER BY sort").all());
});
adminRouter.post("/api/checks/:id", (req, res) => {
  const { status, note } = req.body ?? {};
  const check = db.prepare("SELECT * FROM checks WHERE id=?").get(req.params.id) as any;
  if (!check) { res.status(404).json({ error: "Ukjent sjekkpunkt" }); return; }
  if (check.kind !== "manual") { res.status(400).json({ error: "Automatiske sjekkpunkter settes av systemet" }); return; }
  setCheck(req.params.id, status === "green" ? "green" : "grey", note);
  logEvent("admin", `Sjekkpunkt ${req.params.id} satt til ${status}`);
  res.json({ ok: true });
});
adminRouter.post("/api/checks/run-keys", async (_req, res) => {
  res.json(await testKeys());
});

/** Hendelseslogg. */
adminRouter.get("/api/events", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
  res.json(db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit));
});

/** Manuell styring av enhet (testbenk!). */
adminRouter.post("/api/devices/:id/switch", async (req, res) => {
  const d = db.prepare("SELECT * FROM devices WHERE id=?").get(req.params.id) as any;
  if (!d) { res.status(404).json({ error: "Ukjent enhet" }); return; }
  try {
    await setSwitch(d.shelly_id, d.switch_id, !!req.body?.on);
    logEvent("admin", `Manuell bryter ${req.body?.on ? "PÅ" : "AV"} for ${d.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
