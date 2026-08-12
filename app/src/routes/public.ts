import { Router } from "express";
import { db, logEvent, setCheck, getSetting } from "../db.js";
import { config } from "../config.js";
import { startSession, activateSession, endSession, findSession, maskPhone, deviceOnline } from "../sessions.js";

export const publicRouter = Router();

/** QR-landing: oppretter betaling og videresender rett til Nexi hosted checkout. */
publicRouter.get("/start", async (req, res) => {
  const deviceId = String(req.query.enhet ?? "");
  const productId = String(req.query.produkt ?? "");
  try {
    const checkoutUrl = await startSession(deviceId, productId);
    res.redirect(302, checkoutUrl);
  } catch (err) {
    logEvent("start-feil", `${deviceId}/${productId}: ${(err as Error).message}`);
    res.status(400).send(errorPage((err as Error).message));
  }
});

/** Webhook fra Nexi. Må svare 200 innen 10 sek. */
publicRouter.post("/webhooks/nets", async (req, res) => {
  if (req.headers.authorization !== config.webhookAuth) {
    logEvent("webhook-feil", "Webhook avvist: feil Authorization-header");
    res.status(401).end();
    return;
  }
  const body = req.body ?? {};
  logEvent("webhook", `Mottatt ${body.event ?? "ukjent"} for ${body?.data?.paymentId ?? "?"}`, body?.data?.paymentId);
  setCheck("webhook_received", "green", `${body.event} ${new Date().toISOString()}`);
  res.status(200).end(); // kvitter umiddelbart — behandling skjer etterpå

  if (body.event === "payment.checkout.completed" && body?.data?.paymentId) {
    activateSession(body.data.paymentId, body?.data?.consumer).catch((err) =>
      logEvent("økt-feil", `Aktivering feilet: ${err.message}`, body.data.paymentId)
    );
  }
});

/** Tilstand for brukersiden (offentlig — mobilnumre maskeres). */
publicRouter.get("/api/state", (req, res) => {
  const deviceId = String(req.query.enhet ?? "proto1");
  const active = db.prepare(
    "SELECT * FROM sessions WHERE device_id=? AND status IN ('active','ending') ORDER BY created_at DESC LIMIT 1"
  ).get(deviceId) as any;
  const history = db.prepare(
    "SELECT * FROM sessions WHERE device_id=? AND status IN ('completed','capture_failed') ORDER BY ended_at DESC LIMIT 20"
  ).all(deviceId) as any[];
  res.json({
    device: deviceId,
    online: deviceOnline(deviceId),
    env: config.isLive() ? "SKARP" : "SANDKASSE",
    active: active ? publicSession(active) : null,
    history: history.map(publicSession)
  });
});

/** Kunden avslutter fra statussiden (krever sesjons-ID fra retur-URL/SMS). */
publicRouter.post("/api/session/:id/stop", async (req, res) => {
  const session = findSession(req.params.id);
  if (!session) { res.status(404).json({ error: "Ukjent økt" }); return; }
  await endSession(session.id, "avsluttet av kunden");
  res.json({ ok: true });
});

/** Kvitteringsside (lenken i SMS 2) — enkel server-rendret HTML i KODE15-profil. */
publicRouter.get("/kvittering/:id", (req, res) => {
  const s = findSession(req.params.id);
  const days = parseInt(getSetting("receipt_days"), 10);
  if (!s || !s.ended_at || Date.now() - Date.parse(s.ended_at) > days * 86_400_000) {
    res.status(404).send(errorPage("Kvitteringen finnes ikke eller er utløpt (30 dager)."));
    return;
  }
  const kr = ((s.amount_ore ?? 0) / 100).toFixed(2).replace(".", ",");
  res.send(page("Kvittering", `
    <h1>Kvittering</h1>
    <p class="muted">KODE15 as — org.nr. 989 990 330</p>
    <table>
      <tr><td>Dato</td><td>${new Date(s.ended_at).toLocaleString("nb-NO")}</td></tr>
      <tr><td>Ladet energi</td><td>${s.kwh.toFixed(3).replace(".", ",")} kWh</td></tr>
      <tr><td>Pris per kWh</td><td>${(s.price_per_kwh_ore / 100).toFixed(2).replace(".", ",")} kr</td></tr>
      <tr><td><strong>Belastet beløp</strong></td><td><strong>${kr} kr</strong></td></tr>
      <tr><td>Avsluttet fordi</td><td>${s.end_reason ?? "—"}</td></tr>
      <tr><td>Referanse</td><td>${s.id}</td></tr>
    </table>
    <p class="muted">Betalt med Vipps/kort via Nexi Checkout. Kun faktisk ladet energi er belastet;
    resten av reservasjonen er frigitt.</p>`));
});

/** Kjøpsvilkår (Nexi krever termsUrl). */
publicRouter.get("/vilkar", (_req, res) => {
  res.send(page("Kjøpsvilkår", `
    <h1>Kjøpsvilkår — elbillading</h1>
    <p>KODE15 as (org.nr. 989 990 330), Sagveien 15, 1890 Rakkestad.</p>
    <ul>
      <li>Ved start reserveres et maksbeløp på betalingsmiddelet ditt. Du belastes kun for faktisk
          ladet energi etter gjeldende pris per kWh. Resten av reservasjonen frigis automatisk.</li>
      <li>Ladeøkten avsluttes når bilen er fulladet, når maksbeløpet er nådd, ved makstid,
          eller når du selv avslutter.</li>
      <li>Kvittering sendes på SMS og er tilgjengelig i 30 dager.</li>
      <li>Spørsmål eller feil? Kontakt KODE15 as.</li>
    </ul>`));
});

function publicSession(s: any) {
  return {
    id: s.id,
    status: s.status,
    phone: maskPhone(s.phone),
    kwh: s.kwh,
    amountOre: s.amount_ore,
    maxAmountOre: s.max_amount_ore,
    pricePerKwhOre: s.price_per_kwh_ore,
    powerW: s.last_power_w,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    endReason: s.end_reason,
    product: s.product_id
  };
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — KODE15 Kodelader</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#F7F4EF;color:#233038;font-family:system-ui,sans-serif}
  main{max-width:560px;margin:0 auto;padding:24px}
  h1{font-family:Montserrat,sans-serif;font-weight:700}
  .muted{color:#525D65;font-size:.9rem}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden}
  td{padding:10px 14px;border-bottom:1px solid #F7F4EF}
  header{background:#263246;color:#F7F4EF;padding:14px 24px;font-family:Montserrat,sans-serif;font-weight:700}
  header span{color:#BBAD9A}
</style></head><body>
<header>KODE15 <span>· Kodelader</span></header>
<main>${body}</main></body></html>`;
}

function errorPage(message: string): string {
  return page("Feil", `<h1>Beklager</h1><p>${message}</p><p class="muted">Prøv å skanne QR-koden på nytt, eller kontakt KODE15.</p>`);
}
