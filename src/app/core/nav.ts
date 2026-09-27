/*
 * Navigation aids and radio receivers: VOR, ILS, DME, NDB/ADF and marker beacons.
 */
import { U, clamp, wrap360, wrap180, lagK } from './math';
import { WORLD, magVar, makeILS } from './world';
const { DEG, RAD, NM, FT } = U;

export function buildNavaids(terrain: any): any[] {
  const at = (n: number, e: number, agl?: number) => ({ n, e, alt: terrain.groundHeight(n, e) + (agl || 0) });
  const list = WORLD.navaids(terrain, makeILS, at);
  for (const v of list) {
    if (v.type === 'VOR' && v.dmeCap) v.dme = { n: v.n, e: v.e, alt: v.alt };
    if (v.type === 'VOR') v.var = magVar || 0;
  }
  return list;
}

export const bearingTo = (fromN: number, fromE: number, toN: number, toE: number): number =>
  wrap360(Math.atan2(toE - fromE, toN - fromN) * RAD);

const losRangeM = (hAboveM: number): number => 1.23 * Math.sqrt(Math.max(hAboveM, 30) / FT) * NM;

export class NavReceiver {
  active: number; standby: number; obs: number;
  out: any; gsKt: number;
  private _prevDme: number | null = null;
  gsSmooth = 0;

  constructor(active: number, standby: number, obs: number) {
    this.active = active; this.standby = standby; this.obs = obs;
    this.out = { valid: false }; this.gsKt = 0;
  }

  swap(): void { const t = this.active; this.active = this.standby; this.standby = t; }

  tune(navaids: any[], pos: any, alt: number, dt: number, hasPower: boolean): any {
    const o: any = { valid: false, type: null, ident: '', cdi: 0, toFrom: 0, gsValid: false, gs: 0, dmeValid: false, dme: 0, gsKt: 0, radial: 0 };
    this.out = o;
    if (!hasPower) return o;
    const st = navaids.find((v) => (v.type === 'VOR' || v.type === 'LOC') && Math.abs(v.freq - this.active) < 0.001);
    if (!st) return o;
    const dN = pos.n - st.n, dE = pos.e - st.e;
    const dist = Math.hypot(dN, dE);
    const rng = Math.min(st.range, losRangeM(alt - st.alt));
    if (dist > rng) return o;
    o.station = st; o.ident = st.ident; o.type = st.type; o.dist = dist;
    const radialTrue = wrap360(Math.atan2(dE, dN) * RAD);
    const radial = st.type === 'VOR' ? wrap360(radialTrue - (st.var || 0)) : radialTrue;
    o.radial = radial;
    if (st.type === 'VOR') {
      const elev = Math.atan2(alt - st.alt, dist) * RAD;
      if (elev > 60) return o;
      o.valid = true;
      const d = wrap180(radial - this.obs);
      if (Math.abs(d) <= 90) { o.toFrom = -1; o.cdi = clamp(-d / 10, -1.2, 1.2); }
      else { o.toFrom = 1; const d2 = wrap180(radial - (this.obs + 180)); o.cdi = clamp(d2 / 10, -1.2, 1.2); }
      if (Math.abs(Math.abs(d) - 90) < 2) o.toFrom = 0;
    } else {
      const crsT = st.courseTrue != null ? st.courseTrue : st.course;
      const dev = wrap180(radial - (crsT + 180));
      const front = Math.abs(dev) < 90;
      const devA = front ? dev : wrap180(radial - crsT);
      const maxA = dist < 10 * NM ? 35 : 10;
      if (Math.abs(devA) > maxA) return o;
      o.valid = true; o.backCourse = !front;
      o.cdi = clamp((front ? devA : -devA) / st.fullScale, -1.2, 1.2);
      o.locCourse = st.course;
      if (st.gs && front) {
        const g = st.gs;
        const hdist = Math.hypot(pos.n - g.alongN, pos.e - g.alongE);
        const ang = Math.atan2(alt - g.alt, hdist) * RAD;
        if (hdist < g.range && Math.abs(devA) < 8 && ang > 0.3) {
          o.gsValid = true; o.gsDist = hdist;
          let dv = ang - g.angle;
          if (ang > 6) dv = -Math.sin(((ang - 6) / 3) * Math.PI) * 1.2;
          o.gs = clamp(-dv / g.fullScale, -1.2, 1.2); o.gsAngle = ang;
        }
      }
    }
    if (st.dme) {
      const s = Math.sqrt((pos.n - st.dme.n) ** 2 + (pos.e - st.dme.e) ** 2 + (alt - st.dme.alt) ** 2) / NM;
      o.dmeValid = true; o.dme = s;
      if (this._prevDme !== null && dt > 0) {
        const rate = Math.abs(this._prevDme - s) / dt * 3600;
        this.gsKt = (this.gsKt || 0) + (rate - (this.gsKt || 0)) * lagK(dt, 3);
      }
      this._prevDme = s; o.gsKt = this.gsKt || 0;
    } else this._prevDme = null;
    return o;
  }
}

export class ADFReceiver {
  freq: number; needle: number; valid: boolean; ident: string;

  constructor(freq: number) { this.freq = freq; this.needle = 90; this.valid = false; this.ident = ''; }

  tune(navaids: any[], pos: any, alt: number, headingDeg: number, dt: number, hasPower: boolean): this {
    const st = hasPower ? navaids.find((v) => v.type === 'NDB' && Math.abs(v.freq - this.freq) < 0.5) : null;
    let target = 90;
    this.valid = false; this.ident = '';
    if (st) {
      const dist = Math.hypot(pos.n - st.n, pos.e - st.e);
      if (dist < st.range) {
        this.valid = true; this.ident = st.ident;
        const brg = bearingTo(pos.n, pos.e, st.n, st.e);
        target = wrap360(brg - headingDeg);
      }
    }
    const err = wrap180(target - this.needle);
    this.needle = wrap360(this.needle + err * lagK(dt, this.valid ? 0.6 : 3));
    return this;
  }
}

export class MarkerReceiver {
  active: string | null = null;

  update(navaids: any[], pos: any, alt: number, hasPower: boolean): string | null {
    this.active = null;
    if (!hasPower) return null;
    for (const m of navaids) {
      if (m.type !== 'MKR') continue;
      const h = alt - m.alt;
      if (h < 30) continue;
      const c = m.course * DEG;
      const dn = pos.n - m.n, de = pos.e - m.e;
      const along = dn * Math.cos(c) + de * Math.sin(c);
      const cross = -dn * Math.sin(c) + de * Math.cos(c);
      if (Math.abs(along) < h * 0.55 && Math.abs(cross) < h * 1.6 + 300) { this.active = m.kind; break; }
    }
    return this.active;
  }
}
