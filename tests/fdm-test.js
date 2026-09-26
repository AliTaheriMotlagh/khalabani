// Flight-model validation against Cessna 172S POH-like numbers. Run: node tests/fdm-test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
for (const f of ['math.js', 'world.js', 'weather.js', 'nav.js', 'aircraft.js', 'autopilot.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/core', f), 'utf8'), { filename: f });
const FS = globalThis.FS;
const { KT, FT, FPM, DEG, RAD } = FS.U;

const t0 = Date.now();
const terrain = new FS.Terrain();
console.log('terrain built in', Date.now() - t0, 'ms; airports:', FS.AIRPORTS.map((a) => `${a.icao} ${Math.round(a.elev / FT)}ft`).join(', '));

const weather = new FS.Weather('clear');
weather.set(Object.assign({}, FS.WEATHER_PRESETS.clear, { windKt: 0, gustKt: 0, turb: 0, tempC: 15, qnh: 1013.25, aloftKt: 0 }));
const env = { weather, terrain };
const ac = new FS.Aircraft();
const dt = 1 / 240;
const fmt = (x, d = 1) => x.toFixed(d);

function run(sec, ctlFn) {
  for (let i = 0; i < sec * 240; i++) {
    if (ctlFn) ctlFn(ac, i * dt);
    ac.step(dt, env);
    if (ac.crashed) return false;
  }
  return true;
}

// ---------- 1. idle & static
const rw = FS.AIRPORTS[0].runways[0];
ac.placeOnGround(terrain, rw.thr[1].n, rw.thr[1].e - 20, 270);
ac.ctl.parkingBrake = true;
run(10);
console.log(`\n[ground idle] rpm ${fmt(ac.eng.rpm, 0)}  pitch ${fmt(ac.pitch * RAD)}°  gear N ${ac.gearForce.map((f) => fmt(f, 0))}  crashed=${ac.crashed}`);
ac.ctl.throttle = 1;
run(5);
console.log(`[static full power] rpm ${fmt(ac.eng.rpm, 0)} thrust ${fmt(ac.eng.thrust, 0)} N  MAP ${fmt(ac.eng.map / 3386.39)} inHg  moved ${fmt(Math.abs(ac.pos.y - (rw.thr[1].e - 20)))} m`);

// ---------- 2. takeoff roll
ac.placeOnGround(terrain, rw.thr[1].n, rw.thr[1].e - 20, 270);
ac.ctl.flaps = 0;
ac.ctl.trim = 0.1;
ac.ctl.throttle = 1;
let startE = ac.pos.y,
  liftoff = null,
  clear50 = null,
  tt = 0;
const elev = FS.AIRPORTS[0].elev;
run(60, (a, t) => {
  tt = t;
  a.ctl.rudder = FS.clamp(0.9 * FS.wrap180(270 - a.heading) * DEG * 5 - 0.3 * a.omega.z, -1, 1);
  if (a.ias > 55) a.ctl.elevator = FS.clamp(0.5 + (8 * DEG - a.pitch) * 3, -1, 1);
  else a.ctl.elevator = 0;
  a.ctl.aileron = FS.clamp(-a.bank * 2, -1, 1);
  if (!liftoff && !a.onGround && t > 2) liftoff = { d: startE - a.pos.y, ias: a.ias, t };
  if (liftoff && !clear50 && a.alt - elev > 1.15 + 50 * FT) clear50 = { d: startE - a.pos.y, ias: a.ias };
});
console.log(`\n[takeoff] liftoff ${liftoff && fmt(liftoff.d, 0)} m (${liftoff && fmt(liftoff.d / FT, 0)} ft) at ${liftoff && fmt(liftoff.ias)} KIAS after ${liftoff && fmt(liftoff.t)} s ; POH ~960 ft ground roll`);
console.log(`          over 50ft obstacle: ${clear50 && fmt(clear50.d / FT, 0)} ft (POH ~1630 ft)`);

// ---------- 3. climb at Vy 74 KIAS full power
const trC = ac.trim(env, { alt: 300, kias: 74, throttle: 1, hdg: 90 });
console.log(`\n[climb Vy 74 KIAS, full thr, SL] VS ${fmt(trC.vs, 0)} fpm  pitch ${fmt(trC.pitch)}°  rpm ${fmt(trC.rpm, 0)} ; POH ~730 fpm`);
const trC2 = ac.trim(env, { alt: 2400, kias: 72, throttle: 1, hdg: 90 });
console.log(`[climb 8000 ft, full rich] VS ${fmt(trC2.vs, 0)} fpm rpm ${fmt(trC2.rpm, 0)}`);

