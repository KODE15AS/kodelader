import { config } from "./config.js";
import { getSetting, logEvent, setCheck } from "./db.js";

/** Minimal klient mot Nexi Checkout (Nets Easy) Payment API. */

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(config.nexiApiBase + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: config.nexiSecretKey
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  logEvent(res.ok ? "nexi" : "nexi-feil", `${method} ${path} → ${res.status}`, undefined, res.ok ? undefined : json);
  return { status: res.status, json };
}

export interface CreatedPayment {
  paymentId: string;
  hostedPaymentPageUrl: string;
}

/** Oppretter betaling (reservasjon av maksbeløp) med hosted checkout og webhook-abonnement. */
export async function createPayment(sessionId: string, amountOre: number, label: string): Promise<CreatedPayment> {
  const item = {
    reference: "lading",
    name: label,
    quantity: 1,
    unit: "økt",
    unitPrice: amountOre,
    taxRate: 0,
    taxAmount: 0,
    netTotalAmount: amountOre,
    grossTotalAmount: amountOre
  };
  const body = {
    order: {
      amount: amountOre,
      currency: "NOK",
      reference: sessionId,
      items: [item]
    },
    checkout: {
      integrationType: "HostedPaymentPage",
      returnUrl: `${config.baseUrl}/?session=${sessionId}`,
      cancelUrl: `${config.baseUrl}/?cancelled=${sessionId}`,
      termsUrl: `${config.baseUrl}/vilkar`,
      charge: false,
      // true = ikke noe navn/adresse-skjema i checkout — kunden går rett til betalingsvalg.
      // Styres fra admin (Innstillinger) i tilfelle mobilnummeret uteblir fra betalingsdataene.
      merchantHandlesConsumerData: getSetting("skip_checkout_form") === "1"
    },
    // «Kun Vipps» skjuler kortskjemaet helt (rekkefølge/forvalg ved flere metoder styres av Nexi).
    // Metoder som ikke er nevnt i listen blir implisitt deaktivert.
    ...(getSetting("payment_methods") === "vipps"
      ? { paymentMethodsConfiguration: [{ name: "Vipps", enabled: true }] }
      : {}),
    notifications: {
      webHooks: [
        {
          eventName: "payment.checkout.completed",
          url: `${config.baseUrl}/webhooks/nets`,
          authorization: config.webhookAuth
        }
      ]
    }
  };
  const { status, json } = await api("POST", "/v1/payments", body);
  if (status !== 201 || !json?.paymentId) {
    setCheck("checkout_created", "red", `HTTP ${status}: ${JSON.stringify(json)?.slice(0, 300)}`);
    throw new Error(`Nexi create payment feilet (HTTP ${status})`);
  }
  setCheck("keys_valid", "green", "Bevist via vellykket create payment");
  setCheck("checkout_created", "green", `paymentId ${json.paymentId}`);
  return { paymentId: json.paymentId, hostedPaymentPageUrl: json.hostedPaymentPageUrl };
}

export async function getPayment(paymentId: string): Promise<any> {
  const { status, json } = await api("GET", `/v1/payments/${paymentId}`);
  if (status !== 200) throw new Error(`Nexi get payment feilet (HTTP ${status})`);
  return json?.payment ?? json;
}

/** Delvis (eller full) capture av reservert beløp. */
export async function chargePayment(paymentId: string, amountOre: number, label: string): Promise<string> {
  const body = {
    amount: amountOre,
    orderItems: [
      {
        reference: "lading",
        name: label,
        quantity: 1,
        unit: "økt",
        unitPrice: amountOre,
        taxRate: 0,
        taxAmount: 0,
        netTotalAmount: amountOre,
        grossTotalAmount: amountOre
      }
    ]
  };
  const { status, json } = await api("POST", `/v1/payments/${paymentId}/charges`, body);
  if (status !== 201 || !json?.chargeId) {
    setCheck("charge_done", "red", `HTTP ${status}: ${JSON.stringify(json)?.slice(0, 300)}`);
    throw new Error(`Nexi charge feilet (HTTP ${status})`);
  }
  setCheck("charge_done", "green", `chargeId ${json.chargeId}, ${amountOre} øre`);
  return json.chargeId;
}

/** Kansellerer hele reservasjonen (brukes når ingenting ble ladet). */
export async function cancelPayment(paymentId: string, amountOre: number): Promise<void> {
  const { status, json } = await api("POST", `/v1/payments/${paymentId}/cancels`, { amount: amountOre });
  if (status !== 204) throw new Error(`Nexi cancel feilet (HTTP ${status}): ${JSON.stringify(json)?.slice(0, 200)}`);
}

/** Test av nøkler uten å skape noe: henter en ikke-eksisterende betaling og tolker svaret. */
export async function testKeys(): Promise<{ ok: boolean; detail: string }> {
  if (!config.nexiSecretKey) {
    setCheck("keys_valid", "red", "NEXI_SECRET_KEY er tom");
    return { ok: false, detail: "NEXI_SECRET_KEY er ikke satt" };
  }
  const { status } = await api("GET", "/v1/payments/00000000000000000000000000000000");
  // 404 = nøkkelen ble akseptert (betalingen finnes bare ikke). 401 = ugyldig nøkkel.
  const ok = status === 404 || status === 200;
  setCheck("keys_valid", ok ? "green" : "red", `Testkall ga HTTP ${status}`);
  return { ok, detail: `HTTP ${status} fra ${config.nexiApiBase}` };
}
