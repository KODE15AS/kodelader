#!/usr/bin/env node
/**
 * Genererer QR-kodene som klistres på laderen (til docs/qr/).
 * Bruk: node app/scripts/generate-qr.mjs [base-url]
 * Uten argument leses BASE_URL fra .env i repo-rota.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import QRCode from "qrcode";

let baseUrl = process.argv[2];
if (!baseUrl) {
  try {
    const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    baseUrl = env.match(/^BASE_URL=(.+)$/m)?.[1]?.trim();
  } catch { /* ignorer */ }
}
if (!baseUrl) {
  console.error("Angi base-URL: node app/scripts/generate-qr.mjs https://...");
  process.exit(1);
}
baseUrl = baseUrl.replace(/\/$/, "");

const codes = [
  { file: "proto1-kr1.png", url: `${baseUrl}/start?enhet=proto1&produkt=kr1` },
  { file: "proto1-kr100.png", url: `${baseUrl}/start?enhet=proto1&produkt=kr100` },
  { file: "sim1-kr1.png", url: `${baseUrl}/start?enhet=sim1&produkt=kr1` }
];

mkdirSync(new URL("../../docs/qr/", import.meta.url), { recursive: true });
for (const c of codes) {
  const buf = await QRCode.toBuffer(c.url, { width: 600, margin: 2, errorCorrectionLevel: "M" });
  writeFileSync(new URL(`../../docs/qr/${c.file}`, import.meta.url), buf);
  console.log(`${c.file}  ->  ${c.url}`);
}
