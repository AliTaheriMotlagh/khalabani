/*
 * TCAS II (simplified logic after RTCA DO-185 concepts):
 *  - Traffic classification: OTHER, PROXIMATE (< 6 nm, ±1200 ft), TA (tau < ~40 s), RA (tau < ~25 s with
 *    projected vertical miss distance below ALIM)
 *  - RA sense selection (climb / descend) maximising vertical separation at CPA, preferring non-crossing
 *  - RA types: CLIMB, DESCEND, LEVEL OFF, MONITOR VERTICAL SPEED, INCREASE CLIMB/DESCENT (strengthening)
 *  - PFD VSI red/green bands, ND symbols, aural annunciations, "CLEAR OF CONFLICT"
 *  - RAs are inhibited below 1,000 ft AGL (TA ONLY), descend RAs below 1,100 ft
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { NM, FT, KT, FPM, DEG } = FS.U;

  class TCAS {
    constructor() {
      this.intruders = [];
      this.targets = [];
      this.ra = null;
      this.status = '';
      this.mode = 'TA/RA';
      this.onAural = null;
      this.minSep = null;
      this.raLog = [];
    }
    add(o) {
      // o: {id, n, e, alt(m), hdg(deg true), spd(kt), vs(fpm), levelAt(ft)?}
      this.intruders.push(Object.assign({ pitch: 0 }, o));
    }
    clear() {
      this.intruders = [];
      this.targets = [];
      this.ra = null;
      this.status = '';
      this.minSep = null;
      this.lastAdv = null;
    }
    say(t) {
      if (this.onAural) this.onAural(t);
    }

    update(dt, ac) {
      if (this.mode === 'STBY' || !ac.hasPower()) {
        this.targets = [];
        this.ra = null;
        this.status = this.mode === 'STBY' ? 'TCAS STBY' : '';
        return;
      }
      const ownN = ac.pos.x,
        ownE = ac.pos.y,
        ownAlt = ac.alt;
      const ownV = ac.velNED || { x: 0, y: 0, z: 0 };
      const ownVs = ac.vs; // m/s
      const agl = ac.ra != null ? ac.ra : ac.agl;
      const raAllowed = this.mode === 'TA/RA' && agl > 1000 * FT;
      let worst = null;
      this.targets = [];
      for (const t of this.intruders) {
        // intruder kinematics
        const h = t.hdg * DEG;
        const v = t.spd * KT;
        t.n += Math.cos(h) * v * dt;
        t.e += Math.sin(h) * v * dt;
        let vs = t.vs * FPM;
        if (t.levelAt != null && ((vs > 0 && t.alt >= t.levelAt * FT) || (vs < 0 && t.alt <= t.levelAt * FT))) {
          t.vs = 0;
          vs = 0;
        }
        t.alt += vs * dt;
        t.pitch = Math.atan2(vs, v);
        // geometry
        const dn = t.n - ownN,
          de = t.e - ownE;
        const range = Math.hypot(dn, de, t.alt - ownAlt);
        const rvn = Math.cos(h) * v - ownV.x,
          rve = Math.sin(h) * v - ownV.y;
        const closure = -(dn * rvn + de * rve) / Math.max(Math.hypot(dn, de), 1);
        const tau = closure > 1 ? (range - 0.2 * NM) / closure : 999;
        const relAlt = (t.alt - ownAlt) / FT;
        const relVs = vs - ownVs;
        // time of closest approach (horizontal)
        const rv2 = rvn * rvn + rve * rve;
        const tcpa = rv2 > 1 ? FS.clamp(-(dn * rvn + de * rve) / rv2, 0, 120) : 0;
        const missH = Math.hypot(dn + rvn * tcpa, de + rve * tcpa);
        const vAtCpa = (t.alt + vs * tcpa - (ownAlt + ownVs * tcpa)) / FT;
        const sepNow = { h: Math.hypot(dn, de) / NM, v: Math.abs(relAlt) };
        if (!this.minSep || sepNow.h < this.minSep.h) this.minSep = sepNow;
        let level = 'OTHER';
        if (Math.hypot(dn, de) < 6 * NM && Math.abs(relAlt) < 1200) level = 'PROX';
        const altBand = ownAlt / FT < 10000 ? { ta: 40, ra: 25, alim: 400 } : ownAlt / FT < 20000 ? { ta: 45, ra: 30, alim: 600 } : { ta: 48, ra: 35, alim: 700 };
        const threatV = Math.abs(relAlt) < 850 || Math.abs(vAtCpa) < altBand.alim + 300;
        if (tau < altBand.ta && threatV && missH < 2 * NM) level = 'TA';
        if (raAllowed && tau < altBand.ra && Math.abs(vAtCpa) < altBand.alim + 150 && missH < 1.2 * NM) level = 'RA';
        const tgt = { n: t.n, e: t.e, alt: t.alt, relAlt, vs: t.vs, level, tau, tcpa, vAtCpa, missH, t };
        this.targets.push(tgt);
        if (level === 'RA' || (level === 'TA' && (!worst || worst.level !== 'RA'))) if (!worst || tau < worst.tau || level === 'RA') worst = tgt;
      }
      // ---- advisory logic
      const prevRa = this.ra;
      if (worst && worst.level === 'RA') {
        if (!this.ra) {
          // sense selection: compare separation achieved by climbing vs descending at 1500 fpm
          const T = Math.max(worst.tcpa, 5);
          const intrAltCpa = worst.alt / FT + (worst.vs * T) / 60;
          const own = ownAlt / FT;
          const climbAlt = own + (Math.max(ownVs / FPM, 1500) * T) / 60 - 0;
          const descAlt = own + (Math.min(ownVs / FPM, -1500) * T) / 60;
          let sepC = climbAlt - intrAltCpa,
            sepD = intrAltCpa - descAlt;
          const crossC = own < worst.alt / FT && climbAlt > intrAltCpa;
          const crossD = own > worst.alt / FT && descAlt < intrAltCpa;
          if (crossC) sepC -= 300;
          if (crossD) sepD -= 300;
          if (agl < 1100 * FT) sepD = -1e9;
          const sense = sepC >= sepD ? 'CLIMB' : 'DESCEND';
          // preventive "monitor / level off" when already safe
          const curVs = ownVs / FPM;
          if (sense === 'CLIMB' && curVs > 1500 && sepC > 600) this.ra = { type: 'MONITOR', greenMin: 1500, greenMax: 6000, redMin: -6000, redMax: 0 };
          else if (sense === 'DESCEND' && curVs < -1500 && sepD > 600) this.ra = { type: 'MONITOR', greenMin: -6000, greenMax: -1500, redMin: 0, redMax: 6000 };
          else if (sense === 'CLIMB') this.ra = { type: 'CLIMB', greenMin: 1500, greenMax: 2000, redMin: -6000, redMax: 1500 };
          else this.ra = { type: 'DESCEND', greenMin: -2000, greenMax: -1500, redMin: -1500, redMax: 6000 };
          this.ra.sense = sense;
          this.ra.t0 = performance.now();
          this.ra.target = worst.t.id;
          this.say(this.ra.type === 'MONITOR' ? 'Monitor vertical speed' : sense === 'CLIMB' ? 'Climb, climb' : 'Descend, descend');
          this.raLog.push({ type: this.ra.type, at: ownAlt / FT });
        } else {
          // strengthening if the aircraft does not comply and the miss distance is still insufficient
          const age = (performance.now() - this.ra.t0) / 1000;
          const curVs = ownVs / FPM;
          if (age > 5 && !this.ra.strong && this.ra.type !== 'MONITOR' && Math.abs(worst.vAtCpa) < 300) {
            if (this.ra.sense === 'CLIMB' && curVs < 1500) {
              this.ra = Object.assign(this.ra, { type: 'INCREASE CLIMB', greenMin: 2500, greenMax: 4400, redMax: 2500, strong: true });
              this.say('Increase climb, increase climb');
            } else if (this.ra.sense === 'DESCEND' && curVs > -1500) {
              this.ra = Object.assign(this.ra, { type: 'INCREASE DESCENT', greenMin: -4400, greenMax: -2500, redMin: -2500, strong: true });
              this.say('Increase descent, increase descent');
            }
          }
        }
      } else if (this.ra) {
        // weakening / clear of conflict once diverging
        const tgt = this.targets.find((x) => x.t.id === this.ra.target);
        if (!tgt || tgt.tau > 40 || tgt.tcpa <= 0.1 || tgt.missH > 2 * NM) {
          this.ra = null;
          this.say('Clear of conflict');
          this.cocTime = performance.now();
        }
      }
      if (worst && worst.level === 'TA' && !this.ra && (!this.lastTA || performance.now() - this.lastTA > 15000)) {
        this.lastTA = performance.now();
        this.say('Traffic, traffic');
      }
      this.status = this.ra ? 'TCAS RA: ' + this.ra.type : worst && worst.level === 'TA' ? 'TRAFFIC' : agl <= 1000 * FT && this.targets.length ? 'TA ONLY' : '';
      void prevRa;
    }
  }

  FS.TCAS = TCAS;
})(typeof window !== 'undefined' ? window : globalThis);
