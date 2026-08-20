# HANDOVER — Kodelader

Levende spesifikasjon i henhold til Raven Norm 1: hvert punkt hukes av når det er levert.
Når alle punkter er levert, *er* dette dokumentet prosjektdokumentasjonen.

Daterte overganger:

- **2026-07-23 — Fase 0 til Fase 1** (oppstart)
- **2026-08-12 — Maskinvare ankommet, arkitekturendring MQTT → WebSocket** (se [2026-08-12-websocket-arkitektur.md](2026-08-12-websocket-arkitektur.md))
- **2026-08-12 — Fase 1 bygget og verifisert lokalt mot Nexi-sandkassen** (gjenstår: deploy på Raven + ekte betaling gjennom checkout)

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
- [x] **Arkitekturbeslutning: Shelly Outbound WebSocket erstatter MQTT/Mosquitto.** Brannmurendringer via Borg Commit er dyre/trege, så kommunikasjonen snus: enheten kobler selv utover (HTTPS/443) til appen via Funnel. Mosquitto-containeren utgår, port 8097 gjenbrukes til admin-grensesnittet (kun tailnett). Alle fremtidige ladere på KODE15-wifi bruker samme mønster — null nettverksendringer per enhet
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
- [x] ~~Admin-grensesnitt for innstillinger~~ — levert som del av fase 1 (se Web-UI under)

## Plan for fase 1 — betalingsflyt, WebSocket og SMS

Mål: Hele kjeden fungerer ende-til-ende i Nexi-sandkassen med en **simulert** ladeenhet, slik at kun Shelly-scriptet gjenstår før testbenken kan kjøre skarpt.

### Kundeflyt som bygges

1. Skann QR → `BASE_URL/start?enhet=proto1&produkt=kr100` (test-QR: `produkt=kr1`)
2. Appen oppretter reservasjon hos Nexi og videresender rett til hosted checkout (Vipps app-switch / kort)
3. Webhook `payment.checkout.completed` → startkommando over enhetens WebSocket-forbindelse → SMS 1: *«Elbil ladeøkt startet hos KODE15 as, og du får ny beskjed når ladingen er ferdig.»*
4. Øktslutt (ferdig-deteksjon, grense nådd eller manuelt stopp) → delvis capture `min(maksbeløp, kWh × pris)` → SMS 2: *«Ladeøkten hos KODE15 as er ferdig, du har ladet xx kWh for Kr. yy. Flytt bilen om nødvendig for at andre skal kunne lade. Her er link til kvittering som vil være tilgjengelig i 30 dager: …»*

### Leveranser

- [x] Raven-prosjektstruktur: `project.yaml`, `docker-compose.yml` (kun app-container, `raven.project`-labels), `app/Dockerfile`, `.env.example`
- [x] Innstillings- og konfigmodell: enheter/produkter i SQLite. To QR-produkter seedet for test: `kr1` (maks 1 kr) og `kr100` (maks 100 kr), begge 5 kr/kWh — redigerbare i admin
- [x] `/start`: oppretter Nexi-betaling (reservasjon) og videresender til hosted checkout
- [x] `/webhooks/nets`: autorisasjonsverifisering, ladestart via WebSocket, SMS 1
- [x] WebSocket-endepunkt `/ws`: mottar enhetsforbindelser (Shelly outbound WS), RPC begge veier, gjenkjenning per enhets-ID. Lytter på både `/ws` og `/kodelader/ws` siden Funnel-stistripping avklares ved deploy
- [x] Simulert Shelly (`device/simulator.mjs`) som kobler seg på `/ws` og oppfører seg som enheten (11 kW lading, «bil full»-modus for å teste ferdig-deteksjon)
- [x] Øktslutt-håndtering: ferdig-deteksjon, delvis capture (kansellering hvis 0 kWh), SMS 2 med kvitteringslenke
- [x] Web: brukerside (status + «Avslutt lading» + historikk), kvitteringsside og vilkårsside (30 dagers levetid, SQLite). *Beløpsvalg-siden utgikk — QR-koden bestemmer maksbeløpet direkte*
- [x] Utkast til Shelly-script (`device/kodelader-session.js`) — lokal autonomi (maks kWh/tid, ferdig-deteksjon) via KVS-grenser, testes i fase 2
- [x] QR-koder generert (`app/scripts/generate-qr.mjs` → `docs/qr/`) for proto1 kr1/kr100 + simulator
- [x] Deploy på Raven (2026-08-12): klonet til `~/dev/kodelader`, `docker compose up -d --build`, Funnel-rute `/kodelader` → 8096 lagt til uten å røre Masskette-ruta på `/`. Admin nås på tailnettet: `http://cadify104raven.tail14de1b.ts.net:8097`. `.env` kopiert manuelt (aldri i repo). **Lærdom:** Nexi krever webhook-autorisasjon på 8–32 alfanumeriske tegn — ellers HTTP 400 på create payment
- [x] **Ekte Shelly tilkoblet gjennom Funnel:** `shellypro3em-1c8f57034ae4` koblet seg på `/kodelader/ws` umiddelbart etter deploy og leverer målerdata (0 W — CT-er monteres i fase 2). Outbound WebSocket-arkitekturen er dermed verifisert ende-til-ende
- [ ] Ende-til-ende-verifisering i sandkassen (se sjekkliste under) — **gjenstår kun selve testbetalingen gjennom hosted checkout (krever menneske med testkort/Vipps)**

