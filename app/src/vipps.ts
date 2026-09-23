import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { logEvent, setCheck } from "./db.js";

/** Klient mot Vipps MobilePay ePayment API (direkteintegrasjon).
 *
 *  Samme funksjonssnitt som nexi.ts slik at payments.ts kan bytte leverandør
 *  med én innstilling. Viktige forskjeller fra Nexi:
 *  - Alle operasjoner bruker vår egen `reference` (= økt-ID) — det finnes ingen
 *    separat paymentId. createPayment returnerer derfor økt-ID-en som paymentId.
 *  - Kundens mobilnummer hentes med samtykke via profildeling
 *    (`profile.scope: "phoneNumber"`) — kommer som `userDetails.mobileNumber`
 *    i authorized-webhooken og i GET payment.
 *  - Webhooks HMAC-signeres med secret fra webhook-registreringen
 *    (VIPPS_WEBHOOK_SECRET i .env). Se docs/vipps-mobilepay/README.md.
 *
 *  NB (Vipps' egne AI-regler): aldri logg tokens, nøkler eller full request —
 *  logEvent-kallene her logger kun metode/sti/status og feilkropper. */

// ---- Access token (caches til utløp) ----

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch(`${config.vippsApiBase}/accesstoken/get`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      client_id: config.vippsClientId,
      client_secret: config.vippsClientSecret,
      "Ocp-Apim-Subscription-Key": config.vippsSubscriptionKey,
      "Merchant-Serial-Number": config.vippsMsn
    }
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    logEvent("vipps-feil", `accesstoken/get → ${res.status}`);
    throw new Error(`Vipps accesstoken feilet (HTTP ${res.status})`);
  }
  cachedToken = { token: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

// ---- Generell API-hjelper ----

async function api(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await accessToken()}`,
    "Ocp-Apim-Subscription-Key": config.vippsSubscriptionKey,
    "Merchant-Serial-Number": config.vippsMsn,
    "Vipps-System-Name": "kodelader",
    "Vipps-System-Version": "1.0.0",
    "Vipps-System-Plugin-Name": "kodelader-app",
    "Vipps-System-Plugin-Version": "1.0.0"
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(config.vippsApiBase + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  logEvent(res.ok ? "vipps" : "vipps-feil", `${method} ${path} → ${res.status}`, undefined, res.ok ? undefined : json);
  return { status: res.status, json };
}

export interface CreatedPayment {
  paymentId: string;
  hostedPaymentPageUrl: string;
}

/** Oppretter betaling (reservasjon av maksbeløp). Kunden sendes til Vipps-landingssiden
 *  (app-switch på mobil). Kjent mobilnummer forhåndsutfylles; profildeling ber uansett
 *  om nummeret med samtykke slik at SMS-kvittering virker uten tasting. */
export async function createPayment(sessionId: string, amountOre: number, label: string, phone?: string | null): Promise<CreatedPayment> {
  const body = {
    amount: { currency: "NOK", value: amountOre },
    paymentMethod: { type: "WALLET" },
    ...(phone && /^\+47\d{8}$/.test(phone) ? { customer: { phoneNumber: phone.slice(1) } } : {}),
    reference: sessionId,
    returnUrl: `${config.baseUrl}/?session=${sessionId}`,
    userFlow: "WEB_REDIRECT",
    paymentDescription: label,
    profile: { scope: "phoneNumber" }
  };
  const { status, json } = await api("POST", "/epayment/v1/payments", body, randomUUID());
  if (status !== 201 || !json?.redirectUrl) {
    setCheck("checkout_created", "red", `Vipps HTTP ${status}: ${JSON.stringify(json)?.slice(0, 300)}`);
    throw new Error(`Vipps create payment feilet (HTTP ${status})`);
  }
  setCheck("keys_valid", "green", "Bevist via vellykket create payment (Vipps)");
  setCheck("checkout_created", "green", `Vipps-referanse ${json.reference ?? sessionId}`);
  return { paymentId: sessionId, hostedPaymentPageUrl: json.redirectUrl };
}

/** Henter betalingen — inneholder state (CREATED/AUTHORIZED/ABORTED/EXPIRED/TERMINATED)
 *  og userDetails (profildeling) etter autorisasjon. */
export async function getPayment(reference: string): Promise<any> {
  const { status, json } = await api("GET", `/epayment/v1/payments/${reference}`);
  if (status !== 200) throw new Error(`Vipps get payment feilet (HTTP ${status})`);
  return json;
}

/** Delvis (eller full) capture av reservert beløp. Idempotency-nøkkelen er stabil
 *  per økt slik at en retry aldri kan belaste dobbelt. */
export async function chargePayment(reference: string, amountOre: number, _label: string): Promise<string> {
  const body = { modificationAmount: { currency: "NOK", value: amountOre } };
  const { status, json } = await api("POST", `/epayment/v1/payments/${reference}/capture`, body, `${reference}-capture`);
  if (status !== 200) {
    setCheck("charge_done", "red", `Vipps HTTP ${status}: ${JSON.stringify(json)?.slice(0, 300)}`);
    throw new Error(`Vipps capture feilet (HTTP ${status})`);
  }
  setCheck("charge_done", "green", `Vipps capture ${amountOre} øre på ${reference}`);
  return json?.pspReference ?? reference;
}

/** Kansellerer hele reservasjonen (brukes når ingenting ble ladet).
 *  Beløpsargumentet finnes for signatur-kompatibilitet med nexi.ts — Vipps
 *  kansellerer alltid hele den gjenstående reservasjonen. */
export async function cancelPayment(reference: string, _amountOre?: number): Promise<void> {
  const { status, json } = await api("POST", `/epayment/v1/payments/${reference}/cancel`, {}, `${reference}-cancel`);
  if (status !== 200) throw new Error(`Vipps cancel feilet (HTTP ${status}): ${JSON.stringify(json)?.slice(0, 200)}`);
}

/** Test av nøkler uten å skape noe: henter access token. */
export async function testKeys(): Promise<{ ok: boolean; detail: string }> {
  if (!config.vippsClientId || !config.vippsClientSecret || !config.vippsSubscriptionKey) {
    setCheck("keys_valid", "red", "VIPPS_CLIENT_ID/SECRET/SUBSCRIPTION_KEY mangler i .env");
    return { ok: false, detail: "Vipps-nøkler er ikke satt" };
  }
  try {
    cachedToken = null; // tving nytt kall så testen er reell
    await accessToken();
    setCheck("keys_valid", "green", `Access token OK fra ${config.vippsApiBase}`);
    return { ok: true, detail: `Access token OK fra ${config.vippsApiBase}` };
  } catch (err) {
    setCheck("keys_valid", "red", (err as Error).message);
    return { ok: false, detail: (err as Error).message };
  }
}

// ---- Webhook-verifisering (HMAC, se docs/vipps-mobilepay/README.md) ----

/** Verifiserer at en innkommende webhook faktisk kommer fra Vipps.
 *  rawBody = uendret kropp slik den kom på ledningen (satt i index.ts).
 *  Host og sti beregnes fra BASE_URL slik Vipps ser dem (Funnel-prefiks inkludert). */
export function verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean {
  if (!config.vippsWebhookSecret) {
    logEvent("webhook-feil", "VIPPS_WEBHOOK_SECRET mangler i .env — webhook avvist");
    return false;
  }
  const h = (name: string): string => String(headers[name] ?? "");
  const date = h("x-ms-date");
  const contentSha = h("x-ms-content-sha256");
  const auth = h("authorization");
  if (!date || !contentSha || !auth) return false;

  const expectedSha = createHash("sha256").update(rawBody, "utf8").digest("base64");
  if (expectedSha !== contentSha) return false;

  const base = new URL(config.baseUrl);
  const pathAndQuery = `${base.pathname.replace(/\/$/, "")}/webhooks/vipps`;
  const signedString = `POST\n${pathAndQuery}\n${date};${base.host};${contentSha}`;
  const signature = createHmac("sha256", config.vippsWebhookSecret).update(signedString, "utf8").digest("base64");
  const expectedAuth = `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`;

  const a = Buffer.from(auth);
  const b = Buffer.from(expectedAuth);
  return a.length === b.length && timingSafeEqual(a, b);
}
