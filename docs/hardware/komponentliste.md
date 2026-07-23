# Komponentliste — testbenk / prototype

Basert på databladene i denne mappen. All kjerneelektronikk monteres på DIN-skinne i sikringsskap, på en egen 16A trefasekurs (400V TN). **Installasjon skal utføres av kvalifisert elektriker.**

## Bestillingsliste

| # | Komponent | Art.nr / EAN | Rolle | Datablad |
|---|---|---|---|---|
| 1 | Shelly Pro 3EM 120A V2 | EAN 3800238073862 | Energimåler + hjerne (styringslaget) | [PDF](shelly-pro-3em-120a-v2-datablad.pdf) |
| 2 | Shelly Pro 3EM Switch Add-on | — | Potensialfri styrekontakt for kontaktorspolen | [PDF](shelly-pro-3em-switch-addon-datablad.pdf) |
| 3 | CHINT NCH8 modulærkontaktor 25A 4-pol 230V 4NO | Cenika CV022453 (2 moduler) | Effektlaget — kobler trefasestrømmen | [FDV](chint-nch8-kontaktor-fdv.pdf) |

## Nøkkelspesifikasjoner

**Shelly Pro 3EM 120A V2** (trefase energimåler)
- Måling: 3-fase, 4-kvadrant via strømtransformatorer (CT), 0–120 A per fase
- Nøyaktighet: klasse B (IEC 62053-21), ±1 %
- Datalagring: minst 45 dager i 1-minutts intervaller, eksport som CSV eller via RPC
- Tilkobling: Wi-Fi 2,4 GHz, Ethernet (RJ45), Bluetooth 4.2 — protokoller: MQTT, Modbus TCP, Matter-ready
- **Merk: ingen innebygd relé** — lokal kontaktorstyring krever Switch Add-on (komponent 2)
- Anbefalt forankoblet vern: 16 A, B/C-karakteristikk, 6 kA

**Shelly Pro 3EM Switch Add-on**
- Galvanisk skilt, potensialfri relékontakt: maks 240 VAC / 2 A
- Festes direkte på Pro 3EM (pins i header), felles DIN-brakett følger med
- Strømforsyning fra Pro 3EM-enheten (< 1 W)

**CHINT NCH8 kontaktor (25A, 4-pol, 230V-spole, 4NO)**
- Lasttype AC-1 / AC-7a / AC-7b, Ue = 230/400 V, IEC/EN 61095
- Spoleforbruk < 10 W
- Levetid: 6 000 elektriske / 30 000 mekaniske koblinger
- FDV: funksjonstest og kontroll mot varmegang ca. én gang per år

## Kompatibilitetssjekk

- Add-on-kontakten (maks 2 A / 240 VAC) styrer NCH8-spolen (< 10 W ≈ 0,04 A) — margin > 40×
- 25 A-kontaktor på 16 A-kurs — solid sikkerhetsmargin, i tråd med prosjektbeskrivelsen
- 6 000 elektriske koblinger ≈ flere tusen ladeøkter (én inn-/utkobling per økt) — tilstrekkelig for formålet
- CT-måling på alle tre faser gir kWh-grunnlaget for betalings-/sesjonslogikken

## Aktuelle forhandlere (pr. 2026)

- **Kjell & Company** — Shelly Pro-serien og add-ons
- **Elektroimportøren** — Shelly-moduler og CHINT/Cenika el-materiell
- **Proshop / Smarthuset** — smarthuskomponenter, Shelly hovedenheter og add-ons
