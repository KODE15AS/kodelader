import { randomBytes } from "node:crypto";
import { db, getSetting, logEvent, setCheck } from "./db.js";
import { config } from "./config.js";
import { createPayment, chargePayment, cancelPayment, getPayment } from "./nexi.js";
import { setSwitch, readEnergyWh, cachedStatus, isOnline } from "./devicehub.js";
import { sendSms } from "./sms.js";

export interface SessionRow {
  id: string; device_id: string; product_id: string; payment_id: string | null;
  status: string; phone: string | null; max_amount_ore: number; price_per_kwh_ore: number;
  start_energy_wh: number | null; last_energy_wh: number | null; last_power_w: number | null;
  above_idle_since: string | null; kwh: number; amount_ore: number | null; end_reason: string | null;
  sms1_sent: number; sms2_sent: number; created_at: string; started_at: string | null; ended_at: string | null;
}

const getSession = db.prepare("SELECT * FROM sessions WHERE id=?");
const getByPayment = db.prepare("SELECT * FROM sessions WHERE payment_id=?");

export function findSession(id: string): SessionRow | undefined {
  return getSession.get(id) as SessionRow | undefined;
}

function deviceRow(deviceId: string): { id: string; shelly_id: string; name: string; switch_id: number } {
  const d = db.prepare("SELECT * FROM devices WHERE id=?").get(deviceId) as any;
  if (!d) throw new Error(`Ukjent enhet: ${deviceId}`);
  return d;
}

/** Steg 1: QR skannet — opprett sesjon + Nexi-reservasjon, returner checkout-URL.
 *  `rememberedPhone` kommer fra nettleser-cookien (satt ved tidligere SMS-registrering)
 *  og kobles på økten fra start — da går SMS-varslene ut uten at kunden taster noe. */
