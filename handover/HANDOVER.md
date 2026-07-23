# HANDOVER — Kodelader

Levende spesifikasjon i henhold til Raven Norm 1: hvert punkt hukes av når det er levert.
Når alle punkter er levert, *er* dette dokumentet prosjektdokumentasjonen.

Datert overgang: **2026-07-23 — Fase 0 til Fase 1**

---

## Hvor vi står (fase 0 — fullført)

- [x] Prosjektbeskrivelse etablert: QR-aktivert elbil-lading med betaling, egen drift uten ladeoperatør
- [x] Betalingsleverandør avklart: Nets Easy / Nexi Checkout (EASY VIPPS + EASY CARD). Utilsiktet oppsigelse annullert, avtale gjenåpnet og omregistrert fra Widemore AS til Kode15 AS (org.nr. 989 990 330, Merchant ID 100009760)
- [x] Sandkasse-nøkler hentet fra Checkout-portalen (*Virksomhet → Integrasjon*) — oppbevares i `.env`, aldri i repo
- [x] Maskinvare valgt, dokumentert og bestilt: Shelly Pro 3EM 120A V2 + Switch Add-on + CHINT NCH8 25A/4P kontaktor (datablader og kompatibilitetssjekk i `docs/hardware/`)
- [x] Betalingsmodell besluttet: reservasjon av fast maksbeløp, trekk kun for faktisk ladet energi (kr/kWh)
- [x] Driftsplattform besluttet: Docker-stack på Raven etter plattformnormene (project.yaml, compose-labels, handover-katalog). Porter 8096 (app) og 8097 (Mosquitto) — 8091–8095 er tatt/reservert av prosjekt C og D
- [x] Offentlig HTTPS avklart: Tailscale Funnel på Raven (sti `/kodelader`, eksisterende Masskette-rute på `/` røres ikke). Raven har fast IP; eget domene/DNS kommer senere — alle URL-er konfigureres derfor via `BASE_URL`
- [x] SMS-varsling besluttet: Sveve, med to meldinger (start + ferdig med kvitteringslenke, 30 dagers gyldighet)

## Åpne punkter som ikke blokkerer fase 1

- [ ] Sveve-konto opprettes på sveve.no (SMS-integrasjonen bygges ferdig og aktiveres når API-brukernavn/passord foreligger)
- [ ] Avklare med elektriker: installasjon av kontaktor/kurs, forskriftskrav for uttak uten Mode 3-kommunikasjon (styrt stikkontakt / Mode 2)
- [ ] Eget domene/DNS mot Ravens faste IP (fase 3 — arkitekturen holder dette åpent i forhold til Tailscale)
- [ ] Nettverksplassering av fremtidige ladeenheter utenfor Raven-LAN (Shelly outbound WebSocket over Funnel eller VPN — fase 3)

## Plan for fase 1 — betalingsflyt, MQTT og SMS (uten maskinvare)

Mål: Hele kjeden fungerer ende-til-ende i Nexi-sandkassen med en **simulert** ladeenhet, slik at kun Shelly-scriptet gjenstår når maskinvaren ankommer.

### Kundeflyt som bygges

1. Skann QR → `BASE_URL/start?enhet=proto1&produkt=maks200`
2. Appen oppretter reservasjon hos Nexi og videresender rett til hosted checkout (Vipps app-switch / kort)
3. Webhook `payment.checkout.completed` → lading startes via MQTT → SMS 1: *«Elbil ladeøkt startet hos KODE15 as, og du får ny beskjed når ladingen er ferdig.»*
4. Øktslutt (grense nådd eller manuelt stopp) → delvis capture `min(maksbeløp, kWh × pris)` → SMS 2: *«Ladeøkten hos KODE15 as er ferdig, du har ladet xx kWh for Kr. yy. Flytt bilen om nødvendig for at andre skal kunne lade. Her er link til kvittering som vil være tilgjengelig i 30 dager: …»*

### Leveranser

- [ ] Raven-prosjektstruktur: `project.yaml`, `docker-compose.yml` (app + mosquitto, `raven.project`-labels), `app/Dockerfile`, `.env.example`
- [ ] Konfigmodell for enheter/produkter (flere QR-typer per enhet: fast maksbeløp og «velg maksbeløp»)
- [ ] `/start`: oppretter Nexi-betaling (reservasjon) og videresender til hosted checkout
- [ ] `/webhooks/nets`: autorisasjonsverifisering, ladestart via MQTT, SMS 1
- [ ] Mosquitto-container + MQTT-protokoll for kommandoer/hendelser, med simulert Shelly (`device/simulator.js`)
- [ ] Øktslutt-håndtering: delvis capture, frigivelse av rest-reservasjon, SMS 2 med kvitteringslenke
- [ ] Web: beløpsvalg-side, statusside med «Avslutt lading», kvitteringsside (30 dagers levetid, SQLite)
- [ ] Deploy på Raven: klone til `~/dev/kodelader`, `docker compose up -d --build`, Funnel-rute `/kodelader` → 8096
- [ ] Ende-til-ende-verifisering i sandkassen (se sjekkliste under)
- [ ] Utkast til Shelly-script (`device/kodelader-session.js`) — testes i fase 2 på testbenk

### Verifiseres i sandkassen

- [ ] Delvis capture + frigivelse av rest-reservasjon (spesielt for Vipps-betalinger)
- [ ] `payment.checkout.completed` leveres som forventet på avtalen
- [ ] Om Vipps kan testes i sandkassen eller må sluttestes live med småbeløp
- [ ] Mobilnummer følger med i webhook-payload (grunnlag for SMS)
- [ ] Funnel-rute `/kodelader` fungerer side om side med eksisterende ruter

## Fase 2 (når maskinvaren ankommer)

- [ ] Shelly Pro 3EM på testbenk: MQTT-tilkobling til Mosquitto, Switch Add-on → kontaktor
- [ ] Ekte kWh-måling inn i sesjons- og betalingslogikken
- [ ] Autonomitest: trekk nettverket midt i en økt — enheten skal slå av selv ved grense

## Fase 3 (produksjon)

- [ ] Live-nøkler (legges kun inn i `.env` på Raven av Jørn)
- [ ] QR-koder genereres og monteres på enheten
- [ ] Eget domene/DNS mot fast IP, `BASE_URL` byttes
- [ ] Driftslogg og enkel overvåking

---

*Praktisk: git/GitHub-arbeid for KODE15AS-repoer skjer på Raven via SSH (`git@github-kode15`). Utvikling skjer lokalt i Cursor med push til GitHub og pull/deploy på Raven.*
