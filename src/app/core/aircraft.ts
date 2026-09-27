/*
 * Six-degree-of-freedom flight dynamics model of a Cessna 172S-class aircraft.
 */
import { U, V3, Quat, clamp, lerp, smoothstep, lagK, table, gauss } from './math';

void gauss; // available but not directly used in this file

const { DEG, RAD, KT, G } = U;

const FLAP_DEG = [0, 10, 20, 30];

const CFG: any = {
  S: 16.17, b: 11.0, c: 1.494,
  emptyMass: 767,
  Ixx: 1285, Iyy: 1825, Izz: 2667, refMass: 1043,
  propD: 1.905, propI: 2.1,
  Pind: 141000,
  tankGal: 26.5,
  CL0: 0.31, CLa: 5.143, CLq: 3.9, CLad: 1.7, CLde: 0.43,
  CD0: 0.030, K: 0.07,
  CYb: -0.31, CYp: -0.037, CYr: 0.21, CYdr: 0.187,
  Clb: -0.1, Clp: -0.47, Clr: 0.096, Clda: 0.178, Cldr: -0.0147,
  Cm0: 0.045, Cma: -0.89, Cmq: -12.4, Cmad: -5.2, Cmde: 1.28,
  Cnb: 0.065, Cnp: -0.03, Cnr: -0.099, Cnda: -0.011, Cndr: 0.0657,
  elevUp: 28 * DEG, elevDn: 23 * DEG, ailMax: 15 * DEG, rudMax: 16 * DEG, trimRange: 12 * DEG,
  gear: [
    { name: 'nose', r: [1.2, 0, 1.28], k: 30000, c: 3200, steer: true, maxF: 17000 },
    { name: 'left', r: [-0.42, -1.25, 1.22], k: 50000, c: 5500, brake: 'L', maxF: 30000 },
    { name: 'right', r: [-0.42, 1.25, 1.22], k: 50000, c: 5500, brake: 'R', maxF: 30000 },
  ],
  hard: [
    { name: 'tail', r: [-4.9, 0, 0.25], soft: true },
    { name: 'propeller', r: [1.8, 0, 1.02] },
    { name: 'left wingtip', r: [-0.4, -5.5, -1.05] },
    { name: 'right wingtip', r: [-0.4, 5.5, -1.05] },
    { name: 'belly', r: [0.2, 0, 0.72] },
    { name: 'aft fuselage', r: [-2.2, 0, 0.55] },
    { name: 'cabin roof', r: [0.2, 0, -1.4] },
    { name: 'tail fin', r: [-5.4, 0, -1.2] },
    { name: 'nose', r: [2.2, 0, 0.2] },
  ],
};

const CT_TAB: [number, number][] = [
  [0.0, 0.068], [0.1, 0.068], [0.2, 0.067], [0.3, 0.066], [0.4, 0.064], [0.5, 0.062], [0.6, 0.059], [0.7, 0.054],
  [0.8, 0.043], [0.9, 0.031], [1.0, 0.019], [1.1, 0.008], [1.2, -0.001], [1.3, -0.008], [1.4, -0.019], [1.5, -0.029],
  [1.6, -0.04], [1.7, -0.051], [1.8, -0.057], [1.9, -0.063], [2.0, -0.064], [2.2, -0.067], [5.0, -0.068],
];
const CP_TAB: [number, number][] = [
  [0.0, 0.058], [0.1, 0.062], [0.2, 0.06], [0.3, 0.058], [0.4, 0.052], [0.5, 0.0457], [0.6, 0.0436], [0.7, 0.0421],
  [0.8, 0.0372], [0.9, 0.0312], [1.0, 0.0243], [1.1, 0.0182], [1.2, 0.0149], [1.3, 0.0125], [1.4, 0.0118], [1.5, -0.0003],
  [1.6, -0.0019], [1.7, -0.0052], [1.8, -0.0085], [1.9, -0.0116], [2.0, -0.0139], [2.2, -0.0237], [2.6, -0.0343],
  [3.0, -0.0449], [4.0, -0.0714], [5.0, -0.0714],
];

function cpAt(J: number): number {
  if (J <= 2.6) {
    const c = table(CP_TAB, J);
    return c < 0 ? c * 2.5 : c;
  }
  return -0.08575 * Math.min((J / 2.6) ** 2, 150);
}

function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

const tmpA = new V3(),
  tmpB = new V3(),
  tmpC = new V3();

