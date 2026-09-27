/*
 * Airbus A320-200 (CFM56-5B4) six-degree-of-freedom flight dynamics with fly-by-wire control laws.
 */
import { U, V3, Quat, clamp, lerp, smoothstep, lagK, table, gauss } from '../core/math';

void table; void gauss; // available but not directly used inline here

const { DEG, RAD, KT, G, FT } = U;

export let FBW_GAINS: any = null;
export let NO_TRIM = false;

export const A320_CONF = [
  { name: '0', slat: 0, flap: 0, vfe: 350 },
  { name: '1', slat: 18, flap: 0, vfe: 230 },
  { name: '2', slat: 22, flap: 15, vfe: 200 },
  { name: '3', slat: 22, flap: 20, vfe: 185 },
  { name: 'FULL', slat: 27, flap: 40, vfe: 177 },
];
export const A320_CONF1F = { name: '1+F', slat: 18, flap: 10, vfe: 215 };

const CONF = A320_CONF;
const CONF1F = A320_CONF1F;

const CFG: any = {
  S: 122.6, b: 34.1, c: 4.19, oew: 42600,
  Ixx: 1.35e6, Iyy: 3.3e6, Izz: 4.55e6, refMass: 64000,
  T0: 120000,
  engY: 5.75, engZ: 2.1,
  gear: [
    { name: 'nose', r: [11.0, 0, 3.1], k: 4.5e5, c: 5.5e4, steer: true, maxF: 6.5e5 },
    { name: 'left', r: [-1.3, -3.8, 3.2], k: 1.45e6, c: 1.7e5, brake: 'L', maxF: 2.6e6 },
    { name: 'right', r: [-1.3, 3.8, 3.2], k: 1.45e6, c: 1.7e5, brake: 'R', maxF: 2.6e6 },
  ],
  hard: [
    { name: 'tail', r: [-17.5, 0, -0.35], soft: true },
    { name: 'left engine', r: [3.0, -5.75, 2.62] },
    { name: 'right engine', r: [3.0, 5.75, 2.62] },
    { name: 'left wingtip', r: [-6.5, -17.0, -0.4] },
    { name: 'right wingtip', r: [-6.5, 17.0, -0.4] },
    { name: 'fuselage belly', r: [2.0, 0, 1.75] },
    { name: 'nose', r: [18.0, 0, 1.2] },
    { name: 'aft fuselage', r: [-10, 0, 1.4] },
  ],
};

const tA = new V3(), tB = new V3(), tC = new V3();

class Engine {
  i: number;
  running!: boolean;
  n1!: number;
  n2!: number;
  egt!: number;
  ff!: number;
  thrust!: number;
  rev!: number;
  failed!: boolean;
  fire!: boolean;
  phase!: string;
  oilP!: number;
  oilT!: number;
  oilQ!: number;
  startValve!: boolean;
  ign!: boolean;
  fuelUsed!: number;
  n1cmd!: number;

  constructor(i: number) {
    this.i = i;
    this.reset(true);
  }
  reset(running: boolean) {
    this.running = running;
    this.n1 = running ? 19.5 : 0;
    this.n2 = running ? 66 : 0;
    this.egt = running ? 480 : 20;
    this.ff = running ? 330 : 0;
    this.thrust = 0;
    this.rev = 0;
    this.failed = false;
    this.fire = false;
    this.phase = running ? 'RUN' : 'OFF';
    this.oilP = running ? 45 : 0;
    this.oilT = running ? 90 : 20;
    this.oilQ = 16 + this.i * 0.5;
    this.startValve = false;
    this.ign = false;
    this.fuelUsed = 0;
    this.n1cmd = 0;
  }
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

export class A320 {
  type: string;
  cfg: any;
  _wind: any;
  lights: any;
  failures: any;
  eng: Engine[];
  pos!: any;
  vel!: any;
  omega!: any;
  q!: any;
  ctl!: any;
  conf!: any;
  slat!: number;
  flap!: number;
  flapDeg!: number;
  gearPos!: number;
  ths!: number;
  surf!: any;
  fbw!: any;
  apCmd: any;
  fuelKg!: number;
  zfw!: number;
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
  stall!: number;
  stallWarn!: boolean;
  buffet!: number;
  gload!: number;
  specForce!: any;
  maxG!: number;
  t!: number;
  touchdown!: any;
  touchEvent!: number;
  skid!: number;
  rough!: number;
  agl!: number;
  windNED!: any;
  cloud!: number;
  ice!: number;
  carbIce!: number;
  mach!: number;
  env!: any;
  velNED!: any;
  brakeTemp!: number[];
  accum!: number;
  tailStrike!: boolean;
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
  sys: any;
  athrFrac: any;
  athrActive: any;
  alphaFloor: any;
  alphaProt!: number;
  alphaMax!: number;
  protActive: any;
  nzCmd: any;
  auth: any;
  splAvail: any;
  rollSpl: any;
  ydAvail: any;
  speedBrakeEff: any;
  overspeed: any;
  confName: any;
  flapsLocked: any;
  slatsLocked: any;
  autobrakeActive: any;
  brakeSrc: any;
  brakeCmd: any;
  abInt: any;
  ra!: number;

  constructor() {
    this.type = 'a320';
    this.cfg = CFG;
    this._wind = {};
    this.lights = { beacon: true, nav: true, strobe: true, landing: false, taxi: false, logo: true, wing: false, turnoff: false };
    this.failures = { eng1: false, eng2: false, hydG: false, hydB: false, hydY: false, elec: false };
    this.eng = [new Engine(0), new Engine(1)];
    this.reset({});
  }

