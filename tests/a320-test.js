// A320 flight model / FBW validation. Run: node tests/a320-test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['core/math.js', 'core/world.js', 'core/weather.js', 'core/nav.js', 'a320/fdm.js', 'a320/systems.js', 'a320/fmgs.js'])
  if (fs.existsSync(path.join(__dirname, '../js', f))) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), { filename: f });
const FS = globalThis.FS;
const { KT, FT, FPM, DEG, RAD, NM } = FS.U;
FS.setWorld('tehran');
const terrain = new FS.Terrain(7);
const weather = new FS.Weather('clear');
weather.set(Object.assign({}, FS.WEATHER_PRESETS.clear, { windKt: 0, gustKt: 0, turb: 0, aloftKt: 0, tempC: 15, qnh: 1013, refElev: FS.AIRPORTS[0].elev }));
const env = { weather, terrain };
const ac = new FS.A320();
if (FS.A320Systems) { ac.sys = new FS.A320Systems(ac); ac.sys.coldStart(false); }
const f = (x, d = 0) => x.toFixed(d);
const run = (sec, fn) => { for (let i = 0; i < sec * 240; i++) { fn && fn(ac, i / 240); if (ac.sys) ac.sys.update(1 / 240, ac, env); ac.step(1 / 240, env); if (ac.crashed) return false; } ac.ctl.stickPitch = 0; ac.ctl.stickRoll = 0; ac.ctl.rudder = 0; return true; };
const st = (lbl) => console.log(`${lbl}: ias ${f(ac.ias)} alt ${f(ac.alt / FT)} vs ${f(ac.vs / FPM)} pitch ${f(ac.pitch * RAD, 1)} bank ${f(ac.bank * RAD, 1)} hdg ${f(ac.heading)} a ${f(ac.alpha * RAD, 1)} nz ${f(ac.gload, 2)} ths ${f(ac.ths, 2)} n1 ${f(ac.eng[0].n1, 1)} law ${ac.fbw.law} ${ac.crashed || ''}`);

// 1. trim & hands-off stability
let tr = ac.trim(env, { alt: 10000 * FT, kias: 250, hdg: 290 });
console.log('[trim 250 kt FL100]', JSON.stringify(Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, +v.toFixed(3)]))));
ac.athrFrac = tr.athrFrac;
run(60); st('[hands-off 60 s]');
// 2. pitch step: stick half back 3 s then release
const a0 = ac.alt;
run(3, (a) => (a.ctl.stickPitch = 0.5)); st('[stick 0.5 back 3 s]');
run(10); st('[released 10 s: path held]');
// 3. roll: full stick 2 s -> ~30 deg bank then release: bank must hold
run(2, (a) => (a.ctl.stickRoll = 1)); st('[full roll 2 s]');
run(15); st('[released 15 s: bank held]');
run(3, (a) => (a.ctl.stickRoll = -1)); run(8); st('[rolled back level]');
// 4. bank beyond 33 deg returns to 33
run(4, (a) => (a.ctl.stickRoll = 1)); st('[full roll 4 s]'); run(12); st('[released: back to 33]');
run(4, (a) => (a.ctl.stickRoll = -1)); run(10);
// 5. high-alpha protection: idle, full back stick
ac.athrFrac = 0; ac.athrActive = false; ac.ctl.tla = [0, 0];
run(40, (a) => (a.ctl.stickPitch = 1)); st('[idle + full back stick 40 s: alpha-max hold]');
console.log('   alphaProt', f(ac.alphaProt * RAD, 1), 'alphaMax', f(ac.alphaMax * RAD, 1), 'prot', ac.protActive);
ac.ctl.stickPitch = 0; ac.ctl.tla = [25, 25]; ac.athrActive = false;

// 6. takeoff from Mehrabad 29L (elev ~3800 ft), CONF 1+F, TOGA
const R = FS.AIRPORTS[0].runways[1];
const thr = R.thr[1];
ac.reset({}); if (ac.sys) ac.sys.coldStart(false);
ac.placeAt(terrain, thr.n + Math.cos(thr.hdg * DEG) * 20, thr.e + Math.sin(thr.hdg * DEG) * 20, thr.hdg);
ac.ctl.flapLever = 1; ac.ths = 2;
run(8); // flaps
let lof = null, x0 = { n: ac.pos.x, e: ac.pos.y }, v1 = null;
ac.ctl.tla = [45, 45];
run(60, (a, t) => {
  const dist = Math.hypot(a.pos.x - x0.n, a.pos.y - x0.e);
  a.ctl.rudder = FS.clamp(FS.wrap180(thr.hdg - a.heading) * 0.2, -1, 1);
  if (a.ias > 145 && !lof) a.ctl.stickPitch = FS.clamp((9 * DEG - a.pitch) * 4, -0.3, 0.7); else if (lof) a.ctl.stickPitch = FS.clamp((15 * DEG - a.pitch) * 2, -1, 1);
  if (!a.onGround && !lof && t > 5) lof = { d: dist, ias: a.ias, t, pitch: a.pitch * RAD };
});
st('[takeoff 60 s]');
console.log(`   lift-off ${lof && f(lof.d)} m at ${lof && f(lof.ias)} KCAS after ${lof && f(lof.t, 1)} s (A320 hot/high ~2000-2500 m)`);
// climb check
ac.ctl.gearLever = 'UP'; ac.ctl.flapLever = 0; ac.ctl.tla = [25, 25];
run(60, (a) => (a.ctl.stickPitch = FS.clamp((250 - a.ias) * -0.01, -0.5, 0.5)));
st('[CLB thrust, 60 s]');

