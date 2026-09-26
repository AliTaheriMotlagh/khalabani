/*
 * A320 Flight Management & Guidance System (simplified FMGC + FCU + AP/FD + A/THR).
 *  - Navigation database from the world (navaids, fixes, airports, generated SIDs / ILS approaches)
 *  - Flight plan with legs, altitude/speed constraints, discontinuities, sequencing, DIR TO
 *  - Performance: V1/VR/V2, FLEX, THR RED/ACC altitudes, VLS/F/S/green dot, VAPP, managed speed by phase
 *  - FCU: SPD/MACH, HDG/TRK, ALT, V/S-FPA with push (managed) / pull (selected), LOC, APPR, EXPED, AP1/AP2, A/THR
 *  - Modes  lateral: RWY, RWY TRK, NAV, HDG, TRACK, LOC*, LOC, LAND, FLARE, ROLL OUT, GA TRK
 *           vertical: SRS, CLB, OP CLB, DES, OP DES, ALT*, ALT, ALT CST*, ALT CST, V/S, FPA, G/S*, G/S, LAND, FLARE
 *           A/THR: SPEED, MACH, THR CLB, THR IDLE, MAN TOGA, MAN FLX, MAN MCT, THR LVR, A.FLOOR, TOGA LK
 * Sim procedures are simplified and fictional in detail — not for real-world navigation.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG, RAD, KT, FT, NM, G, FPM } = FS.U;

  // ------------------------------------------------------------------ navigation database
  class NavDB {
    constructor(navaids, world) {
      this.pts = new Map();
      this.airports = new Map();
      for (const v of navaids) {
        if (v.type === 'VOR' || v.type === 'NDB') this.pts.set(v.ident, { ident: v.ident, n: v.n, e: v.e, type: v.type, freq: v.freq });
      }
      if (world.fixes) for (const f of world.fixes()) this.pts.set(f.ident, f);
      this.ils = navaids.filter((v) => v.type === 'LOC');
      for (const ap of world.airports) {
        this.airports.set(ap.icao, ap);
        this.pts.set(ap.icao, { ident: ap.icao, n: ap.n, e: ap.e, type: 'ARPT' });
        for (const rw of ap.runways) for (const t of rw.thr) this.pts.set(ap.icao + t.id, { ident: 'RW' + t.id, n: t.n, e: t.e, type: 'RWY', elev: t.elev });
      }
      this.world = world;
    }
    find(id) {
      id = (id || '').toUpperCase();
      return this.pts.get(id) || null;
    }
    ilsFor(icao, rwy) {
      return this.ils.find((l) => l.apt === icao && l.rwy === rwy) || null;
    }
    // generated SIDs: runway track to an altitude, then direct to an exit fix
    sids(icao, rwy) {
      const ap = this.airports.get(icao);
      if (!ap) return [];
      const t = this.rwyThr(icao, rwy);
      if (!t) return [];
      const exits = icao === 'OIII' ? (rwy.startsWith('29') ? ['RUS', 'KARAJ', 'VR'] : ['KAZ', 'VR', 'EAST1']) : ['RUS', 'VR', 'KAZ'];
      return exits.map((x, i) => ({ name: x.slice(0, 3) + (i + 1) + (rwy.startsWith('29') ? 'W' : 'E'), exit: x, climbTo: 6000 + i * 500 }));
    }
    approaches(icao) {
      return this.ils.filter((l) => l.apt === icao).map((l) => ({ name: 'ILS' + l.rwy, rwy: l.rwy, ils: l }));
    }
    vias(icao, rwy) {
      if (icao === 'OIII') return rwy.startsWith('29') ? ['VR', 'KAZ', 'THR01', 'RUS'] : ['KARAJ', 'WEST1', 'RUS'];
      return ['KAZ', 'RUS', 'SOUTH'];
    }
    rwyThr(icao, rwy) {
      const ap = this.airports.get(icao);
      if (!ap) return null;
      for (const r of ap.runways) for (const t of r.thr) if (t.id === rwy) return t;
      return null;
    }
  }

  const leg = (p, o) => Object.assign({ ident: p.ident, n: p.n, e: p.e, type: 'TF', alt: null, spd: null }, o || {});

  // ------------------------------------------------------------------ FMGS
  class FMGS {
    constructor(ac, navaids, world) {
      this.ac = ac;
      this.db = new NavDB(navaids, world);
      this.fcu = {
        spd: 250, mach: 0.78, spdManaged: true, isMach: false,
        hdg: 290, hdgManaged: true, alt: 5000, altInc: 100, vs: null, fpa: null, trkFpa: false,
        ap1: false, ap2: false, athr: false, loc: false, appr: false, exped: false, fd: [true, true], ls: [false, false],
        baro: [1013, 1013], std: [false, false], inHg: false,
      };
      this.efis = { mode: 'ARC', range: 20, cstr: true, wpt: false, vord: true, ndb: true, arpt: true, nav1: 'VOR', nav2: 'ADF' };
      this.d = {
        from: '', to: '', altn: 'OIIE', flt: 'IRA123', ci: 30, crzFL: 330, tropo: 36090, zfw: 58.0, zfwcg: 28.0, block: 8.0, taxi: 0.2, rsv: 1.5,
        dep: null, sid: null, arr: null, via: null, v1: null, vr: null, v2: null, flex: null, thrRed: null, acc: null, transAlt: 9000,
        qnhDest: null, tempDest: null, windDest: '', mda: null, dh: null, ldgConf3: false, vappSel: null, toShift: null,
      };
      this.plan = [];
      this.active = 0;
      this.phase = 'PREFLIGHT';
      this.lat = { mode: '', armed: '' };
      this.vert = { mode: '', armed: [] };
      this.athrMode = '';
      this.athrArmed = false;
      this.athrFrac = 0.3;
      this.messages = [];
      this.fd = { pitch: 0, roll: 0 };
      this.gammaCmd = 0;
      this.bankCmd = 0;
      this.navOut = null;
      this.lastV = 0;
      this.accelF = 0;
      this.flareVs = null;
      this.appPhaseActive = false;
      this.radio = { vor1: { freq: 115.3, crs: 290, ident: 'TRN' }, vor2: { freq: 116.95, crs: 0, ident: 'RUS' }, ils: { freq: 109.9, crs: 285 }, adf1: 373, adf2: 358, autoIls: true };
      this.lvrClb = false;
      this.alphaFloorLatch = false;
      this.retard = false;
    }

    msg(t) {
      if (!this.messages.includes(t)) this.messages.push(t);
    }

    // ---------------------------------------------------------------- flight plan building
    setFromTo(from, to) {
      if (!this.db.airports.get(from) || !this.db.airports.get(to)) return false;
      this.d.from = from;
      this.d.to = to;
      const A = this.db.airports.get(from),
        B = this.db.airports.get(to);
      this.plan = [leg({ ident: from, n: A.n, e: A.e }, { type: 'ORIG' }), { disc: true }, leg({ ident: to, n: B.n, e: B.e }, { type: 'DEST' })];
      this.active = 1;
      return true;
    }
    destIdx() {
      return this.plan.findIndex((l) => l.type === 'DEST');
    }
    setDeparture(rwy, sidName) {
      const t = this.db.rwyThr(this.d.from, rwy);
      if (!t) return false;
      this.d.dep = rwy;
      const orig = this.plan.findIndex((l) => l.type === 'ORIG');
      // remove old departure legs
      let end = orig + 1;
      while (end < this.plan.length && this.plan[end].sid) end++;
      this.plan.splice(orig + 1, end - orig - 1);
      const legs = [];
      const h = t.hdg * DEG;
      legs.push(leg({ ident: 'RW' + rwy, n: t.n, e: t.e }, { sid: true, type: 'RWY', alt: null }));
      if (sidName) {
        const sid = this.db.sids(this.d.from, rwy).find((s) => s.name === sidName);
        if (sid) {
          this.d.sid = sidName;
          const c = { n: t.n + Math.cos(h) * 6 * NM, e: t.e + Math.sin(h) * 6 * NM };
          legs.push(leg({ ident: 'D' + String(Math.round(FS.mag(t.hdg))).padStart(3, '0') + 'F', n: c.n, e: c.e }, { sid: true, alt: { t: '+', v: 5500 } }));
          const x = this.db.find(sid.exit);
          if (x) legs.push(leg(x, { sid: true, alt: { t: '+', v: sid.climbTo + 2000 } }));
        }
      } else this.d.sid = null;
      legs.push({ disc: true, sid: true });
      this.plan.splice(orig + 1, 0, ...legs);
      this.active = Math.min(orig + 2, this.plan.length - 1);
      this.d.thrRed = this.d.thrRed || Math.round(t.elev / FT + 1500);
      this.d.acc = this.d.acc || Math.round(t.elev / FT + 1500);
      this.cleanDiscs();
      return true;
    }
    setArrival(apprName, via) {
      const ap = this.db.airports.get(this.d.to);
      if (!ap) return false;
      const appr = this.db.approaches(this.d.to).find((a) => a.name === apprName);
      if (!appr) return false;
      this.d.arr = apprName;
      this.d.via = via || null;
      const di = this.destIdx();
      // remove previous arrival legs
      this.plan = this.plan.filter((l) => !l.arr);
      const t = appr.ils.thr;
      const h = t.hdg * DEG;
      const gs = (appr.ils.gs ? appr.ils.gs.angle : 3) * DEG;
      const legs = [];
      if (via) {
        const v = this.db.find(via);
        if (v) legs.push(leg(v, { arr: true, alt: { t: '+', v: 9000 }, spd: 250 }));
      }
      const pos = (d) => ({ n: t.n - Math.cos(h) * d, e: t.e - Math.sin(h) * d });
      const ci = pos(11 * NM),
        ff = pos(5.5 * NM);
      const altFF = Math.round((t.elev + Math.tan(gs) * 5.5 * NM + 15) / FT / 100) * 100;
      const altCI = Math.round((t.elev + Math.tan(gs) * 11 * NM) / FT / 100) * 100;
      legs.push(leg({ ident: 'CI' + appr.rwy, ...ci }, { arr: true, alt: { t: '+', v: altCI }, spd: 210 }));
      legs.push(leg({ ident: 'FF' + appr.rwy, ...ff }, { arr: true, alt: { t: '@', v: altFF }, spd: 180, faf: true }));
      legs.push(leg({ ident: 'RW' + appr.rwy, n: t.n, e: t.e }, { arr: true, alt: { t: '@', v: Math.round(t.elev / FT + 50) }, rwy: true, thrElev: t.elev }));
      // missed approach: runway track climbing to 7000, then TRN
      const map = { n: t.n + Math.cos(h) * 7 * NM, e: t.e + Math.sin(h) * 7 * NM };
      legs.push(leg({ ident: 'MAPT', ...map }, { arr: true, missed: true, alt: { t: '+', v: 7000 } }));
      const trn = this.db.find(this.d.to === 'OIII' ? 'VR' : 'KAZ');
      if (trn) legs.push(leg(trn, { arr: true, missed: true, alt: { t: '@', v: 9000 } }));
      const destLeg = this.plan[this.destIdx()];
      destLeg.hidden = true;
      this.plan.splice(this.destIdx(), 0, ...legs);
      // ILS auto-tune
      if (this.radio.autoIls) {
        this.radio.ils = { freq: appr.ils.freq, crs: appr.ils.course, ident: appr.ils.ident };
      }
      this.d.appr = appr;
      this.cleanDiscs();
      void di;
      return true;
    }
    cleanDiscs() {
      // remove consecutive discontinuities and a leading/trailing one next to arrivals
      const out = [];
      for (const l of this.plan) {
        if (l.disc && out.length && out[out.length - 1].disc) continue;
        out.push(l);
      }
      this.plan = out;
      if (this.active >= this.plan.length) this.active = this.plan.length - 1;
    }
    insertWpt(idx, ident) {
      const p = this.db.find(ident);
      if (!p) return false;
      this.plan.splice(idx, 0, leg(p));
      if (idx <= this.active) this.active++;
      return true;
    }
    deleteAt(idx) {
      if (idx < 0 || idx >= this.plan.length) return false;
      const l = this.plan[idx];
      if (l.type === 'ORIG' || l.type === 'DEST') return false;
      this.plan.splice(idx, 1);
      if (idx < this.active) this.active--;
      if (this.active < 1) this.active = 1;
      this.cleanDiscs();
      return true;
    }
    directTo(ident) {
      let idx = this.plan.findIndex((l, i) => i >= 1 && !l.disc && l.ident === ident);
      if (idx < 0) {
        const p = this.db.find(ident);
        if (!p) return false;
        idx = Math.max(this.active, 1);
        this.plan.splice(idx, 0, leg(p));
      }
      this.plan[idx].dirFrom = { n: this.ac.pos.x, e: this.ac.pos.y };
      this.active = idx;
      // remove discontinuity right before
      this.cleanDiscs();
      if (!this.lat.mode.startsWith('NAV') && !this.lat.mode.startsWith('LOC') && this.anyAP()) this.lat.mode = 'NAV';
      if (this.lat.mode === 'HDG' && this.fcu.hdgManaged) this.lat.mode = 'NAV';
      return true;
    }

    // ---------------------------------------------------------------- performance
    perf() {
      const ac = this.ac;
      const s0 = ac.speeds(0),
        s1 = ac.speeds(1),
        s2 = ac.speeds(2),
        s3 = ac.speeds(3),
        sF = ac.speeds(4);
      const gd = s0.greenDot;
      const vlsFull = this.d.ldgConf3 ? s3.vls : sF.vls;
      const vapp = this.d.vappSel || Math.round(vlsFull + 5);
      return { gd, S: Math.round(s1.vls * 1.1 + 12), F: Math.round(s2.vls * 1.08 + 8), vapp, vls: ac.speeds().vls, vlsFull };
    }
    toSpeeds() {
      const s = this.ac.speeds('1+F');
      const vs = s.vs1g;
      return { v1: Math.round(vs * 1.18), vr: Math.round(vs * 1.2), v2: Math.round(vs * 1.25) };
    }

    // ---------------------------------------------------------------- FCU actions
    anyAP() {
      return this.fcu.ap1 || this.fcu.ap2;
    }
    press(btn) {
      const f = this.fcu,
        ac = this.ac;
      switch (btn) {
        case 'AP1':
        case 'AP2': {
          const k = btn === 'AP1' ? 'ap1' : 'ap2';
          if (f[k]) {
            f[k] = false;
            if (!this.anyAP()) this.apOff(false);
          } else if (this.apAvailable()) {
            f[k] = true;
            if (!(this.fcu.appr && btn)) {
              // single AP unless in APPR mode (autoland needs both)
              if (!f.appr) f[k === 'ap1' ? 'ap2' : 'ap1'] = false;
            }
            if (!this.lat.mode) this.engageBasic();
          }
          break;
        }
        case 'ATHR':
          if (f.athr) {
            f.athr = false;
            this.athrOff(false);
          } else f.athr = true;
          break;
        case 'LOC':
          f.loc = !f.loc;
          f.appr = false;
          if (f.loc) this.lat.armed = 'LOC';
          else this.lat.armed = '';
          this.vert.armed = this.vert.armed.filter((m) => m !== 'G/S');
          break;
        case 'APPR':
          f.appr = !f.appr;
          f.loc = false;
          if (f.appr) {
            this.lat.armed = 'LOC';
            if (!this.vert.armed.includes('G/S')) this.vert.armed.push('G/S');
          } else {
            this.lat.armed = '';
            this.vert.armed = this.vert.armed.filter((m) => m !== 'G/S');
          }
          break;
        case 'EXPED':
          f.exped = !f.exped;
          break;
        case 'SPD_PUSH':
          f.spdManaged = true;
          break;
        case 'SPD_PULL':
          f.spdManaged = false;
          f.spd = Math.round(this.spdTarget || ac.ias);
          break;
        case 'HDG_PUSH':
          if (this.hasNavPlan()) {
            f.hdgManaged = true;
            if (this.airborne()) this.lat.mode = 'NAV';
            else this.lat.armed = 'NAV';
          }
          break;
        case 'HDG_PULL':
          f.hdgManaged = false;
          if (this.lat.mode !== 'HDG') f.hdg = Math.round(FS.mag(ac.heading));
          if (this.airborne()) {
            this.lat.mode = f.trkFpa ? 'TRACK' : 'HDG';
            this.lat.armed = this.lat.armed === 'NAV' ? '' : this.lat.armed;
          }
          break;
        case 'ALT_PUSH':
          if (this.airborne()) this.managedVert(true);
          break;
        case 'ALT_PULL':
          if (this.airborne()) this.managedVert(false);
          break;
        case 'VS_PUSH':
          if (this.airborne()) {
            f.vs = 0;
            this.vert.mode = f.trkFpa ? 'FPA' : 'V/S';
          }
          break;
        case 'VS_PULL':
          if (this.airborne()) {
            f.vs = Math.round(ac.vs / FPM / 100) * 100;
            this.vert.mode = f.trkFpa ? 'FPA' : 'V/S';
          }
          break;
        case 'TRKFPA':
          f.trkFpa = !f.trkFpa;
          break;
        case 'SPDMACH':
          f.isMach = !f.isMach;
          break;
        case 'METRIC':
          break;
      }
    }
    turn(knob, d, big) {
      const f = this.fcu;
      if (knob === 'SPD') {
        if (f.isMach) f.mach = FS.clamp(+(f.mach + d * 0.01).toFixed(2), 0.1, 0.82);
        else {
          if (f.spdManaged) {
            f.spdManaged = false;
            f.spd = Math.round(this.spdTarget || this.ac.ias);
          } else f.spd = FS.clamp(f.spd + d * (big ? 10 : 1), 100, 399);
        }
      } else if (knob === 'HDG') {
        f.hdg = FS.wrap360(Math.round(f.hdg + d * (big ? 10 : 1)));
        if (f.hdgManaged) this.hdgPreset = true;
      } else if (knob === 'ALT') f.alt = FS.clamp(f.alt + d * (big ? 1000 : f.altInc), 100, 39000);
      else if (knob === 'VS') {
        if (f.trkFpa) f.fpa = FS.clamp(+((f.fpa || 0) + d * 0.1).toFixed(1), -9.9, 9.9);
        else f.vs = FS.clamp((f.vs || 0) + d * 100, -6000, 6000);
      }
    }
    managedVert(managed) {
      const ac = this.ac,
        f = this.fcu;
      const altNow = this.indAlt();
      const climb = f.alt > altNow + 50;
      if (Math.abs(f.alt - altNow) < 60) return;
      if (climb) this.vert.mode = managed && this.hasNavPlan() ? 'CLB' : 'OP CLB';
      else this.vert.mode = managed && this.hasNavPlan() ? 'DES' : 'OP DES';
      if (!climb && this.phase === 'CRUISE') this.phase = 'DESCENT';
      if (climb && this.phase === 'TAKEOFF') this.phase = 'CLIMB';
      void ac;
    }
    engageBasic() {
      // AP engaged without active modes -> HDG + V/S
      if (!this.lat.mode) this.lat.mode = 'HDG';
      if (!this.vert.mode) {
        this.vert.mode = 'V/S';
        this.fcu.vs = Math.round(this.ac.vs / FPM / 100) * 100;
      }
    }
    apAvailable() {
      const ac = this.ac;
      return ac.fbw.law === 'NORMAL' && ac.hasPower() && !ac.crashed && (!ac.onGround || true) && !ac.protActive;
    }
    apOff(involuntary) {
      this.fcu.ap1 = this.fcu.ap2 = false;
      if (this.ac.sys) this.ac.sys.apDiscTimer = involuntary ? 999 : 1.8;
      this.apWarnInvol = involuntary;
      if (this.onApDisc) this.onApDisc(involuntary);
    }
    athrOff(involuntary) {
      this.fcu.athr = false;
      this.ac.athrActive = false;
      if (this.ac.sys && involuntary) this.ac.sys.athrOffTimer = 999;
      if (this.ac.sys && !involuntary) this.ac.sys.athrOffTimer = 0;
    }
    instinctiveAPDisc() {
      if (this.anyAP()) this.apOff(false);
      else if (this.ac.sys) this.ac.sys.apDiscTimer = 0; // second push silences
    }
    instinctiveATHRDisc() {
      if (this.fcu.athr) this.athrOff(false);
      if (this.ac.sys) this.ac.sys.athrOffTimer = 0;
    }

    hasNavPlan() {
      return this.plan.length > 2 && this.activeLeg() != null;
    }
    airborne() {
      return !this.ac.onGround && this.ac.ra > 30;
    }
    indAlt() {
      return this.ac.indAltFt != null ? this.ac.indAltFt : this.ac.alt / FT;
    }
    activeLeg() {
      let i = this.active;
      while (i < this.plan.length && (this.plan[i].disc || this.plan[i].hidden)) {
        if (this.plan[i].disc) return null;
        i++;
      }
      if (i >= this.plan.length) return null;
      return this.plan[i];
    }
    prevPos(i) {
      const l = this.plan[i];
      if (l.dirFrom) return l.dirFrom;
      for (let k = i - 1; k >= 0; k--) if (!this.plan[k].disc && !this.plan[k].hidden) return this.plan[k];
      return { n: this.ac.pos.x, e: this.ac.pos.y };
    }

    // ---------------------------------------------------------------- lateral navigation computations
    navCompute() {
      const ac = this.ac;
      const L = this.activeLeg();
      if (!L) {
        this.navOut = null;
        return null;
      }
      const idx = this.plan.indexOf(L);
      const P0 = this.prevPos(idx);
      const pn = ac.pos.x,
        pe = ac.pos.y;
      let dtk = Math.atan2(L.e - P0.e, L.n - P0.n);
      if (Math.hypot(L.e - P0.e, L.n - P0.n) < 50) dtk = Math.atan2(L.e - pe, L.n - pn);
      const dn = pn - P0.n,
        de = pe - P0.e;
      const xtk = -dn * Math.sin(dtk) + de * Math.cos(dtk); // + right of course
      const dist = Math.hypot(L.n - pn, L.e - pe);
      const brg = Math.atan2(L.e - pe, L.n - pn);
      // sequencing with turn anticipation
      let next = null;
      for (let k = idx + 1; k < this.plan.length; k++) {
        if (this.plan[k].disc) break;
        if (!this.plan[k].hidden) {
          next = this.plan[k];
          break;
        }
      }
      const V = Math.max(ac.gs, 60);
      const R = (V * V) / (G * Math.tan(25 * DEG));
      let anticip = 300;
      if (next && !L.rwy) {
        const dtk2 = Math.atan2(next.e - L.e, next.n - L.n);
        const dA = Math.abs(FS.wrapPi(dtk2 - dtk));
        anticip = Math.min(R * Math.tan(dA / 2), 8 * NM);
      }
      const along = (L.n - pn) * Math.cos(dtk) + (L.e - pe) * Math.sin(dtk);
      if ((dist < Math.max(anticip, 400) || along < 0) && !L.rwy && this.airborne()) {
        if (this.plan[idx + 1] && !this.plan[idx + 1].disc) {
          this.active = idx + 1;
          L.passed = true;
          delete this.plan[this.active].dirFrom;
        } else if (this.plan[idx + 1] && this.plan[idx + 1].disc) {
          this.active = idx + 1; // entering a discontinuity: NAV will drop to HDG
        }
      }
      this.navOut = { leg: L, dtk: FS.wrap360(dtk * RAD), xtk, dist, brg: FS.wrap360(brg * RAD), next };
      return this.navOut;
    }

    // ---------------------------------------------------------------- speeds
    managedSpeed() {
      const ac = this.ac,
        d = this.d,
        p = this.perf();
      const alt = this.indAlt();
      switch (this.phase) {
        case 'PREFLIGHT':
        case 'TAKEOFF':
          return (d.v2 || this.toSpeeds().v2) + 10;
        case 'CLIMB':
          return alt < 10000 ? 250 : this.machOrCas(0.78, 290);
        case 'CRUISE':
          return this.machOrCas(0.78, 290);
        case 'DESCENT':
          return alt < 10500 ? 250 : this.machOrCas(0.78, 300);
        case 'APPROACH': {
          const fl = ac.ctl.flapLever;
          const tgt = [p.gd, p.S, p.F, p.F, p.vapp][fl];
          return Math.max(p.vapp, tgt);
        }
        case 'GOAROUND':
          return Math.max((d.v2 || 140) + 10, ac.ias);
      }
      return 250;
    }
    machOrCas(m, cas) {
      // crossover altitude: when Mach target gives lower CAS, fly Mach
      const atm = this.ac.atm;
      if (!atm) return cas;
      const a = atm.a;
      const tas = m * a;
      const qc = atm.p * (Math.pow(1 + 0.2 * m * m, 3.5) - 1);
      const casOfM = 661.47 * Math.sqrt(5 * (Math.pow(qc / 101325 + 1, 0.2857) - 1));
      void tas;
      this.useMach = casOfM < cas;
      return Math.min(cas, casOfM);
    }

    // ---------------------------------------------------------------- main update
    update(dt, ac, radios, env) {
      const f = this.fcu,
        d = this.d;
      if (ac.crashed) return;
      const alt = this.indAlt();
      const ra = ac.ra / FT;
      const V = ac.ias;
      const ils = radios && radios.ils;
      this.accelF += ((V - this.lastV) / Math.max(dt, 1e-3) - this.accelF) * FS.lagK(dt, 1.0);
      this.lastV = V;
      const nav = this.hasNavPlan() ? this.navCompute() : (this.navOut = null);

      // ---------- flight phase
      const tla = Math.max(ac.ctl.tla[0], ac.ctl.tla[1]);
      if (this.phase === 'PREFLIGHT' && ac.onGround && tla >= 34) {
        this.phase = 'TAKEOFF';
        this.lat.mode = ils && ils.valid && Math.abs(ils.cdi) < 1 ? 'RWY' : 'RWY TRK';
        this.vert.mode = 'SRS';
        if (this.hasNavPlan()) this.lat.armed = 'NAV';
        this.vert.armed = ['CLB'];
        if (f.athr === false && tla >= 34) f.athr = true; // A/THR armed on takeoff
        this.athrArmed = true;
        this.toAlt = alt;
      }
      if (this.phase === 'TAKEOFF' && !ac.onGround && alt > (d.acc || this.toAlt + 1500)) this.phase = 'CLIMB';
      if (this.phase === 'CLIMB' && alt >= d.crzFL * 100 - 50) this.phase = 'CRUISE';
      if ((this.phase === 'CRUISE' || this.phase === 'CLIMB') && f.alt < alt - 500 && (this.vert.mode.includes('DES') || this.vert.mode === 'V/S')) this.phase = 'DESCENT';
      // automatic approach phase when passing the DECEL point (~ CI fix) or manually activated
      if ((this.phase === 'DESCENT' || this.phase === 'CRUISE' || this.phase === 'CLIMB') && nav && nav.leg.arr && (nav.leg.ident.startsWith('FF') || (nav.leg.ident.startsWith('CI') && nav.dist < 8 * NM))) this.phase = 'APPROACH';
      if (this.appPhaseActive && this.phase !== 'APPROACH' && this.phase !== 'GOAROUND') this.phase = 'APPROACH';
      if (ac.onGround && this.phase === 'APPROACH' && V < 60) this.phase = 'DONE';

      // ---------- lateral mode transitions
      if (this.lat.mode === 'RWY' || this.lat.mode === 'RWY TRK') {
        if (!ac.onGround && ra > 30 && this.lat.armed === 'NAV' && nav) {
          this.lat.mode = 'NAV';
          this.lat.armed = '';
        } else if (!ac.onGround && ra > 30 && this.lat.mode === 'RWY') this.lat.mode = 'RWY TRK';
      }
      if (this.lat.mode === 'NAV' && !nav) {
        this.lat.mode = 'HDG';
        f.hdg = Math.round(FS.mag(ac.heading));
        this.msg('F-PLN DISCONTINUITY');
      }
      if (this.lat.armed === 'NAV' && this.lat.mode === 'HDG' && nav && Math.abs(nav.xtk) < 2 * NM) {
        this.lat.mode = 'NAV';
        this.lat.armed = '';
      }
      if (this.lat.armed === 'LOC' && ils && ils.valid && ils.type === 'LOC' && !ils.backCourse && Math.abs(ils.cdi) < 1.0 && !ac.onGround) {
        this.lat.mode = 'LOC*';
        this.lat.armed = '';
        this.locCaptT = 0;
      }
      if (this.lat.mode === 'LOC*') {
        this.locCaptT = (this.locCaptT || 0) + dt;
        if (Math.abs(ils.cdi) < 0.15 && this.locCaptT > 4) this.lat.mode = 'LOC';
      }
      // ---------- vertical transitions
      if (this.vert.mode === 'SRS' && !ac.onGround && alt > (d.acc || this.toAlt + 1500)) {
        this.vert.mode = this.hasNavPlan() ? 'CLB' : 'OP CLB';
        this.vert.armed = [];
        if (f.alt < alt) this.vert.mode = 'V/S';
      }
      // thrust reduction altitude: ask for levers to CL
      this.lvrClb = !ac.onGround && this.phase !== 'PREFLIGHT' && tla > 26 && f.athr && alt > (d.thrRed || (this.toAlt || 0) + 1500) && this.vert.mode !== 'SRS' && this.phase !== 'GOAROUND';
      if (this.phase === 'TAKEOFF' && tla > 26 && alt > (d.thrRed || (this.toAlt || 0) + 1500)) this.lvrClb = true;
      // G/S capture
      if (this.vert.armed.includes('G/S') && ils && ils.gsValid && (this.lat.mode === 'LOC' || this.lat.mode === 'LOC*') && ils.gs < 0.4 && ils.gs > -1.2) {
        this.vert.mode = 'G/S*';
        this.vert.armed = this.vert.armed.filter((m) => m !== 'G/S');
        this.gsCaptT = 0;
        if (this.phase !== 'APPROACH') this.phase = 'APPROACH';
      }
      if (this.vert.mode === 'G/S*') {
        this.gsCaptT += dt;
        if (Math.abs(ils.gs) < 0.35 && this.gsCaptT > 3) this.vert.mode = 'G/S';
      }
      // LAND / FLARE / ROLL OUT (autoland)
      if ((this.vert.mode === 'G/S' || this.vert.mode === 'G/S*') && this.lat.mode.startsWith('LOC') && ra < 400 && ra > 0) {
        this.vert.mode = 'LAND';
        this.lat.mode = 'LAND';
      }
      if (this.vert.mode === 'LAND' && ra < 50) {
        this.vert.mode = 'FLARE';
        this.lat.mode = 'FLARE';
      }
      if ((this.vert.mode === 'FLARE' || this.vert.mode === 'LAND') && ac.onGround) {
        this.vert.mode = 'ROLL OUT';
        this.lat.mode = 'ROLL OUT';
      }
      // altitude capture (ALT*) for climb/descent modes
      const tgtAlt = this.targetAltitude();
      const climbModes = ['CLB', 'OP CLB', 'SRS'];
      const desModes = ['DES', 'OP DES'];
      const vsModes = ['V/S', 'FPA'];
      const vsFpm = ac.vs / FPM;
      if (climbModes.includes(this.vert.mode) || desModes.includes(this.vert.mode) || vsModes.includes(this.vert.mode)) {
        const toGo = tgtAlt.alt - alt;
        const capt = Math.max(Math.abs(vsFpm) / 6, 100);
        const towards = Math.sign(toGo) === Math.sign(vsFpm || toGo);
        if (Math.abs(toGo) < capt && towards && this.vert.mode !== 'SRS') {
          this.vert.mode = tgtAlt.cst ? 'ALT CST*' : 'ALT*';
          this.altCapT = tgtAlt.alt;
        }
        // climb mode but target below / des mode but target above -> revert to V/S
        if (climbModes.includes(this.vert.mode) && this.vert.mode !== 'SRS' && toGo < -100) {
          this.vert.mode = 'V/S';
          f.vs = 0;
        }
        if (desModes.includes(this.vert.mode) && toGo > 100) {
          this.vert.mode = 'V/S';
          f.vs = 0;
        }
      }
      if ((this.vert.mode === 'ALT*' || this.vert.mode === 'ALT CST*') && Math.abs(this.altCapT - alt) < 20 && Math.abs(vsFpm) < 150) this.vert.mode = this.vert.mode === 'ALT*' ? 'ALT' : 'ALT CST';
      if ((this.vert.mode === 'ALT' || this.vert.mode === 'ALT CST') && this.vert.mode === 'ALT CST' && !tgtAlt.cst) this.vert.mode = 'ALT';
      if (this.vert.mode === 'ALT CST' && tgtAlt.cst && Math.abs(tgtAlt.alt - this.altCapT) > 100) this.vert.mode = tgtAlt.alt > alt ? 'CLB' : 'DES';

      // ---------- speed target
      const managed = f.spdManaged && this.vert.mode !== 'V/S';
      let spd = f.spdManaged ? this.managedSpeed() : f.isMach ? this.casFromMach(f.mach) : f.spd;
      if (f.spdManaged && nav && nav.leg.spd && this.phase !== 'TAKEOFF') spd = Math.min(spd, nav.leg.spd);
      if (f.exped && this.vert.mode.includes('CLB')) spd = this.perf().gd;
      if (f.exped && this.vert.mode.includes('DES')) spd = 340;
      if (this.phase === 'GOAROUND' && this.vert.mode === 'SRS') spd = Math.max((d.v2 || 140) + 10, spd);
      const vmax = this.vmax();
      const vls = this.perf().vls;
      spd = FS.clamp(spd, vls, vmax - 5);
      this.spdTarget = spd;
      void managed;

      // ---------- guidance: lateral -> bank command
      let bank = 0;
      const hdgMag = FS.mag(ac.heading);
      const trk = FS.mag(ac.track);
      const lm = this.lat.mode;
      const bankLim = (this.phase === 'APPROACH' ? 25 : 25) * DEG;
      if (lm === 'HDG') bank = FS.clamp(FS.wrap180(f.hdg - hdgMag) * 1.6 * DEG, -bankLim, bankLim);
      else if (lm === 'TRACK') bank = FS.clamp(FS.wrap180(f.hdg - trk) * 1.6 * DEG, -bankLim, bankLim);
      else if (lm === 'NAV' && nav) {
        const intercept = FS.clamp(-nav.xtk / 60, -45, 45);
        const trkCmd = nav.dtk + intercept;
        let b = FS.wrap180(FS.mag(trkCmd) - trk) * 1.8;
        // anticipatory turn toward next leg
        bank = FS.clamp(b * DEG, -bankLim, bankLim);
      } else if ((lm === 'LOC*' || lm === 'LOC' || lm === 'LAND' || lm === 'FLARE') && ils && ils.valid) {
        const crsT = ils.station ? ils.station.courseTrue : FS.trueOf(ils.locCourse);
        // lateral deviation in metres from angular deviation
        const devDeg = -ils.cdi * 2.5;
        const xtk = Math.tan(devDeg * DEG) * Math.max(ils.dist, 500);
        this.locInt = FS.clamp((this.locInt || 0) + (lm === 'LOC*' ? 0 : xtk * 0.0006 * dt), -8, 8);
        const intercept = FS.clamp(-xtk / (lm === 'LOC*' ? 45 : 35), -30, 30) - this.locInt;
        const trkCmd = crsT + intercept;
        bank = FS.clamp(FS.wrap180(trkCmd - ac.track) * 2.0 * DEG, -bankLim, bankLim);
        if (lm === 'FLARE') bank = FS.clamp(bank, -5 * DEG, 5 * DEG);
      } else if (lm === 'RWY' || lm === 'RWY TRK' || lm === 'GA TRK') {
        if (!this.rwyTrk) this.rwyTrk = ac.track;
        bank = FS.clamp(FS.wrap180(this.rwyTrk - ac.track) * 1.5 * DEG, -10 * DEG, 10 * DEG);
      }
      if (lm !== 'RWY' && lm !== 'RWY TRK' && lm !== 'GA TRK') this.rwyTrk = null;
      this.bankCmd = bank;

      // ---------- guidance: vertical -> flight path angle command
      const Vt = ac.tas;
      const gam = Math.asin(FS.clamp(ac.vs / Math.max(Vt, 30), -1, 1));
      let gCmd = gam;
      const vm = this.vert.mode;
      const speedOnPitch = (lo, hi) => {
        // choose flight path so that the aircraft accelerates toward the target speed
        const aDes = FS.clamp((spd - V) * 0.12, -1.2, 1.2) * KT; // m/s^2 desired
        const aNow = this.accelF * KT;
        let g = gam + (aNow - aDes) / G;
        return FS.clamp(g, lo, hi);
      };
      if (vm === 'SRS') {
        gCmd = speedOnPitch(this.phase === 'GOAROUND' ? 0.5 * DEG : 1 * DEG, 18 * DEG);
        if (ac.onGround) gCmd = 0;
      } else if (vm === 'CLB' || vm === 'OP CLB') gCmd = speedOnPitch(0.3 * DEG, 20 * DEG);
      else if (vm === 'DES' || vm === 'OP DES') gCmd = speedOnPitch(-12 * DEG, -0.3 * DEG);
      else if (vm === 'ALT*' || vm === 'ALT CST*') {
        const err = (this.altCapT - alt) * FT;
        const vsC = FS.clamp(err / 9, -Math.abs(ac.vs) - 2, Math.abs(ac.vs) + 2);
        gCmd = Math.asin(FS.clamp(vsC / Vt, -0.3, 0.3));
      } else if (vm === 'ALT' || vm === 'ALT CST') {
        const hold = vm === 'ALT' ? (this.altHold != null ? this.altHold : (this.altHold = this.altCapT || alt)) : this.altCapT;
        const vsC = FS.clamp((hold - alt) * FT * 0.08, -5, 5);
        gCmd = Math.asin(FS.clamp(vsC / Vt, -0.2, 0.2));
      } else if (vm === 'V/S') gCmd = Math.asin(FS.clamp(((f.vs || 0) * FPM) / Vt, -0.35, 0.35));
      else if (vm === 'FPA') gCmd = (f.fpa || 0) * DEG;
      else if ((vm === 'G/S*' || vm === 'G/S' || vm === 'LAND') && ils && ils.gsValid) {
        const gsAng = ils.station && ils.station.gs ? ils.station.gs.angle : 3;
        const devAng = -ils.gs * 0.7; // degrees above path (+)
        const k = vm === 'G/S*' ? 1.0 : 1.5;
        if (vm !== 'G/S*') this.gsInt = FS.clamp((this.gsInt || 0) + devAng * 0.08 * dt, -0.6, 0.6);
        else this.gsInt = 0;
        gCmd = (-gsAng - FS.clamp(devAng * k * (ils.gsDist ? FS.clamp(3000 / ils.gsDist + 0.6, 0.6, 2) : 1) + this.gsInt, -2, 2)) * DEG;
        // fly the ground-referenced path
        const wf = Math.max(ac.gs, 30) / Vt;
        gCmd = Math.atan(Math.tan(gCmd) * wf);
      } else if (vm === 'FLARE') {
        const vsT = -Math.max(110, ra * 9.5) * FPM;
        gCmd = Math.asin(FS.clamp(vsT / Vt, -0.2, 0.1));
      } else if (vm === 'ROLL OUT') gCmd = 0;
      if (vm !== 'ALT') this.altHold = null;
      this.gammaCmd = gCmd;

      // ---------- AP -> FBW command
      const apOn = this.anyAP();
      if (apOn && (ac.fbw.law !== 'NORMAL' || !ac.hasPower())) {
        this.apOff(true);
      }
      const kg = vm === 'FLARE' ? 0.9 : vm === 'LAND' || vm.startsWith('G/S') ? 0.55 : 0.4;
      const dnz = FS.clamp((Vt / G) * kg * (gCmd - gam), -0.35, 0.35);
      if (this.anyAP() && !ac.onGround) ac.apCmd = { dnz, bank };
      else if (this.anyAP() && ac.onGround && vm === 'ROLL OUT') {
        ac.apCmd = null;
        // rollout: rudder keeps the localizer
        if (ils && ils.valid && ac.gs > 15 * KT) ac.ctl.rudder = FS.clamp(ils.cdi * 0.5 - ac.omega.z * 3, -0.6, 0.6);
        else ac.ctl.rudder = 0;
      } else ac.apCmd = null;
      // flight director
      const theta = ac.pitch;
      this.fd.pitch = FS.clamp((gCmd - gam) * RAD * 3, -15, 15);
      this.fd.roll = FS.clamp((bank - ac.bank) * RAD, -30, 30);
      this.fd.active = (f.fd[0] || f.fd[1]) && (this.lat.mode || this.vert.mode);
      void theta;

      // ---------- A/THR
      const tlaMax = Math.max(ac.ctl.tla[0], ac.ctl.tla[1]);
      const aFloor = !ac.onGround && ac.alpha > ac.alphaProt + 1.5 * DEG && ac.fbw.law === 'NORMAL' && ra > 100;
      if (aFloor) {
        this.alphaFloorLatch = true;
        f.athr = true;
      }
      if (this.alphaFloorLatch && ac.alpha < ac.alphaProt - 2 * DEG && tlaMax < 44) this.alphaFloorLatch = false;
      ac.alphaFloor = this.alphaFloorLatch;
      let mode = '';
      let frac = null;
      if (this.alphaFloorLatch) mode = 'A.FLOOR';
      else if (!f.athr) mode = '';
      else if (tlaMax > 35.5) mode = tlaMax > 44 ? 'MAN TOGA' : this.ac.sys && this.ac.sys.flexTemp && this.phase === 'TAKEOFF' ? 'MAN FLX' : 'MAN MCT';
      else if (ac.onGround && this.phase !== 'TAKEOFF') mode = '';
      else if (tlaMax < 0.5) mode = 'THR LVR';
      else {
        // active A/THR: mode depends on vertical mode
        if (vm === 'CLB' || vm === 'OP CLB' || (vm === 'SRS' && this.phase === 'CLIMB')) {
          mode = 'THR CLB';
          frac = 0.87;
        } else if (vm === 'DES' || vm === 'OP DES') {
          mode = 'THR IDLE';
          frac = 0;
        } else if (vm === 'FLARE' || (vm === 'LAND' && ra < 30)) {
          mode = ra < 25 ? 'IDLE' : 'SPEED';
          if (ra < 25) {
            frac = 0;
            if (!this.retard) {
              this.retard = true;
              if (this.onRetard) this.onRetard();
            }
          }
        } else mode = this.useMach && this.phase !== 'APPROACH' && alt > 25000 ? 'MACH' : 'SPEED';
        if (mode === 'SPEED' || mode === 'MACH') {
          const err = spd - V;
          this.athrFrac = FS.clamp(this.athrFrac + (err * 0.012 - this.accelF * 0.02) * dt, 0, 0.87);
          frac = FS.clamp(this.athrFrac + err * 0.03, 0, 0.87);
        } else if (frac != null) this.athrFrac = frac;
      }
      if (!ac.onGround) this.retard = this.retard && ra < 60;
      ac.athrActive = frac != null && f.athr && tlaMax > 0.5 && tlaMax <= 35.5;
      ac.athrFrac = frac != null ? frac : this.athrFrac;
      this.athrMode = mode;
      if (f.athr && ac.onGround && this.phase === 'DONE' && tlaMax < 1) f.athr = false;
      // go-around: TOGA in approach phase
      if ((this.phase === 'APPROACH' || vm === 'LAND' || vm === 'G/S') && tlaMax > 44 && !ac.onGround) this.goAround();
    }

    goAround() {
      this.phase = 'GOAROUND';
      this.vert.mode = 'SRS';
      this.lat.mode = 'GA TRK';
      this.vert.armed = [];
      this.lat.armed = this.hasNavPlan() ? 'NAV' : '';
      this.fcu.appr = this.fcu.loc = false;
      this.appPhaseActive = false;
      this.toAlt = this.indAlt();
      this.d.acc = null;
      // sequence to missed approach
      const mi = this.plan.findIndex((l) => l.missed);
      if (mi >= 0) this.active = mi;
      this.goAroundAlt = this.indAlt();
      if (this.onGoAround) this.onGoAround();
    }

    targetAltitude() {
      const f = this.fcu;
      const alt = this.indAlt();
      let t = f.alt,
        cst = false;
      const vm = this.vert.mode;
      if ((vm === 'CLB' || vm === 'DES' || vm === 'ALT CST' || vm === 'ALT CST*') && this.hasNavPlan()) {
        for (let i = this.active; i < this.plan.length; i++) {
          const l = this.plan[i];
          if (l.disc) break;
          if (!l.alt || l.passed) continue;
          if (vm === 'CLB' || (vm.startsWith('ALT CST') && f.alt > alt)) {
            if ((l.alt.t === '-' || l.alt.t === '@') && l.alt.v < t && l.alt.v > alt - 100) {
              t = l.alt.v;
              cst = true;
            }
          } else if ((l.alt.t === '+' || l.alt.t === '@') && l.alt.v > t && l.alt.v < alt + 100) {
            t = l.alt.v;
            cst = true;
          }
          break;
        }
      }
      return { alt: t, cst };
    }
    vmax() {
      const ac = this.ac;
      if (ac.flap > 1 || ac.slat > 1) return (ac.flapLever1F ? 215 : FS.A320_CONF[ac.ctl.flapLever].vfe) || 350;
      if (ac.gearPos > 0.05) return 280;
      const mmo = this.casFromMach(0.82);
      return Math.min(350, mmo);
    }
    casFromMach(m) {
      const atm = this.ac.atm;
      if (!atm) return 300;
      const qc = atm.p * (Math.pow(1 + 0.2 * m * m, 3.5) - 1);
      return 661.47 * Math.sqrt(5 * (Math.pow(qc / 101325 + 1, 0.2857) - 1));
    }

    fma() {
      const f = this.fcu;
      const ap = [f.ap1 ? 'AP1' : '', f.ap2 ? 'AP2' : ''].filter(Boolean).join('+');
      const fd = f.fd[0] || f.fd[1] ? `${f.fd[0] ? '1' : '-'} FD ${f.fd[1] ? '2' : '-'}` : '';
      let cat = '';
      if (this.lat.mode === 'LAND' || f.appr) cat = f.ap1 && f.ap2 ? 'CAT 3\nDUAL' : f.ap1 || f.ap2 ? 'CAT 3\nSINGLE' : 'CAT 1';
      if (this.ac.fbw.law !== 'NORMAL') cat = f.appr ? 'CAT 1' : '';
      const athrBox = f.athr ? (this.athrMode.startsWith('MAN') || this.athrMode === 'THR LVR' || this.athrMode === '' ? 'A/THR' : 'A/THR') : '';
      return {
        athr: this.lvrClb ? 'LVR CLB' : this.athrMode,
        athrColor: this.alphaFloorLatch ? 'amber' : this.athrMode.startsWith('MAN') ? 'white' : 'green',
        vert: this.vert.mode,
        vertArmed: this.vert.armed.join(' '),
        lat: this.lat.mode,
        latArmed: this.lat.armed,
        cat, dh: this.d.dh != null ? `DH ${this.d.dh}` : this.d.mda != null ? `MDA ${this.d.mda}` : '',
        ap, fd, athrEng: athrBox, athrArmedOnly: f.athr && !this.ac.athrActive,
      };
    }
  }

  FS.NavDB = NavDB;
  FS.FMGS = FMGS;
})(typeof window !== 'undefined' ? window : globalThis);
