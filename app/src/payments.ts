import { config } from "./config.js";
import * as nexi from "./nexi.js";
import * as vipps from "./vipps.js";

/** Fasade over aktiv betalingsleverandør (PAYMENT_PROVIDER i .env).
 *  Begge moduler har identisk funksjonssnitt; resten av appen skal importere
 *  herfra og aldri fra nexi.ts/vipps.ts direkte (unntak: webhook-verifisering
 *  som er Vipps-spesifikk). */

const provider = config.paymentProvider === "vipps" ? vipps : nexi;

export const createPayment = provider.createPayment;
export const getPayment = provider.getPayment;
export const chargePayment = provider.chargePayment;
export const cancelPayment = provider.cancelPayment;
export const testKeys = provider.testKeys;
export type { CreatedPayment } from "./nexi.js";