export class Aircraft {
  cfg: any;
  _wind: any;
  elec: any;
  lights: any;
  failures: any;
  pitotHeat: boolean;
  pos!: any;
  vel!: any;
  omega!: any;
  q!: any;
  ctl!: any;
  flapDeg!: number;
  eng!: any;
  fuel!: number[];
  payload!: number;
  ice!: number;
  pitotIce!: number;
  carbIce!: number;
  crashed!: string | null;
  warning!: string | null;
  warnTimer!: number;
  onGround!: boolean;
  gearContact!: boolean[];
  gearForce!: number[];
  alpha!: number;
  beta!: number;
  alphaDot!: number;
  prevAlpha!: number;
  tas!: number;
  stallAsym!: number;
  stall!: number;
  buffet!: number;
  stallWarn!: boolean;
  gload!: number;
  specForce!: any;
  maxG!: number;
  t!: number;
  touchdown!: any;
  lastTouchVs!: number;
  touchEvent!: number;
  skid!: number;
  rough!: number;
  agl!: number;
  windNED!: any;
  cloud!: number;
  env!: any;
  bank!: number;
  pitch!: number;
  heading!: number;
  alt!: number;
  vs!: number;
  gs!: number;
  track!: number;
  ias!: number;
  qbar!: number;
  atm!: any;
  stallAngle!: number;
  velNED!: any;

  constructor() {
    this.cfg = CFG;
    this._wind = {};
    this.elec = { master: true, avionics: true, alternator: true, battery: 1.0, volts: 28, amps: 0 };
    this.lights = { beacon: true, nav: true, strobe: true, landing: false, taxi: false, panel: true };
    this.failures = { engine: false, vacuum: false, pitot: false, static: false, electrical: false, alternator: false };
    this.pitotHeat = false;
    this.reset({});
  }

  reset(o: any) {
    this.pos = new V3(o.n || 0, o.e || 0, -(o.alt || 0));
    this.vel = new V3(o.u || 0, 0, o.w || 0);
    this.omega = new V3();
    this.q = Quat.fromEuler(o.phi || 0, o.theta || 0, (o.hdg || 0) * DEG);
    this.ctl = {
      elevator: 0, aileron: 0, rudder: 0,
      throttle: o.throttle != null ? o.throttle : 0,
      mixture: o.mixture != null ? o.mixture : 1,
      trim: o.trim != null ? o.trim : 0.1,
      flaps: o.flaps || 0,
      brakeL: 0, brakeR: 0,
      parkingBrake: !!o.parkingBrake,
      carbHeat: false,
      mags: 3,
      fuelSel: 'BOTH',
    };
    this.flapDeg = FLAP_DEG[this.ctl.flaps];
    const running = o.engineRunning !== false;
    this.eng = {
      running, rpm: o.rpm != null ? o.rpm : running ? 750 : 0, map: 101325, oilT: running ? 180 : 70, oilP: running ? 60 : 0,
      egt: running ? 1250 : 70, cht: running ? 330 : 70, ff: 0, power: 0, thrust: 0, lineFuel: 20, rough: 0, torque: 0,
    };
    this.fuel = [o.fuelL != null ? o.fuelL : 20, o.fuelR != null ? o.fuelR : 20];
    this.payload = o.payload != null ? o.payload : 180;
    this.ice = 0;
    this.pitotIce = 0;
    this.carbIce = 0;
    this.crashed = null;
    this.warning = null;
    this.warnTimer = 0;
    this.onGround = false;
    this.gearContact = [false, false, false];
    this.gearForce = [0, 0, 0];
    this.alpha = 0;
    this.beta = 0;
    this.alphaDot = 0;
    this.prevAlpha = 0;
    this.tas = Math.hypot(this.vel.x, this.vel.z);
    this.stallAsym = 0;
    this.stall = 0;
    this.buffet = 0;
    this.stallWarn = false;
    this.gload = 1;
    this.specForce = new V3(0, 0, -G);
    this.maxG = 1;
    this.t = 0;
    this.touchdown = null;
    this.lastTouchVs = 0;
    this.touchEvent = 0;
    this.skid = 0;
    this.rough = 0;
    this.agl = 0;
    this.windNED = { n: 0, e: 0, d: 0 };
    this.cloud = 0;
    this.env = null;
    this.updateDerived();
  }

  get mass(): number {
    return this.cfg.emptyMass + this.payload + (this.fuel[0] + this.fuel[1]) * U.AVGAS_KG_PER_GAL + this.ice * 1.2;
  }

  hasPower(): boolean {
    return this.elec.master && this.elec.volts > 20 && !this.failures.electrical;
  }

  liftCurve(alpha: number, flapF: number, iceF: number): any {
    const c = this.cfg;
    const cl0 = c.CL0 + 0.4 * flapF;
    const clmax = (1.44 + 0.2 * flapF) * (1 - 0.32 * iceF);
    const clmin = -1.0 + 0.2 * flapF;
    const a = c.CLa * (1 - 0.1 * iceF);
    const D = 5 * DEG;
    const as = (clmax - cl0) / a + D / 2;
    const an = (clmin - cl0) / a - D / 2;
    let cl: number, stall: number;
    const plate = 1.15 * Math.sin(2 * alpha);
    if (alpha >= an + D && alpha <= as - D) {
      cl = cl0 + a * alpha;
      stall = 0;
    } else if (alpha > as - D && alpha <= as) {
      cl = clmax - (a / (2 * D)) * (as - alpha) * (as - alpha);
      stall = 0;
    } else if (alpha > as) {
      const d = alpha - as;
      const w = 0.105;
      if (d < w) cl = clmax * (1 - 0.28 * Math.sin((Math.PI / 2) * (d / w)));
      else cl = lerp(0.72 * clmax, plate, smoothstep(0, 0.25, d - w));
      stall = smoothstep(-0.5 * DEG, 3.5 * DEG, d);
    } else if (alpha < an + D && alpha >= an) {
      cl = clmin + (a / (2 * D)) * (alpha - an) * (alpha - an);
      stall = 0;
    } else {
      const d = an - alpha;
      const w = 0.105;
      if (d < w) cl = clmin * (1 - 0.28 * Math.sin((Math.PI / 2) * (d / w)));
      else cl = lerp(0.72 * clmin, plate, smoothstep(0, 0.25, d - w));
      stall = smoothstep(-0.5 * DEG, 3.5 * DEG, d);
    }
    return { cl, stall, as };
  }

