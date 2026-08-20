# Prøveoppkobling — énfas 230 V med varmeovn som last

Formål: verifisere hele kjeden (Shelly Pro 3EM + Switch Add-on + CHINT NCH8-kontaktor +
app/betaling) på benk med énfas 230 V og en varmeovn som last, før elektriker monterer
trefaseinstallasjonen (400 V TN, 16 A).

**⚠️ Nettilkobling skal gjøres spenningsløst og kontrolleres av kvalifisert person
(krav i databladene). Bruk kurs med jordfeilbryter, 10–16 A.**

Alle tre komponentene er verifisert kompatible med énfas 230 V:

| Komponent | Grense | Kilde |
|---|---|---|
| Shelly Pro 3EM strømforsyning | 100–260 V~ 50/60 Hz | [datablad](shelly-pro-3em-120a-v2-datablad.pdf) |
| Switch Add-on kontakt | maks 240 V AC / 2 A, potensialfri | [datablad](shelly-pro-3em-switch-addon-datablad.pdf) |
| CHINT NCH8-spole | 230 V AC, < 10 W (≈ 0,04 A) | [FDV](chint-nch8-kontaktor-fdv.pdf) |

## Koblingsskjema

```
                 Sikring (10-16A)
   L ────────────────┬──────────────────────────┐
                     │                          │
                     │                     [I]  │ Switch Add-on
                     │                      (potensialfri kontakt)
                     │                     [O]  │
                     │                          │
              VA på Shelly              A1 (spole) CHINT NCH8
                                        A2 (spole) ── N
                     │
                     └──► Kontaktor pol 1 (inn)
                          Kontaktor pol 2 (ut) ──[CT A rundt denne]──► Varmeovn L
   N ──────┬──────────────────────────────────────────────────────► Varmeovn N
           └──► N på Shelly
   PE ─────────────────────────────────────────────────────────────► Varmeovn jord
```

## Fremgangsmåte

1. **Add-on på Shelly (spenningsløst):** fjern DIN-braketten bak på Pro 3EM, trykk
   add-on-pinnene forsiktig i headeren (ikke bøy dem), fest begge med den doble braketten.
2. **Forsyning:** `N` → nøytral, `VA` → L. `VB`/`VC` ubrukt (evt. sett profil «Monophase»
   i Shelly-webgrensesnittet — ikke nødvendig).
3. **CT A** rundt fase-lederen mellom kontaktorutgang og ovn, pil (K→L) mot lasten.
   Plugg i A-inngangen.
4. **Styrekrets:** L → add-on `I`, add-on `O` → spole `A1`, `A2` → N.
5. **Lastkrets:** L → kontaktor pol 1, pol 2 → ovnens fase. Ovnens N → nøytral, jord → PE.
   De tre andre polene brukes først i trefaseinstallasjonen.
6. **Funksjonstest:** slå på kursen → Shelly booter og kobler til appen (utgående WebSocket).
   Admin → Enheter → «Slå PÅ (test)»: kontaktoren klikker, ovnen varmer, effekt vises.
   «Slå AV» kutter. Deretter full test med kr 1-QR-koden (`docs/qr/proto1-kr1.png`).

## Merknader

- **Nettype:** Skjemaet forutsetter TN-nett (230 V L–N), som på KODE15. På IT-nett
  (vanlig i norske boliger, 230 V L–L uten N) kobles «N»-punktene til L2 i stedet —
  innenfor spesifikasjonene til både Shelly og spole.
- **Varmeovn er ideell testlast:** resistiv, ingen startstrøm, tydelig verifiserbar
  (varme + målbar effekt 600–2000 W).
- **Ferdig-deteksjon:** ovn på laveste trinn/termostat-klikk simulerer «bilen er full»
  (effekt under terskelen) — nyttig for å teste øktslutt-reglene med ekte målinger.
