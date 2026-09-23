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

## Dokumentasjon

- Indeks for AI-agenter: https://developer.vippsmobilepay.com/llms.txt
- ePayment API: https://developer.vippsmobilepay.com/docs/APIs/epayment-api/
- Webhooks quick start: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/quick-start.md
- Hendelsestyper: https://developer.vippsmobilepay.com/docs/APIs/webhooks-api/events.md
- Agent-toolkit (plain markdown-skills): https://github.com/vippsas/agent-toolkit/blob/main/plugins/vipps-developer/README.md

## Status

- [x] Avtale bestilt (2026-09-23), portal-tilgang OK, testbrukere opprettet
- [x] Salgsvilkår publisert på kode15.no/salgsvilkaar (Vipps-krav til nettside)
- [ ] Test-API-nøkler hentet fra portalen og lagt i `.env` på raven
- [ ] `app/src/vipps.ts`: accesstoken, create payment (med `profile.scope:
      "phoneNumber"`), webhook-mottak med HMAC-validering, delvis capture, cancel
- [ ] Ende-til-ende-test i MT med testbruker og Vipps MT-appen
- [ ] Skarp aktivering (avventer KYC/godkjenning fra Vipps)