### Web-UI (bygget 2026-08-12)

Svelte 5 + Vite, KODE15-profil fra popina.no (Montserrat, benhvit `#F7F4EF`, mørk blågrå `#233038`, aksent `#BBAD9A`, navy `#263246`, nummererte seksjoner). To innganger i samme bygg:

- **Brukerside** (offentlig, port 8096, bak Funnel): lampestatus for laderen, aktiv økt med kWh/kostnad/effekt og «Avslutt lading», historikk med maskerte mobilnumre. Miljø-badge (SANDKASSE/SKARP) er alltid synlig
- **Adminside** (kun tailnett, port 8097 — gjenbrukes etter at Mosquitto utgikk): fire faner
  1. **Enheter** — lamper for online/kontaktor, effekt/målerstand, manuell PÅ/AV (testbenk)
  2. **Økter** — full historikk med mobilnumre i klartekst, stopp-knapp for aktive økter
  3. **Innstillinger** — pris/maksbeløp per QR-produkt, ferdig-terskel/-varighet, makstid
  4. **Etablering** — sjekkpunktliste for Vipps/Nexi-etableringen: automatiske lamper (nøkler, checkout, webhook, mobilnummer, capture, SMS, enhet-WS) som tennes av beviser i drift, manuelle bekreftelser (rest-frigivelse, Vipps-test, beløpskontroll, live-nøkler, Shelly-passord, DHCP-lease), «Test API-nøkler nå»-knapp og hendelseslogg

Admin har ingen egen innlogging — tilgangsstyringen ER tailnettet (dokumentert beslutning; revurderes hvis flere skal ha tilgang).

### Lokal verifisering 2026-08-12 (simulator + ekte Nexi-sandkasse)

Kjørt på utviklingsmaskin med appen på localhost og ekte test-API mot Nexi:

- `/start?enhet=sim1&produkt=kr1` → HTTP 302 til `test.checkout.dibspayment.eu` med ekte `paymentId` ✅ (nøkler + reservasjon virker)
- Simulert webhook med riktig Authorization-header → økt aktiv, kontaktor PÅ i simulatoren, SMS 1-tekst logget ✅
- Ferdig-deteksjon: simulator falt til 50 W etter 0,03 kWh → økten avsluttet automatisk med årsak «bilen er ferdig ladet», 18 øre korrekt beregnet (0,037 kWh × 5 kr) ✅
- Capture ga forventet HTTP 402 (checkouten ble aldri reelt betalt — ingen reservasjon å trekke fra); feilen ble ryddig logget og økten merket `capture_failed` ✅
- Kvitteringsside og SMS 2-tekst (med kvitteringslenke) korrekt ✅

Reell capture og rest-frigivelse kan først verifiseres med en ekte testbetaling gjennom hosted checkout (testkort/Vipps) etter deploy — sjekklisten under.

### Verifiseres i sandkassen

- [ ] Delvis capture + frigivelse av rest-reservasjon (spesielt for Vipps-betalinger)
- [ ] `payment.checkout.completed` leveres som forventet på avtalen
- [ ] Om Vipps kan testes i sandkassen eller må sluttestes live med småbeløp
- [ ] Mobilnummer følger med i webhook-payload (grunnlag for SMS)
- [ ] Funnel-rute `/kodelader` fungerer side om side med eksisterende ruter, inkludert WebSocket-oppgradering på `/kodelader/ws`
- [ ] Ekte Shelly kobler seg på `/ws` gjennom Funnel (enheten er allerede konfigurert og prøver kontinuerlig)

## Fase 2 (testbenk med ekte maskinvare)

### Benketest énfas 230 V gjennomført (2026-08-19/20)

