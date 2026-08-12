# HANDOVER — Kodelader

Levende spesifikasjon i henhold til Raven Norm 1: hvert punkt hukes av når det er levert.
Når alle punkter er levert, *er* dette dokumentet prosjektdokumentasjonen.

Daterte overganger:

- **2026-07-23 — Fase 0 til Fase 1** (oppstart)
- **2026-08-12 — Maskinvare ankommet, arkitekturendring MQTT → WebSocket** (se [2026-08-12-websocket-arkitektur.md](2026-08-12-websocket-arkitektur.md))

---

## Hvor vi står (fase 0 — fullført)

- [x] Prosjektbeskrivelse etablert: QR-aktivert elbil-lading med betaling, egen drift uten ladeoperatør
- [x] Betalingsleverandør avklart: Nets Easy / Nexi Checkout (EASY VIPPS + EASY CARD). Utilsiktet oppsigelse annullert, avtale gjenåpnet og omregistrert fra Widemore AS til Kode15 AS (org.nr. 989 990 330, Merchant ID 100009760)
- [x] Sandkasse-nøkler hentet fra Checkout-portalen (*Virksomhet → Integrasjon*) — oppbevares i `.env`, aldri i repo
- [x] Maskinvare valgt, dokumentert og bestilt: Shelly Pro 3EM 120A V2 + Switch Add-on + CHINT NCH8 25A/4P kontaktor (datablader og kompatibilitetssjekk i `docs/hardware/`)
- [x] Betalingsmodell besluttet: reservasjon av fast maksbeløp, trekk kun for faktisk ladet energi (kr/kWh)
- [x] Driftsplattform besluttet: Docker-stack på Raven etter plattformnormene (project.yaml, compose-labels, handover-katalog). Port 8096 (app) — 8091–8095 er tatt/reservert av prosjekt C og D
- [x] Offentlig HTTPS avklart: Tailscale Funnel på Raven (sti `/kodelader`, eksisterende Masskette-rute på `/` røres ikke). Raven har fast IP; eget domene/DNS kommer senere — alle URL-er konfigureres derfor via `BASE_URL`
- [x] SMS-varsling besluttet: Sveve, med to meldinger (start + ferdig med kvitteringslenke, 30 dagers gyldighet)

## Maskinvare og nettverk (2026-08-12)

- [x] Shelly Pro 3EM ankommet og på nett: `10.10.0.25` på KODE15-wifi (id `shellypro3em-1c8f57034ae4`, fastvare 2.0.0, trefase-profil)
- [x] Nettverkstopologi kartlagt: KODE15-wifi (10.10.0.x) og Raven (10.5.0.x) er separate soner på samme brannmur, isolert begge veier (verifisert med kall begge retninger)
- [x] **Arkitekturbeslutning: Shelly Outbound WebSocket erstatter MQTT/Mosquitto.** Brannmurendringer via Borg Commit er dyre/trege, så kommunikasjonen snus: enheten kobler selv utover (HTTPS/443) til appen via Funnel. Mosquitto-containeren utgår, port 8097 frigis. Alle fremtidige ladere på KODE15-wifi bruker samme mønster — null nettverksendringer per enhet
- [x] Outbound WebSocket konfigurert og verifisert på enheten: `wss://cadify104raven.tail14de1b.ts.net/kodelader/ws`, Default TLS (`ca.pem`). Melder tilkoblingsfeil til appen står klar — forventet
- [x] Passord satt på enhetens nød-hotspot (AP `ShellyPro3EM-1C8F57034AE4`)
- [x] **Akseptert risiko (testfase):** Adminpassord på webgrensesnittet er IKKE satt — alle på KODE15-wifi kan styre/omkonfigurere enheten. Sjekkpunkt: MÅ settes før produksjon (fase 3)

## Designprinsipp: driftsparametre er innstillinger (2026-08-12)

Pris, maksbeløp og øktslutt-regler skal IKKE hardkodes — de lagres i databasen og skal senere redigeres i et enkelt admin-grensesnitt (egen fase). Inntil admin-UI finnes gjelder disse standardverdiene:

| Innstilling | Standardverdi | Merknad |
|---|---|---|
| Pris per kWh | 5 kr | Justerbar per produkt |
| Maksbeløp (standard-QR «Start lading») | 200 kr | ~3,5 timer ved 11 kW |
| Ferdig-deteksjon | Effekt < 100 W i 10 min → avslutt | Kunden betaler aldri for tomgang |
| Makstid per økt | 12 timer | Sikkerhetsnett |

## Åpne punkter som ikke blokkerer fase 1

- [ ] Sveve-konto opprettes på sveve.no (SMS-integrasjonen bygges ferdig og aktiveres når API-brukernavn/passord foreligger)
- [ ] Avklare med elektriker: installasjon av kontaktor/kurs, forskriftskrav for uttak uten Mode 3-kommunikasjon (styrt stikkontakt / Mode 2)
- [ ] Eget domene/DNS mot Ravens faste IP (fase 3 — arkitekturen holder dette åpent i forhold til Tailscale)
- [ ] Fast DHCP-lease for Shelly-enheten (10.10.0.25 er dynamisk tildelt i dag)
- [ ] Admin-grensesnitt for innstillinger (pris, maksbeløp, øktslutt-regler) — egen fase etter fase 2