  reset(o: any) {
    this.pos = new V3(o.n || 0, o.e || 0, -(o.alt || 0));
    this.vel = new V3(o.u || 0, 0, o.w || 0);
    this.omega = new V3();
    this.q = Quat.fromEuler(0, o.theta || 0, (o.hdg || 0) * DEG);
    this.ctl = {
      stickPitch: 0, stickRoll: 0, rudder: 0, tiller: 0,
      tla: [0, 0],
      flapLever: o.flaps || 0,
      speedBrake: 0, spoilersArmed: false,
      gearLever: o.gearDown === false ? 'UP' : 'DOWN',
      brakeL: 0, brakeR: 0, parkingBrake: !!o.parkingBrake,
      autobrake: 'OFF',
      trimCmd: 0,
      gravityExt: false,
    };
    this.conf = CONF[this.ctl.flapLever];
    this.slat = this.conf.slat;
    this.flap = this.conf.flap;
    this.flapDeg = this.flap;
    this.gearPos = this.ctl.gearLever === 'DOWN' ? 1 : 0;
    this.ths = o.ths != null ? o.ths : 1.0;
    this.surf = { elev: 0, ail: 0, spl: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], rud: 0, gndSpl: 0 };
    this.fbw = { elevInt: 0, bankHold: 0, bankHeld: false, law: 'NORMAL', lastStickRoll: 0, pitchTrimAvail: true };
    this.apCmd = null;
    this.fuelKg = o.fuel != null ? o.fuel : 8000;
    this.zfw = o.zfw != null ? o.zfw : 58000;
    const run = o.enginesRunning !== false;
    this.eng.forEach((e) => e.reset(run));
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
    this.stall = 0;
    this.stallWarn = false;
    this.buffet = 0;
    this.gload = 1;
    this.specForce = new V3(0, 0, -G);
    this.maxG = 1;
    this.t = 0;
    this.touchdown = null;
    this.touchEvent = 0;
    this.skid = 0;
    this.rough = 0;
    this.agl = 0;
    this.windNED = { n: 0, e: 0, d: 0 };
    this.cloud = 0;
    this.ice = 0;
    this.carbIce = 0;
    this.mach = 0;
    this.env = null;
    this.velNED = new V3();
    this.brakeTemp = [60, 60, 60, 60];
    this.accum = 3000;
    this.tailStrike = false;
    this.updateDerived();
  }

  get mass(): number { return this.zfw + this.fuelKg; }
  get fuel(): number[] { return [this.fuelKg / 2, this.fuelKg / 2]; }
  hasPower(): boolean { return this.sys ? this.sys.elec.acPowered : true; }
  hyd(sysName: string): boolean { return this.sys ? this.sys.hyd[sysName].press > 1450 : true; }

  liftCurve(alpha: number, slat: number, flap: number, M: number): any {
    const cl0 = 0.24 + 0.05 * (slat / 27) + 0.95 * Math.pow(flap / 40, 0.85);
    let clmax = 1.52 + 0.55 * (slat / 27) + 0.68 * (flap / 40);
    clmax *= 1 - 0.55 * Math.max(0, M - 0.3);
    const a = 5.3 / Math.sqrt(1 - Math.pow(Math.min(M, 0.88) * 0.8, 2));
    const D = 4 * DEG;
    const as = (clmax - cl0) / a + D / 2;
    const an = (-0.9 - cl0) / a - D / 2;
    const plate = 1.1 * Math.sin(2 * alpha);
    let cl: number, stall = 0;
    if (alpha <= as - D && alpha >= an) cl = cl0 + a * alpha;
    else if (alpha > as - D && alpha <= as) cl = clmax - (a / (2 * D)) * (as - alpha) ** 2;
    else if (alpha > as) {
      const d = alpha - as;
      cl = d < 0.1 ? clmax * (1 - 0.3 * Math.sin((Math.PI / 2) * (d / 0.1))) : lerp(0.7 * clmax, plate, smoothstep(0, 0.3, d - 0.1));
      stall = smoothstep(-0.5 * DEG, 3 * DEG, d);
    } else {
      const d = an - alpha;
      cl = lerp(cl0 + a * an, plate, smoothstep(0, 0.3, d));
      stall = smoothstep(0, 3 * DEG, d);
    }
    return { cl, stall, as, cl0, clmax, a };
  }

  speeds(confIdx?: any): any {
    const m = this.mass;
    const c = confIdx == null ? this.conf : confIdx === '1+F' ? CONF1F : CONF[confIdx];
    const clmax = 1.52 + 0.55 * (c.slat / 27) + 0.68 * (c.flap / 40);
    const vs1g = Math.sqrt((2 * m * G) / (1.225 * this.cfg.S * clmax)) / KT;
    const vls = 1.23 * vs1g * (c.flap === 0 && c.slat === 0 ? 1.08 : 1);
    const clm0 = 1.52;
    const vsClean = Math.sqrt((2 * m * G) / (1.225 * this.cfg.S * clm0)) / KT;
    const greenDot = 2 * (m / 1000) + 85;
    return { vs1g, vls, alphaProtV: vs1g * 1.12, alphaMaxV: vs1g * 1.03, vfe: c.vfe, greenDot, S: 1.23 * 1.2 * vsClean * 0.93, F: 1.23 * vsClean * 1.03 * 0.93 };
  }

  thrustAvail(atm: any, M: number): number {
    return this.cfg.T0 * Math.pow(atm.sigma, 0.85) * (1 - 0.95 * M + 0.9 * M * M);
  }
  ratingFrac(tla: number, flexTemp: number | null, oat: number): number {
    if (tla <= 0) return 0;
    if (tla <= 25) return (tla / 25) * 0.87;
    if (tla <= 35) {
      const mct = flexTemp && flexTemp > oat ? clamp(1 - 0.009 * (flexTemp - oat), 0.72, 0.94) : 0.94;
      return lerp(0.87, mct, (tla - 25) / 10);
    }
    return lerp(0.94, 1.0, (tla - 35) / 10);
  }

