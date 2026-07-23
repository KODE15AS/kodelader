# Betalingsavtale — Nets Easy (Nexi Checkout)

Fakta om avtalen som betalingslaget bygger på. Selve fakturaen og andre avtaledokumenter oppbevares **lokalt / utenfor repoet** (se `.gitignore`) siden repoet er offentlig.

## Avtalen

- **Avtaletype:** EASY BASE med produktene EASY CARD, EASY INVOICE, EASY INSTALLMENT og EASY VIPPS
- **Etablert:** desember 2019 (den gang Widemore AS — selskapet har senere skiftet navn til KODE15 AS, samme org.nr.)
- **Status (juli 2026):** dialog med Nets om å reversere en utilsiktet oppsigelse av avtalen

## Teknisk integrasjon

- **API:** Nets Easy Payment API (Nexi Checkout) — kunden kan betale med både Vipps og kort i samme checkout
- **Nøkler:** Secret Key og Checkout Key for test og live hentes i [Easy-portalen](https://portal.dibspayment.eu) under *Company → Integration*
- **Miljøer:** test `https://test.api.dibspayment.eu` — produksjon `https://api.dibspayment.eu`
- **Webhook-trigger for lading:** `payment.checkout.completed`
- **Trekk ved øktslutt:** `POST /v1/payments/{paymentId}/charges`

API-nøkler skal aldri sjekkes inn i repoet — de ligger kun i skyfunksjonens miljøvariabler.
