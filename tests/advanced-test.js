// Advanced behaviour checks: spin, compass turning errors, pitot blockage. Run: node tests/advanced-test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['math.js', 'world.js', 'weather.js', 'nav.js', 'aircraft.js', 'instruments.js', 'autopilot.js'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/core', f), 'utf8'), { filename: f });
const FS = globalThis.FS; const { KT, FT, FPM, DEG, RAD } = FS.U;
const terrain = new FS.Terrain(); const weather = new FS.Weather('clear');
weather.set(Object.assign({}, FS.WEATHER_PRESETS.clear, { windKt: 0, gustKt: 0, turb: 0, aloftKt: 0, refElev: 60 }));
const env = { weather, terrain }; const ac = new FS.Aircraft(); const ind = new FS.Instruments();
const run = (sec, fn) => { for (let i = 0; i < sec * 240; i++) { fn && fn(i / 240); ac.step(1 / 240, env); if (i % 4 === 0) ind.update(4 / 240, ac, weather); if (ac.crashed) return; } };

// ---- spin entry & recovery
ac.trim(env, { alt: 2000, kias: 65, throttle: 0, hdg: 0 });
let maxR = 0, turns = 0, lastHdg = ac.heading, a0 = ac.alt;
run(4, (t) => { ac.ctl.elevator = 1; ac.ctl.rudder = t > 2 ? -1 : 0; });
run(8, () => { ac.ctl.elevator = 1; ac.ctl.rudder = -1; maxR = Math.max(maxR, Math.abs(ac.omega.z)); const d = FS.wrap180(ac.heading - lastHdg); turns += d / 360; lastHdg = ac.heading; });
console.log(`[spin] pro-spin inputs 8 s: max yaw rate ${(maxR * RAD).toFixed(0)}°/s, turns ${turns.toFixed(2)}, alt lost ${((a0 - ac.alt) / FT).toFixed(0)} ft, alpha ${(ac.alpha * RAD).toFixed(0)}°, ias ${ac.ias.toFixed(0)}`);
let rec = null;
run(10, (t) => { ac.ctl.rudder = 1; ac.ctl.elevator = t > 0.5 ? -0.3 : 0.2; if (!rec && Math.abs(ac.omega.z) < 0.1 && ac.alpha < 12 * DEG) rec = t; });
console.log(`[spin] recovery (PARE): rotation stopped after ${rec ? rec.toFixed(1) + ' s' : 'NOT RECOVERED'}; total alt lost ${((a0 - ac.alt) / FT).toFixed(0)} ft; crashed=${ac.crashed}`);

// ---- compass northerly turning error
ac.trim(env, { alt: 1500, kias: 95, gamma: 0, hdg: 0 }); ind.reset(ac, weather);
run(3);
const roll = (tgt) => (a) => { ac.ctl.aileron = FS.clamp(2.5 * (tgt * DEG - ac.bank) - 0.5 * ac.omega.x, -1, 1); ac.ctl.rudder = FS.clamp(8 * ac.beta, -1, 1); ac.ctl.elevator = FS.clamp(0.25 * Math.abs(ac.bank) + 0.02 * (-ac.vs), -1, 1); };
run(6, roll(20));
console.log(`[compass] turning right from NORTH, 6 s: true hdg ${ac.heading.toFixed(0)}°, compass ${ind.compass.toFixed(0)}° (should lag / show opposite)`);
ac.trim(env, { alt: 1500, kias: 95, gamma: 0, hdg: 180 }); ind.reset(ac, weather); run(3);
run(6, roll(20));
console.log(`[compass] turning right from SOUTH, 6 s: true hdg ${ac.heading.toFixed(0)}°, compass ${ind.compass.toFixed(0)}° (should lead)`);
ac.trim(env, { alt: 1500, kias: 80, gamma: 0, hdg: 90 }); ind.reset(ac, weather); run(3);
const c0 = ind.compass; ac.ctl.throttle = 1;
run(4, () => { ac.ctl.elevator = -0.15; });
console.log(`[compass] accelerating on EAST heading: compass ${c0.toFixed(0)}° -> ${ind.compass.toFixed(0)}° (ANDS: swings north), true ${ac.heading.toFixed(0)}°`);

// ---- pitot blocked: ASI acts like an altimeter
ac.trim(env, { alt: 1000, kias: 90, gamma: 0, hdg: 90 }); ind.reset(ac, weather); run(2);
const i0 = ind.ias; ac.failures.pitot = true; ac.ctl.throttle = 1;
run(40, () => { ac.ctl.elevator = FS.clamp(0.02 * (600 - ac.vs / FPM) * 0.01, -1, 1); });
console.log(`[pitot blocked] climbing ${((ac.alt - 1000) / FT).toFixed(0)} ft: true IAS ${ac.ias.toFixed(0)} kt, indicated ${i0.toFixed(0)} -> ${ind.ias.toFixed(0)} kt (rises in climb)`);
ac.failures.pitot = false;

// ---- altimeter temperature error
weather.set(Object.assign(weather.toConfig(), { tempC: -20 }));
ac.trim(env, { alt: 1500, kias: 90, gamma: 0, hdg: 90 }); ind.reset(ac, weather); run(1);
console.log(`[altimeter] ISA-35 °C, QNH set: true ${(ac.alt / FT).toFixed(0)} ft, indicated ${ind.altFt.toFixed(0)} ft (cold: indicates HIGH)`);