Prøveoppkobling med varmeovn (~1,8 kW) som last, dokumentert i
[docs/hardware/testoppkobling-230v.md](../docs/hardware/testoppkobling-230v.md):

- [x] Switch Add-on montert på Pro 3EM og aktivert (Add-on-type «Switch» + Switch-peripheral lagt til i Shelly-UI — begge steg kreves før `switch:100` finnes)
- [x] Kontaktor styrt fra admin-UI over WebSocket (PÅ/AV verifisert flere ganger)
- [x] Ekte kWh-måling inn i appen: spenning på klemme **C** + CT **C** på samme fase (spenning og CT må være på samme kanal, ellers 0 W)
- [x] **Full ende-til-ende på ekte maskinvare:** QR → Nexi-checkout (testkort) → webhook → kontaktor inn → varmeovn på 1776 W → «Avslutt lading» → kontaktor ut → capture 78 øre for 0,156 kWh, rest frigitt → kvittering
- [x] Auto-avslutning ved maksbeløp verifisert på ekte last (testpris 30 kr/kWh for hurtigtest)
- [x] Prislås verifisert: prisendring i admin påvirker ikke pågående økt, kun nye
- [x] Forbedring etter test: 5 s måletakt + ferskeste WS-måling i `/api/state` for jevn beløpsvisning (før: 15 s tick ga synlige hopp ved høy pris)

### Vipps verifisert i sandkassen (2026-08-20)

Nexi-support aktiverte Vipps på test-MID 100009760 samme dag som forespørselen ble sendt.
Testet ende-til-ende med Vipps MT-appen (TestFlight) og delt testbruker: QR → Vipps i checkout →
godkjenning i MT-appen → lading → auto-avslutning ved maksbeløp → full capture. Funn:

- **Vipps deler IKKE kundedata gjennom Nexi-checkouten.** Mobilnummeret kunden oppgir i
  Vipps-steget brukes kun til å rute betalingen. Med skjult checkout-skjema
  (`merchantHandlesConsumerData: true`) er betalingsobjektets consumer-data helt tomme
  (verifisert med GET /v1/payments). Med synlig skjema kommer nummeret fra det kunden
  *taster i skjemaet* — heller ikke da fra Vipps-profilen
- **Valgt løsning:** checkout-skjemaet holdes skjult (ren flyt, innstilling i admin), og SMS-varsling
  er **valgfri**: kunden kan oppgi mobilnummer på statussiden etter betaling. Ryddig personvernmessig
- **Fremtidig mulighet (fase 4+):** Vipps' egen ePayment API med «profile sharing» gir mobilnummer
  automatisk med kundens samtykke i appen — krever egen Vipps-avtale og et parallelt betalingsløp
  ved siden av Nexi. Vurderes hvis frivillig SMS-andel viser seg for lav i drift
- **Fremtidig mulighet (finpuss, fase 3/4):** Sveve **kodeord** for innkommende SMS
  (150 kr/mnd + 500 kr etablering, kortnummer f.eks. 27333). Statussiden viser en ferdig utfylt
  `sms:`-lenke («KODELADER» til kortnummeret) — kunden trykker send, Sveve videresender til
  vårt webhook med avsenderens nummer, vi matcher mot aktiv økt. To trykk, null tasting,
  verifisert nummer, helt uten Nets/Vipps. Krever ett nytt endepunkt i appen

### Gjenstår i fase 2
- [ ] Trefaseinstallasjon 400 V TN med elektriker (CT på alle tre faser, kontaktorens fire poler)
- [ ] Shelly-script installert: lokal autonomi med KVS-grenser
- [ ] Autonomitest: trekk nettverket midt i en økt — enheten skal slå av selv ved grense

## Fase 3 (produksjon)

- [ ] Live-nøkler (legges kun inn i `.env` på Raven av Jørn)
- [ ] **Adminpassord på Shelly-enheten (akseptert risiko i test — obligatorisk før produksjon)**
- [ ] Fast DHCP-lease / dokumentert enhets-ID-register
- [ ] QR-koder regenereres med endelig domene og monteres på enheten
- [ ] Eget domene/DNS mot fast IP, `BASE_URL` byttes (én innstilling i app + én i Shelly)
- [ ] Driftslogg og enkel overvåking
- [ ] Admin-grensesnitt for innstillinger

---

*Praktisk: git/GitHub-arbeid for KODE15AS-repoer skjer på Raven via SSH (`git@github-kode15`). Utvikling skjer lokalt i Cursor med push til GitHub og pull/deploy på Raven.*
