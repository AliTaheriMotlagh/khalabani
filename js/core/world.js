/*
 * Worlds: airports, runways, navaids and terrain height fields. Two regions are available:
 *   - "avalon": fictional training island (C172 scenarios)
 *   - "tehran": Tehran region around Mehrabad (OIII), built from the Iranian AIP (thresholds, runway slopes,
 *               ILS/VOR/NDB positions and frequencies, magnetic variation), with Imam Khomeini (OIIE) as alternate.
 * Everything here is pure data / math (no rendering), shared by physics, radios and scenery.
 * Positions are local NED metres around the world origin; the runway 'hdg' is TRUE.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG, FT, NM } = FS.U;

  // ------------------------------------------------------------------ helpers
  function finishAirports(list) {
    for (const ap of list) {
      for (const rw of ap.runways) {
        if (rw.thrPos) {
          // defined by threshold coordinates
          const [a, b] = rw.thrPos;
          rw.n = (a.n + b.n) / 2;
          rw.e = (a.e + b.e) / 2;
          rw.length = Math.hypot(b.n - a.n, b.e - a.e);
          rw.hdg = FS.wrap360(Math.atan2(b.e - a.e, b.n - a.n) / DEG);
        }
        const h = rw.hdg * DEG;
        rw.dirN = Math.cos(h);
        rw.dirE = Math.sin(h);
        rw.thr = [
          { n: rw.n - (rw.dirN * rw.length) / 2, e: rw.e - (rw.dirE * rw.length) / 2, hdg: rw.hdg, id: rw.ends[0] },
          { n: rw.n + (rw.dirN * rw.length) / 2, e: rw.e + (rw.dirE * rw.length) / 2, hdg: FS.wrap360(rw.hdg + 180), id: rw.ends[1] },
        ];
        rw.thr.forEach((t, i) => (t.rwy = rw));
      }
      // runway-relative placement helper: along from ends[0] threshold, offset + = left of hdg
      ap.rel = (ri, along, off) => {
        const rw = ap.runways[ri];
        return { n: rw.thr[0].n + rw.dirN * along - rw.dirE * off, e: rw.thr[0].e + rw.dirE * along + rw.dirN * off };
      };
    }
  }

  // Airport surface is a plane (supports sloping runways such as Mehrabad's 1.26 %)
  function airportPlane(ap) {
    const g = ap.grad || { dn: 0, de: 0 };
    ap.elevAt = (n, e) => ap.elev + g.dn * (n - ap.n) + g.de * (e - ap.e);
    for (const rw of ap.runways) {
      rw.elev = ap.elevAt(rw.n, rw.e);
      for (const t of rw.thr) t.elev = ap.elevAt(t.n, t.e);
    }
  }

  // ------------------------------------------------------------------ AVALON
  const AVALON_AIRPORTS = [
    {
      icao: 'KAVX', name: 'Avalon Regional', n: 0, e: 0,
      runways: [{ ends: ['09', '27'], n: 0, e: 0, hdg: 90, length: 2000, width: 45, lights: true, als: [false, true] }],
      pavement: [[170, 0, 90, 1900, 18], [85, -940, 0, 170, 18], [85, 940, 0, 170, 18], [85, 0, 0, 170, 18], [300, -150, 90, 420, 160]],
      tower: { n: 420, e: 150 },
      hangars: [[420, -300, 90], [420, -230, 90], [430, -380, 90]],
      windsock: { n: 90, e: 750 },
      beacon: { n: 460, e: 60 },
    },
    {
      icao: 'KHLD', name: 'Highland Field', n: 21000, e: 12000,
      runways: [{ ends: ['36', '18'], n: 21000, e: 12000, hdg: 360, length: 1500, width: 30, lights: true, als: [true, false] }],
      pavement: [[21000, 12120, 0, 1400, 15], [21000, 12230, 0, 300, 120]],
      tower: { n: 21150, e: 12320 },
      hangars: [[20900, 12330, 0], [20980, 12330, 0]],
      windsock: { n: 20380, e: 12060 },
      beacon: { n: 21250, e: 12300 },
    },
    {
      icao: 'KLKV', name: 'Lakeview', n: -15500, e: -15000,
      runways: [{ ends: ['13', '31'], n: -15500, e: -15000, hdg: 130, length: 1300, width: 30, lights: true, als: [false, false] }],
      pavement: [[-15400, -15120, 130, 300, 90]],
      tower: null,
      hangars: [[-15330, -15230, 130], [-15380, -15170, 130]],
      windsock: { n: -15700, e: -15250 },
      beacon: { n: -15300, e: -15300 },
    },
  ];

  const AVALON = {
    id: 'avalon', name: 'Avalon Island', size: 80000, gridN: 513, magVar: 0, water: true, palette: 'green', edgeElev: -70,
    airports: AVALON_AIRPORTS,
    elevFromTerrain: true,
    natural(n, e, N) {
      const x = e / 1000,
        y = n / 1000;
      let h = 25 + 55 * (N.fbm(x / 9, y / 9, 5) * 0.5 + 0.5);
      h += 140 * Math.max(0, N.fbm(x / 5 + 10, y / 5 - 3, 4));
      const m = FS.smoothstep(19, 29, y + 4 * N.noise(x / 12, 3.3));
      h += m * (180 + 1500 * N.ridge(x / 9 + 4, y / 9 + 1, 5));
      const w = FS.smoothstep(-20, -29, x + 3 * N.noise(1.7, y / 10)) * FS.smoothstep(-20, 0, y);
      h += w * (100 + 700 * N.ridge(x / 7, y / 7 + 9, 4));
      const r = Math.sqrt(x * x + y * y * 0.85) + 4 * N.noise(x / 9 + 7, y / 9 - 2);
      const coast = FS.smoothstep(37, 31, r);
      h = h * coast - 70 * (1 - coast);
      const dl = Math.hypot(x + 19.5, y + 18.5) + 1.2 * N.noise(x / 2, y / 2);
      return FS.lerp(h, -10, FS.smoothstep(3.6, 2.2, dl));
    },
    towns: [
      { n: 3600, e: 3800, r: 1700 }, { n: 18800, e: 8400, r: 900 }, { n: -13600, e: -12200, r: 1000 },
      { n: -7000, e: 13500, r: 1400 }, { n: 7500, e: -11500, r: 1100 }, { n: -2500, e: -6000, r: 700 },
    ],
    roads: [
      [[0, 900], [2000, 2500], [3600, 3800], [9000, 6000], [15000, 7600], [18800, 8400], [21000, 11700]],
      [[3600, 3800], [0, 9000], [-7000, 13500]],
      [[0, -900], [-2500, -6000], [-8000, -9000], [-13600, -12200], [-15500, -15000]],
      [[3600, 3800], [6000, -3000], [7500, -11500]],
      [[-7000, 13500], [-14000, 6000], [-13600, -12200]],
    ],
    navaids(terrain, ils, at) {
      const A = AVALON_AIRPORTS;
      const list = [];
      list.push(Object.assign(at(1400, -600, 5), { type: 'VOR', freq: 113.9, ident: 'AVX', name: 'Avalon VOR/DME', dmeCap: true, range: 130 * NM }));
      list.push(Object.assign(at(22500, 13200, 5), { type: 'VOR', freq: 116.4, ident: 'HLD', name: 'Highland VOR/DME', dmeCap: true, range: 130 * NM }));
      list.push(Object.assign(at(-14200, -18200, 5), { type: 'VOR', freq: 115.2, ident: 'LKV', name: 'Lakeview VOR/DME', dmeCap: true, range: 60 * NM }));
      ils(list, A[0], A[0].runways[0], 1, 110.3, 'IAVX', { gs: 3.0, om: 4.5 * NM, mm: 1050, ndb: [356, 'AV'] });
      ils(list, A[0], A[0].runways[0], 0, 109.5, 'IAVE', { gs: 3.0 });
      ils(list, A[1], A[1].runways[0], 0, 108.7, 'IHLD', { gs: 3.0, om: 4.0 * NM, ndb: [329, 'HL'] });
      list.push(Object.assign(at(A[2].n + 300, A[2].e + 250, 10), { type: 'NDB', freq: 382, ident: 'LK', name: 'Lakeview NDB', range: 40 * NM }));
      return list;
    },
    comms: [],
  };

  // ------------------------------------------------------------------ TEHRAN
  // Geodetic -> local metres about the Mehrabad ARP (35°41'20"N 051°18'53"E)
  const LAT0 = 35 + 41 / 60 + 20 / 3600,
    LON0 = 51 + 18 / 60 + 53 / 3600;
  const dms = (d, m, s) => d + m / 60 + s / 3600;
  const geo = (lat, lon) => ({ n: (lat - LAT0) * 110950, e: (lon - LON0) * 111320 * Math.cos(LAT0 * DEG) });
  FS.geo = geo;
  const ft = (x) => x * FT;

  const OIII_T11L = Object.assign(geo(dms(35, 41, 47.85), dms(51, 17, 31.68)), { elev: ft(3965) });
  const OIII_T29R = Object.assign(geo(dms(35, 41, 4.28), dms(51, 20, 1.37)), { elev: ft(3799) });
  const OIII_T11R = Object.assign(geo(dms(35, 41, 40.8), dms(51, 17, 29.83)), { elev: ft(3950) });
  const OIII_T29L = Object.assign(geo(dms(35, 40, 56.67), dms(51, 20, 1.18)), { elev: ft(3796) });

  const OIII = {
    icao: 'OIII', name: 'Tehran Mehrabad Intl', iata: 'THR',
    runways: [
      { ends: ['11L', '29R'], thrPos: [OIII_T11L, OIII_T29R], width: 45, lights: true, surface: 'concrete', als: [false, true], alsLen: [0, 830], papi: [null, 3.3] },
      { ends: ['11R', '29L'], thrPos: [OIII_T11R, OIII_T29L], width: 60, lights: true, surface: 'asphalt', als: [true, true], alsLen: [300, 870], papi: [3.4, 3.3] },
    ],
    comms: [
      { name: 'Mehrabad Information (ATIS)', freq: 128.0, type: 'ATIS' },
      { name: 'Mehrabad Delivery', freq: 121.85, type: 'DEL' },
      { name: 'Mehrabad Ground', freq: 121.7, type: 'GND' },
      { name: 'Mehrabad Ground', freq: 121.9, type: 'GND' },
      { name: 'Mehrabad Tower', freq: 118.1, type: 'TWR' },
      { name: 'Mehrabad Tower', freq: 124.45, type: 'TWR' },
      { name: 'Mehrabad Approach / Radar', freq: 119.7, type: 'APP' },
      { name: 'Mehrabad Approach / Radar', freq: 125.1, type: 'APP' },
      { name: 'Emergency', freq: 121.5, type: 'GUARD' },
    ],
    transAlt: 9000, transLevel: 110,
  };
  const OIIE = {
    icao: 'OIIE', name: 'Tehran Imam Khomeini Intl', iata: 'IKA', approx: true,
    runways: [],
    comms: [{ name: 'Imam Tower', freq: 118.7, type: 'TWR', approx: true }],
  };
  {
    // OIIE: ARP 35.4161N 51.1522E, elevation 3,305 ft; runways 11L/29R 4,201 m and 11R/29L 4,095 m (approximate layout)
    const c = geo(35.4161, 51.1522);
    const h = 109.5 * DEG,
      dn = Math.cos(h),
      de = Math.sin(h),
      pn = -de,
      pe = dn;
    const mk = (off, L) => {
      const cn = c.n + pn * off,
        ce = c.e + pe * off;
      return [{ n: cn - (dn * L) / 2, e: ce - (de * L) / 2 }, { n: cn + (dn * L) / 2, e: ce + (de * L) / 2 }];
    };
    OIIE.runways = [
      { ends: ['11L', '29R'], thrPos: mk(-900, 4201), width: 45, lights: true, als: [true, true], alsLen: [900, 900], papi: [3, 3] },
      { ends: ['11R', '29L'], thrPos: mk(900, 4095), width: 45, lights: true, als: [false, true], alsLen: [0, 900], papi: [3, 3] },
    ];
    OIIE.n = c.n;
    OIIE.e = c.e;
    OIIE.elev = ft(3305);
  }
  finishAirports([OIII, OIIE]);
  {
    // Mehrabad: plane through the four AIP threshold elevations
    const T = [OIII_T11L, OIII_T29R, OIII_T11R, OIII_T29L];
    OIII.n = T.reduce((s, t) => s + t.n, 0) / 4;
    OIII.e = T.reduce((s, t) => s + t.e, 0) / 4;
    OIII.elev = T.reduce((s, t) => s + t.elev, 0) / 4;
    // least squares for gradient
    let snn = 0, see = 0, sne = 0, snh = 0, seh = 0;
    for (const t of T) {
      const a = t.n - OIII.n, b = t.e - OIII.e, h = t.elev - OIII.elev;
      snn += a * a; see += b * b; sne += a * b; snh += a * h; seh += b * h;
    }
    const det = snn * see - sne * sne;
    OIII.grad = { dn: (snh * see - seh * sne) / det, de: (seh * snn - snh * sne) / det };
    const R0 = OIII.runways[0],
      R1 = OIII.runways[1];
    const P = (ri, a, o) => OIII.rel(ri, a, o);
    // taxiways (runway 0 = 11L/29R north, runway 1 = 11R/29L south; + offset = north side)
    const tw = [];
    const along = (ri, a0, a1, off, w) => {
      const p = P(ri, (a0 + a1) / 2, off);
      tw.push([p.n, p.e, OIII.runways[ri].hdg, a1 - a0, w]);
    };
    along(0, -60, R0.length + 60, 190, 23); // north parallel
    along(1, 0, R1.length, 120, 23); // between runways
    for (const a of [80, 900, 1700, 2500, 3300, R0.length - 80]) {
      const p = P(0, a, 95);
      tw.push([p.n, p.e, FS.wrap360(R0.hdg - 90), 210, 23]);
      const q = P(1, a, 60);
      tw.push([q.n, q.e, FS.wrap360(R1.hdg - 90), 120, 23]);
    }
    const ap1 = P(0, 2650, 470);
    tw.push([ap1.n, ap1.e, R0.hdg, 1100, 330]); // main apron
    const ap2 = P(0, 1500, 390);
    tw.push([ap2.n, ap2.e, R0.hdg, 700, 170]); // cargo / GA apron
    OIII.pavement = tw;
    const tpos = P(0, 2650, 700);
    OIII.terminals = [
      { n: tpos.n, e: tpos.e, hdg: R0.hdg, len: 900, wid: 90, h: 18 },
      Object.assign(P(0, 3400, 740), { hdg: R0.hdg, len: 260, wid: 70, h: 14 }),
    ];
    // gates on the north edge of the main apron: aircraft park nose-in toward the terminal
    OIII.gates = [];
    for (let k = 0; k < 8; k++) {
      const g = P(0, 2230 + k * 120, 575);
      OIII.gates.push({ id: 'G' + (k + 1), n: g.n, e: g.e, hdg: FS.wrap360(R0.hdg - 90) });
    }
    OIII.tower = P(0, 2000, 650);
    OIII.hangars = [
      [P(0, 1300, 520).n, P(0, 1300, 520).e, R0.hdg],
      [P(0, 1420, 520).n, P(0, 1420, 520).e, R0.hdg],
      [P(0, 1540, 520).n, P(0, 1540, 520).e, R0.hdg],
    ];
    OIII.windsock = P(0, 3500, -80);
    OIII.beacon = P(0, 2100, 800);
  }
  {
    const R0 = OIIE.runways[0];
    const P = (a, o) => OIIE.rel(0, a, o);
    const a1 = P(2100, -900);
    OIIE.pavement = [[P(2100, -180).n, P(2100, -180).e, R0.hdg, 4200, 23], [a1.n, a1.e, R0.hdg, 900, 300]];
    OIIE.terminals = [Object.assign(P(2100, -1150), { hdg: R0.hdg, len: 700, wid: 120, h: 22 })];
    OIIE.gates = [];
    OIIE.tower = P(1700, -1100);
    OIIE.hangars = [];
    OIIE.windsock = P(600, 80);
    OIIE.beacon = P(2600, -1250);
  }

  const TEHRAN_CITY = [
    // ellipses (n, e, rn, re, density) approximating Tehran's built-up area and satellite towns
    [2500, 9500, 10500, 15000, 1],
    [9000, 7000, 4200, 13000, 0.9],
    [300, -6500, 5200, 6000, 0.85],
    [-7500, 9000, 5000, 9000, 0.8],
    [-12500, -3000, 3500, 5500, 0.7], // Eslamshahr
    [15500, -31000, 3500, 7000, 0.75], // Karaj
    [-17000, 25500, 3000, 4000, 0.6], // Varamin
    [-5000, 27000, 3000, 4000, 0.5],
  ];

  const TEHRAN = {
    id: 'tehran', name: 'Tehran region (OIII / OIIE)', size: 160000, gridN: 641, magVar: 5, water: false, palette: 'desert', edgeElev: 950,
    airports: [OIII, OIIE],
    elevFromTerrain: false,
    cityDensity(n, e) {
      let d = 0;
      for (const c of TEHRAN_CITY) {
        const r = Math.hypot((n - c[0]) / c[2], (e - c[1]) / c[3]);
        d = Math.max(d, c[4] * FS.smoothstep(1.0, 0.55, r));
      }
      return d;
    },
    mountainFront(e) {
      return 12800 + 5500 * FS.smoothstep(-8000, -34000, e) - 1500 * FS.smoothstep(20000, 45000, e);
    },
    natural(n, e, N) {
      const x = e / 1000,
        y = n / 1000;
      // plain sloping gently south, alluvial fan rising to the mountain front
      let h = 1180 + 0.0065 * n - 0.0018 * e;
      const front = this.mountainFront(e) + 1800 * N.noise(x / 14, 5.2);
      h += 480 * FS.lerp(0.35, 1, FS.smoothstep(-28000, -12000, e)) * Math.pow(FS.smoothstep(-3000, front, n), 2.2);
      h += 18 * N.fbm(x / 3, y / 3, 3);
      // Alborz range
      const m = FS.smoothstep(front - 1500, front + 6500, n);
      if (m > 0) {
        const amp = (380 + 1650 * N.ridge(x / 10 + 3, y / 10 - 1, 5)) * (1 - 0.3 * FS.smoothstep(38000, 70000, n)) * FS.lerp(0.72, 1, FS.smoothstep(-45000, -12000, e));
        h += m * amp;
        // Tochal massif (3,964 m) north of the city
        const dt = Math.hypot(n - 21800, e - 10300);
        h += m * 520 * Math.exp(-(dt * dt) / (2 * 4200 * 4200));
      }
      // Damavand volcano (5,610 m)
      const dd = Math.hypot(n - 29500, e - 71800);
      const cone = 5610 - 0.3 * dd - 60 * N.noise(x, y);
      if (cone > h) h = FS.lerp(h, cone, FS.smoothstep(2200, 3200, cone - 0));
      // Bibi Shahrbanu hills SE of the city
      const bs = Math.hypot((n + 11500) / 2500, (e - 14500) / 7000);
      h += 380 * Math.max(0, 1 - bs) * (0.6 + 0.4 * N.ridge(x / 3, y / 3, 3));
      // low desert ridges in the south
      h += 220 * Math.max(0, N.fbm(x / 14 + 7, y / 14, 4)) * FS.smoothstep(-12000, -45000, n);
      return h;
    },
    towns: [],
    roads: [
      [[3300, -40000], [3000, -20000], [2800, -6000], [2000, 2500], [1500, 9000]], // Tehran–Karaj freeway
      [[1000, 2000], [-8000, 3000], [-18000, -2000], [-30300, -12000], [-70000, -20000]], // Tehran–Qom via IKA
      [[-3000, 12000], [-17000, 25500]],
      [[6000, -3000], [9000, 8000], [8000, 20000]],
      [[-2500, -3000], [-2000, 22000]],
    ],
    landmarks: [
      Object.assign(geo(35.7448, 51.3753), { type: 'milad', name: 'Milad Tower', h: 435 }),
      Object.assign(geo(35.6997, 51.3381), { type: 'azadi', name: 'Azadi Tower', h: 45 }),
    ],
    navaids(terrain, ils, at) {
      const list = [];
      const G = (la, lo) => geo(la, lo);
      const trn = G(dms(35, 41, 49.1), dms(51, 17, 1.6));
      list.push(Object.assign(at(trn.n, trn.e, 10), { type: 'VOR', freq: 115.3, ident: 'TRN', name: 'Mehrabad DVOR/DME', dmeCap: true, range: 150 * NM }));
      const rus = G(dms(35, 26, 43.7), dms(50, 54, 19.3));
      list.push(Object.assign(at(rus.n, rus.e, 10), { type: 'VOR', freq: 116.95, ident: 'RUS', name: 'Rudeshur VOR/DME', dmeCap: true, range: 150 * NM }));
      const vr = G(dms(35, 20, 33.6), dms(51, 38, 13.8));
      list.push(Object.assign(at(vr.n, vr.e, 30), { type: 'NDB', freq: 373, ident: 'VR', name: 'Varamin NDB', range: 80 * NM }));
      const kaz = G(dms(35, 31, 0.1), dms(51, 22, 0.7));
      list.push(Object.assign(at(kaz.n, kaz.e, 20), { type: 'NDB', freq: 358, ident: 'KAZ', name: 'Kahrizak NDB', range: 50 * NM }));
      const R0 = OIII.runways[0],
        R1 = OIII.runways[1];
      ils(list, OIII, R1, 1, 109.9, 'ITHL', {
        gs: 3.3, loc: G(dms(35, 41, 47.3), dms(51, 17, 7.9)), gsPos: G(dms(35, 40, 54.4), dms(51, 19, 49.4)), rdhFt: 59,
      });
      ils(list, OIII, R0, 1, 110.7, 'ITRN', { gs: 3.0, loc: G(dms(35, 41, 49.8), dms(51, 17, 24.9)), gsPos: G(dms(35, 41, 4.3), dms(51, 19, 49.4)) });
      // Imam Khomeini (approximate frequencies)
      ils(list, OIIE, OIIE.runways[0], 1, 110.3, 'IIKA', { gs: 3.0, approx: true });
      ils(list, OIIE, OIIE.runways[0], 0, 108.5, 'IIKE', { gs: 3.0, approx: true });
      return list;
    },
    // simplified sim procedures & waypoints (NOT for real-world navigation)
    fixes() {
      const f = [];
      const add = (id, p, extra) => f.push(Object.assign({ ident: id, n: p.n, e: p.e, type: 'WPT' }, extra || {}));
      const onFinal = (rw, endIdx, dist, id) => {
        const t = rw.thr[endIdx];
        const h = t.hdg * DEG;
        add(id, { n: t.n - Math.cos(h) * dist, e: t.e - Math.sin(h) * dist });
      };
      const R0 = OIII.runways[0],
        R1 = OIII.runways[1];
      onFinal(R1, 1, 5.5 * NM, 'FF29L');
      onFinal(R1, 1, 11 * NM, 'CI29L');
      onFinal(R0, 1, 5.5 * NM, 'FF29R');
      onFinal(R0, 1, 11 * NM, 'CI29R');
      onFinal(R1, 0, 6 * NM, 'FF11R');
      onFinal(R1, 0, 12 * NM, 'CI11R');
      onFinal(R0, 0, 6 * NM, 'FF11L');
      onFinal(OIIE.runways[0], 1, 6 * NM, 'FI29R');
      onFinal(OIIE.runways[0], 1, 12 * NM, 'CI29K');
      add('THR01', geo(35.62, 51.62));
      add('THR02', geo(35.55, 51.52));
      add('WEST1', geo(35.72, 50.95));
      add('SOUTH', geo(35.2, 51.3));
      add('EAST1', geo(35.62, 51.9));
      add('KARAJ', geo(35.83, 50.99));
      return f;
    },
  };

  // ------------------------------------------------------------------ registry
  FS.WORLDS = { avalon: AVALON, tehran: TEHRAN };
  FS.setWorld = function (id) {
    const w = FS.WORLDS[id] || AVALON;
    FS.WORLD = w;
    FS.AIRPORTS = w.airports;
    FS.magVar = w.magVar || 0;
    return w;
  };
  FS.mag = (trueDeg) => FS.wrap360(trueDeg - (FS.magVar || 0));
  FS.trueOf = (magDeg) => FS.wrap360(magDeg + (FS.magVar || 0));
  finishAirports(AVALON_AIRPORTS);
  FS.setWorld('avalon');

  // ------------------------------------------------------------------ terrain
  class Terrain {
    constructor(seed) {
      const w = (this.world = FS.WORLD);
      this.noise = new FS.Noise(typeof seed === 'number' ? seed : 7);
      this.noise2 = new FS.Noise((typeof seed === 'number' ? seed : 7) * 31 + 5);
      this.size = w.size;
      this.n = w.gridN;
      this.step = w.size / (w.gridN - 1);
      this.half = w.size / 2;
      this.edge = w.edgeElev;
      this.flat = [];
      for (const ap of w.airports) {
        if (w.elevFromTerrain || ap.elev == null) {
          let s = 0,
            c = 0;
          for (const rw of ap.runways)
            for (let t = -0.5; t <= 0.5; t += 0.25) {
              s += this.natural(rw.n + rw.dirN * rw.length * t, rw.e + rw.dirE * rw.length * t);
              c++;
            }
          ap.elev = Math.max(6, Math.round(s / c));
          if (ap.n == null) {
            ap.n = ap.runways[0].n;
            ap.e = ap.runways[0].e;
          }
        }
        airportPlane(ap);
        for (const rw of ap.runways) this.flat.push({ n: rw.n, e: rw.e, hdg: rw.hdg, hl: rw.length / 2 + 400, hw: 300, ap, blend: 1500 });
        for (const p of ap.pavement) this.flat.push({ n: p[0], e: p[1], hdg: p[2], hl: p[3] / 2 + 100, hw: p[4] / 2 + 100, ap, blend: 1500 });
      }
      const N = this.n;
      this.heights = new Float32Array(N * N);
      for (let j = 0; j < N; j++) {
        const n = -this.half + j * this.step;
        for (let i = 0; i < N; i++) {
          const e = -this.half + i * this.step;
          let h = this.raw(n, e);
          // blend toward the far-field elevation near the edges
          const edgeD = Math.min(this.half - Math.abs(n), this.half - Math.abs(e));
          if (!w.water) h = FS.lerp(this.edge, h, FS.smoothstep(0, 8000, edgeD));
          this.heights[j * N + i] = h;
        }
      }
      this.buildPaved();
    }

    natural(n, e) {
      return this.world.natural(n, e, this.noise);
    }

    raw(n, e) {
      let h = this.natural(n, e);
      let wMax = 0,
        target = 0;
      for (const f of this.flat) {
        const d = this.rectDist(n, e, f);
        if (d < f.blend) {
          const w = 1 - FS.smoothstep(0, f.blend, d);
          if (w > wMax) {
            wMax = w;
            target = f.ap.elevAt(n, e);
          }
        }
      }
      return wMax > 0 ? FS.lerp(h, target, wMax) : h;
    }

    rectDist(n, e, f) {
      const h = f.hdg * DEG;
      const dn = n - f.n,
        de = e - f.e;
      const a = Math.abs(dn * Math.cos(h) + de * Math.sin(h)) - f.hl;
      const b = Math.abs(-dn * Math.sin(h) + de * Math.cos(h)) - f.hw;
      const ax = Math.max(a, 0),
        bx = Math.max(b, 0);
      return Math.sqrt(ax * ax + bx * bx);
    }

    buildPaved() {
      this.paved = [];
      for (const ap of this.world.airports) {
        for (const rw of ap.runways) this.paved.push({ n: rw.n, e: rw.e, hdg: rw.hdg, hl: rw.length / 2 + 30, hw: rw.width / 2 + 3, runway: true, ap });
        for (const p of ap.pavement) this.paved.push({ n: p[0], e: p[1], hdg: p[2], hl: p[3] / 2, hw: p[4] / 2, ap });
      }
    }

    height(n, e) {
      const N = this.n;
      const fx = (e + this.half) / this.step,
        fy = (n + this.half) / this.step;
      if (fx < 0 || fy < 0 || fx >= N - 1 || fy >= N - 1) return this.edge;
      const i = Math.floor(fx),
        j = Math.floor(fy);
      const u = fx - i,
        v = fy - j;
      const H = this.heights;
      const h00 = H[j * N + i],
        h10 = H[j * N + i + 1],
        h01 = H[(j + 1) * N + i],
        h11 = H[(j + 1) * N + i + 1];
      if (u >= v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
      return h00 + (h11 - h01) * u + (h01 - h00) * v;
    }

    // ground height incl. water surface; on pavement the exact airport plane is used
    groundHeight(n, e) {
      const p = this.pavedAt(n, e);
      if (p) return p.ap.elevAt(n, e);
      const h = this.height(n, e);
      return this.world.water ? Math.max(0, h) : h;
    }

    pavedAt(n, e) {
      for (const p of this.paved) {
        const h = p.hdg * DEG;
        const dn = n - p.n,
          de = e - p.e;
        if (Math.abs(dn * Math.cos(h) + de * Math.sin(h)) <= p.hl && Math.abs(-dn * Math.sin(h) + de * Math.cos(h)) <= p.hw) return p;
      }
      return null;
    }

    gradient(n, e) {
      const d = 60;
      return {
        dn: (this.height(n + d, e) - this.height(n - d, e)) / (2 * d),
        de: (this.height(n, e + d) - this.height(n, e - d)) / (2 * d),
      };
    }

    surface(n, e) {
      if (this.pavedAt(n, e)) return 'asphalt';
      if (this.world.water && this.height(n, e) < 0.2) return 'water';
      return 'grass';
    }

    forest(n, e) {
      if (this.world.palette === 'desert') {
        // orchards/parks only in and around towns
        const c = this.world.cityDensity ? this.world.cityDensity(n, e) : 0;
        const v = this.noise2.fbm(e / 900, n / 900, 3);
        return c > 0.2 ? FS.smoothstep(0.25, 0.45, v) * 0.7 : FS.smoothstep(0.45, 0.6, v) * 0.5 * FS.smoothstep(1600, 1300, this.height(n, e));
      }
      const v = this.noise2.fbm(e / 2500, n / 2500, 4);
      return FS.smoothstep(0.08, 0.35, v);
    }

    nearAirport(n, e, margin) {
      for (const f of this.flat) if (this.rectDist(n, e, f) < margin) return true;
      return false;
    }
  }

  // ILS builder used by the world navaid lists
  function makeILS(list, ap, rw, endIdx, freq, ident, o) {
    const thr = rw.thr[endIdx];
    const hdgT = thr.hdg;
    const h = hdgT * DEG;
    const dn = Math.cos(h),
      de = Math.sin(h);
    const locPos = o.loc || { n: thr.n + dn * (rw.length + 300), e: thr.e + de * (rw.length + 300) };
    const loc = {
      type: 'LOC', freq, ident, n: locPos.n, e: locPos.e, alt: ap.elevAt(locPos.n, locPos.e) + 3,
      courseTrue: hdgT, course: Math.round(FS.wrap360(hdgT - (FS.magVar || 0))), fullScale: 2.5, range: 25 * NM,
      name: `ILS ${thr.id} ${ap.icao}`, apt: ap.icao, rwy: thr.id, thr, elev: thr.elev, approx: !!o.approx,
    };
    list.push(loc);
    if (o.gs) {
      // default GS antenna: abeam the point where a 3° path gives ~50 ft RDH
      const rdh = (o.rdhFt || 50) * FT;
      const setback = rdh / Math.tan(o.gs * DEG);
      const gp = o.gsPos || { n: thr.n + dn * setback - de * 120, e: thr.e + de * setback + dn * 120 };
      // along-course abeam point of the GS antenna
      const a = (gp.n - thr.n) * dn + (gp.e - thr.e) * de;
      loc.gs = { n: gp.n, e: gp.e, alt: thr.elev, angle: o.gs, fullScale: 0.7, range: 11 * NM, alongN: thr.n + dn * a, alongE: thr.e + de * a };
    }
    loc.dme = { n: loc.gs ? loc.gs.n : loc.n, e: loc.gs ? loc.gs.e : loc.e, alt: thr.elev + 5 };
    const at = (n, e, agl) => ({ n, e, alt: thr.elev + (agl || 0) });
    if (o.om) {
      list.push(Object.assign(at(thr.n - dn * o.om, thr.e - de * o.om), { type: 'MKR', kind: 'OM', course: hdgT, ident: 'OM' }));
      if (o.ndb) list.push(Object.assign(at(thr.n - dn * o.om, thr.e - de * o.om, 10), { type: 'NDB', freq: o.ndb[0], ident: o.ndb[1], name: `LOM ${o.ndb[1]}`, range: 35 * NM }));
    }
    if (o.mm) list.push(Object.assign(at(thr.n - dn * o.mm, thr.e - de * o.mm), { type: 'MKR', kind: 'MM', course: hdgT, ident: 'MM' }));
    return loc;
  }
  FS.makeILS = makeILS;
  FS.Terrain = Terrain;
})(typeof window !== 'undefined' ? window : globalThis);