// ---------- 4. cruise
for (const [thr, altFt] of [[0.62, 3000], [0.75, 3000], [1, 3000], [1, 8000]]) {
  const tr = ac.trim(env, { alt: altFt * FT, kias: 100, gamma: 0, hdg: 90 });
  // Now hold throttle fixed and find speed: run with trim on speed... simpler: sweep kias for given throttle
  let best = null;
  for (let k = 60; k <= 135; k += 1) {
    const r = ac.trim(env, { alt: altFt * FT, kias: k, throttle: thr, hdg: 90 });
    if (best === null || Math.abs(r.vs) < Math.abs(best.vs)) best = Object.assign({ k }, r);
    if (r.vs < -50 && k > 90) break;
  }
  const atm = weather.atmosphere(altFt * FT);
  console.log(`[level @${altFt}ft thr ${thr}] ~${best.k} KIAS = ${fmt((best.k / Math.sqrt(atm.sigma)), 0)} KTAS rpm ${fmt(best.rpm, 0)} ff ${fmt(ac.eng.ff)} gph pitch ${fmt(best.pitch)}°`);
}

// ---------- 5. glide (engine idle)
const trG = ac.trim(env, { alt: 1000, kias: 68, throttle: 0, hdg: 90 });
console.log(`\n[glide 68 KIAS idle] VS ${fmt(trG.vs, 0)} fpm, ratio ${fmt((68 * KT) / (-trG.vs * FPM))}:1 rpm ${fmt(trG.rpm, 0)} ; POH ~9:1`);
ac.failures.engine = true;
const trG2 = ac.trim(env, { alt: 1000, kias: 68, throttle: 0, hdg: 90 });
ac.failures.engine = false;
console.log(`[glide 68 KIAS engine dead, windmilling] VS ${fmt(trG2.vs, 0)} fpm ratio ${fmt((68 * KT) / (-trG2.vs * FPM))}:1 rpm ${fmt(trG2.rpm, 0)}`);

// ---------- 6. approach: 3 deg glideslope, flaps 30, 65 KIAS
const trA = ac.trim(env, { alt: 400, kias: 65, gamma: -3, flaps: 3, hdg: 270 });
console.log(`\n[ILS approach flaps30 65KIAS -3°] thr ${fmt(trA.throttle, 2)} rpm ${fmt(trA.rpm, 0)} pitch ${fmt(trA.pitch)}° trim ${fmt(trA.trim, 2)} vs ${fmt(trA.vs, 0)}`);
const trA0 = ac.trim(env, { alt: 400, kias: 90, gamma: -3, flaps: 0, hdg: 270 });
console.log(`[ILS approach clean 90KIAS -3°] thr ${fmt(trA0.throttle, 2)} rpm ${fmt(trA0.rpm, 0)} pitch ${fmt(trA0.pitch)}° trim ${fmt(trA0.trim, 2)}`);

// ---------- 7. stall speeds (power idle, slow deceleration 1 kt/s)
for (const fl of [0, 3]) {
  ac.trim(env, { alt: 1500, kias: 70, throttle: 0, flaps: fl, hdg: 90 });
  let stallIas = null,
    warnIas = null,
    minIas = 999;
  run(60, (a, t) => {
    a.ctl.aileron = FS.clamp(-a.bank * 2 - 0.3 * a.omega.x, -1, 1);
    a.ctl.rudder = FS.clamp(8 * a.beta, -1, 1);
    // pull progressively
    a.ctl.elevator = FS.clamp(t * 0.035, -1, 1);
    if (a.stallWarn && warnIas === null) warnIas = a.ias;
    if (a.stall > 0.5 && stallIas === null) stallIas = a.ias;
    minIas = Math.min(minIas, a.ias);
  });
  console.log(`[stall flaps ${fl * 10}] horn at ${warnIas && fmt(warnIas)} KIAS, break at ${stallIas && fmt(stallIas)} KIAS (min ${fmt(minIas)}), POH CAS ${fl ? 48 : 53} kt`);
}

// ---------- 8. roll rate & turn
ac.trim(env, { alt: 1500, kias: 100, gamma: 0, hdg: 0 });
run(1.0, (a) => (a.ctl.aileron = 1));
console.log(`\n[roll] full aileron 1s at 100 KIAS -> bank ${fmt(ac.bank * RAD)}°, p ${fmt(ac.omega.x * RAD)}°/s, beta ${fmt(ac.beta * RAD)}° (adverse yaw)`);

// ---------- 9. dynamic stability: phugoid (release after pitch-up disturbance)
const trP = ac.trim(env, { alt: 1500, kias: 95, gamma: 0, hdg: 0 });
ac.omega.y = 0.1;
let iasMin = 999,
  iasMax = 0;
run(90, (a) => {
  a.ctl.aileron = FS.clamp(-a.bank * 1.5, -1, 1);
  iasMin = Math.min(iasMin, a.ias);
  iasMax = Math.max(iasMax, a.ias);
});
console.log(`[phugoid] hands-off after disturbance: IAS range ${fmt(iasMin)}-${fmt(iasMax)} kt, after 90 s IAS ${fmt(ac.ias)} (trim 95), alt change ${fmt((ac.alt - 1500) / FT, 0)} ft`);

