/*
 * Instrument systems: pitot-static, vacuum gyros, magnetic compass, turn coordinator, electrical.
 */
import { U, clamp, wrap360, wrap180, wrapPi, lagK, gauss, V3 } from './math';
const { DEG, RAD, KT, FT, FPM } = U;
const DIP = 62 * DEG;

export class Instruments {
  kollsman: number; altStatic: boolean;
  gyro!: number; suction!: number; aiPitch!: number; aiBank!: number; aiErrP!: number; aiErrR!: number;
  tumble!: number; dgDrift!: number; dgRate!: number; compass!: number; compassRate!: number;
  ias!: number; altFt!: number; altInit!: boolean; vsi!: number; prevAlt!: number | null;
  turn!: number; ball!: number; ballV!: number; tcSpin!: number;
  trappedPt!: number | null; frozenPs!: number | null;
  fuelG!: number[]; volts!: number; amps!: number; battery!: number; tach!: number; hobbs!: number;
  power!: boolean; avionicsPower!: boolean; aiFlag!: boolean; tcFlag!: boolean;
  dg!: number; pressAlt!: number; oat!: number; lowVac!: boolean; lowVolts!: boolean; oilPressLow!: boolean;
  gsKt!: number;

  constructor() {
    this.kollsman = 29.92;
    this.altStatic = false;
    this.reset(null as any);
  }

  reset(ac: any, weather?: any): void {
    this.gyro = 1; this.suction = 5;
    this.aiPitch = ac ? ac.pitch : 0; this.aiBank = ac ? ac.bank : 0;
    this.aiErrP = 0; this.aiErrR = 0; this.tumble = 0;
    this.dgDrift = (Math.random() - 0.5) * 4;
    this.dgRate = (Math.random() < 0.5 ? -1 : 1) * (0.003 + Math.random() * 0.004);
    this.compass = ac ? ac.heading : 0; this.compassRate = 0;
    this.ias = ac ? ac.ias : 0; this.altFt = 0; this.altInit = false;
    this.vsi = 0; this.prevAlt = null; this.turn = 0; this.ball = 0; this.ballV = 0; this.tcSpin = 1;
    this.trappedPt = null; this.frozenPs = null;
    this.fuelG = ac ? ac.fuel.slice() : [20, 20];
    this.volts = 28; this.amps = 0; this.battery = 1;
    this.tach = ac ? ac.eng.rpm : 0; this.hobbs = 1234.5;
    if (weather) this.kollsman = +(weather.qnh / U.HPA_PER_INHG).toFixed(2);
  }

