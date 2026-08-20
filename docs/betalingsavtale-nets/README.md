# Betalingsavtale — Nets Easy (Nexi Checkout)

Fakta om avtalen som betalingslaget bygger på. Fakturaer, e-poster og andre avtaledokumenter oppbevares **lokalt / utenfor repoet** (se `.gitignore`) siden repoet er offentlig.

## Avtalen

- **Avtaletype:** EASY BASE med produktene EASY CARD, EASY INVOICE, EASY INSTALLMENT og EASY VIPPS
- **Selskap:** Kode15 AS, org.nr. 989 990 330 — **Merchant ID 100009760**
- **Etablert:** desember 2019 (den gang Widemore AS — selskapet har senere skiftet navn til KODE15 AS, samme org.nr.)
- **Juli 2026:** utilsiktet oppsigelse reversert og avtalen omregistrert til Kode15 AS

## Etableringslogg

Speiler «Etablering»-fanen i admin-grensesnittet (lampene der er fasiten).

| Dato | Hendelse | Status |
|---|---|---|
| 2026-07-23 | Avtale gjenåpnet og omregistrert til Kode15 AS, sandkasse-nøkler hentet | ✅ |
| 2026-08-12 | Kortbetaling ende-til-ende i sandkassen (simulator): reservasjon → webhook → capture | ✅ |
| 2026-08-20 | Kortbetaling ende-til-ende på ekte maskinvare (benketest, varmeovn) | ✅ |
| 2026-08-20 | E-post til `ecom-no@nexigroup.com`: be om Vipps aktivert i **testmiljøet** på MID 100009760 — [PDF](2026-08-20-vipps-testaktivering-epost.pdf) | ✅ aktivert samme dag |
| 2026-08-20 | Vipps testet ende-til-ende med Vipps MT-appen (dummy-bruker +47 997 67 804, PIN 1236) | ✅ |
| — | Live-nøkler i `.env` på Raven + første skarpe betaling (fase 3) | ⬜ |

## Teknisk integrasjon

- **API:** Nets Easy Payment API (Nexi Checkout) — kunden kan betale med både Vipps og kort i samme checkout
- **Nøkler:** Secret Key og Checkout Key for test og live hentes i [Easy-portalen](https://portal.dibspayment.eu) under *Company → Integration*
- **Miljøer:** test `https://test.api.dibspayment.eu` — produksjon `https://api.dibspayment.eu`
- **Webhook-trigger for lading:** `payment.checkout.completed`
- **Trekk ved øktslutt:** `POST /v1/payments/{paymentId}/charges`
- **Begrensning (verifisert 2026-08-20):** Vipps deler ikke kundedata (mobilnummer) gjennom Nexi-checkouten — SMS-varsling er derfor valgfri via statussiden. Detaljer i [handover/HANDOVER.md](../../handover/HANDOVER.md)

API-nøkler skal aldri sjekkes inn i repoet — de ligger kun i `.env` på Raven (og lokalt hos utvikler).
