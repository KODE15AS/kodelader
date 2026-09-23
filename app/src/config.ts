import "dotenv/config";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Mangler miljøvariabel ${name}`);
  return v;
}

export const config = {
  // Aktiv betalingsleverandør: "vipps" (MobilePay ePayment, direkte) eller "nexi"
  // (Nets Easy — beholdt som mulig fremtidig kortkanal). Se docs/vipps-mobilepay/.
  paymentProvider: req("PAYMENT_PROVIDER", "nexi"),
  nexiApiBase: req("NEXI_API_BASE", "https://test.api.dibspayment.eu"),
  nexiSecretKey: req("NEXI_SECRET_KEY", ""),
  nexiCheckoutKey: req("NEXI_CHECKOUT_KEY", ""),
  vippsApiBase: req("VIPPS_API_BASE", "https://apitest.vipps.no"),
  vippsClientId: req("VIPPS_CLIENT_ID", ""),
  vippsClientSecret: req("VIPPS_CLIENT_SECRET", ""),
  vippsSubscriptionKey: req("VIPPS_SUBSCRIPTION_KEY", ""),
  vippsMsn: req("VIPPS_MSN", ""),
  // Fås ved webhook-registrering (POST /webhooks/v1/webhooks) — vises kun én gang
  vippsWebhookSecret: req("VIPPS_WEBHOOK_SECRET", ""),
  webhookAuth: req("WEBHOOK_AUTH", "kodelader-dev-secret"),
  baseUrl: req("BASE_URL", "http://localhost:8096").replace(/\/$/, ""),
  publicPort: parseInt(req("PUBLIC_PORT", "8096"), 10),
  adminPort: parseInt(req("ADMIN_PORT", "8097"), 10),
  dbPath: req("DB_PATH", "./data/kodelader.sqlite"),
  sms: {
    token: process.env.GATEWAYAPI_TOKEN ?? "",
    sender: process.env.SMS_SENDER ?? "KODE15" // maks 11 tegn, ingen spesialtegn
  },
  isLive(): boolean {
    return this.paymentProvider === "vipps"
      ? !this.vippsApiBase.includes("apitest")
      : !this.nexiApiBase.includes("test.");
  },
  activeApiBase(): string {
    return this.paymentProvider === "vipps" ? this.vippsApiBase : this.nexiApiBase;
  }
};