  update(dt: number, ac: any, weather: any): void {
    if (dt <= 0) return;
    const atm = ac.atm || weather.atmosphere(ac.alt);
    const F = ac.failures;
    const altOn = ac.elec.master && ac.elec.alternator && !F.alternator && !F.electrical && ac.eng.rpm > 620;
    let load = 0;
    if (ac.elec.master && !F.electrical) {
      load = 6 + (ac.elec.avionics ? 7 : 0) + (ac.lights.landing ? 7 : 0) + (ac.lights.taxi ? 4 : 0) +
        (ac.lights.nav ? 2 : 0) + (ac.lights.strobe ? 3 : 0) + (ac.lights.beacon ? 1 : 0) +
        (ac.pitotHeat ? 10 : 0) + (ac.elec.cranking ? 120 : 0);
    }
    if (altOn) {
      this.battery = Math.min(1, this.battery + dt / 1800);
      this.volts += (28.2 - this.volts) * lagK(dt, 0.5);
      this.amps += ((this.battery < 1 ? 8 : 1.5) - this.amps) * lagK(dt, 1);
    } else if (ac.elec.master && !F.electrical) {
      this.battery = Math.max(0, this.battery - (load * dt) / (24 * 3600) / 0.8);
      const vt = 20 + 4.5 * Math.pow(this.battery, 0.3) - load * 0.01;
      this.volts += (vt - this.volts) * lagK(dt, 0.5);
      this.amps += (-load - this.amps) * lagK(dt, 1);
    } else {
      this.volts += (0 - this.volts) * lagK(dt, 0.3);
      this.amps += (0 - this.amps) * lagK(dt, 0.3);
    }
    ac.elec.volts = F.electrical ? 0 : ac.elec.master ? Math.max(this.volts, 0) : 0;
    ac.elec.battery = this.battery;
    const power = ac.hasPower();
    this.power = power; this.avionicsPower = power && ac.elec.avionics;
    const sT = F.vacuum ? 0 : clamp((ac.eng.rpm / 1000) * 4.6, 0, 5.2);
    this.suction += (sT - this.suction) * lagK(dt, 1.5);
    const gT = clamp(this.suction / 4.4, 0, 1);
    this.gyro += (gT - this.gyro) * lagK(dt, gT > this.gyro ? 40 : 150);
    const g = this.gyro;
    const healthy = g > 0.85;
    if (Math.abs(ac.pitch) > 70 * DEG || Math.abs(ac.bank) > 110 * DEG) this.tumble = Math.max(this.tumble, 1);
    if (this.tumble > 0) {
      this.tumble -= dt / 240;
      this.aiErrP += gauss() * dt * 25 * DEG * this.tumble;
      this.aiErrR += gauss() * dt * 60 * DEG * this.tumble;
    }
    if (healthy && this.tumble <= 0) {
      const k = 3 * DEG * dt / 60;
      this.aiErrP -= clamp(this.aiErrP, -k * 20, k * 20);
      this.aiErrR -= clamp(this.aiErrR, -k * 20, k * 20);
      const acc = ac.specForce.x / 9.81;
      this.aiErrP += (acc * 2 * DEG - this.aiErrP * 0) * dt * 0.2;
    } else {
      const s = 1 - g;
      this.aiErrP += (gauss() * 2.5 + 1.2) * DEG * dt * s;
      this.aiErrR += (gauss() * 4 + 2.0) * DEG * dt * s - ac.omega.x * dt * s * 0.6;
    }
    const lagT = healthy ? 0.03 : 0.3 + 6 * (1 - g);
    this.aiPitch += wrapPi(ac.pitch + this.aiErrP - this.aiPitch) * lagK(dt, lagT);
    this.aiBank += wrapPi(ac.bank + this.aiErrR - this.aiBank) * lagK(dt, lagT);
    this.aiFlag = g < 0.5;
    this.dgDrift += this.dgRate * dt + (1 - g) * (gauss() * 0.5 + 0.6) * dt * 8 + Math.abs(ac.omega.x) * dt * 0.02 * gauss();
    if (!healthy) this.dgDrift -= (ac.omega.z * RAD) * dt * (1 - g) * 0.8;
    this.dg = wrap360(ac.heading - 0 + this.dgDrift); // magVar applied externally

    const sf = ac.specForce;
    let gx = -sf.x, gy = -sf.y, gz = -sf.z;
    let gl = Math.hypot(gx, gy, gz);
    if (gl < 2) { gx = 0; gy = 0; gz = 9.81; gl = 9.81; }
    gx /= gl; gy /= gl; gz /= gl;
    const tilt = Math.acos(clamp(gz, -1, 1));
    if (tilt > 18 * DEG) {
      const s = Math.sin(18 * DEG) / Math.max(Math.hypot(gx, gy), 1e-6);
      gx *= s; gy *= s; gz = Math.cos(18 * DEG);
    }
    const mv = 0; // magVar * DEG applied externally
    const B = ac.q.invRotate(new V3(Math.cos(DIP) * Math.cos(mv), Math.cos(DIP) * Math.sin(mv), Math.sin(DIP)));
    const dotBg = B.x * gx + B.y * gy + B.z * gz;
    const bx = B.x - dotBg * gx, by = B.y - dotBg * gy, bz = B.z - dotBg * gz;
    const fx = 1 - gx * gx, fy = -gx * gy, fz = -gx * gz;
    const rx = gy * fz - gz * fy, ry = gz * fx - gx * fz, rz = gx * fy - gy * fx;
    const readRaw = Math.atan2(-(bx * rx + by * ry + bz * rz), bx * fx + by * fy + bz * fz) * RAD;
    const dev = 2.5 * Math.sin((readRaw * 2 + 30) * DEG);
    const target = wrap360(readRaw + dev);
    const wn = 2.2, zeta = 0.35;
    const err = wrap180(target - this.compass);
    this.compassRate += (wn * wn * err - 2 * zeta * wn * this.compassRate + gauss() * 6 * Math.min(ac.buffet + 0.1 * (ac.env ? ac.env.weather.lastSigma || 0 : 0), 3)) * dt;
    this.compass = wrap360(this.compass + this.compassRate * dt);

    let ps = atm.p;
    if (F.static && !this.altStatic) {
      if (this.frozenPs === null) this.frozenPs = ps;
      ps = this.frozenPs!;
    } else {
      this.frozenPs = null;
      if (this.altStatic) ps = atm.p - 55 - 0.004 * ac.qbar;
    }
    const misalign = Math.cos(clamp(ac.alpha, -1.2, 1.2)) * Math.cos(ac.beta);
    let pt = atm.p + (ac.qbar || 0) * misalign * misalign * (ac.qbar > 0 ? 1 : 0);
    const pitotBlocked = F.pitot || ac.pitotIce >= 1;
    if (pitotBlocked) {
      if (this.trappedPt === null) this.trappedPt = pt;
      pt = this.trappedPt!;
    } else this.trappedPt = null;
    if (!pitotBlocked && ac.pitotIce > 0.4) pt = ps + (pt - atm.p) * (1 - (ac.pitotIce - 0.4) * 1.5);
    const qc = Math.max(0, pt - ps);
    const iasT = Math.sqrt((2 * qc) / 1.225) / KT;
    this.ias += (iasT - this.ias) * lagK(dt, 0.25);
    const altT = (1 - Math.pow(ps / (this.kollsman * U.HPA_PER_INHG * 100), 0.190263)) * 145366.45;
    if (!this.altInit) { this.altFt = altT; this.altInit = true; }
    this.altFt += (altT - this.altFt) * lagK(dt, 0.35);
    const pAlt = (1 - Math.pow(ps / 101325, 0.190263)) * 145366.45;
    if (this.prevAlt === null) this.prevAlt = pAlt;
    const rate = ((pAlt - this.prevAlt) / dt) * 60;
    this.prevAlt = pAlt;
    this.vsi += (clamp(rate, -4000, 4000) - this.vsi) * lagK(dt, 2.2);
    this.pressAlt = pAlt;

    const tcT = power ? 1 : 0;
    this.tcSpin += (tcT - this.tcSpin) * lagK(dt, power ? 5 : 30);
    const e = ac.q.toEuler();
    const yawRateEarth = (ac.omega.z * Math.cos(e.phi) + ac.omega.y * Math.sin(e.phi)) / Math.max(Math.cos(e.theta), 0.2);
    const turnT = (yawRateEarth * 0.87 + ac.omega.x * 0.5 * 0.35) * RAD * this.tcSpin;
    this.turn += (turnT - this.turn) * lagK(dt, 0.4);
    this.tcFlag = this.tcSpin < 0.8;
    const ballT = Math.atan2(-ac.specForce.y, Math.max(-ac.specForce.z, 0.5));
    this.ballV += ((ballT - this.ball) * 40 - this.ballV * 9) * dt;
    this.ball = clamp(this.ball + this.ballV * dt, -0.35, 0.35);

    this.tach += (ac.eng.rpm + gauss() * 4 * (ac.eng.running ? 1 : 0) - this.tach) * lagK(dt, 0.2);
    if (ac.eng.running) this.hobbs += dt / 3600;
    for (let i = 0; i < 2; i++) {
      const slosh = (i === 0 ? -1 : 1) * ac.specForce.y * 0.4 + ac.specForce.x * 0.2;
      const t = this.power ? ac.fuel[i] + slosh : 0;
      this.fuelG[i] += (t - this.fuelG[i]) * lagK(dt, 2.5);
    }
    this.oat = atm.tempC;
    this.lowVac = this.suction < 3.0;
    this.lowVolts = ac.elec.master && this.volts < 24.5;
    this.oilPressLow = ac.eng.oilP < 20;
  }

  syncDG(): void {
    this.dgDrift = wrap180(this.compass - (this.dg - this.dgDrift));
  }
}
