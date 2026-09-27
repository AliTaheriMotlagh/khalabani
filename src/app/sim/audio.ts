/*
 * Procedural cockpit audio (Web Audio API): 4-cylinder engine + propeller, wind, stall warning horn,
 * marker beacon tones, tyre screech / rumble, rain on the windscreen, gear touchdown thump, AP disconnect tone.
 */
import { clamp, lagK } from '../core/math';

void lagK; // used indirectly

export class Audio {
  ctx: AudioContext | null;
  enabled: boolean;
  volume: number;
  master!: GainNode;
  engGain!: GainNode;
  engLP!: BiquadFilterNode;
  engOsc!: any[];
  chug!: OscillatorNode;
  exhGain!: GainNode;
  propOsc!: OscillatorNode;
  propGain!: GainNode;
  windBP!: BiquadFilterNode;
  windGain!: GainNode;
  rumbleGain!: GainNode;
  screechGain!: GainNode;
  rainGain!: GainNode;
  horn!: OscillatorNode;
  hornGain!: GainNode;
  mkr!: OscillatorNode;
  mkrGain!: GainNode;
  jet: any;
  crcOn!: boolean;
  crcNext!: number;
  [key: string]: any;

  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    const noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + 0.03 * w;
      d[i] = w * 0.5 + b0 * 3;
    }
    const noise = () => {
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      s.start();
      return s;
    };
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    const engLP = c.createBiquadFilter();
    engLP.type = 'lowpass';
    engLP.frequency.value = 900;
    engLP.Q.value = 0.7;
    this.engLP = engLP;
    this.engOsc = [];
    ([
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.25],
      ['sawtooth', 2, 0.18],
      ['triangle', 3, 0.1],
    ] as [OscillatorType, number, number][]).forEach(([type, mult, g]) => {
      const o = c.createOscillator();
      o.type = type;
      const gn = c.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(engLP);
      o.start();
      this.engOsc.push({ o, mult });
    });
    const exh = noise();
    const exBP = c.createBiquadFilter();
    exBP.type = 'bandpass';
    exBP.frequency.value = 180;
    exBP.Q.value = 0.8;
    this.exhGain = c.createGain();
    this.exhGain.gain.value = 0.3;
    exh.connect(exBP).connect(this.exhGain).connect(engLP);
    this.chug = c.createOscillator();
    this.chug.type = 'sine';
    const chugDepth = c.createGain();
    chugDepth.gain.value = 0.35;
    this.chug.connect(chugDepth).connect(this.engGain.gain as any);
    this.chug.start();
    engLP.connect(this.engGain).connect(this.master);
    this.propOsc = c.createOscillator();
    this.propOsc.type = 'sawtooth';
    const propBP = c.createBiquadFilter();
    propBP.type = 'bandpass';
    propBP.frequency.value = 300;
    propBP.Q.value = 1.5;
    this.propGain = c.createGain();
    this.propGain.gain.value = 0;
    this.propOsc.connect(propBP).connect(this.propGain).connect(this.master);
    this.propOsc.start();
    const wn = noise();
    this.windBP = c.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.frequency.value = 600;
    this.windBP.Q.value = 0.6;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    wn.connect(this.windBP).connect(this.windGain).connect(this.master);
    const rn = noise();
    const rLP = c.createBiquadFilter();
    rLP.type = 'lowpass';
    rLP.frequency.value = 120;
    this.rumbleGain = c.createGain();
    this.rumbleGain.gain.value = 0;
    rn.connect(rLP).connect(this.rumbleGain).connect(this.master);
    const sn = noise();
    const sBP = c.createBiquadFilter();
    sBP.type = 'bandpass';
    sBP.frequency.value = 2400;
    sBP.Q.value = 6;
    this.screechGain = c.createGain();
    this.screechGain.gain.value = 0;
    sn.connect(sBP).connect(this.screechGain).connect(this.master);
    const rain = noise();
    const rainHP = c.createBiquadFilter();
    rainHP.type = 'highpass';
    rainHP.frequency.value = 3000;
    this.rainGain = c.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainHP).connect(this.rainGain).connect(this.master);
    this.horn = c.createOscillator();
    this.horn.type = 'square';
    this.horn.frequency.value = 1550;
    const vib = c.createOscillator();
    vib.frequency.value = 22;
    const vibG = c.createGain();
    vibG.gain.value = 40;
    vib.connect(vibG).connect(this.horn.frequency as any);
    vib.start();
    const hBP = c.createBiquadFilter();
    hBP.type = 'bandpass';
    hBP.frequency.value = 1600;
    hBP.Q.value = 3;
    this.hornGain = c.createGain();
    this.hornGain.gain.value = 0;
    this.horn.connect(hBP).connect(this.hornGain).connect(this.master);
    this.horn.start();
    this.mkr = c.createOscillator();
    this.mkr.type = 'sine';
    this.mkrGain = c.createGain();
    this.mkrGain.gain.value = 0;
    this.mkr.connect(this.mkrGain).connect(this.master);
    this.mkr.start();
  }

  thump(strength: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(35, c.currentTime + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(clamp(strength, 0.05, 1) * 0.9, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + 0.4);
  }

  beep(freq: number, dur: number, vol?: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol || 0.15, c.currentTime);
    g.gain.setValueAtTime(0, c.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + dur + 0.05);
  }

  crash() {
    if (!this.ctx) return;
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.35));
    const s = c.createBufferSource();
    s.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = c.createGain();
    g.gain.value = 1.2;
    s.connect(lp).connect(g).connect(this.master);
    s.start();
  }

  update(dt: number, st: any) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const { ac, cockpit, stallHorn, marker, paused, camDist, weather } = st;
    if (this.jet) this.jet.out.gain.setTargetAtTime(0, t, 0.05), this.jet.apuG.gain.setTargetAtTime(0, t, 0.05), this.jet.apuNG.gain.setTargetAtTime(0, t, 0.05);
    const set = (param: AudioParam, v: number, tau?: number) => param.setTargetAtTime(v, t, tau || 0.05);
    this.master.gain.setTargetAtTime(this.enabled && !paused ? this.volume : 0, t, 0.05);
    const rpm = ac.eng.rpm;
    const fire = (rpm / 60) * 2;
    const att = cockpit ? 1 : clamp(40 / Math.max(camDist, 10), 0.03, 1);
    for (const e of this.engOsc) set(e.o.frequency, Math.max(fire * e.mult, 1), 0.03);
    set(this.chug.frequency, Math.max(fire / 4, 0.5), 0.03);
    const pwr = clamp(ac.eng.power / 110000, 0, 1);
    const running = ac.eng.running ? 1 : 0;
    const rough = ac.eng.rough || 0;
    set(this.engGain.gain, (running * (0.12 + 0.28 * pwr) + (rpm > 50 && !running ? 0.04 : 0)) * att * (1 - rough * 0.3 * Math.random()));
    set(this.engLP.frequency, 350 + 1400 * pwr + rpm * 0.1 + (cockpit ? 0 : 800));
    set(this.exhGain.gain, 0.2 + 0.5 * pwr);
    set(this.propOsc.frequency, Math.max((rpm / 60) * 2, 1), 0.03);
    set(this.propGain.gain, clamp(rpm / 2700, 0, 1) * 0.06 * att);
    const ias = Math.max(ac.tas || 0, 0);
    set(this.windGain.gain, clamp((ias / 60) ** 2, 0, 1.4) * 0.16 * (cockpit ? 1 : 0.5) + ac.buffet * 0.25);
    set(this.windBP.frequency, 300 + ias * 12);
    set(this.rumbleGain.gain, ac.onGround ? clamp(ac.gs / 25, 0, 1) * (0.18 + ac.rough * 0.5) * att : 0);
    set(this.screechGain.gain, ac.onGround ? ac.skid * 0.3 * att : 0);
    const rainOn = weather && weather.precip > 0.02 && weather.layers.length && ac.alt < weather.layers[0].base;
    set(this.rainGain.gain, rainOn ? weather.precip * 0.12 * (cockpit ? 1 : 0.3) : (ac.cloud > 0.3 && weather.precip > 0 ? 0.03 : 0));
    set(this.hornGain.gain, stallHorn && ac.hasPower() ? 0.07 : 0, 0.02);
    let mf = 0, on = false;
    const now = performance.now() / 1000;
    if (marker === 'OM') {
      mf = 400;
      on = now * 2 % 1 < 0.6;
    } else if (marker === 'MM') {
      mf = 1300;
      const p = (now * 1.5) % 1;
      on = p < 0.4 || (p > 0.55 && p < 0.65);
    } else if (marker === 'IM') {
      mf = 3000;
      on = now * 6 % 1 < 0.5;
    }
    if (mf) this.mkr.frequency.setValueAtTime(mf, t);
    set(this.mkrGain.gain, on ? 0.08 : 0, 0.005);
  }
}
