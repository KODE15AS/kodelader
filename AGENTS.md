# AGENTS.md — Kodelader

Instruksjoner til AI-agenter som jobber i dette repoet, uansett hvor de kjører
(Jørns desktop, raven eller annet). Levende prosjektstatus ligger i
[handover/HANDOVER.md](handover/HANDOVER.md) — les den først. Alle URL-er står
i lenketabellen øverst i [README.md](README.md).

## Arbeidsmodell og deploy

- **Koden KJØRER kun på raven** (Ubuntu-server, Tailscale-IP `100.65.19.39`,
  SSH-alias `raven` fra Jørns maskiner): én Docker-container, `~/dev/kodelader`,
  porter 8096 (offentlig via Tailscale Funnel `/kodelader`) og 8097 (admin, kun tailnett).
- **Git-remote er GitHub `KODE15AS/kodelader`** med push kun fra raven
  (SSH-identitet `git@github-kode15`). På Jørns Windows-maskin finnes ikke git —
  synk endringer med tar over SSH og commit på raven:
  1. `tar -cf kodelader-sync.tar <endrede filer>` (lokalt)
  2. `scp kodelader-sync.tar raven:/tmp/`
  3. På raven: pakk ut, `sed -i 's/\r$//'` på tekstfiler (CRLF-stripping er
     obligatorisk — Windows-filer har CRLF, repoet skal ha LF), kopier inn,
     `git add -A && git commit && git push`
  4. Deploy: `cd ~/dev/kodelader && docker compose up -d --build`
- Kjører du bash-kommandoer fra Windows PowerShell mot raven: unngå nestet
  quoting og `$` — skriv en `.sh`-fil (LF!) og kjør
  `Get-Content fil.sh -Raw | ssh raven "tr -d '\r' | bash"`.
- **Hemmeligheter ligger KUN i `.env` på raven** (aldri i repo). Sandkassenøkler
  for Nexi ligger bevart i `.env.bak-sandkasse-*` samme sted. Live-nøkler legges
  bare inn av Jørn (eller på hans eksplisitte instruks).

## Maskinvare

- Ladeenheten er en **Shelly Pro 3EM** (`shellypro3em-1c8f57034ae4`) på det
  isolerte KODE15-wifi-et (10.10.0.x, dynamisk IP — webgrensesnitt uten passord,
  akseptert risiko i test). Den kobler seg SELV utover til appen via Funnel
  (Outbound WebSocket) — **du trenger aldri nettverkstilgang til enheten**.
- Autonomi-scriptet (`app/device/kodelader-session.js`) installeres/oppdateres
  fra admin-UI-et eller `POST /api/devices/:id/script` — over WebSocket-forbindelsen.
- Simulert enhet for lokal testing: `device/simulator.mjs` (støtter samme RPC-er,
  inkl. KVS/Script og lokal autonomi).

## Betalingsstatus (per 2026-09-23 — sjekk HANDOVER for ferskere info)

- **Nexi/Nets Easy (`app/src/nexi.ts`):** avtale på live-MID 100009760, men
  **ikke reelt provisjonert** — Vipps feiler og kort vises ikke i skarp checkout.
  Supportsak hos ecom-no@nets.eu siden aug. 2026, ingen ETA. Månedsavgift
  (227,64 kr) løper — refusjonskrav vurderes. Sandkassen fungerer utmerket.
- **Vipps MobilePay ePayment (under etablering):** «Integrert betaling»-avtale
  bestilt 2026-09-23 på Kode15 AS for å manøvrere rundt Nexi-blokaden.
  Direkteintegrasjon: reservasjon → delvis capture → cancel frigjør rest
  (identisk med vår betalingsmodell). **`profile.scope: "phoneNumber"`** i
  create payment gir kundens mobilnummer med samtykke i appen
  (`userDetails.mobileNumber` i betalingsobjektet) — erstatter SMS-tasting og
  cookie-parring. Dokumentasjon: developer.vippsmobilepay.com (ePayment API).
  Vipps' «agent-toolkit»-plugin for AI-assistenter var tom/under utvikling
  per sept. 2026 — bruk de vanlige dokumentasjonssidene.
  Test: MT-miljøet (`apitest.vipps.no`) med Vipps MT-appen (TestFlight).

## Konvensjoner

- HANDOVER.md er levende spesifikasjon (Raven Norm 1): oppdater den i samme
  commit som funksjonelle endringer, med daterte overganger ved faseskifter.
- README skal ha `## Lenker`-tabellen oppdatert når endepunkter endres.
- Driftsparametre (pris, maksbeløp, øktslutt-regler) er innstillinger i SQLite,
  redigeres i admin — aldri hardkod dem.
- Web-UI følger KODE15-profilen (se `raven-platform/web-profil/` på raven).
- Norsk i all tekst: kode-kommentarer, commit-meldinger (uten æøå — bruk ae/oe/aa),
  UI-tekst og dokumentasjon.
