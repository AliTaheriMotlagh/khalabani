/*
 * Atmosphere & weather: ISA model, surface/aloft wind, gusts, turbulence, cloud fields.
 */
import { U, clamp, lerp, smoothstep, lagK, gauss, Noise, rng } from './math';
const { FT, KT, DEG } = U;

const R_AIR = 287.053, LAPSE = 0.0065, G0 = 9.80665, EXP = G0 / (R_AIR * LAPSE);

export const WEATHER_PRESETS: Record<string, any> = {
  clear: { name: 'Clear skies (CAVOK)', qnh: 1018, tempC: 18, dewC: 6, windDir: 250, windKt: 6, gustKt: 0, aloftDir: 270, aloftKt: 18, turb: 0.05, vis: 60000, precip: 0, clouds: [] },
  fair: { name: 'Fair weather cumulus', qnh: 1015, tempC: 22, dewC: 12, windDir: 240, windKt: 10, gustKt: 0, aloftDir: 260, aloftKt: 22, turb: 0.25, vis: 30000, precip: 0, clouds: [{ baseFt: 4000, topFt: 6500, cover: 3, type: 'cu' }] },
  mvfr: { name: 'Marginal VFR, broken', qnh: 1009, tempC: 14, dewC: 10, windDir: 220, windKt: 12, gustKt: 18, aloftDir: 240, aloftKt: 30, turb: 0.3, vis: 8000, precip: 0, clouds: [{ baseFt: 2200, topFt: 4200, cover: 6, type: 'cu' }, { baseFt: 9000, topFt: 10000, cover: 4, type: 'st' }] },
  ifr: { name: 'IFR: overcast & rain', qnh: 1002, tempC: 11, dewC: 10, windDir: 240, windKt: 14, gustKt: 22, aloftDir: 250, aloftKt: 35, turb: 0.35, vis: 3500, precip: 0.6, clouds: [{ baseFt: 700, topFt: 5500, cover: 8, type: 'st' }] },
  lifr: { name: 'Low IFR: fog', qnh: 1021, tempC: 7, dewC: 7, windDir: 280, windKt: 3, gustKt: 0, aloftDir: 300, aloftKt: 12, turb: 0.0, vis: 600, precip: 0, clouds: [{ baseFt: 250, topFt: 1600, cover: 8, type: 'st' }] },
  storm: { name: 'Gusty crosswind & showers', qnh: 998, tempC: 17, dewC: 13, windDir: 200, windKt: 20, gustKt: 32, aloftDir: 230, aloftKt: 45, turb: 0.75, vis: 6000, precip: 0.5, clouds: [{ baseFt: 1800, topFt: 9000, cover: 6, type: 'cb' }] },
  icing: { name: 'Icing conditions', qnh: 1006, tempC: 3, dewC: 2, windDir: 300, windKt: 12, gustKt: 0, aloftDir: 300, aloftKt: 30, turb: 0.2, vis: 5000, precip: 0.2, clouds: [{ baseFt: 1200, topFt: 7500, cover: 8, type: 'st' }] },
  tehran: { name: 'Tehran summer afternoon (hot & high)', qnh: 1009, tempC: 35, dewC: -3, windDir: 290, windKt: 11, gustKt: 17, aloftDir: 270, aloftKt: 35, turb: 0.35, vis: 20000, precip: 0, clouds: [{ baseFt: 9500, topFt: 12000, cover: 2, type: 'cu' }] },
  smog: { name: 'Tehran winter smog / inversion', qnh: 1027, tempC: 3, dewC: -1, windDir: 90, windKt: 3, gustKt: 0, aloftDir: 280, aloftKt: 25, turb: 0.05, vis: 3500, precip: 0, clouds: [{ baseFt: 6000, topFt: 7500, cover: 5, type: 'st' }] },
};

export class Weather {
  qnh!: number; tempC!: number; dewC!: number; windDir!: number; windKt!: number; gustKt!: number;
  aloftDir!: number; aloftKt!: number; turb!: number; vis!: number; precip!: number; name!: string;
  refElev!: number; cloudsCfg!: any[]; layers!: any[]; cloudField!: CloudField; version!: number;
  turbState: any; gust: any; lastSigma!: number;

  constructor(preset = 'fair') {
    this.turbState = { u: 0, v: 0, w: 0, p: 0, q: 0, r: 0 };
    this.gust = { val: 0, target: 0, timer: 0 };
    this.refElev = 0;
    this.version = 0;
    this.set(WEATHER_PRESETS[preset] || WEATHER_PRESETS['fair']);
  }

