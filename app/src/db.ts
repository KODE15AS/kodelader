import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  max_amount_ore INTEGER NOT NULL,
  price_per_kwh_ore INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  shelly_id TEXT NOT NULL,
  name TEXT NOT NULL,
  switch_id INTEGER NOT NULL DEFAULT 100,
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  phone TEXT,
  max_amount_ore INTEGER NOT NULL,
  price_per_kwh_ore INTEGER NOT NULL,
  start_energy_wh REAL,
  last_energy_wh REAL,
  last_power_w REAL,
  above_idle_since TEXT,
  kwh REAL NOT NULL DEFAULT 0,
  amount_ore INTEGER,
  end_reason TEXT,
  sms1_sent INTEGER NOT NULL DEFAULT 0,
  sms2_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  message TEXT NOT NULL,
  data TEXT
);
CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'auto' | 'manual'
  phase TEXT NOT NULL,         -- 'sandkasse' | 'skarp'
  status TEXT NOT NULL DEFAULT 'grey',  -- 'grey' | 'green' | 'red'
  ts TEXT,
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
`);

// --- Innstillinger (driftsparametre — redigeres i admin) ---

const defaultSettings: Record<string, string> = {
  idle_threshold_w: "100",      // ferdig-deteksjon: effekt under dette ...
  idle_minutes: "10",           // ... i så mange minutter -> avslutt
  max_session_hours: "12",      // makstid per økt (sikkerhetsnett)
  receipt_days: "30",           // kvitteringens levetid
  skip_checkout_form: "1"       // 1 = skjul navn/adresse-skjemaet i checkout (merchantHandlesConsumerData)
};

export function getSetting(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? defaultSettings[key] ?? "";
}
export function setSetting(key: string, value: string): void {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
export function allSettings(): Record<string, string> {
  const out = { ...defaultSettings };
  for (const row of db.prepare("SELECT key,value FROM settings").all() as { key: string; value: string }[]) {
    out[row.key] = row.value;
  }
  return out;
}

// --- Seed: produkter (QR-kodene), enheter og etablerings-sjekkpunkter ---

function seed(): void {
  const prodCount = (db.prepare("SELECT COUNT(*) c FROM products").get() as { c: number }).c;
  if (prodCount === 0) {
    const ins = db.prepare("INSERT INTO products(id,label,max_amount_ore,price_per_kwh_ore,active) VALUES(?,?,?,?,1)");
    ins.run("kr1", "Test — maks 1 kr", 100, 500);
    ins.run("kr100", "Lading — maks 100 kr", 10000, 500);
  }
  const devCount = (db.prepare("SELECT COUNT(*) c FROM devices").get() as { c: number }).c;
  if (devCount === 0) {
    const ins = db.prepare("INSERT INTO devices(id,shelly_id,name,switch_id) VALUES(?,?,?,?)");
    ins.run("proto1", "shellypro3em-1c8f57034ae4", "Prototype (sikringsskap)", 100);
    ins.run("sim1", "shellypro3em-sim001", "Simulert lader", 100);
  }
  const checkCount = (db.prepare("SELECT COUNT(*) c FROM checks").get() as { c: number }).c;
  if (checkCount === 0) {
    const ins = db.prepare("INSERT INTO checks(id,label,kind,phase,sort) VALUES(?,?,?,?,?)");
    // Sandkasse — automatiske (tennes av appen når beviset foreligger)
    ins.run("keys_valid", "API-nøkler gyldige mot Nexi", "auto", "sandkasse", 10);
    ins.run("checkout_created", "Checkout/reservasjon opprettet", "auto", "sandkasse", 20);
    ins.run("webhook_received", "Webhook mottatt og verifisert", "auto", "sandkasse", 30);
    ins.run("phone_present", "Mobilnummer til stede i betalingsdata", "auto", "sandkasse", 40);
    ins.run("charge_done", "Delvis capture gjennomført", "auto", "sandkasse", 50);
    ins.run("sms_sent", "SMS levert via Sveve", "auto", "sandkasse", 60);
    ins.run("device_ws", "Ekte Shelly tilkoblet via WebSocket", "auto", "sandkasse", 70);
    // Sandkasse — manuelle (bekreftes i admin etter kontroll i Nexi-portalen)
    ins.run("reservation_released", "Rest-reservasjon frigitt (sjekket i portal)", "manual", "sandkasse", 80);
    ins.run("vipps_tested", "Vipps testet ende-til-ende", "manual", "sandkasse", 90);
    ins.run("amounts_verified", "Beløp stemmer i Nexi-portalen", "manual", "sandkasse", 100);
    // Skarp kjøring (fase 3)
    ins.run("live_keys", "Live-nøkler lagt inn i .env på Raven", "manual", "skarp", 110);
    ins.run("shelly_password", "Adminpassord satt på Shelly-enheten", "manual", "skarp", 120);
    ins.run("dhcp_lease", "Fast DHCP-lease for enheten", "manual", "skarp", 130);
    ins.run("live_payment", "Første skarpe betaling (kr 1-QR) verifisert", "manual", "skarp", 140);
  }
}
seed();

export function logEvent(kind: string, message: string, ref?: string, data?: unknown): void {
  db.prepare("INSERT INTO events(ts,kind,ref,message,data) VALUES(?,?,?,?,?)").run(
    new Date().toISOString(), kind, ref ?? null, message, data === undefined ? null : JSON.stringify(data).slice(0, 4000)
  );
  console.log(`[${kind}] ${message}${ref ? ` (${ref})` : ""}`);
}

export function setCheck(id: string, status: "grey" | "green" | "red", note?: string): void {
  db.prepare("UPDATE checks SET status=?, ts=?, note=? WHERE id=?").run(status, new Date().toISOString(), note ?? null, id);
}
