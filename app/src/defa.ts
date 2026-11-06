/** DEFA Power-laderne: statuslesing over Modbus TCP (enhetsnettet).
 *
 *  Mønsteret fra handover/2026-10-29-defa-power-modbus.md og
 *  verktoy/les_defa_status.py: laderne misliker tilkoblings-churn og
 *  enkeltregister-lesing — derfor ÉN forbindelse og blokklesing av hele
 *  registerområdet 290–306 i ÉN forespørsel (funksjon 4, slave 255).
 *  Lesing skjer kun på forespørsel fra admin (knapp/faneåpning) — aldri
 *  i fast kort intervall, og aldri ping/port-prodding.
 *
 *  Laderliste er en innstilling (defa_ladere: "<SN>=<IP>,..."), siden
 *  IP-ene er dynamiske til fortigate-DHCP-reservasjonene er utført.
 */
import { createConnection } from "node:net";
import { getSetting } from "./db.js";

const PORT = 502;
const SLAVE_ID = 255;
const START_REGISTER = 290;
const ANTALL_REGISTRE = 17; // 290..306

export interface DefaLader { id: string; ip: string }

export function defaLadere(): DefaLader[] {
  return getSetting("defa_ladere")
    .split(",")
    .map((par) => par.trim())
    .filter((par) => par.includes("="))
    .map((par) => {
      const [id, ip] = par.split("=", 2);
      return { id: id.trim(), ip: ip.trim() };
    })
    .filter((l) => l.id && l.ip);
}

/** Les registerblokken 290–306 i én Modbus-forespørsel. */
function lesBlokk(ip: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // PDU: funksjon 4 (input-registre), start, antall — MBAP foran
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(4, 0);
    pdu.writeUInt16BE(START_REGISTER, 1);
    pdu.writeUInt16BE(ANTALL_REGISTRE, 3);
    const mbap = Buffer.alloc(7);
    mbap.writeUInt16BE(1, 0);               // transaksjons-id
    mbap.writeUInt16BE(0, 2);               // protokoll
    mbap.writeUInt16BE(pdu.length + 1, 4);  // lengde (pdu + slave-id)
    mbap.writeUInt8(SLAVE_ID, 6);

    const forventet = 9 + ANTALL_REGISTRE * 2; // MBAP + funksjon + byteantall + data
    let svar = Buffer.alloc(0);
    const sock = createConnection({ host: ip, port: PORT, timeout: 5000 });
    const feil = (msg: string) => { sock.destroy(); reject(new Error(msg)); };

    sock.on("connect", () => sock.write(Buffer.concat([mbap, pdu])));
    sock.on("timeout", () => feil("tidsavbrudd (5 s)"));
    sock.on("error", (err) => feil(err.message));
    sock.on("data", (del) => {
      svar = Buffer.concat([svar, del]);
      if (svar.length < forventet) return;
      if (svar[7] & 0x80) { feil(`Modbus-feilkode ${svar[8]}`); return; }
      sock.destroy();
      resolve(svar.subarray(9, 9 + ANTALL_REGISTRE * 2));
    });
  });
}

/** Reg. 302: ASCII-kodet IEC 61851-tilstand (bits 8–15 = bokstav A–F,
 *  bits 0–7 = siffer; eks. 0x4332 = «C2» = lader). 0 observert i ro. */
function iecTekst(kode: number): string {
  if (kode === 0) return "0 (i ro)";
  const bokstav = String.fromCharCode((kode >> 8) & 0xff);
  const siffer = String.fromCharCode(kode & 0xff);
  const tekster: Record<string, string> = {
    A: "ingen bil", B: "bil tilkoblet", C: "lader",
    D: "lader (ventilasjon)", E: "feil", F: "feil"
  };
  if (!(bokstav in tekster)) return `ukjent kode ${kode}`;
  return `${bokstav}${/[0-9]/.test(siffer) ? siffer : ""} — ${tekster[bokstav]}`;
}

export interface DefaStatus {
  maksA: number;
  l1A: number;
  l2A: number;
  l3A: number;
  statusKode: number;
  status: string;
  effektW: number;
}

/** Feltoffsets (i registre fra 290): se verktoy/les_defa_status.py. */
export async function lesDefaStatus(ip: string): Promise<DefaStatus> {
  const data = await lesBlokk(ip);
  const u32 = (regOffset: number) => data.readUInt32BE(regOffset * 2);
  const statusKode = u32(12);
  return {
    maksA: u32(0) / 1000,     // reg 290: maks installasjonsstrøm, mA
    l1A: u32(3) / 1000,       // reg 293: faktisk strøm L1, mA
    l2A: u32(6) / 1000,       // reg 296
    l3A: u32(9) / 1000,       // reg 299
    statusKode,               // reg 302: IEC-tilstand (ASCII-kodet)
    status: iecTekst(statusKode),
    effektW: u32(15) / 1000   // reg 305: total effekt, mW
  };
}
