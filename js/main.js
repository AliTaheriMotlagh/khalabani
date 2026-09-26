/*
 * Avalon Flight Simulator — application glue: loading, scenarios, menus, game loop, HUD, map, landing grading.
 */
(function () {
  'use strict';
  const FS = window.FS;
  const { DEG, RAD, KT, FT, NM, FPM } = FS.U;
  const $ = (id) => document.getElementById(id);
  const PHYS_DT = 1 / 240;

  const S = {
    started: false,
    paused: false,
    menuOpen: true,
    hours: 10.5,
    flightTime: 0,
    scenario: 'takeoff27',
    showInfo: true,
    showPanel: true,
    showMap: false,
    mapScale: 0.02, // px per metre
    autoRudder: true,
    dmeSrc: 1,
    track: [],
    lastTouch: 0,
    airborneTime: 0,
    pendingFailure: null,
    randomFailures: false,
    crashShown: false,
  };
  let terrain, navaids, weather, renderer, camera, scenery, ac, model, rig, ind, ap, nav1, nav2, adf, marker, panel, input, audio, env;
  let acc = 0,
    last = performance.now();

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  async function setLoading(msg) {
    $('loading-msg').textContent = msg;
    await nextFrame();
  }

  // ---------------------------------------------------------------- scenarios
  const A = () => FS.AIRPORTS;
  const SCENARIOS = [
    {
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
    // trim is done in still air: add the ambient wind so the airplane starts in equilibrium with the air mass
    const agl = alt - terrain.groundHeight(o.n, o.e);
    const w = weather.meanWind(alt, agl);
    const wb = ac.q.invRotate(new FS.V3(w.n, w.e, 0));
    ac.vel.add(wb);
    ac.updateDerived();
  }

  function loadScenario(id) {
    const sc = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    S.scenario = sc.id;
    for (const k in ac.failures) ac.failures[k] = false;
    for (const k in failBoxes) if (failBoxes[k].checked) ac.failures[k] = true;
    ap.on = false;
    ap.alert = 0;
    ap.armLat = null;
    S.pendingFailure = null;
    ac.elec.master = ac.elec.avionics = ac.elec.alternator = true;
    Object.assign(ac.lights, { beacon: true, nav: true, strobe: true, landing: false, taxi: false });
    ac.pitotHeat = false;
    ind.altStatic = false;
    const failSaved = Object.assign({}, ac.failures);
    for (const k in ac.failures) ac.failures[k] = false; // trim with healthy airplane
    sc.setup();
    Object.assign(ac.failures, failSaved);
    ac.payload = +$('payload').value * FS.U.LB;
    const fuel = +$('fuel').value;
    ac.fuel = [fuel / 2, fuel / 2];
    ind.reset(ac, weather);
    if (!$('baro-auto').checked) ind.kollsman = 29.92;
    ap.hdgBug = ap.hdgBug || Math.round(ac.heading);
    S.flightTime = 0;
    S.track = [];
    S.lastTouch = 0;
    S.airborneTime = ac.onGround ? 0 : 60;
    S.crashShown = false;
    $('crash').classList.add('hidden');
    $('report').classList.add('hidden');
    if (S.randomFailures && !S.pendingFailure) {
      const opts = [['vacuum', 'VACUUM PUMP FAILED'], ['pitot', ''], ['static', ''], ['alternator', 'ALTERNATOR FAILED'], ['engine', 'ENGINE FAILURE!']];
      const f = opts[Math.floor(Math.random() * opts.length)];
      S.pendingFailure = { t: 90 + Math.random() * 600, key: f[0], msg: f[1] };
    }
    acc = 0;
    rig.set(rig.view || 'cockpit');
    layout();
  }

  // ---------------------------------------------------------------- init
  async function init() {
    await setLoading('Generating Avalon Island terrain…');
    terrain = new FS.Terrain(7);
    navaids = FS.buildNavaids(terrain);
    weather = new FS.Weather('fair');
    weather.set(Object.assign({}, FS.WEATHER_PRESETS.fair, { refElev: FS.AIRPORTS[0].elev }));
    env = { weather, terrain };

    renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    camera = new THREE.PerspectiveCamera(60, 1, 0.3, 200000);
    scenery = new FS.Scenery(renderer, terrain, navaids);
    await scenery.build(setLoading);
    await setLoading('Preparing aircraft & avionics…');
    ac = new FS.Aircraft();
    model = new FS.AircraftModel(scenery.scene);
    rig = new FS.CameraRig(camera);
    ind = new FS.Instruments();
    ap = new FS.Autopilot();
    nav1 = new FS.NavReceiver(110.3, 113.9, 270);
    nav2 = new FS.NavReceiver(113.9, 116.4, 90);
    adf = new FS.ADFReceiver(356);
    marker = new FS.MarkerReceiver();
    panel = new FS.Panel($('panel'));
    input = new FS.Input();
    audio = new FS.Audio();
    input.onKey = onKey;
    input.onKeyUp = onKeyUp;
    input.onMessage = (m) => banner(m, 3);
    buildMenu();
    setupMouse();
    window.addEventListener('resize', layout);
    loadScenario(S.scenario);
    applyScenarioWeather(SCENARIOS[0]);
    scenery.buildClouds(weather);
    layout();
    $('loading').classList.add('hidden');
    showMenu(true);
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- layout
  function panelHeight() {
    return Math.round(FS.clamp(window.innerHeight * 0.4, 220, 470));
  }
  function layout() {
    const W = window.innerWidth,
      H = window.innerHeight;
    renderer.setSize(W, H);
    const showPanel = rig.view === 'cockpit' && S.showPanel;
    const ph = showPanel ? panelHeight() : 0;
    $('panel').style.display = showPanel ? 'block' : 'none';
    if (showPanel) panel.resize(W, ph, Math.min(window.devicePixelRatio, 2));
    const hfov = 78 * DEG;
    if (showPanel) {
      const c = (H - ph) * 0.52; // horizon placement within the visible area
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
    m.height = (H - ph) * 0.9;
  }

  // ---------------------------------------------------------------- input
  const HOLD = {};
  function onKey(e) {
    const c = e.code;
    if (c === 'Escape') {
      showMenu(!S.menuOpen);
      return;
    }
    if (S.menuOpen) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Tab', 'Home', 'End', 'Slash'].includes(c)) e.preventDefault();
    if (e.repeat && !['Comma', 'Period', 'BracketLeft', 'BracketRight'].includes(c)) return;
    const sh = e.shiftKey;
    switch (c) {
      case 'KeyP': S.paused = !S.paused; break;
      case 'KeyF': ac.ctl.flaps = FS.clamp(ac.ctl.flaps + (sh ? -1 : 1), 0, 3); banner('Flaps ' + ac.ctl.flaps * 10 + '°', 1.2); break;
      case 'KeyR':
        if (sh) { loadScenario(S.scenario); banner('Scenario restarted', 2); }
        else { ac.ctl.flaps = FS.clamp(ac.ctl.flaps - 1, 0, 3); banner('Flaps ' + ac.ctl.flaps * 10 + '°', 1.2); }
        break;
      case 'KeyC': rig.cycle(sh ? -1 : 1); layout(); banner(viewName(), 1.2); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        rig.set(FS.VIEWS[+c.slice(5) - 1]); layout(); banner(viewName(), 1.2); break;
      case 'Tab': S.showPanel = !S.showPanel; if (rig.view === 'cockpit-wide') rig.set('cockpit'); layout(); break;
      case 'KeyM': S.showMap = !S.showMap; $('map').classList.toggle('hidden', !S.showMap); break;
      case 'KeyI': S.showInfo = !S.showInfo; $('hud-info').classList.toggle('hidden', !S.showInfo); break;
      case 'KeyY': input.mouseYoke = !input.mouseYoke; banner('Mouse yoke ' + (input.mouseYoke ? 'ON (move mouse to fly)' : 'OFF'), 2); break;
      case 'KeyU': audio.enabled = !audio.enabled; banner('Sound ' + (audio.enabled ? 'on' : 'off'), 1.2); break;
      case 'KeyZ': ap.press('AP', ac, ind.altFt); break;
      case 'KeyG': ind.syncDG(); banner('Heading indicator synced to compass', 1.5); break;
      case 'KeyH': ac.ctl.carbHeat = !ac.ctl.carbHeat; banner('Carb heat ' + (ac.ctl.carbHeat ? 'ON' : 'OFF'), 1.2); break;
      case 'KeyJ': ac.pitotHeat = !ac.pitotHeat; banner('Pitot heat ' + (ac.pitotHeat ? 'ON' : 'OFF'), 1.2); break;
      case 'KeyL': ac.lights.landing = !ac.lights.landing; banner('Landing light ' + (ac.lights.landing ? 'ON' : 'OFF'), 1.2); break;
      case 'KeyK': ac.ctl.parkingBrake = !ac.ctl.parkingBrake; banner('Parking brake ' + (ac.ctl.parkingBrake ? 'SET' : 'RELEASED'), 1.2); break;
      case 'KeyN': nav1.swap(); break;
      case 'KeyB': if (sh) { ind.kollsman = +(weather.qnh / FS.U.HPA_PER_INHG).toFixed(2); banner('Altimeter set ' + ind.kollsman.toFixed(2) + ' inHg', 1.5); } break;
      case 'Comma': if (sh) ap.hdgBug = FS.wrap360(ap.hdgBug - 1); else nav1.obs = FS.wrap360(nav1.obs - 1); break;
      case 'Period': if (sh) ap.hdgBug = FS.wrap360(ap.hdgBug + 1); else nav1.obs = FS.wrap360(nav1.obs + 1); break;
      case 'Space': rig.set(rig.view); break;
      case 'Enter': if (ac.crashed) loadScenario(S.scenario); break;
    }
  }
  function onKeyUp() {}
  function viewName() {
    return { cockpit: 'Cockpit + panel', 'cockpit-wide': 'Cockpit (outside view)', chase: 'Chase camera', tower: 'Tower view', flyby: 'Fly-by' }[rig.view];
  }

  function setupMouse() {
    const v = $('view');
    let drag = null;
    v.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => (drag = null));
    window.addEventListener('mousemove', (e) => {
      if (!drag || input.mouseYoke) return;
      rig.drag(e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    });
    v.addEventListener('wheel', (e) => {
      e.preventDefault();
      rig.wheel(e.deltaY);
    }, { passive: false });
    v.addEventListener('dblclick', () => rig.set(rig.view));
    const m = $('map');
    m.addEventListener('wheel', (e) => {
      e.preventDefault();
      S.mapScale = FS.clamp(S.mapScale * (e.deltaY < 0 ? 1.25 : 0.8), 0.002, 0.3);
    }, { passive: false });
  }

  function applyControls(dt, cmd) {
    const c = ac.ctl;
    const k = (...codes) => input.down(...codes);
    if (!ap.on) {
      c.elevator = cmd.pitch;
      c.aileron = cmd.roll;
    } else if (Math.abs(cmd.pitch) > 0.45 || Math.abs(cmd.roll) > 0.45) {
      ap.disengage('AP DISCONNECT');
      audio.beep(880, 0.6, 0.12);
    }
    let yaw = cmd.yaw;
    if (S.autoRudder && !ac.onGround && Math.abs(yaw) < 0.05 && ac.tas > 20) yaw = FS.clamp(7 * ac.beta - 0.4 * ac.omega.z + 0.25 * c.aileron * 0.4, -1, 1);
    c.rudder = yaw;
    // throttle & mixture
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
    // trim
    if (k('BracketLeft', 'Home')) c.trim = FS.clamp(c.trim - 0.18 * dt, -1, 1);
    if (k('BracketRight', 'End')) c.trim = FS.clamp(c.trim + 0.18 * dt, -1, 1);
    // brakes
    const br = k('KeyB') && !sh ? 1 : cmd.brake || 0;
    c.brakeL = c.brakeR = br;
    // starter
    if (k('KeyX')) c.mags = 4;
    else if (c.mags === 4) c.mags = 3;
  }

  // ---------------------------------------------------------------- loop
  let hudTimer = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const running = S.started && !S.paused && !S.menuOpen && !ac.crashed;
    const cmd = input.update(dt, { w: window.innerWidth, h: S.viewH || window.innerHeight });
    if (running) {
      applyControls(dt, cmd);
      acc += dt;
      let n = 0;
      while (acc >= PHYS_DT && n < 60) {
        ac.step(PHYS_DT, env);
        acc -= PHYS_DT;
        n++;
      }
      ind.update(dt, ac, weather);
      const pos = { n: ac.pos.x, e: ac.pos.y };
      const av = ind.avionicsPower;
      nav1.tune(navaids, pos, ac.alt, dt, av);
      nav1.out.obs = nav1.obs;
      nav2.tune(navaids, pos, ac.alt, dt, av);
      nav2.out.obs = nav2.obs;
      adf.tune(navaids, pos, ac.alt, ac.heading, dt, av);
      marker.update(navaids, pos, ac.alt, av);
      ap.update(dt, ac, nav1.out, ind.altFt, ind.dg);
      S.hours = (S.hours + dt / 3600) % 24;
      if (ac.eng.running || !ac.onGround) S.flightTime += dt;
      if (!ac.onGround) S.airborneTime += dt;
      events(dt);
    }
    if (ac.crashed && !S.crashShown) showCrash();
    // render
    model.update(dt, ac, terrain, scenery.sunDir, scenery.night || 0, rig.isCockpit ? (rig.view === 'cockpit-wide' || !S.showPanel ? 'wide' : 'panel') : false);
    rig.update(dt, ac, model, terrain, S.fovBase);
    scenery.update(dt, { camera, weather, ac, hours: S.hours });
    renderer.render(scenery.scene, camera);
    const st = panelState();
    if (rig.view === 'cockpit' && S.showPanel) panel.draw(st);
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.1;
      updateHUD();
    }
    if (S.showMap) drawMap();
    const camDist = camera.position.distanceTo(model.root.position);
    audio.update(dt, { ac, cockpit: rig.isCockpit, stallHorn: ac.stallWarn && !ac.crashed, marker: marker.active, paused: !running, camDist, weather });
    $('frost').style.opacity = FS.clamp(ac.ice / 14, 0, 0.85).toFixed(2);
    $('paused').classList.toggle('hidden', !(S.paused && S.started && !S.menuOpen));
  }

  function panelState() {
    return { ac, ind, ap, nav1, nav2, adf, marker: marker.active, stallHorn: ac.stallWarn && ac.hasPower(), hours: S.hours, flightTime: S.flightTime, night: scenery.night || 0 };
  }

  function events(dt) {
    // scheduled failures
    if (S.pendingFailure) {
      S.pendingFailure.t -= dt;
      if (S.pendingFailure.t <= 0) {
        ac.failures[S.pendingFailure.key] = true;
        if (S.pendingFailure.msg) banner(S.pendingFailure.msg, 4, true);
        S.pendingFailure = null;
      }
    }
    // touchdown report
    if (ac.touchdown && ac.touchEvent !== S.lastTouch) {
      S.lastTouch = ac.touchEvent;
      if (S.airborneTime > 10) landingReport(ac.touchdown);
      S.airborneTime = 0;
      audio.thump(ac.touchdown.vsFpm / 600);
    }
    if (ac.warning) banner(ac.warning, 0.3, true);
    if (ap.alert > 0 && ap.msg) banner(ap.msg, 0.3);
    // track for map
    const tr = S.track;
    const lastP = tr[tr.length - 1];
    if (!lastP || Math.hypot(lastP[0] - ac.pos.x, lastP[1] - ac.pos.y) > 150) {
      tr.push([ac.pos.x, ac.pos.y]);
      if (tr.length > 2000) tr.shift();
    }
  }

  function nearestRunwayEnd(n, e) {
    let best = null;
    for (const ap of FS.AIRPORTS)
      for (const rw of ap.runways)
        for (const t of rw.thr) {
          const h = t.hdg * DEG;
          const dn = n - t.n,
            de = e - t.e;
          const along = dn * Math.cos(h) + de * Math.sin(h);
          const cross = -dn * Math.sin(h) + de * Math.cos(h);
          if (along < -300 || along > rw.length + 100) continue;
          const score = Math.abs(cross) + (FS.wrap180(t.hdg - ac.heading) ** 2) * 0.1;
          if (!best || score < best.score) best = { score, along, cross, t, rw, ap };
        }
    return best;
  }

  function landingReport(td) {
    const r = nearestRunwayEnd(ac.pos.x, ac.pos.y);
    const v = Math.abs(td.vsFpm);
    const grade = v < 120 ? ['Butter!', '#6f6'] : v < 300 ? ['Smooth landing', '#9f9'] : v < 500 ? ['Firm landing', '#ff6'] : v < 750 ? ['Hard landing', '#f93'] : ['Very hard landing — inspect gear', '#f55'];
    let html = `<div class="grade" style="color:${grade[1]}">${grade[0]}</div><table>`;
    html += `<tr><td>Vertical speed</td><td>${Math.round(v)} fpm</td></tr><tr><td>Airspeed</td><td>${Math.round(td.ias)} KIAS</td></tr>`;
    html += `<tr><td>Pitch / bank</td><td>${(td.pitch * RAD).toFixed(1)}° / ${(td.bank * RAD).toFixed(1)}°</td></tr>`;
    if (r && Math.abs(r.cross) < r.rw.width / 2 + 3) {
      html += `<tr><td>Runway</td><td>${r.ap.icao} ${r.t.id}</td></tr><tr><td>From threshold</td><td>${Math.round(r.along)} m</td></tr>`;
      html += `<tr><td>Centreline</td><td>${Math.abs(r.cross).toFixed(1)} m ${r.cross > 0 ? 'right' : 'left'}</td></tr>`;
      if (r.along < 0) html += `<tr><td colspan=2 class="bad">Landed short of the threshold!</td></tr>`;
    } else html += `<tr><td colspan=2 class="bad">Off-runway landing</td></tr>`;
    if (Math.abs(td.crab) > 5) html += `<tr><td colspan=2 class="bad">Side-load: touched down ${Math.abs(td.crab).toFixed(0)}° crabbed</td></tr>`;
    html += `</table>`;
    const el = $('report');
    el.innerHTML = html;
    el.classList.remove('hidden');
    clearTimeout(S.reportTimer);
    S.reportTimer = setTimeout(() => el.classList.add('hidden'), 9000);
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
    const wdir = FS.wrap360(Math.atan2(-w.e, -w.n) * RAD);
    const wspd = Math.hypot(w.n, w.e) / KT;
    const fuel = ac.fuel[0] + ac.fuel[1];
    const f = (v, d = 0) => (v >= 0 ? v.toFixed(d) : v.toFixed(d));
    const lines = [
      `<b>IAS</b> ${f(ind.ias)} kt <b>TAS</b> ${f(ac.tas / KT)} <b>GS</b> ${f(ac.gs / KT)}`,
      `<b>ALT</b> ${Math.round(ind.altFt).toLocaleString()} ft <b>AGL</b> ${Math.round(Math.max(0, ac.agl - 1.16) / FT).toLocaleString()} <b>VS</b> ${ac.vs >= 0 ? '+' : ''}${Math.round(ac.vs / FPM / 10) * 10}`,
      `<b>HDG</b> ${String(Math.round(ac.heading)).padStart(3, '0')}° <b>TRK</b> ${String(Math.round(ac.track)).padStart(3, '0')}° <b>AoA</b> ${ac.tas > 12 ? (ac.alpha * RAD).toFixed(1) + '°' : '--'} <b>G</b> ${ac.gload.toFixed(2)}`,
      `<b>WIND</b> ${String(Math.round(wdir)).padStart(3, '0')}°/${Math.round(wspd)} kt <b>OAT</b> ${Math.round(ac.atm ? ac.atm.tempC : 15)}°C <b>VIS</b> ${scenery.visibility > 9999 ? '10+ km' : (scenery.visibility / 1000).toFixed(1) + ' km'}`,
      `<b>THR</b> ${Math.round(ac.ctl.throttle * 100)}% <b>RPM</b> ${Math.round(ac.eng.rpm)} <b>MIX</b> ${Math.round(ac.ctl.mixture * 100)}% <b>FF</b> ${ac.eng.ff.toFixed(1)}`,
      `<b>FLAPS</b> ${Math.round(ac.flapDeg)}° <b>TRIM</b> ${ac.ctl.trim >= 0 ? '+' : ''}${ac.ctl.trim.toFixed(2)} <b>FUEL</b> ${fuel.toFixed(1)} gal${ac.ctl.parkingBrake ? ' <span class="warn">PARK BRK</span>' : ''}`,
    ];
    if (ac.ice > 0.5) lines.push(`<span class="warn">AIRFRAME ICE ${ac.ice.toFixed(1)} mm</span>`);
    if (ac.carbIce > 0.3) lines.push(`<span class="warn">ENGINE RUNNING ROUGH</span>`);
    if (ap.on) lines.push(`<b>AP</b> ${ap.annunciation()}`);
    if (input.mouseYoke) lines.push('<i>mouse yoke active (Y)</i>');
    if (!ac.eng.running && !ac.crashed) lines.push('<span class="warn">ENGINE STOPPED</span>');
    $('hud-info').innerHTML = lines.join('<br>');
  }

  // ---------------------------------------------------------------- map
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
    g.fillText('MAP (M to close, wheel to zoom)  N ↑', W - 250, 20);
  }

  // ---------------------------------------------------------------- menu
  const failBoxes = {};
  function buildMenu() {
    // scenarios
    const list = $('scenarios');
    for (const sc of SCENARIOS) {
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
    // weather presets
    const sel = $('wx-preset');
    for (const k in FS.WEATHER_PRESETS) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = FS.WEATHER_PRESETS[k].name;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      weather.set(Object.assign({}, FS.WEATHER_PRESETS[sel.value], { refElev: FS.AIRPORTS[0].elev }));
      weatherToForm();
    };
    document.querySelectorAll('#tab-weather input, #tab-weather select.wx').forEach((el) => (el.onchange = formToWeather));
    // failures
    const fl = { engine: 'Engine failure', vacuum: 'Vacuum pump (AI & DG)', pitot: 'Pitot tube blocked', static: 'Static port blocked', electrical: 'Total electrical', alternator: 'Alternator' };
    const fc = $('failures');
    for (const k in fl) {
      const l = document.createElement('label');
      l.innerHTML = `<input type="checkbox"> ${fl[k]}`;
      failBoxes[k] = l.querySelector('input');
      failBoxes[k].onchange = () => (ac.failures[k] = failBoxes[k].checked);
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
    // tabs
    document.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => {
        document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
        document.querySelectorAll('.tabpage').forEach((x) => x.classList.add('hidden'));
        t.classList.add('on');
        $('tab-' + t.dataset.tab).classList.remove('hidden');
      };
    });
    $('btn-fly').onclick = () => {
      audio.start();
      loadScenario(S.scenario);
      S.started = true;
      S.paused = false;
      showMenu(false);
    };
    $('btn-resume').onclick = () => {
      audio.start();
      showMenu(false);
    };
    refreshMenu();
  }

  function applyScenarioWeather(sc) {
    const base = Object.assign({}, FS.WEATHER_PRESETS[sc.weather], sc.weatherMod || {}, { refElev: FS.AIRPORTS[0].elev });
    weather.set(base);
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
      gustKt: v('wx-gust'), aloftDir: v('wx-adir'), aloftKt: v('wx-aspd'), turb: v('wx-turb'), vis: v('wx-vis'), precip: v('wx-precip'), clouds, refElev: FS.AIRPORTS[0].elev,
    });
    refreshMenu();
  }

  function refreshMenu() {
    document.querySelectorAll('.sc').forEach((d) => d.classList.toggle('on', d.dataset.id === S.scenario));
    $('atis').textContent = weather.metar('KAVX', FS.AIRPORTS[0].elev, (S.hours + 24 - 1) % 24);
    $('btn-resume').style.display = S.started && !ac.crashed ? '' : 'none';
    const fl = weather.freezingLevel();
    $('wx-info').textContent = `Freezing level ≈ ${Math.round(fl / FT / 100) * 100} ft MSL · Density altitude at KAVX ≈ ${Math.round(densityAlt(FS.AIRPORTS[0].elev) / FT)} ft`;
  }

  function densityAlt(h) {
    const a = weather.atmosphere(h);
    return (1 - Math.pow(a.sigma, 0.2349)) * 44330.8;
  }

  function showMenu(open) {
    S.menuOpen = open;
    $('menu').classList.toggle('hidden', !open);
    if (open) refreshMenu();
  }

  window.addEventListener('load', () => {
    init().catch((e) => {
      console.error(e);
      $('loading-msg').textContent = 'Failed to start: ' + e.message + ' — WebGL is required.';
    });
  });
  window.FSIM = { get ac() { return ac; }, get S() { return S; }, get ap() { return ap; }, get weather() { return weather; }, get rig() { return rig; }, loadScenario, get ind() { return ind; }, get nav1() { return nav1; } };
})();