// ---------- 10. hard landing detection
ac.trim(env, { alt: elev + 30, kias: 65, gamma: -3, flaps: 3, hdg: 270, n: 0, e: 600 });
let td = null;
run(40, (a) => {
  a.ctl.aileron = FS.clamp(-a.bank * 2, -1, 1);
  if (a.alt - elev < 6) {
    a.ctl.throttle = 0;
    a.ctl.elevator = FS.clamp((5 * DEG - a.pitch) * 3, -1, 1);
  }
  if (a.touchdown && !td) td = a.touchdown;
});
console.log(`\n[landing] crashed=${ac.crashed} touchdown ${td && fmt(td.vsFpm, 0)} fpm at ${td && fmt(td.ias)} KIAS pitch ${td && fmt(td.pitch * RAD)}°; rolled to ${fmt(ac.gs / KT)} kt`);

// ---------- 11. autopilot
{
  ac.trim(env, { alt: 1000, kias: 95, gamma: 0, hdg: 0 });
  const ap = new FS.Autopilot();
  ap.engage(ac, ac.alt / FT);
  ap.hdgBug = 90;
  ap.press('HDG', ac, ac.alt / FT);
  ap.altSel = 4000;
  ap.vsSel = 600;
  ac.ctl.throttle = 0.9;
  run(90, (a) => ap.update(1 / 240, a, null, a.alt / FT));
  console.log(`\n[AP] HDG 090 + VS 600 to 4000 ft: after 90 s hdg ${fmt(ac.heading, 0)} alt ${fmt(ac.alt / FT, 0)} ft vs ${fmt(ac.vs / FPM, 0)} ${ap.annunciation()}`);
  run(240, (a) => ap.update(1 / 240, a, null, a.alt / FT));
  console.log(`[AP] +240 s: hdg ${fmt(ac.heading, 0)} alt ${fmt(ac.alt / FT, 0)} ft vs ${fmt(ac.vs / FPM, 0)} ${ap.annunciation()} trim ${fmt(ac.ctl.trim, 2)} ias ${fmt(ac.ias)}`);

  // Coupled ILS 27 approach from 11 nm, 1.2 km north of centreline, intercept heading 240
  const navaids = FS.buildNavaids(terrain);
  const nav1 = new FS.NavReceiver(110.3, 113.9, 270);
  const thr27 = FS.AIRPORTS[0].runways[0].thr[1];
  const apElev = FS.AIRPORTS[0].elev;
  ac.trim(env, { n: 1200, e: thr27.e + 11 * 1852, alt: apElev + 2200 * FT, kias: 90, gamma: 0, hdg: 240 });
  ap.engage(ac, ac.alt / FT);
  ap.hdgBug = 240;
  ap.press('HDG', ac);
  ap.press('ALT', ac, ac.alt / FT);
  ap.press('APR', ac);
  let log = [], stage = 0;
  run(600, (a, t) => {
    const o = nav1.tune(navaids, { n: a.pos.x, e: a.pos.y }, a.alt, 1 / 240, true);
    o.obs = nav1.obs;
    if (ap.vertical === 'GS' && a.ctl.flaps === 0) { a.ctl.flaps = 1; }
    if (ap.vertical === 'GS') a.ctl.throttle = FS.clamp(0.5 + (90 - a.ias) * 0.03, 0.2, 0.9);
    ap.update(1 / 240, a, o, a.alt / FT);
    const dThr = (a.pos.y - thr27.e) / 1852;
    if (stage === 0 && ap.lateral === 'APR') { log.push(`LOC captured at ${fmt(dThr)} nm`); stage = 1; }
    if (stage === 1 && ap.vertical === 'GS') { log.push(`GS captured at ${fmt(dThr)} nm, alt ${fmt((a.alt - apElev) / FT, 0)} ft AGL`); stage = 2; }
    if (stage === 2 && dThr < 1.0) { log.push(`1 nm: ${fmt((a.alt - apElev) / FT, 0)} ft AGL (ideal ~318+50), off-centre ${fmt(a.pos.x - thr27.n, 0)} m, cdi ${fmt(o.cdi, 2)} gs ${fmt(o.gs, 2)} ias ${fmt(a.ias)}`); stage = 3; }
    if (stage === 3 && dThr < 0.1) { log.push(`threshold: ${fmt((a.alt - apElev) / FT, 0)} ft AGL, off-centre ${fmt(a.pos.x - thr27.n, 0)} m`); stage = 4; }
  });
  console.log('[AP ILS 27] ' + log.join(' | '));
}

// ---------- 12. hands-off stability after trim (no disturbance)
for (const k of [70, 95, 115]) {
  const tr = ac.trim(env, { alt: 1500, kias: k, gamma: 0, hdg: 0 });
  const a0 = ac.alt;
  run(60);
  console.log(`[hands-off ${k} KIAS, 60 s] alt change ${fmt((ac.alt - a0) / FT, 0)} ft, IAS ${fmt(ac.ias)} hdg ${fmt(ac.heading, 0)} bank ${fmt(ac.bank * RAD)} beta ${fmt(ac.beta * RAD)} rudder-free`);
}
