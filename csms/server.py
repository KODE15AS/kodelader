"""Kodelader CSMS — OCPP 2.0.1-endepunkt for DEFA-laderne.

Kontrakt (handover/2026-11-05-peker-fra-sikkerhetssjef-ocpp.md):
containeren heter kodelader-csms, lytter på port 9000 og er meldt inn i
drengr-nett. TLS termineres i web-gateway (lading.kode15.app, kun
/ocpp/*); her valideres HTTP Basic Auth (OCPP Security Profile 2).

Avvisning fra første sekund:
  - ukjent stasjonsidentitet  -> 404
  - feil/manglende Basic Auth -> 401 (brukernavn MÅ være stasjonsidentiteten)

Alle tilkoblingsforsøk logges (IP, stasjonsidentitet, utfall) til stdout
og til JSONL-fil, og serveres på GET /api/logg — den stien rutes IKKE av
web-gateway (alt annet enn /ocpp/* gir 404 der), så den er kun nåbar fra
de interne docker-nettene. Admin-appen (port 8097, kun tailnett) viser
loggen i fanen «05 CSMS».

Stasjoner og passord konfigureres i .env (aldri i repo):
  OCPP_STASJONER=56101410M=passord1,54C00W10M=passord2
Identiteten er nøyaktig det laderen legger bakerst i URL-en
(/ocpp/<identitet>) — formatet avklares med DEFA, og endres her uten
kodeendring. Passord: kun bokstaver/sifre (komma og likhetstegn er
skilletegn i variabelen).
"""

import asyncio
import base64
import json
import logging
import os
import secrets
from collections import deque
from datetime import datetime, timezone
from http import HTTPStatus

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from ocpp.routing import on
from ocpp.v201 import ChargePoint, call_result

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logg_ocpp = logging.getLogger("ocpp")
logg_ocpp.setLevel(logging.INFO)

PORT = int(os.environ.get("CSMS_PORT", "9000"))
LOGGFIL = os.environ.get("CSMS_LOGG", "/data/csms-logg.jsonl")
SUBPROTOKOLL = "ocpp2.0.1"


def les_stasjoner() -> dict[str, str]:
    """OCPP_STASJONER=<identitet>=<passord>,... -> ordbok."""
    stasjoner: dict[str, str] = {}
    for par in os.environ.get("OCPP_STASJONER", "").split(","):
        par = par.strip()
        if not par or "=" not in par:
            continue
        identitet, passord = par.split("=", 1)
        if identitet.strip() and passord.strip():
            stasjoner[identitet.strip()] = passord.strip()
    return stasjoner


STASJONER = les_stasjoner()

# --- Logg: ringbuffer i minnet + JSONL-fil (volum) + stdout ---

hendelser: deque[dict] = deque(maxlen=500)
# Kjøretilstand per stasjon: tilkoblet nå, siste IP, siste livstegn (heartbeat/melding)
tilstand: dict[str, dict] = {s: {"tilkoblet": False, "ip": None, "sist_sett": None} for s in STASJONER}


def naa() -> str:
    return datetime.now(timezone.utc).isoformat()


def logg(hendelse: str, stasjon: str | None, ip: str | None, detalj: str) -> None:
    post = {"ts": naa(), "hendelse": hendelse, "stasjon": stasjon, "ip": ip, "detalj": detalj}
    hendelser.append(post)
    print(f"[{hendelse}] {stasjon or '-'} fra {ip or '-'}: {detalj}", flush=True)
    try:
        with open(LOGGFIL, "a", encoding="utf-8") as f:
            f.write(json.dumps(post, ensure_ascii=False) + "\n")
    except OSError as err:
        print(f"[logg-feil] klarte ikke skrive {LOGGFIL}: {err}", flush=True)


def last_logg_fra_fil() -> None:
    """Fyll ringbufferet med halen av loggfila ved oppstart."""
    try:
        with open(LOGGFIL, encoding="utf-8") as f:
            for linje in deque(f, maxlen=hendelser.maxlen):
                try:
                    hendelser.append(json.loads(linje))
                except json.JSONDecodeError:
                    pass
    except FileNotFoundError:
        pass


# --- HTTP-laget: 404/401 før WebSocket-oppgradering + intern loggside ---

def klient_ip(connection, request) -> str:
    videresendt = request.headers.get("X-Forwarded-For") if request else None
    if videresendt:
        return videresendt.split(",")[0].strip()
    adresse = connection.remote_address
    return adresse[0] if adresse else "?"


def stasjon_fra_sti(sti: str) -> str:
    sti = sti.split("?", 1)[0].rstrip("/")
    return sti.removeprefix("/ocpp/") if sti.startswith("/ocpp/") else ""


