# 29.10.2026: DEFA Power på wifi — Modbus TCP valgt som integrasjonsvei

Jørn satte DEFA Power-laderen på KODE15-wifi-en 29.10 (Bluetooth-oppsett
via DEFA Power Setup-appen). Utredning av API-muligheter gjort samme dag
(chat i studio15-light); Jørns beslutning: **Modbus TCP**.

## Enheten

- **DEFA-Power-56101410M**, 10.10.0.16 (MAC 48:02:af:d4:47:4f).
- OBS dynamisk IP: reservasjon → 10.10.0.16 er lagt i fortigate-drengens
  planlagte DHCP-ordre (sammen med Mill/Shelly/raven). Til den er utført:
  slå opp i FortiGates DHCP-utleieliste ved IP-drift.
- Laderen har IKKE lokalt HTTP-API (port 80/443 stengt).

## Utredningen (tre veier, 29.10)

1. **Modbus TCP — VALGT.** Offisiell og dokumentert: laderen er slave på
   port 502, slave-ID 255, protokoll-PDF:
   https://www.defa.com/content/uploads/Documentation/EV-Charging/DEFA-Power/Support/modbus_documentation.pdf
   Lese: faktisk strøm per fase (reg. 293/296/299, uint32 mA),
   installasjonens maksstrøm (reg. 290). Skrive: maksstrøm-grense
   (reg. 2000–2001, mA) med keep-alive (reg. 2008–2009) og konfigurerbar
   fallback-strøm ved master-bortfall. Kun ÉN Modbus-master om gangen.
   Dette er laststyring (grenser + måling), ikke øktstyring (start/stopp).
2. **CloudCharge-API (sky)** — ingen offentlig API fra DEFA («no public
   API, no timeline»), men reverse-engineeret av HA-miljøet:
   https://github.com/Bebbssos/ha-defa-power (start/stopp, eco-modus,
   ladeplaner; SMS-innlogging, én sesjon per app-identitet). Reserve hvis
   øktstyring fra sky trengs senere — uoffisiell, kan knekke.
3. **OCPP 2.0.1 (CSMS)** — kun godkjente backends, egendefinert URL
   støttes ikke (bekreftet av DEFA-fastvareutvikler). Uaktuelt.

## Verifisert live 29.10 (fra raven over wlo1)

Modbus er ALLEREDE AKTIVERT på laderen (port 502 åpen — gjort under
app-oppsettet). Leseprøve med rå Modbus TCP (funksjon 4):
installasjon maks strøm = 32,0 A; faktisk strøm L1/L2/L3 = 0,00 A
(ingen bil tilkoblet). Ingen autentisering — hele kontor-wifi-en (og
drengr via enhetsnettet/policy 19) når porten; akseptert avveining på
vårt nett.

## Installatør-prosedyren (kveld 29.10): vurdert og kortet ned

Jørn fikk en prosedyre fra elektroinstallatøren (aktiver Modbus i appen,
noter IP, registertabell). Vurdering mot live-testene: teknisk korrekt
(registertabellen stemmer med DEFAs protokolldokument), men aktiverings-
delen er allerede passert — Modbus svarer, fastvaren er dermed ny nok,
og IP-en er kjent og skal reserveres i fortigate. **Gjenstående app-
oppgave, den eneste:** i DEFA Power Setup-appen under Junction Settings
→ Load balancing: verifiser at Modbus står på og sett bevisst
`Timeout value` + `Fallback current` (forslag 6 A) — ukjent hva de står
på i dag. Alt annet er vår side: hjerteslag til reg. 2008–2009 hvert
~10. sekund (ellers faller laderen tilbake til fallback-strømmen —
ønsket sikkerhetsmekanisme), og én-master-regelen.

Tilleggsregistre fra prosedyren, IKKE live-verifisert ennå (laderen ble
slått av): 302–303 statuskode, 305–306 total effekt (mW). Verifiseres
neste gang den er på.

## Forhold til dagens Shelly-arkitektur

Shelly Pro 3EM (10.10.0.14) + kontaktor forblir betalings- og
målehjertet (utgående WebSocket til appen, lokal autonomi). Modbus mot
DEFA-en er et TILLEGG: direkte lesing av ladestrøm per fase og styring
av maksstrøm-grensen — aktuelt for laststyring og hjemautomasjon
(Studio15). Husk én-master-begrensningen hvis laststyring mot
hovedsikring kommer senere: master-rollen må bo ÉN plass (naturlig i
denne drengen).