  set(o: any): void {
    this.qnh = o.qnh; this.tempC = o.tempC; this.dewC = Math.min(o.dewC, o.tempC);
    this.windDir = o.windDir; this.windKt = o.windKt; this.gustKt = Math.max(o.gustKt || 0, o.windKt);
    this.aloftDir = o.aloftDir; this.aloftKt = o.aloftKt; this.turb = o.turb; this.vis = o.vis;
    this.precip = o.precip; this.name = o.name || 'Custom';
    this.refElev = o.refElev != null ? o.refElev : this.refElev || 0;
    this.cloudsCfg = (o.clouds || []).map((c: any) => Object.assign({}, c));
    this.layers = this.cloudsCfg.filter((c) => c.cover > 0).map((c, i) => ({
      base: this.refElev + c.baseFt * FT, top: this.refElev + Math.max(c.topFt, c.baseFt + 300) * FT,
      cover: c.cover, type: c.type || 'cu', seed: 101 + i * 17,
    }));
    this.cloudField = new CloudField(this.layers);
    this.version = (this.version || 0) + 1;
  }

  toConfig(): any {
    return {
      name: this.name, qnh: this.qnh, tempC: this.tempC, dewC: this.dewC, windDir: this.windDir,
      windKt: this.windKt, gustKt: this.gustKt, aloftDir: this.aloftDir, aloftKt: this.aloftKt,
      turb: this.turb, vis: this.vis, precip: this.precip, clouds: this.cloudsCfg.map((c) => Object.assign({}, c)), refElev: this.refElev,
    };
  }

  atmosphere(h: number): any {
    const ref = this.refElev || 0;
    const pSt = this.qnh * 100 * Math.pow(1 - (LAPSE * ref) / 288.15, EXP);
    const Tst = 273.15 + this.tempC;
    h = Math.max(-500, h);
    const hTrop = 11000;
    let T: number, p: number;
    if (h < hTrop) {
      T = Tst - LAPSE * (h - ref); p = pSt * Math.pow(T / Tst, EXP);
    } else {
      const T11 = Tst - LAPSE * (hTrop - ref), p11 = pSt * Math.pow(T11 / Tst, EXP);
      T = T11; p = p11 * Math.exp((-G0 * (h - hTrop)) / (R_AIR * T11));
    }
    const rho = p / (R_AIR * T);
    return { T, p, rho, tempC: T - 273.15, sigma: rho / 1.225, a: Math.sqrt(1.4 * R_AIR * T) };
  }

  freezingLevel(): number { const T0 = this.tempC + LAPSE * this.refElev; return T0 / LAPSE; }

  meanWind(altMSL: number, agl: number): { n: number; e: number } {
    const toVec = (dirFrom: number, kt: number) => ({ n: -Math.cos(dirFrom * DEG) * kt * KT, e: -Math.sin(dirFrom * DEG) * kt * KT });
    const s = toVec(this.windDir, this.windKt), a = toVec(this.aloftDir, this.aloftKt);
    const h = Math.max(agl, 0.3);
    let f = clamp(Math.log(h / 0.05) / Math.log(10 / 0.05), 0, 1.25);
    const t = smoothstep(this.refElev + 300, this.refElev + 3000, altMSL);
    return { n: lerp(s.n * f, a.n, t), e: lerp(s.e * f, a.e, t) };
  }