// 7. cruise FL350 M0.78 fuel flow
tr = ac.trim(env, { alt: 35000 * FT, kias: 272, hdg: 290 });
ac.athrFrac = tr.athrFrac;
run(20);
st('[cruise FL350]'); console.log(`   Mach ${f(ac.mach, 3)} TAS ${f(ac.tas / KT)} FF total ${f(ac.eng[0].ff + ac.eng[1].ff)} kg/h (A320 ~2400)`);
// 8. approach CONF FULL, gear down, 3 deg
tr = ac.trim(env, { alt: 1500 + 1000 * FT, kias: 135, hdg: 290, flaps: 4, gearDown: true, gamma: -3 });
console.log('[approach FULL 135 kt -3°] ', JSON.stringify(Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, +v.toFixed(2)]))), 'VLS', f(ac.speeds().vls));

// 9. Autoland: ILS 29L OIII from 12 nm, AP1+AP2 APPR, managed speed, CONF FULL
{
  const navaids = FS.buildNavaids(terrain);
  const ils = new FS.NavReceiver(109.9, 110.7, 285);
  const t29 = FS.AIRPORTS[0].runways[1].thr[1];
  const h = t29.hdg * DEG;
  const d0 = 13 * NM;
  ac.reset({}); if (ac.sys) ac.sys.coldStart(false);
  ac.trim(env, { n: t29.n - Math.cos(h) * d0 + Math.sin(h) * 1500, e: t29.e - Math.sin(h) * d0 - Math.cos(h) * 1500, alt: t29.elev + 3000 * FT, kias: 180, hdg: FS.wrap360(t29.hdg + 30), flaps: 2, gearDown: false });
  if (ac.sys) { ac.sys.update(0.01, ac, env); }
  const fm = new FS.FMGS(ac, navaids, FS.WORLD);
  fm.phase = 'APPROACH'; fm.appPhaseActive = true;
  fm.fcu.alt = Math.round((t29.elev / FT + 3000) / 100) * 100;
  fm.fcu.hdg = Math.round(FS.mag(ac.heading));
  fm.fcu.hdgManaged = false; fm.fcu.athr = true;
  ac.ctl.tla = [25, 25];
  fm.press('AP1'); fm.lat.mode = 'HDG'; fm.vert.mode = 'ALT'; fm.press('APPR'); fm.press('AP2');
  let log = [], st2 = 0, td = null;
  run(420, (a, t) => {
    const o = ils.tune(navaids, { n: a.pos.x, e: a.pos.y }, a.alt, 1 / 240, true);
    if (fm.vert.mode === 'G/S*' && a.ctl.flapLever < 3) a.ctl.flapLever = 3;
    if (fm.vert.mode.startsWith('G/S') && a.ctl.gearLever === 'UP') a.ctl.gearLever = 'DOWN';
    if (a.gearPos > 0.9 && a.ias < 185) a.ctl.flapLever = 4;
    if (a.onGround) { a.ctl.tla = [0, 0]; a.ctl.brakeL = a.ctl.brakeR = a.gs > 5 ? 0.4 : 1; }
    fm.update(1 / 240, a, { ils: o }, env);
    const dThr = ((t29.n - a.pos.x) * Math.cos(h) + (t29.e - a.pos.y) * Math.sin(h)) / NM;
    if (st2 === 0 && fm.lat.mode === 'LOC*') { log.push(`LOC* at ${f(dThr, 1)} nm`); st2 = 1; }
    if (st2 === 1 && fm.vert.mode.startsWith('G/S')) { log.push(`G/S* at ${f(dThr, 1)} nm ${f((a.alt - t29.elev) / FT)} ft AGL`); st2 = 2; }
    if (st2 === 2 && dThr < 1) { log.push(`1 nm: ${f((a.alt - t29.elev) / FT)} ft AGL ias ${f(a.ias)} cdi ${f(o.cdi, 2)} gs ${f(o.gs, 2)} ${fm.vert.mode} ${fm.athrMode}`); st2 = 3; }
    if (a.touchdown && !td) { td = a.touchdown; const cross = -(a.pos.x - t29.n) * Math.sin(h) + (a.pos.y - t29.e) * Math.cos(h); log.push(`TOUCHDOWN ${f(td.vsFpm)} fpm ${f(td.ias)} kt pitch ${f(td.pitch * RAD, 1)} ${f(-dThr * NM)} m past thr, ${f(cross, 1)} m off CL`); }
  });
  console.log('[AUTOLAND 29L] ' + log.join(' | '));
  st(`   final state (${fm.lat.mode}/${fm.vert.mode})`);
}