  engineStep(dt: number, atm: any, ua: number, env: any): number {
    const c = this.cfg,
      E = this.eng,
      ctl = this.ctl;
    const D = c.propD;
    const n = E.rpm / 60;
    const omega = Math.max(2 * Math.PI * n, 1);
    const rho = atm.rho;

    const sel = ctl.fuelSel;
    const avail = (sel === 'BOTH' && this.fuel[0] + this.fuel[1] > 0.01) || (sel === 'LEFT' && this.fuel[0] > 0.01) || (sel === 'RIGHT' && this.fuel[1] > 0.01);
    if (avail) E.lineFuel = Math.min(20, E.lineFuel + dt * 2);
    else E.lineFuel = Math.max(0, E.lineFuel - dt);
    const fuelOK = E.lineFuel > 0;

    let sigmaCarb = atm.sigma * (ctl.carbHeat ? 0.93 : 1);
    const richness = (ctl.mixture * 1.08) / Math.sqrt(Math.max(sigmaCarb, 0.2));
    let mixEff: number;
    if (richness >= 0.95) mixEff = 1 - 1.6 * (richness - 0.95) ** 2;
    else mixEff = 1 - 3.5 * Math.pow(0.95 - richness, 1.6);
    mixEff = Math.max(0, mixEff);
    const magEff = ctl.mags === 3 || ctl.mags === 4 ? 1 : ctl.mags === 1 || ctl.mags === 2 ? 0.965 : 0;
    const canRun = fuelOK && magEff > 0 && richness > 0.55 && richness < 1.9 && !this.failures.engine;

    const thr = clamp(ctl.throttle, 0, 1);
    let mapFrac = 0.2 + 0.77 * Math.pow(thr, 1.2);
    mapFrac -= 0.06 * (E.rpm / 2700) * (1 - thr);
    mapFrac *= 1 - 0.45 * this.carbIce;
    E.map = atm.p * clamp(mapFrac, 0.2, 0.97);

    let rough = 0;
    if (richness < 0.72) rough += (0.72 - richness) * 4;
    if (this.carbIce > 0.35) rough += (this.carbIce - 0.35) * 1.5;
    E.rough = clamp(rough, 0, 1);

    let Pind = 0;
    if (E.running) {
      Pind = c.Pind * (E.map / 101325) * (E.rpm / 2700) * mixEff * magEff * Math.sqrt(288.15 / atm.T) * (ctl.carbHeat ? 0.92 : 1);
      if (E.rough > 0) Pind *= 1 - E.rough * 0.5 * (0.5 + 0.5 * Math.sin(this.t * 37) * Math.random());
    }
    const rr = E.rpm / 2700;
    const Pfric = 12500 * rr * rr + 2000 * rr + Math.max(0, atm.p - E.map) * 0.0059 * (E.rpm / 120) * (E.running ? 1 : 0.25);
    const Pb = Pind - Pfric;
    let Qe = Pb / omega;
    if (!E.running && E.rpm < 40) Qe = -30 * Math.sign(E.rpm);

    let T = 0, Qp = 0;
    const ice = clamp(this.ice / 25, 0, 1);
    if (n > 2) {
      const J = Math.max(ua, 0) / (n * D);
      T = table(CT_TAB, J) * 1.07 * rho * n * n * D ** 4 * (1 - 0.15 * ice);
      Qp = (cpAt(J) * rho * n ** 3 * D ** 5) / omega;
    } else {
      Qp = -0.00202 * rho * ua * Math.abs(ua) * D ** 3;
      if (!E.running) Qp += 30;
      if (Math.abs(Qp) < 30 && !E.running && E.rpm < 5) Qp = 0;
    }
    let Qs = 0;
    if (ctl.mags === 4 && this.hasPower()) {
      Qs = 95 * clamp(1 - E.rpm / 700, 0, 1);
      this.elec.cranking = true;
    } else this.elec.cranking = false;

    const dOmega = ((Qe + Qs - Qp) / c.propI) * dt;
    E.rpm = Math.max(0, E.rpm + (dOmega * 60) / (2 * Math.PI));
    if (!E.running && E.rpm < 3 && Qs === 0 && Math.abs(ua) < 25) E.rpm = 0;

    if (!E.running) {
      if (canRun && E.rpm > 140 && (ctl.mags === 4 || E.rpm > 500)) E.running = true;
    } else if (!canRun || E.rpm < 280) {
      E.running = false;
    }

    E.power = Math.max(0, Pb);
    E.thrust = T;
    E.torque = Qp * omega > 0 ? Qp : 0;
    E.omega = omega;
    E.richness = richness;
    E.ff = E.running ? (Pind / 745.7) * 0.074 * (richness / 0.95) : 0;
    const burn = (E.ff / 3600) * dt;
    if (burn > 0) {
      if (sel === 'BOTH') {
        const l = this.fuel[0] > 0, r = this.fuel[1] > 0;
        if (l && r) { this.fuel[0] -= burn / 2; this.fuel[1] -= burn / 2; }
        else if (l) this.fuel[0] -= burn;
        else if (r) this.fuel[1] -= burn;
      } else if (sel === 'LEFT') this.fuel[0] -= burn;
      else if (sel === 'RIGHT') this.fuel[1] -= burn;
      this.fuel[0] = Math.max(0, this.fuel[0]);
      this.fuel[1] = Math.max(0, this.fuel[1]);
    }
    const pf = E.power / 119000;
    const egtT = E.running ? 900 + 520 * pf - (richness > 0.82 ? 900 * (richness - 0.82) ** 2 : 1600 * (0.82 - richness) ** 2) * 1.5 : atm.tempC * 1.8 + 32;
    E.egt += (egtT - E.egt) * lagK(dt, 4);
    const coolV = Math.max(this.tas, 15);
    const chtT = E.running ? 220 + 220 * pf * (40 / coolV) ** 0.3 + (richness < 0.95 ? 60 * (0.95 - richness) : 0) : atm.tempC * 1.8 + 32;
    E.cht += (chtT - E.cht) * lagK(dt, 60);
    const oilTT = E.running ? 150 + 55 * pf + (atm.tempC - 15) * 0.8 : atm.tempC * 1.8 + 32;
    E.oilT += (oilTT - E.oilT) * lagK(dt, 180);
    const oilPT = E.rpm > 200 ? clamp(25 + E.rpm / 45 - (E.oilT - 180) * 0.1, 0, 95) : 0;
    E.oilP += (oilPT - E.oilP) * lagK(dt, 1);
    return T;
  }

