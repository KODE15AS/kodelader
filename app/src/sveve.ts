import { config } from "./config.js";
import { logEvent, setCheck } from "./db.js";

/**
 * SMS via Sveve (https://sveve.no). Uten konfigurert konto logges meldingen bare,
 * slik at resten av flyten kan testes før kontoen er opprettet.
 */
export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!config.sveve.user || !config.sveve.password) {
    logEvent("sms-skip", `SMS ikke sendt (Sveve ikke konfigurert) til ${to}: ${message}`);
    return false;
  }
  const params = new URLSearchParams({
    user: config.sveve.user,
    passwd: config.sveve.password,
    to,
    from: config.sveve.sender,
    msg: message,
    f: "json"
  });
  try {
    const res = await fetch(`https://sveve.no/SMS/SendMessage?${params.toString()}`);
    const json: any = await res.json().catch(() => null);
    const sent = (json?.response?.msgOkCount ?? 0) > 0;
    if (sent) {
      logEvent("sms", `SMS sendt til ${to}`);
      setCheck("sms_sent", "green", `Levert til ${to}`);
    } else {
      logEvent("sms-feil", `Sveve avviste sending til ${to}`, undefined, json);
      setCheck("sms_sent", "red", JSON.stringify(json)?.slice(0, 200));
    }
    return sent;
  } catch (err) {
    logEvent("sms-feil", `Sveve-kall feilet: ${(err as Error).message}`);
    setCheck("sms_sent", "red", (err as Error).message);
    return false;
  }
}
