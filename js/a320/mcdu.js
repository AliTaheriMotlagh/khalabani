/*
 * A320 MCDU (Multipurpose Control & Display Unit). Drawn on its own canvas with clickable keys; physical keyboard
 * input goes to the scratchpad while the MCDU has focus.
 * Pages: MCDU MENU, INIT A/B, F-PLN (+LAT REV, VERT REV, DEPARTURE, ARRIVAL), DIR TO, PERF (T.O, CLB, CRZ, DES, APPR,
 * GO AROUND), RAD NAV, PROG, FUEL PRED, DATA.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { NM, FT, KT } = FS.U;
  const COL = { w: '#ffffff', c: '#35d8ff', g: '#3dff5a', a: '#ffa21a', m: '#ff6cff', y: '#fff23a' };
  const pad = (s, n) => String(s).padStart(n, ' ');
  const box = (n) => '□'.repeat(n);

  class MCDU {
    constructor(canvas, fm, getAc) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.fm = fm;
      this.getAc = getAc;
      this.page = 'MENU';
      this.sub = 0;
      this.scroll = 0;
      this.sp = '';
      this.spMsg = null;
      this.regions = [];
      this.lines = [];
      this.focus = false;
      this.ctx = {};
      canvas.addEventListener('mousedown', (e) => {
        this.focus = true;
        const r = canvas.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * this.W,
          y = ((e.clientY - r.top) / r.height) * this.H;
        for (const k of this.regions) if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) {
          this.key(k.id);
          this.pressed = { id: k.id, t: performance.now() };
          e.preventDefault();
          break;
        }
      });
    }

    // ------------------------------------------------------------ keyboard
    typeKey(e) {
      if (!this.focus) return false;
      const k = e.key;
      if (k === 'Escape') {
        this.focus = false;
        return false;
      }
      if (k === 'Backspace') this.key('CLR');
      else if (k === 'Delete') this.key('CLR');
      else if (/^[a-zA-Z0-9]$/.test(k)) this.key(k.toUpperCase());
      else if (k === '.' || k === '/' || k === '-' || k === '+') this.key(k === '-' || k === '+' ? '+/-' : k);
      else if (k === ' ') this.key('SP');
      else if (k === 'ArrowUp') this.key('UP');
      else if (k === 'ArrowDown') this.key('DOWN');
      else if (k === 'ArrowLeft') this.key('LEFT');
      else if (k === 'ArrowRight') this.key('RIGHT');
      else if (/^F[1-6]$/.test(k)) this.key('L' + k.slice(1));
      else return false;
      e.preventDefault();
      return true;
    }

    key(id) {
      if (this.spMsg && id !== 'CLR') this.spMsg = null;
      if (/^[A-Z0-9]$/.test(id) || id === '.' || id === '/') {
        if (this.sp === 'CLR') this.sp = '';
        if (this.sp.length < 22) this.sp += id;
        return;
      }
      switch (id) {
        case 'SP':
          this.sp += ' ';
          return;
        case '+/-':
          if (this.sp.endsWith('-')) this.sp = this.sp.slice(0, -1) + '+';
          else if (this.sp.endsWith('+')) this.sp = this.sp.slice(0, -1) + '-';
          else this.sp += '-';
          return;
        case 'CLR':
          if (this.spMsg) this.spMsg = null;
          else if (this.sp.length && this.sp !== 'CLR') this.sp = this.sp.slice(0, -1);
          else this.sp = this.sp === 'CLR' ? '' : 'CLR';
          return;
        case 'OVFY':
          this.sp = 'Δ';
          return;
        case 'UP':
          this.scroll = Math.max(0, this.scroll - 1);
          return;
        case 'DOWN':
          this.scroll++;
          return;
        case 'LEFT':
        case 'RIGHT':
          this.slew(id === 'RIGHT' ? 1 : -1);
          return;
        case 'DIR':
          return this.go('DIR');
        case 'PROG':
          return this.go('PROG');
        case 'PERF':
          return this.go('PERF', this.perfPhaseIdx());
        case 'INIT':
          return this.go('INIT');
        case 'DATA':
          return this.go('DATA');
        case 'FPLN':
          return this.go('FPLN');
        case 'RAD':
          return this.go('RAD');
        case 'FUEL':
          return this.go('FUEL');
        case 'SEC':
          return this.go('SEC');
        case 'ATC':
          return this.go('ATC');
        case 'MENU':
          return this.go('MENU');
        case 'AIRPORT':
          this.go('FPLN');
          this.scroll = Math.max(0, this.fm.plan.findIndex((l) => l.type === 'DEST') - 2);
          return;
      }
      if (/^[LR][1-6]$/.test(id)) this.lsk(id[0], +id[1]);
    }
    go(p, sub) {
      this.page = p;
      this.sub = sub || 0;
      this.scroll = 0;
      this.ctx = {};
    }
    slew(d) {
      if (this.page === 'INIT') this.sub = (this.sub + d + 2) % 2;
      else if (this.page === 'PERF') this.sub = FS.clamp(this.sub + d, 0, 5);
    }
    perfPhaseIdx() {
      return { PREFLIGHT: 0, TAKEOFF: 0, CLIMB: 1, CRUISE: 2, DESCENT: 3, APPROACH: 4, GOAROUND: 5, DONE: 0 }[this.fm.phase] || 0;
    }
    err(m) {
      this.spMsg = m;
    }
    takeSp() {
      const s = this.sp;
      this.sp = '';
      return s;
    }

    // ------------------------------------------------------------ line select keys
    lsk(side, n) {
      this.build(); // make sure the handlers belong to the page currently shown
      const h = this.handlers && this.handlers[side + n];
      if (h) {
        const r = h(this.sp);
        if (r === 'FORMAT') this.err('FORMAT ERROR');
        else if (r === 'NOTDB') this.err('NOT IN DATABASE');
        else if (r === 'NOT') this.err('NOT ALLOWED');
        else if (r === 'RANGE') this.err('ENTRY OUT OF RANGE');
      } else if (this.sp) this.err('NOT ALLOWED');
    }

    // ------------------------------------------------------------ page builders: produce 14 lines, each [[text,color,small], ...]
    build() {
      const fm = this.fm,
        d = fm.d,
        ac = this.getAc();
      const L = Array.from({ length: 14 }, () => []);
      const H = {};
      this.handlers = H;
      const put = (row, text, col, align, small) => L[row].push({ t: text, c: col || COL.w, a: align || 'L', s: !!small });
      const title = (t, col) => put(0, t, col || COL.w, 'C');
      const label = (i, t, side) => put(i * 2 - 1, t, COL.w, side || 'L', true);
      const field = (i, t, col, side, small) => put(i * 2, t, col, side || 'L', small);
      const num = (s) => (s === '' || isNaN(+s) ? null : +s);
      switch (this.page) {
        case 'MENU': {
          title('MCDU MENU');
          field(1, '<FMGC (REQ)', COL.g);
          field(2, '<ATSU', COL.w);
          field(3, '<AIDS', COL.w);
          field(4, '<CFDS', COL.w);
          field(6, 'RETURN>', COL.w, 'R');
          H.L1 = () => this.go('INIT');
          break;
        }
        case 'INIT': {
          if (this.sub === 0) {
            title('INIT', COL.w);
            put(0, '→', COL.w, 'R');
            label(1, ' CO RTE');
            field(1, d.coRte || '□□□□□□□□□□', d.coRte ? COL.c : COL.a);
            label(1, 'FROM/TO  ', 'R');
            field(1, d.from ? `${d.from}/${d.to}` : '□□□□/□□□□', d.from ? COL.c : COL.a, 'R');
            H.R1 = (s) => {
              const m = s.match(/^([A-Z]{4})\/([A-Z]{4})$/);
              if (!m) return 'FORMAT';
              if (!fm.setFromTo(m[1], m[2])) return 'NOTDB';
              this.takeSp();
            };
            H.L1 = (s) => {
              if (!s) return 'FORMAT';
              d.coRte = this.takeSp();
            };
            label(2, 'ALTN/CO RTE');
            field(2, `${d.altn || '----'}/NONE`, COL.c);
            H.L2 = (s) => {
              if (!/^[A-Z]{4}$/.test(s)) return 'FORMAT';
              d.altn = this.takeSp();
            };
            label(2, 'INIT ', 'R');
            field(2, 'REQUEST*', COL.a, 'R');
            label(3, 'FLT NBR');
            field(3, d.flt, COL.c);
            H.L3 = (s) => {
              if (!s || s.length > 8) return 'FORMAT';
              d.flt = this.takeSp();
            };
            label(3, 'ALIGN IRS ', 'R');
            field(3, 'IRS ALIGNED', COL.g, 'R');
            label(4, 'LAT');
            const lat = 35.689 + ac.pos.x / 110950,
              lon = 51.315 + ac.pos.y / 90413;
            field(4, `${Math.floor(lat)}°${((lat % 1) * 60).toFixed(1)}N`, COL.c);
            label(4, 'LONG ', 'R');
            field(4, `${String(Math.floor(lon)).padStart(3, '0')}°${((lon % 1) * 60).toFixed(1)}E`, COL.c, 'R');
            label(5, 'COST INDEX');
            field(5, String(d.ci), COL.c);
            H.L5 = (s) => {
              const v = num(s);
              if (v == null) return 'FORMAT';
              if (v < 0 || v > 999) return 'RANGE';
              d.ci = v;
              this.takeSp();
            };
            label(5, 'WIND/TEMP>', 'R');
            label(6, 'CRZ FL/TEMP');
            field(6, `FL${d.crzFL}/${Math.round(15 - d.crzFL * 0.198)}°`, COL.c);
            H.L6 = (s) => {
              const v = num(s.replace(/^FL/, '').split('/')[0]);
              if (v == null) return 'FORMAT';
              if (v < 10 || v > 398) return 'RANGE';
              d.crzFL = v;
              this.takeSp();
            };
            label(6, 'TROPO', 'R');
            field(6, String(d.tropo), COL.c, 'R', true);
            H.R3 = () => {};
          } else {
            title('INIT', COL.w);
            put(0, '←', COL.w, 'L');
            label(1, 'TAXI');
            field(1, d.taxi.toFixed(1), COL.c);
            label(1, 'ZFW/ZFWCG', 'R');
            field(1, `${d.zfw.toFixed(1)}/${d.zfwcg.toFixed(1)}`, COL.c, 'R');
            H.R1 = (s) => {
              const [a, b] = s.split('/');
              const z = num(a);
              if (z == null) return 'FORMAT';
              if (z < 35 || z > 62.5) return 'RANGE';
              d.zfw = z;
              if (num(b) != null) d.zfwcg = num(b);
              ac.zfw = z * 1000;
              this.takeSp();
            };
            H.L1 = (s) => {
              const v = num(s);
              if (v == null) return 'FORMAT';
              d.taxi = v;
              this.takeSp();
            };
            const fob = ac.sys ? ac.sys.fob() / 1000 : ac.fuelKg / 1000;
            label(2, 'TRIP/TIME');
            const trip = this.tripFuel();
            field(2, `${trip.fuel.toFixed(1)}/${String(Math.floor(trip.min / 60)).padStart(2, '0')}${String(Math.round(trip.min % 60)).padStart(2, '0')}`, COL.g);
            label(2, 'BLOCK', 'R');
            field(2, fob.toFixed(1), COL.c, 'R');
            H.R2 = (s) => {
              const v = num(s);
              if (v == null) return 'FORMAT';
              if (v < 1 || v > 18.7) return 'RANGE';
              d.block = v;
              if (ac.sys) ac.sys.setFuel(v * 1000);
              else ac.fuelKg = v * 1000;
              this.takeSp();
            };
            label(3, 'RTE RSV/%');
            field(3, `${(trip.fuel * 0.05).toFixed(1)}/5.0`, COL.g);
            label(4, 'ALTN/TIME');
            field(4, '1.8/0030', COL.g);
            label(5, 'FINAL/TIME');
            field(5, `${d.rsv.toFixed(1)}/0030`, COL.c);
            label(6, 'EXTRA/TIME');
            const extra = fob - d.taxi - trip.fuel - trip.fuel * 0.05 - 1.8 - d.rsv;
            field(6, `${extra.toFixed(1)}/${extra > 0 ? '0' + Math.round(extra * 25) : '0000'}`, extra > 0 ? COL.g : COL.a);
            label(4, 'TOW', 'R');
            field(4, (d.zfw + fob - d.taxi).toFixed(1), COL.g, 'R');
            label(5, 'LW', 'R');
            field(5, (d.zfw + fob - d.taxi - trip.fuel).toFixed(1), COL.g, 'R');
          }
          break;
        }
        case 'FPLN':
          this.buildFpln(L, H, put);
          break;
        case 'LATREV': {
          const idx = this.ctx.idx;
          const l = fm.plan[idx];
          if (!l) return this.go('FPLN');
          title(`LAT REV FROM ${l.ident}`);
          if (l.type === 'ORIG') {
            field(1, '<DEPARTURE', COL.w);
            H.L1 = () => this.go('DEP');
          }
          if (l.type === 'DEST' || l.arr) {
            field(1, 'ARRIVAL>', COL.w, 'R');
            H.R1 = () => this.go('ARR');
          }
          label(3, 'NEXT WPT ', 'R');
          field(3, '[    ]', COL.c, 'R');
          H.R3 = (s) => {
            if (!s) return 'FORMAT';
            if (!fm.insertWpt(idx + 1, s)) return 'NOTDB';
            this.takeSp();
            this.go('FPLN');
          };
          label(4, 'NEW DEST ', 'R');
          field(4, '[   ]', COL.c, 'R');
          H.R4 = (s) => {
            if (!fm.db.airports.get(s)) return 'NOTDB';
            fm.plan = fm.plan.filter((x) => !x.arr && x.type !== 'DEST');
            const B = fm.db.airports.get(s);
            fm.plan.push({ disc: true }, { ident: s, n: B.n, e: B.e, type: 'DEST' });
            fm.d.to = s;
            fm.cleanDiscs();
            this.takeSp();
            this.go('FPLN');
          };
          field(6, '<RETURN', COL.w);
          H.L6 = () => this.go('FPLN');
          break;
        }
        case 'VERTREV': {
          const l = fm.plan[this.ctx.idx];
          if (!l) return this.go('FPLN');
          title(`VERT REV AT ${l.ident}`);
          label(1, ' SPD LIM');
          field(1, '250/FL100', COL.m);
          label(3, ' SPD CSTR');
          field(3, l.spd ? String(l.spd) : '[   ]', COL.m);
          label(3, 'ALT CSTR ', 'R');
          field(3, l.alt ? `${l.alt.t === '@' ? '' : l.alt.t}${l.alt.v}` : '[    ]', COL.m, 'R');
          H.L3 = (s) => {
            const v = num(s);
            if (s === 'CLR') {
              l.spd = null;
              return void this.takeSp();
            }
            if (v == null) return 'FORMAT';
            l.spd = v;
            this.takeSp();
          };
          H.R3 = (s) => {
            if (s === 'CLR') {
              l.alt = null;
              return void this.takeSp();
            }
            const m = s.match(/^([+-]?)(?:FL)?(\d{2,5})$/);
            if (!m) return 'FORMAT';
            let v = +m[2];
            if (s.includes('FL') || v < 500) v *= 100;
            l.alt = { t: m[1] || '@', v };
            this.takeSp();
          };
          field(6, '<RETURN', COL.w);
          H.L6 = () => this.go('FPLN');
          break;
        }
        case 'DEP': {
          const ap = fm.db.airports.get(d.from);
          title(`DEPARTURES FROM ${d.from}`);
          label(1, ' RWY      SID', 'L');
          const rwys = ap ? ap.runways.flatMap((r) => r.thr.map((t) => ({ t, r }))) : [];
          if (!this.ctx.rwy) {
            rwys.slice(0, 5).forEach((x, i) => {
              field(i + 1, `<${x.t.id}  ${Math.round(x.r.length)}M`, COL.c);
              label(i + 1, i === 0 ? ' AVAILABLE RUNWAYS' : '');
              H['L' + (i + 1)] = () => {
                this.ctx.rwy = x.t.id;
              };
            });
          } else {
            label(1, ' SELECTED RWY ' + this.ctx.rwy);
            const sids = fm.db.sids(d.from, this.ctx.rwy);
            [{ name: 'NO SID' }, ...sids].slice(0, 4).forEach((sd, i) => {
              field(i + 2, `<${sd.name}${sd.exit ? '  →' + sd.exit : ''}`, this.ctx.sid === sd.name ? COL.y : COL.c);
              H['L' + (i + 2)] = () => {
                this.ctx.sid = sd.name;
              };
            });
            field(6, 'INSERT*', COL.a, 'R');
            H.R6 = () => {
              fm.setDeparture(this.ctx.rwy, this.ctx.sid && this.ctx.sid !== 'NO SID' ? this.ctx.sid : null);
              this.go('FPLN');
            };
          }
          field(6, '<RETURN', COL.w);
          H.L6 = () => this.go('FPLN');
          break;
        }
        case 'ARR': {
          title(`ARRIVAL TO ${d.to}`);
          const aps = fm.db.approaches(d.to);
          if (!this.ctx.appr) {
            label(1, ' APPR');
            aps.slice(0, 5).forEach((a, i) => {
              field(i + 1, `<${a.name}  ${a.ils.freq.toFixed(2)} ${a.ils.course}°`, COL.c);
              H['L' + (i + 1)] = () => {
                this.ctx.appr = a.name;
                this.ctx.rwy = a.rwy;
              };
            });
          } else {
            label(1, ' APPR ' + this.ctx.appr);
            field(1, '<CHANGE', COL.w);
            H.L1 = () => (this.ctx.appr = null);
            label(2, ' VIAS');
            ['NO VIA', ...fm.db.vias(d.to, this.ctx.rwy)].slice(0, 4).forEach((v, i) => {
              field(i + 2, `<${v}`, this.ctx.via === v ? COL.y : COL.c);
              H['L' + (i + 2)] = () => (this.ctx.via = v);
            });
            field(6, 'INSERT*', COL.a, 'R');
            H.R6 = () => {
              fm.setArrival(this.ctx.appr, this.ctx.via && this.ctx.via !== 'NO VIA' ? this.ctx.via : null);
              this.go('FPLN');
            };
          }
          field(6, '<RETURN', COL.w);
          H.L6 = () => this.go('FPLN');
          break;
        }
        case 'DIR': {
          title('DIR TO');
          label(1, ' WAYPOINT');
          field(1, '[     ]', COL.c);
          H.L1 = (s) => {
            if (!s) return 'FORMAT';
            if (!fm.directTo(s)) return 'NOTDB';
            this.takeSp();
            this.go('FPLN');
          };
          const pts = fm.plan.filter((l, i) => i >= fm.active && !l.disc && !l.hidden).slice(this.scroll, this.scroll + 4);
          pts.forEach((l, i) => {
            field(i + 2, `<${l.ident}`, COL.c);
            H['L' + (i + 2)] = () => {
              fm.directTo(l.ident);
              this.go('FPLN');
            };
          });
          label(1, 'UTC   DIST ', 'R');
          break;
        }
        case 'PERF':
          this.buildPerf(L, H, put, title, label, field, num);
          break;
        case 'RAD': {
          const r = fm.radio;
          title('RADIO NAV');
          label(1, 'VOR1/FREQ');
          field(1, `${r.vor1.ident || ''}/${r.vor1.freq.toFixed(2)}`, COL.c);
          H.L1 = (s) => this.freqEntry(s, (f) => (r.vor1 = Object.assign(r.vor1, f)), 108, 117.95);
          label(1, 'FREQ/VOR2', 'R');
          field(1, `${r.vor2.freq.toFixed(2)}/${r.vor2.ident || ''}`, COL.c, 'R');
          H.R1 = (s) => this.freqEntry(s, (f) => (r.vor2 = Object.assign(r.vor2, f)), 108, 117.95);
          label(2, 'CRS');
          field(2, String(r.vor1.crs).padStart(3, '0'), COL.c);
          H.L2 = (s) => this.crsEntry(s, (v) => (r.vor1.crs = v));
          label(2, 'CRS', 'R');
          field(2, String(r.vor2.crs).padStart(3, '0'), COL.c, 'R');
          H.R2 = (s) => this.crsEntry(s, (v) => (r.vor2.crs = v));
          label(3, 'ILS /FREQ');
          field(3, `${r.ils.ident || ''}/${r.ils.freq.toFixed(2)}`, COL.m);
          H.L3 = (s) => this.freqEntry(s, (f) => {
            r.ils = Object.assign(r.ils, f);
            r.autoIls = false;
            const loc = fm.db.ils.find((l) => Math.abs(l.freq - r.ils.freq) < 0.001);
            if (loc) r.ils.crs = loc.course;
          }, 108.1, 111.95);
          label(4, 'CRS');
          field(4, String(r.ils.crs).padStart(3, '0'), COL.m);
          H.L4 = (s) => this.crsEntry(s, (v) => (r.ils.crs = v));
          label(5, 'ADF1/FREQ');
          field(5, `/${r.adf1.toFixed(1)}`, COL.c);
          H.L5 = (s) => {
            const v = num(s.replace('/', ''));
            if (v == null) return 'FORMAT';
            if (v < 190 || v > 1750) return 'RANGE';
            r.adf1 = v;
            this.takeSp();
          };
          label(5, 'FREQ/ADF2', 'R');
          field(5, `${r.adf2.toFixed(1)}/`, COL.c, 'R');
          H.R5 = (s) => {
            const v = num(s.replace('/', ''));
            if (v == null) return 'FORMAT';
            r.adf2 = v;
            this.takeSp();
          };
          break;
        }
        case 'PROG': {
          const ph = { PREFLIGHT: 'PREFLIGHT', TAKEOFF: 'TAKE OFF', CLIMB: 'CLIMB', CRUISE: 'CRUISE', DESCENT: 'DES', APPROACH: 'APPR', GOAROUND: 'GO AROUND', DONE: 'DONE' }[fm.phase];
          title(`${ph} ${d.flt}`, COL.g);
          label(1, ' CRZ');
          field(1, `FL${d.crzFL}`, COL.c);
          H.L1 = (s) => {
            const v = num(s.replace('FL', ''));
            if (v == null) return 'FORMAT';
            d.crzFL = v;
            this.takeSp();
          };
          label(1, 'OPT    REC MAX', 'R');
          field(1, `FL${Math.min(390, 330 + Math.round((64 - ac.mass / 1000) * 5))}  FL${Math.min(398, 360 + Math.round((70 - ac.mass / 1000) * 4))}`, COL.g, 'R');
          label(3, ' BRG /DIST');
          const t = this.ctx.bdTo && fm.db.find(this.ctx.bdTo);
          if (t) {
            const brg = FS.mag(Math.atan2(t.e - ac.pos.y, t.n - ac.pos.x) * 57.2958);
            field(3, `${String(Math.round(brg)).padStart(3, '0')}°/${(Math.hypot(t.e - ac.pos.y, t.n - ac.pos.x) / NM).toFixed(1)}`, COL.g);
          } else field(3, '---°/----.-', COL.w);
          label(3, 'TO ', 'R');
          field(3, this.ctx.bdTo || '[    ]', COL.c, 'R');
          H.R3 = (s) => {
            if (!fm.db.find(s)) return 'NOTDB';
            this.ctx.bdTo = this.takeSp();
          };
          label(5, ' REQUIRED ACCUR ESTIMATED');
          field(5, ' 1.0NM   HIGH   0.05NM', COL.g);
          field(6, 'GPS PRIMARY', COL.g, 'C');
          break;
        }
        case 'FUEL': {
          title('FUEL PRED');
          label(1, ' AT      UTC  EFOB');
          const trip = this.tripFuel();
          const fob = (ac.sys ? ac.sys.fob() : ac.fuelKg) / 1000;
          field(1, `${d.to || '----'}    ${this.eta(trip.min)}  ${(fob - trip.fuel).toFixed(1)}`, COL.g);
          field(2, `${d.altn || '----'}    ${this.eta(trip.min + 30)}  ${(fob - trip.fuel - 1.8).toFixed(1)}`, COL.g);
          label(3, ' GW/CG');
          field(3, `${(ac.mass / 1000).toFixed(1)}/${d.zfwcg.toFixed(1)}`, COL.g);
          label(3, 'FOB', 'R');
          field(3, fob.toFixed(1), COL.g, 'R');
          label(4, ' RTE RSV/%');
          field(4, `${(trip.fuel * 0.05).toFixed(1)}/5.0`, COL.c);
          label(5, ' FINAL/TIME');
          field(5, `${d.rsv.toFixed(1)}/0030`, COL.c);
          label(6, ' EXTRA/TIME');
          field(6, (fob - trip.fuel - 1.8 - d.rsv).toFixed(1), COL.g);
          break;
        }
        case 'DATA': {
          title('DATA INDEX');
          field(1, '<POSITION MONITOR', COL.w);
          field(2, '<IRS MONITOR', COL.w);
          field(3, '<GPS MONITOR', COL.w);
          field(4, '<A/C STATUS', COL.w);
          field(1, 'WAYPOINTS>', COL.w, 'R');
          field(2, 'NAVAIDS>', COL.w, 'R');
          field(3, 'RUNWAYS>', COL.w, 'R');
          H.R2 = () => this.go('NAVAIDS');
          H.L4 = () => this.go('ACSTATUS');
          break;
        }
        case 'NAVAIDS': {
          title('NAVAIDS');
          const list = [...fm.db.pts.values()].filter((p) => p.type === 'VOR' || p.type === 'NDB').concat(fm.db.ils);
          list.slice(this.scroll, this.scroll + 6).forEach((v, i) => field(i + 1, `${v.ident.padEnd(5)} ${v.type === 'LOC' ? 'ILS' : v.type} ${v.type === 'NDB' ? v.freq : v.freq.toFixed(2)}`, COL.g));
          break;
        }
        case 'ACSTATUS': {
          title('A320-200');
          label(1, ' ENG');
          field(1, 'CFM56-5B4', COL.g);
          label(2, ' ACTIVE DATA BASE');
          field(2, 'TEHRAN SIM 01OCT-28OCT', COL.c);
          label(3, ' SECOND DATA BASE');
          field(3, 'NONE', COL.c);
          label(5, ' CHG CODE');
          field(5, '[ ]', COL.c);
          label(6, ' IDLE/PERF');
          field(6, '+0.0/+0.0', COL.g);
          break;
        }
        default:
          title(this.page === 'SEC' ? 'SEC INDEX' : 'ATC COMM');
          field(3, 'NOT AVAILABLE IN SIM', COL.a, 'C');
      }
      this.lines = L;
      return L;
    }

    freqEntry(s, set, lo, hi) {
      const fm = this.fm;
      if (!s) return 'FORMAT';
      let f = +s;
      if (!isNaN(f)) {
        if (f < lo || f > hi) return 'RANGE';
        const v = fm.db.ils.concat([...fm.db.pts.values()]).find((x) => x.freq && Math.abs(x.freq - f) < 0.001);
        set({ freq: f, ident: v ? v.ident : '' });
      } else {
        const v = fm.db.find(s) || fm.db.ils.find((l) => l.ident === s);
        if (!v || !v.freq) return 'NOTDB';
        set({ freq: v.freq, ident: v.ident });
      }
      this.takeSp();
    }
    crsEntry(s, set) {
      const v = +s;
      if (isNaN(v) || !s) return 'FORMAT';
      if (v < 0 || v > 360) return 'RANGE';
      set(v % 360);
      this.takeSp();
    }
    tripFuel() {
      const fm = this.fm,
        ac = this.getAc();
      let dist = 0;
      let prev = { n: ac.pos.x, e: ac.pos.y };
      for (let i = fm.active; i < fm.plan.length; i++) {
        const l = fm.plan[i];
        if (l.disc || l.missed) continue;
        dist += Math.hypot(l.n - prev.n, l.e - prev.e);
        prev = l;
      }
      const nm = dist / NM;
      const min = (nm / 300) * 60 + 12;
      return { fuel: Math.max(0.3, (min / 60) * 2.5), min, nm };
    }
    eta(min) {
      const h = (this.hoursNow || 12) + min / 60;
      return `${String(Math.floor(h) % 24).padStart(2, '0')}${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    }

    buildFpln(L, H, put) {
      const fm = this.fm,
        ac = this.getAc();
      const P = fm.plan;
      if (!P.length) {
        put(0, ' FROM', COL.w, 'L', true);
        put(2, '------END OF F-PLN------', COL.w, 'C');
        put(4, '---- NO ALTN F-PLN ----', COL.w, 'C');
        this.handlers = H;
        return;
      }
      put(0, `${fm.d.flt}`, COL.w, 'C', true);
      const rows = [];
      for (let i = 0; i < P.length; i++) {
        if (P[i].hidden) continue;
        rows.push(i);
      }
      rows.push(-1); // end
      this.scroll = FS.clamp(this.scroll, 0, Math.max(0, rows.length - 5));
      let prev = null;
      for (let k = 0; k < 5; k++) {
        const ri = rows[this.scroll + k];
        const line = 2 + k * 2;
        if (ri === undefined) break;
        if (ri === -1) {
          put(line, '------END OF F-PLN------', COL.w, 'C');
          break;
        }
        const l = P[ri];
        if (l.disc) {
          put(line, '---F-PLN DISCONTINUITY--', COL.w, 'C');
          H['L' + (k + 1)] = (s) => {
            if (s === 'CLR') {
              fm.deleteAt(ri);
              this.takeSp();
            } else if (s) {
              if (!fm.insertWpt(ri, s)) return 'NOTDB';
              this.takeSp();
            }
          };
          continue;
        }
        const isTo = ri === fm.active || (fm.activeLeg() === l && ri >= fm.active);
        const col = l.missed ? COL.c : isTo ? COL.w : COL.g;
        const ident = (l.type === 'ORIG' ? l.ident : l.ident).padEnd(7);
        // label line: leg info
        let lbl = '';
        const prevL = this.prevNonDisc(ri);
        if (prevL) {
          const brg = FS.mag(Math.atan2(l.e - prevL.e, l.n - prevL.n) * 57.2958);
          const dist = Math.hypot(l.e - prevL.e, l.n - prevL.n) / NM;
          lbl = ` C${String(Math.round(brg)).padStart(3, '0')}°   ${Math.round(dist)}NM`;
        } else if (l.type === 'ORIG') lbl = ' FROM';
        put(line - 1, lbl, COL.w, 'L', true);
        put(line, ident, col);
        const spd = l.spd ? String(l.spd) : '---';
        const alt = l.alt ? `${l.alt.t === '+' ? '+' : l.alt.t === '-' ? '-' : ''}${l.alt.v >= fm.d.transAlt ? 'FL' + Math.round(l.alt.v / 100) : l.alt.v}` : l.type === 'ORIG' || l.type === 'RWY' ? String(Math.round((l.elev || fm.db.airports.get(fm.d.from)?.elev || 0) / FT)) : '-----';
        put(line, `${this.legTime(ri)} ${spd}/${alt.padStart(6)}`, l.alt ? COL.m : col, 'R', !l.alt);
        H['L' + (k + 1)] = (s) => {
          if (s === 'CLR') {
            if (!fm.deleteAt(ri)) return 'NOT';
            this.takeSp();
          } else if (s) {
            if (!fm.insertWpt(ri, s)) return 'NOTDB';
            this.takeSp();
          } else {
            this.page = 'LATREV';
            this.ctx = { idx: ri };
          }
        };
        H['R' + (k + 1)] = (s) => {
          if (s) {
            const m = s.match(/^\/?([+-]?)(?:FL)?(\d{2,5})$/);
            if (!m) return 'FORMAT';
            let v = +m[2];
            if (s.includes('FL') || v < 500) v *= 100;
            l.alt = { t: m[1] || '@', v };
            this.takeSp();
          } else {
            this.page = 'VERTREV';
            this.ctx = { idx: ri };
          }
        };
        prev = l;
      }
      void prev;
      // bottom line: destination
      const di = P.findIndex((l) => l.type === 'DEST');
      const trip = this.tripFuel();
      put(11, ' DEST   TIME  DIST  EFOB', COL.w, 'L', true);
      const fob = (ac.sys ? ac.sys.fob() : ac.fuelKg) / 1000;
      put(12, `${(P[di] ? P[di].ident : '----').padEnd(6)} ${this.eta(trip.min)} ${String(Math.round(trip.nm)).padStart(5)} ${(fob - trip.fuel).toFixed(1).padStart(5)}`, COL.w, 'L');
      H.L6 = () => {};
    }
    prevNonDisc(i) {
      const P = this.fm.plan;
      for (let k = i - 1; k >= 0; k--) {
        if (P[k].disc) return null;
        if (!P[k].hidden) return P[k];
      }
      return null;
    }
    legTime(i) {
      const ac = this.getAc();
      const fm = this.fm;
      let dist = 0,
        prev = { n: ac.pos.x, e: ac.pos.y };
      if (i < fm.active) return '----';
      for (let k = fm.active; k <= i; k++) {
        const l = fm.plan[k];
        if (l.disc || l.hidden) continue;
        dist += Math.hypot(l.n - prev.n, l.e - prev.e);
        prev = l;
      }
      const spd = Math.max(ac.gs, 120 * KT);
      const h = (this.hoursNow || 12) + dist / spd / 3600;
      return `${String(Math.floor(h) % 24).padStart(2, '0')}${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    }

    buildPerf(L, H, put, title, label, field, num) {
      const fm = this.fm,
        d = fm.d,
        ac = this.getAc();
      const phases = ['TAKE OFF', 'CLB', 'CRZ', 'DES', 'APPR', 'GO AROUND'];
      const active = this.perfPhaseIdx();
      const s = this.sub;
      title(phases[s], s === active ? COL.g : COL.w);
      const p = fm.perf();
      if (s === 0) {
        const sug = fm.toSpeeds();
        label(1, ' V1   FLP RETR');
        field(1, d.v1 ? String(d.v1) : box(3), d.v1 ? COL.c : COL.a);
        put(2, `         F=${p.F}`, COL.g, 'L', true);
        H.L1 = (x) => this.spdEntry(x, (v) => (d.v1 = v));
        label(2, ' VR   SLT RETR');
        field(2, d.vr ? String(d.vr) : box(3), d.vr ? COL.c : COL.a);
        put(4, `         S=${p.S}`, COL.g, 'L', true);
        H.L2 = (x) => this.spdEntry(x, (v) => (d.vr = v));
        label(3, ' V2      CLEAN');
        field(3, d.v2 ? String(d.v2) : box(3), d.v2 ? COL.c : COL.a);
        put(6, `         O=${Math.round(p.gd)}`, COL.g, 'L', true);
        H.L3 = (x) => this.spdEntry(x, (v) => (d.v2 = v));
        label(1, 'RWY ', 'R');
        field(1, d.dep || '---', COL.g, 'R');
        label(2, 'TO SHIFT ', 'R');
        field(2, '[M] [ ]*', COL.c, 'R', true);
        label(3, 'FLAPS/THS ', 'R');
        field(3, `${ac.ctl.flapLever || 1}/UP${Math.abs(ac.ths).toFixed(1)}`, COL.c, 'R');
        label(4, ' TRANS ALT');
        field(4, String(d.transAlt), COL.c);
        H.L4 = (x) => {
          const v = num(x);
          if (v == null) return 'FORMAT';
          d.transAlt = v;
          this.takeSp();
        };
        label(4, 'FLEX TO TEMP ', 'R');
        field(4, d.flex != null ? `${d.flex}°` : '[ ]°', COL.c, 'R');
        H.R4 = (x) => {
          const v = num(x);
          if (v == null) return 'FORMAT';
          if (v < 0 || v > 75) return 'RANGE';
          d.flex = v;
          if (ac.sys) ac.sys.flexTemp = v;
          this.takeSp();
        };
        label(5, ' THR RED/ACC');
        field(5, `${d.thrRed || '----'}/${d.acc || '----'}`, COL.c);
        H.L5 = (x) => {
          const [a, b] = x.split('/');
          if (num(a) != null) d.thrRed = num(a);
          if (num(b) != null) d.acc = num(b);
          this.takeSp();
        };
        label(5, 'ENG OUT ACC ', 'R');
        field(5, String(d.acc || '----'), COL.c, 'R');
        field(6, 'NEXT PHASE>', COL.w, 'R');
        H.R6 = () => (this.sub = 1);
        // suggested speeds when empty: pressing the LSK with empty scratchpad accepts the suggestion
        if (!d.v1) put(2, `{${sug.v1}}`, COL.c, 'L', true);
        H.L1 = (x) => (x ? this.spdEntry(x, (v) => (d.v1 = v)) : ((d.v1 = sug.v1), undefined));
        H.L2 = (x) => (x ? this.spdEntry(x, (v) => (d.vr = v)) : ((d.vr = sug.vr), undefined));
        H.L3 = (x) => (x ? this.spdEntry(x, (v) => (d.v2 = v)) : ((d.v2 = sug.v2), undefined));
      } else if (s === 1 || s === 2 || s === 3) {
        label(1, ' CI');
        field(1, String(d.ci), COL.c);
        label(2, ' MANAGED');
        field(2, s === 3 ? '*300/.78' : s === 2 ? '.78' : '*290/.78', COL.m);
        label(3, ' SELECTED');
        field(3, fm.fcu.spdManaged ? '[ ]' : String(fm.fcu.spd), COL.c);
        if (s === 2) {
          label(4, 'DES CABIN RATE', 'R');
          field(4, '-350FT/MIN', COL.c, 'R');
        }
        label(4, ' PRED TO');
        field(4, `FL${d.crzFL}`, COL.c);
        field(5, '<ECON', COL.w);
        field(6, '<PREV PHASE', COL.w);
        field(6, 'NEXT PHASE>', COL.w, 'R');
        H.L6 = () => (this.sub = s - 1);
        H.R6 = () => (this.sub = s + 1);
        if (s === 3 || s === 2) {
          field(5, 'ACTIVATE APPR PHASE*', COL.c, 'R', true);
          H.R5 = () => {
            fm.appPhaseActive = true;
          };
        }
      } else if (s === 4) {
        label(1, ' QNH');
        field(1, d.qnhDest ? String(d.qnhDest) : '[    ]', d.qnhDest ? COL.c : COL.a);
        H.L1 = (x) => {
          const v = num(x);
          if (v == null) return 'FORMAT';
          if (!((v > 900 && v < 1100) || (v > 26 && v < 32))) return 'RANGE';
          d.qnhDest = v;
          this.takeSp();
        };
        label(2, ' TEMP');
        field(2, d.tempDest != null ? `${d.tempDest}°` : '[ ]°', COL.c);
        H.L2 = (x) => {
          const v = num(x);
          if (v == null) return 'FORMAT';
          d.tempDest = v;
          this.takeSp();
        };
        label(3, ' MAG WIND');
        field(3, d.windDest || '[ ]°/[ ]', COL.c);
        H.L3 = (x) => {
          if (!/^\d{1,3}\/\d{1,3}$/.test(x)) return 'FORMAT';
          d.windDest = this.takeSp();
        };
        label(4, ' TRANS FL');
        field(4, 'FL110', COL.c);
        label(5, ' VAPP');
        field(5, String(p.vapp), d.vappSel ? COL.c : COL.g, 'L');
        H.L5 = (x) => {
          if (x === 'CLR') {
            d.vappSel = null;
            return void this.takeSp();
          }
          return this.spdEntry(x, (v) => (d.vappSel = v));
        };
        label(1, 'FLP RETR ', 'R');
        put(2, `F=${p.F}`, COL.g, 'R');
        label(2, 'SLT RETR ', 'R');
        put(4, `S=${p.S}`, COL.g, 'R');
        label(3, 'CLEAN ', 'R');
        put(6, `O=${Math.round(p.gd)}`, COL.g, 'R');
        label(4, 'BARO/RADIO ', 'R');
        field(4, `${d.mda != null ? d.mda : '[  ]'}/${d.dh != null ? d.dh : '[ ]'}`, COL.c, 'R');
        H.R4 = (x) => {
          const [a, b] = x.split('/');
          if (x.startsWith('/')) {
            const v = num(b);
            if (v == null) return 'FORMAT';
            d.dh = v;
            d.mda = null;
          } else {
            const v = num(a);
            if (v == null) return 'FORMAT';
            d.mda = v;
            d.dh = null;
          }
          this.takeSp();
        };
        label(5, 'LDG CONF ', 'R');
        field(5, d.ldgConf3 ? 'CONF3*' : 'FULL*', COL.c, 'R');
        H.R5 = () => {
          d.ldgConf3 = !d.ldgConf3;
          if (ac.sys) ac.sys.ldgConf3 = d.ldgConf3;
        };
        label(6, ' VLS', 'L');
        put(12, `${Math.round(p.vlsFull)}`, COL.g, 'L', true);
        field(6, 'NEXT PHASE>', COL.w, 'R');
        H.R6 = () => (this.sub = 5);
      } else {
        label(1, ' V2');
        field(1, String(d.v2 || '---'), COL.g);
        label(5, ' THR RED/ACC');
        field(5, `${d.thrRed || '----'}/${d.acc || '----'}`, COL.c);
        field(6, '<PREV PHASE', COL.w);
        H.L6 = () => (this.sub = 4);
      }
    }
    spdEntry(x, set) {
      const v = +x;
      if (!x || isNaN(v)) return 'FORMAT';
      if (v < 90 || v > 350) return 'RANGE';
      set(v);
      this.takeSp();
    }

    // ------------------------------------------------------------ drawing
    draw() {
      const W = (this.W = this.cv.width),
        H = (this.H = this.cv.height);
      const g = this.g;
      this.regions = [];
      // body
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#50555c');
      bg.addColorStop(1, '#3a3e44');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // screen
      const sx = W * 0.12,
        sy = H * 0.03,
        sw = W * 0.76,
        sh = H * 0.41;
      g.fillStyle = '#000';
      g.fillRect(sx, sy, sw, sh);
      const acp = this.getAc();
      const powered = !acp.sys || acp.sys.elec.acPowered;
      const L = powered ? this.build() : Array.from({ length: 14 }, () => []);
      const rowH = sh / 14;
      const cw = sw / 24;
      L.forEach((items, r) => {
        for (const it of items) {
          const fsz = rowH * (it.s ? 0.72 : 0.95);
          g.font = `${fsz}px 'Courier New', Menlo, monospace`;
          g.fillStyle = it.c;
          g.textBaseline = 'middle';
          const y = sy + (r + 0.55) * rowH;
          if (it.a === 'L') {
            g.textAlign = 'left';
            g.fillText(it.t, sx + cw * 0.3, y);
          } else if (it.a === 'R') {
            g.textAlign = 'right';
            g.fillText(it.t, sx + sw - cw * 0.3, y);
          } else {
            g.textAlign = 'center';
            g.fillText(it.t, sx + sw / 2, y);
          }
        }
      });
      // scratchpad
      g.font = `${rowH * 0.95}px 'Courier New', Menlo, monospace`;
      g.textAlign = 'left';
      g.fillStyle = this.spMsg ? COL.w : COL.w;
      g.fillText(this.spMsg || this.sp, sx + cw * 0.3, sy + 13.55 * rowH);
      if (this.focus && Math.floor(performance.now() / 500) % 2 === 0 && !this.spMsg) {
        g.fillStyle = '#aaa';
        g.fillRect(sx + cw * 0.3 + g.measureText(this.sp).width + 2, sy + 13.1 * rowH, 2, rowH * 0.8);
      }
      // messages from FMGS
      if (this.fm.messages.length && !this.sp && !this.spMsg) {
        g.fillStyle = COL.a;
        g.fillText(this.fm.messages[0], sx + cw * 0.3, sy + 13.55 * rowH);
      }
      // LSKs
      for (let i = 1; i <= 6; i++) {
        const y = sy + (i * 2 + 0.55) * rowH - rowH * 0.45;
        this.keyBtn(W * 0.015, y, W * 0.085, rowH * 0.9, 'L' + i, '—');
        this.keyBtn(W * 0.9, y, W * 0.085, rowH * 0.9, 'R' + i, '—');
      }
      // function keys
      const fk = [
        ['DIR', 'DIR'], ['PROG', 'PROG'], ['PERF', 'PERF'], ['INIT', 'INIT'], ['DATA', 'DATA'], ['BLANK', ''],
        ['FPLN', 'F-PLN'], ['RAD', 'RAD NAV'], ['FUEL', 'FUEL PRED'], ['SEC', 'SEC F-PLN'], ['ATC', 'ATC COMM'], ['MENU', 'MCDU MENU'],
        ['AIRPORT', 'AIRPORT'], ['BLANK2', ''], ['LEFT', '←'], ['UP', '↑'], ['RIGHT', '→'], ['DOWN', '↓'],
      ];
      const fy = H * 0.47,
        fw = W * 0.14,
        fh = H * 0.045;
      fk.forEach(([id, t], i) => {
        const col = i % 6,
          row = Math.floor(i / 6);
        if (!t) return;
        this.keyBtn(W * 0.06 + col * fw * 1.07, fy + row * fh * 1.25, fw, fh, id, t);
      });
      // alpha & numeric
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['-', 'SP', 'OVFY', 'CLR']);
      const ly = H * 0.64,
        lw = W * 0.095,
        lh = H * 0.05;
      letters.forEach((k, i) => {
        const col = i % 5,
          row = Math.floor(i / 5);
        const id = k === '-' ? '/' : k;
        this.keyBtn(W * 0.43 + col * lw * 1.1, ly + row * lh * 1.12, lw, lh, id, k === '-' ? '/' : k, k.length > 2);
      });
      const nums = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '+/-'];
      nums.forEach((k, i) => {
        const col = i % 3,
          row = Math.floor(i / 3);
        this.keyBtn(W * 0.06 + col * lw * 1.15, ly + row * lh * 1.25, lw, lh * 1.05, k, k, k.length > 1);
      });
      g.fillStyle = this.focus ? '#6f6' : '#888';
      g.font = `${H * 0.018}px Arial`;
      g.textAlign = 'left';
      g.fillText(this.focus ? 'KEYBOARD → MCDU (Esc to release)' : 'click MCDU to type with keyboard', W * 0.06, H * 0.985);
    }
    keyBtn(x, y, w, h, id, label, small) {
      const g = this.g;
      const pr = this.pressed && this.pressed.id === id && performance.now() - this.pressed.t < 150;
      g.fillStyle = pr ? '#222' : '#2a2c30';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#111';
      g.lineWidth = 1;
      g.strokeRect(x, y, w, h);
      g.fillStyle = '#e8e8e8';
      const long = label.length > 5;
      g.font = `${Math.min(h * (small || long ? 0.36 : 0.55), long ? w * 0.13 : w * 0.3)}px Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x + w / 2, y + h / 2);
      this.regions.push({ x, y, w, h, id });
    }
  }

  FS.MCDU = MCDU;
})(typeof window !== 'undefined' ? window : globalThis);
