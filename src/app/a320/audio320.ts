/*
 * A320 sounds added to the procedural audio engine: CFM56 fan/compressor whine + jet roar, APU, reverser rumble,
 * Airbus alerts (single chime, continuous repetitive chime, cavalry charge, C-chord), and spoken callouts via Web Speech API.
 */
import { Audio } from '../sim/audio';
import { clamp } from '../core/math';

// Extend the Audio prototype with A320-specific methods then export a typed class.

const proto = Audio.prototype as any;

proto.initJet = function () {
  if (!this.ctx || this.jet) return;
  const c = this.ctx;
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = () => {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  };
  const J = (this.jet = {} as any);
  J.out = c.createGain();
  J.out.gain.value = 0;
  J.out.connect(this.master);
  J.fan = c.createOscillator();
  J.fan.type = 'sawtooth';
  const fanBP = c.createBiquadFilter();
  fanBP.type = 'bandpass';
  fanBP.Q.value = 6;
  J.fanBP = fanBP;
  J.fanG = c.createGain();
  J.fan.connect(fanBP).connect(J.fanG).connect(J.out);
  J.fan.start();
  J.whine = c.createOscillator();
  J.whine.type = 'triangle';
  J.whineG = c.createGain();
  J.whine.connect(J.whineG).connect(J.out);
  J.whine.start();
  const n = noise();
  J.roarLP = c.createBiquadFilter();
  J.roarLP.type = 'lowpass';
  J.roarG = c.createGain();
  n.connect(J.roarLP).connect(J.roarG).connect(J.out);
  J.apu = c.createOscillator();
  J.apu.type = 'sine';
  J.apuG = c.createGain();
  J.apu.connect(J.apuG).connect(this.master);
  J.apu.start();
  const n2 = noise();
  J.apuHP = c.createBiquadFilter();
  J.apuHP.type = 'bandpass';
  J.apuHP.frequency.value = 3500;
  J.apuHP.Q.value = 3;
  J.apuNG = c.createGain();
  n2.connect(J.apuHP).connect(J.apuNG).connect(this.master);
  this.crcOn = false;
  this.crcNext = 0;
};

proto.jetUpdate = function (dt: number, st: any) {
  if (!this.ctx) return;
  this.initJet();
  const c = this.ctx, t = c.currentTime, J = this.jet;
  const set = (p: AudioParam, v: number, tau?: number) => p.setTargetAtTime(v, t, tau || 0.08);
  const { ac, cockpit, camDist, paused } = st;
  this.master.gain.setTargetAtTime(this.enabled && !paused ? this.volume : 0, t, 0.05);
  const n1 = Math.max(ac.eng[0].n1, ac.eng[1].n1);
  const n2 = Math.max(ac.eng[0].n2, ac.eng[1].n2);
  const att = cockpit ? 0.35 : clamp(120 / Math.max(camDist, 20), 0.03, 1.2);
  set(J.out.gain, att);
  set(J.fan.frequency, 36 * (n1 / 100) * 60, 0.1);
  set(J.fanBP.frequency, 36 * (n1 / 100) * 60, 0.1);
  set(J.fanG.gain, n1 > 5 ? 0.05 + 0.08 * (n1 / 100) : 0);
  set(J.whine.frequency, 2800 + n2 * 22, 0.1);
  set(J.whineG.gain, n2 > 10 ? 0.02 + 0.02 * (n2 / 100) : 0);
  const rev = Math.max(ac.eng[0].rev, ac.eng[1].rev);
  set(J.roarLP.frequency, 300 + n1 * 18 + rev * 400, 0.1);
  set(J.roarG.gain, (n1 / 100) ** 2 * (cockpit ? 0.35 : 0.9) + rev * 0.3);
  const apu = ac.sys ? ac.sys.apu : { n: 0 };
  set(J.apu.frequency, 60 + apu.n * 3.9, 0.2);
  set(J.apuG.gain, (apu.n / 100) * (cockpit ? 0.03 : 0.08) * (ac.onGround ? 1 : 0));
  set(J.apuNG.gain, (apu.n / 100) * (cockpit ? 0.02 : 0.06) * (ac.onGround ? 1 : 0));
  const ias = ac.tas || 0;
  set(this.windGain.gain, clamp((ias / 120) ** 2, 0, 1.4) * 0.12 * (cockpit ? 1 : 0.5) + ac.buffet * 0.25 + (ac.gearPos > 0.1 && !ac.onGround ? (ias / 150) * 0.05 : 0));
  set(this.windBP.frequency, 300 + ias * 6);
  set(this.rumbleGain.gain, ac.onGround ? clamp(ac.gs / 60, 0, 1) * 0.25 : 0);
  set(this.screechGain.gain, ac.onGround ? ac.skid * 0.3 : 0);
  set(this.engGain.gain, 0);
  set(this.propGain.gain, 0);
  set(this.hornGain.gain, 0, 0.02);
  if (this.crcOn && t > this.crcNext) {
    this.tone([1500], 0.28, 0.1, 'square');
    this.crcNext = t + 0.55;
  }
  void dt;
};

proto.tone = function (freqs: number[], dur: number, vol?: number, type?: OscillatorType, when?: number) {
  if (!this.ctx) return;
  const c = this.ctx;
  const t0 = c.currentTime + (when || 0);
  for (const f of freqs) {
    const o = c.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol || 0.1, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
};

proto.singleChime = function () {
  this.tone([1300, 1950], 0.9, 0.08, 'sine');
};

proto.cavalry = function () {
  const n = [523, 659, 784, 1047, 784, 1047];
  n.forEach((f: number, i: number) => this.tone([f], 0.16, 0.09, 'sawtooth', i * 0.13));
};

proto.cChord = function () {
  this.tone([523, 659, 784], 1.2, 0.05, 'sine');
};

proto.speak = function (text: string, opts?: any) {
  try {
    if (!(window as any).speechSynthesis || !this.enabled) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = (opts && opts.rate) || 1.15;
    u.pitch = (opts && opts.pitch) || 0.85;
    u.volume = Math.min(1, this.volume + 0.1);
    const v = speechSynthesis.getVoices().find((x) => /en[-_](US|GB)/i.test(x.lang) && /male|daniel|alex|fred/i.test(x.name)) || speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    if (opts && opts.interrupt) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (_e) {
    /* speech not available */
  }
};

export class A320Audio extends Audio {
  initJet!: () => void;
  jetUpdate!: (dt: number, st: any) => void;
  tone!: (freqs: number[], dur: number, vol?: number, type?: OscillatorType, when?: number) => void;
  singleChime!: () => void;
  cavalry!: () => void;
  cChord!: () => void;
  speak!: (text: string, opts?: any) => void;
}