  step(dt: number, env: any) {
    if (this.crashed) return;
    this.env = env;
    this.t += dt;
    const c = this.cfg, W = env.weather, TER = env.terrain, ctl = this.ctl;
    const q = this.q, pos = this.pos, v = this.vel, w = this.omega;
    const alt = -pos.z;
    const gh = TER.groundHeight(pos.x, pos.y);
    this.agl = alt - gh;
    const atm = W.atmosphere(alt);
    this.atm = atm;
    const rho = atm.rho;
    const m = this.mass;
    const mScale = m / c.refMass;
    const Ixx = c.Ixx * mScale, Iyy = c.Iyy * mScale, Izz = c.Izz * mScale;

    const fT = FLAP_DEG[ctl.flaps];
    if (this.hasPower() && this.flapDeg !== fT) {
      const s = 3.3 * dt;
      this.flapDeg = Math.abs(fT - this.flapDeg) < s ? fT : this.flapDeg + Math.sign(fT - this.flapDeg) * s;
    }
    const flapF = this.flapDeg / 30;

    const wind = W.step(dt, pos, this.agl, this.tas, TER, this._wind);
    this.windNED = wind;
    this.cloud = wind.cloud;
    const windB = q.invRotate(tmpA.set(wind.n, wind.e, wind.d), tmpB);
    const ua = v.x - windB.x, va = v.y - windB.y, wa = v.z - windB.z;
    const V = Math.sqrt(ua * ua + va * va + wa * wa);
    this.tas = V;
    let alpha = 0, beta = 0;
    if (V > 0.8) {
      alpha = Math.atan2(wa, ua);
      beta = Math.asin(clamp(va / V, -1, 1));
    }
    const blend = smoothstep(0.8, 6, V);
    const aDotRaw = clamp((alpha - this.prevAlpha) / dt, -3, 3) * blend;
    this.alphaDot += (aDotRaw - this.alphaDot) * lagK(dt, 0.05);
    this.prevAlpha = alpha;
    this.alpha = alpha;
    this.beta = beta;

    const qbar = 0.5 * rho * V * V;
    this.qbar = qbar;
    const p = w.x - wind.p * blend, qq = w.y - wind.q * blend, r = w.z - wind.r * blend;

    this.updateIcing(dt, atm, wind.cloud, W);
    const iceF = clamp(this.ice / 25, 0, 1);

    const thrust = this.engineStep(dt, atm, ua, env);
    const Adisk = Math.PI * (c.propD / 2) ** 2;
    const qtail = qbar + 0.55 * Math.max(thrust, 0) / Adisk;

    const e = clamp(ctl.elevator, -1, 1);
    let de = (e >= 0 ? e * c.elevUp : e * c.elevDn) + clamp(ctl.trim, -1, 1) * c.trimRange;
    de *= 1 - (0.35 * Math.abs(de)) / c.elevUp;
    const da = clamp(ctl.aileron, -1, 1) * c.ailMax;
    const dr = clamp(ctl.rudder, -1, 1) * c.rudMax;

    const hw = Math.max(this.agl + 1.1, 0.5) / c.b;
    const x16 = 16 * hw;
    const phiGE = (x16 * x16) / (1 + x16 * x16);

    const lc = this.liftCurve(alpha, flapF, iceF);
    this.stall = lc.stall * blend;
    this.stallAngle = lc.as;
    if (this.stall > 0.2 && this.stallAsym === 0) this.stallAsym = (Math.random() - 0.5) * 2;
    if (this.stall < 0.05) this.stallAsym = 0;
    this.stallWarn = V > 18 && alpha > lc.as - 3.3 * DEG && !this.onGround;
    this.buffet = clamp(this.stall * 1.2 + smoothstep(lc.as - 2 * DEG, lc.as, alpha) * 0.3, 0, 1) * blend;

    const CLw = lc.cl * (1 + 0.1 * (1 - phiGE));
    const CL = CLw - c.CLde * de * 0.3;
    const CDi = c.K * CLw * CLw * phiGE;
    let CD = c.CD0 * (1 + 0.5 * iceF) + 0.012 * iceF + CDi + 0.05 * Math.pow(flapF, 1.4) + 0.3 * beta * beta + 0.01 * Math.abs(de);
    CD = Math.max(CD, c.CD0 + 1.28 * Math.sin(alpha) ** 2 + 0.3 * flapF * Math.abs(Math.sin(alpha)));
    const st = this.stall;

    const qS = qbar * c.S;
    const qrate = 0.25 * rho * V * c.S;

    const Lift = qS * CL + qrate * c.c * (c.CLq * qq + c.CLad * this.alphaDot);
    const Drag = qS * CD;
    const Side = qS * c.CYb * beta - qtail * c.S * c.CYdr * dr + qrate * c.b * (c.CYp * p + c.CYr * r);

    let Fx = 0, Fy = 0, Fz = 0;
    if (V > 0.1) {
      const iv = 1 / V;
      const sa = Math.sin(alpha), ca = Math.cos(alpha);
      Fx = -Drag * ua * iv + Lift * sa;
      Fy = -Drag * va * iv + Side;
      Fz = -Drag * wa * iv - Lift * ca;
    }
    Fx += thrust;

    const phat = (p * c.b) / (2 * Math.max(V, 8));
    const plim = 0.1;
    const rollDamp = c.Clp * (phat - 1.5 * st * plim * Math.tanh(phat / plim));
    const Cl = c.Clb * beta * (1 - 0.4 * st) + c.Clda * da * (1 - 0.55 * st) + st * this.stallAsym * 0.012 + rollDamp;
    let Lm = qS * c.b * Cl + qtail * c.S * c.b * c.Cldr * dr + qrate * c.b * c.b * c.Clr * r;
    Lm += -0.35 * (this.eng.torque - 180) * smoothstep(0, 5, this.eng.rpm / 100);

    const aS = alpha - lc.as;
    let Cm = c.Cm0 + c.Cma * Math.sin(alpha) - 0.1 * flapF - 0.06 * (1 - phiGE) - 0.02 * iceF;
    if (aS > 0) Cm -= 1.1 * Math.min(aS, 0.5);
    if (Math.abs(alpha) > 0.6) Cm -= 0.4 * Math.sin(alpha);
    let Mm = qS * c.c * Cm + qtail * c.S * c.c * c.Cmde * de + qrate * c.c * c.c * (c.Cmq * qq + c.Cmad * this.alphaDot);
    Mm += thrust * 0.3;

    const Cn = c.Cnb * beta + c.Cnda * da;
    let Nm = qS * c.b * Cn + qtail * c.S * c.b * c.Cndr * dr + qrate * c.b * c.b * (c.Cnp * p + c.Cnr * r * (1 - 0.5 * st));
    Nm += -thrust * (2.6 * Math.max(alpha, -0.1) + 0.14 * Math.max(0, 1 - V / 45)) + 0.05 * thrust * smoothstep(30, 60, V);
    const Hp = c.propI * (this.eng.omega || 0);
    Mm += r * Hp * 0.25;
    Nm += -qq * Hp * 0.25;

    const grav = q.invRotate(tmpA.set(0, 0, m * G), tmpC);
    let FxT = Fx + grav.x, FyT = Fy + grav.y, FzT = Fz + grav.z;

    const gnd = this.groundForces(dt, TER, m);
    FxT += gnd.F.x; FyT += gnd.F.y; FzT += gnd.F.z;
    Lm += gnd.M.x; Mm += gnd.M.y; Nm += gnd.M.z;
    if (this.crashed) return;

    this.specForce.set((FxT - grav.x) / m, (FyT - grav.y) / m, (FzT - grav.z) / m);
    this.gload = -this.specForce.z / G;
    if (Math.abs(this.gload) > this.maxG) this.maxG = Math.abs(this.gload);
    if (this.gload > 5.7 || this.gload < -3.0) return this.crash('Structural failure: G limit exceeded (' + this.gload.toFixed(1) + ' G)');
    const ias = Math.sqrt((2 * qbar) / 1.225) / KT;
    if (ias > 205) return this.crash('Structural failure: exceeded Vne (flutter)');
    if ((flapF > 0.34 && ias > 88) || (flapF > 0 && ias > 112)) this.warn('FLAP OVERSPEED (Vfe 85 / 110 KIAS)');

    v.x += (FxT / m + r * v.y - qq * v.z) * dt;
    v.y += (FyT / m + p * v.z - r * v.x) * dt;
    v.z += (FzT / m + qq * v.x - p * v.y) * dt;
    const P = w.x, Q = w.y, R = w.z;
    w.x += ((Lm - (Izz - Iyy) * Q * R) / Ixx) * dt;
    w.y += ((Mm - (Ixx - Izz) * P * R) / Iyy) * dt;
    w.z += ((Nm - (Iyy - Ixx) * P * Q) / Izz) * dt;
    q.integrate(w.x, w.y, w.z, dt);
    const vn = q.rotate(v, tmpA);
    pos.x += vn.x * dt; pos.y += vn.y * dt; pos.z += vn.z * dt;
    this.velNED = this.velNED || new V3();
    this.velNED.copy(vn);

    if (Math.abs(pos.x) > 60000 || Math.abs(pos.y) > 60000) this.warn('Leaving the simulated area');
    if (alt > 5500) this.warn('Above service ceiling – engine power very low');
    this.warnTimer -= dt;
    if (this.warnTimer <= 0) this.warning = null;
    this.updateDerived();
  }

