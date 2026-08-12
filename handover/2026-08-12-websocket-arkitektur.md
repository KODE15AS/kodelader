# 2026-08-12 — Maskinvare ankommet, arkitekturendring MQTT → WebSocket

Datert tillegg i henhold til Raven Norm 1.

## Hva skjedde

Etter 19 dagers pause (venting på maskinvare) ankom Shelly Pro 3EM og ble koblet på KODE15-wifi (`10.10.0.25`, id `shellypro3em-1c8f57034ae4`, fastvare 2.0.0).

Nettverkskartlegging avdekket at KODE15-wifi (10.10.0.x) og Raven (10.5.0.x) er
separate soner på samme brannmur, isolert **begge veier** (verifisert: Raven når ikke
Shelly, og Shelly når ikke Raven — testet med RPC `HTTP.GET` fra enheten selv).
Den opprinnelige planen (Mosquitto MQTT-broker på Raven, enheter kobler til via LAN)
krevde dermed en brannmurregel mellom sonene.

## Beslutning

Brannmuren driftes via Borg Commit, der endringer er dyre og tidkrevende.
Kommunikasjonen snus derfor: **Shelly Outbound WebSocket erstatter MQTT/Mosquitto.**

- Enheten kobler selv *utover* (HTTPS/443, allerede åpent) til appen via Tailscale
  Funnel: `wss://cadify104raven.tail14de1b.ts.net/kodelader/ws`
- Appen mottar målinger/hendelser og sender kommandoer over samme forbindelse (RPC begge veier)
- Mosquitto-containeren utgår, port 8097 frigis
- Mønsteret er identisk for alle fremtidige ladere på KODE15-wifi — null nettverks- eller brannmurarbeid per enhet, og det fungerer også fra helt andre lokasjoner

Konsekvens akseptert: styringen går via internett/Funnel, så nye økter kan ikke startes
ved internettbrudd (betaling krever uansett nett). Pågående økter er trygge — lokal
autonomi (maks kWh/tid, ferdig-deteksjon) ligger i Shelly-scriptet på enheten.

## Utført på enheten

- Outbound WebSocket konfigurert og verifisert (`Ws.GetConfig`: enable, riktig URL, `ca.pem`)
- Passord satt på enhetens nød-hotspot (AP)
- Adminpassord på webgrensesnittet bevisst IKKE satt ennå — akseptert risiko i testfasen, obligatorisk sjekkpunkt før produksjon

## Nytt designprinsipp

Driftsparametre (pris per kWh, maksbeløp, øktslutt-regler) skal være **innstillinger i
databasen**, ikke hardkodede verdier — redigerbare i et fremtidig admin-grensesnitt.
Standardverdier inntil videre: 5 kr/kWh, 200 kr maks, ferdig-deteksjon (< 100 W i 10 min),
makstid 12 timer.
