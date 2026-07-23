# Kodelader

Egenutviklet elbil-ladesystem for KODE15 AS, driftet på selskapets egen server (Raven) som Docker-stack. Systemet lar ansatte, partnere og besøkende starte lading på bedriftens område ved å skanne en QR-kode og betale med Vipps eller kort — uten abonnement hos eksterne ladeoperatører.

**Betalingsmodell:** Kunden reserverer et fast maksbeløp ved start, men trekkes kun for faktisk ladet energi (kr/kWh) ved øktslutt.

## Slik virker det

```
[ Kunde / mobil ] --(1. skanner QR)--> [ kodelader-app (Docker på Raven) ]
                                            |
                                    (2. oppretter reservasjon)
                                            v
[ Nexi Checkout (Vipps / kort) ] <--- Nets Easy Payment API
        |
(3. betaling godkjent — webhook: payment.checkout.completed)
        v
[ kodelader-app ] --(4. MQTT-kommando via Mosquitto)--> [ Shelly Pro 3EM ]
        |                                                     |
   (SMS 1: "ladeøkt startet")                     (5. styrer kontaktor, måler kWh)
        |                                                     |
        v                                                     v
[ Sveve SMS-API ]                                     [ Ladeuttak 400V / 16A ]
```

Ved øktslutt (maks kWh/tid nådd, eller manuelt stopp) melder Shelly-scriptet forbrukt energi tilbake via MQTT. Appen trekker `min(maksbeløp, kWh × pris)` via `POST /v1/payments/{paymentId}/charges`, frigjør resten av reservasjonen, og sender SMS med kvitteringslenke (gyldig i 30 dager).

## Arkitektur

| Lag | Komponent | Ansvar |
|---|---|---|
| **Applikasjon** | Node.js/TypeScript i Docker på Raven (port 8096) | QR-landing, betalingsflyt mot Nexi, webhook-mottak, sesjoner (SQLite), SMS via Sveve |
| **Meldingsbuss** | Mosquitto MQTT-broker i Docker (port 8097) | Kommandoer til og hendelser fra ladeenhetene |
| **Styring** | Shelly Pro 3EM 120A V2 + Switch Add-on (Shelly-script) | kWh-måling, kontaktorstyring, lokal autonomi (slår av selv ved grense — også uten nett) |
| **Effekt** | CHINT NCH8 kontaktor (25A, 4-pol) | Fysisk inn-/utkobling av trefasestrøm (400V TN, maks 16A) |

- **Offentlig HTTPS** (for QR-URL-er og Nexi-webhooks) går i dag via Tailscale Funnel på Raven. Raven har fast IP, og eget domene/DNS er planlagt — derfor er alle URL-er konfigurert via én `BASE_URL`-miljøvariabel.
- **Flerenhetsmodell:** Hver QR-kode er en URL med `enhet`- og `produkt`-parametre. Én enhet kan ha flere QR-koder (f.eks. «Start lading» med fast maksbeløp, eller «Velg maksbeløp» med beløpsvalg). Nye ladeenheter legges til i konfigurasjonen uten arkitekturendringer.
- **Ingen omflashing:** Shelly-enheten kjører original fastvare med et innebygd JavaScript (Shelly Scripting) — RPC-API, OTA og garanti beholdes.

Se [docs/hardware/komponentliste.md](docs/hardware/komponentliste.md) for bestillingsliste med spesifikasjoner og datablader, og [handover/HANDOVER.md](handover/HANDOVER.md) for prosjektstatus og fase-plan.

## Betaling

Betalingslaget bygger på **Nets Easy Payment API (Nexi Checkout)** med avtalene EASY VIPPS og EASY CARD — kunden kan betale med både Vipps og vanlig bankkort i samme checkout.

- API-nøkler (Secret Key / Checkout Key for test og live) hentes i [Checkout-portalen](https://portal.dibspayment.eu) under *Virksomhet → Integrasjon*
- Testmiljø: `https://test.api.dibspayment.eu` — produksjon: `https://api.dibspayment.eu`
- Webhooken `payment.checkout.completed` er triggeren som aktiverer laderen; kundens mobilnummer (fra Vipps-profilen) følger med og brukes til SMS-varsling
- Paylink/One-Page-Shop benyttes ikke (krever tilleggsavtale, og One-Page-Shop mangler Vipps) — appen videresender direkte til hosted checkout

## Sikkerhet

- **Ingen hemmeligheter i sikringsskapet:** API-nøkler ligger kun i `.env` på Raven (aldri i repoet — se `.gitignore`)
- **Lokal autonomi:** Shelly-enheten slår av laderen selv når maks kWh eller tid er nådd, også hvis internett faller ut under lading
- **Verifiserte webhooks:** Appen validerer autorisasjonsheaderen fra Nexi før laderen aktiveres
- **Personvern:** Mobilnummer brukes kun til status-/kvitterings-SMS for kjøpet og slettes sammen med sesjonsdataene etter 30 dager

## Status og veien videre

- **Fase 0 (fullført):** Prosjektbeskrivelse, komponentvalg og innkjøp, gjenåpnet Nets-avtale (nå registrert på Kode15 AS), sandkasse-nøkler hentet, arkitektur besluttet
- **Fase 1 (pågår):** Betalingsflyt, MQTT, SMS og simulert lader — bygges og testes i sandkassen på Raven før maskinvaren ankommer
- **Fase 2:** Enhetsintegrasjon på testbenk (Shelly-script, ekte kWh-måling, autonomitesting)
- **Fase 3:** Produksjonssetting med live-nøkler, QR-koder, eget domene/DNS

Detaljert fase-plan: [handover/HANDOVER.md](handover/HANDOVER.md)
