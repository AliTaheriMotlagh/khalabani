/*
 * Navigation aids and radio receivers: VOR, ILS (localizer + glideslope), DME, NDB/ADF and marker beacons.
 * Magnetic variation on Avalon Island is 0°, so true = magnetic.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG, RAD, NM, FT } = FS.U;

  function buildNavaids(terrain) {
    const at = (n, e, agl) => ({ n, e, alt: terrain.groundHeight(n, e) + (agl || 0) });
    const list = FS.WORLD.navaids(terrain, FS.makeILS, at);
    for (const v of list) {
      if (v.type === 'VOR' && v.dmeCap) v.dme = { n: v.n, e: v.e, alt: v.alt };
      if (v.type === 'VOR') v.var = FS.magVar || 0;
    }
    return list;
  }

  const bearingTo = (fromN, fromE, toN, toE) => FS.wrap360(Math.atan2(toE - fromE, toN - fromN) * RAD);

  // Line-of-sight radio range (nm) for a receiver at given height above station
  const losRangeM = (hAboveM) => 1.23 * Math.sqrt(Math.max(hAboveM, 30) / FT) * NM;

  class NavReceiver {
    constructor(active, standby, obs) {
      this.active = active;
      this.standby = standby;
      this.obs = obs;
      this.out = { valid: false };
      this._prevDme = null;
      this.gsSmooth = 0;
    }
    swap() {
      const t = this.active;
      this.active = this.standby;
      this.standby = t;
    }
    tune(navaids, pos, alt, dt, hasPower) {
      const o = { valid: false, type: null, ident: '', cdi: 0, toFrom: 0, gsValid: false, gs: 0, dmeValid: false, dme: 0, gsKt: 0, radial: 0 };
      this.out = o;
      if (!hasPower) return o;
      const st = navaids.find((v) => (v.type === 'VOR' || v.type === 'LOC') && Math.abs(v.freq - this.active) < 0.001);
      if (!st) return o;
      const dN = pos.n - st.n,
        dE = pos.e - st.e;
      const dist = Math.hypot(dN, dE);
      const rng = Math.min(st.range, losRangeM(alt - st.alt));
      if (dist > rng) return o;
      o.station = st;
      o.ident = st.ident;
      o.type = st.type;
      o.dist = dist;
      const radialTrue = FS.wrap360(Math.atan2(dE, dN) * RAD);
      const radial = st.type === 'VOR' ? FS.wrap360(radialTrue - (st.var || 0)) : radialTrue;
      o.radial = radial;
      if (st.type === 'VOR') {
        // cone of confusion overhead
        const elev = Math.atan2(alt - st.alt, dist) * RAD;
        if (elev > 60) return o;
        o.valid = true;
        const d = FS.wrap180(radial - this.obs);
        if (Math.abs(d) <= 90) {
          o.toFrom = -1; // FROM
          o.cdi = FS.clamp(-d / 10, -1.2, 1.2);
        } else {
          o.toFrom = 1; // TO
          const d2 = FS.wrap180(radial - (this.obs + 180));
          o.cdi = FS.clamp(d2 / 10, -1.2, 1.2);
        }
        if (Math.abs(Math.abs(d) - 90) < 2) o.toFrom = 0; // abeam: flag ambiguous
      } else {
        // Localizer
        const crsT = st.courseTrue != null ? st.courseTrue : st.course;
        const dev = FS.wrap180(radial - (crsT + 180));
        const front = Math.abs(dev) < 90;
        const devA = front ? dev : FS.wrap180(radial - crsT);
        const maxA = dist < 10 * NM ? 35 : 10;
        if (Math.abs(devA) > maxA) return o;
        o.valid = true;
        o.backCourse = !front;
        o.cdi = FS.clamp((front ? devA : -devA) / st.fullScale, -1.2, 1.2);
        o.locCourse = st.course;
        if (st.gs && front) {
          const g = st.gs;
          // distance along the course from the GS antenna abeam point
          const hdist = Math.hypot(pos.n - g.alongN, pos.e - g.alongE);
          const ang = Math.atan2(alt - g.alt, hdist) * RAD;
          if (hdist < g.range && Math.abs(devA) < 8 && ang > 0.3) {
            o.gsValid = true;
            o.gsDist = hdist;
            // simple lobe model: a false glide path appears at ~9 deg (reversed sensing between)
            let dv = ang - g.angle;
            if (ang > 6) dv = -Math.sin(((ang - 6) / 3) * Math.PI) * 1.2;
            o.gs = FS.clamp(-dv / g.fullScale, -1.2, 1.2);
            o.gsAngle = ang;
          }
        }
      }
      if (st.dme) {
        const s = Math.sqrt((pos.n - st.dme.n) ** 2 + (pos.e - st.dme.e) ** 2 + (alt - st.dme.alt) ** 2) / NM;
        o.dmeValid = true;
        o.dme = s;
        if (this._prevDme !== null && dt > 0) {
          const rate = Math.abs(this._prevDme - s) / dt * 3600;
          this.gsKt = (this.gsKt || 0) + (rate - (this.gsKt || 0)) * FS.lagK(dt, 3);
        }
        this._prevDme = s;
        o.gsKt = this.gsKt || 0;
      } else this._prevDme = null;
      return o;
    }
  }

  class ADFReceiver {
    constructor(freq) {
      this.freq = freq;
      this.needle = 90;
      this.valid = false;
    }
    tune(navaids, pos, alt, headingDeg, dt, hasPower) {
      const st = hasPower ? navaids.find((v) => v.type === 'NDB' && Math.abs(v.freq - this.freq) < 0.5) : null;
      let target = 90;
      this.valid = false;
      this.ident = '';
      if (st) {
        const dist = Math.hypot(pos.n - st.n, pos.e - st.e);
        if (dist < st.range) {
          this.valid = true;
          this.ident = st.ident;
          const brg = bearingTo(pos.n, pos.e, st.n, st.e);
          target = FS.wrap360(brg - headingDeg);
        }
      }
      // needle swings with inertia
      const err = FS.wrap180(target - this.needle);
      this.needle = FS.wrap360(this.needle + err * FS.lagK(dt, this.valid ? 0.6 : 3));
      return this;
    }
  }

  class MarkerReceiver {
    constructor() {
      this.active = null;
    }
    update(navaids, pos, alt, hasPower) {
      this.active = null;
      if (!hasPower) return null;
      for (const m of navaids) {
        if (m.type !== 'MKR') continue;
        const h = alt - m.alt;
        if (h < 30) continue;
        const c = m.course * DEG;
        const dn = pos.n - m.n,
          de = pos.e - m.e;
        const along = dn * Math.cos(c) + de * Math.sin(c);
        const cross = -dn * Math.sin(c) + de * Math.cos(c);
        // fan-shaped beam: narrow along course, wide across
        if (Math.abs(along) < h * 0.55 && Math.abs(cross) < h * 1.6 + 300) {
          this.active = m.kind;
          break;
        }
      }
      return this.active;
    }
  }

  FS.buildNavaids = buildNavaids;
  FS.NavReceiver = NavReceiver;
  FS.ADFReceiver = ADFReceiver;
  FS.MarkerReceiver = MarkerReceiver;
  FS.bearingTo = bearingTo;
})(typeof window !== 'undefined' ? window : globalThis);
