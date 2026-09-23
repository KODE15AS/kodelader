# Vipps MobilePay — direkteintegrasjon (ePayment API)

Arbeidsdokument for overgangen fra Nexi Checkout til Vipps MobilePay direkte.
Bakgrunn og beslutning: se datert overgang 2026-09-23 i
[handover/HANDOVER.md](../../handover/HANDOVER.md). Avtale «Integrert betaling»
bestilt 2026-09-23 på Kode15 AS via portal.vipps.no.

## Miljøer

| Miljø | API-base | App |
|---|---|---|
| Test (MT) | `https://apitest.vipps.no` | Vipps MT-appen (TestFlight) |
| Produksjon | `https://api.vipps.no` | Vanlig Vipps-app |

## Testbrukere (MT-miljøet)

Opprettet i portalen 2026-09-23 (Utvikler → Testbrukere). Brukes KUN i
testmiljøet — logg inn i Vipps MT-appen med telefonnummeret.

| Fødselsnummer | Telefonnummer | Fødselsdato |
|---|---|---|
| 01073639995 | 905 92 784 | 01.07.1936 |
| 04100193723 | 456 49 540 | 04.10.2001 |

Flere kan opprettes i portalen under Utvikler → Testbrukere (valgfri fødselsdato).

## API-nøkler

Fire verdier per salgsenhet, hentes i portalen under Utvikler → API-nøkler
(egen fane for testmiljø): `client_id`, `client_secret`,
`Ocp-Apim-Subscription-Key` og `Merchant-Serial-Number` (MSN).

**Nøklene ligger KUN i `.env` på raven** (aldri i repo, aldri i frontend-kode,
aldri i logger). Jf. Vipps' egne AI-regler:
https://developer.vippsmobilepay.com/docs/knowledge-base/ai-tools.md

Access token hentes med `POST /accesstoken/get` (nøklene som headere) og brukes
som Bearer-token i alle videre kall.

## Webhooks

Webhooks registreres via API (ikke i portalen):

1. `POST /webhooks/v1/webhooks` med Bearer-token, `Ocp-Apim-Subscription-Key`
   og `Merchant-Serial-Number` som headere, og body
   `{"url": "<callback-URL>", "events": [ ... ]}`.
2. Svaret inneholder `id` og en **`secret`** — den vises bare ved registrering
   og MÅ lagres i `.env` på raven (mistes den, må webhooken erstattes).
3. Registrerte webhooks kan listes med `GET /webhooks/v1/webhooks`.

Relevante hendelser for kodelader (ePayment):

| Hendelse | Bruk hos oss |
|---|---|
| `epayments.payment.authorized.v1` | Kunden godkjente i appen → aktiver ladeøkten |
| `epayments.payment.aborted.v1` | Kunden avbrøt → rydd bort ventende økt |
| `epayments.payment.expired.v1` | Betalingen løp ut → rydd bort ventende økt |
| `epayments.payment.cancelled.v1` | Reservasjon frigitt (vår cancel) — kvittering på logg |
| `epayments.payment.captured.v1` | Delvis capture bekreftet — kvittering på logg |

(Payload: `msn`, `reference`, `pspReference`, `name`, `amount`, `timestamp`,
`idempotencyKey`, `success`.)

### Validering av innkommende webhook (HMAC)

Hver hendelse kommer som POST med headerne `x-ms-date`, `x-ms-content-sha256`
og `Authorization`. Valider slik (Node-krypto, se
https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/request-authentication.md):

1. SHA-256-hash av rå body, base64 → skal være lik `x-ms-content-sha256`.
2. Signer strengen `POST\n<pathAndQuery>\n<x-ms-date>;<host>;<contentHash>`
   med HMAC-SHA256 og webhook-`secret`, base64 → skal være lik Signature-delen
   av `Authorization`-headeren.

NB: `<host>` og `<pathAndQuery>` er slik Vipps ser dem — med Tailscale Funnel
er det Funnel-hostnavnet og stien med `/kodelader`-prefiks. Bruk rå body
(før JSON-parsing) i hashen.

## Drift og rapportering (for Kode15-administrator)

Manuelt i portalen (portal.vipps.no): **Transaksjoner** (enkeltbetalinger),
**Rapporter** (oppgjør/regnskap) og **Innsikt** (salgsoversikt).

Programmatisk — skal VURDERES hentet inn i egne admin-sider (port 8097) så
daglig drift ikke krever portalinnlogging:

- **Report API** (https://developer.vippsmobilepay.com/docs/APIs/report-api/):
  oppgjørsdata, transaksjonsrapporter og hendelseshistorikk. Tilgjengelig for
  ePayment-brukersteder med de samme salgsenhet-nøklene som betalingsflyten —
  ingen egen avtale trengs.
- **ePayment API:** `GET /epayment/v1/payments/{reference}` (detaljer/status
  per betaling) og `GET .../{reference}/events` (hendelseslogg) for
  feilsøking per økt fra admin.
- Merk: kodeladerens egen SQLite er fortsatt primærkilden for økter/kWh —
  Vipps-dataene er betalings-/oppgjørssiden av samme historie, koblet på
  `reference`.

## Dokumentasjon

- Indeks for AI-agenter: https://developer.vippsmobilepay.com/llms.txt
- ePayment API: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/
- Webhooks quick start: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/quick-start.md
- Hendelsestyper: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/events.md
- Agent-toolkit (plain markdown-skills): https://github.com/vippsas/agent-toolkit/blob/main/plugins/vipps-developer/README.md

## Status

- [x] Avtale bestilt (2026-09-23), portal-tilgang OK, testbrukere opprettet
- [x] Salgsvilkår publisert på kode15.no/salgsvilkaar (Vipps-krav til nettside)
- [x] Test-API-nøkler (MSN 542851, salgssted «KODE15 as - kontordeling Rakkestad»)
      lagt i `.env` på raven 2026-09-23 og verifisert mot accesstoken-endepunktet
      (HTTP 200). Repoet er offentlig — nøkler kun i `.env` på raven, sekundærkopi
      på Jørns PC utenfor repoet
- [ ] «Integrert betaling»-søknaden mottatt hos Vipps 2026-09-23, oppgitt
      behandlingstid **2–3 uker**. Produksjons-MSN blir **1165947** (NB: test-MSN
      er 542851 — to forskjellige salgsenhets-ID-er, ikke bland dem).
      Testmiljøet er aktivt allerede — MT-testing blokkeres ikke av søknaden
- [x] `app/src/vipps.ts` bygget og deployet 2026-09-23: accesstoken (cache),
      create payment (med `profile.scope: "phoneNumber"`), webhook-mottak med
      HMAC-validering, delvis capture (stabil idempotency-nøkkel per økt), cancel.
      Leverandørbryter: `PAYMENT_PROVIDER` i `.env` (payments.ts-fasade, nexi beholdt)
- [x] Webhook registrert (id 2946196c, alle epayments-hendelser) mot
      `…/kodelader/webhooks/vipps` — secret i `.env`. Røyktest grønn:
      create 201 → pay-mt.vipps.no, CREATED-webhook HMAC-verifisert gjennom Funnel
- [ ] Ende-til-ende-test i MT: FØRSTE betaling må godkjennes manuelt i Vipps
      MT-appen (logg inn med testbruker over) — deretter kan
      `POST /epayment/v1/test/payments/{reference}/approve` brukes for automatisk
      godkjenning i senere tester
- [ ] Skarp aktivering (avventer KYC/godkjenning fra Vipps)
