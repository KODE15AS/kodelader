#!/usr/bin/env python3
"""Les status fra DEFA Power-ladebokser via Modbus TCP.

Rå Modbus TCP (funksjon 4, input-registre) med socket + struct.
Alle verdier leses i EN blokk (register 290–306) — enkeltlesing av
hvert register har vist seg å time ut på disse laderne, mens
blokklesing svarer stabilt.

Verdier er big-endian uint32 over to registre.
"""

import socket
import struct

LADERE = [
    ("DEFA Power nr. 1 (DEFA-Power-56101410M)", "10.10.0.16"),
    ("DEFA Power nr. 2 (DEFA-Power-54C00W10M)", "10.10.0.21"),
]

PORT = 502
SLAVE_ID = 255
START_REGISTER = 290
ANTALL_REGISTRE = 17  # 290..306

# (offset fra 290, beskrivelse, enhet)
FELTER = [
    (0, "Maks installasjonsstroem", "mA"),
    (3, "Faktisk stroem L1", "mA"),
    (6, "Faktisk stroem L2", "mA"),
    (9, "Faktisk stroem L3", "mA"),
    (12, "Statuskode", ""),
    (15, "Total effekt", "mW"),
]


def les_blokk(ip: str) -> bytes:
    """Les registerblokken 290–306 med Modbus funksjon 4."""
    pdu = struct.pack(">BHH", 4, START_REGISTER, ANTALL_REGISTRE)
    mbap = struct.pack(">HHHB", 1, 0, len(pdu) + 1, SLAVE_ID)

    with socket.create_connection((ip, PORT), timeout=5) as sock:
        sock.settimeout(5)
        sock.sendall(mbap + pdu)

        svar = b""
        forventet = 9 + ANTALL_REGISTRE * 2  # MBAP + funksjon + byteantall + data
        while len(svar) < forventet:
            del_svar = sock.recv(512)
            if not del_svar:
                raise ConnectionError("forbindelsen ble lukket")
            svar += del_svar

    if svar[7] & 0x80:
        raise RuntimeError(f"Modbus-feilkode {svar[8]}")

    return svar[9 : 9 + ANTALL_REGISTRE * 2]


def les_lader(navn: str, ip: str) -> None:
    print(f"\n=== {navn} — {ip} ===")
    try:
        data = les_blokk(ip)
    except (OSError, RuntimeError) as feil:
        print(f"  FEIL: fikk ikke lest status ({feil})")
        return

    for offset, beskrivelse, enhet in FELTER:
        (verdi,) = struct.unpack(">I", data[offset * 2 : offset * 2 + 4])
        register = START_REGISTER + offset
        enhetstekst = f" {enhet}" if enhet else ""
        print(f"  {beskrivelse:28s} (reg {register}): {verdi}{enhetstekst}")


if __name__ == "__main__":
    for navn, ip in LADERE:
        les_lader(navn, ip)
