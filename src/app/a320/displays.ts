/*
 * A320 display units drawn with Canvas 2D: PFD, ND, E/WD (upper ECAM) and SD (lower ECAM, all system pages).
 * Every function takes (g, x, y, s, st) where s is the side of the square display.
 */
import { A320_CONF } from './fdm';
import { U, clamp, wrap180, wrap360 } from '../core/math';
import { AIRPORTS, mag, magVar } from '../core/world';

const { DEG, RAD, KT, FT, NM, FPM } = U;
const TAU = Math.PI * 2;
const C = {
  g: '#3dff5a', c: '#35d8ff', m: '#ff6cff', a: '#ffa21a', w: '#ffffff', r: '#ff2a2a', y: '#fff23a',
  sky: '#1f7ad8', gnd: '#7b4a22', grey: '#5c6166', dark: '#262a2e', bg: '#000000',
};
const FONT = "'Arial Narrow','Helvetica Neue',Arial,sans-serif";
function txt(g?: any, s?: any, x?: any, y?: any, size?: any, col?: any, align?: any, base?: any) {
  g.fillStyle = col || C.w;
  g.font = `${size}px ${FONT}`;
  g.textAlign = align || 'left';
  g.textBaseline = base || 'middle';
  g.fillText(s, x, y);
}
function line(g?: any, x1?: any, y1?: any, x2?: any, y2?: any, col?: any, w?: any) {
  g.strokeStyle = col;
  g.lineWidth = w || 1;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}
function rect(g?: any, x?: any, y?: any, w?: any, h?: any, col?: any, lw?: any) {
  g.strokeStyle = col;
  g.lineWidth = lw || 1;
  g.strokeRect(x, y, w, h);
}
function frame(g?: any, x?: any, y?: any, s?: any) {
  g.fillStyle = C.bg;
  g.fillRect(x, y, s, s);
  g.strokeStyle = '#1b1d20';
  g.lineWidth = 2;
  g.strokeRect(x + 1, y + 1, s - 2, s - 2);
}
const indAlt = (st?: any, side?: any) => {
  const ac = st.ac;
  const fm = st.fm;
  const std = fm.fcu.std[side || 0];
  const set = std ? 1013.25 : fm.fcu.baro[side || 0];
  const p = ac.atm ? ac.atm.p : 101325;
  return (1 - Math.pow(p / (set * 100), 0.190263)) * 145366.45;
};

