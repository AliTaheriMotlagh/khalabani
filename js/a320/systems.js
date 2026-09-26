/*
 * A320 aircraft systems + Flight Warning Computer (FWC).
 *  ELEC  : batteries, IDGs/GEN 1+2, APU GEN, EXT PWR, AC/DC buses, RAT emergency generator
 *  APU   : master/start sequence, N%, EGT, APU GEN & bleed
 *  BLEED : engine / APU bleed, cross-bleed, packs; duct pressure for engine start
 *  PRESS : cabin altitude schedule, cabin V/S, delta-P, outflow valve, landing elevation
 *  FUEL  : 5 tanks (outer/inner/center), pumps, cross-feed, feed sequence, outer-tank transfer
 *  HYD   : Green (EDP 1), Blue (elec pump + RAT), Yellow (EDP 2 + elec pump), PTU, reservoirs, leaks
 *  ENG   : masters, mode selector, automatic start via bleed air
 *  FWC   : ECAM alerts with procedures, master warning/caution, memos, STATUS page, SD page selection
 * Procedures are modelled on the A320 FCOM philosophy but simplified — not for real-world operational use.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { FT, KT } = FS.U;

  class A320Systems {
    constructor(ac) {
      this.ac = ac;
      ac.sys = this;
      this.coldStart(false);
    }

    coldStart(dark) {
      const on = !dark;
      this.elec = {
        bat: [true, true], batCharge: [1, 1], batV: [25.8, 25.8], batA: [0, 0],
        gen: [true, true], apuGenSw: true, extPwrAvail: dark, extPwrOn: false, busTie: true,
        acPowered: on, dcPowered: on, acEss: on, genOn: [on, on], apuGenOn: false, extOn: false, rat: false, emerGen: false,
      };
      this.apu = { master: false, starting: false, n: 0, egt: 20, avail: false, bleed: false, flap: 0 };
      this.bleed = { eng: [true, true], xbleed: 'AUTO', packs: [true, true], xOpen: false, ductP: [0, 0] };
      this.bleedPress = on ? 40 : 0;
      this.press = { cabAlt: 3900, cabVs: 0, dp: 0, ldgElev: null, outflow: 100, modeAuto: true, manVs: 0 };
      this.cond = { ckpt: 22, fwd: 22, aft: 23, sel: [22, 22, 23] };
      const fuel = this.ac.fuelKg;
      this.fuel = { pumps: { L1: true, L2: true, C1: true, C2: true, R1: true, R2: true }, xfeed: false, modeAuto: true };
      this.setFuel(fuel);
      this.hyd = {
        G: { press: on ? 3000 : 0, qty: 14, edp: true, leak: 0 },
        B: { press: on ? 3000 : 0, qty: 6.5, elecPump: true, leak: 0 },
        Y: { press: on ? 3000 : 0, qty: 12.5, edp: true, elecPump: false, leak: 0 },
        ptu: true, ptuRunning: false, ratMan: false,
      };
      this.eng = { master: [on, on], mode: 'NORM' };
      this.signs = { belts: true, smoke: true, emerLt: 'ARM' };
      this.doors = { cabin: { 'FWD L': dark, 'FWD R': false, 'AFT L': false, 'AFT R': dark }, cargo: { FWD: dark, AFT: dark, BULK: false }, slides: !dark };
      this.flexTemp = null;
      this.cabinReady = !dark;
      this.toConfigTested = false;
      this.fwc = { active: [], cleared: new Set(), mw: false, mc: false, aural: null, lastIds: new Set(), recall: false, memo: [], rightMemo: [], status: null, tcas: null };
      this.sdPage = null; // manual selection
      this.sdAuto = 'DOOR';
      this.engRunTime = 0;
      this.apDiscTimer = 0;
      this.phase = 1;
      this.forceAltn = false;
      this.chrono = 0;
      this.fuelUsedReset = [0, 0];
      this.gpu = dark;
      this.chocks = dark;
      const ac = this.ac;
      if (dark) {
        ac.eng.forEach((e) => e.reset(false));
        this.elec.bat = [false, false];
        this.eng.master = [false, false];
        ac.lights.beacon = ac.lights.strobe = ac.lights.nav = ac.lights.logo = false;
        this.signs.belts = this.signs.smoke = false;
      }
    }

    setFuel(kg) {
      // standard tank fill: outers (691 kg each) -> inners (5,436 kg each) -> centre
      let r = kg;
      const o = Math.min(r / 2, 691);
      r -= 2 * o;
      const i = Math.min(r / 2, 5436);
      r -= 2 * i;
      const c = Math.max(0, r);
      this.tanks = { LO: o, LI: i, C: c, RI: i, RO: o };
      this.ac.fuelKg = kg;
      this.lastFuel = kg;
    }
    fob() {
      const t = this.tanks;
      return t.LO + t.LI + t.C + t.RI + t.RO;
    }

    // ------------------------------------------------------------------ update
    update(dt, ac, env) {
      const atm = ac.atm || env.weather.atmosphere(ac.alt);
      const E = ac.eng;
      const running = E.map((e) => e.running && e.n2 > 55);
      const inAir = !ac.onGround;
      const spd = ac.ias || 0;
      this.chrono += dt;

      // ---------------- APU
      const A = this.apu;
      const batOn = this.elec.bat[0] || this.elec.bat[1];
      if (A.master && batOn) {
        A.flap = Math.min(1, A.flap + dt / 6);
        if (A.starting && A.flap >= 1) {
          A.n = Math.min(100, A.n + dt * (A.n < 10 ? 2 : A.n < 60 ? 3.2 : 4.5));
          const egtT = A.n < 40 ? 20 + A.n * 17 : 740 - (A.n - 40) * 5;
          A.egt += (egtT - A.egt) * FS.lagK(dt, 2);
          if (A.n >= 99.5) {
            A.starting = false;
            A.availT = 2;
          }
        } else if (A.n >= 99) {
          A.egt += (420 + (A.bleed ? 60 : 0) - A.egt) * FS.lagK(dt, 5);
        }
        if (A.availT != null) {
          A.availT -= dt;
          if (A.availT <= 0) {
            A.avail = true;
            A.availT = null;
          }
        }
      } else {
        A.starting = false;
        A.avail = false;
        A.n = Math.max(0, A.n - dt * 6);
        A.egt += (atm.tempC - A.egt) * FS.lagK(dt, 30);
        if (A.n <= 0) A.flap = Math.max(0, A.flap - dt / 6);
      }

      // ---------------- ELEC
      const el = this.elec;
      el.genOn = [running[0] && el.gen[0], running[1] && el.gen[1]];
      el.apuGenOn = A.avail && el.apuGenSw;
      el.extPwrAvail = this.gpu && ac.onGround && ac.gs < 1;
      if (!el.extPwrAvail) el.extPwrOn = false;
      el.extOn = el.extPwrOn && el.extPwrAvail;
      const anyGen = el.genOn[0] || el.genOn[1] || el.apuGenOn || el.extOn;
      // RAT deploys automatically when AC is lost in flight (or blue press lost)
      if (!anyGen && inAir && spd > 100) this.hyd.ratOut = true;
      if (!inAir && spd < 5 && anyGen) this.hyd.ratOut = false;
      el.rat = !!this.hyd.ratOut;
      el.emerGen = el.rat && !anyGen && spd > 100;
      el.acPowered = anyGen || el.emerGen;
      el.acEss = el.acPowered;
      for (let i = 0; i < 2; i++) {
        if (el.bat[i]) {
          if (el.acPowered) el.batCharge[i] = Math.min(1, el.batCharge[i] + dt / 1200);
          else el.batCharge[i] = Math.max(0, el.batCharge[i] - dt / 2400);
          el.batV[i] = el.acPowered ? 28.1 : 24 + 1.8 * el.batCharge[i];
          el.batA[i] = el.acPowered ? (el.batCharge[i] < 1 ? 8 : 0) : -12;
        } else {
          el.batV[i] = 24 + 1.8 * el.batCharge[i];
          el.batA[i] = 0;
        }
      }
      el.dcPowered = el.acPowered || el.bat[0] || el.bat[1];
      el.gen1Load = el.genOn[0] ? 38 : 0;
      el.gen2Load = el.genOn[1] ? 36 : 0;
      // A/C "hasPower" semantics for displays: need AC (or emer gen)
      this.displays = el.acPowered;

      // ---------------- BLEED
      const B = this.bleed;
      const apuBleed = A.avail && A.bleed ? 35 : 0;
      const engP = [0, 1].map((i) => (running[i] && B.eng[i] ? 14 + E[i].n2 * 0.4 : 0));
      B.xOpen = B.xbleed === 'OPEN' || (B.xbleed === 'AUTO' && apuBleed > 0);
      const side = [Math.max(engP[0], apuBleed), engP[1]];
      if (B.xOpen) side[1] = side[0] = Math.max(side[0], side[1]);
      B.ductP[0] += (side[0] - B.ductP[0]) * FS.lagK(dt, 1);
      B.ductP[1] += (side[1] - B.ductP[1]) * FS.lagK(dt, 1);
      this.bleedPress = Math.max(B.ductP[0], B.ductP[1]);
      this.packOn = [B.packs[0] && B.ductP[0] > 15, B.packs[1] && B.ductP[1] > 15];

      // ---------------- PRESSURIZATION
      const P = this.press;
      const origin = env.originElev != null ? env.originElev : 1180;
      const ldg = P.ldgElev != null ? P.ldgElev * FT : env.destElev != null ? env.destElev : origin;
      const acAlt = ac.alt;
      const packs = this.packOn[0] || this.packOn[1];
      const pAmb = atm.p;
      let target;
      if (!inAir) target = acAlt;
      else {
        target = Math.max(ldg - 60, Math.min(acAlt, origin + (acAlt - origin) * 0.23));
        // max differential 8.06 psi
        const pMin = pAmb + 8.06 * 6894.76 * 0.98;
        const altAtP = (1 - Math.pow(pMin / 101325, 0.190263)) * 44330.8;
        target = Math.min(target, altAtP);
        target = Math.max(target, (1 - Math.pow((pAmb + 8.6 * 6894.76) / 101325, 0.190263)) * 44330.8);
      }
      if (!packs && inAir) target = acAlt; // no packs -> cabin climbs to aircraft altitude
      const cab = P.cabAlt * FT;
      const maxRate = (target > cab ? 750 : 400) * FS.U.FPM * (packs ? 1 : 4);
      const rate = FS.clamp((target - cab) * 0.02, -maxRate, maxRate);
      P.cabVs += (rate / FS.U.FPM - P.cabVs) * FS.lagK(dt, 3);
      P.cabAlt = (cab + rate * dt) / FT;
      const pCab = 101325 * Math.pow(1 - (P.cabAlt * FT) / 44330.8, 5.2559);
      P.dp = (pCab - pAmb) / 6894.76;
      P.outflow = FS.clamp(50 - P.cabVs / 40 + (inAir ? -20 : 50), 0, 100);

      // ---------------- COND
      for (const [k, i] of [['ckpt', 0], ['fwd', 1], ['aft', 2]]) this.cond[k] += ((packs ? this.cond.sel[i] : atm.tempC + 10) - this.cond[k]) * FS.lagK(dt, 120);

      // ---------------- FUEL: distribute consumption among tanks
      const used = Math.max(0, this.lastFuel - ac.fuelKg);
      const T = this.tanks;
      const pumps = this.fuel.pumps;
      const slatsExt = ac.slat > 1;
      let rem = used;
      const take = (k, amt) => {
        const a = Math.min(T[k], amt);
        T[k] -= a;
        return a;
      };
      if (rem > 0) {
        if (T.C > 0 && (pumps.C1 || pumps.C2) && !slatsExt) rem -= take('C', rem);
        if (rem > 0) {
          const hl = rem / 2;
          rem -= take('LI', hl) + take('RI', hl);
          if (rem > 0) rem -= take('LI', rem) + take('RI', rem);
        }
      }
      // outer tank transfer valves open when inner tank < 750 kg
      for (const [o, i] of [['LO', 'LI'], ['RO', 'RI']])
        if (T[i] < 750 && T[o] > 0) {
          const x = Math.min(T[o], dt * 2);
          T[o] -= x;
          T[i] += x;
        }
      // APU burns from left side
      if (A.n > 50) {
        const b = (dt * (A.bleed ? 130 : 100)) / 3600;
        T.LI = Math.max(0, T.LI - b);
      }
      ac.fuelKg = this.fob();
      this.lastFuel = ac.fuelKg;

      // ---------------- HYDRAULICS
      const H = this.hyd;
      const acOK = el.acPowered;
      for (const k of ['G', 'B', 'Y']) H[k].qty = Math.max(0, H[k].qty - H[k].leak * dt);
      const qtyOK = (k) => H[k].qty > (k === 'B' ? 2.4 : 3.5);
      const gSrc = running[0] && H.G.edp && qtyOK('G') ? 3000 : 0;
      const yEdp = running[1] && H.Y.edp && qtyOK('Y') ? 3000 : 0;
      const yElec = (H.Y.elecPump || this.cargoDoorOperating) && acOK && qtyOK('Y') ? 3000 : 0;
      const bElec = H.B.elecPump && acOK && (running[0] || running[1] || this.blueOvrd) && qtyOK('B') ? 3000 : 0;
      const bRat = el.rat && spd > 100 && qtyOK('B') ? 2500 : 0;
      let g = gSrc,
        y = Math.max(yEdp, yElec),
        b = Math.max(bElec, bRat);
      // PTU transfers power when the pressure difference exceeds ~500 psi (both reservoirs must have fluid)
      H.ptuRunning = false;
      if (H.ptu && (this.anyEngRunning() || yElec) && qtyOK('G') && qtyOK('Y')) {
        if (g > 2500 && y < 2000) {
          y = 2900;
          H.ptuRunning = true;
        } else if (y > 2500 && g < 2000) {
          g = 2900;
          H.ptuRunning = true;
        }
      }
      if (H.ptuRunning && H.ptuCnt == null) H.ptuCnt = 0;
      H.G.press += (g - H.G.press) * FS.lagK(dt, g > H.G.press ? 1.2 : 2.5);
      H.B.press += (b - H.B.press) * FS.lagK(dt, b > H.B.press ? 1.2 : 2.5);
      H.Y.press += (y - H.Y.press) * FS.lagK(dt, y > H.Y.press ? 1.2 : 2.5);
      if (H.Y.press > 2000) ac.accum = Math.min(3000, ac.accum + dt * 300);

      // ---------------- misc
      if (this.anyEngRunning() && ac.onGround) this.engRunTime += dt;
      if (inAir) this.engRunTime = 0;
      this.phaseUpdate(ac);
      this.fwcUpdate(dt, ac, env);
    }

    anyEngRunning() {
      return this.ac.eng.some((e) => e.running);
    }

    phaseUpdate(ac) {
      const tla = Math.max(ac.ctl.tla[0], ac.ctl.tla[1]);
      const ra = ac.ra;
      let ph;
      if (ac.onGround) {
        if (!this.anyEngRunning()) ph = this.phase >= 8 ? 10 : 1;
        else if (tla >= 34 && ac.gs < 80 * KT) ph = 3;
        else if (tla >= 34) ph = 4;
        else if (this.phase >= 6 && this.phase <= 9) ph = 8;
        else ph = ac.gs > 1 && this.phase >= 8 ? 8 : 2;
      } else {
        if (ra < 1500 && this.phase <= 5 && this.phase >= 3) ph = 5;
        else if (ra < 800 && this.phase >= 6) ph = 7;
        else ph = 6;
      }
      this.phase = ph;
    }

    // ------------------------------------------------------------------ FWC
    fwcUpdate(dt, ac, env) {
      const f = this.fwc;
      const H = this.hyd;
      const alerts = [];
      const inAir = !ac.onGround;
      const lo = (k) => H[k].press < 1450;
      const E = ac.eng;
      const running = this.anyEngRunning();
      const add = (a) => alerts.push(a);
      // ---- hydraulics
      const lost = ['G', 'B', 'Y'].filter((k) => lo(k) && (running || inAir));
      const low = (k) => H[k].qty <= (k === 'B' ? 2.4 : 3.5);
      if (lost.length >= 2 && (inAir || running)) {
        const nm = lost.slice(0, 2).join('+');
        const key = lost.includes('G') && lost.includes('Y') ? 'GY' : lost.includes('G') && lost.includes('B') ? 'GB' : 'BY';
        const acts = [];
        if (lost.includes('G') || lost.includes('Y')) acts.push({ t: 'PTU', v: 'OFF', done: () => !H.ptu });
        if (lost.includes('G')) acts.push({ t: 'GREEN ENG 1 PUMP', v: 'OFF', done: () => !H.G.edp });
        if (lost.includes('Y')) acts.push({ t: 'YELLOW ENG 2 PUMP', v: 'OFF', done: () => !H.Y.edp });
        if (lost.includes('Y')) acts.push({ t: 'YELLOW ELEC PUMP', v: 'OFF', done: () => !H.Y.elecPump });
        if (lost.includes('B')) acts.push({ t: 'BLUE ELEC PUMP', v: 'OFF', done: () => !H.B.elecPump });
        if (lost.includes('B') && lost.includes('G') && ac.ias > 120) acts.push({ t: 'RAT', v: 'MAN ON', done: () => H.ratOut });
        acts.push({ t: 'FUEL', v: 'CHECK', done: () => true, info: true });
        if (key !== 'BY') acts.push({ t: 'MAX SPEED', v: key === 'GY' ? '320 KT' : '320/.77', info: true });
        acts.push({ t: 'APPR SPD', v: key === 'GY' ? 'VREF+25' : 'VREF+25', info: true });
        if (lost.includes('G')) acts.push({ t: 'L/G', v: 'GRVTY EXTN', done: () => ac.ctl.gravityExt, info: !inAir });
        acts.push({ t: 'LDG DIST PROC', v: 'APPLY', info: true });
        add({ id: 'HYD2', lvl: 3, sys: 'HYD', title: `HYD ${nm} SYS LO PR`, page: 'HYD', acts, aural: 'CRC' });
      } else {
        for (const k of lost)
          add({
            id: 'HYD' + k, lvl: 2, sys: 'HYD', title: `HYD ${{ G: 'G', B: 'B', Y: 'Y' }[k]} ${low(k) ? 'RSVR LO LVL' : 'SYS LO PR'}`, page: 'HYD', aural: 'SC',
            acts: k === 'G' ? [{ t: 'GREEN ENG 1 PUMP', v: 'OFF', done: () => !H.G.edp }] : k === 'Y' ? [{ t: 'YELLOW ENG 2 PUMP', v: 'OFF', done: () => !H.Y.edp }] : [{ t: 'BLUE ELEC PUMP', v: 'OFF', done: () => !H.B.elecPump }],
          });
      }
      // ---- flight controls law
      const law = ac.fbw.law;
      if (inAir && law === 'ALTN') add({ id: 'ALTN', lvl: 2, sys: 'F/CTL', title: 'F/CTL ALTN LAW (PROT LOST)', acts: [{ t: 'MAX SPEED', v: '320 KT', info: true }], aural: 'SC' });
      if (inAir && law === 'DIRECT') add({ id: 'DIRECT', lvl: 2, sys: 'F/CTL', title: 'F/CTL DIRECT LAW (PROT LOST)', acts: [{ t: 'MAX SPEED', v: '320/.77', info: true }, { t: 'MAN PITCH TRIM', v: ac.fbw.pitchTrimAvail ? 'USE' : 'NOT AVAIL', info: true }, { t: 'MANEUVER WITH CARE', v: '', info: true }], aural: 'SC' });
      if (inAir && ac.flapsLocked && ac.flap !== FS.A320_CONF[ac.ctl.flapLever].flap) add({ id: 'FLAPS', lvl: 2, sys: 'F/CTL', title: 'F/CTL FLAPS LOCKED', acts: [{ t: 'FOR LDG', v: 'USE FLAP 3', info: true }], aural: 'SC' });
      // ---- engines
      for (let i = 0; i < 2; i++) {
        const e = E[i];
        if (inAir && !e.running && this.eng.master[i] && e.n2 < 50 && e.phase !== 'CRANK' && e.phase !== 'LIGHT')
          add({ id: 'ENGFAIL' + i, lvl: 2, sys: 'ENG', title: `ENG ${i + 1} FAIL`, page: 'ENG', aural: 'SC', acts: [{ t: `ENG ${i + 1} MASTER`, v: 'OFF', done: () => !this.eng.master[i] }, { t: 'ENG MODE SEL', v: 'IGN', done: () => this.eng.mode === 'IGN' }] });
        if (inAir && !this.eng.master[i]) add({ id: 'ENGSD' + i, lvl: 2, sys: 'ENG', title: `ENG ${i + 1} SHUT DOWN`, page: 'ENG', aural: 'SC', acts: [{ t: 'APPR PROC', v: 'SINGLE ENG', info: true }] });
        if (e.egt > 950 && e.running) add({ id: 'EGT' + i, lvl: 2, sys: 'ENG', title: `ENG ${i + 1} EGT OVER LIMIT`, page: 'ENG', aural: 'SC', acts: [{ t: `THR LEVER ${i + 1}`, v: 'RETARD', done: () => ac.ctl.tla[i] < 30 }] });
      }
      // ---- elec
      if (!this.elec.acPowered && (this.elec.bat[0] || this.elec.bat[1]) && (inAir || running))
        add({ id: 'EMER', lvl: 3, sys: 'ELEC', title: 'ELEC EMER CONFIG', page: 'ELEC', aural: 'CRC', acts: [{ t: 'GEN 1+2', v: 'OFF THEN ON', done: () => this.elec.genOn[0] }, { t: 'APU', v: 'START', done: () => this.apu.master }] });
      if (inAir && this.elec.rat) add({ id: 'RAT', lvl: 1, sys: 'HYD', title: 'RAT OUT', memo: true });
      // ---- configuration warnings at takeoff power on ground
      if (ac.onGround && Math.max(ac.ctl.tla[0], ac.ctl.tla[1]) >= 34 && ac.gs < 70 * KT) {
        if (ac.ctl.flapLever === 0 || ac.ctl.flapLever === 4) add({ id: 'CFGFLAP', lvl: 3, sys: 'CONFIG', title: 'CONFIG SLATS/FLAPS NOT IN T.O CONFIG', aural: 'CRC', acts: [] });
        if (ac.ths < -1.5 || ac.ths > 6) add({ id: 'CFGTRIM', lvl: 3, sys: 'CONFIG', title: 'CONFIG PITCH TRIM NOT IN T.O RANGE', aural: 'CRC', acts: [] });
        if (ac.ctl.speedBrake > 0.05) add({ id: 'CFGSB', lvl: 3, sys: 'CONFIG', title: 'CONFIG SPD BRK NOT RETRACTED', aural: 'CRC', acts: [] });
        if (ac.ctl.parkingBrake) add({ id: 'CFGPB', lvl: 3, sys: 'CONFIG', title: 'CONFIG PARK BRK ON', aural: 'CRC', acts: [] });
        const door = Object.values(this.doors.cabin).some(Boolean) || Object.values(this.doors.cargo).some(Boolean);
        if (door) add({ id: 'CFGDOOR', lvl: 2, sys: 'DOOR', title: 'DOOR NOT CLOSED', page: 'DOOR', aural: 'SC', acts: [] });
      }
      // ---- gear
      if (inAir && ac.ra < 750 && ac.gearPos < 0.99 && (ac.ctl.flapLever >= 3 || (ac.ctl.tla[0] < 3 && ac.ra < 750)) && ac.vs < 0)
        add({ id: 'GEAR', lvl: 3, sys: 'L/G', title: 'L/G GEAR NOT DOWN', aural: 'CRC', acts: [{ t: 'L/G', v: 'DOWN', done: () => ac.gearPos > 0.99 }] });
      if (inAir && ac.ctl.gearLever === 'DOWN' && ac.gearPos < 0.99 && this.hyd.G.press < 1450 && !ac.ctl.gravityExt)
        add({ id: 'GEARLK', lvl: 2, sys: 'L/G', title: 'L/G GEAR NOT DOWNLOCKED', aural: 'SC', page: 'WHEEL', acts: [{ t: 'L/G', v: 'GRVTY EXTN', done: () => ac.ctl.gravityExt }] });
      // ---- speed
      if (ac.overspeed) add({ id: 'OVSP', lvl: 3, sys: 'OVERSPEED', title: `OVERSPEED ${ac.flap > 1 || ac.slat > 1 ? 'VFE' : ac.gearPos > 0.05 ? 'VLE' : 'VMO/MMO'}`, aural: 'CRC', acts: [{ t: 'SPEED', v: 'REDUCE', info: true }] });
      // ---- auto flight
      if (this.apDiscTimer > 0) {
        this.apDiscTimer -= dt;
        add({ id: 'APOFF', lvl: 3, sys: 'AUTO FLT', title: 'AUTO FLT AP OFF', aural: 'CAVALRY', acts: [] });
      }
      if (this.athrOffTimer > 0) {
        this.athrOffTimer -= dt;
        add({ id: 'ATHROFF', lvl: 2, sys: 'AUTO FLT', title: 'AUTO FLT A/THR OFF', aural: 'SC', acts: [{ t: 'THR LEVERS', v: 'MOVE', info: true }] });
      }
      // ---- brakes / fuel / cabin / doors
      if (Math.max(...ac.brakeTemp) > 300) add({ id: 'BRKHOT', lvl: 2, sys: 'BRAKES', title: 'BRAKES HOT', page: 'WHEEL', aural: 'SC', acts: [{ t: 'PARK BRK', v: 'PREFER CHOCKS', info: true }, { t: 'BRK FAN', v: 'ON', info: true }] });
      const T = this.tanks;
      if (T.LI + T.LO < 750 || T.RI + T.RO < 750) add({ id: 'FUELLO', lvl: 2, sys: 'FUEL', title: 'FUEL L+R WING TK LO LVL', page: 'FUEL', aural: 'SC', acts: [{ t: 'FUEL X FEED', v: 'ON', done: () => this.fuel.xfeed }] });
      if (this.press.cabAlt > 9550 && inAir) add({ id: 'CABPR', lvl: 3, sys: 'CAB PR', title: 'CAB PR EXCESS CAB ALT', page: 'PRESS', aural: 'CRC', acts: [{ t: 'CREW OXY MASKS', v: 'USE', info: true }, { t: 'SIGNS', v: 'ON', done: () => this.signs.belts }, { t: 'EMER DESCENT', v: 'INITIATE', info: true }] });
      if (running && ac.gs > 1 && (Object.values(this.doors.cabin).some(Boolean) || Object.values(this.doors.cargo).some(Boolean)))
        add({ id: 'DOORS', lvl: 2, sys: 'DOOR', title: 'DOOR NOT CLOSED', page: 'DOOR', aural: 'SC', acts: [] });
      for (let i = 0; i < 2; i++) if (E[i].phase === 'FAULT') add({ id: 'SF' + i, lvl: 2, sys: 'ENG', title: `ENG ${i + 1} START FAULT`, page: 'ENG', aural: 'SC', acts: [{ t: `ENG ${i + 1} MASTER`, v: 'OFF', done: () => !this.eng.master[i] }] });

      // ---- bookkeeping: new alerts trigger master warning/caution & aural
      const ids = new Set(alerts.map((a) => a.id));
      for (const a of alerts) {
        if (!f.lastIds.has(a.id)) {
          f.cleared.delete(a.id);
          if (a.lvl === 3) f.mw = true;
          if (a.lvl === 2) f.mc = true;
          if (a.aural === 'SC') this.chime = 'SC';
          if (a.aural === 'CAVALRY') this.chime = 'CAVALRY';
        }
        // procedure lines done?
        if (a.acts) for (const x of a.acts) x.ok = x.done ? !!x.done() : false;
      }
      f.lastIds = ids;
      f.active = alerts.filter((a) => !a.memo);
      f.shown = f.active.filter((a) => !f.cleared.has(a.id)).sort((a, b) => b.lvl - a.lvl);
      f.crc = f.active.some((a) => a.aural === 'CRC' && f.mw);
      this.memoUpdate(ac, alerts);
      this.statusUpdate(ac, lost);
      // SD auto page
      let auto;
      if (f.shown.length && f.shown[0].page) auto = f.shown[0].page;
      else if (f.shown.length === 0 && f.statusPending) auto = 'STS';
      else if (!running && ac.onGround) auto = this.eng.mode === 'IGN' ? 'ENG' : 'DOOR';
      else if (ac.onGround) auto = this.phase === 3 || this.phase === 4 ? 'ENG' : 'WHEEL';
      else if (ac.gearPos > 0.5 || (ac.alt < 16000 * FT && ac.vs < -2)) auto = ac.gearPos > 0.5 ? 'WHEEL' : 'CRUISE';
      else auto = ac.flap > 1 || ac.ra < 1500 ? 'ENG' : 'CRUISE';
      if (this.eng.mode === 'IGN' && !running) auto = 'ENG';
      if (this.apu.master && !this.apu.avail && ac.onGround) auto = 'APU';
      this.sdAuto = auto;
    }

    memoUpdate(ac, alerts) {
      const m = [];
      const r = [];
      const inAir = !ac.onGround;
      const toMemo = ac.onGround && this.engRunTime > 120 && this.phase <= 2;
      const ldgMemo = inAir && ac.ra < 2000 && ac.vs < 0 && ac.ctl.gearLever === 'DOWN';
      if (toMemo) {
        m.push({ t: 'T.O', title: true });
        m.push(ac.ctl.autobrake === 'MAX' ? { t: 'AUTO BRK MAX', g: true } : { t: 'AUTO BRK', v: 'MAX' });
        m.push(this.signs.belts && this.signs.smoke ? { t: 'SIGNS ON', g: true } : { t: 'SIGNS', v: 'ON' });
        m.push(this.cabinReady ? { t: 'CABIN READY', g: true } : { t: 'CABIN', v: 'CHECK' });
        m.push(ac.ctl.spoilersArmed ? { t: 'SPLRS ARM', g: true } : { t: 'SPLRS', v: 'ARM' });
        m.push(ac.ctl.flapLever >= 1 && ac.ctl.flapLever <= 3 ? { t: 'FLAPS T.O', g: true } : { t: 'FLAPS', v: 'T.O' });
        m.push(this.toConfigTested ? { t: 'T.O CONFIG NORMAL', g: true } : { t: 'T.O CONFIG', v: 'TEST' });
      } else if (ldgMemo) {
        m.push({ t: 'LDG', title: true });
        m.push(ac.gearPos > 0.99 ? { t: 'LDG GEAR DN', g: true } : { t: 'LDG GEAR', v: 'DN' });
        m.push(this.signs.belts ? { t: 'SIGNS ON', g: true } : { t: 'SIGNS', v: 'ON' });
        m.push(this.cabinReady ? { t: 'CABIN READY', g: true } : { t: 'CABIN', v: 'CHECK' });
        m.push(ac.ctl.spoilersArmed ? { t: 'SPLRS ARM', g: true } : { t: 'SPLRS', v: 'ARM' });
        const fl = this.ldgConf3 ? 3 : 4;
        m.push(ac.ctl.flapLever === fl ? { t: fl === 3 ? 'FLAPS CONF 3' : 'FLAPS FULL', g: true } : { t: 'FLAPS', v: fl === 3 ? 'CONF 3' : 'FULL' });
      }
      if (this.apu.avail) r.push({ t: 'APU AVAIL', c: 'g' });
      if (this.apu.avail && this.apu.bleed) r.push({ t: 'APU BLEED', c: 'g' });
      if (ac.ctl.parkingBrake) r.push({ t: 'PARK BRK', c: ac.onGround ? 'g' : 'a' });
      if (this.signs.belts) r.push({ t: 'SEAT BELTS', c: 'g' });
      if (this.signs.smoke) r.push({ t: 'NO SMOKING', c: 'g' });
      if (ac.ctl.speedBrake > 0.05) r.push({ t: 'SPEED BRK', c: Math.max(...ac.ctl.tla) > 5 ? 'a' : 'g' });
      if (ac.ctl.spoilersArmed) r.push({ t: 'GND SPLRS ARMED', c: 'g' });
      if (ac.lights.landing) r.push({ t: 'LDG LT', c: 'g' });
      if (this.hyd.ptuRunning) r.push({ t: 'HYD PTU', c: 'g' });
      if (this.hyd.ratOut) r.push({ t: 'RAT OUT', c: ac.onGround ? 'a' : 'g' });
      if (this.eng.mode === 'IGN') r.push({ t: 'IGNITION', c: 'g' });
      if (ac.ctl.autobrake !== 'OFF') r.push({ t: 'AUTO BRK ' + ac.ctl.autobrake, c: 'g' });
      if (this.fuel.xfeed) r.push({ t: 'FUEL X FEED', c: 'g' });
      if (this.elec.extOn) r.push({ t: 'EXT PWR', c: 'g' });
      if (ac.ctl.gravityExt) r.push({ t: 'L/G GRVTY', c: 'g' });
      if (this.fwc.tcasStby) r.push({ t: 'TCAS STBY', c: 'g' });
      this.fwc.memo = m;
      this.fwc.rightMemo = r;
    }

    statusUpdate(ac, lost) {
      const s = { lim: [], proc: [], inop: [], info: [] };
      const G = lost.includes('G'),
        Y = lost.includes('Y'),
        B = lost.includes('B');
      const law = ac.fbw.law;
      if (lost.length >= 2) {
        s.lim.push('MAX SPD............320 KT');
        s.lim.push('APPR SPD......VREF + 25');
        if (G) s.lim.push('L/G...........GRVTY EXTN');
        s.lim.push('LDG DIST PROC.......APPLY');
        if (G || Y) s.lim.push('FOR LDG.......USE FLAP 3');
        s.info.push('SLATS SLOW');
        if (G && Y) s.info.push('FLAPS LOCKED');
        s.info.push('CAT 1 ONLY');
        if (G && Y) s.info.push('BRK Y ACCU PR ONLY');
        if (!ac.fbw.pitchTrimAvail) s.info.push('PITCH TRIM INOP (STAB FROZEN)');
        s.inop.push(`${lost.join('+')} HYD`, 'AP 1+2', 'CAT 2/3');
        if (G || Y) s.inop.push('YAW DAMPER', 'FLAPS');
        if (G && Y) s.inop.push('SPLR 1+2+4+5', 'NORM BRK', 'ALTN BRK', 'N/W STRG', 'REVERSER 1+2', 'ANTI SKID');
        if (G && B) s.inop.push('SPLR 1+3+5', 'NORM BRK', 'REVERSER 1');
      } else if (lost.length === 1) {
        s.inop.push(lost[0] + ' HYD');
        if (G) s.info.push('SLATS/FLAPS SLOW', 'L/G GRVTY EXTN IF REQUIRED');
      }
      if (law === 'ALTN' || law === 'DIRECT') {
        s.lim.unshift(`${law === 'ALTN' ? 'ALTN' : 'DIRECT'} LAW : PROT LOST`);
        if (law === 'ALTN') s.lim.push('WHEN L/G DN : DIRECT LAW');
        if (law === 'DIRECT' && ac.fbw.pitchTrimAvail) s.lim.push('USE MAN PITCH TRIM');
        s.inop.push('F/CTL PROT');
      }
      for (let i = 0; i < 2; i++) if (!ac.onGround && !ac.eng[i].running) s.inop.push(`ENG ${i + 1}`, `GEN ${i + 1}`);
      const has = s.lim.length + s.proc.length + s.inop.length + s.info.length > 0;
      this.fwc.status = has ? s : null;
      if (has && !this.fwc.statusSeen) this.fwc.statusPending = true;
      if (!has) {
        this.fwc.statusPending = false;
        this.fwc.statusSeen = false;
      }
    }

    // ECAM control panel
    clr() {
      const f = this.fwc;
      if (f.shown.length) {
        f.cleared.add(f.shown[0].id);
        f.mw = f.mc = false;
        return;
      }
      if (this.sdPage === 'STS') {
        this.sdPage = null;
        f.statusPending = false;
        f.statusSeen = true;
      } else this.sdPage = null;
    }
    rcl() {
      this.fwc.cleared.clear();
    }
    pressPage(p) {
      this.sdPage = this.sdPage === p ? null : p;
      if (p === 'STS') this.fwc.statusSeen = true;
    }
    toConfig() {
      const ac = this.ac;
      const ok = ac.ctl.flapLever >= 1 && ac.ctl.flapLever <= 3 && ac.ths >= -1.5 && ac.ths <= 6 && ac.ctl.speedBrake < 0.05 && !ac.ctl.parkingBrake;
      this.toConfigTested = ok;
      if (!ok) this.fwc.mw = true;
      this.toConfigResult = ok ? 'NORMAL' : 'FAULT';
      return ok;
    }

    // engine master switches
    setMaster(i, on) {
      this.eng.master[i] = on;
      const e = this.ac.eng[i];
      if (!on) {
        e.running = false;
        if (e.phase !== 'OFF') e.phase = 'SPOOL';
      }
    }

    failHydraulics(list) {
      // dual failure scenario: rapid fluid loss
      for (const k of list) this.hyd[k].leak = 0.9;
    }
    get page() {
      return this.sdPage || this.sdAuto;
    }
  }

  FS.A320Systems = A320Systems;
})(typeof window !== 'undefined' ? window : globalThis);