  step(dt: number, pos: any, agl: number, tas: number, terrain: any, out?: any): any {
    const alt = -pos.z;
    const m = this.meanWind(alt, agl);
    const spd = Math.hypot(m.n, m.e);
    const g = this.gust;
    const gustAmp = Math.max(0, this.gustKt - this.windKt) * KT;
    g.timer -= dt;
    if (g.timer <= 0) {
      if (gustAmp > 0 && Math.random() < 0.6) { g.target = gustAmp * (0.4 + 0.6 * Math.random()); g.timer = 2 + Math.random() * 4; }
      else { g.target = 0; g.timer = 3 + Math.random() * 8; }
    }
    g.val += (g.target - g.val) * lagK(dt, 1.2);
    const gf = spd > 0.1 ? (1 + g.val / spd) * clamp(agl / 20, 0.3, 1) : 1;
    let wn = m.n * gf, we = m.e * gf, wd = 0;
    const cloud = this.cloudField.density(pos.x, pos.y, alt);
    let sigma = this.turb * 2.2;
    sigma += (0.12 * spd + 0.06 * gustAmp) * (1 - smoothstep(0, 900, agl));
    const conv = this.cloudField.convective(pos.x, pos.y, alt);
    sigma += cloud * (0.6 + 2.5 * conv);
    this.lastSigma = sigma;
    const V = Math.max(tas, 15);
    const Lu = clamp(agl, 60, 530), Lw = clamp(agl * 0.5, 30, 530);
    const T = this.turbState;
    const kU = (V / Lu) * dt, kW = (V / Lw) * dt;
    const sq = Math.sqrt;
    T.u += -kU * T.u + sigma * sq(2 * kU) * gauss();
    T.v += -kU * T.v + sigma * sq(2 * kU) * gauss();
    T.w += -kW * T.w + sigma * 0.8 * sq(2 * kW) * gauss();
    const kR = (V / 25) * dt, sp = sigma * 0.022;
    T.p += -kR * T.p + sp * sq(2 * kR) * gauss();
    T.q += -kR * T.q + sp * 0.3 * sq(2 * kR) * gauss();
    T.r += -kR * T.r + sp * 0.4 * sq(2 * kR) * gauss();
    wn += T.u; we += T.v; wd += T.w;
    if (terrain && agl < 2500) {
      const gr = terrain.gradient(pos.x, pos.y);
      const up = m.n * gr.dn + m.e * gr.de;
      wd -= clamp(up, -6, 6) * Math.exp(-agl / 700);
      if (up < 0) wd += 0.4 * Math.abs(up) * Math.sin(alt * 0.02 + pos.x * 0.001);
    }
    if (conv > 0) { const c = this.cloudField.updraft(pos.x, pos.y, alt); wd -= c; }
    out = out || {};
    out.n = wn; out.e = we; out.d = wd;
    out.p = T.p; out.q = T.q; out.r = T.r; out.cloud = cloud;
    return out;
  }

  visibilityAt(n: number, e: number, alt: number): number {
    const c = this.cloudField.density(n, e, alt);
    let v = this.vis;
    const inPrecip = this.precip > 0 && this.layers.length && alt < this.layers[0].base;
    if (inPrecip) v = Math.min(v, lerp(v, 2500, this.precip * 0.5));
    if (c > 0) v = lerp(v, 35, smoothstep(0.0, 0.6, c));
    return v;
  }

  metar(icao: string, elev: number, timeHours: number): string {
    const pad = (n: number, l = 2) => String(Math.round(n)).padStart(l, '0');
    const hh = Math.floor(timeHours), mm = Math.floor((timeHours - hh) * 60);
    let s = `${icao} 26${pad(hh)}${pad(mm)}Z `;
    if (this.windKt < 3) s += '00000KT ';
    else s += `${pad(Math.round(this.windDir / 10) * 10, 3)}${pad(this.windKt)}${this.gustKt > this.windKt + 4 ? 'G' + pad(this.gustKt) : ''}KT `;
    const vis = this.vis >= 9999 ? '9999' : pad(Math.round(this.vis / 100) * 100, 4);
    s += vis + ' ';
    if (this.precip > 0) s += (this.tempC < 1 ? (this.precip > 0.6 ? '+SN ' : 'SN ') : this.precip > 0.6 ? '+RA ' : this.precip > 0.3 ? 'RA ' : '-RA ');
    else if (this.vis < 1000) s += 'FG '; else if (this.vis < 5000) s += 'BR ';
    const codes = ['SKC', 'FEW', 'FEW', 'SCT', 'SCT', 'BKN', 'BKN', 'BKN', 'OVC'];
    if (!this.cloudsCfg.length) s += this.vis >= 9999 ? 'SKC ' : 'NSC ';
    for (const c of this.cloudsCfg) if (c.cover > 0) s += codes[c.cover] + pad(Math.round(c.baseFt / 100), 3) + (c.type === 'cb' ? 'CB' : '') + ' ';
    const t = (v: number) => (v < 0 ? 'M' + pad(-v) : pad(v));
    s += `${t(Math.round(this.tempC))}/${t(Math.round(this.dewC))} `;
    s += `Q${Math.round(this.qnh)} A${Math.round((this.qnh / U.HPA_PER_INHG) * 100)}`;
    return s;
  }
}

class CloudField {
  layers: any[]; cell: number; extent: number; grid: Map<number, any>; puffCount: number;

  constructor(layers: any[]) {
    this.layers = layers; this.cell = 1600; this.extent = 46000;
    this.grid = new Map(); this.puffCount = 0;
    layers.forEach((L, li) => this.generate(L, li));
  }