export async function startSession(deviceId: string, productId: string, rememberedPhone?: string | null): Promise<string> {
  const device = deviceRow(deviceId);
  const product = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(productId) as any;
  if (!product) throw new Error(`Ukjent produkt: ${productId}`);

  const active = db.prepare("SELECT id FROM sessions WHERE device_id=? AND status='active'").get(deviceId);
  if (active) throw new Error("Laderen er opptatt — en økt pågår allerede");

  const id = randomBytes(8).toString("hex");
  db.prepare(`INSERT INTO sessions(id,device_id,product_id,status,phone,max_amount_ore,price_per_kwh_ore,created_at)
              VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, deviceId, productId, "pending", rememberedPhone ?? null, product.max_amount_ore, product.price_per_kwh_ore, new Date().toISOString());

  const payment = await createPayment(id, product.max_amount_ore, `Elbillading ${device.name} (${product.label})`, rememberedPhone);
  db.prepare("UPDATE sessions SET payment_id=? WHERE id=?").run(payment.paymentId, id);
  logEvent("økt", `Økt ${id} opprettet på ${deviceId}/${productId}, reservasjon ${product.max_amount_ore} øre` +
    (rememberedPhone ? ` — nummer husket fra tidligere økt (${maskPhone(rememberedPhone)})` : ""), id);
  return payment.hostedPaymentPageUrl;
}

/** Steg 2: Webhook bekreftet betaling — start ladingen. */
export async function activateSession(paymentId: string, consumer: any): Promise<void> {
  const session = getByPayment.get(paymentId) as SessionRow | undefined;
  if (!session) {
    logEvent("webhook-feil", `Webhook for ukjent paymentId ${paymentId}`);
    return;
  }
  if (session.status !== "pending") return; // idempotent — webhooks kan komme flere ganger

  // Mobilnummer: webhook-data, ellers payment-oppslag, ellers husket fra cookie ved øktstart
  let phone = phoneFrom(consumer);
  if (!phone) {
    try { phone = phoneFrom((await getPayment(paymentId))?.consumer); } catch { /* ok */ }
  }
  if (phone) setCheck("phone_present", "green", maskPhone(phone));
  else if (session.phone) {
    phone = session.phone;
    setCheck("phone_present", "green", `${maskPhone(phone)} — husket fra tidligere økt (cookie)`);
  } else if (getSetting("skip_checkout_form") === "1") {
    setCheck("phone_present", "grey", "Forventet tomt: checkout-skjema er skjult — SMS registreres valgfritt på statussiden");
  } else {
    setCheck("phone_present", "red", "Mangler i både webhook og payment-oppslag");
  }

  const device = deviceRow(session.device_id);
  let startEnergy: number | null = null;
  try {
    await setSwitch(device.shelly_id, device.switch_id, true);
    startEnergy = await readEnergyWh(device.shelly_id);
  } catch (err) {
    logEvent("økt-feil", `Kunne ikke starte enheten for økt ${session.id}: ${(err as Error).message}`, session.id);
  }

  db.prepare(`UPDATE sessions SET status='active', phone=?, start_energy_wh=?, last_energy_wh=?, started_at=?,
              above_idle_since=? WHERE id=?`)
    .run(phone, startEnergy, startEnergy, new Date().toISOString(), new Date().toISOString(), session.id);
  logEvent("økt", `Økt ${session.id} aktiv — lading startet${phone ? ` for ${maskPhone(phone)}` : ""}`, session.id);

  if (phone) {
    const ok = await sendSms(phone, "Elbil ladeøkt startet hos KODE15 as, og du får ny beskjed når ladingen er ferdig.");
    if (ok) db.prepare("UPDATE sessions SET sms1_sent=1 WHERE id=?").run(session.id);
  }
}

/** Steg 3: Avslutt økt — slå av, beregn beløp, capture/kanseller, SMS 2. */
export async function endSession(sessionId: string, reason: string): Promise<void> {
  const session = findSession(sessionId);
  if (!session || session.status !== "active") return;
  db.prepare("UPDATE sessions SET status='ending' WHERE id=? AND status='active'").run(sessionId);

  const device = deviceRow(session.device_id);
  let finalEnergy = session.last_energy_wh;
  try {
    await setSwitch(device.shelly_id, device.switch_id, false);
    finalEnergy = await readEnergyWh(device.shelly_id);
  } catch (err) {
    logEvent("økt-feil", `Avslutning: fikk ikke kontakt med enheten (${(err as Error).message}) — bruker siste kjente måling`, sessionId);
  }

  const kwh = Math.max(0, ((finalEnergy ?? 0) - (session.start_energy_wh ?? 0)) / 1000);
  const amountOre = Math.min(session.max_amount_ore, Math.round(kwh * session.price_per_kwh_ore));

  let captured = false;
  try {
    if (amountOre > 0) {
      await chargePayment(session.payment_id!, amountOre, "Elbillading KODE15");
      captured = true;
    } else {
      await cancelPayment(session.payment_id!, session.max_amount_ore);
    }
  } catch (err) {
    logEvent("betaling-feil", `Capture/kansellering feilet for økt ${sessionId}: ${(err as Error).message}`, sessionId);
  }

  db.prepare(`UPDATE sessions SET status=?, kwh=?, amount_ore=?, end_reason=?, ended_at=?, last_energy_wh=? WHERE id=?`)
    .run(captured || amountOre === 0 ? "completed" : "capture_failed", round3(kwh), amountOre, reason, new Date().toISOString(), finalEnergy, sessionId);
  logEvent("økt", `Økt ${sessionId} avsluttet (${reason}): ${round3(kwh)} kWh, ${amountOre} øre`, sessionId);

  await sendFinishSms(sessionId);
}

/** SMS 2 (ferdig + kvitteringslenke). Kan også ettersendes dersom kunden
 *  registrerer mobilnummer på statussiden først etter at økten er avsluttet. */
export async function sendFinishSms(sessionId: string): Promise<void> {
  const session = findSession(sessionId);
  if (!session?.phone || session.sms2_sent || session.amount_ore == null) return;
  const kr = (session.amount_ore / 100).toFixed(2).replace(".", ",");
  const kwhTxt = session.kwh.toFixed(2).replace(".", ",");
  const msg = `Ladeøkten hos KODE15 as er ferdig, du har ladet ${kwhTxt} kWh for Kr. ${kr}. ` +
    `Flytt bilen om nødvendig for at andre skal kunne lade. ` +
    `Her er link til kvittering som vil være tilgjengelig i 30 dager: ${config.baseUrl}/kvittering/${sessionId}`;
  const ok = await sendSms(session.phone, msg);
  if (ok) db.prepare("UPDATE sessions SET sms2_sent=1 WHERE id=?").run(sessionId);
}

/** Periodisk overvåking: oppdater målinger og håndhev øktslutt-reglene. */
export async function tick(): Promise<void> {
  const active = db.prepare("SELECT * FROM sessions WHERE status='active'").all() as SessionRow[];
  const now = Date.now();
  const idleThresholdW = parseFloat(getSetting("idle_threshold_w"));
  const idleMs = parseFloat(getSetting("idle_minutes")) * 60_000;
  const maxMs = parseFloat(getSetting("max_session_hours")) * 3_600_000;

  for (const s of active) {
    const device = deviceRow(s.device_id);
    let energy: number | null = null;
    let power: number | null = null;
    try {
      energy = await readEnergyWh(device.shelly_id);
      power = cachedStatus(device.shelly_id).power;
      if (power === null) {
        const em = await import("./devicehub.js").then((m) => m.rpc(device.shelly_id, "EM.GetStatus", { id: 0 }));
        if (typeof em?.total_act_power === "number") power = em.total_act_power;
      }
    } catch {
      continue; // enhet utilgjengelig — lokal autonomi på enheten er sikkerhetsnettet
    }

    const kwh = Math.max(0, ((energy ?? 0) - (s.start_energy_wh ?? 0)) / 1000);
    const costOre = Math.round(kwh * s.price_per_kwh_ore);

    let aboveIdleSince = s.above_idle_since;
    if (power !== null && power >= idleThresholdW) aboveIdleSince = new Date().toISOString();
    db.prepare("UPDATE sessions SET kwh=?, last_energy_wh=?, last_power_w=?, above_idle_since=? WHERE id=?")
      .run(round3(kwh), energy, power, aboveIdleSince, s.id);

    if (costOre >= s.max_amount_ore) {
      await endSession(s.id, "maksbeløp nådd");
    } else if (s.started_at && now - Date.parse(s.started_at) > maxMs) {
      await endSession(s.id, "makstid nådd");
    } else if (aboveIdleSince && now - Date.parse(aboveIdleSince) > idleMs && now - Date.parse(s.started_at!) > idleMs) {
      await endSession(s.id, "bilen er ferdig ladet");
    }
  }

  // Rydd bort forlatte pending-økter (checkout aldri fullført) etter 1 time
  db.prepare("UPDATE sessions SET status='cancelled', end_reason='checkout ikke fullført', ended_at=? " +
    "WHERE status='pending' AND created_at < ?")
    .run(new Date().toISOString(), new Date(now - 3_600_000).toISOString());
}

function phoneFrom(consumer: any): string | null {
  const p = consumer?.phoneNumber ?? consumer?.privatePerson?.phoneNumber ?? consumer?.shippingAddress?.phoneNumber;
  if (p?.prefix && p?.number) return `${p.prefix}${p.number}`;
  return null;
}

export function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  return phone.length > 3 ? "xxx xx " + phone.slice(-3) : phone;
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

export function deviceOnline(deviceId: string): boolean {
  try { return isOnline(deviceRow(deviceId).shelly_id); } catch { return false; }
}
