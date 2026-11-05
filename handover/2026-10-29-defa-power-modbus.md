# 29.10.2026: DEFA Power på wifi — Modbus TCP valgt som integrasjonsvei

Jørn satte DEFA Power-laderen på KODE15-wifi-en 29.10 (Bluetooth-oppsett
via DEFA Power Setup-appen). Utredning av API-muligheter gjort samme dag
(chat i studio15-light); Jørns beslutning: **Modbus TCP**.

## Enhetene (oppdatert 05.11: det er nå TO ladere)

- **DEFA-Power-56101410M**, 10.10.0.16 (MAC 48:02:af:d4:47:4f).
- **DEFA-Power-54C00W10M**, 10.10.0.21 (MAC 00:21:7e:f2:38:38) — på
  wifi 05.11. Modbus verifisert på begge (32 A maks installasjonsstrøm
  lest). Reservasjonen for nr. 2 må inn i fortigate-ordren.
- OBS dynamisk IP: reservasjon → 10.10.0.16 er lagt i fortigate-drengens
  planlagte DHCP-ordre (sammen med Mill/Shelly/raven). Til den er utført:
  slå opp i FortiGates DHCP-utleieliste ved IP-drift.
- Laderen har IKKE lokalt HTTP-API (port 80/443 stengt).

## Utredningen (tre veier, 29.10)

1. **Modbus TCP — VALGT.** Offisiell og dokumentert: laderen er slave på
   port 502, slave-ID 255, protokoll-PDF:
   https://www.defa.com/content/uploads/Documentation/EV-Charging/DEFA-Power/Support/modbus_documentation.pdf
   Lese: faktisk strøm per fase (reg. 293/296/299, uint32 mA),
   installasjonens maksstrøm (reg. 290). Skrive: maksstrøm-grense
   (reg. 2000–2001, mA) med keep-alive (reg. 2008–2009) og konfigurerbar
   fallback-strøm ved master-bortfall. Kun ÉN Modbus-master om gangen.
   Dette er laststyring (grenser + måling), ikke øktstyring (start/stopp).
2. **CloudCharge-API (sky)** — ingen offentlig API fra DEFA («no public
   API, no timeline»), men reverse-engineeret av HA-miljøet:
   https://github.com/Bebbssos/ha-defa-power (start/stopp, eco-modus,
   ladeplaner; SMS-innlogging, én sesjon per app-identitet). Reserve hvis
   øktstyring fra sky trengs senere — uoffisiell, kan knekke.
3. **OCPP 2.0.1 (CSMS)** — kun godkjente backends, egendefinert URL
   støttes ikke (bekreftet av DEFA-fastvareutvikler). Uaktuelt.

## Verifisert live 29.10 (fra raven over wlo1)

Modbus er ALLEREDE AKTIVERT på laderen (port 502 åpen — gjort under
app-oppsettet). Leseprøve med rå Modbus TCP (funksjon 4):
installasjon maks strøm = 32,0 A; faktisk strøm L1/L2/L3 = 0,00 A
(ingen bil tilkoblet). Ingen autentisering — hele kontor-wifi-en (og
drengr via enhetsnettet/policy 19) når porten; akseptert avveining på
vårt nett.

## Installatør-prosedyren (kveld 29.10): vurdert og kortet ned

Jørn fikk en prosedyre fra elektroinstallatøren (aktiver Modbus i appen,
noter IP, registertabell). Vurdering mot live-testene: teknisk korrekt
(registertabellen stemmer med DEFAs protokolldokument), men aktiverings-
delen er allerede passert — Modbus svarer, fastvaren er dermed ny nok,
og IP-en er kjent og skal reserveres i fortigate. **Gjenstående app-
oppgave, den eneste:** i DEFA Power Setup-appen under Junction Settings
→ Load balancing: verifiser at Modbus står på og sett bevisst
`Timeout value` + `Fallback current` (forslag 6 A) — ukjent hva de står
på i dag. Alt annet er vår side: hjerteslag til reg. 2008–2009 hvert
~10. sekund (ellers faller laderen tilbake til fallback-strømmen —
ønsket sikkerhetsmekanisme), og én-master-regelen.

Tilleggsregistrene er VERIFISERT 05.11 (av Studio15-agenten i
DEFA-pretest-flaten, på begge ladere): 302–303 statuskode (0 i ro),
305–306 total effekt (0 mW i ro). Driftslærdom, presisert gjennom to
funn samme dag: laderen misliker både tilkoblings-churn (mange raske
connect/disconnect → nekter nye tilkoblinger en periode) og
enkeltregister-lesing i serie på samme forbindelse (timeout). Det
robuste mønsteret er **én forbindelse + blokklesing av hele
registerområdet 290–306 i én forespørsel**. Referanseskript:
`verktoy/les_defa_status.py` her i repoet (berget fra
pretest-prosjektet 05.11, kjørt og verifisert fra raven).

## Display-skriving (utredet 05.11): mulig — men via OCPP, ikke Modbus

Jørns spørsmål: kan vi skrive til displayet på laderne? Svar:

- **Modbus: nei.** Det offisielle registerkartet er komplett (hentet
  05.11) og har ingen tekst-/displayregistre. Bonusfunn derfra:
  status-reg. 302 er ASCII-kodet IEC-tilstand (bits 8–15 = bokstav A–F,
  bits 0–7 = «1»/«2»; eks. 0x4332 = «C2» = lading) — bruk dette i
  visninger.
- **OCPP 2.0.1 DisplayMessage: ja, designet for det.** DEFA: «The
  display is a platform … through the Display and Messaging module»
  (spotpriser, CPO-logo, fritekst UTF8 med prioritet/tidsvindu).
- **Porten:** laderen godtar kun godkjente CSMS-backends (ikke
  egendefinert URL). Reell vei: be DEFA legge inn vår backend
  (contact@defa.com, de tilbyr det eksplisitt) og kjøre et minimalt
  OCPP 2.0.1-CSMS som container i denne drengen (python-ocpp /
  CitrineOS). Samme kobling gir offisiell start/stopp, ladeprofiler og
  diagnostikk. DNS-overstyring av et godkjent CSMS-navn er teknisk
  tenkbart (vi eier FortiGate-DNS-en) men skjørt — frarådes.

## Forhold til dagens Shelly-arkitektur

Shelly Pro 3EM (10.10.0.14) + kontaktor forblir betalings- og
målehjertet (utgående WebSocket til appen, lokal autonomi). Modbus mot
DEFA-en er et TILLEGG: direkte lesing av ladestrøm per fase og styring
av maksstrøm-grensen — aktuelt for laststyring og hjemautomasjon
(Studio15). Husk én-master-begrensningen hvis laststyring mot
hovedsikring kommer senere: master-rollen må bo ÉN plass (naturlig i
denne drengen).