  engineStep(dt: number, atm: any, M: number, V: number): any {
    const sys = this.sys;
    const oat = atm.tempC;
    const Tav = this.thrustAvail(atm, M);
    let total = 0, yaw = 0, pitch = 0;
    const approachIdle = this.flap > 0 && !this.onGround;
    for (const e of this.eng) {
      const i = e.i;
      const master = sys ? sys.eng.master[i] : true;
      const fuelOK = this.fuelKg > 1 && !e.failed && master;
      const tla = this.ctl.tla[i];
      if (!e.running) {
        const bleed = sys ? sys.bleedPress >= 25 : true;
        const modeStart = sys ? sys.eng.mode === 'IGN' : true;
        if (master && modeStart && bleed && e.phase !== 'FAULT' && !e.failed) {
          e.startValve = e.n2 < 50;
          e.phase = e.n2 < 16 ? 'CRANK' : 'LIGHT';
          const drive = e.n2 < 50 ? 1.6 : 0;
          e.n2 += (drive + (e.phase === 'LIGHT' ? 0.9 : 0)) * dt;
          e.ign = e.n2 > 16;
          if (e.n2 >= 58) {
            e.running = true;
            e.phase = 'RUN';
            e.startValve = false;
            e.ign = false;
          }
        } else {
          e.startValve = false;
          e.ign = false;
          const wm = clamp(V / 12, 0, 22);
          e.n2 += (wm * 0.9 - e.n2) * lagK(dt, 8);
          if (e.phase !== 'FAULT') e.phase = e.n2 > 1 ? 'SPOOL' : 'OFF';
        }
        const lit = e.phase === 'LIGHT';
        e.n1 += ((lit ? (e.n2 - 16) * 0.45 : clamp(V / 15, 0, 14)) - e.n1) * lagK(dt, 3);
        e.egt += ((lit ? oat + 150 + (e.n2 - 16) * 9 * (e.n2 < 40 ? 1.4 : 0.8) : oat) - e.egt) * lagK(dt, lit ? 2 : 20);
        e.ff = lit ? 120 + (e.n2 - 16) * 6 : 0;
        e.thrust = -0.0006 * this.qbar * (e.n1 < 5 ? 1 : 0.5) * 1.5;
        if (!fuelOK && e.running) e.running = false;
      } else {
        if (!fuelOK) {
          e.running = false;
          e.phase = 'SPOOL';
          continue;
        }
        const idleN1 = (approachIdle ? 29 : 19.5) + 3 * (1 - atm.sigma);
        let frac: number;
        if (tla < -1 && this.onGround) {
          e.rev = Math.min(1, e.rev + dt / 1.8);
          frac = clamp((-tla / 20) * 0.75, 0, 0.75) * e.rev;
        } else {
          e.rev = Math.max(0, e.rev - dt / 2);
          frac = this.athrFrac != null && this.athrActive && tla > 0 && tla <= 35.5
            ? Math.min(this.athrFrac, this.ratingFrac(tla, sys && sys.flexTemp, oat))
            : this.ratingFrac(Math.max(tla, 0), sys && sys.flexTemp, oat);
          if (this.alphaFloor) frac = 1;
        }
        const n1cmd = clamp(idleN1 + (100.5 - idleN1) * Math.pow(frac, 1 / 1.8), idleN1, 104);
        e.n1cmd = n1cmd;
        const tau = e.n1 < 45 ? 2.6 : 1.1;
        const d = (n1cmd - e.n1) / tau;
        e.n1 += clamp(d, -12, 10) * dt;
        e.n2 = 58 + 0.43 * e.n1;
        const f = clamp((e.n1 - idleN1 + 0.3) / (100.5 - idleN1), 0, 1.1);
        const idleT = 2400 * atm.sigma * Math.max(0, 1 - M * 1.3);
        let T = Tav * Math.pow(f, 1.8) + idleT;
        if (e.rev > 0.05) T = -T * 0.5 * e.rev;
        e.thrust = T;
        e.egt += (oat + 390 + 4.6 * e.n1 - e.egt) * lagK(dt, 3);
        const tsfc = 0.036 + 0.028 * M;
        e.ff = Math.max(300, Math.abs(T) * tsfc);
        e.oilP += (20 + e.n2 * 0.55 - e.oilP) * lagK(dt, 2);
        e.oilT += (60 + e.n1 * 0.6 - e.oilT) * lagK(dt, 60);
      }
      if (!e.running && e.phase === 'RUN') e.phase = 'SPOOL';
      e.fuelUsed += (e.ff / 3600) * dt;
      this.fuelKg = Math.max(0, this.fuelKg - (e.ff / 3600) * dt);
      total += e.thrust;
      const y = i === 0 ? -this.cfg.engY : this.cfg.engY;
      yaw += -y * e.thrust;
      pitch += this.cfg.engZ * e.thrust;
    }
    return { T: total, N: yaw, M: pitch };
  }