## Plan for fase 1 — betalingsflyt, WebSocket og SMS

Mål: Hele kjeden fungerer ende-til-ende i Nexi-sandkassen med en **simulert** ladeenhet, slik at kun Shelly-scriptet gjenstår før testbenken kan kjøre skarpt.

### Kundeflyt som bygges

1. Skann QR → `BASE_URL/start?enhet=proto1&produkt=maks200`
2. Appen oppretter reservasjon hos Nexi og videresender rett til hosted checkout (Vipps app-switch / kort)
3. Webhook `payment.checkout.completed` → startkommando over enhetens WebSocket-forbindelse → SMS 1: *«Elbil ladeøkt startet hos KODE15 as, og du får ny beskjed når ladingen er ferdig.»*
4. Øktslutt (ferdig-deteksjon, grense nådd eller manuelt stopp) → delvis capture `min(maksbeløp, kWh × pris)` → SMS 2: *«Ladeøkten hos KODE15 as er ferdig, du har ladet xx kWh for Kr. yy. Flytt bilen om nødvendig for at andre skal kunne lade. Her er link til kvittering som vil være tilgjengelig i 30 dager: …»*

### Leveranser

- [ ] Raven-prosjektstruktur: `project.yaml`, `docker-compose.yml` (kun app-container, `raven.project`-labels), `app/Dockerfile`, `.env.example`
- [ ] Innstillings- og konfigmodell: enheter/produkter i SQLite med standardverdiene over (flere QR-typer per enhet: fast maksbeløp og «velg maksbeløp»)
- [ ] `/start`: oppretter Nexi-betaling (reservasjon) og videresender til hosted checkout
- [ ] `/webhooks/nets`: autorisasjonsverifisering, ladestart via WebSocket, SMS 1
- [ ] WebSocket-endepunkt `/ws`: mottar enhetsforbindelser (Shelly outbound WS), RPC begge veier, gjenkjenning per enhets-ID
- [ ] Simulert Shelly (`device/simulator.js`) som kobler seg på `/ws` og oppfører seg som enheten
- [ ] Øktslutt-håndtering: ferdig-deteksjon, delvis capture, frigivelse av rest-reservasjon, SMS 2 med kvitteringslenke
- [ ] Web: beløpsvalg-side, statusside med «Avslutt lading», kvitteringsside (30 dagers levetid, SQLite)
- [ ] Deploy på Raven: klone til `~/dev/kodelader`, `docker compose up -d --build`, Funnel-rute `/kodelader` → 8096
- [ ] Ende-til-ende-verifisering i sandkassen (se sjekkliste under)
- [ ] Utkast til Shelly-script (`device/kodelader-session.js`) — kjører lokal autonomi (maks kWh/tid, ferdig-deteksjon) og WS-kommunikasjon

### Verifiseres i sandkassen

- [ ] Delvis capture + frigivelse av rest-reservasjon (spesielt for Vipps-betalinger)
- [ ] `payment.checkout.completed` leveres som forventet på avtalen
- [ ] Om Vipps kan testes i sandkassen eller må sluttestes live med småbeløp
- [ ] Mobilnummer følger med i webhook-payload (grunnlag for SMS)
- [ ] Funnel-rute `/kodelader` fungerer side om side med eksisterende ruter, inkludert WebSocket-oppgradering på `/kodelader/ws`
- [ ] Ekte Shelly kobler seg på `/ws` gjennom Funnel (enheten er allerede konfigurert og prøver kontinuerlig)

## Fase 2 (testbenk med ekte maskinvare)

- [ ] Switch Add-on + kontaktor koblet (elektriker), CT-er montert
- [ ] Shelly-script installert: ekte kWh-måling inn i sesjons- og betalingslogikken
- [ ] Autonomitest: trekk nettverket midt i en økt — enheten skal slå av selv ved grense

## Fase 3 (produksjon)

- [ ] Live-nøkler (legges kun inn i `.env` på Raven av Jørn)
- [ ] **Adminpassord på Shelly-enheten (akseptert risiko i test — obligatorisk før produksjon)**
- [ ] Fast DHCP-lease / dokumentert enhets-ID-register
- [ ] QR-koder genereres og monteres på enheten
- [ ] Eget domene/DNS mot fast IP, `BASE_URL` byttes (én innstilling i app + én i Shelly)
- [ ] Driftslogg og enkel overvåking
- [ ] Admin-grensesnitt for innstillinger

---

*Praktisk: git/GitHub-arbeid for KODE15AS-repoer skjer på Raven via SSH (`git@github-kode15`). Utvikling skjer lokalt i Cursor med push til GitHub og pull/deploy på Raven.*
