/*
 * A320 2D cockpit: glareshield (EFIS CP + FCU + master lights), the 4 display units (PFD, ND, E/WD, SD) and a
 * pedestal strip (sidestick, thrust levers, flaps, speed brake, gear, autobrake, engine masters/mode, ECAM control
 * panel, RMP). An overhead panel opens as a separate pop-up canvas. Everything is clickable / wheel-adjustable.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const DU = () => FS.A320DU;
  const TAU = Math.PI * 2;
  const BLUE = '#35d8ff',
    GREEN = '#3dff5a',
    AMBER = '#ffa21a',
    WHITE = '#f4f4f4',
    RED = '#ff3030';

  class Regions {
    constructor(canvas) {
      this.list = [];
      this.cv = canvas;
      FS.bindRegions(canvas, (x, y) => this.hit(x, y), { hover: (r) => (this.tip = r ? r.tip : null) });
    }
    hit(x, y) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const r = this.list[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
      }
      return null;
    }
    add(x, y, w, h, o) {
      this.list.push(Object.assign({ x, y, w, h }, o));
    }
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function t(g, s, x, y, size, col, align) {
    g.fillStyle = col || WHITE;
    g.font = `bold ${size}px Arial, sans-serif`;
    g.textAlign = align || 'center';
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }
  // Airbus push button: upper legend (e.g. FAULT amber), lower legend (e.g. OFF white / ON blue)
  function pb(g, R, x, y, w, h, label, state, fn, tip) {
    g.fillStyle = '#26282c';
    rr(g, x, y, w, h, 3);
    g.fill();
    g.strokeStyle = '#0b0b0c';
    g.lineWidth = 1.5;
    g.stroke();
    const up = state && state.up,
      lo = state && state.lo;
    if (up) t(g, up.t, x + w / 2, y + h * 0.3, Math.min(h * 0.24, w * 0.2), up.c);
    if (lo) t(g, lo.t, x + w / 2, y + h * 0.72, Math.min(h * 0.24, w * 0.2), lo.c);
    if (label) t(g, label, x + w / 2, y - h * 0.18, Math.min(h * 0.22, w * 0.18), '#d8d8d8');
    if (fn) R.add(x, y, w, h, { click: fn, tip: tip || label });
  }
  function knob(g, x, y, r, col) {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    gr.addColorStop(0, '#6d7177');
    gr.addColorStop(1, '#1c1d20');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.strokeStyle = col || '#000';
    g.lineWidth = 1.5;
    g.stroke();
  }

  class A320Cockpit {
    constructor(canvas, ovhdCanvas, mcduCanvas, env) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.R = new Regions(canvas);
      this.ov = ovhdCanvas;
      this.og = ovhdCanvas.getContext('2d');
      this.RO = new Regions(ovhdCanvas);
      this.env = env; // { getAc, fm, sys, audio, onPushback ... }
      this.rmp = { active: 118.1, standby: 121.9 };
      this.chrono = null;
      this.compact = false; // phones: displays OR pedestal
      this.pedPage = false;
      this.side = 0;
    }
    resize(w, h, dpr) {
      this.W = w;
      this.H = h;
      this.dpr = dpr;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      this.cv.style.width = w + 'px';
      this.cv.style.height = h + 'px';
    }

    // ------------------------------------------------------------------ main panel
    draw(st) {
      const g = this.g,
        W = this.W,
        H = this.H;
      if (!W) return;
      this.R.list = [];
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = '#3d4247';
      g.fillRect(0, 0, W, H);
      const ac = st.ac,
        fm = st.fm,
        sys = st.sys;
      // layout — glareshield (~1040 u wide) and pedestal (~800 u wide) shrink to fit narrow screens. In compact mode
      // (phones) there is no room for both displays and pedestal, so one of them is shown (this.pedPage).
      const glH = Math.min(Math.max(46, H * 0.12), (W / 1040) * 46);
      const pedMax = (W / 800) * 130;
      const y = glH + 4;
      this.drawGlareshield(g, 0, 0, W, glH, st);
      if (this.compact && this.pedPage) {
        this.drawPedestal(g, 0, y, W, Math.min(H - y, pedMax), st);
      } else {
        const pedH = this.compact ? 0 : Math.min(Math.max(120, H * 0.3), pedMax);
        const duH = H - glH - pedH - (pedH ? 8 : 4);
        const side = this.side || 0; // room kept free left & right of the displays for the touch stick / thrust lever
        const du = Math.min(duH, (W - 2 * side - 20) / 4.12);
        const gap = (W - 2 * side - du * 4) / 5;
        const xs = [0, 1, 2, 3].map((i) => side + gap + i * (du + gap));
        DU().drawPFD(g, xs[0], y, du, st);
        DU().drawND(g, xs[1], y, du, st);
        DU().drawEWD(g, xs[2], y, du, st);
        DU().drawSD(g, xs[3], y, du, st);
        // ND range/mode quick controls via wheel on ND
        this.R.add(xs[1], y, du, du, { wheel: (d) => this.ndRange(d), tip: 'ND range (wheel)' });
        this.R.add(xs[3], y, du, du, { click: () => sys.clr(), tip: 'SD (click = CLR)' });
        if (pedH) this.drawPedestal(g, 0, y + duH + 4, W, pedH, st);
      }
      if (this.R.tip) t(g, this.R.tip, W - 8, H - 8, 11, '#aab', 'right');
    }
    ndRange(d) {
      const r = [10, 20, 40, 80, 160, 320];
      const fm = this.env.fm();
      const i = r.indexOf(fm.efis.range);
      fm.efis.range = r[FS.clamp(i + (d > 0 ? -1 : 1), 0, r.length - 1)];
    }

    drawGlareshield(g, x, y, w, h, st) {
      const fm = st.fm,
        f = fm.fcu,
        R = this.R,
        sys = st.sys,
        ac = st.ac;
      g.fillStyle = '#26292d';
      g.fillRect(x, y, w, h);
      const u = h / 46;
      // ---- EFIS CP (captain) left
      let cx = 8;
      // baro
      g.fillStyle = '#111';
      g.fillRect(cx, 6 * u, 72 * u, 18 * u);
      t(g, f.std[0] ? 'Std' : f.inHg ? (f.baro[0] / 33.8639).toFixed(2) : String(Math.round(f.baro[0])), cx + 36 * u, 15 * u, 13 * u, '#ffb040');
      R.add(cx, 4 * u, 72 * u, 22 * u, {
        wheel: (d, sh) => {
          f.std[0] = false;
          f.baro[0] = +(f.baro[0] + d * (sh ? 10 : 1)).toFixed(0);
          f.baro[1] = f.baro[0];
        },
        click: (d, rel, relY) => {
          if (relY > 0.5 || true) f.std[0] = f.std[1] = !f.std[0];
        },
        tip: 'Baro: wheel = QNH, click = STD',
      });
      t(g, 'QNH  /  STD', cx + 36 * u, 33 * u, 9 * u, '#ccc');
      cx += 80 * u;
      pb(g, R, cx, 8 * u, 26 * u, 20 * u, 'FD', { lo: f.fd[0] ? { t: '▬', c: GREEN } : null }, () => (f.fd[0] = f.fd[1] = !f.fd[0]));
      pb(g, R, cx + 30 * u, 8 * u, 26 * u, 20 * u, 'LS', { lo: f.ls[0] ? { t: '▬', c: GREEN } : null }, () => (f.ls[0] = !f.ls[0]));
      cx += 62 * u;
      // ND mode & range
      const modes = ['LS', 'VOR', 'NAV', 'ARC', 'PLAN'];
      g.fillStyle = '#111';
      g.fillRect(cx, 6 * u, 48 * u, 30 * u);
      t(g, fm.efis.mode, cx + 24 * u, 14 * u, 11 * u, WHITE);
      t(g, String(fm.efis.range), cx + 24 * u, 28 * u, 11 * u, BLUE);
      R.add(cx, 6 * u, 48 * u, 15 * u, { click: (d) => (fm.efis.mode = modes[(modes.indexOf(fm.efis.mode) + d + 5) % 5]), wheel: (d) => (fm.efis.mode = modes[(modes.indexOf(fm.efis.mode) + d + 5) % 5]), tip: 'ND mode' });
      R.add(cx, 21 * u, 48 * u, 15 * u, { click: (d) => this.ndRange(-d), wheel: (d) => this.ndRange(d), tip: 'ND range' });
      cx += 54 * u;
      for (const [k, lbl] of [['cstr', 'CSTR'], ['wpt', 'WPT'], ['vord', 'VOR.D'], ['ndb', 'NDB'], ['arpt', 'ARPT']]) {
        pb(g, R, cx, 10 * u, 26 * u, 18 * u, lbl, { lo: fm.efis[k] ? { t: '▬', c: GREEN } : null }, () => (fm.efis[k] = !fm.efis[k]));
        cx += 29 * u;
      }
      for (const n of ['nav1', 'nav2']) {
        const opts = ['ADF', 'OFF', 'VOR'];
        g.fillStyle = '#111';
        g.fillRect(cx, 10 * u, 30 * u, 18 * u);
        t(g, fm.efis[n], cx + 15 * u, 19 * u, 10 * u, fm.efis[n] === 'ADF' ? GREEN : WHITE);
        t(g, n === 'nav1' ? '1' : '2', cx + 15 * u, 34 * u, 9 * u, '#ccc');
        R.add(cx, 10 * u, 30 * u, 18 * u, { click: () => (fm.efis[n] = opts[(opts.indexOf(fm.efis[n]) + 1) % 3]), tip: 'ADF/VOR ' + n });
        cx += 34 * u;
      }
      // ---- FCU
      cx += 10 * u;
      const fcuW = Math.min(w - cx - 150 * u, 560 * u);
      g.fillStyle = '#34383d';
      g.fillRect(cx, 2 * u, fcuW, h - 4 * u);
      const win = (x, lbl, val, managed, dotted, wheel, push, pull, tip) => {
        g.fillStyle = '#0a0a0a';
        g.fillRect(x, 5 * u, 70 * u, 17 * u);
        t(g, lbl, x + 35 * u, 26 * u, 8 * u, '#ccc');
        t(g, val, x + 35 * u, 14 * u, 13 * u, '#ffb040');
        if (managed) {
          g.fillStyle = '#ffb040';
          g.beginPath();
          g.arc(x + 64 * u, 14 * u, 2.5 * u, 0, TAU);
          g.fill();
        }
        knob(g, x + 35 * u, 37 * u, 8 * u);
        R.add(x, 2 * u, 70 * u, 26 * u, { wheel, tip });
        R.add(x + 18 * u, 29 * u, 34 * u, 16 * u, {
          click: (d, rel, relY) => (relY < 0.5 || d > 0 ? push() : pull()),
          wheel,
          tip: tip + ' — knob: left-click PUSH (managed), right half PULL (selected)',
        });
        R.add(x + 18 * u, 29 * u, 17 * u, 16 * u, { click: push, wheel, tip: 'PUSH (managed)' });
        R.add(x + 35 * u, 29 * u, 17 * u, 16 * u, { click: pull, wheel, tip: 'PULL (selected)' });
        void dotted;
      };
      let fx = cx + 8 * u;
      const spdMan = f.spdManaged;
      win(fx, f.isMach ? 'MACH' : 'SPD', spdMan ? '---' : f.isMach ? f.mach.toFixed(2) : String(f.spd), spdMan, false, (d, sh) => fm.turn('SPD', d, sh), () => fm.press('SPD_PUSH'), () => fm.press('SPD_PULL'), 'SPD/MACH');
      fx += 76 * u;
      pb(g, R, fx, 8 * u, 28 * u, 16 * u, 'LOC', { lo: f.loc ? { t: '▬', c: GREEN } : null }, () => fm.press('LOC'));
      fx += 34 * u;
      const hdgMan = f.hdgManaged && !fm.hdgPreset;
      win(fx, f.trkFpa ? 'TRK' : 'HDG', hdgMan && fm.lat.mode === 'NAV' ? '---' : String(f.hdg).padStart(3, '0'), f.hdgManaged, false, (d, sh) => fm.turn('HDG', d, sh), () => {
        fm.press('HDG_PUSH');
        fm.hdgPreset = false;
      }, () => {
        fm.press('HDG_PULL');
        fm.hdgPreset = false;
      }, 'HDG/TRK');
      fx += 76 * u;
      pb(g, R, fx, 8 * u, 30 * u, 16 * u, 'HDG-V/S', { lo: { t: f.trkFpa ? 'TRK FPA' : 'HDG V/S', c: WHITE } }, () => fm.press('TRKFPA'));
      fx += 36 * u;
      pb(g, R, fx, 8 * u, 30 * u, 16 * u, 'AP1', { lo: f.ap1 ? { t: '▬', c: GREEN } : null }, () => fm.press('AP1'));
      pb(g, R, fx + 34 * u, 8 * u, 30 * u, 16 * u, 'AP2', { lo: f.ap2 ? { t: '▬', c: GREEN } : null }, () => fm.press('AP2'));
      pb(g, R, fx + 17 * u, 29 * u, 30 * u, 14 * u, 'A/THR', { lo: f.athr ? { t: '▬', c: GREEN } : null }, () => fm.press('ATHR'));
      fx += 70 * u;
      win(fx, 'ALT', String(f.alt).padStart(5, '0'), fm.vert.mode === 'CLB' || fm.vert.mode === 'DES', false, (d, sh) => fm.turn('ALT', d, sh), () => fm.press('ALT_PUSH'), () => fm.press('ALT_PULL'), 'ALT');
      g.fillStyle = '#111';
      g.fillRect(fx + 72 * u, 6 * u, 14 * u, 14 * u);
      t(g, f.altInc === 1000 ? '1000' : '100', fx + 79 * u, 13 * u, 6 * u, WHITE);
      R.add(fx + 72 * u, 6 * u, 14 * u, 14 * u, { click: () => (f.altInc = f.altInc === 100 ? 1000 : 100), tip: 'ALT increment 100/1000' });
      fx += 90 * u;
      pb(g, R, fx, 8 * u, 30 * u, 16 * u, 'EXPED', { lo: f.exped ? { t: '▬', c: GREEN } : null }, () => fm.press('EXPED'));
      pb(g, R, fx, 29 * u, 30 * u, 14 * u, 'APPR', { lo: f.appr ? { t: '▬', c: GREEN } : null }, () => fm.press('APPR'));
      fx += 36 * u;
      const vsVal = fm.vert.mode === 'V/S' || fm.vert.mode === 'FPA' ? (f.trkFpa ? (f.fpa || 0).toFixed(1) : (f.vs >= 0 ? '+' : '') + String(Math.round((f.vs || 0) / 100)).padStart(2, '0') + 'oo') : '-----';
      win(fx, f.trkFpa ? 'FPA' : 'V/S', vsVal, false, false, (d) => fm.turn('VS', d), () => fm.press('VS_PUSH'), () => fm.press('VS_PULL'), 'V/S-FPA');
      // ---- master warning / caution + chrono (right)
      const mx = w - 140 * u;
      const mw = sys.fwc.mw && (Date.now() / 250) % 2 < 1.4;
      const mc = sys.fwc.mc;
      pb(g, R, mx, 6 * u, 46 * u, 32 * u, '', { up: { t: 'MASTER', c: mw ? RED : '#4a1a1a' }, lo: { t: 'WARN', c: mw ? RED : '#4a1a1a' } }, () => {
        sys.fwc.mw = false;
        if (this.env.onMasterWarn) this.env.onMasterWarn();
      }, 'MASTER WARN (silence)');
      pb(g, R, mx + 50 * u, 6 * u, 46 * u, 32 * u, '', { up: { t: 'MASTER', c: mc ? AMBER : '#4a3210' }, lo: { t: 'CAUT', c: mc ? AMBER : '#4a3210' } }, () => (sys.fwc.mc = false), 'MASTER CAUT');
      const aPush = st.autoland && (Date.now() / 300) % 2 < 1;
      pb(g, R, mx + 100 * u, 6 * u, 34 * u, 32 * u, '', { up: { t: 'AUTO', c: aPush ? RED : '#4a1a1a' }, lo: { t: 'LAND', c: aPush ? RED : '#4a1a1a' } }, null);
      // TCAS indicator line
      if (st.tcas && st.tcas.status) t(g, st.tcas.status, mx - 70 * u, 20 * u, 11 * u, st.tcas.ra ? RED : AMBER);
    }

    drawPedestal(g, x, y, w, h, st) {
      const R = this.R,
        ac = st.ac,
        fm = st.fm,
        sys = st.sys,
        c = ac.ctl;
      g.fillStyle = '#30343a';
      g.fillRect(x, y, w, h);
      const u = h / 130;
      let cx = x + 8 * u;
      // ---------------- SIDESTICK (captain) — shows the actual stick deflection
      const sw = 110 * u;
      g.fillStyle = '#1b1d20';
      rr(g, cx, y + 6 * u, sw, h - 12 * u, 8);
      g.fill();
      t(g, 'SIDESTICK', cx + sw / 2, y + 14 * u, 9 * u, '#ccc');
      const scx = cx + sw / 2,
        scy = y + h / 2 + 8 * u,
        sr = 40 * u;
      g.strokeStyle = '#666';
      g.lineWidth = 2;
      g.strokeRect(scx - sr, scy - sr, sr * 2, sr * 2);
      line(g, scx - sr, scy, scx + sr, scy, '#444');
      line(g, scx, scy - sr, scx, scy + sr, '#444');
      const sxp = scx + (st.stick ? st.stick.roll : 0) * sr,
        syp = scy + (st.stick ? st.stick.pitch : 0) * sr;
      // stick shaft shadow + grip
      g.strokeStyle = '#111';
      g.lineWidth = 6 * u;
      g.beginPath();
      g.moveTo(scx, scy);
      g.lineTo(sxp, syp);
      g.stroke();
      const gr = g.createRadialGradient(sxp - 4 * u, syp - 4 * u, 1, sxp, syp, 14 * u);
      gr.addColorStop(0, '#6a6e74');
      gr.addColorStop(1, '#141517');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(sxp, syp, 12 * u, 15 * u, 0, 0, TAU);
      g.fill();
      g.fillStyle = RED;
      g.beginPath();
      g.arc(sxp - 5 * u, syp - 9 * u, 3 * u, 0, TAU); // takeover pb
      g.fill();
      t(g, st.apActive ? 'AP ENGAGED' : 'PULL = NOSE UP', cx + sw / 2, y + h - 14 * u, 8 * u, st.apActive ? GREEN : '#aaa');
      R.add(cx, y + 6 * u, sw, h - 12 * u, {
        drag: (dx, dy) => {
          this.env.mouseStick = this.env.mouseStick || { pitch: 0, roll: 0 };
          this.env.mouseStick.roll = FS.clamp(this.env.mouseStick.roll + dx / sr, -1, 1);
          this.env.mouseStick.pitch = FS.clamp(this.env.mouseStick.pitch + dy / sr, -1, 1);
        },
        release: () => (this.env.mouseStick = null),
        click: (d, rx, ry) => {
          if (Math.hypot(rx - 0.4, ry - 0.36) < 0.08) fm.instinctiveAPDisc();
        },
        tip: 'Sidestick: drag to fly (red button = AP disconnect)',
      });
      cx += sw + 8 * u;
      // ---------------- THRUST LEVERS
      const tw = 120 * u;
      g.fillStyle = '#1b1d20';
      rr(g, cx, y + 6 * u, tw, h - 12 * u, 8);
      g.fill();
      const top = y + 18 * u,
        bot = y + h - 18 * u;
      const ty = (tla) => bot - ((tla + 20) / 65) * (bot - top);
      for (const [tl, lbl] of [[45, 'TOGA'], [35, 'FLX MCT'], [25, 'CL'], [0, 'IDLE'], [-20, 'REV']]) {
        line(g, cx + 6 * u, ty(tl), cx + tw - 44 * u, ty(tl), '#777');
        t(g, lbl, cx + tw - 22 * u, ty(tl), 8 * u, tl === 25 ? GREEN : '#ddd');
      }
      for (let i = 0; i < 2; i++) {
        const lx = cx + 18 * u + i * 34 * u;
        line(g, lx, top, lx, bot, '#111', 5 * u);
        const ly = ty(c.tla[i]);
        g.fillStyle = '#d9d9d9';
        rr(g, lx - 13 * u, ly - 7 * u, 26 * u, 14 * u, 3);
        g.fill();
        t(g, String(i + 1), lx, ly, 9 * u, '#222');
      }
      R.add(cx, y + 6 * u, tw, h - 12 * u, {
        wheel: (d) => this.env.moveThrottle && this.env.moveThrottle(d * 2.5),
        drag: (dx, dy) => this.env.moveThrottle && this.env.moveThrottle((-dy / (bot - top)) * 65),
        tip: 'Thrust levers (drag / wheel; detents TOGA-FLX/MCT-CL-IDLE-REV)',
      });
      // A/THR instinctive disconnect
      pb(g, R, cx + 4 * u, y + h - 22 * u, 30 * u, 14 * u, '', { lo: { t: 'A/THR', c: '#ddd' } }, () => fm.instinctiveATHRDisc(), 'A/THR instinctive disconnect');
      cx += tw + 8 * u;
      // ---------------- FLAPS / SPEEDBRAKE / GEAR / AUTOBRAKE / PARK BRK
      const col2 = 180 * u;
      g.fillStyle = '#1b1d20';
      rr(g, cx, y + 6 * u, col2, h - 12 * u, 8);
      g.fill();
      // flaps
      const fl = ['0', '1', '2', '3', 'FULL'];
      t(g, 'FLAPS', cx + 22 * u, y + 16 * u, 9 * u, '#ccc');
      fl.forEach((n, k) => {
        const yy = y + 28 * u + k * 17 * u;
        g.fillStyle = c.flapLever === k ? '#e8e8e8' : '#2c2f33';
        rr(g, cx + 6 * u, yy - 7 * u, 34 * u, 14 * u, 3);
        g.fill();
        t(g, n, cx + 23 * u, yy, 9 * u, c.flapLever === k ? '#111' : '#bbb');
        R.add(cx + 6 * u, yy - 7 * u, 34 * u, 14 * u, { click: () => (c.flapLever = k), tip: 'Flaps ' + n });
      });
      // speedbrake
      t(g, 'SPD BRK', cx + 68 * u, y + 16 * u, 9 * u, '#ccc');
      const sbs = [['RET', 0], ['1/2', 0.5], ['FULL', 1]];
      sbs.forEach(([n, v], k) => {
        const yy = y + 28 * u + k * 17 * u;
        const on = Math.abs(c.speedBrake - v) < 0.1 && !c.spoilersArmed;
        g.fillStyle = on ? '#e8e8e8' : '#2c2f33';
        rr(g, cx + 50 * u, yy - 7 * u, 36 * u, 14 * u, 3);
        g.fill();
        t(g, n, cx + 68 * u, yy, 9 * u, on ? '#111' : '#bbb');
        R.add(cx + 50 * u, yy - 7 * u, 36 * u, 14 * u, { click: () => ((c.speedBrake = v), (c.spoilersArmed = false)), tip: 'Speed brake ' + n });
      });
      const armY = y + 28 * u + 3 * 17 * u;
      g.fillStyle = c.spoilersArmed ? GREEN : '#2c2f33';
      rr(g, cx + 50 * u, armY - 7 * u, 36 * u, 14 * u, 3);
      g.fill();
      t(g, 'ARM', cx + 68 * u, armY, 9 * u, c.spoilersArmed ? '#111' : '#bbb');
      R.add(cx + 50 * u, armY - 7 * u, 36 * u, 14 * u, { click: () => ((c.spoilersArmed = !c.spoilersArmed), (c.speedBrake = 0)), tip: 'Ground spoilers ARM' });
      // gear
      t(g, 'L/G', cx + 118 * u, y + 16 * u, 9 * u, '#ccc');
      const gd = c.gearLever === 'DOWN';
      g.fillStyle = '#e8e8e8';
      rr(g, cx + 100 * u, y + (gd ? 60 : 24) * u, 36 * u, 22 * u, 10);
      g.fill();
      t(g, gd ? 'DN' : 'UP', cx + 118 * u, y + (gd ? 71 : 35) * u, 10 * u, '#222');
      R.add(cx + 100 * u, y + 20 * u, 36 * u, 66 * u, { click: () => (c.gearLever = gd ? 'UP' : 'DOWN'), tip: 'Landing gear lever' });
      // gear lights
      const gCol = ac.gearPos > 0.99 ? GREEN : ac.gearPos > 0.01 ? RED : '#333';
      for (let k = 0; k < 3; k++) {
        g.fillStyle = gCol;
        g.beginPath();
        g.moveTo(cx + 146 * u + (k - 1) * 12 * u, y + 30 * u);
        g.lineTo(cx + 152 * u + (k - 1) * 12 * u, y + 30 * u);
        g.lineTo(cx + 149 * u + (k - 1) * 12 * u, y + 36 * u);
        g.fill();
      }
      t(g, 'LDG GEAR', cx + 150 * u, y + 44 * u, 7 * u, '#aaa');
      pb(g, R, cx + 140 * u, y + 56 * u, 34 * u, 20 * u, 'GRVTY', { lo: c.gravityExt ? { t: 'EXTN', c: GREEN } : { t: 'CRANK', c: '#aaa' } }, () => (c.gravityExt = !c.gravityExt), 'Gear gravity extension crank');
      // autobrake
      ['LO', 'MED', 'MAX'].forEach((n, k) => {
        const on = c.autobrake === n;
        pb(g, R, cx + 96 * u + k * 28 * u, y + 96 * u, 24 * u, 22 * u, k === 1 ? 'AUTO/BRK' : '', { up: { t: n, c: '#ddd' }, lo: on ? { t: 'ON', c: BLUE } : null }, () => (c.autobrake = on ? 'OFF' : n));
      });
      cx += col2 + 8 * u;
      // ---------------- ENG MASTERS + MODE + PARK BRK
      const col3 = 130 * u;
      g.fillStyle = '#1b1d20';
      rr(g, cx, y + 6 * u, col3, h - 12 * u, 8);
      g.fill();
      for (let i = 0; i < 2; i++) {
        const bx = cx + 12 * u + i * 44 * u;
        const on = sys.eng.master[i];
        t(g, `ENG ${i + 1}`, bx + 16 * u, y + 16 * u, 9 * u, '#ccc');
        g.fillStyle = '#444';
        rr(g, bx, y + 22 * u, 32 * u, 46 * u, 5);
        g.fill();
        g.fillStyle = '#ddd';
        rr(g, bx + 6 * u, y + (on ? 26 : 46) * u, 20 * u, 18 * u, 4);
        g.fill();
        t(g, on ? 'ON' : 'OFF', bx + 16 * u, y + 74 * u, 9 * u, on ? GREEN : '#aaa');
        R.add(bx, y + 22 * u, 32 * u, 46 * u, { click: () => sys.setMaster(i, !on), tip: `ENG ${i + 1} MASTER` });
      }
      const modes = ['CRANK', 'NORM', 'IGN'];
      const mi = modes.indexOf(sys.eng.mode);
      knob(g, cx + 108 * u, y + 44 * u, 13 * u);
      const ma = -Math.PI / 2 + (mi - 1) * 0.8;
      line(g, cx + 108 * u, y + 44 * u, cx + 108 * u + Math.cos(ma) * 12 * u, y + 44 * u + Math.sin(ma) * 12 * u, WHITE, 3);
      t(g, sys.eng.mode === 'IGN' ? 'IGN/START' : sys.eng.mode, cx + 108 * u, y + 66 * u, 8 * u, sys.eng.mode === 'IGN' ? GREEN : '#ccc');
      R.add(cx + 92 * u, y + 28 * u, 32 * u, 34 * u, { click: (d) => (sys.eng.mode = modes[FS.clamp(mi + d, 0, 2)]), wheel: (d) => (sys.eng.mode = modes[FS.clamp(mi - d, 0, 2)]), tip: 'ENG MODE selector' });
      // park brake
      const pbOn = c.parkingBrake;
      g.fillStyle = pbOn ? '#c8342a' : '#444';
      rr(g, cx + 14 * u, y + 88 * u, 100 * u, 26 * u, 6);
      g.fill();
      t(g, pbOn ? 'PARK BRK  ON' : 'PARK BRK  OFF', cx + 64 * u, y + 101 * u, 10 * u, '#fff');
      R.add(cx + 14 * u, y + 88 * u, 100 * u, 26 * u, { click: () => (c.parkingBrake = !c.parkingBrake), tip: 'Parking brake' });
      cx += col3 + 8 * u;
      // ---------------- ECAM CONTROL PANEL
      const col4 = Math.max(200 * u, Math.min(260 * u, w - cx - 240 * u));
      g.fillStyle = '#1b1d20';
      rr(g, cx, y + 6 * u, col4, h - 12 * u, 8);
      g.fill();
      t(g, 'ECAM', cx + col4 / 2, y + 14 * u, 9 * u, '#ccc');
      const pages = ['ENG', 'BLEED', 'PRESS', 'ELEC', 'HYD', 'FUEL', 'APU', 'COND', 'DOOR', 'WHEEL', 'F/CTL', 'STS'];
      const bw = (col4 - 16 * u) / 6;
      pages.forEach((p, k) => {
        const bx = cx + 8 * u + (k % 6) * bw,
          by = y + 22 * u + Math.floor(k / 6) * 26 * u;
        const on = sys.page === p && sys.sdPage === p;
        pb(g, R, bx + 1, by, bw - 3, 22 * u, '', { up: { t: p, c: '#ddd' }, lo: on ? { t: '▬', c: GREEN } : null }, () => sys.pressPage(p));
      });
      const fy = y + 78 * u;
      pb(g, R, cx + 8 * u, fy, 40 * u, 24 * u, '', { up: { t: 'CLR', c: sys.fwc.shown && sys.fwc.shown.length ? WHITE : '#ddd' }, lo: sys.fwc.shown && sys.fwc.shown.length ? { t: '▬', c: WHITE } : null }, () => sys.clr());
      pb(g, R, cx + 52 * u, fy, 40 * u, 24 * u, '', { up: { t: 'RCL', c: '#ddd' } }, () => sys.rcl());
      pb(g, R, cx + 96 * u, fy, 44 * u, 24 * u, '', { up: { t: 'T.O', c: '#ddd' }, lo: { t: 'CONFIG', c: '#ddd' } }, () => {
        const ok = sys.toConfig();
        if (this.env.onToConfig) this.env.onToConfig(ok);
      });
      pb(g, R, cx + 144 * u, fy, 44 * u, 24 * u, '', { up: { t: 'EMER', c: '#ddd' }, lo: { t: 'CANC', c: '#ddd' } }, () => {
        sys.fwc.mw = false;
        sys.apDiscTimer = 0;
        if (sys.fwc.shown && sys.fwc.shown[0]) sys.fwc.cleared.add(sys.fwc.shown[0].id);
      });
      cx += col4 + 8 * u;
      // ---------------- RMP + popups
      const col5 = w - cx - 8 * u;
      if (col5 > 100 * u) {
        g.fillStyle = '#1b1d20';
        rr(g, cx, y + 6 * u, col5, h - 12 * u, 8);
        g.fill();
        t(g, 'RMP 1  VHF1', cx + col5 / 2, y + 14 * u, 9 * u, '#ccc');
        const rw = (col5 - 24 * u) / 2;
        g.fillStyle = '#0a0a0a';
        g.fillRect(cx + 8 * u, y + 22 * u, rw, 20 * u);
        g.fillRect(cx + 16 * u + rw, y + 22 * u, rw, 20 * u);
        t(g, this.rmp.active.toFixed(3), cx + 8 * u + rw / 2, y + 32 * u, 12 * u, '#ffb040');
        t(g, this.rmp.standby.toFixed(3), cx + 16 * u + rw * 1.5, y + 32 * u, 12 * u, '#ffb040');
        R.add(cx + 16 * u + rw, y + 20 * u, rw / 2, 24 * u, { wheel: (d) => this.tuneStby(d, true), click: (d) => this.tuneStby(d, true), tip: 'Standby MHz' });
        R.add(cx + 16 * u + rw * 1.5, y + 20 * u, rw / 2, 24 * u, { wheel: (d) => this.tuneStby(d, false), click: (d) => this.tuneStby(d, false), tip: 'Standby kHz' });
        pb(g, R, cx + 8 * u + rw - 16 * u, y + 46 * u, 32 * u, 16 * u, '', { up: { t: '⇄', c: WHITE } }, () => {
          const a = this.rmp.active;
          this.rmp.active = this.rmp.standby;
          this.rmp.standby = a;
          if (this.env.onComTune) this.env.onComTune(this.rmp.active);
        }, 'Transfer');
        const stn = this.env.comStation ? this.env.comStation(this.rmp.active) : null;
        t(g, stn ? stn.name : '', cx + col5 / 2, y + 70 * u, 8 * u, GREEN);
        pb(g, R, cx + 8 * u, y + 84 * u, (col5 - 24 * u) / 2, 24 * u, '', { up: { t: 'MCDU', c: WHITE } }, () => this.env.toggleMcdu && this.env.toggleMcdu(), 'Open MCDU (F2)');
        pb(g, R, cx + 16 * u + (col5 - 24 * u) / 2, y + 84 * u, (col5 - 24 * u) / 2, 24 * u, '', { up: { t: 'OVHD', c: WHITE } }, () => this.env.toggleOvhd && this.env.toggleOvhd(), 'Overhead panel (F3)');
      }
    }
    tuneStby(d, big) {
      let f = this.rmp.standby;
      if (big) f += d;
      else {
        const mhz = Math.floor(f + 1e-6);
        let k = Math.round((f - mhz) * 1000) + d * 25;
        if (k >= 1000) k -= 1000;
        if (k < 0) k += 975;
        f = mhz + k / 1000;
      }
      if (f < 118) f += 19;
      if (f > 136.975) f -= 19;
      this.rmp.standby = Math.round(f * 1000) / 1000;
    }

    // ------------------------------------------------------------------ overhead pop-up
    drawOverhead(st) {
      const g = this.og,
        W = this.ov.width,
        H = this.ov.height;
      const R = this.RO;
      R.list = [];
      const ac = st.ac,
        sys = st.sys;
      g.fillStyle = '#4a5057';
      g.fillRect(0, 0, W, H);
      const u = Math.min(W / 900, H / 520);
      const sect = (x, y, w, h, title) => {
        g.fillStyle = '#3c4147';
        rr(g, x, y, w, h, 6);
        g.fill();
        g.strokeStyle = '#ddd';
        g.lineWidth = 1;
        g.stroke();
        t(g, title, x + w / 2, y + 10 * u, 10 * u, WHITE);
      };
      const B = (x, y, lbl, st2, fn, tip) => pb(g, R, x, y, 54 * u, 34 * u, lbl, st2, fn, tip);
      const onOff = (on, fault) => ({ up: fault ? { t: 'FAULT', c: AMBER } : null, lo: on ? null : { t: 'OFF', c: WHITE } });
      const onBlue = (on) => ({ lo: on ? { t: 'ON', c: BLUE } : null });
      const el = sys.elec,
        H2 = sys.hyd,
        A = sys.apu,
        Bl = sys.bleed;
      // ELEC
      sect(10 * u, 10 * u, 290 * u, 150 * u, 'ELEC');
      B(20 * u, 40 * u, 'BAT 1', onOff(el.bat[0]), () => (el.bat[0] = !el.bat[0]));
      B(80 * u, 40 * u, 'BAT 2', onOff(el.bat[1]), () => (el.bat[1] = !el.bat[1]));
      B(150 * u, 40 * u, 'EXT PWR', { up: el.extPwrAvail && !el.extOn ? { t: 'AVAIL', c: GREEN } : null, lo: el.extOn ? { t: 'ON', c: BLUE } : null }, () => el.extPwrAvail && (el.extPwrOn = !el.extPwrOn));
      B(20 * u, 105 * u, 'GEN 1', onOff(el.gen[0], ac.eng[0].running && !el.gen[0]), () => (el.gen[0] = !el.gen[0]));
      B(80 * u, 105 * u, 'APU GEN', onOff(el.apuGenSw), () => (el.apuGenSw = !el.apuGenSw));
      B(140 * u, 105 * u, 'BUS TIE', { lo: el.busTie ? null : { t: 'OFF', c: WHITE } }, () => (el.busTie = !el.busTie));
      B(200 * u, 105 * u, 'GEN 2', onOff(el.gen[1], ac.eng[1].running && !el.gen[1]), () => (el.gen[1] = !el.gen[1]));
      t(g, `${el.batV[0].toFixed(1)}V  ${el.batV[1].toFixed(1)}V`, 240 * u, 55 * u, 10 * u, GREEN);
      // APU
      sect(310 * u, 10 * u, 140 * u, 150 * u, 'APU');
      B(320 * u, 40 * u, 'MASTER SW', { up: null, lo: A.master ? { t: 'ON', c: BLUE } : null }, () => {
        A.master = !A.master;
        if (!A.master) A.starting = false;
      });
      B(385 * u, 40 * u, 'START', { up: A.starting ? { t: 'ON', c: BLUE } : null, lo: A.avail ? { t: 'AVAIL', c: GREEN } : null }, () => A.master && !A.avail && (A.starting = true));
      t(g, `N ${Math.round(A.n)}%  EGT ${Math.round(A.egt)}°C`, 380 * u, 88 * u, 10 * u, GREEN);
      B(345 * u, 115 * u, 'APU BLEED', { lo: A.bleed ? { t: 'ON', c: BLUE } : null }, () => (A.bleed = !A.bleed));
      // AIR COND / BLEED
      sect(460 * u, 10 * u, 430 * u, 150 * u, 'AIR COND');
      B(470 * u, 40 * u, 'PACK 1', onOff(Bl.packs[0], Bl.packs[0] && !sys.packOn[0] && sys.bleedPress > 20), () => (Bl.packs[0] = !Bl.packs[0]));
      B(530 * u, 40 * u, 'ENG 1 BLEED', onOff(Bl.eng[0]), () => (Bl.eng[0] = !Bl.eng[0]));
      const xb = ['SHUT', 'AUTO', 'OPEN'];
      knob(g, 640 * u, 57 * u, 14 * u);
      t(g, 'X BLEED ' + Bl.xbleed, 640 * u, 82 * u, 9 * u, WHITE);
      R.add(625 * u, 42 * u, 30 * u, 30 * u, { click: (d) => (Bl.xbleed = xb[FS.clamp(xb.indexOf(Bl.xbleed) + d, 0, 2)]), tip: 'Cross bleed' });
      B(700 * u, 40 * u, 'ENG 2 BLEED', onOff(Bl.eng[1]), () => (Bl.eng[1] = !Bl.eng[1]));
      B(760 * u, 40 * u, 'PACK 2', onOff(Bl.packs[1], Bl.packs[1] && !sys.packOn[1] && sys.bleedPress > 20), () => (Bl.packs[1] = !Bl.packs[1]));
      t(g, `CAB ALT ${Math.round(sys.press.cabAlt)} FT   ΔP ${sys.press.dp.toFixed(1)} PSI`, 675 * u, 120 * u, 11 * u, GREEN);
      // HYD
      sect(10 * u, 170 * u, 440 * u, 120 * u, 'HYD');
      B(20 * u, 200 * u, 'ENG 1 PUMP', onOff(H2.G.edp, H2.G.press < 1450 && ac.eng[0].running), () => (H2.G.edp = !H2.G.edp));
      B(85 * u, 200 * u, 'RAT MAN ON', { lo: H2.ratOut ? { t: 'OUT', c: GREEN } : null }, () => (H2.ratOut = true));
      B(150 * u, 200 * u, 'BLUE ELEC', onOff(H2.B.elecPump, H2.B.press < 1450 && (ac.eng[0].running || ac.eng[1].running)), () => (H2.B.elecPump = !H2.B.elecPump));
      B(215 * u, 200 * u, 'PTU', onOff(H2.ptu), () => (H2.ptu = !H2.ptu));
      B(280 * u, 200 * u, 'ENG 2 PUMP', onOff(H2.Y.edp, H2.Y.press < 1450 && ac.eng[1].running), () => (H2.Y.edp = !H2.Y.edp));
      B(345 * u, 200 * u, 'YELLOW ELEC', { lo: H2.Y.elecPump ? { t: 'ON', c: BLUE } : null }, () => (H2.Y.elecPump = !H2.Y.elecPump));
      t(g, `G ${Math.round(H2.G.press)}  B ${Math.round(H2.B.press)}  Y ${Math.round(H2.Y.press)} PSI`, 230 * u, 262 * u, 11 * u, GREEN);
      // FUEL
      sect(460 * u, 170 * u, 430 * u, 120 * u, 'FUEL');
      const P = sys.fuel.pumps;
      ['L1', 'L2', 'C1', 'C2', 'R1', 'R2'].forEach((k, i) => B(470 * u + i * 58 * u + (i >= 2 ? 10 * u : 0) + (i >= 4 ? 10 * u : 0), 200 * u, k === 'C1' || k === 'C2' ? 'CTR ' + k : k[0] === 'L' ? 'L TK ' + k[1] : 'R TK ' + k[1], onOff(P[k]), () => (P[k] = !P[k])));
      B(650 * u, 245 * u, 'X FEED', { lo: sys.fuel.xfeed ? { t: 'ON', c: BLUE } : null, up: sys.fuel.xfeed ? { t: 'OPEN', c: GREEN } : null }, () => (sys.fuel.xfeed = !sys.fuel.xfeed));
      // EXT LT & SIGNS
      sect(10 * u, 300 * u, 520 * u, 110 * u, 'EXT LT  /  SIGNS');
      const L = ac.lights;
      const sw = (x, lbl, on, fn) => {
        g.fillStyle = '#222';
        rr(g, x, 330 * u, 40 * u, 44 * u, 4);
        g.fill();
        g.fillStyle = '#ddd';
        rr(g, x + 10 * u, (on ? 333 : 355) * u, 20 * u, 16 * u, 3);
        g.fill();
        t(g, lbl, x + 20 * u, 388 * u, 8 * u, WHITE);
        t(g, on ? 'ON' : 'OFF', x + 20 * u, 400 * u, 8 * u, on ? GREEN : '#aaa');
        R.add(x, 330 * u, 40 * u, 44 * u, { click: fn, tip: lbl });
      };
      [['STROBE', 'strobe'], ['BEACON', 'beacon'], ['WING', 'wing'], ['NAV&LOGO', 'logo'], ['RWY TURN', 'turnoff'], ['LAND', 'landing'], ['NOSE TAXI', 'taxi']].forEach(([lbl, k], i) =>
        sw(20 * u + i * 50 * u, lbl, L[k], () => {
          L[k] = !L[k];
          if (k === 'logo') L.nav = L.logo;
        })
      );
      sw(380 * u, 'SEAT BELTS', sys.signs.belts, () => (sys.signs.belts = !sys.signs.belts));
      sw(430 * u, 'NO SMOKING', sys.signs.smoke, () => (sys.signs.smoke = !sys.signs.smoke));
      sw(480 * u, 'EMER EXIT', true, () => {});
      // GROUND SERVICES (sim)
      sect(540 * u, 300 * u, 350 * u, 210 * u, 'GROUND SERVICES (SIM)');
      const gs = this.env;
      B(550 * u, 330 * u, 'GPU', { lo: sys.gpu ? { t: 'CONN', c: GREEN } : { t: 'DISC', c: WHITE } }, () => (sys.gpu = !sys.gpu && ac.onGround && ac.gs < 1));
      B(610 * u, 330 * u, 'CABIN DOORS', { lo: Object.values(sys.doors.cabin).some(Boolean) ? { t: 'OPEN', c: AMBER } : { t: 'CLOSED', c: GREEN } }, () => {
        const o = !Object.values(sys.doors.cabin).some(Boolean);
        sys.doors.cabin['FWD L'] = o;
        sys.doors.cabin['AFT R'] = o;
        sys.doors.slides = !o;
      });
      B(670 * u, 330 * u, 'CARGO DOORS', { lo: Object.values(sys.doors.cargo).some(Boolean) ? { t: 'OPEN', c: AMBER } : { t: 'CLOSED', c: GREEN } }, () => {
        const o = !Object.values(sys.doors.cargo).some(Boolean);
        sys.doors.cargo.FWD = sys.doors.cargo.AFT = o;
      });
      B(730 * u, 330 * u, 'JETWAY', { lo: gs.jetway ? { t: 'CONN', c: GREEN } : { t: 'RETR', c: WHITE } }, () => gs.toggleJetway && gs.toggleJetway());
      B(790 * u, 330 * u, 'CHOCKS', { lo: sys.chocks ? { t: 'IN', c: AMBER } : { t: 'OUT', c: WHITE } }, () => (sys.chocks = !sys.chocks));
      B(550 * u, 400 * u, 'PUSHBACK', { lo: gs.pushState ? { t: gs.pushState, c: GREEN } : null }, () => gs.pushback && gs.pushback());
      B(610 * u, 400 * u, 'FUEL TRUCK', { lo: { t: `${(sys.fob() / 1000).toFixed(1)}T`, c: GREEN } }, () => ac.onGround && ac.gs < 1 && sys.setFuel(Math.min(18700, sys.fob() + 1000)));
      B(670 * u, 400 * u, 'CABIN READY', { lo: sys.cabinReady ? { t: 'READY', c: GREEN } : null }, () => (sys.cabinReady = !sys.cabinReady));
      B(730 * u, 400 * u, 'ATIS', { lo: { t: 'LISTEN', c: WHITE } }, () => gs.playAtis && gs.playAtis());
      t(g, 'Pushback: tug pushes back & turns tail left; set PARK BRK OFF', 715 * u, 470 * u, 9 * u, '#ddd');
      t(g, 'OVERHEAD  (F3 / click OVHD to close)', 270 * u, 440 * u, 11 * u, '#ddd');
      if (this.RO.tip) t(g, this.RO.tip, W - 8, H - 8, 11, '#ccd', 'right');
    }
  }
  function line(g, x1, y1, x2, y2, col, w) {
    g.strokeStyle = col;
    g.lineWidth = w || 1;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }

  FS.A320Cockpit = A320Cockpit;
})(typeof window !== 'undefined' ? window : globalThis);