  flightLaws(dt: number, V: number, qbar: number): any {
    const c = this.ctl, F = this.fbw;
    const hG = this.hyd('G'), hB = this.hyd('B'), hY = this.hyd('Y');
    const nHyd = (hG ? 1 : 0) + (hB ? 1 : 0) + (hY ? 1 : 0);
    let law = 'NORMAL';
    if (nHyd <= 1 || (this.sys && this.sys.forceAltn)) law = 'ALTN';
    if (law === 'ALTN' && this.gearPos > 0.9 && !this.onGround) law = 'DIRECT';
    if (nHyd === 0) law = 'MECH';
    F.law = law;
    F.pitchTrimAvail = hG || hY;
    const e = this.q.toEuler();
    const phi = e.phi, theta = e.theta;
    const p = this.omega.x, q = this.omega.y, r = this.omega.z;
    const nz = this.gload;
    const flaps = this.flap > 0 || this.slat > 0;
    const alphaMax = this.stallAngle - 0.5 * DEG;
    const alphaProt = alphaMax - 3 * DEG;
    this.alphaProt = alphaProt;
    this.alphaMax = alphaMax;
    const ap = this.apCmd;
    const onGnd = this.onGround && this.gearContact[1] && this.gearContact[2];
    const auth = { elev: (hB || hG ? 0.5 : 0) + (hY || hB ? 0.5 : 0), ail: hG || hB ? 1 : 0, rud: nHyd > 0 ? 1 : 0 };
    this.auth = auth;

    let elev = 0;
    const sp = c.stickPitch;
    if (onGnd || law === 'DIRECT' || law === 'MECH' || (V < 40 && this.onGround)) {
      const max = sp >= 0 ? 30 * DEG : 17 * DEG;
      elev = sp * max * (law === 'DIRECT' ? 0.85 : onGnd ? 0.55 : 1) - (onGnd ? 0.25 * q : 0);
      F.elevInt = 0;
      if (onGnd) F.flightPathHold = false;
    } else {
      const cosFactor = Math.cos(theta) / Math.max(Math.cos(phi), 0.45);
      const turnComp = Math.abs(phi) < 33 * DEG ? cosFactor : Math.cos(theta);
      let dn: number;
      if (ap && law === 'NORMAL') dn = ap.dnz;
      else dn = sp >= 0 ? sp * (flaps ? 1.0 : 1.5) : sp * (flaps ? 1.0 : 2.0);
      const gam = Math.asin(clamp(this.vs / Math.max(V, 30), -1, 1));
      const turnC = Math.cos(gam) / (Math.abs(phi) < 33 * DEG ? Math.max(Math.cos(phi), 0.45) : 1);
      if (ap || Math.abs(sp) > 0.03) F.pathHeld = false;
      else if (!F.pathHeld) {
        F.pathHeld = true;
        F.gammaRef = gam;
      }
      if (Math.abs(phi) > 33 * DEG && F.pathHeld) F.gammaRef = gam;
      let nzCmd = turnC + dn + (F.pathHeld ? clamp(2.5 * (F.gammaRef - gam), -0.3, 0.3) : 0);
      void turnComp;
      if (law === 'NORMAL') {
        const thMax = (this.ctl.flapLever === 4 ? 25 : 30) * DEG;
        if (theta > thMax - 5 * DEG && nzCmd > 1) nzCmd = lerp(nzCmd, 1 * Math.cos(theta) - 0.3, smoothstep(thMax - 5 * DEG, thMax, theta));
        if (theta < -10 * DEG && nzCmd < 1) nzCmd = lerp(nzCmd, 1.25, smoothstep(-10 * DEG, -15 * DEG, theta));
        if (this.alpha > alphaProt - 1 * DEG) {
          const aCmd = alphaProt + Math.max(0, sp) * (alphaMax - alphaProt) - (sp < 0 ? 3 * DEG : 0);
          const lim = nz + 9 * (aCmd - this.alpha) - 1.5 * q;
          if (lim < nzCmd) nzCmd = lim;
          this.protActive = 'ALPHA';
        } else this.protActive = null;
        const vmo = this.mach > 0.6 ? null : 350;
        const cas = this.ias;
        if ((cas > 356 || this.mach > 0.83) && sp <= 0.2) nzCmd = Math.max(nzCmd, 1.0 + 0.04 * (cas - 356) + 8 * Math.max(0, this.mach - 0.83));
        void vmo;
        nzCmd = clamp(nzCmd, flaps ? 0 : -1, flaps ? 2.0 : 2.5);
      } else {
        nzCmd = clamp(nzCmd, -1, 2.5);
        this.protActive = null;
      }
      this.nzCmd = nzCmd;
      const err = nzCmd - nz;
      const vScale = clamp(160 / Math.max(V / KT, 90), 0.4, 1.6);
      const K = FBW_GAINS || { i: 0.2, p: 0.1, q: 0.6 };
      F.elevInt = clamp(F.elevInt + err * K.i * vScale * dt, -30 * DEG, 30 * DEG);
      elev = F.elevInt + (K.p * err - K.q * q) * vScale;
      if (F.pitchTrimAvail && law !== 'DIRECT' && !NO_TRIM) {
        const rate = clamp(elev * RAD * 0.25, -0.3, 0.3) * (hG && hY ? 1 : 0.5);
        if (Math.abs(nz - 1) < 1.3 && Math.abs(phi) < 33 * DEG) {
          this.ths = clamp(this.ths + rate * dt, -4, 13.5);
          F.elevInt -= rate * dt * DEG * 2.0;
        }
      }
    }
    if (c.trimCmd && F.pitchTrimAvail && (law === 'DIRECT' || onGnd || law === 'MECH')) this.ths = clamp(this.ths + c.trimCmd * 0.5 * dt, -4, 13.5);
    elev = clamp(elev, -17 * DEG, 30 * DEG);
    const elevTarget = elev * auth.elev;
    this.surf.elev += clamp(elevTarget - this.surf.elev, -30 * DEG * dt, 30 * DEG * dt);

    const sr = c.stickRoll;
    let rollCmd = 0;
    if (onGnd || law === 'DIRECT' || law === 'ALTN' || law === 'MECH') {
      rollCmd = sr * (law === 'NORMAL' ? 1 : 0.8);
      F.bankHeld = false;
    } else {
      let pCmd: number;
      if (ap) {
        pCmd = clamp(0.9 * (ap.bank - phi), -6 * DEG, 6 * DEG);
        F.bankHeld = false;
      } else if (Math.abs(sr) > 0.04) {
        pCmd = sr * 15 * DEG;
        F.bankHeld = false;
      } else {
        if (!F.bankHeld) {
          F.bankHold = Math.abs(phi) > 33 * DEG ? Math.sign(phi) * 33 * DEG : phi;
          F.bankHeld = true;
        }
        if (Math.abs(F.bankHold) > 33 * DEG) F.bankHold = Math.sign(F.bankHold) * 33 * DEG;
        pCmd = clamp(1.2 * (F.bankHold - phi), -5 * DEG, 5 * DEG);
      }
      const bankLim = this.protActive ? 45 * DEG : 67 * DEG;
      if (phi > bankLim - 5 * DEG && pCmd > 0) pCmd *= smoothstep(bankLim, bankLim - 5 * DEG, phi);
      if (phi < -bankLim + 5 * DEG && pCmd < 0) pCmd *= smoothstep(-bankLim, -bankLim + 5 * DEG, phi);
      const vScale = clamp(150 / Math.max(V / KT, 90), 0.35, 1.6);
      rollCmd = clamp((pCmd - p) * 5.5 * vScale, -1, 1);
    }
    this.surf.ail += clamp(rollCmd * auth.ail - this.surf.ail, -2.5 * dt, 2.5 * dt);
    const splHyd = [hG, hY, hB, hY, hG];
    this.splAvail = splHyd;
    this.rollSpl = this.surf.ail;

    const ydAvail = (hG || hY) && law !== 'MECH';
    let yd = 0;
    if (ydAvail && !onGnd && V > 30) {
      const rCoord = (G * Math.tan(phi)) / Math.max(V, 50);
      yd = clamp(3.0 * this.beta + 1.2 * (rCoord - r) * (law === 'NORMAL' ? 1 : 0.4), -0.3, 0.3);
    }
    const rudLim = clamp(30 - Math.max(0, this.ias - 160) * 0.12, 3.4, 30) / 30;
    const rud = clamp(c.rudder * rudLim + yd, -1, 1) * auth.rud;
    this.surf.rud += clamp(rud - this.surf.rud, -2 * dt, 2 * dt);
    this.ydAvail = ydAvail;
    return { elev: this.surf.elev, ail: this.surf.ail, rud: this.surf.rud };
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
    const ms = m / c.refMass;
    const Ixx = c.Ixx * ms, Iyy = c.Iyy * ms, Izz = c.Izz * ms;

    const hG = this.hyd('G'), hB = this.hyd('B'), hY = this.hyd('Y');
    let tgt: any = CONF[ctl.flapLever];
    if (ctl.flapLever === 1 && (this.onGround || (this.ias < 100 && this.flap > 5)) && this.ias < 210) tgt = CONF1F;
    this.confName = tgt.name;
    const slatRate = ((hB ? 0.5 : 0) + (hG ? 0.5 : 0)) * 1.6,
      flapRate = ((hG ? 0.5 : 0) + (hY ? 0.5 : 0)) * 1.4;
    this.slat += clamp(tgt.slat - this.slat, -slatRate * dt, slatRate * dt);
    this.flap += clamp(tgt.flap - this.flap, -flapRate * dt, flapRate * dt);
    this.flapDeg = this.flap;
    this.flapsLocked = flapRate === 0;
    this.slatsLocked = slatRate === 0;
    this.conf = CONF[ctl.flapLever];
    if (ctl.gearLever === 'DOWN') {
      if (hG) this.gearPos = Math.min(1, this.gearPos + dt / 10);
      else if (ctl.gravityExt) this.gearPos = Math.min(1, this.gearPos + dt / 25);
    } else if (hG && !this.onGround) this.gearPos = Math.max(0, this.gearPos - dt / 10);
    const gearDown = this.gearPos > 0.99;

    const wind = W.step(dt, pos, this.agl, this.tas, TER, this._wind);
    this.windNED = wind;
    this.cloud = wind.cloud;
    const windB = q.invRotate(tA.set(wind.n, wind.e, wind.d), tB);
    const ua = v.x - windB.x, va = v.y - windB.y, wa = v.z - windB.z;
    const V = Math.sqrt(ua * ua + va * va + wa * wa);
    this.tas = V;
    this.mach = V / atm.a;
    const M = this.mach;
    let alpha = 0, beta = 0;
    if (V > 2) {
      alpha = Math.atan2(wa, ua);
      beta = Math.asin(clamp(va / V, -1, 1));
    }
    const blend = smoothstep(2, 15, V);
    const aDotRaw = clamp((alpha - this.prevAlpha) / dt, -2, 2) * blend;
    this.alphaDot += (aDotRaw - this.alphaDot) * lagK(dt, 0.08);
    this.prevAlpha = alpha;
    this.alpha = alpha;
    this.beta = beta;
    const qbar = 0.5 * rho * V * V;
    this.qbar = qbar;
    const pt = atm.p * Math.pow(1 + 0.2 * M * M, 3.5);
    const qc = pt - atm.p;
    this.ias = 661.47 * Math.sqrt(5 * (Math.pow(qc / 101325 + 1, 0.2857) - 1));
    const p = w.x - wind.p * blend, qq = w.y - wind.q * blend, r = w.z - wind.r * blend;

    const lc = this.liftCurve(alpha, this.slat, this.flap, M);
    this.stallAngle = lc.as;
    this.stall = lc.stall * blend;
    const laws = this.flightLaws(dt, V, qbar);
    this.stallWarn = this.fbw.law !== 'NORMAL' && !this.onGround && alpha > lc.as - 1.5 * DEG && V > 30;
    this.buffet = clamp(this.stall * 1.2 + smoothstep(lc.as - 2 * DEG, lc.as, alpha) * 0.4 + Math.max(0, M - 0.84) * 20, 0, 1) * blend;

    const splOK = this.splAvail || [true, true, true, true, true];
    const nAvail = splOK.filter(Boolean).length / 5;
    const sbAvail = (splOK[1] ? 1 : 0) + (splOK[2] ? 1 : 0) + (splOK[3] ? 1 : 0);
    let sbCmd = clamp(ctl.speedBrake, 0, 1) * (this.flap >= 20 ? 0 : 1);
    const anyRev = ctl.tla[0] < -1 || ctl.tla[1] < -1;
    const idle = ctl.tla[0] < 2 && ctl.tla[1] < 2;
    const gs = this.onGround && V > 20 && ((ctl.spoilersArmed && idle) || anyRev);
    this.surf.gndSpl += clamp((gs ? 1 : 0) - this.surf.gndSpl, -dt, dt * 2);
    const sbEff = (sbCmd * sbAvail) / 3;
    this.speedBrakeEff = sbEff;
    const gndSplEff = this.surf.gndSpl * nAvail;
    for (let k = 0; k < 5; k++) {
      const roll = Math.max(0, -this.rollSpl) * 35;
      const rollR = Math.max(0, this.rollSpl) * 35;
      const base = Math.max(k >= 1 && k <= 3 ? sbCmd * 40 : 0, this.surf.gndSpl * 50);
      this.surf.spl[k] = splOK[k] ? Math.min(50, base + (k > 0 ? roll : 0)) : 0;
      this.surf.spl[k + 5] = splOK[k] ? Math.min(50, base + (k > 0 ? rollR : 0)) : 0;
    }

    const hw = Math.max(this.agl - 1.5, 0.5) / c.b;
    const x16 = 16 * hw;
    const phiGE = (x16 * x16) / (1 + x16 * x16);
    let CL = lc.cl * (1 + 0.12 * (1 - phiGE)) - 0.35 * sbEff * Math.max(lc.cl, 0) * 0.3 - gndSplEff * 0.7 * Math.max(lc.cl, 0);
    const de = laws.elev, daRoll = laws.ail, dr = laws.rud * 30 * DEG;
    const ths = this.ths * DEG;
    CL += 0.35 * de * 0.3;
    const CDi = 0.043 * CL * CL * phiGE;
    let CD = 0.0195 + CDi + 0.012 * (this.slat / 27) + 0.075 * Math.pow(this.flap / 40, 1.3) + 0.019 * this.gearPos + 0.03 * sbEff + 0.09 * gndSplEff + 0.4 * beta * beta;
    if (M > 0.74) CD += 22 * Math.pow(M - 0.74, 3) + (M > 0.8 ? 0.4 * (M - 0.8) ** 2 : 0);
    CD = Math.max(CD, 0.02 + 1.2 * Math.sin(alpha) ** 2);
    const qS = qbar * c.S, qrate = 0.25 * rho * V * c.S;
    const Lift = qS * CL + qrate * c.c * (4.5 * qq + 1.5 * this.alphaDot);
    const Drag = qS * CD;
    const Side = qS * (-1.0 * beta - 0.25 * (dr / (30 * DEG)) * 0.6) + qrate * c.b * (0.1 * r);
    let Fx = 0, Fy = 0, Fz = 0;
    if (V > 0.1) {
      const iv = 1 / V, sa = Math.sin(alpha), ca = Math.cos(alpha);
      Fx = -Drag * ua * iv + Lift * sa;
      Fy = -Drag * va * iv + Side;
      Fz = -Drag * wa * iv - Lift * ca;
    }
    const E = this.engineStep(dt, atm, M, V);
    Fx += E.T;
    const st = this.stall;
    const phat = (p * c.b) / (2 * Math.max(V, 20));
    const rollDamp = -0.42 * (phat - 1.2 * st * 0.08 * Math.tanh(phat / 0.08));
    const rollCtl = 0.11 * daRoll * (this.auth ? Math.max(this.auth.ail, 0.3) : 1) * 1.0 + 0.07 * daRoll * nAvail;
    const Cl = -0.12 * beta + rollCtl + rollDamp - 0.01 * (dr / (30 * DEG));
    let Lm = qS * c.b * Cl + qrate * c.b * c.b * 0.14 * r;
    const aS = alpha - lc.as;
    let Cm = 0.02 - 1.1 * Math.sin(alpha) - 0.3 * (this.flap / 40) - 0.05 * (1 - phiGE) + 2.6 * ths + 1.3 * de - 0.04 * sbEff;
    if (aS > 0) Cm -= 1.0 * Math.min(aS, 0.5);
    let Mm = qS * c.c * Cm + qrate * c.c * c.c * (-28 * qq - 9 * this.alphaDot) + E.M;
    const Cn = 0.15 * beta + 0.11 * (dr / (30 * DEG)) * 0.6 - 0.004 * daRoll;
    let Nm = qS * c.b * Cn + qrate * c.b * c.b * (-0.04 * p - 0.22 * r) + E.N;

    const grav = q.invRotate(tA.set(0, 0, m * G), tC);
    let FxT = Fx + grav.x, FyT = Fy + grav.y, FzT = Fz + grav.z;
    const gnd = this.groundForces(dt, TER, m, gearDown);
    if (this.crashed) return;
    FxT += gnd.F.x; FyT += gnd.F.y; FzT += gnd.F.z;
    Lm += gnd.M.x; Mm += gnd.M.y; Nm += gnd.M.z;

    this.specForce.set((FxT - grav.x) / m, (FyT - grav.y) / m, (FzT - grav.z) / m);
    this.gload = -this.specForce.z / G;
    if (Math.abs(this.gload) > this.maxG) this.maxG = Math.abs(this.gload);
    if (this.gload > 3.75 || this.gload < -1.5) return this.crash('Structural failure: G limit exceeded (' + this.gload.toFixed(1) + ' G)');
    if (this.ias > 420 || M > 0.92) return this.crash('Structural failure: overspeed (flutter)');
    const vfe = this.flap > 1 || this.slat > 1 ? tgt.vfe : 999;
    this.overspeed = this.ias > (this.flap > 1 || this.slat > 1 ? vfe + 4 : 354) || M > 0.824 || (this.gearPos > 0.05 && this.ias > 284);

    v.x += (FxT / m + r * v.y - qq * v.z) * dt;
    v.y += (FyT / m + p * v.z - r * v.x) * dt;
    v.z += (FzT / m + qq * v.x - p * v.y) * dt;
    const P = w.x, Q = w.y, R = w.z;
    w.x += ((Lm - (Izz - Iyy) * Q * R) / Ixx) * dt;
    w.y += ((Mm - (Ixx - Izz) * P * R) / Iyy) * dt;
    w.z += ((Nm - (Iyy - Ixx) * P * Q) / Izz) * dt;
    q.integrate(w.x, w.y, w.z, dt);
    const vn = q.rotate(v, tA);
    pos.x += vn.x * dt; pos.y += vn.y * dt; pos.z += vn.z * dt;
    this.velNED.copy(vn);
    this.warnTimer -= dt;
    if (this.warnTimer <= 0) this.warning = null;
    this.updateDerived();
  }

