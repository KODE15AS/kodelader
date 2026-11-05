# Peker fra sikkerhetssjef: OCPP-eksponeringen står — kontrakt for CSMS-et (05.11.2026)

Eksponeringskjeden for `wss://lading.kode15.app/ocpp` er levert og
verifisert i kveld (sikkerhetssjef-chatten, Jørn-JA på minimumsplanen).
Denne pekeren er kontrakten kodelader-siden bygger CSMS-et mot.

## Det som står (verifisert 05.11 ca. 18:50)

- **DNS:** A-post `lading.kode15.app → 62.92.43.149` committet i
  deploi-dns (`b2dd16c`), utført av applikatoren, løser offentlig.
- **Rute:** Caddy-blokk i web-gateway (`832dda5`): full
  WebSocket-passasje på `/ocpp/*`, 404 på alt annet. Let's
  Encrypt-sertifikat utstedt. Navneunntaket («lading» = tjenestenavn,
  drengen heter kodelader) er dokumentert i web-gateways README.
- **Verifisert utenfra:** `https://lading.kode15.app/` → 404 med gyldig
  TLS; `/ocpp/test` → 502 (forventet — CSMS-et finnes ikke ennå).
- **Hairpin verifisert fra ladernes nett:** kall fra kontor-wifi-en
  (raven wlo1, 10.10.0.33) når endepunktet med gyldig TLS —
  NAT-tilbakeslaget fra 11.–14.10 rammer ikke laderne.

## Kontrakten: det CSMS-containeren må oppfylle

1. **Navn og port:** containeren heter `kodelader-csms` og lytter på
   port 9000 (Caddy proxyer dit med containernavn).
2. **Nett:** tjenesten må meldes inn i det delte docker-nettet
   `drengr-nett` i compose — kodelader-stacken står i dag kun på
   default + enhetsnett, så dette er en ny nettdeklarasjon.
3. **Avvisning fra første sekund** (vilkår fra Jørn-godkjenningen):
   ukjent stasjonsidentitet → 404, feil/manglende Basic Auth → 401.
   Vi har oppgitt Security Profile 2 til DEFA og de tester trolig
   akkurat dette. TLS termineres i web-gateway; Basic Auth valideres i
   CSMS-et. Brukernavn = stasjonsidentiteten bakerst i URL-en
   (`/ocpp/56101410M`); passord per lader i `.env`.
4. **Logg tilkoblingsforsøk** (IP, stasjonsidentitet, utfall) — minimum
   nå; kobles til sikkerhetssjefens avviksvakt senere.

## Ønske meldt samtidig (fra Jørn): laderstatus-side

Lite web-UI i kodelader for «ping» av laderne — men ikke ICMP/port-prodding
(laderne misliker tilkoblings-støy, se fasiten 05.11). Riktig mønster:
blokklesing 290–306 over én Modbus-forbindelse (som
`verktoy/les_defa_status.py`), skånsomt intervall — og når OCPP er live:
vis «tilkoblet nå» fra CSMS-ets stående WebSocket, som ikke rører laderen
i det hele tatt.

## Når DEFA-e-posten kan sendes

Når CSMS-et står slik at `wss://lading.kode15.app/ocpp/test` utenfra gir
TLS-handshake + 404/401 i stedet for dagens 502 — da sendes e-posten fra
kodelader-chatten. Meld tilbake til sikkerhetssjef-chatten samtidig, så
føres oppdraget som levert der.