  warn(msg: string) {
    this.warning = msg;
    this.warnTimer = 3;
  }

  crash(reason: string) {
    this.crashed = reason;
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.eng.running = false;
    this.eng.rpm = 0;
  }

  groundForces(dt: number, TER: any, m: number): any {
    const c = this.cfg, q = this.q, pos = this.pos, v = this.vel, w = this.omega, ctl = this.ctl;
    const F = new V3(), M = new V3();
    let anyContact = false;
    const surface = TER.surface(pos.x, pos.y);
    const onWater = surface === 'water';
    const paved = surface === 'asphalt';
    const rB = new V3(), vB = new V3();
    const brakeL = Math.max(ctl.brakeL, ctl.parkingBrake ? 1 : 0),
      brakeR = Math.max(ctl.brakeR, ctl.parkingBrake ? 1 : 0);
    let maxVs = 0;
    this.skid = 0;
    this.rough = 0;
    for (let i = 0; i < c.gear.length; i++) {
      const g = c.gear[i];
      rB.set(g.r[0], g.r[1], g.r[2]);
      const P = q.rotate(rB);
      const pn = pos.x + P.x, pe = pos.y + P.y, pd = pos.z + P.z;
      const gH = TER.groundHeight(pn, pe);
      const pen = pd + gH;
      this.gearContact[i] = false;
      this.gearForce[i] = 0;
      if (pen <= 0) continue;
      if (onWater) return { F, M, crash: this.crash('Ditched in the water') };
      vB.copy(v).add(w.cross(rB));
      const vN = q.rotate(vB);
      const compRate = vN.z;
      let Fn = g.k * pen + g.c * compRate * (compRate > 0 ? 1 : 0.6);
      if (Fn < 0) Fn = 0;
      if (Fn > g.maxF) return { F, M, crash: this.crash(i === 0 ? 'Nose gear collapsed – hard nose-first landing' : 'Main gear collapsed – hard landing') };
      anyContact = true;
      this.gearContact[i] = true;
      this.gearForce[i] = Fn;
      if (compRate > maxVs) maxVs = compRate;
      let steer = 0;
      if (g.steer) steer = clamp(ctl.rudder, -1, 1) * 10 * DEG * clamp(1.4 - this.tas / 30, 0.3, 1);
      const dB = new V3(Math.cos(steer), Math.sin(steer), 0);
      const dN = q.rotate(dB);
      let hx = dN.x, hy = dN.y;
      const hl = Math.hypot(hx, hy) || 1;
      hx /= hl; hy /= hl;
      const vl = vN.x * hx + vN.y * hy;
      const vs = -vN.x * hy + vN.y * hx;
      const brake = g.brake === 'L' ? brakeL : g.brake === 'R' ? brakeR : 0;
      const muRoll = paved ? 0.018 : 0.06;
      const muBrake = (paved ? 0.62 : 0.4) * brake;
      const muLat = paved ? 0.85 : 0.6;
      let fl = -(muRoll + muBrake) * Fn * Math.tanh(vl / 0.06);
      const slip = Math.atan2(vs, Math.max(Math.abs(vl), 1.2));
      let fs = -muLat * Fn * Math.tanh(slip / 0.09);
      const lim = (paved ? 0.9 : 0.65) * Fn;
      const tot = Math.hypot(fl, fs);
      if (tot > lim) { fl *= lim / tot; fs *= lim / tot; }
      if (Math.abs(vs) > 1.2 && Fn > 1500) this.skid = Math.max(this.skid, clamp(Math.abs(vs) / 6, 0, 1));
      if (brake > 0.5 && Math.abs(vl) > 3 && Fn > 2000) this.skid = Math.max(this.skid, 0.3 * brake);
      if (!paved) this.rough = Math.max(this.rough, clamp(Math.abs(vl) / 25, 0, 1));
      const fn_ = fl * hx - fs * hy, fe = fl * hy + fs * hx, fd = -Fn;
      const fb = q.invRotate(tmpA.set(fn_, fe, fd), tmpB);
      F.add(fb);
      M.add(rB.cross(fb));
    }
    for (const h of c.hard) {
      rB.set(h.r[0], h.r[1], h.r[2]);
      const P = q.rotate(rB);
      const gH = TER.groundHeight(pos.x + P.x, pos.y + P.y);
      const pen = pos.z + P.z + gH;
      if (pen <= 0) continue;
      vB.copy(v).add(w.cross(rB));
      const vN = q.rotate(vB);
      const spd = Math.hypot(vN.x, vN.y, vN.z);
      if (onWater) return { F, M, crash: this.crash('Ditched in the water') };
      if (h.soft && vN.z < 2.5 && spd < 45) {
        this.warn('TAIL STRIKE!');
        const Fn = 60000 * pen + 4000 * Math.max(vN.z, 0);
        const hs = Math.hypot(vN.x, vN.y) || 1;
        const fb = q.invRotate(tmpA.set((-0.5 * Fn * vN.x) / hs, (-0.5 * Fn * vN.y) / hs, -Fn), tmpB);
        F.add(fb); M.add(rB.cross(fb));
        anyContact = true;
        continue;
      }
      if (spd > 1.5 || pen > 0.3) return { F, M, crash: this.crash(h.name === 'propeller' ? 'Propeller strike' : 'Collision: ' + h.name + ' hit the ground') };
    }
    if (anyContact && !this.onGround && this.t > 0.5) {
      this.lastTouchVs = maxVs;
      this.touchEvent = this.t;
      this.touchdown = { vsFpm: maxVs / U.FPM, t: this.t, pitch: this.pitch, bank: this.bank, ias: this.ias, crab: this.beta * RAD };
    }
    this.onGround = anyContact;
    return { F, M };
  }