  warn(msg: string) { this.warning = msg; this.warnTimer = 3; }
  crash(reason: string) {
    this.crashed = reason;
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.eng.forEach((e) => { e.running = false; e.n1 = e.n2 = 0; });
  }

  groundForces(dt: number, TER: any, m: number, gearDown: boolean): any {
    const c = this.cfg, q = this.q, pos = this.pos, v = this.vel, w = this.omega, ctl = this.ctl;
    const F = new V3(), M = new V3();
    let any = false;
    const rB = new V3(), vB = new V3();
    const hG = this.hyd('G'), hY = this.hyd('Y');
    let pedal = Math.max(ctl.brakeL, ctl.brakeR);
    let abDecel = 0;
    if (this.autobrakeActive) abDecel = ({ LO: 1.7, MED: 3.0, MAX: 6.0 } as any)[ctl.autobrake] || 0;
    const brakeSrc = hG ? 'NORM' : hY ? 'ALTN' : this.accum > 1000 ? 'ACCU' : 'NONE';
    this.brakeSrc = brakeSrc;
    if (brakeSrc === 'ACCU' && pedal > 0.05) this.accum = Math.max(0, this.accum - pedal * 70 * dt);
    if (brakeSrc === 'NONE') pedal = 0;
    if (ctl.parkingBrake && (hY || this.accum > 500)) pedal = 1;
    let maxVs = 0;
    this.skid = 0;
    this.rough = 0;
    const gsSpd = Math.hypot(this.velNED.x, this.velNED.y);
    if (abDecel > 0 && this.onGround && gsSpd > 1 && brakeSrc === 'NORM') {
      const ax = -this.specForce.x;
      this.abInt = clamp((this.abInt || 0) + (abDecel - ax) * 0.15 * dt, 0, 1);
      pedal = Math.max(pedal, clamp(this.abInt + (abDecel - ax) * 0.1, 0, 1));
      if (ctl.brakeL > 0.3 || ctl.brakeR > 0.3) this.autobrakeActive = false;
    }
    this.brakeCmd = pedal;
    for (let i = 0; i < c.gear.length; i++) {
      const g = c.gear[i];
      this.gearContact[i] = false;
      this.gearForce[i] = 0;
      if (!gearDown) continue;
      rB.set(g.r[0], g.r[1], g.r[2]);
      const P = q.rotate(rB);
      const pn = pos.x + P.x, pe = pos.y + P.y;
      const gH = TER.groundHeight(pn, pe);
      const pen = pos.z + P.z + gH;
      if (pen <= 0) continue;
      vB.copy(v).add(w.cross(rB));
      const vN = q.rotate(vB);
      const cr = vN.z;
      let Fn = g.k * pen + g.c * cr * (cr > 0 ? 1 : 0.5);
      if (Fn < 0) Fn = 0;
      if (Fn > g.maxF) {
        this.crash(i === 0 ? 'Nose gear collapsed' : 'Main gear collapsed — hard landing');
        return { F, M };
      }
      any = true;
      this.gearContact[i] = true;
      this.gearForce[i] = Fn;
      if (cr > maxVs) maxVs = cr;
      let steer = 0;
      if (g.steer && hY) {
        const spd = gsSpd / KT;
        const maxS = lerp(75, 6, smoothstep(10, 80, spd));
        steer = clamp(ctl.rudder + ctl.tiller, -1, 1) * maxS * DEG;
      }
      const dN = q.rotate(new V3(Math.cos(steer), Math.sin(steer), 0));
      let hx = dN.x, hy = dN.y;
      const hl = Math.hypot(hx, hy) || 1;
      hx /= hl; hy /= hl;
      const vl = vN.x * hx + vN.y * hy, vs = -vN.x * hy + vN.y * hx;
      const brake = g.brake ? pedal : 0;
      const muB = 0.46 * brake;
      let fl = -(0.012 + muB) * Fn * Math.tanh(vl / 0.08);
      const slip = Math.atan2(vs, Math.max(Math.abs(vl), 1.5));
      let fs = -0.8 * Fn * Math.tanh(slip / 0.08);
      const lim = 0.85 * Fn;
      const tot = Math.hypot(fl, fs);
      if (tot > lim) { fl *= lim / tot; fs *= lim / tot; }
      if (g.brake && brake > 0.05 && Math.abs(vl) > 1) {
        const k = i === 1 ? [0, 1] : [2, 3];
        for (const j of k) this.brakeTemp[j] += (Math.abs(fl * vl) / 2) * dt * 0.00003;
      }
      if (Math.abs(vs) > 2 && Fn > 1e5) this.skid = Math.max(this.skid, clamp(Math.abs(vs) / 8, 0, 1));
      const fn_ = fl * hx - fs * hy, fe = fl * hy + fs * hx;
      const fb = q.invRotate(tA.set(fn_, fe, -Fn), tB);
      F.add(fb);
      M.add(rB.cross(fb));
    }
    for (let j = 0; j < 4; j++) this.brakeTemp[j] += (this.atm.tempC + 20 - this.brakeTemp[j]) * lagK(dt, 900);
    for (const h of c.hard) {
      rB.set(h.r[0], h.r[1], h.r[2]);
      const P = q.rotate(rB);
      const gH = TER.groundHeight(pos.x + P.x, pos.y + P.y);
      const pen = pos.z + P.z + gH;
      if (pen <= 0) continue;
      vB.copy(v).add(w.cross(rB));
      const vN = q.rotate(vB);
      const spd = Math.hypot(vN.x, vN.y, vN.z);
      if (h.soft && vN.z < 3 && pen < 0.4) {
        this.tailStrike = true;
        this.warn('TAIL STRIKE!');
        const Fn = 3e6 * pen + 2e5 * Math.max(vN.z, 0);
        const hs = Math.hypot(vN.x, vN.y) || 1;
        const fb = q.invRotate(tA.set((-0.4 * Fn * vN.x) / hs, (-0.4 * Fn * vN.y) / hs, -Fn), tB);
        F.add(fb); M.add(rB.cross(fb));
        any = true;
        continue;
      }
      if (spd > 2 || pen > 0.3) {
        this.crash(gearDown ? 'Collision: ' + h.name + ' struck the ground' : 'Gear-up landing: ' + h.name + ' struck the ground');
        return { F, M };
      }
    }
    if (any && !this.onGround && this.t > 0.5) {
      this.touchEvent = this.t;
      this.touchdown = { vsFpm: maxVs / U.FPM, t: this.t, pitch: this.pitch, bank: this.bank, ias: this.ias, crab: this.beta * RAD };
      if (ctl.autobrake !== 'OFF') this.autobrakeActive = true;
    }
    this.onGround = any;
    return { F, M };
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
    if (this.ias == null) this.ias = 0;
    this.ra = this.agl - 3.0;
  }

