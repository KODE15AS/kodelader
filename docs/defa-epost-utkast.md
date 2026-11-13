# DEFA-e-post — utkast (oppdatert 06.11.2026, klar til sending)

Endepunktet er live og verifisert utenfra (404/401 med gyldig TLS).
Sendes av Jørn til **contact@defa.com**, kopi **evsupport.no@defa.com**.

Endringer 06.11 (etter at CSMS-et kom i drift): endepunktet omtales som
live og testbart, innloggingsdetaljene er tatt med (autorisert av Jørn —
passordene hentes fra `OCPP_STASJONER` i `.env` ved sending, de skal
ALDRI inn i dette repoet), og et forbehold om identitetsformat er lagt
til. Etter bekreftet provisjonering roteres passordene (én linje i
`.env` + restart av CSMS-containeren), siden de har reist med e-post.

---

**Emne:** Request: add our CSMS as selectable operator for our DEFA Power chargers

Hello,

We operate two DEFA Power chargers and would like our own CSMS backend
added as a selectable operator for them:

- DEFA-Power-56101410M
- DEFA-Power-54C00W10M

CSMS details:

- URL: `wss://lading.kode15.app/ocpp` (station identity appended:
  `/ocpp/<serial>`)
- OCPP 2.0.1, Security Profile 2: TLS 1.2+ (Let's Encrypt certificate)
  and HTTP Basic Auth, username = station identity
- The endpoint is live and may be tested at any time (unknown identity
  gives HTTP 404, missing or wrong credentials give HTTP 401)

Basic Auth credentials for the chargers:

- Username `56101410M`, password `<fra .env>`
- Username `54C00W10M`, password `<fra .env>`

If the chargers present a different station identity than the bare
serial number (for example the full product name), let us know and we
will adjust the usernames on our side immediately.

One question: how is the Basic Auth password provisioned to the
chargers — via the DEFA Power Setup app when selecting the operator, or
do you configure it on your side?

Best regards,
Jørn Watvedt
Kode15 AS (org.nr. 989 990 330)

---

## Tillegg 13.11.2026 — Modbus-spørsmål til evsupport (egen e-post)

Funn fra testøkt med bilsimulator (se
`handover/2026-11-13-defa-modbus-testokt.md`). Sendes separat til
**evsupport.no@defa.com** — ikke bland med CSMS-forespørselen over.

**Subject:** DEFA Power Modbus TCP: eMS registers not enforced, status/measurement registers always 0

Hello,

We are integrating two DEFA Power chargers (DEFA-Power-56101410M,
DEFA-Power-54C00W10M) via Modbus TCP per your protocol document
(modbus_documentation.pdf, Dec 2025 revision). The Modbus service
itself works — registers can be read and written consistently
(functions 3/4/16, slave 255, port 502). However:

1. The eMS registers are not enforced: with "Load balancing → Modbus"
   enabled in the DEFA Power Setup app, writing eMS max current = 0 mA
   (reg 2000) with the alive register (2008) written every 10 s did not
   affect an active charging session at all.
2. After a power cycle with a vehicle connected, the charger started
   charging immediately even though eMS max current and timeout max
   charge current (reg 2004) were both 0 — the documentation states the
   fallback default of 0 should prevent charging until overwritten.
3. The status register (302) and the measurement registers
   (293/296/299, 305) always read 0, also during active charging —
   verified with a real EV (Tesla Model 3) charging at 4.3 kW while
   all registers read 0.
4. The charging rate of 4.3 kW (~6 A per phase) matches the fallback
   current configured in the Setup app, suggesting the charger is in
   "master absent → fallback" mode and never recognizes our register
   writes as an active eMS master.

Questions: Which firmware version is required for eMS enforcement and
live measurement/status data over Modbus? Is any additional
configuration needed beyond enabling Modbus in the app (e.g. in
modbus-tcp.toml)? Current firmware versions on our units: <fylles inn
fra appen>.

Best regards,
Jørn Watvedt
Kode15 AS (org.nr. 989 990 330)