  updateIcing(dt: number, atm: any, cloud: number, W: any) {
    const oat = atm.tempC;
    const visibleMoisture = cloud > 0.3 || (W.precip > 0.05 && -this.pos.z < (W.layers[0] ? W.layers[0].base : 1e9));
    const icing = visibleMoisture && oat <= 1 && oat >= -18;
    if (icing) this.ice += dt * 0.035 * (0.5 + clamp(this.tas / 60, 0, 1)) * (cloud > 0.3 ? 1 : 0.5 * W.precip);
    else if (oat > 2) this.ice = Math.max(0, this.ice - dt * 0.03 * (oat - 1));
    this.ice = clamp(this.ice, 0, 30);
    const heat = this.pitotHeat && this.hasPower();
    if (heat) this.pitotIce = Math.max(0, this.pitotIce - dt * 0.08);
    else if ((icing || (visibleMoisture && oat < 3)) && oat < 2) this.pitotIce = Math.min(1.2, this.pitotIce + dt * 0.012);
    else if (oat > 3) this.pitotIce = Math.max(0, this.pitotIce - dt * 0.01);
    const spread = W.tempC - W.dewC;
    const humid = clamp(1 - spread / 12, 0, 1) + (visibleMoisture ? 0.4 : 0);
    const tempRisk = oat > -10 && oat < 27 ? 1 - Math.abs(oat - 8) / 20 : 0;
    const risk = Math.max(0, humid * tempRisk) * (1.4 - clamp(this.ctl.throttle, 0, 1));
    if (this.ctl.carbHeat && this.eng.running) this.carbIce = Math.max(0, this.carbIce - dt * 0.03);
    else if (this.eng.running) this.carbIce = clamp(this.carbIce + dt * risk * 0.0012 - dt * 0.0003, 0, 1);
  }