// ================================================================== PFD
function drawPFD(g?: any, x0?: any, y0?: any, s?: any, st?: any) {
  const ac = st.ac,
    fm = st.fm,
    f = fm.fcu;
  frame(g, x0, y0, s);
  if (!st.powered) return;
  g.save();
  g.translate(x0, y0);
  const fs = s * 0.042;
  // ---------------- FMA
  const fma = fm.fma();
  for (let i = 1; i < 5; i++) line(g, s * 0.2 * i, s * 0.01, s * 0.2 * i, s * 0.1, '#777', 1);
  const col5 = (t?: any, i?: any, r?: any, c?: any, box?: any) => {
    if (!t) return;
    const lines = t.split('\n');
    lines.forEach((l?: any, k?: any) => txt(g, l, s * 0.2 * i + s * 0.1, s * (0.032 + (r + k) * 0.033), fs * 0.95, c, 'center'));
    if (box) rect(g, s * 0.2 * i + s * 0.02, s * 0.012, s * 0.16, s * 0.04, C.w, 1);
  };
  col5(fma.athr, 0, 0, fm.lvrClb ? C.w : fma.athrColor === 'amber' ? C.a : fma.athrColor === 'white' ? C.w : C.g, fm.lvrClb && (Date.now() / 300) % 2 < 1);
  col5(fma.vert, 1, 0, C.g, fm.vertBoxT > 0);
  col5(fma.vertArmed, 1, 1, fma.vertArmed.includes('G/S') ? C.c : C.c);
  col5(fma.lat, 2, 0, C.g);
  col5(fma.latArmed, 2, 1, C.c);
  col5(fma.cat, 3, 0, C.w);
  col5(fma.dh, 3, 2, C.w);
  col5(fma.ap, 4, 0, C.w);
  col5(fma.fd, 4, 1, C.w);
  col5(fma.athrEng, 4, 2, fma.athrArmedOnly ? C.c : C.w);
  // messages on FMA third line
  let msg = '';
  let msgCol = C.a;
  if (ac.fbw.law === 'DIRECT') {
    msg = ac.fbw.pitchTrimAvail ? 'USE MAN PITCH TRIM' : 'MAN PITCH TRIM ONLY';
    msgCol = ac.fbw.pitchTrimAvail ? C.a : C.r;
  }
  if (st.tcas && st.tcas.ra) {
    msg = 'TCAS RA';
    msgCol = C.r;
  }
  if (msg) txt(g, msg, s * 0.3, s * 0.098, fs, msgCol, 'center');

  // ---------------- attitude
  const cx = s * 0.43,
    cy = s * 0.43,
    aw = s * 0.21,
    ah = s * 0.26;
  const ppd = s * 0.0095;
  const pitch = ac.pitch * RAD,
    bank = ac.bank;
  g.save();
  g.beginPath();
  g.moveTo(cx - aw, cy - ah * 0.72);
  g.quadraticCurveTo(cx, cy - ah * 1.05, cx + aw, cy - ah * 0.72);
  g.lineTo(cx + aw, cy + ah * 0.72);
  g.quadraticCurveTo(cx, cy + ah * 1.05, cx - aw, cy + ah * 0.72);
  g.closePath();
  g.clip();
  g.translate(cx, cy);
  g.rotate(-bank);
  const off = pitch * ppd;
  g.fillStyle = C.sky;
  g.fillRect(-s, -s * 2 + off, s * 2, s * 2);
  g.fillStyle = C.gnd;
  g.fillRect(-s, off, s * 2, s * 2);
  line(g, -s, off, s, off, C.w, 2);
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue;
    const yy = off - p * ppd;
    const w = p % 10 === 0 ? s * 0.07 : p % 5 === 0 ? s * 0.04 : s * 0.018;
    line(g, -w, yy, w, yy, C.w, 1.5);
    if (p % 10 === 0) {
      txt(g, String(Math.abs(p)), -w - s * 0.02, yy, fs * 0.85, C.w, 'center');
      txt(g, String(Math.abs(p)), w + s * 0.02, yy, fs * 0.85, C.w, 'center');
    }
  }
  // heading ticks on horizon
  const hdgM = mag(ac.heading);
  for (let d = -40; d <= 40; d += 10) {
    const hh = Math.round((hdgM + d) / 10) * 10;
    const xx = (hh - hdgM) * s * 0.0065 * 1.4;
    line(g, xx, off, xx, off + s * 0.012, C.w, 1);
  }
  // bank scale pointer (moves with bank)
  g.fillStyle = C.y;
  g.beginPath();
  g.moveTo(0, -ah * 0.86);
  g.lineTo(-s * 0.018, -ah * 0.86 + s * 0.028);
  g.lineTo(s * 0.018, -ah * 0.86 + s * 0.028);
  g.closePath();
  g.fill();
  // sideslip index
  const b = clamp(-ac.specForce.y / 9.81 * 8, -1, 1) * s * 0.04;
  g.fillStyle = C.y;
  g.fillRect(-s * 0.018 + b, -ah * 0.86 + s * 0.032, s * 0.036, s * 0.01);
  g.restore();
  // fixed bank scale
  g.save();
  g.translate(cx, cy);
  for (const d of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) {
    const a = (d - 90) * DEG;
    const r0 = ah * 0.9,
      r1 = r0 + (Math.abs(d) % 30 === 0 || d === 45 || d === -45 ? s * 0.025 : s * 0.015);
    line(g, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, C.w, 2);
  }
  g.fillStyle = C.y;
  g.beginPath();
  g.moveTo(0, -ah * 0.9);
  g.lineTo(-s * 0.015, -ah * 0.9 - s * 0.025);
  g.lineTo(s * 0.015, -ah * 0.9 - s * 0.025);
  g.fill();
  // protection symbols
  const prot = ac.fbw.law === 'NORMAL';
  for (const d of [-67, 67]) {
    const a = (d - 90) * DEG;
    const r = ah * 0.95;
    g.save();
    g.translate(Math.cos(a) * r, Math.sin(a) * r);
    g.rotate(a + Math.PI / 2);
    if (prot) {
      line(g, -s * 0.012, -3, s * 0.012, -3, C.g, 2);
      line(g, -s * 0.012, 3, s * 0.012, 3, C.g, 2);
    } else {
      line(g, -6, -6, 6, 6, C.a, 2);
      line(g, -6, 6, 6, -6, C.a, 2);
    }
    g.restore();
  }
  // FD bars
  if (fm.fd.active && ac.ra > -5) {
    const fx = clamp(fm.fd.roll, -25, 25) * s * 0.004;
    const fy = -clamp(fm.fd.pitch, -12, 12) * ppd * 0.8;
    line(g, fx, -ah * 0.5, fx, ah * 0.5, C.g, 3);
    line(g, -aw * 0.6, fy, aw * 0.6, fy, C.g, 3);
  }
  // aircraft symbol
  g.fillStyle = '#000';
  g.strokeStyle = C.y;
  g.lineWidth = 3;
  const wing = (sx?: any) => {
    g.beginPath();
    g.moveTo(sx * s * 0.17, -2);
    g.lineTo(sx * s * 0.07, -2);
    g.lineTo(sx * s * 0.07, s * 0.03);
    g.stroke();
  };
  wing(-1);
  wing(1);
  g.strokeRect(-4, -4, 8, 8);
  // sidestick order indicator (on ground)
  if (ac.onGround && st.stick) {
    const sx = st.stick.roll * aw * 0.8,
      sy = st.stick.pitch * ah * 0.6;
    rect(g, -aw * 0.8, -ah * 0.6, aw * 1.6, ah * 1.2, C.w, 1);
    line(g, sx - 10, sy, sx + 10, sy, C.w, 2);
    line(g, sx, sy - 10, sx, sy + 10, C.w, 2);
  }
  g.restore();

  // ---------------- speed tape
  const sx0 = s * 0.035,
    sw = s * 0.12,
    sy0 = s * 0.14,
    sh = s * 0.58,
    scy = sy0 + sh / 2;
  const kpx = s * 0.0045;
  const V = Math.max(30, ac.ias);
  g.save();
  g.fillStyle = C.grey;
  g.fillRect(sx0, sy0, sw, sh);
  g.beginPath();
  g.rect(sx0, sy0, sw + s * 0.02, sh);
  g.clip();
  const yOf = (v?: any) => scy - (v - V) * kpx;
  for (let v = Math.floor((V - 70) / 10) * 10; v < V + 70; v += 10) {
    if (v < 30) continue;
    const yy = yOf(v);
    line(g, sx0 + sw - s * 0.018, yy, sx0 + sw, yy, C.w, 1.5);
    if (v % 20 === 0) txt(g, String(v).padStart(3, '0'), sx0 + sw - s * 0.022, yy, fs, C.w, 'right');
  }
  const sp = ac.speeds();
  const perf = fm.perf();
  if (!ac.onGround) {
    // VLS
    g.fillStyle = C.a;
    const yv = yOf(perf.vls);
    g.fillRect(sx0 + sw - s * 0.006, yv, s * 0.006, sy0 + sh - yv);
    // alpha prot (amber/black) & alpha max (red)
    const ap = yOf(sp.alphaProtV),
      am = yOf(sp.alphaMaxV);
    if (ac.fbw.law === 'NORMAL') {
      for (let yy = ap; yy < sy0 + sh; yy += 8) {
        g.fillStyle = C.a;
        g.fillRect(sx0 + sw, yy, s * 0.012, 4);
      }
      g.fillStyle = C.r;
      g.fillRect(sx0 + sw, am, s * 0.012, sy0 + sh - am);
    } else {
      // stall warning speed (red/black)
      for (let yy = am; yy < sy0 + sh; yy += 8) {
        g.fillStyle = C.r;
        g.fillRect(sx0 + sw, yy, s * 0.012, 4);
      }
    }
  }
  // VMAX barber pole
  const vmax = fm.vmax();
  const ym = yOf(vmax);
  for (let yy = ym; yy > sy0 - 10; yy -= 8) {
    g.fillStyle = C.r;
    g.fillRect(sx0 + sw, yy - 4, s * 0.012, 4);
  }
  // characteristic speeds
  const clean = ac.ctl.flapLever === 0;
  if (!ac.onGround && clean) {
    g.strokeStyle = C.g;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(sx0 + sw + s * 0.012, yOf(perf.gd), 4, 0, TAU);
    g.stroke();
  }
  if (!ac.onGround && ac.ctl.flapLever === 1) txt(g, 'S', sx0 + sw + s * 0.015, yOf(perf.S), fs * 0.9, C.g);
  if (!ac.onGround && (ac.ctl.flapLever === 2 || ac.ctl.flapLever === 3)) txt(g, 'F', sx0 + sw + s * 0.015, yOf(perf.F), fs * 0.9, C.g);
  if (fm.phase === 'PREFLIGHT' || fm.phase === 'TAKEOFF') {
    if (fm.d.v1) txt(g, '1', sx0 + sw + s * 0.012, yOf(fm.d.v1), fs, C.c);
    if (fm.d.vr) {
      g.strokeStyle = C.c;
      g.beginPath();
      g.arc(sx0 + sw + s * 0.014, yOf(fm.d.vr), 4, 0, TAU);
      g.stroke();
    }
  }
  // target speed
  const tgt = fm.spdTarget || 0;
  const ty = yOf(tgt);
  const tcol = fm.fcu.spdManaged ? C.m : C.c;
  if (ty > sy0 && ty < sy0 + sh) {
    g.fillStyle = tcol;
    g.beginPath();
    g.moveTo(sx0 + sw, ty);
    g.lineTo(sx0 + sw + s * 0.018, ty - s * 0.012);
    g.lineTo(sx0 + sw + s * 0.018, ty + s * 0.012);
    g.closePath();
    g.fill();
  }
  // trend arrow
  const trend = (fm.accelF || 0) * 10;
  if (Math.abs(trend) > 2) {
    const ty2 = yOf(V + trend);
    line(g, sx0 + sw - s * 0.005, scy, sx0 + sw - s * 0.005, ty2, C.y, 2);
    g.fillStyle = C.y;
    g.beginPath();
    g.moveTo(sx0 + sw - s * 0.005, ty2);
    g.lineTo(sx0 + sw - s * 0.012, ty2 + (trend > 0 ? 8 : -8));
    g.lineTo(sx0 + sw + s * 0.002, ty2 + (trend > 0 ? 8 : -8));
    g.fill();
  }
  g.restore();
  if (ty <= sy0 || ty >= sy0 + sh) txt(g, String(Math.round(tgt)), sx0 + sw / 2, ty <= sy0 ? sy0 - s * 0.02 : sy0 + sh + s * 0.02, fs, tcol, 'center');
  line(g, sx0 - 2, scy, sx0 + sw + s * 0.02, scy, C.y, 3);
  if (ac.mach > 0.5) txt(g, '.' + String(Math.round(ac.mach * 1000)).padStart(3, '0').slice(0, 3), sx0 + sw / 2, sy0 + sh + s * 0.045, fs, C.g, 'center');
  if (ac.stallWarn || (ac.protActive === 'ALPHA' && ac.ias < sp.alphaProtV)) txt(g, 'SPD LIM', sx0, sy0 - s * 0.02, fs * 0.8, C.r);

  // ---------------- altitude tape
  const ax0 = s * 0.72,
    aww = s * 0.1,
    ay0 = s * 0.14,
    ahh = s * 0.58,
    acy = ay0 + ahh / 2;
  const alt = indAlt(st, 0);
  const fpx = s * 0.00042;
  g.save();
  g.fillStyle = C.grey;
  g.fillRect(ax0, ay0, aww, ahh);
  g.beginPath();
  g.rect(ax0, ay0, aww + 2, ahh);
  g.clip();
  const yA = (a?: any) => acy - (a - alt) * fpx;
  for (let a = Math.floor((alt - 800) / 100) * 100; a < alt + 800; a += 100) {
    const yy = yA(a);
    line(g, ax0, yy, ax0 + s * 0.012, yy, C.w, 1.5);
    if (a % 500 === 0) txt(g, String(Math.round(a / 100)).padStart(3, '0'), ax0 + s * 0.02, yy, fs, C.w);
  }
  // ground reference (RA)
  const raFt = ac.ra / FT;
  if (raFt < 570) {
    const gy = yA(alt - raFt);
    g.fillStyle = C.r;
    g.fillRect(ax0 + aww - s * 0.012, gy, s * 0.012, ay0 + ahh - gy);
  }
  g.restore();
  // target altitude
  const tA = fm.fcu.alt;
  const taCol = fm.vert.mode.includes('CST') ? C.m : C.c;
  const ty3 = yA(tA);
  if (ty3 > ay0 && ty3 < ay0 + ahh) {
    rect(g, ax0, ty3 - s * 0.03, aww * 0.4, s * 0.06, taCol, 2);
  } else txt(g, String(tA), ax0 + aww / 2, ty3 <= ay0 ? ay0 - s * 0.02 : ay0 + ahh + s * 0.02, fs, taCol, 'center');
  // altitude window
  g.fillStyle = '#000';
  g.fillRect(ax0 - s * 0.02, acy - s * 0.03, aww + s * 0.035, s * 0.06);
  rect(g, ax0 - s * 0.02, acy - s * 0.03, aww + s * 0.035, s * 0.06, C.y, 2);
  const altR = Math.round(alt / 20) * 20;
  txt(g, String(Math.floor(altR / 100)), ax0 + aww * 0.6, acy, fs * 1.15, C.g, 'right');
  txt(g, String(Math.abs(altR % 100)).padStart(2, '0'), ax0 + aww * 0.63, acy, fs * 0.95, C.g, 'left');
  // baro
  const bstd = fm.fcu.std[0];
  txt(g, bstd ? 'STD' : 'QNH', ax0, ay0 + ahh + s * 0.04, fs, bstd ? C.c : C.c);
  if (!bstd) txt(g, fm.fcu.inHg ? (fm.fcu.baro[0] / 33.8639).toFixed(2) : String(Math.round(fm.fcu.baro[0])), ax0 + s * 0.06, ay0 + ahh + s * 0.04, fs, C.c);
  if (!bstd && alt > 9000 + 100 && fm.phase !== 'APPROACH') txt(g, 'QNH', ax0, ay0 + ahh + s * 0.08, fs * 0.8, (Date.now() / 400) % 2 < 1 ? C.m : '#000');
  if (bstd && alt < 11000 && ac.vs < 0) rect(g, ax0 - 3, ay0 + ahh + s * 0.02, s * 0.06, s * 0.04, (Date.now() / 400) % 2 < 1 ? C.m : '#000', 1);

  // ---------------- vertical speed
  const vx0 = s * 0.86,
    vy0 = s * 0.18,
    vh = s * 0.5,
    vcy = vy0 + vh / 2;
  g.fillStyle = C.dark;
  g.fillRect(vx0, vy0, s * 0.06, vh);
  const vsFpm = ac.vs / FPM;
  const vpos = (v?: any) => {
    const a = Math.abs(v),
      sg = Math.sign(v);
    const n = a <= 1000 ? (a / 1000) * 0.5 : a <= 2000 ? 0.5 + ((a - 1000) / 1000) * 0.25 : 0.75 + (Math.min(a, 6000) - 2000) / 4000 * 0.25;
    return vcy - sg * n * (vh / 2);
  };
  // TCAS RA zones
  if (st.tcas && st.tcas.ra) {
    const ra = st.tcas.ra;
    g.fillStyle = 'rgba(255,40,40,0.9)';
    const r0 = vpos(ra.redMin),
      r1 = vpos(ra.redMax);
    g.fillRect(vx0, Math.min(r0, r1), s * 0.02, Math.abs(r1 - r0));
    g.fillStyle = 'rgba(60,255,90,0.95)';
    const g0 = vpos(ra.greenMin),
      g1 = vpos(ra.greenMax);
    g.fillRect(vx0, Math.min(g0, g1), s * 0.02, Math.abs(g1 - g0));
  }
  for (const v of [-6000, -2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000, 6000]) {
    const yy = vpos(v);
    line(g, vx0, yy, vx0 + s * (v % 1000 === 0 ? 0.015 : 0.008), yy, C.w, 1.5);
    if (v && Math.abs(v) <= 2000 && v % 1000 === 0) txt(g, String(Math.abs(v / 1000)), vx0 + s * 0.02, yy, fs * 0.8, C.w);
    if (Math.abs(v) === 6000) txt(g, '6', vx0 + s * 0.02, yy, fs * 0.8, C.w);
  }
  const vcol = st.tcas && st.tcas.ra && (vsFpm < st.tcas.ra.greenMin || vsFpm > st.tcas.ra.greenMax) ? C.r : Math.abs(vsFpm) > 6000 || (ac.ra / FT < 2500 && vsFpm < -2000) ? C.a : C.g;
  line(g, vx0 + s * 0.08, vcy, vx0 + s * 0.005, vpos(vsFpm), vcol, 3);
  if (Math.abs(vsFpm) > 200) {
    g.fillStyle = '#000';
    g.fillRect(vx0 + s * 0.03, vpos(vsFpm) - s * 0.018, s * 0.035, s * 0.036);
    txt(g, String(Math.round(Math.abs(vsFpm) / 100)).padStart(2, '0'), vx0 + s * 0.048, vpos(vsFpm), fs * 0.9, vcol, 'center');
  }

  // ---------------- heading tape
  const hx0 = s * 0.22,
    hw = s * 0.42,
    hy0 = s * 0.8,
    hh = s * 0.07,
    hcx = hx0 + hw / 2;
  g.save();
  g.fillStyle = C.grey;
  g.fillRect(hx0, hy0, hw, hh);
  g.beginPath();
  g.rect(hx0, hy0, hw, hh + s * 0.03);
  g.clip();
  const dpx = s * 0.0082;
  for (let d = Math.floor(hdgM - 30); d < hdgM + 30; d++) {
    if (d % 5) continue;
    const xx = hcx + wrap180(d - hdgM) * dpx;
    line(g, xx, hy0, xx, hy0 + (d % 10 === 0 ? s * 0.015 : s * 0.008), C.w, 1.5);
    if (d % 10 === 0) txt(g, String(wrap360(d) / 10 | 0), xx, hy0 + s * 0.035, d % 30 === 0 ? fs * 1.05 : fs * 0.85, C.w, 'center');
  }
  // selected heading
  const sh2 = hcx + wrap180(f.hdg - hdgM) * dpx;
  if (!f.hdgManaged || fm.lat.mode === 'HDG') {
    g.fillStyle = C.c;
    g.beginPath();
    g.moveTo(sh2, hy0);
    g.lineTo(sh2 - 6, hy0 - 10);
    g.lineTo(sh2 + 6, hy0 - 10);
    g.fill();
  }
  // track diamond
  const tx = hcx + wrap180(mag(ac.track) - hdgM) * dpx;
  if (ac.gs > 20) {
    g.strokeStyle = C.g;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(tx, hy0 + 2);
    g.lineTo(tx - 5, hy0 + 8);
    g.lineTo(tx, hy0 + 14);
    g.lineTo(tx + 5, hy0 + 8);
    g.closePath();
    g.stroke();
  }
  // ILS course
  if (fm.fcu.ls[0] && st.ils && st.ils.valid) {
    const cx2 = hcx + wrap180(st.ils.locCourse - hdgM) * dpx;
    line(g, cx2, hy0 + hh, cx2, hy0, C.m, 3);
  }
  g.restore();
  line(g, hcx, hy0 - s * 0.01, hcx, hy0 + hh, C.y, 3);

  // ---------------- ILS deviation scales
  const ils = st.ils;
  if (fm.fcu.ls[0]) {
    const lx = cx,
      ly = cy + ah * 0.95;
    for (let k = -2; k <= 2; k++) if (k) {
      g.strokeStyle = C.w;
      g.beginPath();
      g.arc(lx + k * s * 0.045, ly, 3, 0, TAU);
      g.stroke();
    }
    const gx = cx + aw + s * 0.02;
    for (let k = -2; k <= 2; k++) if (k) {
      g.beginPath();
      g.arc(gx, cy + k * s * 0.045, 3, 0, TAU);
      g.stroke();
    }
    if (ils && ils.valid) {
      const dx = clamp(ils.cdi, -1.1, 1.1) * 2 * s * 0.045;
      diamond(g, lx + dx, ly, C.m);
      if (ils.gsValid) diamond(g, gx, cy - clamp(ils.gs, -1.1, 1.1) * 2 * s * 0.045, C.m, true);
      txt(g, ils.ident || '', s * 0.02, s * 0.9, fs, C.m);
      txt(g, (st.ilsFreq || 0).toFixed(2), s * 0.02, s * 0.94, fs, C.m);
      if (ils.dmeValid) txt(g, ils.dme.toFixed(1) + 'NM', s * 0.02, s * 0.98, fs, C.m);
    }
  }
  // radio altitude
  if (raFt < 2500 && !ac.onGround) {
    const dh = fm.d.dh;
    const rcol = dh != null && raFt < dh ? C.a : C.g;
    const raShow = raFt < 50 ? Math.round(raFt) : raFt < 200 ? Math.round(raFt / 5) * 5 : Math.round(raFt / 10) * 10;
    txt(g, String(Math.max(0, raShow)), cx, cy + ah * 0.75, fs * 1.4, rcol, 'center');
  }
  if (st.dhCallout) txt(g, 'DH', cx + aw * 0.6, cy + ah * 0.5, fs * 1.2, C.a, 'center');
  // callouts / warnings in attitude
  if (st.lowEnergy) txt(g, 'SPEED SPEED SPEED', cx, cy - ah * 0.55, fs, C.a, 'center');
  g.restore();
}
function diamond(g?: any, x?: any, y?: any, col?: any, vert?: any) {
  g.fillStyle = col;
  g.beginPath();
  const a = vert ? 6 : 8,
    b = vert ? 8 : 6;
  g.moveTo(x - a, y);
  g.lineTo(x, y - b);
  g.lineTo(x + a, y);
  g.lineTo(x, y + b);
  g.closePath();
  g.fill();
}

