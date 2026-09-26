# Avalon Flight Simulator

A browser flight simulator focused on realistic flight dynamics, weather and instrument (IFR) flying.
You fly a Cessna 172S-class aircraft around the fictional Avalon Island, which has three airports,
VOR/DME stations, NDBs and full ILS approaches with approach lighting.

## Running it

No build step and no server needed. Open `index.html` in a modern desktop browser (Chrome, Edge, Firefox or Safari
with WebGL). Three.js is bundled in `js/lib`, so it also works offline.

If your browser blocks local files, serve the folder instead:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## What's simulated

**Flight dynamics (`js/core/aircraft.js`)**: 6-DOF rigid body at 240 Hz.
- Stability-derivative aerodynamics based on C172 data, with a non-linear lift curve, stall break, wing drop,
  bounded roll autorotation (so spins can develop and be recovered), ground effect, and flap lift, drag and pitch effects.
- Left-turning tendencies: P-factor, slipstream swirl, engine torque and gyroscopic precession.
  Propeller slipstream over the tail gives elevator and rudder authority at low speed.
- Engine: manifold pressure, pumping losses, and a mixture/density-altitude model, so leaning gains power at altitude.
  Also modelled: magnetos, starter, fuel tanks and selector, carburettor icing and carb heat.
  The fixed-pitch prop runs from CT/CP(J) tables with a dynamic RPM equation (RPM rises in a dive, the prop windmills with the engine off).
- Landing gear: spring/damper struts, slip-angle tyre model, brakes and nose-wheel steering.
  Tail strikes, prop strikes, wing-tip strikes, gear collapse, over-G, Vne and ditching are all detected.
- Airframe icing (lift loss, drag and weight), pitot icing.

Validated against POH figures (`node tests/fdm-test.js`):

| | Sim | POH (approx.) |
|---|---|---|
| Static RPM | 2,316 | 2,300–2,400 |
| Ground roll / 50 ft | 1,095 / 1,880 ft | 960 / 1,630 ft |
| Climb at Vy, SL | 690 fpm | 730 fpm |
| Cruise, 75 % | 108 KTAS | 110–114 KTAS |
| Best glide | 9.7 : 1 | 9 : 1 |
| Stall, flaps up / 30° | 48 / 44 KCAS | 50 / 46 KCAS (adjusted for weight) |

**Weather (`js/core/weather.js`)**
- ISA atmosphere with real temperature and QNH, so the altimeter shows genuine temperature and pressure errors.
- Boundary-layer wind profile, winds aloft, gusts, and Dryden-style turbulence (linear and rotational).
- Mechanical turbulence near the ground, orographic lift and sink over terrain, and cumulus up- and downdrafts.
- Cloud layers (FEW to OVC; cumulus, stratus or CB) that are shared between physics and graphics.
- Visibility, rain and snow, and icing conditions. The menu shows a live METAR/ATIS.

**Instruments (`js/core/instruments.js`)**. These show what the pilot actually sees:
- Pitot-static system with AoA misalignment. A blocked pitot makes the ASI act like an altimeter; a blocked static port freezes the altimeter and VSI. There is an alternate static source.
- Lagging VSI. Kollsman window on the altimeter.
- Vacuum-driven AI and DG: gyro spin-down, tumbling and precession. The DG drifts and must be synced to the compass.
- Magnetic compass with dip: northerly turning error, acceleration error and card swing.
- Electric turn coordinator with an inclinometer ball.
- Electrical system (battery drain on alternator failure) and full engine gauges.

**Avionics**
- NAV1 (VOR/LOC/GS), NAV2, ADF, DME, marker beacons (lights and tones) and transponder.
- The glideslope has a false lobe above the real path, as on a real ILS.
- KAP 140-style autopilot with ROL, HDG, NAV, APR, REV, VS and ALT modes, altitude preselect and electric trim.

**World**
- Procedural island terrain with farmland, forests, towns and snow-capped mountains.
- Three airports with correct runway markings, edge, threshold and end lights, approach lighting with the sequenced-flasher "rabbit", PAPI, taxiway lights, beacons, windsocks, VOR sites and ILS antennas.
- Day and night cycle with stars and town lights. Rain and snow. Frost on the windscreen when iced.

## Controls (also listed in the in-game menu)

| Key | Action |
|---|---|
| W/S or ↑/↓ | Pitch (S/↓ pulls back) |
| A/D or ←/→ | Roll |
| Q/E | Rudder and nose-wheel steering |
| = / − or PgUp/PgDn | Throttle (hold). Hold Shift for mixture |
| [ / ] or Home/End | Elevator trim |
| F / R | Flaps down / up |
| B (hold), K | Brakes, parking brake |
| X (hold) | Starter |
| H, J, L | Carb heat, pitot heat, landing light |
| G | Sync heading indicator to compass |
| Shift+B | Set altimeter to ATIS QNH |
| Z | Autopilot on/off (modes are on the panel) |
| N, `,` `.` | Swap NAV1, NAV1 OBS (hold Shift to move the heading bug) |
| C, 1–5 | Views: cockpit+panel, cockpit, chase, tower, fly-by |
| Tab, M, I | Toggle panel, moving map, data readout |
| Y | Mouse yoke |
| P, Esc, Shift+R | Pause, menu, restart |

Every knob, radio, switch and lever on the panel also responds to the mouse wheel and to clicks
(left half decreases, right half increases). Gamepads and joysticks are detected automatically.

## Project layout

```
index.html, css/style.css
js/core/    math, world (airports and terrain), weather, nav (radios), aircraft (FDM), instruments, autopilot
js/render/  scenery (terrain, airports, lights, sky, clouds, rain), aircraft-model (3D model and cameras), panel (2D gauges)
js/sim/     audio (procedural sound), input (keyboard, mouse, gamepad)
js/main.js  scenarios, menus, game loop, HUD, map, landing grading
tests/      Node-based flight model validation (node tests/fdm-test.js, node tests/advanced-test.js)
```
