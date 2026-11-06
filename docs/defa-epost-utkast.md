# DEFA-e-post — utkast (klar til sending 06.11.2026)

Endepunktet er verifisert utenfra (404/401 med gyldig TLS), så e-posten
kan sendes. Sendes av Jørn til **contact@defa.com**, kopi
**evsupport.no@defa.com**. Innholdet under er med vilje minimalt
(handover 06.11): ett spørsmål, ingen gjetting om provisjonering.

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

One question: how is the Basic Auth password provisioned to the
chargers — via the DEFA Power Setup app when selecting the operator, or
by another mechanism?

Best regards,
Jørn Watvedt
Kode15 AS (org.nr. 989 990 330)