// ================================================================== ND
function drawND(g?: any, x0?: any, y0?: any, s?: any, st?: any) {
  const ac = st.ac,
    fm = st.fm,
    efis = fm.efis;
  frame(g, x0, y0, s);
  if (!st.powered) return;
  g.save();
  g.translate(x0, y0);
  g.beginPath();
  g.rect(0, 0, s, s);
  g.clip();
  const fs = s * 0.04;
  const mode = efis.mode;
  const hdgM = mag(ac.heading);
  const trkM = mag(ac.track);
  const arc = mode === 'ARC';
  const plan = mode === 'PLAN';
  const cx = s / 2,
    cy = arc ? s * 0.82 : s * 0.54;
  const R = arc ? s * 0.68 : s * 0.37;
  const range = efis.range;
  const mpp = (range * NM) / R; // metres per pixel
  const up = plan ? 0 : hdgM; // display up direction (magnetic)
  const mv = magVar || 0;
  const toXY = (n?: any, e?: any) => {
    const dn = n - ac.pos.x,
      de = e - ac.pos.y;
    const a = -(up + mv) * DEG;
    const xr = de * Math.cos(a) + dn * Math.sin(a);
    const yr = -de * Math.sin(a) + dn * Math.cos(a);
    return [cx + xr / mpp, cy - yr / mpp];
  };
  // top-left data
  txt(g, 'GS', s * 0.02, s * 0.035, fs * 0.8, C.w);
  txt(g, String(Math.round(ac.gs / KT)), s * 0.08, s * 0.035, fs, C.g);
  txt(g, 'TAS', s * 0.17, s * 0.035, fs * 0.8, C.w);
  txt(g, String(Math.round(ac.tas / KT)), s * 0.24, s * 0.035, fs, C.g);
  const w = ac.windNED || { n: 0, e: 0 };
  const wspd = Math.hypot(w.n, w.e) / KT;
  const wdir = wrap360(Math.atan2(-w.e, -w.n) * RAD - mv);
  txt(g, `${String(Math.round(wdir)).padStart(3, '0')}/${Math.round(wspd)}`, s * 0.02, s * 0.08, fs, C.g);
  if (wspd > 2) {
    g.save();
    g.translate(s * 0.05, s * 0.14);
    g.rotate((wdir + 180 - hdgM) * DEG);
    line(g, 0, -s * 0.03, 0, s * 0.03, C.g, 2);
    line(g, 0, s * 0.03, -5, s * 0.015, C.g, 2);
    line(g, 0, s * 0.03, 5, s * 0.015, C.g, 2);
    g.restore();
  }
  // compass
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = C.w;
  g.lineWidth = 2;
  g.beginPath();
  if (arc) g.arc(0, 0, R, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85);
  else g.arc(0, 0, R, 0, TAU);
  g.stroke();
  for (let d = 0; d < 360; d += 5) {
    const rel = wrap180(d - up);
    if (arc && Math.abs(rel) > 50) continue;
    const a = rel * DEG - Math.PI / 2;
    const l = d % 10 === 0 ? s * 0.025 : s * 0.013;
    line(g, Math.cos(a) * R, Math.sin(a) * R, Math.cos(a) * (R + l), Math.sin(a) * (R + l), C.w, 1.5);
    if (d % 30 === 0) {
      g.save();
      g.rotate(rel * DEG);
      txt(g, String(d / 10), 0, -R - s * 0.045, fs, C.w, 'center');
      g.restore();
    }
  }
  // range rings (dashed)
  g.setLineDash([4, 6]);
  g.strokeStyle = '#8a8a8a';
  for (const k of arc ? [0.25, 0.5, 0.75] : [0.5]) {
    g.beginPath();
    if (arc) g.arc(0, 0, R * k, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85);
    else g.arc(0, 0, R * k, 0, TAU);
    g.stroke();
  }
  g.setLineDash([]);
  txt(g, String(range / (arc ? 2 : 2)), -R * 0.5 * 0.7 - 12, -R * 0.5 * 0.7, fs * 0.8, C.c, 'right');
  // heading bug, track line, lubber
  if (!fm.fcu.hdgManaged || fm.lat.mode === 'HDG') {
    g.save();
    g.rotate(wrap180(fm.fcu.hdg - up) * DEG);
    g.fillStyle = C.c;
    g.beginPath();
    g.moveTo(0, -R);
    g.lineTo(-6, -R - 12);
    g.lineTo(6, -R - 12);
    g.fill();
    g.restore();
  }
  g.save();
  g.rotate(wrap180(trkM - up) * DEG);
  diamond(g, 0, -R + 8, 'rgba(0,0,0,0)');
  g.strokeStyle = C.g;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -R + 2);
  g.lineTo(-5, -R + 9);
  g.lineTo(0, -R + 16);
  g.lineTo(5, -R + 9);
  g.closePath();
  g.stroke();
  g.restore();
  if (!plan) {
    g.fillStyle = C.y;
    g.fillRect(-2, -R - s * 0.045, 4, s * 0.03);
  }
  g.restore();
  // ILS course line (ROSE LS)
  // navaids / airports
  for (const v of st.navaids || []) {
    if (!((v.type === 'VOR' && efis.vord) || (v.type === 'NDB' && efis.ndb))) continue;
    const [x, y] = toXY(v.n, v.e);
    if (!inView(x, y)) continue;
    g.strokeStyle = C.m;
    if (v.type === 'VOR') {
      line(g, x - 6, y, x + 6, y, C.m, 1.5);
      line(g, x, y - 6, x, y + 6, C.m, 1.5);
    } else {
      g.beginPath();
      g.moveTo(x, y - 7);
      g.lineTo(x - 6, y + 5);
      g.lineTo(x + 6, y + 5);
      g.closePath();
      g.stroke();
    }
    txt(g, v.ident, x + 8, y + 8, fs * 0.8, C.m);
  }
  if (efis.arpt)
    for (const a of AIRPORTS) {
      const [x, y] = toXY(a.n, a.e);
      if (!inView(x, y)) continue;
      g.strokeStyle = C.m;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 5, 0, TAU);
      g.stroke();
      txt(g, a.icao, x + 8, y - 6, fs * 0.8, C.m);
      for (const rw of a.runways) {
        const [p1x, p1y] = toXY(rw.thr[0].n, rw.thr[0].e),
          [p2x, p2y] = toXY(rw.thr[1].n, rw.thr[1].e);
        line(g, p1x, p1y, p2x, p2y, C.w, 3);
      }
    }
  // flight plan
  const P = fm.plan;
  let prev: any = null;
  for (let i = 0; i < P.length; i++) {
    const l = P[i];
    if (l.disc) {
      prev = null;
      continue;
    }
    if (l.hidden) continue;
    const [x, y] = toXY(l.n, l.e);
    const isActive = i === fm.active || (fm.activeLeg && fm.activeLeg() === l);
    if (prev && i > 0) {
      const col = l.missed ? C.c : i >= fm.active ? C.g : '#1f7a2e';
      g.setLineDash(l.missed ? [6, 5] : []);
      line(g, prev[0], prev[1], x, y, i === fm.active ? C.w : col, 2);
      g.setLineDash([]);
    }
    if (inView(x, y) && i >= fm.active - 1) {
      g.strokeStyle = isActive ? C.w : C.g;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 6, y);
      g.closePath();
      g.stroke();
      txt(g, l.ident, x + 9, y - 8, fs * 0.8, isActive ? C.w : C.g);
      if (efis.cstr && l.alt) {
        g.strokeStyle = C.m;
        g.beginPath();
        g.arc(x, y, 9, 0, TAU);
        g.stroke();
        txt(g, (l.alt.t === '+' ? '+' : l.alt.t === '-' ? '-' : '') + l.alt.v, x + 9, y + 8, fs * 0.7, C.m);
      }
    }
    prev = [x, y];
  }
  // TCAS traffic
  if (st.tcas && st.tcas.targets) {
    for (const t of st.tcas.targets) {
      const [x, y] = toXY(t.n, t.e);
      if (!inView(x, y)) continue;
      const col = t.level === 'RA' ? C.r : t.level === 'TA' ? C.a : C.c;
      g.fillStyle = col;
      g.strokeStyle = col;
      g.lineWidth = 2;
      if (t.level === 'RA') g.fillRect(x - 6, y - 6, 12, 12);
      else if (t.level === 'TA') {
        g.beginPath();
        g.arc(x, y, 6, 0, TAU);
        g.fill();
      } else {
        g.beginPath();
        g.moveTo(x, y - 7);
        g.lineTo(x + 7, y);
        g.lineTo(x, y + 7);
        g.lineTo(x - 7, y);
        g.closePath();
        if (t.level === 'PROX') g.fill();
        else g.stroke();
      }
      const rel = Math.round(t.relAlt / 100);
      txt(g, (rel >= 0 ? '+' : '-') + String(Math.abs(rel)).padStart(2, '0'), x, rel >= 0 ? y - 14 : y + 14, fs * 0.8, col, 'center');
      if (Math.abs(t.vs) > 500) txt(g, t.vs > 0 ? '↑' : '↓', x + 11, y, fs, col);
    }
  }
  // aircraft symbol
  g.save();
  g.translate(cx, cy);
  if (plan) g.rotate(hdgM * DEG);
  line(g, -s * 0.05, 0, s * 0.05, 0, C.y, 3);
  line(g, 0, -s * 0.015, 0, s * 0.06, C.y, 3);
  line(g, -s * 0.02, s * 0.05, s * 0.02, s * 0.05, C.y, 3);
  g.restore();
  // VOR / ADF needles
  const needle = (brgTrue?: any, col?: any, double?: any) => {
    g.save();
    g.translate(cx, cy);
    g.rotate((mag(brgTrue) - up) * DEG);
    if (double) {
      line(g, -3, -R * 0.9, -3, -R * 0.3, col, 2);
      line(g, 3, -R * 0.9, 3, -R * 0.3, col, 2);
      line(g, 0, R * 0.9, 0, R * 0.3, col, 2);
    } else {
      line(g, 0, -R * 0.9, 0, -R * 0.3, col, 2);
      line(g, 0, R * 0.9, 0, R * 0.3, col, 2);
    }
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, -R * 0.95);
    g.lineTo(-6, -R * 0.85);
    g.lineTo(6, -R * 0.85);
    g.fill();
    g.restore();
  };
  const bottomInfo = (side?: any, kind?: any, info?: any) => {
    const xx = side === 1 ? s * 0.02 : s * 0.98;
    const al = side === 1 ? 'left' : 'right';
    const col = kind === 'ADF' ? C.g : C.w;
    txt(g, `${kind}${side}`, xx, s * 0.9, fs * 0.9, col, al);
    txt(g, info ? info.ident || '' : '', xx, s * 0.94, fs * 0.9, col, al);
    if (info && info.dme) txt(g, info.dme.toFixed(1) + ' NM', xx, s * 0.98, fs * 0.8, C.g, al);
  };
  for (const side of [1, 2]) {
    const kind = side === 1 ? efis.nav1 : efis.nav2;
    if (kind === 'OFF') continue;
    const r = kind === 'VOR' ? (side === 1 ? st.vor1 : st.vor2) : side === 1 ? st.adf1 : st.adf2;
    if (r && r.valid && r.brgTrue != null) needle(r.brgTrue, kind === 'ADF' ? C.g : C.w, side === 2);
    bottomInfo(side, kind, r && r.valid ? { ident: r.ident, dme: r.dmeValid ? r.dme : null } : null);
  }
  // top-right: TO waypoint
  const no = fm.navOut;
  if (no && no.leg) {
    txt(g, no.leg.ident, s * 0.75, s * 0.035, fs, C.w);
    txt(g, String(Math.round(mag(no.brg))).padStart(3, '0') + '°', s * 0.98, s * 0.035, fs, C.g, 'right');
    txt(g, (no.dist / NM).toFixed(no.dist < 20 * NM ? 1 : 0), s * 0.9, s * 0.08, fs, C.g, 'right');
    txt(g, 'NM', s * 0.98, s * 0.08, fs * 0.8, C.c, 'right');
    if (ac.gs > 20) {
      const eta = st.hours + no.dist / ac.gs / 3600;
      const hh = Math.floor(eta) % 24,
        mm = Math.floor((eta % 1) * 60);
      txt(g, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, s * 0.98, s * 0.125, fs, C.g, 'right');
    }
  }
  // ILS in ROSE LS
  if (mode === 'LS' && st.ils) {
    const o = st.ils;
    txt(g, `ILS1 ${(st.ilsFreq || 0).toFixed(2)}`, s * 0.98, s * 0.17, fs * 0.9, C.m, 'right');
    if (o.valid) {
      g.save();
      g.translate(cx, cy);
      g.rotate((o.locCourse - hdgM) * DEG);
      line(g, 0, -R * 0.9, 0, -R * 0.35, C.m, 3);
      line(g, 0, R * 0.9, 0, R * 0.35, C.m, 3);
      const dx = clamp(o.cdi, -1.2, 1.2) * R * 0.3;
      line(g, dx, -R * 0.3, dx, R * 0.3, C.m, 3);
      g.restore();
    }
  }
  // mode label
  txt(g, ({ ARC: '', NAV: '', LS: 'ILS', VOR: 'VOR', PLAN: 'PLAN' } as any)[mode] || '', s * 0.5, s * 0.035, fs, C.g, 'center');
  if (st.tcas && st.tcas.status) txt(g, st.tcas.status, s * 0.5, s * 0.82, fs, st.tcas.ra ? C.r : C.a, 'center');
  g.restore();
  function inView(x?: any, y?: any) {
    return x > -20 && x < s + 20 && y > -20 && y < s + 20;
  }
}

