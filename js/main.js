/*
 * Flight simulator application glue: worlds (Avalon / Tehran), aircraft (C172 / A320), scenarios, menus, game loop,
 * controls, HUD, map, callouts, ground services, landing grading.
 */
(function () {
  'use strict';
  const FS = window.FS;
  const { DEG, RAD, KT, FT, NM, FPM } = FS.U;
  const $ = (id) => document.getElementById(id);
  const PHYS_DT = 1 / 240;

  const S = {
    started: false, paused: false, menuOpen: true, hours: 14, flightTime: 0, scenario: 'a320_ready', showInfo: true, showPanel: true,
    showMap: false, mapScale: 0.008, autoRudder: true, track: [], lastTouch: 0, airborneTime: 0, pendingFailure: null, randomFailures: false,
    crashShown: false, acType: 'a320', world: null, detHold: 0, push: null, jetway: false, calls: {}, lastRa: 9999,
  };
  let terrain, navaids, weather, renderer, camera, scenery, env, rig, input, audio, touch;
  let c172, model172, ind, ap, nav1, nav2, adf, marker, panel; // Cessna
  let a320, sys, fm, mcdu, cockpit, model320, tcas; // Airbus
  const rx = {}; // A320 receivers
  let ac;
  let trafficModels = [];
  let acc = 0,
    last = performance.now();

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  async function setLoading(msg) {
    $('loading-msg').textContent = msg;
    await nextFrame();
  }

  // ================================================================ scenarios
  const A = () => FS.AIRPORTS;
  const SCENARIOS = [
    // ------------------------------------------------ Airbus A320 — Tehran
    {
      world: 'tehran', acType: 'a320', id: 'a320_ready', name: 'A320 — Ready for departure, OIII RWY 29L', tag: 'A320 · Takeoff',
      desc: 'Iran Air A320 lined up on Mehrabad 29L (3,796 ft, hot & high). F-PLN OIII→OIIE loaded, V-speeds and FLEX set. Thrust levers to FLX (Shift+=) or TOGA, rotate at VR, SRS/RWY then NAV.',
      weather: 'tehran', hours: 14.3,
      setup() {
        const t = A()[0].runways[1].thr[1];
        a320Ground(t.n + Math.cos(t.hdg * DEG) * 25, t.e + Math.sin(t.hdg * DEG) * 25, t.hdg, false);
        a320.ctl.flapLever = 1;
        a320.ths = 1.5;
        planOIIItoOIIE('29L');
        fm.fcu.alt = 9000;
        fm.fcu.hdg = 285;
        a320.lights.landing = a320.lights.strobe = true;
        a320.ctl.spoilersArmed = true;
        a320.ctl.autobrake = 'MAX';
        sys.toConfigTested = true;
        sys.engRunTime = 200;
      },
    },
    {
      world: 'tehran', acType: 'a320', id: 'a320_gate', name: 'A320 — Cold & dark at Mehrabad gate', tag: 'A320 · Procedures',
      desc: 'Parked nose-in at the terminal with jet bridge, GPU and doors open. BAT 1+2 ON, EXT PWR ON, APU start, MCDU init (F2), close doors, pushback (overhead F3 → GND SERVICES), ENG MODE IGN, MASTER 2 then 1, taxi to 29L.',
      weather: 'tehran', hours: 7.2,
      setup() {
        const gt = A()[0].gates[3];
        a320Ground(gt.n, gt.e, gt.hdg, true);
        a320.ctl.parkingBrake = true;
        S.jetway = true;
        fm.fcu.alt = 9000;
      },
    },
    {
      world: 'tehran', acType: 'a320', id: 'a320_ils29l', name: 'A320 — ILS 29L Mehrabad (intercept)', tag: 'A320 · Approach',
      desc: 'Heading 260 to intercept the ITHL localizer (109.90, CRS 285, GS 3.3°). AP1 on, press APPR (and AP2 for autoland CAT 3 DUAL), manage speed, CONF FULL, gear down. Or disconnect and hand-fly.',
      weather: 'mvfr', hours: 17.2,
      setup() {
        const t = A()[0].runways[1].thr[1];
        const h = t.hdg * DEG;
        const d = 15 * NM;
        a320Air({ n: t.n - Math.cos(h) * d + Math.sin(h) * 3200, e: t.e - Math.sin(h) * d - Math.cos(h) * 3200, alt: 8000 * FT, kias: 210, hdg: FS.trueOf(320), flaps: 1 });
        planOIIEtoOIII('ILS29L', null);
        fm.directTo('CI29L');
        fm.phase = 'APPROACH';
        fm.appPhaseActive = true;
        fm.fcu.alt = 7000;
        fm.fcu.hdg = 320;
        fm.fcu.hdgManaged = false;
        fm.fcu.spdManaged = true;
        fm.fcu.ls[0] = true;
        fm.fcu.ap1 = true;
        fm.fcu.athr = true;
        fm.lat.mode = 'HDG';
        fm.vert.mode = 'ALT';
        fm.d.qnhDest = Math.round(weather.qnh);
        fm.d.dh = 200;
        setBaro();
      },
    },
    {
      world: 'tehran', acType: 'a320', id: 'a320_tcas', name: 'A320 — TCAS RA over Tehran', tag: 'A320 · Emergency',
      desc: 'Cruising at FL130 heading 290 on autopilot. Opposite-direction traffic busts its level. Expect TRAFFIC then an RA: disconnect AP (X), follow the green VS band on the PFD smoothly, then return to FL130 after "CLEAR OF CONFLICT".',
      weather: 'clear', hours: 12.5,
      setup() {
        const n0 = -21000,
          e0 = 12000;
        a320Air({ n: n0, e: e0, alt: 13000 * FT * 0.99, kias: 280, hdg: FS.trueOf(290), flaps: 0 });
        planOIIItoOIIE(null);
        fm.fcu.std[0] = fm.fcu.std[1] = true;
        fm.fcu.alt = 13000;
        fm.fcu.hdg = 290;
        fm.fcu.hdgManaged = false;
        fm.fcu.spdManaged = false;
        fm.fcu.spd = 280;
        fm.fcu.ap1 = true;
        fm.fcu.athr = true;
        fm.lat.mode = 'HDG';
        fm.vert.mode = 'ALT';
        fm.altHold = 13000;
        fm.phase = 'CRUISE';
        a320.ctl.tla = [25, 25];
        const h = FS.trueOf(290) * DEG;
        const d = 13 * NM;
        tcas.add({ id: 'IRM-1504', n: n0 + Math.cos(h) * d - Math.sin(h) * 120, e: e0 + Math.sin(h) * d + Math.cos(h) * 120, alt: 11600 * FT, hdg: FS.wrap360(FS.trueOf(290) + 180), spd: 270, vs: 1900, levelAt: 14500 });
        tcas.add({ id: 'IRA-455', n: n0 - 9 * NM, e: e0 + 14 * NM, alt: 17000 * FT, hdg: 20, spd: 300, vs: 0 });
        S.tcasCheck = true;
      },
    },
    {
      world: 'tehran', acType: 'a320', id: 'a320_hyd', name: 'A320 — Dual hydraulic failure (G+Y)', tag: 'A320 · Emergency',
      desc: 'Inbound to Mehrabad at 10,000 ft. Green and Yellow systems will be lost: ALTN law (then DIRECT with gear down), flaps locked, slats slow, gravity gear extension, no NWS / reversers, accumulator brakes. Follow the ECAM, land 29L with CONF 3 slats at VREF+25.',
      weather: 'fair', hours: 11.0,
      setup() {
        a320Air({ n: -30000, e: 22000, alt: 10000 * FT, kias: 250, hdg: FS.trueOf(345), flaps: 0 });
        planOIIEtoOIII('ILS29L', null);
        fm.directTo('CI29L');
        fm.fcu.alt = 8000;
        fm.fcu.ap1 = true;
        fm.fcu.athr = true;
        fm.fcu.hdgManaged = true;
        fm.lat.mode = 'NAV';
        fm.vert.mode = 'ALT';
        fm.altHold = 10000;
        fm.phase = 'DESCENT';
        fm.d.qnhDest = Math.round(weather.qnh);
        fm.d.ldgConf3 = true;
        sys.ldgConf3 = true;
        setBaro();
        S.pendingFailure = { t: 15, key: 'hydGY', msg: 'MASTER WARNING — HYD G+Y SYS LO PR' };
      },
    },
    {
      world: 'tehran', acType: 'a320', id: 'a320_v1cut', name: 'A320 — Engine failure at V1, 29L', tag: 'A320 · Emergency',
      desc: 'Takeoff from 29L with TOGA. The right engine fails at V1: continue, rotate at VR, keep the aircraft straight with rudder (the β target shows blue), climb at V2, then ENG FAIL ECAM.',
      weather: 'tehran', hours: 15,
      setup() {
        SCENARIOS[0].setup();
        S.pendingFailure = { ias: fm.d.v1 || 140, key: 'eng2', msg: 'ENG 2 FAIL' };
      },
    },
    {
      world: 'tehran', acType: 'a320', id: 'a320_night', name: 'A320 — Night ILS 29R in Tehran winter smog', tag: 'A320 · Night IFR',
      desc: 'Winter evening inversion: smog, visibility 2,500 m, cold air. ITRN 110.70. The city lights, the Milad Tower obstruction lights and the PALS guide you in.',
      weather: 'smog', hours: 19.6,
      setup() {
        const t = A()[0].runways[0].thr[1];
        const h = t.hdg * DEG;
        const d = 11 * NM;
        a320Air({ n: t.n - Math.cos(h) * d, e: t.e - Math.sin(h) * d, alt: t.elev + 3400 * FT, kias: 180, hdg: t.hdg, flaps: 2 });
        planOIIEtoOIII('ILS29R', null);
        fm.directTo('FF29R');
        fm.radio.ils = { freq: 110.7, crs: 285, ident: 'ITRN' };
        fm.phase = 'APPROACH';
        fm.appPhaseActive = true;
        fm.fcu.alt = 7000;
        fm.fcu.ap1 = true;
        fm.fcu.athr = true;
        fm.fcu.ls[0] = true;
        fm.press('APPR');
        fm.lat.mode = 'HDG';
        fm.fcu.hdg = 285;
        fm.fcu.hdgManaged = false;
        fm.vert.mode = 'ALT';
        fm.d.dh = 200;
        a320.lights.landing = true;
        setBaro();
      },
    },
    // ------------------------------------------------ Cessna 172 — Avalon
    {
      world: 'avalon', acType: 'c172',
      id: 'takeoff27', name: 'Departure — KAVX Runway 27', tag: 'VFR · Takeoff',
      desc: 'Lined up on runway 27 at Avalon Regional, engine idling. Full throttle, keep the centreline with rudder, rotate at 55 KIAS, climb at Vy 74 KIAS.',
      weather: 'fair', hours: 10.5,
      setup() {
        const t = A()[0].runways[0].thr[1];
        ac.placeOnGround(terrain, t.n, t.e - 15, 270);
        radios(110.3, 113.9, 270, 113.9, 116.4, 30, 356);
        ap.hdgBug = 270;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'ils27', name: 'ILS Runway 27 — 12 nm final', tag: 'IFR · Precision approach',
      desc: 'Established on the localizer at 2,500 ft AGL, 95 KIAS, below the glideslope. Intercept the GS near 8 nm, fly the needles down to 200 ft decision height.',
      weather: 'ifr', hours: 15.2,
      setup() {
        const t = A()[0].runways[0].thr[1];
        air({ n: t.n, e: t.e + 12 * NM, agl: 2500, apt: 0, kias: 95, hdg: 270, flaps: 0 });
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
        ap.hdgBug = 270;
        ap.altSel = Math.round((A()[0].elev / FT + 2500) / 100) * 100;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'vectors', name: 'Radar vectors to ILS 27', tag: 'IFR · Intercept',
      desc: 'Heading 240, maintain 3,000 ft, cleared ILS 27 approach. Arm APR on the autopilot or hand-fly the intercept, then the glideslope.',
      weather: 'mvfr', hours: 9.0,
      setup() {
        const t = A()[0].runways[0].thr[1];
        air({ n: 5 * NM, e: t.e + 17 * NM, alt: 3000 * FT, kias: 100, hdg: 240, flaps: 0 });
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
        ap.hdgBug = 240;
        ap.altSel = 3000;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'pattern', name: 'Traffic pattern — left downwind 27', tag: 'VFR · Landing',
      desc: 'Abeam midfield on left downwind at 1,000 ft AGL. Power 1,700 RPM abeam the numbers, flaps 10, turn base, flaps 20, final 65 KIAS, flaps 30.',
      weather: 'fair', hours: 17.8,
      setup() {
        air({ n: -1500, e: 300, agl: 1000, apt: 0, kias: 90, hdg: 90, flaps: 0 });
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
        ap.hdgBug = 90;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'xwind', name: 'Gusty crosswind — 2 nm final 27', tag: 'VFR · Crosswind',
      desc: 'Wind 200° at 18 gusting 28 kt: a strong left crosswind with mechanical turbulence. Crab on final, then wing-low / top rudder in the flare.',
      weather: 'storm', hours: 13, weatherMod: { windDir: 200, windKt: 18, gustKt: 28, clouds: [{ baseFt: 2500, topFt: 7000, cover: 5, type: 'cu' }], vis: 9000, precip: 0.2 },
      setup() {
        const t = A()[0].runways[0].thr[1];
        air({ n: t.n, e: t.e + 2 * NM, agl: 690, apt: 0, kias: 72, hdg: 270, flaps: 2, gamma: -3 });
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'night', name: 'Night ILS 27 in fog (LIFR)', tag: 'IFR · Challenge',
      desc: 'Ceiling 200 ft, visibility 600 m, at night. Fly the ILS precisely — the approach lights appear at minimums. Use the PAPI and the rabbit.',
      weather: 'lifr', hours: 22.5,
      setup() {
        const t = A()[0].runways[0].thr[1];
        air({ n: t.n, e: t.e + 9 * NM, agl: 2000, apt: 0, kias: 90, hdg: 270, flaps: 0 });
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
        ac.lights.landing = true;
        ap.hdgBug = 270;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'cruise', name: 'Cross-country to Highland', tag: 'VFR · Navigation',
      desc: 'Cruising at 5,500 ft toward the HLD VOR (116.40) on the 030° course. Lean the mixture, then fly the ILS 36 approach into mountainous Highland Field.',
      weather: 'fair', hours: 11,
      setup() {
        air({ n: 4000, e: 2000, alt: 5500 * FT, kias: 105, hdg: 30, flaps: 0 });
        radios(116.4, 108.7, 30, 113.9, 115.2, 210, 329);
        ap.hdgBug = 30;
        ap.altSel = 5500;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'hld36', name: 'ILS Runway 36 — Highland (mountains)', tag: 'IFR · Terrain',
      desc: 'Highland Field lies at the foot of the northern range. Localizer 108.70, glideslope 3°. Missed approach: climb straight ahead — terrain rises fast!',
      weather: 'mvfr', hours: 16,
      setup() {
        const t = A()[1].runways[0].thr[0];
        air({ n: t.n - 10 * NM, e: t.e, agl: 2600, apt: 1, kias: 95, hdg: 0, flaps: 0 });
        radios(108.7, 116.4, 0, 116.4, 113.9, 0, 329);
        ap.hdgBug = 0;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'efato', name: 'Engine failure over the field', tag: 'Emergency',
      desc: 'Overhead Avalon at 3,000 ft AGL. The engine will fail shortly. Pitch for best glide 68 KIAS and make it to a runway.',
      weather: 'fair', hours: 12,
      setup() {
        air({ n: 1500, e: 2500, agl: 3000, apt: 0, kias: 95, hdg: 270, flaps: 0 });
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
        S.pendingFailure = { t: 6 + Math.random() * 8, key: 'engine', msg: 'ENGINE FAILURE!' };
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'icing', name: 'Icing encounter in cloud', tag: 'IFR · Emergency',
      desc: 'In cloud at 4,000 ft with an OAT near freezing. Ice accretes on the airframe and pitot tube. Turn on PITOT HEAT, watch airspeed and descend to warmer air.',
      weather: 'icing', hours: 14,
      setup() {
        const t = A()[0].runways[0].thr[1];
        air({ n: 2000, e: t.e + 16 * NM, alt: 4000 * FT, kias: 100, hdg: 265, flaps: 0 });
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
        ac.pitotHeat = false;
      },
    },
    {
      world: 'avalon', acType: 'c172',
      id: 'cold', name: 'Cold & dark on the ramp', tag: 'Procedures',
      desc: 'Everything off. Battery ON, beacon ON, mixture RICH, throttle cracked, hold X to crank (magnetos to START), then taxi to runway 27.',
      weather: 'clear', hours: 8.2,
      setup() {
        ac.placeOnGround(terrain, 330, -150, 180);
        ac.eng.running = false;
        ac.eng.rpm = 0;
        ac.eng.oilT = ac.eng.cht = ac.eng.egt = 60;
        ac.eng.oilP = 0;
        ac.elec.master = false;
        ac.elec.avionics = false;
        ac.ctl.mags = 0;
        ac.ctl.mixture = 0;
        ac.ctl.parkingBrake = true;
        ac.lights.beacon = ac.lights.nav = ac.lights.strobe = false;
        radios(110.3, 113.9, 270, 113.9, 116.4, 90, 356);
      },
    },
  ];

  function radios(n1, n1s, obs1, n2, n2s, obs2, adfF) {
    nav1.active = n1;
    nav1.standby = n1s;
    nav1.obs = obs1;
    nav2.active = n2;
    nav2.standby = n2s;
    nav2.obs = obs2;
    adf.freq = adfF;
  }
  function air(o) {
    const alt = o.alt != null ? o.alt : A()[o.apt].elev + o.agl * FT;
    ac.trim(env, { n: o.n, e: o.e, alt, kias: o.kias, hdg: o.hdg, flaps: o.flaps || 0, gamma: o.gamma || 0, fuelL: 20, fuelR: 20 });
    ac.omega.set(0, 0, 0);
    addWind(ac, alt, o.n, o.e);
  }
  function addWind(a, alt, n, e) {
    const agl = alt - terrain.groundHeight(n, e);
    const w = weather.meanWind(alt, agl);
    a.vel.add(a.q.invRotate(new FS.V3(w.n, w.e, 0)));
    a.updateDerived();
  }
  function a320Air(o) {
    sys.coldStart(false);
    a320.eng.forEach((e) => e.reset(true));
    a320.fuelKg = 7000;
    a320.zfw = 58000;
    const r = a320.trim(env, Object.assign({ gearDown: false }, o));
    sys.setFuel(a320.fuelKg);
    a320.ctl.tla = [25, 25];
    a320.athrActive = true;
    a320.athrFrac = r.athrFrac;
    fm.athrFrac = r.athrFrac;
    a320.ctl.flapLever = o.flaps || 0;
    addWind(a320, o.alt, o.n, o.e);
    fm.phase = 'CRUISE';
    a320.lights.landing = false;
  }
  function a320Ground(n, e, hdg, dark) {
    a320.reset({ enginesRunning: !dark });
    a320.fuelKg = 9000;
    a320.zfw = 58000;
    sys.coldStart(dark);
    sys.setFuel(9000);
    if (dark) a320.eng.forEach((x) => x.reset(false));
    a320.placeAt(terrain, n, e, hdg);
    a320.ctl.tla = [0, 0];
    fm.phase = 'PREFLIGHT';
  }
  function planOIIItoOIIE(rwy) {
    fm.setFromTo('OIII', 'OIIE');
    if (rwy) {
      const sids = fm.db.sids('OIII', rwy);
      fm.setDeparture(rwy, sids[0] ? sids[0].name : null);
    }
    fm.setArrival('ILS29R', 'KAZ');
    const s = fm.toSpeeds();
    Object.assign(fm.d, s);
    fm.d.flex = 50;
    sys.flexTemp = 50;
    fm.d.crzFL = 150;
    setBaro();
  }
  function planOIIEtoOIII(appr, via) {
    fm.setFromTo('OIIE', 'OIII');
    fm.setArrival(appr, via);
    fm.d.crzFL = 150;
  }
  function setBaro() {
    fm.fcu.baro = [Math.round(weather.qnh), Math.round(weather.qnh)];
    fm.fcu.std = [false, false];
  }

  // ================================================================ world / aircraft management
  function disposeScene(scene) {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      });
    });
  }
  async function loadWorld(id) {
    if (S.world === id) return;
    const first = !S.world;
    S.building = true;
    $('loading').classList.remove('hidden');
    S.world = id;
    FS.setWorld(id);
    await setLoading(`Generating ${FS.WORLD.name} terrain…`);
    terrain = new FS.Terrain(7);
    navaids = FS.buildNavaids(terrain);
    env.terrain = terrain;
    weather.set(Object.assign(weather.toConfig(), { refElev: FS.AIRPORTS[0].elev }));
    if (scenery) disposeScene(scenery.scene);
    scenery = new FS.Scenery(renderer, terrain, navaids);
    await scenery.build(setLoading);
    model172 = new FS.AircraftModel(scenery.scene);
    model320 = new FS.A320Model(scenery.scene, 'EP-IEB');
    trafficModels = [];
    fm = new FS.FMGS(a320, navaids, FS.WORLD);
    mcdu.fm = fm;
    fm.onRetard = () => audio.speak('Retard', { interrupt: true });
    fm.onApDisc = (inv) => {
      audio.cavalry();
      if (inv) banner('AP DISCONNECTED — ALTN LAW', 3, true);
    };
    scenery.buildClouds(weather);
    S.building = false;
    if (!first) $('loading').classList.add('hidden');
  }
  function setAircraft(t) {
    S.acType = t;
    ac = t === 'a320' ? a320 : c172;
    rig.setType(t);
    model172.root.visible = t === 'c172';
    model172.shadow.visible = false;
    model320.root.visible = t === 'a320';
    model320.shadow.visible = false;
    touch.setButtons(touchButtons());
  }

  async function loadScenario(id) {
    const sc = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    S.scenario = sc.id;
    await loadWorld(sc.world);
    setAircraft(sc.acType);
    S.pendingFailure = null;
    S.push = null;
    S.jetway = false;
    S.calls = {};
    S.lastRa = 9999;
    S.tcasCheck = false;
    tcas.clear();
    for (const m of trafficModels) m.dispose();
    trafficModels = [];
    if (sc.acType === 'c172') {
      for (const k in c172.failures) c172.failures[k] = false;
      ap.on = false;
      ap.alert = 0;
      ap.armLat = null;
      c172.elec.master = c172.elec.avionics = c172.elec.alternator = true;
      Object.assign(c172.lights, { beacon: true, nav: true, strobe: true, landing: false, taxi: false });
      c172.pitotHeat = false;
      ind.altStatic = false;
      sc.setup();
      for (const k in failBoxes) if (failBoxes[k].checked && k in c172.failures) c172.failures[k] = true;
      c172.payload = +$('payload').value * FS.U.LB;
      const fuel = +$('fuel').value;
      c172.fuel = [fuel / 2, fuel / 2];
      ind.reset(c172, weather);
      if (!$('baro-auto').checked) ind.kollsman = 29.92;
      ap.hdgBug = ap.hdgBug || Math.round(c172.heading);
    } else {
      mcdu.go('MENU');
      Object.assign(a320.lights, { beacon: true, nav: true, strobe: false, landing: false, taxi: false, logo: true, wing: false, turnoff: false });
      a320.apCmd = null;
      sc.setup();
      for (const m of tcas.intruders) trafficModels.push(new FS.TrafficModel(scenery.scene, 0xf0f0f0));
      if (failBoxes.hydGY && failBoxes.hydGY.checked) sys.failHydraulics(['G', 'Y']);
    }
    S.flightTime = 0;
    S.track = [];
    S.lastTouch = 0;
    S.airborneTime = ac.onGround ? 0 : 60;
    S.crashShown = false;
    $('crash').classList.add('hidden');
    $('report').classList.add('hidden');
    if (S.randomFailures && !S.pendingFailure) {
      const opts = sc.acType === 'c172' ? [['vacuum', 'VACUUM PUMP FAILED'], ['pitot', ''], ['static', ''], ['alternator', 'ALTERNATOR FAILED'], ['engine', 'ENGINE FAILURE!']] : [['eng1', 'ENG 1 FAIL'], ['hydGY', 'HYD G+Y'], ['hydB', 'HYD B']];
      const f = opts[Math.floor(Math.random() * opts.length)];
      S.pendingFailure = { t: 90 + Math.random() * 600, key: f[0], msg: f[1] };
    }
    acc = 0;
    rig.set(rig.view && FS.VIEWS.includes(rig.view) ? rig.view : 'cockpit');
    layout();
    refreshMenu();
  }

  // ================================================================ init
  async function init() {
    renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, FS.DEVICE.mobile ? 1.5 : 2)); // phones/tablets: keep the frame rate up
    renderer.outputEncoding = THREE.sRGBEncoding;
    camera = new THREE.PerspectiveCamera(60, 1, 0.3, 200000);
    weather = new FS.Weather('fair');
    env = { weather, terrain: null };
    // aircraft & avionics (world independent)
    c172 = new FS.Aircraft();
    ind = new FS.Instruments();
    ap = new FS.Autopilot();
    nav1 = new FS.NavReceiver(110.3, 113.9, 270);
    nav2 = new FS.NavReceiver(113.9, 116.4, 90);
    adf = new FS.ADFReceiver(356);
    marker = new FS.MarkerReceiver();
    panel = new FS.Panel($('panel'));
    a320 = new FS.A320();
    sys = new FS.A320Systems(a320);
    tcas = new FS.TCAS();
    rx.ils = new FS.NavReceiver(109.9, 110.7, 285);
    rx.vor1 = new FS.NavReceiver(115.3, 116.95, 290);
    rx.vor2 = new FS.NavReceiver(116.95, 115.3, 0);
    rx.adf1 = new FS.ADFReceiver(373);
    rx.adf2 = new FS.ADFReceiver(358);
    mcdu = new FS.MCDU($('mcdu'), null, () => a320);
    rig = new FS.CameraRig(camera);
    input = new FS.Input();
    audio = new FS.Audio();
    tcas.onAural = (t) => audio.speak(t, { interrupt: true, rate: 1.2, pitch: 1 });
    cockpit = new FS.A320Cockpit($('panel320'), $('ovhd'), $('mcdu'), {
      getAc: () => a320,
      fm: () => fm,
      moveThrottle: (d) => moveTla(d, true),
      toggleMcdu,
      toggleOvhd,
      comStation: (f) => (FS.AIRPORTS.flatMap((a) => a.comms || []).find((c) => Math.abs(c.freq - f) < 0.004) || null),
      onComTune: (f) => {
        const c = FS.AIRPORTS.flatMap((a) => a.comms || []).find((x) => Math.abs(x.freq - f) < 0.004);
        if (c && c.type === 'ATIS') playAtis();
        else if (c) banner(`${c.name} ${f.toFixed(3)}`, 2);
      },
      pushback: startPushback,
      toggleJetway: () => (S.jetway = !S.jetway),
      playAtis,
      onToConfig: (ok) => {
        if (ok) audio.cChord();
        else audio.tone([1500], 0.6, 0.1, 'square');
        banner(ok ? 'T.O CONFIG NORMAL' : 'T.O CONFIG FAULT', 2, !ok);
      },
      onMasterWarn: () => (audio.crcOn = false),
      get jetway() {
        return S.jetway;
      },
      get pushState() {
        return S.push ? S.push.phase : null;
      },
    });
    input.onKey = onKey;
    input.onMessage = (m) => banner(m, 3);
    touch = new FS.TouchControls($('touch'), { input, lever: touchLever() });
    setupTouchPref();
    if (FS.DEVICE.phone) S.showPanel = false; // phones start with the outside view; PANEL shows the instruments
    buildMenu();
    setupMouse();
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 300));
    // iOS: no page pinch-zoom; resume audio after the app was in the background (needs a touch)
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('pointerdown', () => audio.ctx && audio.ctx.state !== 'running' && audio.ctx.resume(), true);
    const sc = SCENARIOS.find((s) => s.id === S.scenario);
    applyScenarioWeather(sc);
    await loadScenario(S.scenario);
    layout();
    $('loading').classList.add('hidden');
    showMenu(true);
    requestAnimationFrame(loop);
  }

  // ================================================================ layout
  // phones (short screens): compact A320 panel (displays or pedestal), stick & thrust lever beside the panel
  const isCompact = () => window.innerHeight < 560;
  function touchSide() {
    if (!touch.enabled || !touch.showSticks || !isCompact() || (S.acType === 'a320' && cockpit.pedPage)) return 0;
    return Math.round(FS.clamp(window.innerWidth * 0.15, 100, 140));
  }
  function panelHeight(side) {
    const W = window.innerWidth,
      H = window.innerHeight;
    if (S.acType === 'a320') {
      if (!isCompact()) return Math.round(FS.clamp(H * 0.58, 330, 680));
      const glH = Math.min(46, (W / 1040) * 46); // as in A320Cockpit.draw
      if (cockpit.pedPage) return Math.round(glH + 4 + Math.min(H * 0.62 - glH - 4, (W / 800) * 130));
      return Math.round(glH + 8 + Math.min(H * 0.62 - glH - 8, (W - 2 * side - 20) / 4.12));
    }
    return Math.round(isCompact() ? H * 0.5 : FS.clamp(H * 0.4, 220, 470));
  }
  function layout() {
    const W = window.innerWidth,
      H = window.innerHeight;
    renderer.setSize(W, H);
    if (!isCompact()) cockpit.pedPage = false;
    const showPanel = rig.view === 'cockpit' && S.showPanel;
    const side = showPanel ? touchSide() : 0;
    const ph = showPanel ? panelHeight(side) : 0;
    $('panel').style.display = showPanel && S.acType === 'c172' ? 'block' : 'none';
    $('panel320').style.display = showPanel && S.acType === 'a320' ? 'block' : 'none';
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (showPanel && S.acType === 'c172') {
      panel.resize(W - 2 * side, ph, dpr);
      $('panel').style.left = side + 'px';
    }
    if (showPanel && S.acType === 'a320') {
      cockpit.compact = isCompact();
      cockpit.side = side;
      cockpit.resize(W, ph, dpr);
    }
    document.body.classList.toggle('compact', isCompact());
    document.body.classList.toggle('panel-on', showPanel);
    touch.layout({ W, H, ph, side, hideSticks: showPanel && S.acType === 'a320' && cockpit.pedPage });
    const hfov = (S.acType === 'a320' ? 84 : 78) * DEG;
    if (showPanel) {
      const c = (H - ph) * (S.acType === 'a320' ? 0.5 : 0.52);
      const V = 2 * (H - c);
      camera.aspect = W / V;
      camera.setViewOffset(W, V, 0, V - H, W, H);
      S.fovBase = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * RAD;
    } else {
      camera.clearViewOffset();
      camera.aspect = W / H;
      const h = rig.view === 'cockpit-wide' ? hfov : 62 * DEG;
      S.fovBase = 2 * Math.atan(Math.tan(h / 2) / camera.aspect) * RAD;
    }
    camera.fov = S.fovBase;
    camera.updateProjectionMatrix();
    S.viewH = H - ph;
    const m = $('map');
    m.width = W * 0.8;
    m.height = Math.max(160, (H - ph) * 0.9 - (touch.enabled ? 60 : 0));
    const mc = $('mcdu');
    mc.width = 440;
    mc.height = 660;
    const ov = $('ovhd');
    const top = touch.enabled ? 56 : 20; // below the touch toolbar
    ov.width = Math.round(Math.min(W - 20, 1000, (H - top - 10) / 0.58));
    ov.height = Math.round(ov.width * 0.58);
  }
  function toggleMcdu() {
    const el = $('mcdu');
    el.classList.toggle('hidden');
    mcdu.focus = !el.classList.contains('hidden');
  }
  function toggleOvhd() {
    $('ovhd').classList.toggle('hidden');
  }

  // ================================================================ input
  function onKey(e) {
    const c = e.code;
    if (S.acType === 'a320' && !$('mcdu').classList.contains('hidden') && mcdu.focus && !S.menuOpen) {
      if (c === 'F2') {
        toggleMcdu();
        e.preventDefault();
        return;
      }
      if (mcdu.typeKey(e)) return;
    }
    if (c === 'Escape') {
      showMenu(!S.menuOpen);
      return;
    }
    if (S.menuOpen) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Tab', 'Home', 'End', 'Slash', 'F1', 'F2', 'F3', 'F4'].includes(c)) e.preventDefault();
    if (e.repeat && !['Comma', 'Period', 'BracketLeft', 'BracketRight'].includes(c)) return;
    const sh = e.shiftKey;
    // ---- common keys
    switch (c) {
      case 'KeyP': S.paused = !S.paused; return;
      case 'KeyC': rig.cycle(sh ? -1 : 1); layout(); banner(FS.VIEW_NAMES[rig.view], 1.2); return;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': case 'Digit0': {
        const i = c === 'Digit0' ? 9 : +c.slice(5) - 1;
        rig.set(FS.VIEWS[i]);
        layout();
        banner(FS.VIEW_NAMES[rig.view], 1.2);
        return;
      }
      case 'Tab': togglePanel(); return;
      case 'KeyM': S.showMap = !S.showMap; $('map').classList.toggle('hidden', !S.showMap); return;
      case 'KeyI': S.showInfo = !S.showInfo; $('hud-info').classList.toggle('hidden', !S.showInfo); return;
      case 'KeyY': input.mouseYoke = !input.mouseYoke; banner('Mouse ' + (S.acType === 'a320' ? 'sidestick' : 'yoke') + (input.mouseYoke ? ' ON' : ' OFF'), 2); return;
      case 'KeyU': audio.enabled = !audio.enabled; banner('Sound ' + (audio.enabled ? 'on' : 'off'), 1.2); return;
      case 'KeyK': ac.ctl.parkingBrake = !ac.ctl.parkingBrake; banner('Parking brake ' + (ac.ctl.parkingBrake ? 'SET' : 'RELEASED'), 1.2); return;
      case 'KeyL': ac.lights.landing = !ac.lights.landing; banner('Landing lights ' + (ac.lights.landing ? 'ON' : 'OFF'), 1.2); return;
      case 'Space': rig.set(rig.view); return;
      case 'Enter': if (ac.crashed) loadScenario(S.scenario); return;
    }
    if (c === 'KeyR' && sh) {
      loadScenario(S.scenario);
      banner('Scenario restarted', 2);
      return;
    }
    if (S.acType === 'a320') return onKey320(e, c, sh);
    // ---- Cessna keys
    switch (c) {
      case 'KeyF': ac.ctl.flaps = FS.clamp(ac.ctl.flaps + (sh ? -1 : 1), 0, 3); banner('Flaps ' + ac.ctl.flaps * 10 + '°', 1.2); break;
      case 'KeyR': ac.ctl.flaps = FS.clamp(ac.ctl.flaps - 1, 0, 3); banner('Flaps ' + ac.ctl.flaps * 10 + '°', 1.2); break;
      case 'KeyZ': ap.press('AP', ac, ind.altFt); break;
      case 'KeyG': ind.syncDG(); banner('Heading indicator synced to compass', 1.5); break;
      case 'KeyH': ac.ctl.carbHeat = !ac.ctl.carbHeat; banner('Carb heat ' + (ac.ctl.carbHeat ? 'ON' : 'OFF'), 1.2); break;
      case 'KeyJ': ac.pitotHeat = !ac.pitotHeat; banner('Pitot heat ' + (ac.pitotHeat ? 'ON' : 'OFF'), 1.2); break;
      case 'KeyN': nav1.swap(); break;
      case 'KeyB': if (sh) { ind.kollsman = +(weather.qnh / FS.U.HPA_PER_INHG).toFixed(2); banner('Altimeter set ' + ind.kollsman.toFixed(2) + ' inHg', 1.5); } break;
      case 'Comma': if (sh) ap.hdgBug = FS.wrap360(ap.hdgBug - 1); else nav1.obs = FS.wrap360(nav1.obs - 1); break;
      case 'Period': if (sh) ap.hdgBug = FS.wrap360(ap.hdgBug + 1); else nav1.obs = FS.wrap360(nav1.obs + 1); break;
    }
  }
  function onKey320(e, c, sh) {
    const k = a320.ctl;
    const names = ['0', '1', '2', '3', 'FULL'];
    switch (c) {
      case 'KeyF': k.flapLever = FS.clamp(k.flapLever + 1, 0, 4); banner('FLAPS ' + names[k.flapLever], 1.2); break;
      case 'KeyR': k.flapLever = FS.clamp(k.flapLever - 1, 0, 4); banner('FLAPS ' + names[k.flapLever], 1.2); break;
      case 'KeyG': k.gearLever = k.gearLever === 'DOWN' ? 'UP' : 'DOWN'; banner('Gear ' + k.gearLever, 1.2); break;
      case 'Slash':
        if (sh) {
          k.spoilersArmed = !k.spoilersArmed;
          k.speedBrake = 0;
          banner('Ground spoilers ' + (k.spoilersArmed ? 'ARMED' : 'DISARMED'), 1.2);
        } else {
          k.speedBrake = k.speedBrake < 0.25 ? 0.5 : k.speedBrake < 0.75 ? 1 : 0;
          k.spoilersArmed = false;
          banner('Speed brake ' + ['RET', '1/2', 'FULL'][Math.round(k.speedBrake * 2)], 1.2);
        }
        break;
      case 'KeyZ': fm.press(sh ? 'ATHR' : 'AP1'); break;
      case 'KeyX':
        if (sh) fm.instinctiveATHRDisc();
        else fm.instinctiveAPDisc();
        break;
      case 'Equal': case 'NumpadAdd': case 'PageUp':
        if (sh) jumpDetent(1);
        break;
      case 'Minus': case 'NumpadSubtract': case 'PageDown':
        if (sh) jumpDetent(-1);
        break;
      case 'F2': toggleMcdu(); break;
      case 'F3': toggleOvhd(); break;
      case 'F4': fm.fcu.ls[0] = !fm.fcu.ls[0]; break;
      case 'KeyA': if (sh) fm.press('APPR'); break;
      case 'KeyV': if (sh) fm.press('LOC'); break;
      case 'KeyT': k.gravityExt = sh ? true : k.gravityExt; if (sh) banner('Gravity gear extension', 1.5); break;
    }
  }
  function togglePanel() {
    if (!rig.isCockpit) {
      // from an outside view: go to the cockpit with the panel
      rig.set('cockpit');
      S.showPanel = true;
    } else if (S.acType === 'a320' && isCompact() && S.showPanel && rig.view === 'cockpit' && !cockpit.pedPage) {
      // phones: displays → pedestal → off
      cockpit.pedPage = true;
      banner('Panel: pedestal (sidestick, thrust, flaps, engines)', 1.5);
    } else {
      S.showPanel = !S.showPanel;
      cockpit.pedPage = false;
      if (rig.view === 'cockpit-wide') rig.set('cockpit');
    }
    layout();
  }

  // ---------------- touch controls
  function touchLever() {
    return {
      get: () => (S.acType === 'a320' ? (Math.max(...a320.ctl.tla) + 20) / 65 : c172.ctl.throttle),
      set: (f) => {
        if (S.acType !== 'a320') return (c172.ctl.throttle = f);
        let v = f * 65 - 20;
        const d = [0, 25, 35, 45].find((x) => Math.abs(v - x) < 2.5); // detents catch the lever
        if (d != null) v = d;
        if (v < 0 && !a320.onGround) v = 0;
        a320.ctl.tla = [v, v];
      },
      marks: () => (S.acType === 'a320' ? [[45, 'TOGA'], [35, 'FLX'], [25, 'CL'], [0, 'IDLE'], [-20, 'REV']].map(([v, l]) => [(v + 20) / 65, l]) : [[1, 'FULL'], [0, 'IDLE']]),
    };
  }
  function touchButtons() {
    const bar = [
      { label: '☰', key: 'Escape', title: 'Menu' },
      { label: '❚❚', key: 'KeyP', title: 'Pause', on: () => S.paused },
      { label: 'VIEW', key: 'KeyC', title: 'Next view (outside / cockpit)' },
      { label: 'PANEL', key: 'Tab', title: 'Instrument panel', on: () => S.showPanel && rig.view === 'cockpit' },
      { label: 'MAP', key: 'KeyM', title: 'Moving map', on: () => S.showMap },
    ];
    const common = [
      { label: 'PARK BRK', key: 'KeyK', on: () => ac.ctl.parkingBrake },
      { label: 'LAND LT', key: 'KeyL', on: () => ac.lights.landing },
      { label: 'TRIM ▲', key: 'BracketRight', hold: true, title: 'Pitch trim nose up' },
      { label: 'TRIM ▼', key: 'BracketLeft', hold: true, title: 'Pitch trim nose down' },
      { label: 'INFO', key: 'KeyI', on: () => S.showInfo },
      { label: 'SOUND', key: 'KeyU', on: () => audio.enabled },
      { label: 'STICKS', fn: () => ((touch.showSticks = !touch.showSticks), layout()), on: () => touch.showSticks, title: 'Show / hide the on-screen stick and thrust lever' },
      { label: 'RESTART', key: 'KeyR', shift: true },
    ];
    if (S.acType === 'a320') {
      bar.push({ label: 'MCDU', key: 'F2', on: () => !$('mcdu').classList.contains('hidden') }, { label: 'OVHD', key: 'F3', on: () => !$('ovhd').classList.contains('hidden') });
      return {
        bar,
        quick: [
          { label: 'BRK', key: 'KeyB', hold: true, title: 'Brakes (hold)' },
          { label: 'FLAP −', key: 'KeyR' },
          { label: 'FLAP +', key: 'KeyF' },
          { label: 'GEAR', key: 'KeyG', on: () => a320.ctl.gearLever === 'DOWN' },
          { label: 'AP1', key: 'KeyZ', on: () => fm.fcu.ap1 },
          { label: 'A/THR', key: 'KeyZ', shift: true, on: () => fm.fcu.athr },
        ],
        more: [
          { label: 'AP OFF', key: 'KeyX' },
          { label: 'ATHR OFF', key: 'KeyX', shift: true },
          { label: 'APPR', key: 'KeyA', shift: true, on: () => fm.fcu.appr },
          { label: 'LOC', key: 'KeyV', shift: true, on: () => fm.fcu.loc },
          { label: 'LS', key: 'F4', on: () => fm.fcu.ls[0] },
          { label: 'SPD BRK', key: 'Slash', on: () => a320.ctl.speedBrake > 0 },
          { label: 'ARM SPLR', key: 'Slash', shift: true, on: () => a320.ctl.spoilersArmed },
          { label: 'GRAV GEAR', key: 'KeyT', shift: true },
          ...common,
        ],
      };
    }
    return {
      bar,
      quick: [
        { label: 'BRK', key: 'KeyB', hold: true, title: 'Brakes (hold)' },
        { label: 'FLAP −', key: 'KeyR' },
        { label: 'FLAP +', key: 'KeyF' },
        { label: 'AP', key: 'KeyZ', on: () => ap.on },
        { label: 'TRIM ▲', key: 'BracketRight', hold: true },
        { label: 'TRIM ▼', key: 'BracketLeft', hold: true },
      ],
      more: [
        { label: 'STARTER', key: 'KeyX', hold: true, title: 'Hold to crank' },
        { label: 'MIX +', key: 'Equal', shift: true, hold: true },
        { label: 'MIX −', key: 'Minus', shift: true, hold: true },
        { label: 'CARB HT', key: 'KeyH', on: () => c172.ctl.carbHeat },
        { label: 'PITOT HT', key: 'KeyJ', on: () => c172.pitotHeat },
        { label: 'SYNC DG', key: 'KeyG' },
        { label: 'NAV SWAP', key: 'KeyN' },
        { label: 'SET ALTM', key: 'KeyB', shift: true, title: 'Altimeter to ATIS QNH' },
        { label: 'OBS −', key: 'Comma', repeat: true },
        { label: 'OBS +', key: 'Period', repeat: true },
        { label: 'HDG −', key: 'Comma', shift: true, repeat: true },
        { label: 'HDG +', key: 'Period', shift: true, repeat: true },
        ...common.filter((b) => !b.label.startsWith('TRIM')),
      ],
    };
  }
  function setupTouchPref() {
    const box = $('touch-ui');
    let pref = null;
    try {
      pref = localStorage.getItem('fs.touchUI');
    } catch (_) {}
    box.checked = pref != null ? pref === '1' : FS.DEVICE.mobile;
    touch.setEnabled(box.checked);
    box.onchange = () => {
      touch.setEnabled(box.checked);
      try {
        localStorage.setItem('fs.touchUI', box.checked ? '1' : '0');
      } catch (_) {}
      layout();
    };
  }

  const DETENTS = [-20, 0, 25, 35, 45];
  function jumpDetent(d) {
    const k = a320.ctl;
    const cur = Math.max(...k.tla);
    let i = DETENTS.findIndex((x) => x >= cur - 0.5);
    if (d > 0) i = DETENTS.findIndex((x) => x > cur + 0.5);
    else i = [...DETENTS].reverse().findIndex((x) => x < cur - 0.5), (i = i < 0 ? -1 : DETENTS.length - 1 - i);
    if (i < 0) return;
    let v = DETENTS[i];
    if (v < 0 && !a320.onGround) v = 0;
    k.tla = [v, v];
    banner({ '-20': 'MAX REVERSE', 0: 'IDLE', 25: 'CL', 35: 'FLX/MCT', 45: 'TOGA' }[v], 1);
  }
  function moveTla(d, mouse) {
    const k = a320.ctl;
    if (S.detHold > 0 && !mouse) return;
    for (let i = 0; i < 2; i++) {
      const t = k.tla[i];
      let nt = t + d;
      if (!a320.onGround && nt < 0) nt = 0;
      for (const dd of [0, 25, 35, 45])
        if ((t < dd - 0.01 && nt >= dd) || (t > dd + 0.01 && nt <= dd)) {
          nt = dd;
          S.detHold = 0.35;
        }
      k.tla[i] = FS.clamp(nt, -20, 45);
    }
  }

  // mouse & touch on the 3D view: drag to look, wheel / pinch to zoom, double-click / double-tap to recenter
  function setupMouse() {
    const v = $('view');
    const pinchable = (el, onDrag, onPinch) => {
      const pts = new Map();
      let spread = 0;
      const dist = () => {
        const [a, b] = [...pts.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
      };
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', (e) => {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try {
          el.setPointerCapture(e.pointerId);
        } catch (_) {}
        spread = pts.size === 2 ? dist() : 0;
      });
      el.addEventListener('pointermove', (e) => {
        const p = pts.get(e.pointerId);
        if (!p) return;
        if (pts.size === 1 && onDrag) onDrag(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
        if (pts.size === 2 && spread) {
          const d = dist();
          if (Math.abs(d / spread - 1) > 0.08) {
            onPinch(d / spread);
            spread = d;
          }
        }
      });
      const up = (e) => {
        pts.delete(e.pointerId);
        spread = pts.size === 2 ? dist() : 0;
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    let lastTap = 0;
    v.addEventListener('pointerdown', (e) => {
      if (mcdu) mcdu.focus = false;
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      const now = performance.now();
      if (now - lastTap < 300) rig.set(rig.view);
      lastTap = now;
    });
    pinchable(v, (dx, dy) => !input.mouseYoke && rig.drag(dx, dy), (k) => rig.wheel(k > 1 ? -1 : 1));
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      rig.wheel(e.deltaY);
    }, { passive: false });
    v.addEventListener('dblclick', () => rig.set(rig.view));
    $('map').addEventListener('wheel', (e) => {
      e.preventDefault();
      S.mapScale = FS.clamp(S.mapScale * (e.deltaY < 0 ? 1.25 : 0.8), 0.001, 0.3);
    }, { passive: false });
    pinchable($('map'), null, (k) => (S.mapScale = FS.clamp(S.mapScale * k, 0.001, 0.3)));
  }

  // ---------------- control application
  function applyControls172(dt, cmd) {
    const c = c172.ctl;
    const k = (...codes) => input.down(...codes);
    if (!ap.on) {
      c.elevator = cmd.pitch;
      c.aileron = cmd.roll;
    } else if (Math.abs(cmd.pitch) > 0.45 || Math.abs(cmd.roll) > 0.45) {
      ap.disengage('AP DISCONNECT');
      audio.beep(880, 0.6, 0.12);
    }
    let yaw = cmd.yaw;
    if (S.autoRudder && !c172.onGround && Math.abs(yaw) < 0.05 && c172.tas > 20) yaw = FS.clamp(7 * c172.beta - 0.4 * c172.omega.z + 0.25 * c.aileron * 0.4, -1, 1);
    c.rudder = yaw;
    const up = k('Equal', 'PageUp', 'NumpadAdd'),
      dn = k('Minus', 'PageDown', 'NumpadSubtract');
    const sh = k('ShiftLeft', 'ShiftRight');
    if (up || dn) {
      const d = (up ? 1 : -1) * dt;
      if (sh) c.mixture = FS.clamp(c.mixture + d * 0.25, 0, 1);
      else c.throttle = FS.clamp(c.throttle + d * 0.45, 0, 1);
    }
    if (cmd.throttle != null) c.throttle = cmd.throttle;
    else if (cmd.throttleRate) c.throttle = FS.clamp(c.throttle + cmd.throttleRate * dt, 0, 1);
    if (k('BracketLeft', 'Home')) c.trim = FS.clamp(c.trim - 0.18 * dt, -1, 1);
    if (k('BracketRight', 'End')) c.trim = FS.clamp(c.trim + 0.18 * dt, -1, 1);
    const br = k('KeyB') && !sh ? 1 : cmd.brake || 0;
    c.brakeL = c.brakeR = br;
    if (k('KeyX')) c.mags = 4;
    else if (c.mags === 4) c.mags = 3;
  }
  function applyControls320(dt, cmd) {
    const c = a320.ctl;
    const k = (...codes) => input.down(...codes);
    let pitch = cmd.pitch,
      roll = cmd.roll;
    const ms = cockpit.env.mouseStick;
    if (ms) {
      pitch = ms.pitch;
      roll = ms.roll;
    }
    c.stickPitch = pitch;
    c.stickRoll = roll;
    if (fm.anyAP() && (Math.abs(pitch) > 0.35 || Math.abs(roll) > 0.35)) {
      fm.apOff(false);
      banner('AP OFF (sidestick takeover)', 2);
    }
    c.rudder = cmd.yaw;
    S.detHold -= dt;
    const sh = k('ShiftLeft', 'ShiftRight');
    if (!sh) {
      if (k('Equal', 'PageUp', 'NumpadAdd')) moveTla(22 * dt);
      else if (k('Minus', 'PageDown', 'NumpadSubtract')) moveTla(-22 * dt);
      else S.detHold = 0;
    }
    if (cmd.throttle != null) c.tla = [cmd.throttle * 45, cmd.throttle * 45];
    else if (cmd.throttleRate) moveTla(cmd.throttleRate * 40 * dt);
    c.trimCmd = k('BracketLeft', 'Home') ? -1 : k('BracketRight', 'End') ? 1 : 0;
    const br = (k('KeyB') && !sh) || sys.chocks ? 1 : cmd.brake || 0;
    c.brakeL = c.brakeR = br;
    if (br > 0.5 && a320.autobrakeActive && !sys.chocks) a320.autobrakeActive = false;
  }

  // ================================================================ loop
  let hudTimer = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (S.building || !scenery || !ac) return;
    const running = S.started && !S.paused && !S.menuOpen && !ac.crashed;
    const cmd = input.update(dt, { w: window.innerWidth, h: S.viewH || window.innerHeight });
    if (running) {
      if (S.acType === 'a320') step320(dt, cmd);
      else step172(dt, cmd);
      S.hours = (S.hours + dt / 3600) % 24;
      if (!ac.onGround) S.airborneTime += dt;
      if (!ac.onGround || (ac.eng.running !== undefined ? ac.eng.running : ac.eng[0].running)) S.flightTime += dt;
      events(dt);
    }
    if (ac.crashed && !S.crashShown) showCrash();
    // ---- render
    const cockpitMode = rig.isCockpit ? (rig.view === 'cockpit-wide' || !S.showPanel ? 'wide' : 'panel') : false;
    if (S.acType === 'a320') {
      model320.update(dt, a320, terrain, scenery.sunDir, scenery.night || 0, cockpitMode);
      tcas.intruders.forEach((t, i) => trafficModels[i] && trafficModels[i].update(t));
      scenery.updateJetways(dt, a320, S.jetway);
    } else model172.update(dt, c172, terrain, scenery.sunDir, scenery.night || 0, cockpitMode);
    rig.update(dt, ac, null, terrain, S.fovBase);
    scenery.update(dt, { camera, weather, ac, hours: S.hours });
    renderer.render(scenery.scene, camera);
    if (rig.view === 'cockpit' && S.showPanel) {
      if (S.acType === 'a320') cockpit.draw(dispState());
      else panel.draw(panelState());
    }
    if (S.acType === 'a320') {
      if (!$('mcdu').classList.contains('hidden')) {
        mcdu.hoursNow = S.hours;
        mcdu.draw();
      }
      if (!$('ovhd').classList.contains('hidden')) cockpit.drawOverhead(dispState());
    }
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.1;
      updateHUD();
      touch.update(S.started && !S.menuOpen && !S.building, { mcdu: !$('mcdu').classList.contains('hidden'), ovhd: !$('ovhd').classList.contains('hidden') });
    }
    if (S.showMap) drawMap();
    const camDist = camera.position.distanceTo(new THREE.Vector3(ac.pos.y, -ac.pos.z, -ac.pos.x));
    if (S.acType === 'a320') {
      audio.crcOn = running && sys.fwc.crc && sys.fwc.mw;
      audio.jetUpdate(dt, { ac: a320, cockpit: rig.isCockpit, camDist, paused: !running });
    } else audio.update(dt, { ac: c172, cockpit: rig.isCockpit, stallHorn: c172.stallWarn && !c172.crashed, marker: marker.active, paused: !running, camDist, weather });
    $('frost').style.opacity = FS.clamp((ac.ice || 0) / 14, 0, 0.85).toFixed(2);
    $('paused').classList.toggle('hidden', !(S.paused && S.started && !S.menuOpen));
  }

  function step172(dt, cmd) {
    applyControls172(dt, cmd);
    acc += dt;
    let n = 0;
    while (acc >= PHYS_DT && n < 60) {
      c172.step(PHYS_DT, env);
      acc -= PHYS_DT;
      n++;
    }
    ind.update(dt, c172, weather);
    const pos = { n: c172.pos.x, e: c172.pos.y };
    const av = ind.avionicsPower;
    nav1.tune(navaids, pos, c172.alt, dt, av);
    nav1.out.obs = nav1.obs;
    nav2.tune(navaids, pos, c172.alt, dt, av);
    nav2.out.obs = nav2.obs;
    adf.tune(navaids, pos, c172.alt, c172.heading, dt, av);
    marker.update(navaids, pos, c172.alt, av);
    ap.update(dt, c172, nav1.out, ind.altFt, ind.dg);
  }

  function step320(dt, cmd) {
    applyControls320(dt, cmd);
    const sysEnv = { weather, terrain, originElev: FS.AIRPORTS[0].elev, destElev: fm.d.to && fm.db.airports.get(fm.d.to) ? fm.db.airports.get(fm.d.to).elev : null };
    sys.update(dt, a320, sysEnv);
    // radios
    const pos = { n: a320.pos.x, e: a320.pos.y };
    const pw = sys.elec.acPowered;
    const R = fm.radio;
    rx.ils.active = R.ils.freq;
    const ils = rx.ils.tune(navaids, pos, a320.alt, dt, pw);
    rx.vor1.active = R.vor1.freq;
    rx.vor1.obs = R.vor1.crs;
    const v1 = rx.vor1.tune(navaids, pos, a320.alt, dt, pw);
    rx.vor2.active = R.vor2.freq;
    rx.vor2.obs = R.vor2.crs;
    const v2 = rx.vor2.tune(navaids, pos, a320.alt, dt, pw);
    for (const o of [ils, v1, v2]) if (o.station) o.brgTrue = FS.bearingTo(pos.n, pos.e, o.station.n, o.station.e);
    rx.adf1.freq = R.adf1;
    rx.adf2.freq = R.adf2;
    rx.adf1.tune(navaids, pos, a320.alt, a320.heading, dt, pw);
    rx.adf2.tune(navaids, pos, a320.alt, a320.heading, dt, pw);
    for (const a of [rx.adf1, rx.adf2]) a.brgTrue = a.valid ? FS.wrap360(a320.heading + a.needle) : null;
    rx.out = { ils, v1, v2 };
    a320.indAltFt = FS.a320IndAlt({ ac: a320, fm }, 0);
    // pushback
    if (S.push) pushbackStep(dt);
    acc += dt;
    let n = 0;
    while (acc >= PHYS_DT && n < 60) {
      if (S.push) {
        a320.vel.x = -1.3;
        a320.vel.y = 0;
        a320.omega.z = S.push.phase === 'TURN' ? 0.032 : 0;
        a320.ctl.brakeL = a320.ctl.brakeR = 0;
      }
      a320.step(PHYS_DT, env);
      acc -= PHYS_DT;
      n++;
    }
    fm.update(dt, a320, { ils }, env);
    tcas.update(dt, a320);
    callouts(dt);
    if (sys.chime === 'SC') audio.singleChime();
    if (sys.chime === 'CAVALRY') audio.cavalry();
    sys.chime = null;
  }

  // ---------------- pushback
  function startPushback() {
    if (S.acType !== 'a320' || !a320.onGround || a320.gs > 1) return banner('Pushback not possible now', 2);
    if (S.push) {
      S.push = null;
      return banner('Pushback stopped', 2);
    }
    if (a320.ctl.parkingBrake) return banner('Release the parking brake for pushback', 2.5, true);
    S.jetway = false;
    sys.chocks = false;
    sys.gpu = false;
    S.push = { phase: 'STRAIGHT', dist: 0, hdg0: a320.heading };
    banner('Pushback started — "brakes released, cleared to push"', 3);
    audio.speak('Brakes released, pushing back', { rate: 1.1 });
  }
  function pushbackStep(dt) {
    const P = S.push;
    P.dist += 1.3 * dt;
    if (P.phase === 'STRAIGHT' && P.dist > 45) P.phase = 'TURN';
    if (P.phase === 'TURN' && Math.abs(FS.wrap180(a320.heading - P.hdg0)) > 88) {
      S.push = null;
      a320.vel.set(0, 0, a320.vel.z);
      a320.omega.set(0, 0, 0);
      banner('Pushback complete — set PARKING BRAKE, start engines', 4);
      audio.speak('Pushback complete, set parking brake', { rate: 1.1 });
    }
  }

  // ---------------- callouts
  const RA_CALLS = [[2500, 'twenty five hundred'], [1000, 'one thousand'], [500, 'five hundred'], [400, 'four hundred'], [300, 'three hundred'], [200, 'two hundred'], [100, 'one hundred'], [50, 'fifty'], [40, 'forty'], [30, 'thirty'], [20, 'twenty'], [10, 'ten']];
  function callouts(dt) {
    const ra = a320.ra / FT;
    if (a320.onGround || a320.vs > 3) {
      if (a320.onGround) S.calls = {};
      S.lastRa = ra;
      return;
    }
    for (const [h, w] of RA_CALLS) {
      if (S.lastRa > h && ra <= h && !S.calls[h]) {
        S.calls[h] = true;
        if (h === 1000 && ra > 900 && a320.vs > -1) continue;
        audio.speak(w, { interrupt: h <= 50, rate: 1.25 });
      }
    }
    const dh = fm.d.dh;
    if (dh != null) {
      if (S.lastRa > dh + 100 && ra <= dh + 100) audio.speak('hundred above', { interrupt: true });
      if (S.lastRa > dh && ra <= dh) {
        audio.speak('minimum', { interrupt: true });
        S.dhFlash = 3;
      }
    }
    const idle = Math.max(...a320.ctl.tla) < 1;
    if (ra < 20 && ra > 1 && !idle && !fm.anyAP()) {
      S.retardT = (S.retardT || 0) - dt;
      if (S.retardT <= 0) {
        audio.speak('retard', { interrupt: true, rate: 1.3 });
        S.retardT = 1.2;
      }
    }
    if (a320.stallWarn) {
      S.stallT = (S.stallT || 0) - dt;
      if (S.stallT <= 0) {
        audio.speak('stall, stall', { interrupt: true, rate: 1.4 });
        S.stallT = 1.6;
      }
    }
    S.lastRa = ra;
  }

  // ---------------- ATIS
  const PHON = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett'];
  function playAtis() {
    const ap1 = FS.AIRPORTS[0];
    const letter = PHON[Math.floor(S.hours) % PHON.length];
    const dig = (n, l) => String(Math.round(n)).padStart(l || 1, '0').split('').map((d) => ({ 9: 'niner' }[d] || d)).join(' ');
    const w = weather;
    const rwy = FS.WORLD.id === 'tehran' ? 'two niner left and two niner right' : 'two seven';
    const utc = (S.hours - (FS.WORLD.id === 'tehran' ? 3.5 : 0) + 24) % 24;
    const txt = `${ap1.name.replace('Intl', 'international')} information ${letter}. Time ${dig(Math.floor(utc), 2)} ${dig(Math.floor((utc % 1) * 60), 2)} zulu. ` +
      `Runway in use ${rwy}. Expect I L S approach. Wind ${dig(Math.round(w.windDir / 10) * 10, 3)} degrees, ${Math.round(w.windKt)} knots${w.gustKt > w.windKt + 4 ? ', gusting ' + Math.round(w.gustKt) : ''}. ` +
      `Visibility ${w.vis >= 10000 ? '10 kilometres or more' : Math.round(w.vis) + ' metres'}. ` +
      (w.cloudsCfg.length ? w.cloudsCfg.map((c) => `${['sky clear', 'few', 'few', 'scattered', 'scattered', 'broken', 'broken', 'broken', 'overcast'][c.cover]} ${Math.round(c.baseFt / 100) * 100} feet`).join(', ') + '. ' : 'No significant cloud. ') +
      `Temperature ${Math.round(w.tempC)}, dew point ${Math.round(w.dewC)}. Q N H ${dig(w.qnh)}. ` +
      (FS.WORLD.id === 'tehran' ? 'Transition level one one zero. ' : '') + `Advise on initial contact you have information ${letter}.`;
    audio.speak(txt, { interrupt: true, rate: 1.05, pitch: 1 });
    banner('ATIS: ' + weather.metar(ap1.icao, ap1.elev, S.hours), 8);
  }

  // ================================================================ state bundles for panels
  function panelState() {
    return { ac: c172, ind, ap, nav1, nav2, adf, marker: marker.active, stallHorn: c172.stallWarn && c172.hasPower(), hours: S.hours, flightTime: S.flightTime, night: scenery.night || 0 };
  }
  function dispState() {
    const o = rx.out || {};
    return {
      ac: a320, sys, fm, tcas, env, weather, hours: S.hours, powered: sys.displays,
      ils: o.ils, ilsFreq: fm.radio.ils.freq, vor1: o.v1, vor2: o.v2, adf1: rx.adf1, adf2: rx.adf2, navaids,
      stick: { pitch: a320.ctl.stickPitch, roll: a320.ctl.stickRoll }, apActive: fm.anyAP(), autoland: fm.lat.mode === 'LAND' && (a320.ra / FT < 200) && false,
      dhCallout: S.dhFlash > 0,
    };
  }

  // ================================================================ events
  function events(dt) {
    const pf = S.pendingFailure;
    if (pf) {
      if (pf.t != null) pf.t -= dt;
      const trig = (pf.t != null && pf.t <= 0) || (pf.ias != null && ac.ias >= pf.ias);
      if (trig) {
        if (S.acType === 'a320') {
          if (pf.key === 'hydGY') sys.failHydraulics(['G', 'Y']);
          else if (pf.key === 'hydB') sys.failHydraulics(['B']);
          else if (pf.key === 'eng1') a320.eng[0].failed = true;
          else if (pf.key === 'eng2') a320.eng[1].failed = true;
        } else c172.failures[pf.key] = true;
        if (pf.msg) banner(pf.msg, 4, true);
        S.pendingFailure = null;
      }
    }
    if (S.dhFlash > 0) S.dhFlash -= dt;
    if (ac.touchdown && ac.touchEvent !== S.lastTouch) {
      S.lastTouch = ac.touchEvent;
      if (S.airborneTime > 10) landingReport(ac.touchdown);
      S.airborneTime = 0;
      audio.thump && audio.thump(ac.touchdown.vsFpm / 600);
    }
    if (ac.warning) banner(ac.warning, 0.3, true);
    if (S.acType === 'c172' && ap.alert > 0 && ap.msg) banner(ap.msg, 0.3);
    // TCAS scenario debrief
    if (S.tcasCheck && tcas.raLog.length && !tcas.ra && tcas.cocTime && performance.now() - tcas.cocTime > 3000) {
      S.tcasCheck = false;
      const m = tcas.minSep;
      showReport(`<div class="grade" style="color:${m && m.v > 600 ? '#6f6' : '#fb3'}">TCAS event</div><table>` +
        `<tr><td>RA issued</td><td>${tcas.raLog.map((r) => r.type).join(' → ')}</td></tr>` +
        `<tr><td>Closest approach</td><td>${m ? m.h.toFixed(2) + ' nm / ' + Math.round(m.v) + ' ft' : '-'}</td></tr></table>`);
    }
    const tr = S.track;
    const lp = tr[tr.length - 1];
    if (!lp || Math.hypot(lp[0] - ac.pos.x, lp[1] - ac.pos.y) > 150) {
      tr.push([ac.pos.x, ac.pos.y]);
      if (tr.length > 3000) tr.shift();
    }
  }

  function nearestRunwayEnd(n, e) {
    let best = null;
    for (const ap2 of FS.AIRPORTS)
      for (const rw of ap2.runways)
        for (const t of rw.thr) {
          const h = t.hdg * DEG;
          const dn = n - t.n,
            de = e - t.e;
          const along = dn * Math.cos(h) + de * Math.sin(h);
          const cross = -dn * Math.sin(h) + de * Math.cos(h);
          if (along < -300 || along > rw.length + 100) continue;
          const score = Math.abs(cross) + FS.wrap180(t.hdg - ac.heading) ** 2 * 0.1;
          if (!best || score < best.score) best = { score, along, cross, t, rw, ap: ap2 };
        }
    return best;
  }
  function showReport(html) {
    const el = $('report');
    el.innerHTML = html;
    el.classList.remove('hidden');
    clearTimeout(S.reportTimer);
    S.reportTimer = setTimeout(() => el.classList.add('hidden'), 10000);
  }
  function landingReport(td) {
    const r = nearestRunwayEnd(ac.pos.x, ac.pos.y);
    const v = Math.abs(td.vsFpm);
    const jet = S.acType === 'a320';
    const lim = jet ? [100, 240, 400, 600] : [120, 300, 500, 750];
    const grade = v < lim[0] ? ['Butter!', '#6f6'] : v < lim[1] ? ['Smooth landing', '#9f9'] : v < lim[2] ? ['Firm landing', '#ff6'] : v < lim[3] ? ['Hard landing', '#f93'] : ['Very hard landing — inspect gear', '#f55'];
    let html = `<div class="grade" style="color:${grade[1]}">${grade[0]}</div><table>`;
    html += `<tr><td>Vertical speed</td><td>${Math.round(v)} fpm</td></tr><tr><td>Airspeed</td><td>${Math.round(td.ias)} ${jet ? 'KCAS' : 'KIAS'}</td></tr>`;
    html += `<tr><td>Pitch / bank</td><td>${(td.pitch * RAD).toFixed(1)}° / ${(td.bank * RAD).toFixed(1)}°</td></tr>`;
    if (jet) html += `<tr><td>Max G</td><td>${ac.maxG.toFixed(2)}</td></tr>`;
    if (r && Math.abs(r.cross) < r.rw.width / 2 + 3) {
      html += `<tr><td>Runway</td><td>${r.ap.icao} ${r.t.id}</td></tr><tr><td>From threshold</td><td>${Math.round(r.along)} m</td></tr>`;
      html += `<tr><td>Centreline</td><td>${Math.abs(r.cross).toFixed(1)} m ${r.cross > 0 ? 'right' : 'left'}</td></tr>`;
      if (r.along < 0) html += `<tr><td colspan=2 class="bad">Landed short of the threshold!</td></tr>`;
      if (jet && (r.along < 150 || r.along > 750)) html += `<tr><td colspan=2 class="bad">Outside the touchdown zone (150–750 m)</td></tr>`;
    } else html += `<tr><td colspan=2 class="bad">Off-runway landing</td></tr>`;
    if (Math.abs(td.crab) > 5) html += `<tr><td colspan=2 class="bad">Side-load: touched down ${Math.abs(td.crab).toFixed(0)}° crabbed</td></tr>`;
    if (jet && ac.tailStrike) html += `<tr><td colspan=2 class="bad">TAIL STRIKE</td></tr>`;
    html += `</table>`;
    showReport(html);
  }
  function showCrash() {
    S.crashShown = true;
    audio.crash();
    const el = $('crash');
    el.innerHTML = `<h2>CRASH</h2><p>${ac.crashed}</p><p class="small">Max G ${ac.maxG.toFixed(1)} · Flight time ${fmtTime(S.flightTime)}</p><p><button id="btn-retry">Restart scenario (Enter)</button> <button id="btn-menu2">Menu (Esc)</button></p>`;
    el.classList.remove('hidden');
    $('btn-retry').onclick = () => loadScenario(S.scenario);
    $('btn-menu2').onclick = () => showMenu(true);
  }
  let bannerT = null;
  function banner(msg, sec, warn) {
    const b = $('banner');
    b.textContent = msg;
    b.className = warn ? 'warn' : '';
    b.style.opacity = 1;
    clearTimeout(bannerT);
    bannerT = setTimeout(() => (b.style.opacity = 0), sec * 1000);
  }
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function updateHUD() {
    if (!S.showInfo) return;
    const w = weather.meanWind(ac.alt, ac.agl);
    const wdir = FS.wrap360(Math.atan2(-w.e, -w.n) * RAD - (FS.magVar || 0));
    const wspd = Math.hypot(w.n, w.e) / KT;
    let lines;
    if (S.acType === 'a320') {
      const f = fm.fma();
      lines = [
        `<b>SPD</b> ${Math.round(ac.ias)} kt <b>M</b> ${ac.mach.toFixed(2)} <b>GS</b> ${Math.round(ac.gs / KT)} <b>TGT</b> ${Math.round(fm.spdTarget || 0)}`,
        `<b>ALT</b> ${Math.round(a320.indAltFt || 0).toLocaleString()} ft <b>RA</b> ${Math.round(Math.max(0, ac.ra) / FT)} <b>VS</b> ${ac.vs >= 0 ? '+' : ''}${Math.round(ac.vs / FPM / 10) * 10}`,
        `<b>HDG</b> ${String(Math.round(FS.mag(ac.heading))).padStart(3, '0')}° <b>TRK</b> ${String(Math.round(FS.mag(ac.track))).padStart(3, '0')}° <b>α</b> ${(ac.alpha * RAD).toFixed(1)}° <b>G</b> ${ac.gload.toFixed(2)}`,
        `<b>N1</b> ${ac.eng[0].n1.toFixed(1)} / ${ac.eng[1].n1.toFixed(1)} <b>TLA</b> ${Math.round(ac.ctl.tla[0])}° <b>FF</b> ${Math.round(ac.eng[0].ff + ac.eng[1].ff)} kg/h`,
        `<b>CONF</b> ${ac.confName || '0'} <b>GEAR</b> ${ac.gearPos > 0.99 ? 'DN' : ac.gearPos < 0.01 ? 'UP' : 'TRANSIT'} <b>SPLR</b> ${ac.ctl.spoilersArmed ? 'ARM' : ac.ctl.speedBrake > 0 ? Math.round(ac.ctl.speedBrake * 100) + '%' : 'RET'} <b>LAW</b> ${ac.fbw.law}`,
        `<b>FMA</b> ${f.athr || '-'} | ${f.vert || '-'}${f.vertArmed ? ' (' + f.vertArmed + ')' : ''} | ${f.lat || '-'}${f.latArmed ? ' (' + f.latArmed + ')' : ''} | ${f.ap || ''} ${fm.fcu.athr ? 'A/THR' : ''}`,
        `<b>WIND</b> ${String(Math.round(wdir)).padStart(3, '0')}°/${Math.round(wspd)} kt <b>OAT</b> ${Math.round(ac.atm ? ac.atm.tempC : 15)}°C <b>FOB</b> ${Math.round(sys.fob())} kg`,
      ];
      if (tcas.status) lines.push(`<span class="warn">${tcas.status}</span>`);
      if (sys.fwc.shown && sys.fwc.shown.length) lines.push(`<span class="warn">ECAM: ${sys.fwc.shown[0].title}</span>`);
      if (S.push) lines.push('<i>pushback in progress</i>');
    } else {
      const fuel = c172.fuel[0] + c172.fuel[1];
      lines = [
        `<b>IAS</b> ${ind.ias.toFixed(0)} kt <b>TAS</b> ${(ac.tas / KT).toFixed(0)} <b>GS</b> ${(ac.gs / KT).toFixed(0)}`,
        `<b>ALT</b> ${Math.round(ind.altFt).toLocaleString()} ft <b>AGL</b> ${Math.round(Math.max(0, ac.agl - 1.16) / FT).toLocaleString()} <b>VS</b> ${ac.vs >= 0 ? '+' : ''}${Math.round(ac.vs / FPM / 10) * 10}`,
        `<b>HDG</b> ${String(Math.round(FS.mag(ac.heading))).padStart(3, '0')}° <b>TRK</b> ${String(Math.round(FS.mag(ac.track))).padStart(3, '0')}° <b>AoA</b> ${ac.tas > 12 ? (ac.alpha * RAD).toFixed(1) + '°' : '--'} <b>G</b> ${ac.gload.toFixed(2)}`,
        `<b>WIND</b> ${String(Math.round(wdir)).padStart(3, '0')}°/${Math.round(wspd)} kt <b>OAT</b> ${Math.round(ac.atm ? ac.atm.tempC : 15)}°C <b>VIS</b> ${scenery.visibility > 9999 ? '10+ km' : (scenery.visibility / 1000).toFixed(1) + ' km'}`,
        `<b>THR</b> ${Math.round(c172.ctl.throttle * 100)}% <b>RPM</b> ${Math.round(c172.eng.rpm)} <b>MIX</b> ${Math.round(c172.ctl.mixture * 100)}% <b>FF</b> ${c172.eng.ff.toFixed(1)}`,
        `<b>FLAPS</b> ${Math.round(c172.flapDeg)}° <b>TRIM</b> ${c172.ctl.trim >= 0 ? '+' : ''}${c172.ctl.trim.toFixed(2)} <b>FUEL</b> ${fuel.toFixed(1)} gal${c172.ctl.parkingBrake ? ' <span class="warn">PARK BRK</span>' : ''}`,
      ];
      if (c172.ice > 0.5) lines.push(`<span class="warn">AIRFRAME ICE ${c172.ice.toFixed(1)} mm</span>`);
      if (c172.carbIce > 0.3) lines.push(`<span class="warn">ENGINE RUNNING ROUGH</span>`);
      if (ap.on) lines.push(`<b>AP</b> ${ap.annunciation()}`);
      if (!c172.eng.running && !c172.crashed) lines.push('<span class="warn">ENGINE STOPPED</span>');
    }
    if (input.mouseYoke && !touch.enabled) lines.push('<i>mouse control active (Y)</i>');
    $('hud-info').innerHTML = lines.join('<br>');
  }

  function drawMap() {
    const cv = $('map'),
      g = cv.getContext('2d');
    const W = cv.width,
      H = cv.height,
      s = S.mapScale;
    const cn = ac.pos.x,
      ce = ac.pos.y;
    const P = (n, e) => [W / 2 + (e - ce) * s, H / 2 - (n - cn) * s];
    g.fillStyle = '#0b2a3a';
    g.fillRect(0, 0, W, H);
    const img = scenery.terrainMesh.material.map.image;
    const T = terrain,
      R = img.width;
    const [x0, y0] = P(T.half, -T.half);
    g.globalAlpha = 0.85;
    g.drawImage(img, 0, 0, R, R, x0, y0, T.size * s, T.size * s);
    g.globalAlpha = 1;
    g.font = '12px Arial';
    g.textAlign = 'left';
    // ILS feathers
    for (const v of navaids) {
      if (v.type !== 'LOC') continue;
      const h = (v.course + 180) * DEG;
      const [x1, y1] = P(v.thr.n, v.thr.e);
      const L = 10 * NM;
      g.fillStyle = 'rgba(255,0,255,0.25)';
      g.beginPath();
      g.moveTo(x1, y1);
      for (const a of [-3, 0, 3]) {
        const [x, y] = P(v.thr.n + Math.cos(h + a * DEG) * L, v.thr.e + Math.sin(h + a * DEG) * L);
        g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      const [lx, ly] = P(v.thr.n + Math.cos(h) * L, v.thr.e + Math.sin(h) * L);
      g.fillStyle = '#f7f';
      g.fillText(`${v.ident} ${v.freq.toFixed(2)} ${String(v.course).padStart(3, '0')}°`, lx + 4, ly);
    }
    // airports
    for (const ap2 of FS.AIRPORTS) {
      for (const rw of ap2.runways) {
        const [a1, b1] = P(rw.thr[0].n, rw.thr[0].e),
          [a2, b2] = P(rw.thr[1].n, rw.thr[1].e);
        g.strokeStyle = '#fff';
        g.lineWidth = Math.max(3, rw.width * s);
        g.beginPath();
        g.moveTo(a1, b1);
        g.lineTo(a2, b2);
        g.stroke();
      }
      const [x, y] = P(ap2.n, ap2.e);
      g.fillStyle = '#9cf';
      g.fillText(`${ap2.icao} ${ap2.name} (${Math.round(ap2.elev / FT)} ft)`, x + 14, y - 12);
    }
    // navaids
    for (const v of navaids) {
      const [x, y] = P(v.n, v.e);
      if (v.type === 'VOR') {
        g.strokeStyle = '#6cf';
        g.lineWidth = 1.5;
        g.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k * Math.PI) / 3;
          g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
        }
        g.stroke();
        g.beginPath();
        g.arc(x, y, 60, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(100,200,255,0.4)';
        g.stroke();
        for (let k = 0; k < 36; k++) {
          const a = k * 10 * DEG;
          const l = k % 3 === 0 ? 10 : 5;
          g.beginPath();
          g.moveTo(x + Math.sin(a) * 60, y - Math.cos(a) * 60);
          g.lineTo(x + Math.sin(a) * (60 - l), y - Math.cos(a) * (60 - l));
          g.stroke();
        }
        g.fillStyle = '#6cf';
        g.fillText(`${v.ident} ${v.freq.toFixed(2)}`, x + 10, y + 4);
      } else if (v.type === 'NDB') {
        g.fillStyle = '#c9a';
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
        g.fillText(`${v.ident} ${v.freq}`, x + 8, y + 12);
      } else if (v.type === 'MKR') {
        g.strokeStyle = '#99f';
        g.beginPath();
        g.ellipse(x, y, 3, 8, v.course * DEG, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // track
    g.strokeStyle = '#ff0';
    g.lineWidth = 2;
    g.beginPath();
    S.track.forEach((p, i) => {
      const [x, y] = P(p[0], p[1]);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.lineTo(W / 2, H / 2);
    g.stroke();
    // aircraft
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(ac.heading * DEG);
    g.fillStyle = '#ff0';
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(3, -2);
    g.lineTo(12, 2);
    g.lineTo(3, 3);
    g.lineTo(2, 9);
    g.lineTo(5, 12);
    g.lineTo(-5, 12);
    g.lineTo(-2, 9);
    g.lineTo(-3, 3);
    g.lineTo(-12, 2);
    g.lineTo(-3, -2);
    g.closePath();
    g.fill();
    g.restore();
    // scale bar
    const nmPx = NM * s;
    let nmStep = [0.5, 1, 2, 5, 10, 20].find((x) => x * nmPx > 60) || 20;
    g.fillStyle = '#fff';
    g.fillRect(16, H - 24, nmStep * nmPx, 3);
    g.fillText(`${nmStep} nm`, 16, H - 32);
    g.textAlign = 'right';
    g.fillText(touch.enabled ? 'MAP (pinch to zoom)  N ↑' : 'MAP (M to close, wheel to zoom)  N ↑', W - 12, 20);
  }


  // ================================================================ menu
  const failBoxes = {};
  function buildMenu() {
    const list = $('scenarios');
    let lastGroup = null;
    for (const sc of SCENARIOS) {
      const grp = sc.acType === 'a320' ? 'Airbus A320-200 · Iran Air · Tehran Mehrabad (OIII)' : 'Cessna 172S · Avalon Island (training)';
      if (grp !== lastGroup) {
        const h = document.createElement('div');
        h.className = 'sc-group';
        h.textContent = grp;
        list.appendChild(h);
        lastGroup = grp;
      }
      const d = document.createElement('div');
      d.className = 'sc';
      d.dataset.id = sc.id;
      d.innerHTML = `<div class="sc-tag">${sc.tag}</div><div class="sc-name">${sc.name}</div><div class="sc-desc">${sc.desc}</div>`;
      d.onclick = () => {
        S.scenario = sc.id;
        applyScenarioWeather(sc);
        refreshMenu();
      };
      list.appendChild(d);
    }
    const sel = $('wx-preset');
    for (const k in FS.WEATHER_PRESETS) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = FS.WEATHER_PRESETS[k].name;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      weather.set(Object.assign({}, FS.WEATHER_PRESETS[sel.value], { refElev: refElevOf(currentScenario()) }));
      weatherToForm();
    };
    document.querySelectorAll('#tab-weather input, #tab-weather select.wx').forEach((el) => (el.onchange = formToWeather));
    const fl = {
      engine: 'C172: Engine failure', vacuum: 'C172: Vacuum pump (AI & DG)', pitot: 'C172: Pitot tube blocked', static: 'C172: Static port blocked', electrical: 'C172: Total electrical', alternator: 'C172: Alternator',
      hydGY: 'A320: HYD G+Y dual failure', eng1320: 'A320: ENG 1 failure', eng2320: 'A320: ENG 2 failure',
    };
    const fc = $('failures');
    for (const k in fl) {
      const l = document.createElement('label');
      l.innerHTML = `<input type="checkbox"> ${fl[k]}`;
      failBoxes[k] = l.querySelector('input');
      failBoxes[k].onchange = () => {
        const on = failBoxes[k].checked;
        if (k in c172.failures) c172.failures[k] = on;
        if (S.acType === 'a320') {
          if (k === 'hydGY' && on) sys.failHydraulics(['G', 'Y']);
          if (k === 'eng1320') a320.eng[0].failed = on;
          if (k === 'eng2320') a320.eng[1].failed = on;
        }
      };
      fc.appendChild(l);
    }
    $('rand-fail').onchange = (e) => (S.randomFailures = e.target.checked);
    $('auto-rudder').onchange = (e) => (S.autoRudder = e.target.checked);
    $('time').oninput = (e) => {
      S.hours = +e.target.value;
      $('time-val').textContent = fmtHours(S.hours);
    };
    $('volume').oninput = (e) => (audio.volume = +e.target.value);
    $('sens').oninput = (e) => (input.sensitivity = +e.target.value);
    $('mouse-yoke').onchange = (e) => (input.mouseYoke = e.target.checked);
    document.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
        document.querySelectorAll('.tabpage').forEach((x) => x.classList.add('hidden'));
        t.classList.add('on');
        $('tab-' + t.dataset.tab).classList.remove('hidden');
      };
    });
    $('btn-fly').onclick = async () => {
      audio.start();
      const hours = S.hours;
      await loadScenario(S.scenario);
      S.hours = hours;
      S.started = true;
      S.paused = false;
      showMenu(false);
      // Android phones: full screen + landscape (iPhone Safari has no full-screen API: use "Add to Home Screen")
      if (FS.DEVICE.phone && !FS.DEVICE.ios && !(document.fullscreenElement || document.webkitFullscreenElement)) FS.TouchControls.toggleFullscreen();
    };
    $('btn-resume').onclick = () => {
      audio.start();
      showMenu(false);
    };
    refreshMenu();
  }
  const currentScenario = () => SCENARIOS.find((s) => s.id === S.scenario) || SCENARIOS[0];
  function refElevOf(sc) {
    const ap1 = FS.WORLDS[sc.world].airports[0];
    return ap1.elev != null ? ap1.elev : 60;
  }
  function applyScenarioWeather(sc) {
    weather.set(Object.assign({}, FS.WEATHER_PRESETS[sc.weather], sc.weatherMod || {}, { refElev: refElevOf(sc) }));
    $('wx-preset').value = sc.weather;
    S.hours = sc.hours;
    $('time').value = S.hours;
    $('time-val').textContent = fmtHours(S.hours);
    weatherToForm();
  }
  const fmtHours = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} local`;
  function weatherToForm() {
    const w = weather;
    $('wx-wdir').value = w.windDir;
    $('wx-wspd').value = w.windKt;
    $('wx-gust').value = w.gustKt;
    $('wx-adir').value = w.aloftDir;
    $('wx-aspd').value = w.aloftKt;
    $('wx-turb').value = w.turb;
    $('wx-vis').value = w.vis;
    $('wx-temp').value = w.tempC;
    $('wx-dew').value = w.dewC;
    $('wx-qnh').value = w.qnh;
    $('wx-precip').value = w.precip;
    for (let i = 0; i < 2; i++) {
      const c = w.cloudsCfg[i] || { cover: 0, baseFt: 3000, topFt: 5000, type: 'cu' };
      $('wx-c' + i + '-cov').value = c.cover;
      $('wx-c' + i + '-base').value = c.baseFt;
      $('wx-c' + i + '-top').value = c.topFt;
      $('wx-c' + i + '-type').value = c.type || 'cu';
    }
    refreshMenu();
  }
  function formToWeather() {
    const v = (id) => +$(id).value;
    const clouds = [];
    for (let i = 0; i < 2; i++) {
      const cov = v('wx-c' + i + '-cov');
      if (cov > 0) clouds.push({ cover: cov, baseFt: v('wx-c' + i + '-base'), topFt: Math.max(v('wx-c' + i + '-top'), v('wx-c' + i + '-base') + 500), type: $('wx-c' + i + '-type').value });
    }
    clouds.sort((a, b) => a.baseFt - b.baseFt);
    weather.set({
      name: 'Custom', qnh: v('wx-qnh'), tempC: v('wx-temp'), dewC: Math.min(v('wx-dew'), v('wx-temp')), windDir: v('wx-wdir'), windKt: v('wx-wspd'),
      gustKt: v('wx-gust'), aloftDir: v('wx-adir'), aloftKt: v('wx-aspd'), turb: v('wx-turb'), vis: v('wx-vis'), precip: v('wx-precip'), clouds, refElev: refElevOf(currentScenario()),
    });
    refreshMenu();
  }
  function refreshMenu() {
    document.querySelectorAll('.sc').forEach((d) => d.classList.toggle('on', d.dataset.id === S.scenario));
    const sc = currentScenario();
    const ap1 = FS.WORLDS[sc.world].airports[0];
    $('atis-icao').textContent = ap1.icao + ' ATIS';
    $('atis').textContent = weather.metar(ap1.icao, refElevOf(sc), (S.hours + 24 - (sc.world === 'tehran' ? 3.5 : 1)) % 24);
    $('btn-resume').style.display = S.started && ac && !ac.crashed ? '' : 'none';
    const fl = weather.freezingLevel();
    $('wx-info').textContent = `Freezing level ≈ ${Math.round(fl / FT / 100) * 100} ft MSL · Density altitude at ${ap1.icao} ≈ ${Math.round(densityAlt(refElevOf(sc)) / FT)} ft`;
  }
  function densityAlt(h) {
    const a = weather.atmosphere(h);
    return (1 - Math.pow(a.sigma, 0.2349)) * 44330.8;
  }
  function showMenu(open) {
    S.menuOpen = open;
    $('menu').classList.toggle('hidden', !open);
    document.body.classList.toggle('flying', !open);
    touch.toggleMore(false);
    touch.update(S.started && !open);
    if (open) refreshMenu();
  }

  window.addEventListener('load', () => {
    init().catch((e) => {
      console.error(e);
      $('loading-msg').textContent = 'Failed to start: ' + e.message + ' — WebGL is required.';
    });
  });
  window.FSIM = {
    get ac() { return ac; }, get S() { return S; }, get ap() { return ap; }, get weather() { return weather; }, get rig() { return rig; }, loadScenario,
    get ind() { return ind; }, get nav1() { return nav1; }, get fm() { return fm; }, get sys() { return sys; }, get tcas() { return tcas; }, get mcdu() { return mcdu; }, get a320() { return a320; },
  };
})();
