# Avalon Flight Simulator — Airbus A320 at Tehran Mehrabad + Cessna 172

A browser flight simulator focused on realistic flight dynamics, systems and instrument flying:

- **Airbus A320-200 (CFM56-5B4) in Iran Air livery.** Fly-by-wire control laws, all ECAM pages, a working MCDU/FMGS, autopilot with autoland, and TCAS II. It flies around **Tehran Mehrabad (OIII)**, which is built from the Iranian AIP.
- **Cessna 172S.** Steam-gauge IFR training on the fictional Avalon Island.

## Running it

There is no build step. Open `index.html` in Chrome, Edge or Firefox; WebGL is required. Three.js is bundled, so it also works offline.

If the browser blocks local files, run `python3 -m http.server 8000` in this folder and open http://localhost:8000.

## Phones & tablets (iPhone, iPad, Android)

The sim detects a phone or tablet automatically and switches to touch controls. You can turn them on or off under **Time & Systems → On-screen touch controls**.

To open it on a phone, run the server on your computer so the phone can reach it:

```
python3 -m http.server 8000 --bind 0.0.0.0
```

Then open `http://<your-computer's-IP>:8000` on the phone, on the same Wi-Fi network. On iPhone, use Share → **Add to Home Screen** to run it full screen. Hold the device in landscape.

| Touch control | What it does |
|---|---|
| Left stick | Pitch & roll. Pull down = nose up; it re-centres when released |
| ◀ RUD / RUD ▶ | Rudder and nosewheel steering |
| Right lever | Thrust. The A320 lever has TOGA / FLX / CL / IDLE / REV detents |
| BRK, FLAP −/+, GEAR, AP… | Quick actions. **⋯** opens the rest (spoilers, APPR/LOC, trim, lights, starter, mixture, OBS…) |
| PANEL | Instrument panel. On phones the A320 panel cycles displays → pedestal → off |
| VIEW / MAP / MCDU / OVHD | Views, moving map, MCDU and overhead panel |
| 3D view | Drag to look around, pinch to zoom, double-tap to recentre |
| Panel knobs | Drag up/right to increase, or tap the left/right half to step |

## Tehran / Mehrabad (OIII)

Airport data comes from the Iranian AIP (AD 2 OIII, AIRAC AMDT 1/20 & 3/21):

| Item | Data |
|---|---|
| ARP / elevation | 35°41'20"N 051°18'53"E · 3,965 ft · MAG VAR 5°E |
| RWY 11L/29R | 3,996 × 45 m concrete, true 109.63°. 29R has PALS CAT I 830 m and PAPI 3.3° |
| RWY 11R/29L | 4,041 × 60 m asphalt. 29L has PALS 870 m and PAPI 3.3°. 11R has SALS 300 m and PAPI 3.4° |
| Runway slope | 1.26 % from the threshold elevations, modelled in the physics: 29 thresholds sit about 165 ft lower |
| ILS 29L | ITHL 109.90, course 285°, GP 3.3°, RDH 59 ft, DME. Real LLZ/GP antenna positions |
| ILS 29R | ITRN 110.70, course 285°, DME |
| Navaids | TRN DVOR/DME 115.30 · RUS VOR/DME 116.95 · VR NDB 373 · KAZ NDB 358 |
| Comms | ATIS 128.000 · DEL 121.850 · GND 121.700/121.900 · TWR 118.100/124.450 · APP 119.700/125.100 |
| TA / TL | 9,000 ft / FL110 |

The region is 160 × 160 km. It includes:
- The city of Tehran, with thousands of buildings and night lights.
- The Milad Tower (435 m, with obstruction lights) and the Azadi Tower.
- The Alborz range with Tochal, plus Damavand (5,610 m).
- Karaj and the southern desert.
- Imam Khomeini (OIIE) as the alternate. Its layout and frequencies are **approximate**.

Ground equipment includes:
- Terminal gates with animated jet bridges.
- GPU and baggage carts.
- Pushback, chocks, a fuel truck, and doors.
- ATIS broadcast with synthetic speech. Tune 128.000 on the RMP or press ATIS on the overhead.

The waypoints and SIDs/approach transitions in the FMS are **simplified sim procedures, not the real charts**. Do not use any of this for real-world navigation.

## A320 systems

**Flight dynamics & fly-by-wire (`js/a320/fdm.js`)**
- Normal law uses load-factor demand with auto-trim. With the stick released, the flight path is held and bank is held up to 33°; beyond 33° the aircraft rolls back to 33°.
- Protections: α-prot/α-max, α-floor, pitch +30/−15°, load factor, high speed, and 67° bank.
- Alternate law and direct law ("USE MAN PITCH TRIM") are included.
- Every control surface is powered by its real hydraulic systems (G/B/Y).
- CFM56 engines have FADEC thrust ratings (TOGA / FLX / MCT / CL), spool dynamics, EGT and fuel flow, an automatic start sequence, reversers and flame-out.
- Gear, anti-skid brakes, autobrake LO/MED/MAX, and nosewheel steering on the yellow system are modelled.