def process_request(connection, request):
    """Kjøres for alle innkommende forespørsler, før evt. oppgradering."""
    sti = request.path.split("?", 1)[0].rstrip("/")
    ip = klient_ip(connection, request)

    # Intern loggside (nås kun fra docker-nettene — web-gateway ruter kun /ocpp/*)
    if sti == "/api/logg":
        kropp = json.dumps({
            "stasjoner": [{"id": s, **tilstand[s]} for s in STASJONER],
            "hendelser": list(reversed(hendelser)),
        }, ensure_ascii=False)
        svar = connection.respond(HTTPStatus.OK, kropp)
        svar.headers["Content-Type"] = "application/json; charset=utf-8"
        return svar

    if not sti.startswith("/ocpp/"):
        logg("avvist-404", None, ip, f"ukjent sti {sti or '/'}")
        return connection.respond(HTTPStatus.NOT_FOUND, "Ikke funnet\n")

    identitet = stasjon_fra_sti(sti)
    if identitet not in STASJONER:
        logg("avvist-404", identitet or None, ip, "ukjent stasjonsidentitet")
        return connection.respond(HTTPStatus.NOT_FOUND, "Ukjent stasjon\n")

    feil = sjekk_basic_auth(request, identitet)
    if feil:
        logg("avvist-401", identitet, ip, feil)
        svar = connection.respond(HTTPStatus.UNAUTHORIZED, "Autentisering kreves\n")
        svar.headers["WWW-Authenticate"] = 'Basic realm="ocpp"'
        return svar

    return None  # godkjent — fortsett med WebSocket-handshaken


def sjekk_basic_auth(request, identitet: str) -> str | None:
    """None = OK, ellers kort begrunnelse (logges, sendes aldri til klienten)."""
    header = request.headers.get("Authorization", "")
    if not header.startswith("Basic "):
        return "manglende Basic Auth"
    try:
        brukernavn, _, passord = base64.b64decode(header[6:]).decode("utf-8").partition(":")
    except (ValueError, UnicodeDecodeError):
        return "ugyldig Basic Auth-koding"
    if not secrets.compare_digest(brukernavn.encode(), identitet.encode()):
        return "brukernavn er ikke stasjonsidentiteten"
    if not secrets.compare_digest(passord.encode(), STASJONER[identitet].encode()):
        return "feil passord"
    return None


# --- OCPP-laget: minimal 2.0.1-håndtering (boot, heartbeat, status) ---

class KodeladerStasjon(ChargePoint):
    @on("BootNotification")
    def on_boot_notification(self, charging_station: dict, reason: str, **kwargs):
        info = f"{charging_station.get('vendor_name', '?')} {charging_station.get('model', '?')} fw {charging_station.get('firmware_version', '?')}"
        logg("boot", self.id, tilstand.get(self.id, {}).get("ip"), f"BootNotification ({reason}): {info}")
        return call_result.BootNotification(current_time=naa(), interval=300, status="Accepted")

    @on("Heartbeat")
    def on_heartbeat(self, **kwargs):
        if self.id in tilstand:
            tilstand[self.id]["sist_sett"] = naa()
        return call_result.Heartbeat(current_time=naa())

    @on("StatusNotification")
    def on_status_notification(self, timestamp: str, connector_status: str, evse_id: int, connector_id: int, **kwargs):
        logg("status", self.id, tilstand.get(self.id, {}).get("ip"), f"EVSE {evse_id}/{connector_id}: {connector_status}")
        return call_result.StatusNotification()


async def handler(connection):
    identitet = stasjon_fra_sti(connection.request.path)
    ip = klient_ip(connection, connection.request)
    tilstand.setdefault(identitet, {})
    tilstand[identitet].update({"tilkoblet": True, "ip": ip, "sist_sett": naa()})
    logg("tilkoblet", identitet, ip, f"WebSocket åpnet (subprotokoll: {connection.subprotocol or 'ingen'})")
    stasjon = KodeladerStasjon(identitet, connection)
    try:
        await stasjon.start()
    except ConnectionClosed:
        pass
    finally:
        tilstand[identitet].update({"tilkoblet": False, "sist_sett": naa()})
        logg("frakoblet", identitet, ip, "WebSocket lukket")


async def main():
    last_logg_fra_fil()
    if not STASJONER:
        print("[advarsel] OCPP_STASJONER er tom — alle stasjoner avvises med 404", flush=True)
    async with serve(handler, "0.0.0.0", PORT, process_request=process_request, subprotocols=[SUBPROTOKOLL]):
        print(f"[app] CSMS lytter på :{PORT} ({len(STASJONER)} kjente stasjoner)", flush=True)
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