  updateDerived() {
    const e = this.q.toEuler();
    this.bank = e.phi;
    this.pitch = e.theta;
    this.heading = this._wrap360(e.psi * RAD);
    this.alt = -this.pos.z;
    const vn = this.q.rotate(this.vel);
    this.vs = -vn.z;
    this.gs = Math.hypot(vn.x, vn.y);
    this.track = this._wrap360(Math.atan2(vn.y, vn.x) * RAD);
    this.ias = Math.sqrt((2 * (this.qbar || 0)) / 1.225) / KT;
  }

  private _wrap360(v: number): number {
    // inline wrap360 to avoid circular issues
    v = v % 360;
    return v < 0 ? v + 360 : v;
  }

  trim(env: any, o: any): any {
    const calmW = {
      atmosphere: (h: number) => env.weather.atmosphere(h),
      step: (dt: number, pos: any, agl: number, tas: number, ter: any, out: any) => Object.assign(out || {}, { n: 0, e: 0, d: 0, p: 0, q: 0, r: 0, cloud: 0 }),
      precip: 0, layers: [], tempC: env.weather.tempC, dewC: env.weather.tempC - 30,
    };
    const calm = { weather: calmW, terrain: env.terrain };
    const atm = env.weather.atmosphere(o.alt);
    const tas = (o.kias * KT) / Math.sqrt(atm.sigma);
    const fixedThrottle = o.throttle != null;
    const hdg = (o.hdg || 0) * DEG;
    const engineOn = !this.failures.engine;
    this.reset(Object.assign({}, o, { u: tas }));
    this.ctl.flaps = o.flaps || 0;
    const flaps = this.ctl.flaps;
    let rpmGuess = 2000;

    const setState = (x: number[]) => {
      const alpha = x[0];
      const gamma = fixedThrottle ? x[2] : (o.gamma || 0) * DEG;
      const thr = fixedThrottle ? o.throttle : clamp(x[2], 0, 1);
      this.pos.set(o.n || 0, o.e || 0, -o.alt);
      this.q = Quat.fromEuler(0, alpha + gamma, hdg);
      this.vel.set(tas * Math.cos(alpha), 0, tas * Math.sin(alpha));
      this.omega.set(0, 0, 0);
      this.ctl.trim = x[1];
      this.ctl.elevator = 0;
      this.ctl.aileron = 0;
      this.ctl.rudder = 0;
      this.ctl.throttle = thr;
      this.ctl.flaps = flaps;
      this.flapDeg = FLAP_DEG[flaps];
      this.prevAlpha = alpha;
      this.alphaDot = 0;
      this.tas = tas;
      this.crashed = null;
      this.onGround = false;
      this.eng.running = engineOn;
      this.eng.rpm = rpmGuess;
      this.eng.lineFuel = 20;
      const a = env.weather.atmosphere(o.alt);
      for (let i = 0; i < 4000; i++) {
        const before = this.eng.rpm;
        this.engineStep(0.01, a, this.vel.x, calm);
        if (Math.abs(this.eng.rpm - before) < 1e-5 && i > 20) break;
      }
      this.eng.running = engineOn;
      rpmGuess = Math.max(this.eng.rpm, 300);
    };
    const resid = (x: number[]) => {
      setState(x);
      const u0 = this.vel.x, w0 = this.vel.z;
      const h = 0.002;
      this.step(h, calm);
      return [(this.vel.x - u0) / h, (this.vel.z - w0) / h, (this.omega.y / h) * 5];
    };
    let x = [0.05, 0, fixedThrottle ? (o.gamma || 0) * DEG : 0.6];
    for (let it = 0; it < 40; it++) {
      const r0 = resid(x);
      const err = Math.abs(r0[0]) + Math.abs(r0[1]) + Math.abs(r0[2]);
      if (err < 1e-3) break;
      const J: number[][] = [[], [], []];
      const dx = [1e-3, 1e-3, fixedThrottle ? 1e-3 : 0.005];
      for (let j = 0; j < 3; j++) {
        const xp = x.slice();
        xp[j] += dx[j];
        const rp = resid(xp);
        for (let i = 0; i < 3; i++) J[i][j] = (rp[i] - r0[i]) / dx[j];
      }
      const d = solve3(J, r0.map((v) => -v));
      if (!d) break;
      const lim = [0.05, 0.2, 0.2];
      for (let j = 0; j < 3; j++) x[j] += clamp(d[j], -lim[j], lim[j]);
      x[1] = clamp(x[1], -1.5, 1.5);
      if (!fixedThrottle) x[2] = clamp(x[2], 0, 1);
    }
    setState(x);
    this.t = 0;
    this.maxG = 1;
    this.touchdown = null;
    this.onGround = false;
    this.qbar = 0.5 * atm.rho * tas * tas;
    if (o.fuelL != null) this.fuel = [o.fuelL, o.fuelR];
    this.updateDerived();
    return {
      throttle: this.ctl.throttle, trim: this.ctl.trim, pitch: this.pitch * RAD, alpha: x[0] * RAD, rpm: this.eng.rpm,
      vs: this.vs / U.FPM, ias: this.ias, ok: Math.abs(this.ctl.trim) <= 1 && (fixedThrottle || (x[2] >= -0.01 && x[2] <= 1.01)),
    };
  }

  placeOnGround(TER: any, n: number, e: number, hdg: number) {
    this.reset({ n, e, hdg, alt: 0, throttle: 0, trim: 0.1 });
    const gh = TER.groundHeight(n, e);
    this.pos.set(n, e, -(gh + 1.16));
    this.q = Quat.fromEuler(0, 1.6 * DEG, hdg * DEG);
    this.onGround = true;
    this.t = 0;
    this.updateDerived();
  }
}

export { FLAP_DEG };