**Systems & ECAM (`systems.js`, `displays.js`)**
- Aircraft systems: ELEC, APU, BLEED, PRESS, COND, FUEL, HYD with the PTU and RAT, doors and wheels.
- The Flight Warning Computer drives master warning/caution, ECAM procedures (blue action lines that clear as you do them), memos (T.O / LDG MEMO) and the STATUS page.
- All SD pages are implemented: ENG, BLEED, PRESS, ELEC, HYD, FUEL, APU, COND, DOOR, WHEEL, F/CTL, STS, CRUISE.

**FMGS, MCDU & FCU (`fmgs.js`, `mcdu.js`, `cockpit.js`)**
- MCDU pages: INIT A/B, F-PLN (lateral and vertical revisions, insert/delete/CLR), DEPARTURE/ARRIVAL, DIR TO, PERF (T.O / CLB / CRZ / DES / APPR / GA), RAD NAV, PROG, FUEL PRED and DATA.
- You can type directly into the scratchpad from the keyboard.
- Autopilot/FD/A-THR modes:
  - Lateral: RWY, NAV, HDG, LOC.
  - Vertical: SRS, CLB/OP CLB, DES/OP DES, ALT*, V/S, G/S.
  - Autoland: LAND, FLARE, ROLL OUT with CAT 3 DUAL, plus the RETARD callout.
  - Thrust: LVR CLB, THR CLB, SPEED/MACH, A.FLOOR, and go-around.

**TCAS II (`tcas.js`)**
- Traffic advisories (TA) and resolution advisories (RA) with climb/descend sense selection and strengthening.
- Red and green vertical-speed bands on the PFD, and traffic symbols on the ND.
- Voice alerts: "Traffic, traffic", "Climb, climb" / "Descend, descend", "Clear of conflict".

**Views:** 1 cockpit + panel · 2 cockpit (3D glareshield and **sidestick**) · 3 chase · 4 tower · 5 fly-by · 6 wing · 7 side · 8 top/orbit · 9 cabin window · 0 belly/gear camera. The sidestick is also drawn live on the pedestal panel, and a sidestick-order cross appears on the PFD while on the ground.

## A320 scenarios

- Ready for departure on 29L: FLX takeoff. Its flight plan to OIIE is already loaded.
- Cold & dark at the gate: a full power-up, APU, MCDU, pushback and engine start.
- ILS 29L intercept, with optional autoland.
- **TCAS RA over Tehran**, followed by a debrief showing the RA sequence and the closest approach.
- **Dual hydraulic failure (G+Y).** You get ALTN, then DIRECT law. Flaps are locked, so you use gravity gear extension and fly VREF+25 on accumulator brakes.
- Engine failure at V1.
- Night ILS 29R in Tehran winter smog.

## Controls

| A320 | Key |
|---|---|
| Sidestick | W/S/A/D or arrows, mouse (Y), joystick, or drag the pedestal sidestick |
| Thrust levers | `=` / `-` (they stop at detents) · Shift+`=`/`-` jumps a detent · below IDLE on the ground = reverse |
| Flaps / gear / speed brake | F, R · G · `/` (Shift+`/` arms the ground spoilers) |
| AP1 / A/THR / disconnect | Z · Shift+Z · X (AP), Shift+X (A/THR) |
| APPR / LOC / LS | Shift+A · Shift+V · F4 |
| MCDU / overhead | F2 (click the MCDU, then type) · F3 |
| Gravity gear extension | Shift+T |

Everything on the FCU, EFIS panel, pedestal, overhead and RMP responds to clicks and the mouse wheel. On the FCU knobs, the left half means PUSH (managed) and the right half means PULL (selected). The Cessna controls are listed in the in-game menu.

## Tests

```
node tests/fdm-test.js       # C172 vs POH (takeoff, climb, cruise, glide, stall, autopilot ILS)
node tests/advanced-test.js  # spin, compass errors, pitot blockage, altimeter temperature error
node tests/a320-test.js      # A320 FBW laws, protections, hot/high takeoff, cruise fuel flow, autoland at OIII
```

## Honest limitations

- A320 aero data is a realistic approximation, not certified Airbus data.
- The FMS database and procedures are simplified.
- ECAM procedures follow FCOM logic but are condensed.
- There is no ATC traffic beyond the TCAS scenario.
- Imam Khomeini's runway layout and ILS frequencies are approximate.
