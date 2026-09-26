/*
 * World: airports, runways, navaids and the terrain height field of "Avalon Island".
 * Everything here is pure data / math (no rendering), shared by physics, radios and scenery.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG } = FS.U;

  // ---------------- Airports ----------------
  // Positions are NED metres. Runway 'hdg' = true heading when landing on ends[0].
  const AIRPORTS = [
    {
      icao: 'KAVX',
      name: 'Avalon Regional',
      n: 0,
      e: 0,
      runways: [
        { ends: ['09', '27'], n: 0, e: 0, hdg: 90, length: 2000, width: 45, lights: true, als: [false, true] },
      ],
      // extra paved areas: [n, e, hdg, length, width]
      pavement: [
        [170, 0, 90, 1900, 18], // parallel taxiway
        [85, -940, 0, 170, 18],
        [85, 940, 0, 170, 18],
        [85, 0, 0, 170, 18],
        [300, -150, 90, 420, 160], // apron
      ],
      tower: { n: 420, e: 150 },
      hangars: [
        [420, -300, 90],
        [420, -230, 90],
        [430, -380, 90],
      ],
      windsock: { n: 90, e: 750 },
      beacon: { n: 460, e: 60 },
    },
    {
      icao: 'KHLD',
      name: 'Highland Field',
      n: 21000,
      e: 12000,
      runways: [{ ends: ['36', '18'], n: 21000, e: 12000, hdg: 360, length: 1500, width: 30, lights: true, als: [true, false] }],
      pavement: [
        [21000, 12120, 0, 1400, 15],
        [21000, 12230, 0, 300, 120],
      ],
      tower: { n: 21150, e: 12320 },
      hangars: [
        [20900, 12330, 0],
        [20980, 12330, 0],
      ],
      windsock: { n: 20380, e: 12060 },
      beacon: { n: 21250, e: 12300 },
    },
    {
      icao: 'KLKV',
      name: 'Lakeview',
      n: -15500,
      e: -15000,
      runways: [{ ends: ['13', '31'], n: -15500, e: -15000, hdg: 130, length: 1300, width: 30, lights: true, als: [false, false] }],
      pavement: [[-15400, -15120, 130, 300, 90]],
      tower: null,
      hangars: [
        [-15330, -15230, 130],
        [-15380, -15170, 130],
      ],
      windsock: { n: -15700, e: -15250 },
      beacon: { n: -15300, e: -15300 },
    },
  ];

  // Derived runway geometry
  for (const ap of AIRPORTS) {
    for (const rw of ap.runways) {
      const h = rw.hdg * DEG;
      rw.dirN = Math.cos(h);
      rw.dirE = Math.sin(h);
      // threshold for landing on ends[0] (aircraft flies heading hdg), and for ends[1]
      rw.thr = [
        { n: rw.n - (rw.dirN * rw.length) / 2, e: rw.e - (rw.dirE * rw.length) / 2, hdg: rw.hdg, id: rw.ends[0] },
        { n: rw.n + (rw.dirN * rw.length) / 2, e: rw.e + (rw.dirE * rw.length) / 2, hdg: FS.wrap360(rw.hdg + 180), id: rw.ends[1] },
      ];
    }
  }

  // ---------------- Terrain ----------------
  const T_SIZE = 80000; // metres, square centred on origin
  const T_N = 513; // grid vertices per side
  const T_STEP = T_SIZE / (T_N - 1);
  const T_HALF = T_SIZE / 2;

  class Terrain {
    constructor(seed = 7) {
      this.noise = new FS.Noise(seed);
      this.noise2 = new FS.Noise(seed * 31 + 5);
      this.size = T_SIZE;
      this.n = T_N;
      this.step = T_STEP;
      this.half = T_HALF;
      this.flat = [];
      // airport elevations from natural terrain
      for (const ap of AIRPORTS) {
        let s = 0,
          c = 0;
        for (const rw of ap.runways)
          for (let t = -0.5; t <= 0.5; t += 0.25) {
            s += this.natural(rw.n + rw.dirN * rw.length * t, rw.e + rw.dirE * rw.length * t);
            c++;
          }
        ap.elev = Math.max(6, Math.round(s / c));
        for (const rw of ap.runways) {
          rw.elev = ap.elev;
          this.flat.push({ n: rw.n, e: rw.e, hdg: rw.hdg, hl: rw.length / 2 + 350, hw: 260, elev: ap.elev, blend: 1400 });
        }
        for (const p of ap.pavement) this.flat.push({ n: p[0], e: p[1], hdg: p[2], hl: p[3] / 2 + 80, hw: p[4] / 2 + 80, elev: ap.elev, blend: 1400 });
      }
      this.heights = new Float32Array(T_N * T_N);
      for (let j = 0; j < T_N; j++) {
        const n = -T_HALF + j * T_STEP;
        for (let i = 0; i < T_N; i++) {
          const e = -T_HALF + i * T_STEP;
          this.heights[j * T_N + i] = this.raw(n, e);
        }
      }
      this.buildPaved();
    }

    // Natural terrain height (m MSL) before airport flattening
    natural(n, e) {
      const N = this.noise;
      const x = e / 1000,
        y = n / 1000;
      let h = 25 + 55 * (N.fbm(x / 9, y / 9, 5) * 0.5 + 0.5);
      h += 140 * Math.max(0, N.fbm(x / 5 + 10, y / 5 - 3, 4));
      // mountain range in the north
      const m = FS.smoothstep(19, 29, y + 4 * N.noise(x / 12, 3.3));
      h += m * (180 + 1500 * N.ridge(x / 9 + 4, y / 9 + 1, 5));
      // western ridge
      const w = FS.smoothstep(-20, -29, x + 3 * N.noise(1.7, y / 10)) * FS.smoothstep(-20, 0, y);
      h += w * (100 + 700 * N.ridge(x / 7, y / 7 + 9, 4));
      // island coastline
      const r = Math.sqrt(x * x + y * y * 0.85) + 4 * N.noise(x / 9 + 7, y / 9 - 2);
      const coast = FS.smoothstep(37, 31, r);
      h = h * coast - 70 * (1 - coast);
      // Lake south-west (next to Lakeview)
      const dl = Math.hypot(x + 19.5, y + 18.5) + 1.2 * N.noise(x / 2, y / 2);
      h = FS.lerp(h, -10, FS.smoothstep(3.6, 2.2, dl));
      // river valley from the lake toward the south coast
      return h;
    }

    raw(n, e) {
      let h = this.natural(n, e);
      for (const f of this.flat) {
        const d = this.rectDist(n, e, f);
        if (d < f.blend) {
          const w = 1 - FS.smoothstep(0, f.blend, d);
          h = FS.lerp(h, f.elev, w);
        }
      }
      return h;
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
      for (const ap of AIRPORTS) {
        for (const rw of ap.runways)
          this.paved.push({ n: rw.n, e: rw.e, hdg: rw.hdg, hl: rw.length / 2 + 30, hw: rw.width / 2 + 3, runway: true });
        for (const p of ap.pavement) this.paved.push({ n: p[0], e: p[1], hdg: p[2], hl: p[3] / 2, hw: p[4] / 2 });
      }
    }

    // Height of the rendered surface (same triangulation as the mesh)
    height(n, e) {
      const fx = (e + T_HALF) / T_STEP,
        fy = (n + T_HALF) / T_STEP;
      if (fx < 0 || fy < 0 || fx >= T_N - 1 || fy >= T_N - 1) return -70;
      const i = Math.floor(fx),
        j = Math.floor(fy);
      const u = fx - i,
        v = fy - j;
      const H = this.heights;
      const h00 = H[j * T_N + i],
        h10 = H[j * T_N + i + 1],
        h01 = H[(j + 1) * T_N + i],
        h11 = H[(j + 1) * T_N + i + 1];
      // triangles split along (i,j)-(i+1,j+1)
      if (u >= v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
      return h00 + (h11 - h01) * u + (h01 - h00) * v;
    }

    // Ground height including water surface (sea level 0)
    groundHeight(n, e) {
      return Math.max(0, this.height(n, e));
    }

    gradient(n, e) {
      const d = 60;
      return {
        dn: (this.height(n + d, e) - this.height(n - d, e)) / (2 * d),
        de: (this.height(n, e + d) - this.height(n, e - d)) / (2 * d),
      };
    }

    surface(n, e) {
      for (const p of this.paved) {
        const h = p.hdg * DEG;
        const dn = n - p.n,
          de = e - p.e;
        if (Math.abs(dn * Math.cos(h) + de * Math.sin(h)) <= p.hl && Math.abs(-dn * Math.sin(h) + de * Math.cos(h)) <= p.hw) return 'asphalt';
      }
      if (this.height(n, e) < 0.2) return 'water';
      return 'grass';
    }

    // 0..1 forest density used for scenery & colouring
    forest(n, e) {
      const v = this.noise2.fbm(e / 2500, n / 2500, 4);
      return FS.smoothstep(0.08, 0.35, v);
    }

    nearAirport(n, e, margin) {
      for (const f of this.flat) if (this.rectDist(n, e, f) < margin) return true;
      return false;
    }
  }

  FS.AIRPORTS = AIRPORTS;
  FS.Terrain = Terrain;
})(typeof window !== 'undefined' ? window : globalThis);
