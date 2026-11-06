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