// ================================================================== E/WD (upper ECAM)
function drawEWD(g?: any, x0?: any, y0?: any, s?: any, st?: any) {
  const ac = st.ac,
    sys = st.sys,
    fm = st.fm;
  frame(g, x0, y0, s);
  if (!st.powered) return;
  g.save();
  g.translate(x0, y0);
  const fs = s * 0.042;
  const E = ac.eng;
  // N1 & EGT dials
  for (let i = 0; i < 2; i++) {
    const e = E[i];
    const cx = s * (i === 0 ? 0.2 : 0.55),
      cy = s * 0.2,
      r = s * 0.12;
    const a0 = 200 * DEG,
      a1 = 390 * DEG;
    const ang = (n?: any) => a0 + (a1 - a0) * clamp(n / 110, 0, 1);
    g.strokeStyle = C.w;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r, a0 - Math.PI / 2 - Math.PI / 2 + Math.PI / 2, ang(101) - Math.PI);
    g.stroke();
    g.strokeStyle = C.r;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, r, ang(101) - Math.PI, ang(110) - Math.PI);
    g.stroke();
    for (const n of [50, 60, 70, 80, 90, 100]) {
      const a = ang(n) - Math.PI;
      line(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6), C.w, 1.5);
      if (n === 50 || n === 100) txt(g, String(n / 10), cx + Math.cos(a) * (r - 16), cy + Math.sin(a) * (r - 16), fs * 0.8, C.w, 'center');
    }
    const ok = e.running || e.n1 > 2;
    if (ok) {
      const a = ang(e.n1) - Math.PI;
      line(g, cx, cy, cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05, C.g, 3);
      // thrust lever position
      const tl = ac.ctl.tla[i];
      const tn = tl <= 0 ? 20 : tl <= 25 ? 20 + (tl / 25) * 69 : tl <= 35 ? 89 + (tl - 25) * 0.5 : 94 + (tl - 35) * 0.6;
      const ta = ang(tn) - Math.PI;
      g.strokeStyle = C.c;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx + Math.cos(ta) * (r + 7), cy + Math.sin(ta) * (r + 7), 4, 0, TAU);
      g.stroke();
    }
    g.fillStyle = '#000';
    rect(g, cx - s * 0.02, cy + s * 0.01, s * 0.11, s * 0.055, '#666', 1);
    txt(g, ok ? e.n1.toFixed(1) : 'XX', cx + s * 0.085, cy + s * 0.038, fs * 1.2, ok ? C.g : C.a, 'right');
    if (e.rev > 0.1) txt(g, 'REV', cx, cy - r * 0.35, fs, e.rev > 0.9 ? C.g : C.a, 'center');
    // EGT
    const ey = s * 0.43,
      er = s * 0.075;
    g.strokeStyle = C.w;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, ey, er, Math.PI, 1.85 * Math.PI);
    g.stroke();
    const ea = Math.PI + clamp(e.egt / 1100, 0, 1) * 0.85 * Math.PI;
    line(g, cx, ey, cx + Math.cos(ea) * er, ey + Math.sin(ea) * er, e.egt > 950 ? C.r : C.g, 3);
    txt(g, e.running || e.egt > 100 ? String(Math.round(e.egt)) : 'XX', cx, ey + s * 0.03, fs * 1.1, C.g, 'center');
    // N2 / FF
    txt(g, e.n2 > 1 ? e.n2.toFixed(1) : 'XX', cx, s * 0.56, fs * 1.1, e.phase === 'CRANK' || e.phase === 'LIGHT' ? C.g : C.g, 'center');
    if (e.phase === 'CRANK' || e.phase === 'LIGHT') rect(g, cx - s * 0.05, s * 0.54, s * 0.1, s * 0.04, '#999', 1);
    txt(g, String(Math.round(e.ff / 10) * 10), cx, s * 0.61, fs * 1.1, C.g, 'center');
    if (e.ign) txt(g, 'IGN A', cx, s * 0.5, fs * 0.8, C.g, 'center');
  }
  // center labels
  txt(g, 'N1', s * 0.375, s * 0.19, fs, C.w, 'center');
  txt(g, '%', s * 0.375, s * 0.23, fs * 0.9, C.c, 'center');
  txt(g, 'EGT', s * 0.375, s * 0.42, fs, C.w, 'center');
  txt(g, '°C', s * 0.375, s * 0.46, fs * 0.9, C.c, 'center');
  txt(g, 'N2', s * 0.375, s * 0.56, fs, C.w, 'center');
  txt(g, 'FF', s * 0.375, s * 0.61, fs, C.w, 'center');
  txt(g, 'KG/H', s * 0.375, s * 0.645, fs * 0.8, C.c, 'center');
  // thrust limit
  const tlaMax = Math.max(...ac.ctl.tla);
  const lim = tlaMax > 44 ? 'TOGA' : tlaMax > 26 ? (sys.flexTemp && ac.onGround ? 'FLX' : 'MCT') : 'CLB';
  const limN1 = lim === 'TOGA' ? 100.5 : lim === 'MCT' || lim === 'FLX' ? 96.4 : 92.1;
  txt(g, lim, s * 0.7, s * 0.06, fs * 1.1, C.c, 'left');
  txt(g, limN1.toFixed(1), s * 0.93, s * 0.06, fs * 1.1, C.g, 'right');
  txt(g, '%', s * 0.97, s * 0.06, fs * 0.9, C.c, 'right');
  if (lim === 'FLX') txt(g, `${sys.flexTemp}°C`, s * 0.97, s * 0.1, fs, C.c, 'right');
  // FOB
  txt(g, 'FOB :', s * 0.72, s * 0.18, fs, C.w);
  txt(g, String(Math.round(sys.fob() / 10) * 10), s * 0.93, s * 0.18, fs * 1.2, C.g, 'right');
  txt(g, 'KG', s * 0.98, s * 0.18, fs * 0.8, C.c, 'right');
  // S/F indicator
  const fx = s * 0.72,
    fy = s * 0.33;
  txt(g, 'S', fx, fy - s * 0.035, fs, C.w);
  txt(g, 'F', fx + s * 0.22, fy - s * 0.035, fs, C.w);
  const slatFrac = ac.slat / 27,
    flapFrac = ac.flap / 40;
  // slat track
  for (let k = 0; k < 4; k++) {
    g.fillStyle = C.w;
    g.fillRect(fx + s * 0.08 - k * s * 0.025, fy + k * s * 0.01, 3, 3);
    g.fillRect(fx + s * 0.13 + k * s * 0.028, fy + k * s * 0.012, 3, 3);
  }
  const slCol = ac.slatsLocked ? C.a : C.g,
    flCol = ac.flapsLocked ? C.a : C.g;
  g.fillStyle = slCol;
  g.fillRect(fx + s * 0.08 - slatFrac * s * 0.075, fy - 4 + slatFrac * s * 0.03, s * 0.03, 6);
  g.fillStyle = flCol;
  g.fillRect(fx + s * 0.13 + flapFrac * s * 0.084, fy - 4 + flapFrac * s * 0.036, s * 0.03, 6);
  g.fillStyle = C.w;
  g.fillRect(fx + s * 0.105, fy - 5, s * 0.03, 10);
  const cn = ac.confName || '0';
  if (cn !== '0') txt(g, cn, fx + s * 0.12, fy + s * 0.07, fs * 1.1, ac.slat === A320_CONF[ac.ctl.flapLever].slat || cn === '1+F' ? C.g : C.c, 'center');
  // --- memo / warning area
  line(g, s * 0.03, s * 0.68, s * 0.97, s * 0.68, C.w, 1.5);
  line(g, s * 0.62, s * 0.7, s * 0.62, s * 0.97, C.w, 1);
  const f = sys.fwc;
  let yy = s * 0.72;
  const lh = s * 0.036;
  if (f.shown && f.shown.length) {
    for (const a of f.shown.slice(0, 3)) {
      const col = a.lvl === 3 ? C.r : C.a;
      const [sysName, ...rest] = a.title.split(' ');
      txt(g, sysName, s * 0.04, yy, fs, col);
      g.fillStyle = col;
      g.fillRect(s * 0.04, yy + fs * 0.55, g.measureText(sysName).width, 1.5);
      txt(g, rest.join(' '), s * 0.04 + g.measureText(sysName + ' ').width + 4, yy, fs, col);
      yy += lh;
      if (a === f.shown[0])
        for (const x of a.acts || []) {
          if (yy > s * 0.96) break;
          if (x.ok && !x.info) continue;
          const dots = '.'.repeat(Math.max(2, 24 - x.t.length - x.v.length));
          txt(g, `-${x.t}${dots}${x.v}`, s * 0.06, yy, fs * 0.92, x.info ? C.c : C.c);
          yy += lh;
        }
      if (yy > s * 0.95) break;
    }
  } else {
    for (const m of f.memo) {
      if (m.title) {
        txt(g, m.t, s * 0.04, yy, fs, C.w);
        g.fillStyle = C.w;
        g.fillRect(s * 0.04, yy + fs * 0.55, g.measureText(m.t).width, 1.5);
        yy -= 0;
        txt(g, '', s * 0.1, yy, fs, C.w);
        yy += 0;
        continue;
      }
      const xoff = s * 0.13;
      if (m.g) txt(g, m.t, xoff, yy, fs, C.g);
      else txt(g, `${m.t} ${'.'.repeat(Math.max(2, 16 - m.t.length))}${m.v}`, xoff, yy, fs, C.c);
      yy += lh;
    }
  }
  let ry = s * 0.72;
  for (const r of f.rightMemo.slice(0, 7)) {
    txt(g, r.t, s * 0.64, ry, fs * 0.92, r.c === 'a' ? C.a : C.g);
    ry += lh;
  }
  if (sys.fwc.statusPending && !(f.shown && f.shown.length)) txt(g, 'STS', s * 0.58, s * 0.96, fs, C.w, 'center');
  g.restore();
}

