/*
 * Core math: vectors, quaternions, noise, units.
 *
 * Frames used by the simulation:
 *   World  : NED  (x = North, y = East, z = Down), metres
 *   Body   : x = forward, y = right wing, z = down (standard aerospace)
 *   Render : Three.js (X = East, Y = Up, Z = South)
 */

export const U = {
  DEG: Math.PI / 180,
  RAD: 180 / Math.PI,
  KT: 0.514444,
  FT: 0.3048,
  NM: 1852,
  FPM: 0.00508,
  G: 9.80665,
  HPA_PER_INHG: 33.8639,
  LB: 0.453592,
  GAL: 3.78541,
  AVGAS_KG_PER_GAL: 2.72,
};

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrap360 = (a: number): number => ((a % 360) + 360) % 360;
export const wrap180 = (a: number): number => {
  a = wrap360(a);
  return a > 180 ? a - 360 : a;
};
export const wrapPi = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
export const lagK = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
export const table = (tab: [number, number][], x: number): number => {
  if (x <= tab[0][0]) return tab[0][1];
  const n = tab.length - 1;
  if (x >= tab[n][0]) return tab[n][1];
  let lo = 0, hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (tab[m][0] <= x) lo = m; else hi = m;
  }
  const t = (x - tab[lo][0]) / (tab[hi][0] - tab[lo][0]);
  return tab[lo][1] + (tab[hi][1] - tab[lo][1]) * t;
};

export class V3 {
  x: number; y: number; z: number;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: V3): this { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone(): V3 { return new V3(this.x, this.y, this.z); }
  add(v: V3): this { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: V3): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v: V3, s: number): this { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  dot(v: V3): number { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: V3): V3 {
    return new V3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }
  length(): number { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  normalize(): this {
    const l = this.length();
    if (l > 1e-12) this.scale(1 / l);
    return this;
  }
}

export class Quat {
  w: number; x: number; y: number; z: number;
  constructor(w = 1, x = 0, y = 0, z = 0) { this.w = w; this.x = x; this.y = y; this.z = z; }
  copy(q: Quat): this { this.w = q.w; this.x = q.x; this.y = q.y; this.z = q.z; return this; }
  clone(): Quat { return new Quat(this.w, this.x, this.y, this.z); }
  static fromEuler(phi: number, theta: number, psi: number): Quat {
    const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
    const cp = Math.cos(theta / 2), sp = Math.sin(theta / 2);
    const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
    return new Quat(
      cr * cp * cy + sr * sp * sy,
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
    );
  }
  toEuler(): { phi: number; theta: number; psi: number } {
    const { w, x, y, z } = this;
    const phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const theta = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
    const psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return { phi, theta, psi };
  }
  rotate(v: V3, out?: V3): V3 {
    out = out || new V3();
    const { w, x, y, z } = this;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    out.set(v.x + w * tx + (y * tz - z * ty), v.y + w * ty + (z * tx - x * tz), v.z + w * tz + (x * ty - y * tx));
    return out;
  }
  invRotate(v: V3, out?: V3): V3 {
    out = out || new V3();
    const w = this.w, x = -this.x, y = -this.y, z = -this.z;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    out.set(v.x + w * tx + (y * tz - z * ty), v.y + w * ty + (z * tx - x * tz), v.z + w * tz + (x * ty - y * tx));
    return out;
  }
  integrate(p: number, q: number, r: number, dt: number): this {
    const { w, x, y, z } = this;
    this.w += 0.5 * (-x * p - y * q - z * r) * dt;
    this.x += 0.5 * (w * p + y * r - z * q) * dt;
    this.y += 0.5 * (w * q + z * p - x * r) * dt;
    this.z += 0.5 * (w * r + x * q - y * p) * dt;
    return this.normalize();
  }
  normalize(): this {
    const l = Math.hypot(this.w, this.x, this.y, this.z) || 1;
    this.w /= l; this.x /= l; this.y /= l; this.z /= l;
    return this;
  }
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rng = mulberry32;

export class Noise {
  perm: Uint8Array;
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  noise(x: number, y: number): number {
    const P = this.perm;
    let xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    xi &= 255; yi &= 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const g = (h: number, dx: number, dy: number) => {
      switch (h & 7) {
        case 0: return dx + dy; case 1: return -dx + dy;
        case 2: return dx - dy; case 3: return -dx - dy;
        case 4: return dx; case 5: return -dx;
        case 6: return dy; default: return -dy;
      }
    };
    const aa = P[P[xi] + yi], ab = P[P[xi] + yi + 1];
    const ba = P[P[xi + 1] + yi], bb = P[P[xi + 1] + yi + 1];
    const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u);
    const x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.9;
  }
  fbm(x: number, y: number, oct = 5, lac = 2.0, gain = 0.5): number {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise(x * f, y * f); n += a; a *= gain; f *= lac;
    }
    return s / n;
  }
  ridge(x: number, y: number, oct = 5): number {
    let a = 1, f = 1, s = 0, n = 0, prev = 1;
    for (let i = 0; i < oct; i++) {
      let r = 1 - Math.abs(this.noise(x * f, y * f));
      r *= r; s += r * a * prev; prev = r; n += a; a *= 0.5; f *= 2.1;
    }
    return s / n;
  }
}

export const gauss = (): number => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
