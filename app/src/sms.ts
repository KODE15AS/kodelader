import { config } from "./config.js";
import { logEvent, setCheck } from "./db.js";

/**
 * SMS via GatewayAPI (EU-plattformen, gatewayapi.eu). Uten konfigurert token
 * logges meldingen bare, slik at resten av flyten kan testes uten konto.
 *
 * NB: URL-er i meldingstekster (f.eks. kvitteringslenken) må være hvitelistet
 * hos GatewayAPI på forhånd (Dashboard → URL Whitelist), ellers avvises sendingen.
 */
export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!config.sms.token) {
    logEvent("sms-skip", `SMS ikke sendt (GatewayAPI ikke konfigurert) til ${to}: ${message}`);
    return false;
  }
  const msisdn = parseInt(to.replace(/^\+/, ""), 10);
  try {
    const res = await fetch("https://gatewayapi.eu/rest/mtsms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${config.sms.token}`
      },
      body: JSON.stringify({
        sender: config.sms.sender,
        message,
        recipients: [{ msisdn }]
      })
    });
    const json: any = await res.json().catch(() => null);
    if (res.ok && json?.ids?.length) {
      logEvent("sms", `SMS sendt til ${to} (GatewayAPI-id ${json.ids[0]})`);
      setCheck("sms_sent", "green", `Levert til ${to}`);
      return true;
    }
    logEvent("sms-feil", `GatewayAPI avviste sending til ${to} (HTTP ${res.status})`, undefined, json);
    setCheck("sms_sent", "red", `HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 200)}`);
    return false;
  } catch (err) {
    logEvent("sms-feil", `GatewayAPI-kall feilet: ${(err as Error).message}`);
    setCheck("sms_sent", "red", (err as Error).message);
    return false;
  }
}
