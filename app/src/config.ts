import "dotenv/config";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Mangler miljøvariabel ${name}`);
  return v;
}

export const config = {
  nexiApiBase: req("NEXI_API_BASE", "https://test.api.dibspayment.eu"),
  nexiSecretKey: req("NEXI_SECRET_KEY", ""),
  nexiCheckoutKey: req("NEXI_CHECKOUT_KEY", ""),
  webhookAuth: req("WEBHOOK_AUTH", "kodelader-dev-secret"),
  baseUrl: req("BASE_URL", "http://localhost:8096").replace(/\/$/, ""),
  publicPort: parseInt(req("PUBLIC_PORT", "8096"), 10),
  adminPort: parseInt(req("ADMIN_PORT", "8097"), 10),
  dbPath: req("DB_PATH", "./data/kodelader.sqlite"),
  sveve: {
    user: process.env.SVEVE_USER ?? "",
    password: process.env.SVEVE_PASSWORD ?? "",
    sender: process.env.SVEVE_SENDER ?? "KODE15"
  },
  isLive(): boolean {
    return !this.nexiApiBase.includes("test.");
  }
};
