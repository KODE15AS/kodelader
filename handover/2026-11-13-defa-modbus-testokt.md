# 13.11.2026: DEFA Modbus-testøkt med bilsimulator — håndheving død i fastvaren

Heldagstest fra Studio-flaten `defa-13-nov/elbil-simulator-og-modbus-test`
(web-UI med live registerlesing/skriving, bygget av flate-agenten) med
fysisk bilsimulator vekselvis på DEFA 1 (10.10.0.16) og DEFA 2
(10.10.0.21). Begge laderne hadde Load balancing → Modbus PÅ i DEFA
Power Setup-appen (verifisert likt oppsett).

## Hovedfunn: Modbus-tjenesten er et dødt speil

Tjenesten svarer på port 502, registre kan leses og skrives og leses
tilbake korrekt — men den er IKKE koblet til ladelogikken:

1. **Måle- og statusregistrene (293–306, 302) står alltid på
   standardverdiene (0)** — også under aktiv lading (LED + display viste
   lading i 13+ min; alle registre 0). MAC-ene verifisert mot fasiten,
   riktig boks, riktig blokklesing (samme mønster som 29.10/05.11 —
   zeros den gang var «i ro» og dermed aldri skilt fra defaults).
2. **eMS-grensene håndheves ikke.** 0 A-grense (reg 2000) med aktivt
   hjerteslag (reg 2008 hvert 10. s) i 40 s: ladingen fortsatte
   uanfektet. Testet på DEFA 2; DEFA 1 ladet tilsvarende fritt med
   fallback 0 og uten hjerteslag.
3. **Fellende bevis — omstart:** strømkutt av DEFA 2 med simulator
   tilkoblet. Ved oppstart sto eMS=0/fallback=0 — protokolldokumentet
   sier fallback-default 0 skal «prevent charging until the value is
   overwritten». Laderen gikk likevel RETT på lading. Ladelogikken
   konsulterer aldri Modbus-verdiene.

## Sluttbevis med ekte bil (16:22)

Tesla Model 3 på DEFA 2: lader **4,3 kW** (vist i bilen) mens ALLE
Modbus-registre leser 0 (status, fasestrøm, effekt) — to minutters
kontinuerlig overvåking. 4,3 kW ≈ 6 A per fase (400 V trefase) =
nøyaktig fallback-strømmen satt i appen. Tolkning: laderen står i
lastbalanseringsmodus «master borte → fallback» og håndhever APPENS
6 A-verdi, men ser aldri Modbus-skrivingene våre (eMS=0/fallback=0 i
registrene skulle ellers blokkert) og mater ingen måledata tilbake.
Modbus-register-veien er frakoblet i BEGGE retninger; app-nivåets
lastbalansering virker.

## Identitetsoppklaring (17:58) — og renere sluttbevis

Under kveldens omrigg (én lader ute til Tesla, én koblet vekk) viste det
seg at boksene var FORVEKSLET: boksen som lader Teslaen er
**56101410M** («DEFA 1», 10.10.0.16) — verifisert trippelt med SN i
Setup-appen (Bluetooth), MAC og IP. Den var på wifi hele tiden; jakten
på 54C00W10M (koblet vekk) var mot feil boks. Nytt wifi-AP
(«ap650-ute-kode15», TP-Link/Omada på 10.10.0.10, samme SSID KODE15
2,4+5 GHz) står uansett riktig rigget for uteplassen.

Renere sluttmåling: 56101410M, sterkt wifi, Tesla ladende 6 A —
registrene serverer fortsatt kun nuller. Konklusjonen står uten
identitets-forbehold. Lærdom: merk boksene fysisk (SN-lapp) og få
utført DHCP-reservasjonene (fortigate-ordren) før neste økt.

## Verifisert underveis (virker)

- Skriving funksjon 16 til 2000/2004/2008/2012, lesing tilbake med
  funksjon 3 — alt konsistent, verdier overlever til de overskrives.
- App-endringer (Load balancing-verdiene) synes i registrene — appen og
  Modbus deler konfiglager.
- Protokoll-PDF-en (des. 2025) bekrefter adressene og funksjonskodene
  vi bruker; «one master»-regelen og blokklesemønsteret står fast.

## Driftslærdom

- Samtidige mastere (flate-backend + ad-hoc-lesing fra raven) ga
  sporadiske «forbindelsen ble lukket» men ingen varig blokkering;
  likevel: hold ÉN master (protokollkravet).
- Verdier under 6000 mA i reg 2000 er under IEC 61851-minimum og må
  behandles som «ingen lading» i UI-er.

## Neste steg

1. Jørn: sjekk fastvareversjon/oppdatering i DEFA Power-appen.
2. Spørsmål til DEFA evsupport (utkast nederst i
   `docs/defa-epost-utkast.md`): hvorfor håndheves ikke eMS-registrene,
   og hvorfor serverer status-/måleregistrene kun defaults — hvilken
   fastvare/konfig kreves?
3. Flate-prosjektets web-UI (Vite-plugin + rå Modbus-klient i
   JS) er verdt å berge hit ved prosjektslutt — den er et komplett
   testverktøy for laderne.