  private _wrap360(v: number): number {
    v = v % 360;
    return v < 0 ? v + 360 : v;
  }

  trim(env: any, o: any): any {
    const calmW = {
      atmosphere: (h: number) => env.weather.atmosphere(h),
      step: (_dt: number, _pos: any, _agl: number, _tas: number, _ter: any, out: any) => Object.assign(out || {}, { n: 0, e: 0, d: 0, p: 0, q: 0, r: 0, cloud: 0 }),
      precip: 0, layers: [],
    };
    const calm = { weather: calmW, terrain: env.terrain };
    const atm = env.weather.atmosphere(o.alt);
    const kcas = o.kias;
    const qc = 101325 * (Math.pow(1 + 0.2 * (kcas / 661.47) ** 2, 3.5) - 1);
    const Mv = Math.sqrt(5 * (Math.pow(qc / atm.p + 1, 0.2857) - 1));
    const tas = Mv * atm.a;
    this.reset(Object.assign({}, o, { u: tas, gearDown: o.gearDown }));
    this.ctl.flapLever = o.flaps || 0;
    const cf = CONF[this.ctl.flapLever];
    this.slat = cf.slat;
    this.flap = cf.flap;
    this.gearPos = o.gearDown ? 1 : 0;
    this.ctl.gearLever = o.gearDown ? 'DOWN' : 'UP';
    const gamma = (o.gamma || 0) * DEG;
    const hdg = (o.hdg || 0) * DEG;
    this.athrActive = true;
    this.ctl.tla = [25, 25];
    const setState = (x: number[]) => {
      this.pos.set(o.n || 0, o.e || 0, -o.alt);
      this.q = Quat.fromEuler(0, x[0] + gamma, hdg);
      this.vel.set(tas * Math.cos(x[0]), 0, tas * Math.sin(x[0]));
      this.omega.set(0, 0, 0);
      this.ths = x[1];
      this.athrFrac = clamp(x[2], 0, 0.87);
      this.prevAlpha = x[0];
      this.alphaDot = 0;
      this.fbw.elevInt = 0;
      this.surf.elev = 0;
      this.ctl.stickPitch = 0;
      this.apCmd = { dnz: 0, bank: 0 };
      this.onGround = false;
      this.crashed = null;
      for (const e of this.eng) {
        const idleN1 = 19.5 + 3 * (1 - atm.sigma) + (this.flap > 0 ? 9.5 : 0);
        e.n1 = clamp(idleN1 + (100.5 - idleN1) * Math.pow(this.athrFrac, 1 / 1.8), idleN1, 104);
        e.running = true;
        e.phase = 'RUN';
        e.n2 = 58 + 0.43 * e.n1;
      }
    };
    const resid = (x: number[]) => {
      setState(x);
      const u0 = this.vel.x, w0 = this.vel.z;
      const h = 0.002;
      this.surf.elev = 0;
      this.fbw.elevInt = 0;
      const saveLaws = this.flightLaws.bind(this);
      (this as any).flightLaws = () => ({ elev: 0, ail: 0, rud: 0 });
      this.step(h, calm);
      (this as any).flightLaws = saveLaws;
      return [(this.vel.x - u0) / h, (this.vel.z - w0) / h, (this.omega.y / h) * 20];
    };
    let x = [0.05, 1.0, 0.4];
    for (let it = 0; it < 40; it++) {
      const r0 = resid(x);
      if (Math.abs(r0[0]) + Math.abs(r0[1]) + Math.abs(r0[2]) < 1e-3) break;
      const J: number[][] = [[], [], []];
      const dx = [1e-4, 0.01, 0.002];
      for (let j = 0; j < 3; j++) {
        const xp = x.slice();
        xp[j] += dx[j];
        const rp = resid(xp);
        for (let i = 0; i < 3; i++) J[i][j] = (rp[i] - r0[i]) / dx[j];
      }
      const d = solve3(J, r0.map((v) => -v));
      if (!d) break;
      x[0] += clamp(d[0], -0.05, 0.05);
      x[1] = clamp(x[1] + clamp(d[1], -2, 2), -4, 13.5);
      x[2] = clamp(x[2] + clamp(d[2], -0.2, 0.2), 0, 0.87);
    }
    setState(x);
    this.apCmd = null;
    this.t = 0;
    this.maxG = 1;
    this.touchdown = null;
    this.onGround = false;
    this.qbar = 0.5 * atm.rho * tas * tas;
    this.ias = kcas;
    this.updateDerived();
    return { alpha: x[0] * RAD, ths: x[1], athrFrac: x[2], pitch: this.pitch * RAD, n1: this.eng[0].n1 };
  }

  placeAt(TER: any, n: number, e: number, hdg: number) {
    this.reset({ n, e, hdg, alt: 0, enginesRunning: this.eng[0].running });
    const gh = TER.groundHeight(n, e);
    this.pos.set(n, e, -(gh + 3.02));
    this.onGround = true;
    this.gearPos = 1;
    this.t = 0;
    this.updateDerived();
  }
  placeOnGround(TER: any, n: number, e: number, hdg: number) {
    return this.placeAt(TER, n, e, hdg);
  }
}
