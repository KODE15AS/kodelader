# Kodelader

Egenutviklet, skybasert elbil-ladesystem for KODE15 AS. Systemet lar ansatte, partnere og besøkende starte lading på bedriftens område via en enkel, mobilvennlig betalingsløsning — uten abonnement hos eksterne ladeoperatører.

Kunden skanner en QR-kode på laderen, betaler med Vipps eller kort, og strømmen kobles inn automatisk når betalingen er godkjent.

## Slik virker det

```
[ Kunde / mobil ] --(1. skanner QR)--> [ Web-app (Kode15 Cloud) ]
                                            |
                                    (2. oppretter betaling)
                                            v
[ Nexi Checkout (Vipps / kort) ] <--- Nets Easy Payment API
        |
(3. betaling godkjent — webhook: payment.checkout.completed)
        v
[ Skyfunksjon ] --(4. HTTP POST /rpc/Switch.Set)--> [ Shelly Pro 3EM ]
                                                          |
                                              (5. styrer kontaktor, måler kWh)
                                                          v
                                                  [ Ladeuttak 400V / 16A ]
```

Ved øktslutt (tid ute, bil full eller manuelt stopp) trekkes beløpet via `POST /v1/payments/{paymentId}/charges`, og eventuelt overskytende reservasjon frigjøres.

## Arkitektur — tre lag

| Lag | Komponent | Ansvar |
|---|---|---|
| **Skylaget** | Serverløs funksjon (Node.js) + web-app | Betalingsflyt mot Nets Easy (Nexi Checkout), webhook-mottak, sesjonsdata, kommando til Shelly |
| **Styringslaget** | Shelly Pro 3EM 120A V2 + Switch Add-on | Mottar kommandoer, måler energiforbruk (kWh) i sanntid, lokal sikkerhetslogikk |
| **Effektlaget** | CHINT NCH8 kontaktor (25A, 4-pol) | Fysisk inn-/utkobling av trefasestrøm (400V TN, maks 16A) |

Se [docs/hardware/komponentliste.md](docs/hardware/komponentliste.md) for full bestillingsliste med spesifikasjoner og datablader.

## Betaling

Betalingslaget bygges på **Nets Easy Payment API (Nexi Checkout)** med avtalene EASY VIPPS og EASY CARD — kunden kan altså betale med både Vipps og vanlig bankkort i samme checkout.

- API-nøkler (Secret Key / Checkout Key for test og live) hentes i [Easy-portalen](https://portal.dibspayment.eu) under *Company → Integration*
- Testmiljø: `https://test.api.dibspayment.eu` — produksjon: `https://api.dibspayment.eu`
- Webhooken `payment.checkout.completed` er triggeren som aktiverer laderen

## Sikkerhet

- **Ingen hemmeligheter i sikringsskapet:** API-nøkler ligger kun i skyfunksjonens miljøvariabler, aldri på maskinvaren
- **Lokal autonomi:** Shelly-enheten slår av laderen selv når maks kWh eller tid er nådd, også hvis internett faller ut under lading
- **Verifiserte webhooks:** Skyfunksjonen validerer autorisasjonsheaderen fra Nexi før laderen aktiveres

## Status og veien videre

Prosjektet er i oppstartsfasen:

1. Innkjøp av maskinvare til testbenk (Shelly Pro 3EM + kontaktor)
2. Reaktivering av Nets Easy-avtalen og henting av test-nøkler fra Easy-portalen
3. Utvikling av skyfunksjonen mot Nexi sitt sandkasse-miljø
4. Enhetskode for Shelly (scripting) og web-app for QR-landingssiden
