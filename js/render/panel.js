/*
 * 2D instrument panel (canvas). Classic six-pack + NAV1 (VOR/LOC/GS), NAV2, ADF, tachometer, engine cluster,
 * annunciators & marker beacons, KAP 140 autopilot, NAV/COM/ADF/DME/XPDR stack, switches and levers.
 * All knobs respond to mouse wheel and clicks (left half = decrease, right half = increase).
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG, RAD, FT } = FS.U;
  const TAU = Math.PI * 2;

  const COL = {
    bg: '#2b2e33', bezel: '#161719', face: '#0d0e10', white: '#ecebe6', green: '#1fb541', yellow: '#e8c01e', red: '#d7261e',
    orange: '#f08a1c', sky: '#2f7fd0', ground: '#7a4e24', dim: '#8c8c8c', lcd: '#ff9c33', lcdBg: '#150b02',
  };

  class Panel {
    constructor(canvas) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.regions = [];
      this.cache = {};
      this.adfCard = 0;
      this.egtRef = 1350;
      this.xpdr = [1, 2, 0, 0];
      this.hover = null;
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = this.hit(e);
        if (r && r.wheel) r.wheel(e.deltaY < 0 ? 1 : -1, e.shiftKey);
      }, { passive: false });
      canvas.addEventListener('mousedown', (e) => {
        const r = this.hit(e);
        if (r && r.click) {
          const rel = (e.offsetX - r.x) / r.w;
          r.click(rel < 0.5 ? -1 : 1, rel, e.button);
          e.preventDefault();
        }
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('mousemove', (e) => {
        const r = this.hit(e);
        canvas.style.cursor = r ? 'pointer' : 'default';
        this.hover = r ? r.tip : null;
      });
    }

    hit(e) {
      const x = e.offsetX,
        y = e.offsetY;
      for (let i = this.regions.length - 1; i >= 0; i--) {
        const r = this.regions[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
      }
      return null;
    }

    region(x, y, w, h, o) {
      this.regions.push(Object.assign({ x, y, w, h }, o));
    }

    resize(w, h, dpr) {
      this.W = w;
      this.H = h;
      this.dpr = dpr;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      this.cv.style.width = w + 'px';
      this.cv.style.height = h + 'px';
      this.cache = {};
      const annH = Math.max(16, h * 0.07);
      const D = Math.min((h - annH - 14) / 2.12, w / 9.4);
      this.L = { D, annH, y1: annH + 6 + D / 2, y2: annH + 6 + D * 1.56, x0: 10 + D * 0.55, dx: D * 1.06 };
    }

    // ---------- cached static faces ----------
    face(key, D, drawFn) {
      const k = key + '|' + Math.round(D);
      if (this.cache[k]) return this.cache[k];
      const c = document.createElement('canvas');
      const s = Math.ceil(D * this.dpr);
      c.width = c.height = s;
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      g.translate(D / 2, D / 2);
      drawFn(g, D / 2);
      this.cache[k] = c;
      return c;
    }
    blit(img, cx, cy, D, rot) {
      const g = this.g;
      g.save();
      g.translate(cx, cy);
      if (rot) g.rotate(rot);
      g.drawImage(img, -D / 2, -D / 2, D, D);
      g.restore();
    }

    bezel(g, R) {
      const gr = g.createRadialGradient(0, -R * 0.3, R * 0.2, 0, 0, R);
      gr.addColorStop(0, '#3a3c40');
      gr.addColorStop(1, '#101113');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, R, 0, TAU);
      g.fill();
      g.fillStyle = COL.face;
      g.beginPath();
      g.arc(0, 0, R * 0.9, 0, TAU);
      g.fill();
      // screws
      g.fillStyle = '#55585d';
      for (let a = 0; a < 4; a++) {
        const x = Math.cos(a * (TAU / 4) + Math.PI / 4) * R * 0.97,
          y = Math.sin(a * (TAU / 4) + Math.PI / 4) * R * 0.97;
        g.beginPath();
        g.arc(x, y, R * 0.035, 0, TAU);
        g.fill();
      }
    }

    ticks(g, R, a0, a1, n, len, w, col) {
      g.strokeStyle = col || COL.white;
      g.lineWidth = w;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n - Math.PI / 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        g.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
        g.stroke();
      }
    }

    text(g, s, x, y, size, col, align, weight) {
      g.fillStyle = col || COL.white;
      g.font = `${weight || 'bold'} ${size}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = align || 'center';
      g.textBaseline = 'middle';
      g.fillText(s, x, y);
    }

    needle(cx, cy, ang, len, w, col, tail) {
      const g = this.g;
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      g.fillStyle = col || COL.white;
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 3;
      g.shadowOffsetY = 2;
      g.beginPath();
      g.moveTo(-w / 2, (tail || 0.15) * len);
      g.lineTo(-w / 2, -len * 0.8);
      g.lineTo(0, -len);
      g.lineTo(w / 2, -len * 0.8);
      g.lineTo(w / 2, (tail || 0.15) * len);
      g.closePath();
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(0, 0, w * 1.1, 0, TAU);
      g.fill();
      g.restore();
    }

    knob(cx, cy, r, label) {
      const g = this.g;
      const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
      gr.addColorStop(0, '#6a6d72');
      gr.addColorStop(1, '#1b1c1e');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.stroke();
      if (label) this.text(g, label, cx, cy + r + 6, Math.max(7, r * 0.55), COL.dim, 'center', 'normal');
    }

    // ---------------- main draw ----------------
    draw(st) {
      const g = this.g,
        L = this.L;
      if (!L) return;
      this.regions = [];
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      // panel background
      const bgG = g.createLinearGradient(0, 0, 0, this.H);
      const nightDim = 1 - 0.55 * st.night;
      bgG.addColorStop(0, shade('#383b41', nightDim));
      bgG.addColorStop(1, shade('#212326', nightDim));
      g.fillStyle = bgG;
      g.fillRect(0, 0, this.W, this.H);
      g.fillStyle = '#0e0f11';
      g.fillRect(0, 0, this.W, 4);
      const { D, y1, y2, x0, dx } = L;
      const R = D / 2;
      const ind = st.ind,
        ac = st.ac;

      // annunciators
      this.drawAnnunciators(st, x0 - R, 3, dx * 5 - (dx - D), L.annH - 2);

      // row 1
      this.drawASI(x0, y1, R, ind.ias);
      this.drawAI(x0 + dx, y1, R, ind.aiPitch, ind.aiBank, ind.aiFlag);
      this.drawALT(x0 + dx * 2, y1, R, ind.altFt, ind.kollsman, st);
      this.drawCDI(x0 + dx * 3, y1, R, st.nav1, true, 'NAV 1', st);
      this.drawADF(x0 + dx * 4, y1, R, st.adf, st);
      // row 2
      this.drawTC(x0, y2, R, ind.turn, ind.ball, ind.tcFlag);
      this.drawDG(x0 + dx, y2, R, ind.dg, st.ap.hdgBug, st);
      this.drawVSI(x0 + dx * 2, y2, R, ind.vsi);
      this.drawCDI(x0 + dx * 3, y2, R, st.nav2, false, 'NAV 2', st);
      this.drawTach(x0 + dx * 4, y2, R, ind.tach, ind.hobbs);

      // right side
      const xr = x0 + dx * 4 + R + D * 0.12;
      const engW = D * 0.95;
      this.drawEngine(xr, L.annH + 4, engW, this.H - L.annH - 10, st);
      const xs = xr + engW + D * 0.1;
      this.drawStack(xs, 4, this.W - xs - 8, this.H - 8, st);
    }

    drawAnnunciators(st, x, y, w, h) {
      const g = this.g,
        ind = st.ind,
        ac = st.ac;
      const items = [
        ['L LOW FUEL', ac.fuel[0] < 5 && ind.power, COL.yellow],
        ['OIL PRESS', ind.oilPressLow && ind.power, COL.red],
        ['LOW VAC', ind.lowVac && ind.power, COL.yellow],
        ['VOLTS', ind.lowVolts, COL.red],
        ['R LOW FUEL', ac.fuel[1] < 5 && ind.power, COL.yellow],
        ['STALL', st.stallHorn, COL.red],
        ['CARB ICE?', false, COL.yellow],
      ];
      items.pop();
      const n = items.length + 3;
      const bw = w / n;
      g.font = `bold ${Math.max(7, h * 0.42)}px Arial`;
      items.forEach((it, i) => {
        const on = it[1] && (it[0] !== 'STALL' || (Date.now() / 150) % 2 < 1.3);
        g.fillStyle = on ? it[2] : '#1a1a1a';
        roundRect(g, x + i * bw + 1, y, bw - 2, h, 3);
        g.fill();
        g.fillStyle = on ? '#111' : '#444';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(it[0], x + i * bw + bw / 2, y + h / 2 + 1);
      });
      // marker beacons
      const mk = st.marker;
      const blink = (hz) => (Date.now() / 1000) * hz % 1 < 0.6;
      [['O', 'OM', '#3a7cff'], ['M', 'MM', '#ffb020'], ['I', 'IM', '#ffffff']].forEach((m, k) => {
        const cx = x + (items.length + k) * bw + bw / 2;
        const on = mk === m[1] && blink(m[1] === 'OM' ? 2 : m[1] === 'MM' ? 3 : 6);
        g.fillStyle = on ? m[2] : '#1a1a1a';
        g.beginPath();
        g.arc(cx, y + h / 2, h * 0.45, 0, TAU);
        g.fill();
        g.fillStyle = on ? '#111' : '#555';
        g.fillText(m[0], cx, y + h / 2 + 1);
      });
    }

    // ---------------- airspeed ----------------
    drawASI(cx, cy, R, ias) {
      const ang = (v) => (v <= 40 ? (v / 40) * 30 : 30 + ((v - 40) * 310) / 160) * DEG;
      const img = this.face('asi', R * 2, (g, R) => {
        this.bezel(g, R);
        const arc = (v0, v1, r, w, c) => {
          g.strokeStyle = c;
          g.lineWidth = w;
          g.beginPath();
          g.arc(0, 0, r, ang(v0) - Math.PI / 2, ang(v1) - Math.PI / 2);
          g.stroke();
        };
        arc(40, 85, R * 0.72, R * 0.05, COL.white);
        arc(48, 129, R * 0.78, R * 0.06, COL.green);
        arc(129, 163, R * 0.78, R * 0.06, COL.yellow);
        g.strokeStyle = COL.red;
        g.lineWidth = R * 0.03;
        const a = ang(163) - Math.PI / 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7);
        g.lineTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
        g.stroke();
        for (let v = 40; v <= 200; v += 5) {
          const a = ang(v) - Math.PI / 2;
          const l = v % 10 === 0 ? R * 0.12 : R * 0.07;
          g.strokeStyle = COL.white;
          g.lineWidth = v % 10 === 0 ? 2 : 1;
          g.beginPath();
          g.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
          g.lineTo(Math.cos(a) * (R * 0.88 - l), Math.sin(a) * (R * 0.88 - l));
          g.stroke();
          if (v % 20 === 0) this.text(g, String(v), Math.cos(a) * R * 0.58, Math.sin(a) * R * 0.58, R * 0.15);
        }
        this.text(g, 'AIRSPEED', 0, -R * 0.3, R * 0.1, COL.white, 'center', 'normal');
        this.text(g, 'KNOTS', 0, R * 0.3, R * 0.11);
      });
      this.blit(img, cx, cy, R * 2);
      this.needle(cx, cy, ang(FS.clamp(ias, 0, 210)), R * 0.84, R * 0.07);
    }

    // ---------------- attitude ----------------
    drawAI(cx, cy, R, pitch, bank, flag) {
      const g = this.g;
      g.save();
      g.translate(cx, cy);
      const img = this.face('aibz', R * 2, (g, R) => this.bezel(g, R));
      g.drawImage(img, -R, -R, R * 2, R * 2);
      g.beginPath();
      g.arc(0, 0, R * 0.88, 0, TAU);
      g.clip();
      g.rotate(-bank);
      const ppd = R * 0.028; // px per degree
      const off = FS.clamp(pitch * RAD, -30, 30) * ppd;
      g.fillStyle = COL.sky;
      g.fillRect(-R * 2, -R * 3 + off, R * 4, R * 3);
      g.fillStyle = COL.ground;
      g.fillRect(-R * 2, off, R * 4, R * 3);
      g.strokeStyle = COL.white;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-R * 2, off);
      g.lineTo(R * 2, off);
      g.stroke();
      g.lineWidth = 1.5;
      for (const p of [-20, -15, -10, -5, 5, 10, 15, 20]) {
        const y = off - p * ppd;
        const w = p % 10 === 0 ? R * 0.28 : R * 0.13;
        g.beginPath();
        g.moveTo(-w, y);
        g.lineTo(w, y);
        g.stroke();
        if (p % 10 === 0) {
          this.text(g, String(Math.abs(p)), -w - R * 0.1, y, R * 0.1);
          this.text(g, String(Math.abs(p)), w + R * 0.1, y, R * 0.1);
        }
      }
      // ground lines converging
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      for (const a of [-40, -20, 20, 40]) {
        g.beginPath();
        g.moveTo(0, off);
        g.lineTo(Math.sin(a * DEG) * R * 2, off + Math.cos(a * DEG) * R * 2);
        g.stroke();
      }
      // sky pointer (rotates with bank)
      g.fillStyle = COL.white;
      g.beginPath();
      g.moveTo(0, -R * 0.66);
      g.lineTo(-R * 0.06, -R * 0.56);
      g.lineTo(R * 0.06, -R * 0.56);
      g.fill();
      g.restore();
      // fixed bank scale
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = COL.white;
      for (const b of [-90, -60, -45, -30, -20, -10, 10, 20, 30, 45, 60, 90]) {
        const a = (b - 90) * DEG;
        const l = Math.abs(b) % 30 === 0 ? R * 0.14 : R * 0.08;
        g.lineWidth = Math.abs(b) % 30 === 0 ? 3 : 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86);
        g.lineTo(Math.cos(a) * (R * 0.86 - l), Math.sin(a) * (R * 0.86 - l));
        g.stroke();
      }
      g.fillStyle = COL.orange;
      g.beginPath();
      g.moveTo(0, -R * 0.72);
      g.lineTo(-R * 0.07, -R * 0.86);
      g.lineTo(R * 0.07, -R * 0.86);
      g.fill();
      // miniature airplane
      g.strokeStyle = COL.orange;
      g.lineWidth = R * 0.05;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-R * 0.5, 0);
      g.lineTo(-R * 0.16, 0);
      g.lineTo(-R * 0.08, R * 0.08);
      g.moveTo(R * 0.5, 0);
      g.lineTo(R * 0.16, 0);
      g.lineTo(R * 0.08, R * 0.08);
      g.stroke();
      g.fillStyle = COL.orange;
      g.beginPath();
      g.arc(0, 0, R * 0.04, 0, TAU);
      g.fill();
      g.fillStyle = '#1b1c1e';
      g.beginPath();
      g.moveTo(-R * 0.3, R * 0.9);
      g.lineTo(0, R * 0.55);
      g.lineTo(R * 0.3, R * 0.9);
      g.fill();
      if (flag) {
        g.fillStyle = COL.red;
        g.fillRect(-R * 0.62, -R * 0.3, R * 0.25, R * 0.14);
        this.text(g, 'OFF', -R * 0.495, -R * 0.23, R * 0.1, '#fff');
      }
      g.restore();
    }

    // ---------------- altimeter ----------------
    drawALT(cx, cy, R, alt, kollsman, st) {
      const img = this.face('alt', R * 2, (g, R) => {
        this.bezel(g, R);
        for (let i = 0; i < 50; i++) {
          const a = (i / 50) * TAU - Math.PI / 2;
          const l = i % 5 === 0 ? R * 0.14 : R * 0.07;
          g.strokeStyle = COL.white;
          g.lineWidth = i % 5 === 0 ? 2.2 : 1;
          g.beginPath();
          g.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
          g.lineTo(Math.cos(a) * (R * 0.88 - l), Math.sin(a) * (R * 0.88 - l));
          g.stroke();
          if (i % 5 === 0) this.text(g, String(i / 5), Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, R * 0.2);
        }
        this.text(g, 'ALT', 0, -R * 0.3, R * 0.11);
        this.text(g, '100 FEET', 0, -R * 0.18, R * 0.07, COL.white, 'center', 'normal');
        this.text(g, 'CALIBRATED TO 20,000 FT', 0, R * 0.45, R * 0.05, COL.dim, 'center', 'normal');
      });
      this.blit(img, cx, cy, R * 2);
      const g = this.g;
      // Kollsman window
      g.fillStyle = '#000';
      g.fillRect(cx + R * 0.28, cy - R * 0.1, R * 0.42, R * 0.2);
      this.text(g, kollsman.toFixed(2), cx + R * 0.49, cy + 1, R * 0.13, COL.white);
      // crosshatch flag below 10,000 ft
      if (alt < 10000) {
        g.save();
        g.beginPath();
        g.rect(cx - R * 0.2, cy + R * 0.14, R * 0.4, R * 0.14);
        g.clip();
        g.fillStyle = '#eee';
        g.fillRect(cx - R * 0.2, cy + R * 0.14, R * 0.4, R * 0.14);
        g.strokeStyle = '#d22';
        g.lineWidth = R * 0.04;
        for (let i = -4; i < 8; i++) {
          g.beginPath();
          g.moveTo(cx - R * 0.2 + i * R * 0.08, cy + R * 0.28);
          g.lineTo(cx - R * 0.2 + i * R * 0.08 + R * 0.14, cy + R * 0.14);
          g.stroke();
        }
        g.restore();
      }
      const a100 = (alt / 1000) * TAU,
        a1000 = (alt / 10000) * TAU,
        a10k = (alt / 100000) * TAU;
      // 10,000 ft pointer (thin with triangle)
      g.save();
      g.translate(cx, cy);
      g.rotate(a10k);
      g.strokeStyle = COL.white;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -R * 0.8);
      g.stroke();
      g.fillStyle = COL.white;
      g.beginPath();
      g.moveTo(0, -R * 0.88);
      g.lineTo(-R * 0.05, -R * 0.76);
      g.lineTo(R * 0.05, -R * 0.76);
      g.fill();
      g.restore();
      this.needle(cx, cy, a1000, R * 0.5, R * 0.11);
      this.needle(cx, cy, a100, R * 0.84, R * 0.055);
      this.knob(cx - R * 0.78, cy + R * 0.78, R * 0.13);
      const self = this;
      this.region(cx - R, cy - R, R * 2, R * 2, {
        tip: 'Altimeter setting (wheel)',
        wheel: (d, sh) => (st.ind.kollsman = +FS.clamp(st.ind.kollsman + d * (sh ? 0.1 : 0.01), 27.5, 31.5).toFixed(2)),
        click: (d) => (st.ind.kollsman = +FS.clamp(st.ind.kollsman + d * 0.01, 27.5, 31.5).toFixed(2)),
      });
      void self;
    }

    // ---------------- turn coordinator ----------------
    drawTC(cx, cy, R, turn, ball, flag) {
      const img = this.face('tc', R * 2, (g, R) => {
        this.bezel(g, R);
        g.strokeStyle = COL.white;
        g.lineWidth = R * 0.05;
        for (const a of [0, 20, -20]) {
          const r0 = R * 0.66,
            r1 = R * 0.84;
          const aa = (a * DEG) + (a === 0 ? 0 : 0);
          for (const side of [-1, 1]) {
            const ang = Math.PI + (side === -1 ? 0 : Math.PI) + (side * aa);
            void ang;
          }
          g.beginPath();
          const ang = (a - 0) * DEG;
          g.moveTo(-Math.cos(ang) * r0, Math.sin(ang) * r0);
          g.lineTo(-Math.cos(ang) * r1, Math.sin(ang) * r1);
          g.moveTo(Math.cos(-ang) * r0, Math.sin(-ang) * r0);
          g.lineTo(Math.cos(-ang) * r1, Math.sin(-ang) * r1);
          g.stroke();
        }
        this.text(g, 'L', -R * 0.72, R * 0.42, R * 0.14);
        this.text(g, 'R', R * 0.72, R * 0.42, R * 0.14);
        this.text(g, 'TURN COORDINATOR', 0, -R * 0.52, R * 0.075, COL.white, 'center', 'normal');
        this.text(g, '2 MIN', 0, R * 0.72, R * 0.09);
        this.text(g, 'D.C. ELEC.', 0, -R * 0.38, R * 0.065, COL.dim, 'center', 'normal');
        this.text(g, 'NO PITCH', 0, R * 0.2, R * 0.06, COL.dim, 'center', 'normal');
        this.text(g, 'INFORMATION', 0, R * 0.28, R * 0.06, COL.dim, 'center', 'normal');
        // inclinometer tube
        g.fillStyle = '#e6e2cf';
        g.beginPath();
        g.ellipse(0, R * 0.3, R * 0.52, R * 0.16, 0, 0.18, Math.PI - 0.18);
        g.ellipse(0, R * 0.3, R * 0.52, R * 0.3, 0, Math.PI - 0.12, 0.12, true);
        g.fill();
      });
      this.blit(img, cx, cy, R * 2);
      const g = this.g;
      // ball
      const bx = cx + FS.clamp(ball / 0.3, -1, 1) * R * 0.4;
      const by = cy + R * 0.4 + Math.abs(FS.clamp(ball / 0.3, -1, 1)) * -R * 0.05;
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(bx, by, R * 0.075, 0, TAU);
      g.fill();
      g.strokeStyle = '#222';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx - R * 0.09, cy + R * 0.3);
      g.lineTo(cx - R * 0.09, cy + R * 0.5);
      g.moveTo(cx + R * 0.09, cy + R * 0.3);
      g.lineTo(cx + R * 0.09, cy + R * 0.5);
      g.stroke();
      // airplane symbol
      const a = FS.clamp((turn / 3) * 20, -45, 45) * DEG;
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      g.fillStyle = COL.white;
      g.fillRect(-R * 0.66, -R * 0.03, R * 1.32, R * 0.06);
      g.beginPath();
      g.arc(0, 0, R * 0.09, 0, TAU);
      g.fill();
      g.fillRect(-R * 0.02, -R * 0.2, R * 0.04, R * 0.12);
      g.fillRect(-R * 0.16, -R * 0.2, R * 0.32, R * 0.04);
      g.restore();
      if (flag) {
        g.fillStyle = COL.red;
        g.fillRect(cx - R * 0.14, cy - R * 0.32, R * 0.28, R * 0.12);
        this.text(g, 'OFF', cx, cy - R * 0.26, R * 0.09, '#fff');
      }
    }

    // ---------------- heading indicator ----------------
    compassCard(key, D) {
      return this.face(key, D, (g, R) => {
        const r = R * 0.86;
        for (let i = 0; i < 72; i++) {
          const a = (i * 5) * DEG - Math.PI / 2;
          const l = i % 2 === 0 ? R * 0.12 : R * 0.07;
          g.strokeStyle = COL.white;
          g.lineWidth = i % 2 === 0 ? 2 : 1;
          g.beginPath();
          g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          g.lineTo(Math.cos(a) * (r - l), Math.sin(a) * (r - l));
          g.stroke();
        }
        const lbl = { 0: 'N', 9: 'E', 18: 'S', 27: 'W' };
        for (let i = 0; i < 36; i += 3) {
          g.save();
          g.rotate(i * 10 * DEG);
          this.text(g, lbl[i] || String(i), 0, -R * 0.6, R * (lbl[i] ? 0.19 : 0.16));
          g.restore();
        }
      });
    }
    drawDG(cx, cy, R, hdg, bug, st) {
      const bz = this.face('dgbz', R * 2, (g, R) => this.bezel(g, R));
      this.blit(bz, cx, cy, R * 2);
      this.blit(this.compassCard('card', R * 2), cx, cy, R * 2, -hdg * DEG);
      const g = this.g;
      // heading bug
      g.save();
      g.translate(cx, cy);
      g.rotate((bug - hdg) * DEG);
      g.fillStyle = COL.orange;
      g.fillRect(-R * 0.08, -R * 0.9, R * 0.16, R * 0.08);
      g.fillStyle = COL.face;
      g.beginPath();
      g.moveTo(-R * 0.04, -R * 0.82);
      g.lineTo(0, -R * 0.88);
      g.lineTo(R * 0.04, -R * 0.82);
      g.fill();
      g.restore();
      // lubber & aircraft
      g.fillStyle = COL.orange;
      g.beginPath();
      g.moveTo(cx, cy - R * 0.74);
      g.lineTo(cx - R * 0.06, cy - R * 0.9);
      g.lineTo(cx + R * 0.06, cy - R * 0.9);
      g.fill();
      g.strokeStyle = COL.orange;
      g.lineWidth = R * 0.04;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, cy - R * 0.35);
      g.lineTo(cx, cy + R * 0.3);
      g.moveTo(cx - R * 0.3, cy - R * 0.02);
      g.lineTo(cx + R * 0.3, cy - R * 0.02);
      g.moveTo(cx - R * 0.12, cy + R * 0.26);
      g.lineTo(cx + R * 0.12, cy + R * 0.26);
      g.stroke();
      for (const a of [45, 135, 225, 315]) {
        const aa = a * DEG - Math.PI / 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(aa) * R * 0.88, cy + Math.sin(aa) * R * 0.88);
        g.lineTo(cx + Math.cos(aa) * R * 0.78, cy + Math.sin(aa) * R * 0.78);
        g.stroke();
      }
      this.knob(cx - R * 0.78, cy + R * 0.78, R * 0.13, 'PUSH');
      this.knob(cx + R * 0.78, cy + R * 0.78, R * 0.13, 'HDG');
      this.region(cx - R, cy + R * 0.55, R * 0.45, R * 0.45, { tip: 'Sync heading indicator to compass (G)', click: () => st.ind.syncDG() });
      this.region(cx - R, cy - R, R * 2, R * 2, {
        tip: 'Heading bug (wheel)',
        wheel: (d, sh) => (st.ap.hdgBug = FS.wrap360(Math.round(st.ap.hdgBug + d * (sh ? 10 : 1)))),
        click: (d) => (st.ap.hdgBug = FS.wrap360(Math.round(st.ap.hdgBug + d * 5))),
      });
    }

    // ---------------- VSI ----------------
    drawVSI(cx, cy, R, vs) {
      const ang = (v) => {
        const a = Math.abs(v),
          s = Math.sign(v);
        const d = a <= 1000 ? (a / 1000) * 90 : 90 + (Math.min(a, 2000) - 1000) / 1000 * 80;
        return (-90 + s * d) * DEG;
      };
      const img = this.face('vsi', R * 2, (g, R) => {
        this.bezel(g, R);
        for (let v = -2000; v <= 2000; v += 100) {
          if ((v <= 1000 && v >= -1000) || v % 500 === 0) {
            const a = ang(v) - Math.PI / 2;
            const l = v % 500 === 0 ? R * 0.13 : R * 0.07;
            g.strokeStyle = COL.white;
            g.lineWidth = v % 500 === 0 ? 2 : 1;
            g.beginPath();
            g.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
            g.lineTo(Math.cos(a) * (R * 0.88 - l), Math.sin(a) * (R * 0.88 - l));
            g.stroke();
            if (v % 500 === 0) this.text(g, String(Math.abs(v / 100)), Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, R * 0.16);
          }
        }
        this.text(g, 'UP', -R * 0.35, -R * 0.28, R * 0.1);
        this.text(g, 'DOWN', -R * 0.35, R * 0.28, R * 0.1);
        this.text(g, 'VERTICAL SPEED', R * 0.08, -R * 0.08, R * 0.065, COL.white, 'center', 'normal');
        this.text(g, '100 FEET PER MINUTE', R * 0.08, R * 0.06, R * 0.055, COL.dim, 'center', 'normal');
      });
      this.blit(img, cx, cy, R * 2);
      this.needle(cx, cy, ang(FS.clamp(vs, -2100, 2100)), R * 0.82, R * 0.065);
    }

    // ---------------- CDI (VOR / LOC / GS) ----------------
    drawCDI(cx, cy, R, rcv, withGS, label, st) {
      const o = rcv.out || {};
      const bz = this.face('cdibz', R * 2, (g, R) => this.bezel(g, R));
      this.blit(bz, cx, cy, R * 2);
      this.blit(this.compassCard('card', R * 2), cx, cy, R * 2, -rcv.obs * DEG);
      const g = this.g;
      // inner face
      g.fillStyle = COL.face;
      g.beginPath();
      g.arc(cx, cy, R * 0.62, 0, TAU);
      g.fill();
      // index
      g.fillStyle = COL.orange;
      g.beginPath();
      g.moveTo(cx, cy - R * 0.72);
      g.lineTo(cx - R * 0.07, cy - R * 0.88);
      g.lineTo(cx + R * 0.07, cy - R * 0.88);
      g.fill();
      // dots
      g.fillStyle = COL.white;
      const sp = R * 0.1;
      for (let i = -5; i <= 5; i++) {
        if (i === 0) continue;
        g.beginPath();
        g.arc(cx + i * sp, cy, R * 0.022, 0, TAU);
        g.fill();
        if (withGS) {
          g.beginPath();
          g.arc(cx, cy + i * sp, R * 0.022, 0, TAU);
          g.fill();
        }
      }
      g.strokeStyle = COL.white;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, sp * 0.9, 0, TAU);
      g.stroke();
      // needles
      const cdi = o.valid ? FS.clamp(o.cdi, -1.1, 1.1) : 0;
      if (!this._cdiS) this._cdiS = {};
      const key = label;
      const prev = this._cdiS[key] || 0;
      const sm = prev + (cdi - prev) * 0.15;
      this._cdiS[key] = sm;
      g.strokeStyle = COL.white;
      g.lineWidth = R * 0.035;
      g.beginPath();
      g.moveTo(cx + sm * 5 * sp, cy - R * 0.55);
      g.lineTo(cx + sm * 5 * sp, cy + R * 0.55);
      g.stroke();
      if (withGS) {
        const gsv = o.gsValid ? FS.clamp(o.gs, -1.1, 1.1) : 0;
        const pk = key + 'gs';
        const pg = this._cdiS[pk] || 0;
        const gsm = pg + (gsv - pg) * 0.15;
        this._cdiS[pk] = gsm;
        g.beginPath();
        g.moveTo(cx - R * 0.55, cy - gsm * 5 * sp);
        g.lineTo(cx + R * 0.55, cy - gsm * 5 * sp);
        g.stroke();
        if (!o.gsValid) {
          g.fillStyle = COL.red;
          g.fillRect(cx + R * 0.36, cy - R * 0.33, R * 0.2, R * 0.12);
          this.text(g, 'GS', cx + R * 0.46, cy - R * 0.27, R * 0.09, '#fff');
        }
      }
      // TO/FROM
      if (o.valid && o.type === 'VOR' && o.toFrom !== 0) {
        g.fillStyle = COL.white;
        g.beginPath();
        if (o.toFrom > 0) {
          g.moveTo(cx + R * 0.34, cy - R * 0.28);
          g.lineTo(cx + R * 0.26, cy - R * 0.16);
          g.lineTo(cx + R * 0.42, cy - R * 0.16);
        } else {
          g.moveTo(cx + R * 0.34, cy + R * 0.28);
          g.lineTo(cx + R * 0.26, cy + R * 0.16);
          g.lineTo(cx + R * 0.42, cy + R * 0.16);
        }
        g.fill();
        this.text(g, o.toFrom > 0 ? 'TO' : 'FR', cx + R * 0.34, cy + (o.toFrom > 0 ? -R * 0.4 : R * 0.4), R * 0.08);
      }
      if (!o.valid) {
        g.fillStyle = COL.red;
        g.fillRect(cx - R * 0.5, cy - R * 0.33, R * 0.26, R * 0.12);
        this.text(g, 'NAV', cx - R * 0.37, cy - R * 0.27, R * 0.09, '#fff');
      }
      this.text(g, label, cx - R * 0.28, cy + R * 0.42, R * 0.075, COL.dim);
      if (o.valid) this.text(g, o.ident + (o.backCourse ? ' BC' : ''), cx + R * 0.26, cy + R * 0.42, R * 0.085, COL.green);
      this.knob(cx - R * 0.78, cy + R * 0.78, R * 0.13, 'OBS');
      this.region(cx - R, cy - R, R * 2, R * 2, {
        tip: label + ' OBS (wheel)',
        wheel: (d, sh) => (rcv.obs = FS.wrap360(Math.round(rcv.obs + d * (sh ? 10 : 1)))),
        click: (d) => (rcv.obs = FS.wrap360(Math.round(rcv.obs + d * 5))),
      });
    }

    // ---------------- ADF ----------------
    drawADF(cx, cy, R, adf, st) {
      const bz = this.face('adfbz', R * 2, (g, R) => this.bezel(g, R));
      this.blit(bz, cx, cy, R * 2);
      this.blit(this.compassCard('card', R * 2), cx, cy, R * 2, -this.adfCard * DEG);
      const g = this.g;
      g.fillStyle = COL.orange;
      g.beginPath();
      g.moveTo(cx, cy - R * 0.74);
      g.lineTo(cx - R * 0.06, cy - R * 0.9);
      g.lineTo(cx + R * 0.06, cy - R * 0.9);
      g.fill();
      // needle
      g.save();
      g.translate(cx, cy);
      g.rotate(adf.needle * DEG);
      g.fillStyle = COL.yellow;
      g.beginPath();
      g.moveTo(0, -R * 0.78);
      g.lineTo(-R * 0.07, -R * 0.55);
      g.lineTo(-R * 0.025, -R * 0.55);
      g.lineTo(-R * 0.025, R * 0.7);
      g.lineTo(R * 0.025, R * 0.7);
      g.lineTo(R * 0.025, -R * 0.55);
      g.lineTo(R * 0.07, -R * 0.55);
      g.fill();
      g.restore();
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(cx, cy, R * 0.07, 0, TAU);
      g.fill();
      this.text(g, 'ADF', cx, cy + R * 0.3, R * 0.1, COL.dim);
      if (adf.valid) this.text(g, adf.ident, cx, cy - R * 0.3, R * 0.1, COL.green);
      this.knob(cx - R * 0.78, cy + R * 0.78, R * 0.13, 'HDG');
      this.region(cx - R, cy - R, R * 2, R * 2, {
        tip: 'ADF card (wheel)',
        wheel: (d, sh) => (this.adfCard = FS.wrap360(this.adfCard + d * (sh ? 10 : 1))),
        click: (d) => (this.adfCard = FS.wrap360(this.adfCard + d * 5)),
      });
    }

    // ---------------- Tachometer ----------------
    drawTach(cx, cy, R, rpm, hobbs) {
      const ang = (r) => (-120 + (r / 3500) * 240) * DEG;
      const img = this.face('tach', R * 2, (g, R) => {
        this.bezel(g, R);
        const arc = (r0, r1, c) => {
          g.strokeStyle = c;
          g.lineWidth = R * 0.07;
          g.beginPath();
          g.arc(0, 0, R * 0.8, ang(r0) - Math.PI / 2, ang(r1) - Math.PI / 2);
          g.stroke();
        };
        arc(2100, 2700, COL.green);
        g.strokeStyle = COL.red;
        g.lineWidth = R * 0.035;
        const a = ang(2700) - Math.PI / 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * R * 0.72, Math.sin(a) * R * 0.72);
        g.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9);
        g.stroke();
        for (let r = 0; r <= 3500; r += 100) {
          const a = ang(r) - Math.PI / 2;
          const l = r % 500 === 0 ? R * 0.13 : R * 0.06;
          g.strokeStyle = COL.white;
          g.lineWidth = r % 500 === 0 ? 2 : 1;
          g.beginPath();
          g.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
          g.lineTo(Math.cos(a) * (R * 0.88 - l), Math.sin(a) * (R * 0.88 - l));
          g.stroke();
          if (r % 500 === 0) this.text(g, String(r / 100), Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6, R * 0.15);
        }
        this.text(g, 'RPM', 0, -R * 0.3, R * 0.11);
        this.text(g, 'X100', 0, -R * 0.18, R * 0.08, COL.white, 'center', 'normal');
      });
      this.blit(img, cx, cy, R * 2);
      const g = this.g;
      g.fillStyle = '#000';
      g.fillRect(cx - R * 0.28, cy + R * 0.32, R * 0.56, R * 0.16);
      this.text(g, hobbs.toFixed(1).padStart(6, '0'), cx, cy + R * 0.4, R * 0.11, COL.white, 'center', 'normal');
      this.needle(cx, cy, ang(FS.clamp(rpm, 0, 3500)), R * 0.84, R * 0.065);
    }

    // ---------------- engine cluster ----------------
    drawEngine(x, y, w, h, st) {
      const g = this.g,
        ind = st.ind,
        ac = st.ac,
        E = ac.eng;
      g.fillStyle = '#16171a';
      roundRect(g, x, y, w, h, 6);
      g.fill();
      const rows = [
        ['FUEL L', ind.fuelG[0], 0, 26, [[0, 3, COL.red], [3, 26, COL.green]], 'GAL'],
        ['FUEL R', ind.fuelG[1], 0, 26, [[0, 3, COL.red], [3, 26, COL.green]], 'GAL'],
        ['OIL °F', E.oilT, 70, 260, [[100, 245, COL.green], [245, 260, COL.red]], ''],
        ['OIL PSI', E.oilP, 0, 115, [[0, 20, COL.red], [50, 90, COL.green], [100, 115, COL.red]], ''],
        ['EGT', E.egt, 700, 1700, [], '', this.egtRef],
        ['VAC', ind.suction, 3, 7, [[4.5, 5.5, COL.green]], 'inHg'],
        ['AMPS', ind.amps, -60, 60, [], ''],
        ['FF', E.ff, 0, 20, [[4, 11, COL.green]], 'GPH'],
      ];
      const rh = h / rows.length;
      rows.forEach((r, i) => {
        const yy = y + i * rh;
        const bx = x + w * 0.06,
          bw = w * 0.88,
          by = yy + rh * 0.55,
          bh = Math.max(3, rh * 0.14);
        this.text(g, r[0], x + w * 0.06, yy + rh * 0.28, Math.max(8, rh * 0.26), COL.dim, 'left', 'bold');
        const valTxt = r[0] === 'AMPS' ? (r[1] >= 0 ? '+' : '') + r[1].toFixed(0) : r[0] === 'VAC' ? r[1].toFixed(1) : r[0] === 'FF' ? r[1].toFixed(1) : Math.round(r[1]).toString();
        this.text(g, valTxt + (r[5] ? ' ' + r[5] : ''), x + w * 0.94, yy + rh * 0.28, Math.max(8, rh * 0.26), COL.white, 'right', 'bold');
        g.fillStyle = '#333';
        g.fillRect(bx, by, bw, bh);
        for (const seg of r[4]) {
          g.fillStyle = seg[2];
          const a = (seg[0] - r[2]) / (r[3] - r[2]),
            b = (seg[1] - r[2]) / (r[3] - r[2]);
          g.fillRect(bx + a * bw, by, (b - a) * bw, bh);
        }
        if (r[0] === 'AMPS') {
          g.fillStyle = '#777';
          g.fillRect(bx + bw / 2 - 1, by - 2, 2, bh + 4);
        }
        if (r[6]) {
          const t = FS.clamp((r[6] - r[2]) / (r[3] - r[2]), 0, 1);
          g.fillStyle = COL.orange;
          g.fillRect(bx + t * bw - 1, by - 3, 2, bh + 6);
        }
        const t = FS.clamp((r[1] - r[2]) / (r[3] - r[2]), 0, 1);
        g.fillStyle = '#fff';
        g.beginPath();
        g.moveTo(bx + t * bw, by - 1);
        g.lineTo(bx + t * bw - 4, by - 7);
        g.lineTo(bx + t * bw + 4, by - 7);
        g.fill();
        if (r[0] === 'EGT')
          this.region(x, yy, w, rh, { tip: 'EGT reference needle (wheel)', wheel: (d) => (this.egtRef = FS.clamp(this.egtRef + d * 10, 700, 1700)) });
      });
    }

    // ---------------- radio stack, autopilot, switches ----------------
    drawStack(x, y, w, h, st) {
      const g = this.g;
      const ac = st.ac;
      const rowH = h / 10.2;
      const fs = Math.max(9, Math.min(rowH * 0.42, w * 0.035));
      let yy = y;
      const box = (bx, by, bw, bh, c) => {
        g.fillStyle = c || '#141518';
        roundRect(g, bx, by, bw, bh, 4);
        g.fill();
      };
      const lcd = (s, bx, by, bw, bh, col, align) => {
        g.fillStyle = COL.lcdBg;
        g.fillRect(bx, by, bw, bh);
        this.text(g, s, align === 'left' ? bx + 6 : bx + bw / 2, by + bh / 2 + 1, bh * 0.62, col || COL.lcd, align || 'center', 'bold');
      };
      const btn = (label, bx, by, bw, bh, on, fn, tip) => {
        g.fillStyle = on ? '#3d4a3d' : '#2c2e32';
        roundRect(g, bx, by, bw, bh, 3);
        g.fill();
        g.strokeStyle = '#0a0a0a';
        g.stroke();
        this.text(g, label, bx + bw / 2, by + bh / 2 + 1, Math.min(bh * 0.5, fs), on ? '#9f9' : '#ddd', 'center', 'bold');
        this.region(bx, by, bw, bh, { click: fn, tip });
      };

      // --- KAP 140 autopilot
      const ap = st.ap;
      box(x, yy, w, rowH * 2.05);
      this.text(g, 'KAP 140', x + 8, yy + rowH * 0.3, fs * 0.8, COL.dim, 'left');
      const ann = ap.on || ap.alert > 0 ? ap.annunciation() : '';
      const flash = ap.alert > 0 && (Date.now() / 250) % 2 < 1;
      lcd(ap.on ? ann : flash ? 'AP' : '', x + w * 0.02, yy + rowH * 0.5, w * 0.6, rowH * 0.62, COL.lcd, 'left');
      const vsTxt = ap.on && ap.vertical === 'VS' ? (ap.vsSel >= 0 ? '↑' : '↓') + Math.abs(ap.vsSel) + ' FPM' : ap.altSel + ' FT';
      lcd(vsTxt, x + w * 0.64, yy + rowH * 0.5, w * 0.34, rowH * 0.62);
      this.region(x + w * 0.64, yy + rowH * 0.5, w * 0.34, rowH * 0.62, {
        tip: 'Altitude preselect (wheel, shift = 1000)',
        wheel: (d, sh) => (ap.altSel = FS.clamp(ap.altSel + d * (sh ? 1000 : 100), 0, 18000)),
        click: (d) => (ap.altSel = FS.clamp(ap.altSel + d * 100, 0, 18000)),
      });
      const bNames = ['AP', 'HDG', 'NAV', 'APR', 'REV', 'ALT', 'UP', 'DN'];
      const bw = (w - 8) / bNames.length;
      bNames.forEach((b, i) => {
        const on = (b === 'AP' && ap.on) || (ap.on && (ap.lateral === b || ap.armLat === b || ap.vertical === b));
        btn(b, x + 4 + i * bw, yy + rowH * 1.25, bw - 3, rowH * 0.7, on, () => ap.press(b, ac, st.ind.altFt, st.nav1.out), 'Autopilot ' + b);
      });
      yy += rowH * 2.2;

      // --- NAV radios
      const navRow = (label, rcv, idx) => {
        box(x, yy, w, rowH * 0.95);
        this.text(g, label, x + 8, yy + rowH * 0.47, fs * 0.8, COL.dim, 'left');
        const fx = x + w * 0.16,
          fw = w * 0.3;
        lcd(rcv.active.toFixed(2), fx, yy + rowH * 0.12, fw, rowH * 0.7, '#6f6');
        btn('⇄', fx + fw + 4, yy + rowH * 0.15, w * 0.08, rowH * 0.64, false, () => rcv.swap(), 'Swap active/standby');
        const sx = fx + fw + w * 0.1;
        lcd(rcv.standby.toFixed(2), sx, yy + rowH * 0.12, fw, rowH * 0.7, COL.lcd);
        const tune = (d, big) => {
          let f = rcv.standby;
          if (big) f = f + d;
          else {
            const mhz = Math.floor(f + 1e-6);
            let k = Math.round((f - mhz) * 100) + d * 5;
            if (k >= 100) k -= 100;
            if (k < 0) k += 100;
            f = mhz + k / 100;
          }
          if (f < 108) f += 10;
          if (f > 117.95) f -= 10;
          rcv.standby = Math.round(f * 100) / 100;
        };
        this.region(sx, yy, fw / 2, rowH, { tip: 'Standby MHz (wheel/click)', wheel: (d) => tune(d, true), click: (d) => tune(d, true) });
        this.region(sx + fw / 2, yy, fw / 2, rowH, { tip: 'Standby kHz (wheel/click)', wheel: (d) => tune(d, false), click: (d) => tune(d, false) });
        const o = rcv.out;
        this.text(g, o.valid ? o.ident : '---', x + w * 0.96, yy + rowH * 0.47, fs * 0.9, o.valid ? '#6f6' : '#555', 'right');
        yy += rowH;
      };
      navRow('NAV 1', st.nav1, 1);
      navRow('NAV 2', st.nav2, 2);

      // --- ADF + DME
      box(x, yy, w * 0.49, rowH * 0.95);
      this.text(g, 'ADF', x + 8, yy + rowH * 0.47, fs * 0.8, COL.dim, 'left');
      lcd(String(Math.round(st.adf.freq)), x + w * 0.12, yy + rowH * 0.12, w * 0.2, rowH * 0.7);
      this.region(x + w * 0.12, yy, w * 0.2, rowH, {
        tip: 'ADF frequency (wheel, shift = 10)',
        wheel: (d, sh) => (st.adf.freq = FS.clamp(st.adf.freq + d * (sh ? 10 : 1), 190, 1799)),
        click: (d) => (st.adf.freq = FS.clamp(st.adf.freq + d, 190, 1799)),
      });
      this.text(g, st.adf.valid ? st.adf.ident : '', x + w * 0.44, yy + rowH * 0.47, fs * 0.9, '#6f6', 'right');
      box(x + w * 0.51, yy, w * 0.49, rowH * 0.95);
      const src = this.dmeSrc === 2 ? st.nav2.out : st.nav1.out;
      const dme = src.dmeValid ? `${src.dme.toFixed(1)}NM ${Math.round(src.gsKt || 0)}KT ${src.gsKt > 30 ? Math.min(99, Math.round((src.dme / src.gsKt) * 60)) : '--'}MIN` : '---.-NM';
      this.text(g, 'DME N' + (this.dmeSrc || 1), x + w * 0.53, yy + rowH * 0.47, fs * 0.75, COL.dim, 'left');
      lcd(dme, x + w * 0.66, yy + rowH * 0.12, w * 0.33, rowH * 0.7, '#f55');
      this.region(x + w * 0.51, yy, w * 0.15, rowH, { tip: 'DME source NAV1/NAV2', click: () => (this.dmeSrc = this.dmeSrc === 2 ? 1 : 2) });
      yy += rowH;

      // --- Transponder + clock/OAT
      box(x, yy, w * 0.49, rowH * 0.95);
      this.text(g, 'XPDR', x + 8, yy + rowH * 0.47, fs * 0.8, COL.dim, 'left');
      const code = this.xpdr.join('');
      lcd(code + ' ALT', x + w * 0.14, yy + rowH * 0.12, w * 0.3, rowH * 0.7);
      for (let k = 0; k < 4; k++)
        this.region(x + w * 0.14 + k * w * 0.045, yy, w * 0.045, rowH, { tip: 'Squawk digit', wheel: (d) => (this.xpdr[k] = (this.xpdr[k] + d + 8) % 8), click: (d) => (this.xpdr[k] = (this.xpdr[k] + d + 8) % 8) });
      box(x + w * 0.51, yy, w * 0.49, rowH * 0.95);
      const hh = Math.floor(st.hours),
        mm = Math.floor((st.hours - hh) * 60);
      const ft = st.flightTime,
        fm = Math.floor(ft / 60),
        fsx = Math.floor(ft % 60);
      lcd(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}L  FT ${String(fm).padStart(2, '0')}:${String(fsx).padStart(2, '0')}`, x + w * 0.52, yy + rowH * 0.12, w * 0.3, rowH * 0.7, '#ddd');
      lcd(`OAT ${Math.round(st.ind.oat)}°C`, x + w * 0.83, yy + rowH * 0.12, w * 0.16, rowH * 0.7, '#ddd');
      yy += rowH;

      // --- switches
      const sw = [
        ['BAT', ac.elec.master, () => (ac.elec.master = !ac.elec.master)],
        ['ALT', ac.elec.alternator, () => (ac.elec.alternator = !ac.elec.alternator)],
        ['AVN', ac.elec.avionics, () => (ac.elec.avionics = !ac.elec.avionics)],
        ['BCN', ac.lights.beacon, () => (ac.lights.beacon = !ac.lights.beacon)],
        ['LAND', ac.lights.landing, () => (ac.lights.landing = !ac.lights.landing)],
        ['TAXI', ac.lights.taxi, () => (ac.lights.taxi = !ac.lights.taxi)],
        ['NAV', ac.lights.nav, () => (ac.lights.nav = !ac.lights.nav)],
        ['STRB', ac.lights.strobe, () => (ac.lights.strobe = !ac.lights.strobe)],
        ['PITOT', ac.pitotHeat, () => (ac.pitotHeat = !ac.pitotHeat)],
      ];
      const sww = w / sw.length;
      sw.forEach((s, i) => this.toggle(x + i * sww, yy, sww - 3, rowH * 1.25, s[0], s[1], s[2]));
      yy += rowH * 1.35;
      const sw2 = [
        ['CARB HT', ac.ctl.carbHeat, () => (ac.ctl.carbHeat = !ac.ctl.carbHeat)],
        ['ALT STAT', st.ind.altStatic, () => (st.ind.altStatic = !st.ind.altStatic)],
        ['P BRAKE', ac.ctl.parkingBrake, () => (ac.ctl.parkingBrake = !ac.ctl.parkingBrake)],
      ];
      const w2 = w * 0.36;
      sw2.forEach((s, i) => this.toggle(x + (i * w2) / 3, yy, w2 / 3 - 3, rowH * 1.25, s[0], s[1], s[2]));
      // magnetos
      const mx = x + w2 + 4;
      const magN = ['OFF', 'R', 'L', 'BOTH', 'START'];
      box(mx, yy, w * 0.16, rowH * 1.25, '#1a1b1e');
      this.text(g, 'MAGS', mx + w * 0.08, yy + rowH * 0.28, fs * 0.72, COL.dim);
      this.text(g, magN[ac.ctl.mags], mx + w * 0.08, yy + rowH * 0.8, fs, ac.ctl.mags === 4 ? COL.orange : '#fff');
      this.region(mx, yy, w * 0.16, rowH * 1.25, {
        tip: 'Magnetos / starter (click, hold START with S key)',
        click: (d) => (ac.ctl.mags = FS.clamp(ac.ctl.mags + d, 0, 3)),
        wheel: (d) => (ac.ctl.mags = FS.clamp(ac.ctl.mags + d, 0, 3)),
      });
      // fuel selector
      const fx = mx + w * 0.17;
      const fuelN = ['LEFT', 'BOTH', 'RIGHT', 'OFF'];
      box(fx, yy, w * 0.16, rowH * 1.25, '#1a1b1e');
      this.text(g, 'FUEL', fx + w * 0.08, yy + rowH * 0.28, fs * 0.72, COL.dim);
      this.text(g, ac.ctl.fuelSel, fx + w * 0.08, yy + rowH * 0.8, fs, ac.ctl.fuelSel === 'OFF' ? COL.red : '#fff');
      this.region(fx, yy, w * 0.16, rowH * 1.25, {
        tip: 'Fuel selector',
        click: (d) => (ac.ctl.fuelSel = fuelN[(fuelN.indexOf(ac.ctl.fuelSel) + d + 4) % 4]),
        wheel: (d) => (ac.ctl.fuelSel = fuelN[(fuelN.indexOf(ac.ctl.fuelSel) + d + 4) % 4]),
      });
      // flaps indicator
      const flx = fx + w * 0.17;
      box(flx, yy, w * 0.3, rowH * 1.25, '#1a1b1e');
      this.text(g, `FLAPS ${Math.round(ac.flapDeg)}°`, flx + w * 0.15, yy + rowH * 0.28, fs * 0.72, COL.dim);
      for (let k = 0; k < 4; k++) {
        const on = ac.ctl.flaps === k;
        g.fillStyle = on ? '#fff' : '#444';
        g.fillRect(flx + w * 0.03 + k * w * 0.065, yy + rowH * 0.62, w * 0.055, rowH * 0.36);
        this.text(g, String(k * 10), flx + w * 0.03 + k * w * 0.065 + w * 0.0275, yy + rowH * 0.8, fs * 0.7, on ? '#000' : '#aaa');
      }
      this.region(flx, yy, w * 0.3, rowH * 1.25, { tip: 'Flaps', click: (d) => (ac.ctl.flaps = FS.clamp(ac.ctl.flaps + d, 0, 3)), wheel: (d) => (ac.ctl.flaps = FS.clamp(ac.ctl.flaps - d, 0, 3)) });
      yy += rowH * 1.35;

      // --- levers & trim
      const lv = [
        ['THROTTLE', ac.ctl.throttle, '#111', (d) => (ac.ctl.throttle = FS.clamp(ac.ctl.throttle + d * 0.02, 0, 1))],
        ['MIXTURE', ac.ctl.mixture, '#b01818', (d) => (ac.ctl.mixture = FS.clamp(ac.ctl.mixture + d * 0.01, 0, 1))],
      ];
      const lw = w * 0.34;
      lv.forEach((l, i) => {
        const lx = x + i * (lw + 4);
        box(lx, yy, lw, rowH * 0.9, '#1a1b1e');
        this.text(g, l[0], lx + 6, yy + rowH * 0.45, fs * 0.72, COL.dim, 'left');
        const bx = lx + lw * 0.42,
          bwid = lw * 0.52;
        g.fillStyle = '#333';
        g.fillRect(bx, yy + rowH * 0.4, bwid, rowH * 0.12);
        g.fillStyle = l[2] === '#111' ? '#e8e8e8' : l[2];
        g.beginPath();
        g.arc(bx + l[1] * bwid, yy + rowH * 0.46, rowH * 0.24, 0, TAU);
        g.fill();
        g.strokeStyle = '#000';
        g.stroke();
        this.region(lx, yy, lw, rowH * 0.9, { tip: l[0] + ' (wheel)', wheel: l[3], click: (d) => l[3](d * 2) });
      });
      // trim
      const tx = x + 2 * (lw + 4);
      const tw = w - 2 * (lw + 4);
      box(tx, yy, tw, rowH * 0.9, '#1a1b1e');
      this.text(g, 'TRIM', tx + 6, yy + rowH * 0.45, fs * 0.72, COL.dim, 'left');
      const tbx = tx + tw * 0.35,
        tbw = tw * 0.55;
      g.fillStyle = '#333';
      g.fillRect(tbx, yy + rowH * 0.4, tbw, rowH * 0.12);
      g.fillStyle = COL.white;
      g.fillRect(tbx + tbw * 0.5 - 1, yy + rowH * 0.25, 2, rowH * 0.4);
      g.fillStyle = COL.orange;
      const tpos = tbx + ((FS.clamp(ac.ctl.trim, -1, 1) + 1) / 2) * tbw;
      g.fillRect(tpos - 3, yy + rowH * 0.2, 6, rowH * 0.5);
      this.text(g, 'DN', tbx - 2, yy + rowH * 0.78, fs * 0.6, COL.dim, 'left');
      this.text(g, 'UP', tbx + tbw, yy + rowH * 0.78, fs * 0.6, COL.dim, 'right');
      this.region(tx, yy, tw, rowH * 0.9, { tip: 'Elevator trim (wheel)', wheel: (d) => (ac.ctl.trim = FS.clamp(ac.ctl.trim + d * 0.02, -1, 1)), click: (d) => (ac.ctl.trim = FS.clamp(ac.ctl.trim + d * 0.03, -1, 1)) });
      yy += rowH;

      // tooltip
      if (this.hover) this.text(g, this.hover, x + w, this.H - 6, fs * 0.8, '#aab', 'right', 'normal');
    }

    toggle(x, y, w, h, label, on, fn) {
      const g = this.g;
      g.fillStyle = '#1a1b1e';
      roundRect(g, x, y, w, h, 3);
      g.fill();
      const sx = x + w / 2,
        sy = y + h * 0.36;
      g.fillStyle = '#0a0a0a';
      g.fillRect(sx - w * 0.14, sy - h * 0.2, w * 0.28, h * 0.4);
      g.fillStyle = on ? '#e8e8e8' : '#777';
      g.fillRect(sx - w * 0.1, on ? sy - h * 0.2 : sy, w * 0.2, h * 0.2);
      this.text(g, label, sx, y + h * 0.82, Math.min(h * 0.26, w * 0.2), on ? '#fff' : '#999', 'center', 'bold');
      this.region(x, y, w, h, { click: fn, tip: label });
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) * k,
      gg = ((n >> 8) & 255) * k,
      b = (n & 255) * k;
    return `rgb(${r | 0},${gg | 0},${b | 0})`;
  }

  FS.Panel = Panel;
})(typeof window !== 'undefined' ? window : globalThis);