  key(li: number, i: number, j: number): number { return li * 1e6 + (i + 500) * 1000 + (j + 500); }

  generate(L: any, li: number): void {
    const noise = new Noise(L.seed), rndFn = rng(L.seed * 7 + 3);
    const C = this.cell, nCells = Math.ceil(this.extent / C), thick = L.top - L.base;
    L.solid = L.cover >= 7;
    const thr = 1 - L.cover / 8;
    for (let j = -nCells; j < nCells; j++)
      for (let i = -nCells; i < nCells; i++) {
        const cn = (j + 0.5) * C, ce = (i + 0.5) * C;
        const nv = noise.fbm(ce / 9000, cn / 9000, 4) * 0.5 + 0.5 + (rndFn() - 0.5) * 0.25;
        if (!L.solid && nv < thr + 0.08) continue;
        const puffs: any[] = [];
        const strength = clamp((nv - thr) * 3 + 0.4, 0.3, 1);
        const count = L.solid ? 5 : 4 + Math.floor(rndFn() * 6 * strength);
        const towerH = L.type === 'cb' ? thick : L.type === 'cu' ? thick * (0.35 + 0.65 * strength) : thick;
        for (let k = 0; k < count; k++) {
          const r = (L.solid ? 700 : 280 + rndFn() * 380) * (0.7 + 0.5 * strength);
          const h = L.solid ? L.base + 40 + rndFn() * (thick - 80) : L.base + r * 0.45 + rndFn() * Math.max(10, towerH - r * 0.9);
          puffs.push({ n: cn + (rndFn() - 0.5) * C * 0.8, e: ce + (rndFn() - 0.5) * C * 0.8, alt: Math.min(h, L.top - r * 0.3), r, rv: r * (L.type === 'st' ? 0.45 : 0.75), shade: 0 });
        }
        for (const p of puffs) p.shade = clamp((p.alt - L.base) / Math.max(thick, 1), 0, 1);
        this.grid.set(this.key(li, i, j), { puffs, strength, conv: L.type === 'cb' ? 1 : L.type === 'cu' ? 0.5 * strength : 0 });
        this.puffCount += puffs.length;
      }
  }

  *allPuffs(): IterableIterator<{ p: any; L: any }> {
    for (const [k, c] of this.grid) {
      const li = Math.floor(k / 1e6);
      for (const p of c.puffs) yield { p, L: this.layers[li] };
    }
  }

  private _cells(n: number, e: number, li: number): any[] {
    const i = Math.floor(e / this.cell), j = Math.floor(n / this.cell);
    const out: any[] = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const c = this.grid.get(this.key(li, i + di, j + dj)); if (c) out.push(c); }
    return out;
  }

  density(n: number, e: number, alt: number): number {
    let best = 0;
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      if (alt < L.base - 400 || alt > L.top + 400) continue;
      if (L.solid) { const d = Math.min(alt - L.base, L.top - alt); best = Math.max(best, smoothstep(-25, 25, d)); continue; }
      for (const c of this._cells(n, e, li)) for (const p of c.puffs) {
        const dn = (n - p.n) / p.r, de = (e - p.e) / p.r, dz = (alt - p.alt) / p.rv;
        const d2 = dn * dn + de * de + dz * dz;
        if (d2 < 1) best = Math.max(best, smoothstep(1, 0.55, Math.sqrt(d2)));
      }
    }
    return best;
  }

  convective(n: number, e: number, alt: number): number {
    let c = 0;
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      if (L.type === 'st' || alt > L.top + 300) continue;
      const i = Math.floor(e / this.cell), j = Math.floor(n / this.cell);
      const cell = this.grid.get(this.key(li, i, j));
      if (cell) c = Math.max(c, cell.conv);
    }
    return c;
  }

  updraft(n: number, e: number, alt: number): number {
    let u = 0;
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      if (L.type === 'st' || alt > L.top) continue;
      const i = Math.floor(e / this.cell), j = Math.floor(n / this.cell);
      const cell = this.grid.get(this.key(li, i, j));
      if (!cell) { u -= 0.4; continue; }
      const cn = (j + 0.5) * this.cell, ce = (i + 0.5) * this.cell;
      const d = Math.hypot(n - cn, e - ce) / (this.cell * 0.5);
      const core = Math.max(0, 1 - d * d);
      u += core * cell.conv * (L.type === 'cb' ? 7 : 2.2) - 0.5 * (1 - core) * cell.conv;
    }
    return u;
  }
}