// ================================================================== SD (lower ECAM)
function sdTitle(g?: any, s?: any, t?: any, fs?: any) {
  txt(g, t, s * 0.03, s * 0.05, fs * 1.2, C.w);
  g.fillStyle = C.w;
  g.font = `${fs * 1.2}px ${FONT}`;
  g.fillRect(s * 0.03, s * 0.075, g.measureText(t).width, 1.5);
}
function valve(g?: any, x?: any, y?: any, open?: any, col?: any, horiz?: any) {
  g.strokeStyle = col || C.g;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, 9, 0, TAU);
  g.stroke();
  if (open === horiz) line(g, x - 9, y, x + 9, y, col || C.g, 2);
  else line(g, x, y - 9, x, y + 9, col || C.g, 2);
}
function drawSD(g?: any, x0?: any, y0?: any, s?: any, st?: any) {
  const ac = st.ac,
    sys = st.sys;
  frame(g, x0, y0, s);
  if (!st.powered) return;
  g.save();
  g.translate(x0, y0);
  const fs = s * 0.042;
  const page = sys.page;
  const pages: any = { ENG: sdENG, BLEED: sdBLEED, PRESS: sdPRESS, ELEC: sdELEC, HYD: sdHYD, FUEL: sdFUEL, APU: sdAPU, COND: sdCOND, DOOR: sdDOOR, WHEEL: sdWHEEL, 'F/CTL': sdFCTL, STS: sdSTS, CRUISE: sdCRUISE };
  (pages[page] || sdCRUISE)(g, s, st, fs);
  // permanent data
  line(g, 0, s * 0.86, s, s * 0.86, C.w, 1.5);
  const atm = ac.atm || { tempC: 15 };
  const sat = atm.tempC;
  const tat = sat + (ac.tas * ac.tas) / 2010;
  txt(g, 'TAT', s * 0.03, s * 0.9, fs * 0.9, C.w);
  txt(g, `${tat >= 0 ? '+' : ''}${Math.round(tat)}`, s * 0.17, s * 0.9, fs, C.g, 'right');
  txt(g, '°C', s * 0.18, s * 0.9, fs * 0.8, C.c);
  txt(g, 'SAT', s * 0.03, s * 0.95, fs * 0.9, C.w);
  txt(g, `${sat >= 0 ? '+' : ''}${Math.round(sat)}`, s * 0.17, s * 0.95, fs, C.g, 'right');
  txt(g, '°C', s * 0.18, s * 0.95, fs * 0.8, C.c);
  const hh = Math.floor(st.hours - 3.5 + 24) % 24,
    mm = Math.floor((st.hours % 1) * 60);
  txt(g, `${String(hh).padStart(2, '0')} H ${String(mm).padStart(2, '0')}`, s * 0.5, s * 0.925, fs * 1.1, C.g, 'center');
  txt(g, 'GMT', s * 0.5, s * 0.965, fs * 0.8, C.w, 'center');
  txt(g, 'GW', s * 0.72, s * 0.9, fs * 0.9, C.w);
  txt(g, String(Math.round(ac.mass / 100) * 100), s * 0.95, s * 0.9, fs, C.g, 'right');
  txt(g, 'KG', s * 0.97, s * 0.9, fs * 0.8, C.c);
  txt(g, 'GWCG', s * 0.72, s * 0.95, fs * 0.9, C.w);
  txt(g, '28.0', s * 0.95, s * 0.95, fs, C.g, 'right');
  txt(g, '%', s * 0.97, s * 0.95, fs * 0.8, C.c);
  g.restore();
}
function sdENG(g?: any, s?: any, st?: any, fs?: any) {
  const ac = st.ac;
  sdTitle(g, s, 'ENGINE', fs);
  const E = ac.eng;
  const rows = [
    ['F.USED', 'KG', (e?: any) => String(Math.round(e.fuelUsed / 10) * 10)],
    ['OIL', 'QT', (e?: any) => e.oilQ.toFixed(1)],
    ['PSI', '', (e?: any) => String(Math.round(e.oilP))],
    ['°C', '', (e?: any) => String(Math.round(e.oilT))],
    ['VIB N1', '', (e?: any) => (e.running ? (0.4 + e.n1 / 200).toFixed(1) : '0.0')],
    ['VIB N2', '', (e?: any) => (e.running ? (0.5 + e.n2 / 250).toFixed(1) : '0.0')],
  ];
  rows.forEach((r?: any, k?: any) => {
    const y = s * (0.16 + k * 0.1);
    txt(g, r[0], s * 0.5, y, fs, C.w, 'center');
    if (r[1]) txt(g, r[1], s * 0.5, y + s * 0.035, fs * 0.8, C.c, 'center');
    txt(g, r[2](E[0]), s * 0.25, y, fs * 1.1, C.g, 'center');
    txt(g, r[2](E[1]), s * 0.75, y, fs * 1.1, C.g, 'center');
  });
  // start valves / bleed
  for (let i = 0; i < 2; i++) {
    const x = s * (i ? 0.75 : 0.25);
    valve(g, x, s * 0.75, E[i].startValve, E[i].startValve ? C.g : C.g, false);
    txt(g, String(Math.round(st.sys.bleed.ductP[i])), x + s * 0.08, s * 0.8, fs, C.g, 'center');
    if (E[i].ign) txt(g, 'IGN A', x - s * 0.1, s * 0.8, fs * 0.9, C.g, 'center');
  }
  txt(g, 'PSI', s * 0.5, s * 0.8, fs * 0.8, C.c, 'center');
}
function sdBLEED(g?: any, s?: any, st?: any, fs?: any) {
  const sys = st.sys,
    ac = st.ac;
  sdTitle(g, s, 'BLEED', fs);
  const B = sys.bleed;
  // duct
  line(g, s * 0.2, s * 0.35, s * 0.8, s * 0.35, C.g, 2);
  valve(g, s * 0.5, s * 0.35, B.xOpen, C.g, true);
  txt(g, 'X BLEED', s * 0.5, s * 0.29, fs * 0.8, C.w, 'center');
  for (let i = 0; i < 2; i++) {
    const x = s * (i ? 0.8 : 0.2);
    line(g, x, s * 0.35, x, s * 0.7, C.g, 2);
    const on = B.eng[i] && ac.eng[i].running;
    valve(g, x, s * 0.58, on, on ? C.g : C.a, false);
    txt(g, String(i + 1), x - s * 0.06, s * 0.58, fs, C.w, 'center');
    txt(g, `${Math.round(B.ductP[i])}`, x, s * 0.47, fs, C.g, 'center');
    txt(g, 'PSI', x + s * 0.06, s * 0.47, fs * 0.8, C.c);
    txt(g, `${Math.round(150 + B.ductP[i] * 3)}`, x, s * 0.43, fs, C.g, 'center');
    // packs
    const pk = sys.packOn[i];
    rect(g, x - s * 0.08, s * 0.15, s * 0.16, s * 0.09, pk ? C.g : C.a, 1.5);
    txt(g, `PACK ${i + 1}`, x, s * 0.195, fs * 0.9, pk ? C.g : C.a, 'center');
    line(g, x, s * 0.24, x, s * 0.35, C.g, 2);
    txt(g, 'HP', x + s * 0.06, s * 0.66, fs * 0.8, C.w);
    txt(g, 'IP', x + s * 0.06, s * 0.72, fs * 0.8, C.w);
  }
  // APU bleed
  const apu = sys.apu;
  line(g, s * 0.2, s * 0.35, s * 0.2, s * 0.35, C.g);
  line(g, s * 0.35, s * 0.35, s * 0.35, s * 0.52, apu.avail ? C.g : '#777', 2);
  valve(g, s * 0.35, s * 0.52, apu.avail && apu.bleed, apu.avail ? C.g : '#777', false);
  txt(g, 'APU', s * 0.35, s * 0.6, fs, C.w, 'center');
  txt(g, 'RAM AIR', s * 0.5, s * 0.15, fs * 0.8, C.w, 'center');
}
function sdPRESS(g?: any, s?: any, st?: any, fs?: any) {
  const P = st.sys.press;
  sdTitle(g, s, 'CAB PRESS', fs);
  txt(g, 'LDG ELEV', s * 0.55, s * 0.05, fs * 0.9, C.w);
  txt(g, 'AUTO', s * 0.78, s * 0.05, fs * 0.9, C.g);
  txt(g, `${Math.round((P.ldgElev != null ? P.ldgElev : (st.env && st.env.destElev ? st.env.destElev / FT : 3900)) / 50) * 50}`, s * 0.97, s * 0.05, fs, C.g, 'right');
  const gauge = (cx?: any, label?: any, unit?: any, val?: any, min?: any, max?: any, fmt?: any, amberHi?: any) => {
    const r = s * 0.1;
    g.strokeStyle = C.w;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, s * 0.32, r, Math.PI * 0.8, Math.PI * 2.2);
    g.stroke();
    const a = Math.PI * 0.8 + clamp((val - min) / (max - min), 0, 1) * Math.PI * 1.4;
    line(g, cx, s * 0.32, cx + Math.cos(a) * r, s * 0.32 + Math.sin(a) * r, amberHi && val > amberHi ? C.a : C.g, 3);
    txt(g, label, cx, s * 0.18, fs * 0.9, C.w, 'center');
    txt(g, fmt(val), cx, s * 0.45, fs * 1.1, amberHi && val > amberHi ? C.a : C.g, 'center');
    txt(g, unit, cx, s * 0.49, fs * 0.8, C.c, 'center');
  };
  gauge(s * 0.2, 'ΔP', 'PSI', P.dp, -1, 9, (v?: any) => v.toFixed(1), 8.5);
  gauge(s * 0.5, 'V/S', 'FT/MIN', P.cabVs, -2000, 2000, (v?: any) => String(Math.round(v / 50) * 50), 1800);
  gauge(s * 0.8, 'CAB ALT', 'FT', P.cabAlt, -625, 10000, (v?: any) => String(Math.round(v / 50) * 50), 9550);
  // outflow valve
  txt(g, 'OUTFLOW', s * 0.55, s * 0.6, fs * 0.8, C.w);
  const ov = P.outflow / 100;
  g.strokeStyle = C.g;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(s * 0.8, s * 0.7, s * 0.07, Math.PI, Math.PI * 1.5);
  g.stroke();
  line(g, s * 0.8, s * 0.7, s * 0.8 - Math.cos(ov * Math.PI / 2) * s * 0.07, s * 0.7 - Math.sin(ov * Math.PI / 2) * s * 0.07, C.g, 3);
  for (let i = 0; i < 2; i++) {
    rect(g, s * (0.1 + i * 0.25), s * 0.66, s * 0.16, s * 0.07, st.sys.packOn[i] ? C.g : C.a, 1.5);
    txt(g, `PACK ${i + 1}`, s * (0.18 + i * 0.25), s * 0.695, fs * 0.9, st.sys.packOn[i] ? C.g : C.a, 'center');
  }
  txt(g, 'SYS 1', s * 0.1, s * 0.58, fs * 0.9, C.g);
}
function sdELEC(g?: any, s?: any, st?: any, fs?: any) {
  const el = st.sys.elec,
    ac = st.ac;
  sdTitle(g, s, 'ELEC', fs);
  const box = (x?: any, y?: any, w?: any, h?: any, title?: any, lines?: any, ok?: any) => {
    rect(g, x, y, w, h, ok ? C.w : C.a, 1.5);
    txt(g, title, x + w / 2, y + s * 0.025, fs * 0.9, ok ? C.w : C.a, 'center');
    lines.forEach((l?: any, k?: any) => txt(g, l, x + w / 2, y + s * (0.06 + k * 0.035), fs * 0.9, C.g, 'center'));
  };
  box(s * 0.03, s * 0.1, s * 0.2, s * 0.12, 'BAT 1', [`${el.batV[0].toFixed(0)} V`, `${el.batA[0].toFixed(0)} A`], el.bat[0]);
  box(s * 0.77, s * 0.1, s * 0.2, s * 0.12, 'BAT 2', [`${el.batV[1].toFixed(0)} V`, `${el.batA[1].toFixed(0)} A`], el.bat[1]);
  const bus = (x?: any, y?: any, w?: any, t?: any, on?: any) => {
    g.fillStyle = on ? '#1c1c1c' : '#1c1c1c';
    rect(g, x, y, w, s * 0.045, on ? C.g : C.a, 1.5);
    txt(g, t, x + w / 2, y + s * 0.023, fs * 0.9, on ? C.g : C.a, 'center');
  };
  bus(s * 0.3, s * 0.12, s * 0.4, 'DC BAT', el.dcPowered);
  bus(s * 0.03, s * 0.3, s * 0.22, 'DC 1', el.acPowered);
  bus(s * 0.39, s * 0.3, s * 0.22, 'DC ESS', el.dcPowered);
  bus(s * 0.75, s * 0.3, s * 0.22, 'DC 2', el.acPowered);
  bus(s * 0.03, s * 0.48, s * 0.22, 'AC 1', el.genOn[0] || el.apuGenOn || el.extOn);
  bus(s * 0.39, s * 0.48, s * 0.22, 'AC ESS', el.acEss);
  bus(s * 0.75, s * 0.48, s * 0.22, 'AC 2', el.genOn[1] || el.apuGenOn || el.extOn);
  box(s * 0.03, s * 0.6, s * 0.2, s * 0.16, 'GEN 1', el.genOn[0] ? ['38 %', '115 V', '400 HZ'] : [], el.genOn[0] || !ac.eng[0].running === false);
  box(s * 0.77, s * 0.6, s * 0.2, s * 0.16, 'GEN 2', el.genOn[1] ? ['36 %', '115 V', '400 HZ'] : [], el.genOn[1] || !ac.eng[1].running === false);
  box(s * 0.28, s * 0.62, s * 0.2, s * 0.14, 'APU GEN', el.apuGenOn ? ['24 %', '115 V', '400 HZ'] : [], true);
  box(s * 0.52, s * 0.62, s * 0.2, s * 0.14, 'EXT PWR', el.extOn ? ['115 V', '400 HZ'] : el.extPwrAvail ? ['AVAIL'] : [], true);
  if (el.emerGen) txt(g, 'EMER GEN', s * 0.5, s * 0.8, fs, C.g, 'center');
  txt(g, 'IDG 1', s * 0.08, s * 0.8, fs * 0.8, C.w);
  txt(g, 'IDG 2', s * 0.82, s * 0.8, fs * 0.8, C.w);
}
function sdHYD(g?: any, s?: any, st?: any, fs?: any) {
  const H = st.sys.hyd,
    ac = st.ac;
  sdTitle(g, s, 'HYD', fs);
  const cols: any[] = [['GREEN', 'G', s * 0.2], ['BLUE', 'B', s * 0.5], ['YELLOW', 'Y', s * 0.8]];
  for (const [name, k, x] of cols) {
    const h = H[k];
    const ok = h.press > 1450;
    const col = ok ? C.g : C.a;
    txt(g, name, x, s * 0.1, fs * 1.1, col, 'center');
    txt(g, String(Math.round(h.press / 50) * 50), x, s * 0.16, fs * 1.2, col, 'center');
    line(g, x, s * 0.19, x, s * 0.5, col, 3);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, s * 0.19);
    g.lineTo(x - 8, s * 0.23);
    g.lineTo(x + 8, s * 0.23);
    g.fill();
    // pump
    const pumpOn = k === 'G' ? h.edp && ac.eng[0].running : k === 'Y' ? h.edp && ac.eng[1].running : h.elecPump && st.sys.elec.acPowered && (ac.eng[0].running || ac.eng[1].running);
    rect(g, x - s * 0.045, s * 0.5, s * 0.09, s * 0.07, pumpOn && h.qty > 3 ? C.g : C.a, 2);
    if (pumpOn && h.qty > 3) line(g, x, s * 0.5, x, s * 0.57, C.g, 2);
    else line(g, x - s * 0.03, s * 0.535, x + s * 0.03, s * 0.535, C.a, 2);
    txt(g, k === 'B' ? 'ELEC' : String(k === 'G' ? 1 : 2), x, s * 0.61, fs * 0.9, C.w, 'center');
    // reservoir
    const q = h.qty / (k === 'G' ? 14 : k === 'Y' ? 12.5 : 6.5);
    rect(g, x - s * 0.012, s * 0.66, s * 0.024, s * 0.14, C.w, 1);
    g.fillStyle = q < 0.3 ? C.a : C.g;
    g.fillRect(x - s * 0.01, s * 0.8 - q * s * 0.14, s * 0.02, q * s * 0.14);
    g.fillStyle = C.r;
    g.fillRect(x - s * 0.02, s * 0.8 - 0.25 * s * 0.14, s * 0.04, 2);
    if (h.leak > 0 && h.qty < 3.5) txt(g, 'LO LVL', x + s * 0.03, s * 0.74, fs * 0.8, C.a);
  }
  // PTU
  txt(g, 'PTU', s * 0.5, s * 0.34, fs, H.ptu ? C.g : C.a, 'center');
  line(g, s * 0.2, s * 0.37, s * 0.42, s * 0.37, H.ptu ? C.g : C.a, 2);
  line(g, s * 0.58, s * 0.37, s * 0.8, s * 0.37, H.ptu ? C.g : C.a, 2);
  if (H.ptuRunning) {
    g.fillStyle = C.g;
    g.beginPath();
    g.moveTo(s * 0.44, s * 0.37);
    g.lineTo(s * 0.41, s * 0.35);
    g.lineTo(s * 0.41, s * 0.39);
    g.fill();
  }
  // RAT
  txt(g, 'RAT', s * 0.42, s * 0.46, fs * 0.9, C.w, 'center');
  if (H.ratOut) txt(g, '▼', s * 0.46, s * 0.46, fs, C.g);
  txt(g, 'ELEC', s * 0.9, s * 0.61, fs * 0.9, C.w, 'center');
  rect(g, s * 0.86, s * 0.5, s * 0.08, s * 0.06, H.Y.elecPump ? C.g : C.w, 1.5);
}
function sdFUEL(g?: any, s?: any, st?: any, fs?: any) {
  const T = st.sys.tanks,
    sys = st.sys,
    ac = st.ac;
  sdTitle(g, s, 'FUEL', fs);
  txt(g, 'F.USED', s * 0.5, s * 0.1, fs * 0.9, C.w, 'center');
  txt(g, String(Math.round((ac.eng[0].fuelUsed + ac.eng[1].fuelUsed) / 10) * 10), s * 0.5, s * 0.15, fs * 1.1, C.g, 'center');
  txt(g, 'KG', s * 0.58, s * 0.15, fs * 0.8, C.c);
  // wing outline
  g.strokeStyle = C.w;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(s * 0.03, s * 0.6);
  g.lineTo(s * 0.35, s * 0.45);
  g.lineTo(s * 0.65, s * 0.45);
  g.lineTo(s * 0.97, s * 0.6);
  g.lineTo(s * 0.97, s * 0.72);
  g.lineTo(s * 0.03, s * 0.72);
  g.closePath();
  g.stroke();
  const tank = (x?: any, v?: any, lbl?: any) => {
    txt(g, String(Math.round(v / 10) * 10), x, s * 0.64, fs * 1.1, C.g, 'center');
    txt(g, lbl, x, s * 0.69, fs * 0.7, C.w, 'center');
  };
  tank(s * 0.1, T.LO, 'OUTR');
  tank(s * 0.28, T.LI, 'INR');
  tank(s * 0.5, T.C, 'CTR');
  tank(s * 0.72, T.RI, 'INR');
  tank(s * 0.9, T.RO, 'OUTR');
  const pumps = sys.fuel.pumps;
  [['L1', 0.24], ['L2', 0.32], ['C1', 0.46], ['C2', 0.54], ['R1', 0.68], ['R2', 0.76]].forEach(([k, x]: any) => {
    rect(g, s * x - 9, s * 0.5, 18, 18, pumps[k] ? C.g : C.a, 1.5);
    if (pumps[k]) line(g, s * x, s * 0.5, s * x, s * 0.5 + 18, C.g, 2);
  });
  valve(g, s * 0.5, s * 0.36, sys.fuel.xfeed, sys.fuel.xfeed ? C.g : C.g, true);
  txt(g, 'X FEED', s * 0.5, s * 0.3, fs * 0.8, C.w, 'center');
  for (let i = 0; i < 2; i++) {
    const x = s * (i ? 0.72 : 0.28);
    txt(g, String(i + 1), x, s * 0.22, fs * 1.1, st.sys.eng.master[i] ? C.w : C.a, 'center');
    valve(g, x, s * 0.3, st.sys.eng.master[i], st.sys.eng.master[i] ? C.g : C.a, false);
  }
  txt(g, 'FOB', s * 0.03, s * 0.8, fs, C.w);
  txt(g, String(Math.round(sys.fob() / 10) * 10), s * 0.3, s * 0.8, fs * 1.2, C.g, 'right');
  txt(g, 'KG', s * 0.32, s * 0.8, fs * 0.8, C.c);
  txt(g, 'APU', s * 0.1, s * 0.4, fs * 0.9, sys.apu.n > 50 ? C.g : C.w);
}
function sdAPU(g?: any, s?: any, st?: any, fs?: any) {
  const A = st.sys.apu,
    el = st.sys.elec;
  sdTitle(g, s, 'APU', fs);
  if (A.avail) txt(g, 'AVAIL', s * 0.5, s * 0.08, fs * 1.2, C.g, 'center');
  rect(g, s * 0.05, s * 0.12, s * 0.22, s * 0.16, el.apuGenOn ? C.g : C.w, 1.5);
  txt(g, 'APU GEN', s * 0.16, s * 0.15, fs * 0.9, C.w, 'center');
  if (el.apuGenOn) ['24 %', '115 V', '400 HZ'].forEach((l?: any, k?: any) => txt(g, l, s * 0.16, s * (0.19 + k * 0.03), fs * 0.9, C.g, 'center'));
  txt(g, 'APU BLEED', s * 0.75, s * 0.14, fs * 0.9, C.w, 'center');
  txt(g, `${A.avail && A.bleed ? 35 : 0} PSI`, s * 0.75, s * 0.19, fs, C.g, 'center');
  valve(g, s * 0.75, s * 0.28, A.avail && A.bleed, C.g, false);
  const gauge = (cy?: any, lbl?: any, v?: any, max?: any, red?: any, unit?: any, fmt?: any) => {
    const r = s * 0.09,
      cx = s * 0.3;
    g.strokeStyle = C.w;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI, Math.PI * 1.9);
    g.stroke();
    const a = Math.PI + clamp(v / max, 0, 1) * Math.PI * 0.9;
    line(g, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, v > red ? C.a : C.g, 3);
    txt(g, lbl, cx + r + s * 0.05, cy - s * 0.02, fs, C.w);
    txt(g, fmt(v), cx + r + s * 0.05, cy + s * 0.03, fs * 1.1, C.g);
    txt(g, unit, cx + r + s * 0.2, cy + s * 0.03, fs * 0.8, C.c);
  };
  gauge(s * 0.5, 'N', A.n, 110, 101, '%', (v?: any) => String(Math.round(v)));
  gauge(s * 0.72, 'EGT', A.egt, 1100, 900, '°C', (v?: any) => String(Math.round(v / 5) * 5));
  txt(g, A.flap >= 1 ? 'FLAP OPEN' : '', s * 0.75, s * 0.5, fs, C.g, 'center');
}
function sdCOND(g?: any, s?: any, st?: any, fs?: any) {
  const c = st.sys.cond;
  sdTitle(g, s, 'COND', fs);
  txt(g, 'TEMP : °C', s * 0.97, s * 0.05, fs * 0.9, C.w, 'right');
  g.strokeStyle = C.w;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(s * 0.05, s * 0.4);
  g.quadraticCurveTo(s * 0.1, s * 0.2, s * 0.25, s * 0.2);
  g.lineTo(s * 0.9, s * 0.2);
  g.lineTo(s * 0.95, s * 0.4);
  g.lineTo(s * 0.05, s * 0.4);
  g.stroke();
  [['CKPT', c.ckpt, 0.2], ['FWD', c.fwd, 0.45], ['AFT', c.aft, 0.72]].forEach(([n, v, x]: any) => {
    txt(g, n, s * x, s * 0.26, fs, C.w, 'center');
    txt(g, String(Math.round(v)), s * x, s * 0.33, fs * 1.2, C.g, 'center');
  });
  txt(g, 'HOT AIR', s * 0.5, s * 0.55, fs, C.w, 'center');
  valve(g, s * 0.5, s * 0.62, true, C.g, true);
}
function sdDOOR(g?: any, s?: any, st?: any, fs?: any) {
  const D = st.sys.doors;
  sdTitle(g, s, 'DOOR/OXY', fs);
  g.strokeStyle = C.w;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(s * 0.5, s * 0.08);
  g.quadraticCurveTo(s * 0.62, s * 0.12, s * 0.62, s * 0.25);
  g.lineTo(s * 0.62, s * 0.78);
  g.lineTo(s * 0.5, s * 0.84);
  g.lineTo(s * 0.38, s * 0.78);
  g.lineTo(s * 0.38, s * 0.25);
  g.quadraticCurveTo(s * 0.38, s * 0.12, s * 0.5, s * 0.08);
  g.stroke();
  const door = (x?: any, y?: any, open?: any, label?: any, left?: any) => {
    g.fillStyle = open ? C.a : C.g;
    g.fillRect(x - 6, y - 10, 12, 20);
    if (open) txt(g, label, left ? x - 12 : x + 12, y, fs * 0.85, C.a, left ? 'right' : 'left');
  };
  door(s * 0.38, s * 0.24, D.cabin['FWD L'], 'CABIN', true);
  door(s * 0.62, s * 0.24, D.cabin['FWD R'], 'CABIN', false);
  door(s * 0.38, s * 0.74, D.cabin['AFT L'], 'CABIN', true);
  door(s * 0.62, s * 0.74, D.cabin['AFT R'], 'CABIN', false);
  door(s * 0.62, s * 0.36, D.cargo.FWD, 'CARGO', false);
  door(s * 0.62, s * 0.62, D.cargo.AFT, 'CARGO', false);
  txt(g, D.slides ? 'SLIDE' : '', s * 0.3, s * 0.3, fs * 0.8, C.w, 'center');
  txt(g, 'CKPT OXY', s * 0.97, s * 0.12, fs * 0.9, C.w, 'right');
  txt(g, '1850 PSI', s * 0.97, s * 0.17, fs, C.g, 'right');
}
function sdWHEEL(g?: any, s?: any, st?: any, fs?: any) {
  const ac = st.ac;
  sdTitle(g, s, 'WHEEL', fs);
  const gearCol = ac.gearPos > 0.99 ? C.g : ac.gearPos < 0.01 ? '#444' : C.r;
  const tri = (x?: any, y?: any) => {
    g.fillStyle = gearCol;
    g.beginPath();
    g.moveTo(x - 12, y - 10);
    g.lineTo(x + 12, y - 10);
    g.lineTo(x, y + 10);
    g.closePath();
    if (ac.gearPos > 0.01) g.fill();
  };
  tri(s * 0.5, s * 0.16);
  tri(s * 0.2, s * 0.4);
  tri(s * 0.8, s * 0.4);
  txt(g, ac.brakeSrc === 'NORM' ? '' : ac.brakeSrc === 'ALTN' ? 'ALTN BRK' : 'ALTN BRK ACCU ONLY', s * 0.5, s * 0.32, fs * 0.8, C.a, 'center');
  txt(g, 'N/W STEERING', s * 0.5, s * 0.08, fs * 0.8, st.sys.hyd.Y.press > 1450 ? '#000' : C.a, 'center');
  const temps = ac.brakeTemp;
  ['1', '2', '3', '4'].forEach((n?: any, k?: any) => {
    const x = s * (k < 2 ? 0.12 + k * 0.14 : 0.6 + (k - 2) * 0.14);
    rect(g, x, s * 0.52, s * 0.1, s * 0.12, C.w, 1.5);
    txt(g, String(Math.round(temps[k] / 5) * 5), x + s * 0.05, s * 0.55, fs, temps[k] > 300 ? C.a : C.g, 'center');
    txt(g, n, x + s * 0.05, s * 0.61, fs * 0.9, C.w, 'center');
  });
  txt(g, '°C', s * 0.5, s * 0.55, fs * 0.8, C.c, 'center');
  txt(g, 'REL', s * 0.5, s * 0.61, fs * 0.8, C.w, 'center');
  const ab = ac.ctl.autobrake;
  if (ab !== 'OFF') txt(g, `AUTO BRK ${ab}`, s * 0.5, s * 0.72, fs, C.g, 'center');
  if (!ac.onGround) txt(g, 'LG CTL', s * 0.1, s * 0.12, fs * 0.8, C.w);
  txt(g, `ACCU ${Math.round(ac.accum)} PSI`, s * 0.5, s * 0.78, fs * 0.8, C.g, 'center');
}
function sdFCTL(g?: any, s?: any, st?: any, fs?: any) {
  const ac = st.ac,
    sys = st.sys;
  sdTitle(g, s, 'F/CTL', fs);
  const hy = (k?: any) => (sys.hyd[k].press > 1450 ? C.g : C.a);
  const hs = (x?: any, y?: any, list?: any) => list.forEach((k?: any, i?: any) => txt(g, k, x + i * s * 0.035, y, fs * 0.9, hy(k), 'center'));
  // spoilers
  txt(g, 'SPD BRK', s * 0.5, s * 0.1, fs * 0.9, C.w, 'center');
  for (let k = 0; k < 5; k++) {
    const hyd = ['G', 'Y', 'B', 'Y', 'G'][k];
    for (const side of [0, 1]) {
      const x = s * (side ? 0.58 + k * 0.07 : 0.42 - k * 0.07);
      const up = ac.surf.spl[k + side * 5] > 3;
      const col = sys.hyd[hyd].press > 1450 ? C.g : C.a;
      line(g, x - 10, s * 0.2, x + 10, s * 0.2, col, 2);
      if (up) line(g, x, s * 0.2, x, s * 0.14, col, 3);
      txt(g, String(k + 1), x, s * 0.235, fs * 0.8, C.w, 'center');
    }
  }
  // ailerons
  const ail = (x?: any, v?: any, lbl?: any) => {
    line(g, x, s * 0.3, x, s * 0.5, C.w, 1.5);
    const yy = s * 0.4 + clamp(v, -1, 1) * s * 0.09;
    g.fillStyle = C.g;
    g.beginPath();
    g.moveTo(x - 4, yy);
    g.lineTo(x - 14, yy - 6);
    g.lineTo(x - 14, yy + 6);
    g.fill();
    txt(g, lbl, x, s * 0.27, fs * 0.9, C.w, 'center');
  };
  ail(s * 0.12, ac.surf.ail, 'L AIL');
  ail(s * 0.88, -ac.surf.ail, 'R AIL');
  hs(s * 0.08, s * 0.54, ['B', 'G']);
  hs(s * 0.84, s * 0.54, ['G', 'B']);
  // elevators
  const el = (x?: any, lbl?: any, hyds?: any) => {
    line(g, x, s * 0.6, x, s * 0.78, C.w, 1.5);
    const yy = s * 0.69 - clamp(ac.surf.elev / (30 * DEG), -1, 1) * s * 0.08;
    g.fillStyle = C.g;
    g.beginPath();
    g.moveTo(x - 4, yy);
    g.lineTo(x - 14, yy - 6);
    g.lineTo(x - 14, yy + 6);
    g.fill();
    txt(g, lbl, x, s * 0.58, fs * 0.9, C.w, 'center');
    hs(x - s * 0.02, s * 0.81, hyds);
  };
  el(s * 0.28, 'L ELEV', ['B', 'G']);
  el(s * 0.72, 'R ELEV', ['Y', 'B']);
  // pitch trim
  txt(g, 'PITCH TRIM', s * 0.5, s * 0.34, fs * 0.9, C.w, 'center');
  txt(g, `${Math.abs(ac.ths).toFixed(1)}° ${ac.ths >= 0 ? 'UP' : 'DN'}`, s * 0.5, s * 0.39, fs, ac.fbw.pitchTrimAvail ? C.g : C.a, 'center');
  hs(s * 0.48, s * 0.44, ['G', 'Y']);
  // rudder
  txt(g, 'RUD', s * 0.5, s * 0.55, fs * 0.9, C.w, 'center');
  g.strokeStyle = C.w;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(s * 0.5, s * 0.58, s * 0.1, 0.25 * Math.PI, 0.75 * Math.PI);
  g.stroke();
  const ra = Math.PI / 2 - ac.surf.rud * 0.25 * Math.PI;
  line(g, s * 0.5, s * 0.58, s * 0.5 + Math.cos(ra) * s * 0.1, s * 0.58 + Math.sin(ra) * s * 0.1, C.g, 3);
  hs(s * 0.465, s * 0.74, ['G', 'B', 'Y']);
  txt(g, 'ELAC', s * 0.06, s * 0.66, fs * 0.8, C.w);
  txt(g, '1 2', s * 0.06, s * 0.7, fs * 0.9, C.g);
  txt(g, 'SEC', s * 0.9, s * 0.66, fs * 0.8, C.w);
  txt(g, '1 2 3', s * 0.88, s * 0.7, fs * 0.9, C.g);
  txt(g, `LAW: ${ac.fbw.law}`, s * 0.97, s * 0.05, fs * 0.9, ac.fbw.law === 'NORMAL' ? C.g : C.a, 'right');
}
function sdSTS(g?: any, s?: any, st?: any, fs?: any) {
  const S = st.sys.fwc.status;
  sdTitle(g, s, 'STATUS', fs);
  if (!S) {
    txt(g, 'NORMAL', s * 0.5, s * 0.4, fs * 1.3, C.g, 'center');
    return;
  }
  let y = s * 0.13;
  const lh = s * 0.037;
  for (const l of S.lim) {
    txt(g, l, s * 0.03, y, fs * 0.9, C.c);
    y += lh;
  }
  for (const l of S.info) {
    txt(g, l, s * 0.03, y, fs * 0.9, C.w);
    y += lh;
  }
  line(g, s * 0.6, s * 0.1, s * 0.6, s * 0.84, C.w, 1);
  txt(g, 'INOP SYS', s * 0.63, s * 0.13, fs * 0.9, C.w);
  let y2 = s * 0.17;
  for (const l of S.inop) {
    txt(g, l, s * 0.63, y2, fs * 0.85, C.a);
    y2 += lh;
  }
}
function sdCRUISE(g?: any, s?: any, st?: any, fs?: any) {
  const ac = st.ac,
    P = st.sys.press;
  sdTitle(g, s, 'CRUISE', fs);
  txt(g, 'ENG', s * 0.5, s * 0.1, fs, C.w, 'center');
  txt(g, 'F.USED', s * 0.5, s * 0.16, fs * 0.9, C.w, 'center');
  txt(g, String(Math.round(ac.eng[0].fuelUsed)), s * 0.3, s * 0.16, fs, C.g, 'center');
  txt(g, String(Math.round(ac.eng[1].fuelUsed)), s * 0.7, s * 0.16, fs, C.g, 'center');
  txt(g, 'OIL', s * 0.5, s * 0.22, fs * 0.9, C.w, 'center');
  txt(g, ac.eng[0].oilQ.toFixed(1), s * 0.3, s * 0.22, fs, C.g, 'center');
  txt(g, ac.eng[1].oilQ.toFixed(1), s * 0.7, s * 0.22, fs, C.g, 'center');
  txt(g, 'AIR', s * 0.05, s * 0.36, fs, C.w);
  txt(g, `LDG ELEV AUTO`, s * 0.55, s * 0.36, fs * 0.9, C.w);
  txt(g, `ΔP ${P.dp.toFixed(1)} PSI`, s * 0.1, s * 0.45, fs, C.g);
  txt(g, `CAB V/S ${Math.round(P.cabVs / 10) * 10} FT/MIN`, s * 0.1, s * 0.52, fs, C.g);
  txt(g, `CAB ALT ${Math.round(P.cabAlt / 10) * 10} FT`, s * 0.1, s * 0.59, fs, C.g);
  const c = st.sys.cond;
  txt(g, `CKPT ${Math.round(c.ckpt)}   FWD ${Math.round(c.fwd)}   AFT ${Math.round(c.aft)}  °C`, s * 0.1, s * 0.72, fs, C.g);
}

export const A320DU: any = { drawPFD, drawND, drawEWD, drawSD, C, txt, line, rect, FONT };

export { indAlt as a320IndAlt };
