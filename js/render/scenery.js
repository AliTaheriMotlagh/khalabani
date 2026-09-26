/*
 * 3D scenery: terrain, water, airports (runways, markings, lighting systems), trees, towns, sky, clouds, precipitation.
 * Three.js coordinates: X = East, Y = Up, Z = South.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG, RAD } = FS.U;
  const T3 = (n, e, alt) => new THREE.Vector3(e, alt, -n);

  const TOWNS = [
    { n: 3600, e: 3800, r: 1700 },
    { n: 18800, e: 8400, r: 900 },
    { n: -13600, e: -12200, r: 1000 },
    { n: -7000, e: 13500, r: 1400 },
    { n: 7500, e: -11500, r: 1100 },
    { n: -2500, e: -6000, r: 700 },
  ];
  const ROADS = [
    [[0, 900], [2000, 2500], [3600, 3800], [9000, 6000], [15000, 7600], [18800, 8400], [21000, 11700]],
    [[3600, 3800], [0, 9000], [-7000, 13500]],
    [[0, -900], [-2500, -6000], [-8000, -9000], [-13600, -12200], [-15500, -15000]],
    [[3600, 3800], [6000, -3000], [7500, -11500]],
    [[-7000, 13500], [-14000, 6000], [-13600, -12200]],
  ];

  // ---------- shaders ----------
  const LIGHT_VS = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 color; attribute float size;
    uniform float fogDensity; uniform float intensity; uniform float pixelRatio;
    varying vec3 vColor; varying float vFog;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position,1.0);
      gl_Position = projectionMatrix * mv;
      float d = -mv.z;
      gl_PointSize = clamp(size * 2600.0 / d, 2.2, size * 7.0) * pixelRatio * (0.55 + 0.45*intensity);
      float fd = fogDensity * 0.55;
      vFog = exp(-d*d*fd*fd);
      vColor = color * intensity;
      #include <logdepthbuf_vertex>
    }`;
  const LIGHT_FS = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    varying vec3 vColor; varying float vFog;
    void main(){
      #include <logdepthbuf_fragment>
      vec2 c = gl_PointCoord - 0.5;
      float r2 = dot(c,c)*4.0;
      float a = exp(-r2*3.5) + 0.6*exp(-r2*18.0);
      if (a < 0.02) discard;
      gl_FragColor = vec4(vColor * a * vFog, 1.0);
    }`;
  const CLOUD_VS = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 offset; attribute float scale; attribute float shade; attribute float seed;
    uniform float fogDensity;
    varying vec2 vUv; varying float vShade; varying float vFog; varying float vFade; varying float vH;
    void main(){
      vUv = uv;
      vH = position.y + 0.5;
      float a = seed * 6.2831;
      vec2 p = position.xy;
      vec2 pr = vec2(cos(a)*p.x - sin(a)*p.y, sin(a)*p.x + cos(a)*p.y);
      vec4 mv = modelViewMatrix * vec4(offset, 1.0);
      mv.xy += pr * scale * 2.2;
      gl_Position = projectionMatrix * mv;
      float d = length(mv.xyz);
      vFog = 1.0 - exp(-d*d*fogDensity*fogDensity*0.6);
      vFade = smoothstep(scale*0.25, scale*1.1, d);
      vShade = shade;
      #include <logdepthbuf_vertex>
    }`;
  const CLOUD_FS = `
    #include <common>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D map; uniform vec3 fogColor; uniform vec3 litColor; uniform vec3 darkColor;
    varying vec2 vUv; varying float vShade; varying float vFog; varying float vFade; varying float vH;
    void main(){
      #include <logdepthbuf_fragment>
      vec4 t = texture2D(map, vUv);
      float l = clamp(vShade*0.55 + vH*0.45, 0.0, 1.0);
      vec3 col = mix(darkColor, litColor, l) * (0.82 + 0.18*t.r);
      col = mix(col, fogColor, vFog);
      float a = t.a * vFade;
      if (a < 0.01) discard;
      gl_FragColor = vec4(col, a);
    }`;
  const SKY_VS = `
    varying vec3 vDir;
    void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`;
  const SKY_FS = `
    uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
    uniform float haze; uniform vec3 hazeColor; uniform float sunVis;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = h > 0.0 ? mix(horizon, zenith, pow(clamp(h,0.0,1.0), 0.45)) : mix(horizon, ground, clamp(-h*6.0,0.0,1.0));
      float sd = max(dot(d, sunDir), 0.0);
      col += sunColor * (pow(sd, 1200.0) * 30.0 + pow(sd, 90.0) * 0.5 + pow(sd, 6.0) * 0.18) * sunVis;
      float hz = clamp(haze * (1.0 - abs(h)*0.6), 0.0, 1.0);
      col = mix(col, hazeColor, hz);
      gl_FragColor = vec4(col, 1.0);
    }`;

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    return t;
  }

  class Scenery {
    constructor(renderer, terrain, navaids) {
      this.renderer = renderer;
      this.terrain = terrain;
      this.navaids = navaids;
      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0xbfd1e5, 0.00003);
      this.lightsets = [];
      this.time = 0;
    }

    async build(progress) {
      progress = progress || (async () => {});
      const S = this.scene;
      this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.55);
      S.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
      S.add(this.sun);
      S.add(this.sun.target);
      this.amb = new THREE.AmbientLight(0xffffff, 0.12);
      S.add(this.amb);
      this.buildSky();
      await progress('Generating ground textures');
      this.buildTerrain();
      await progress('Building airports');
      this.buildAirports();
      this.buildNavaidSites();
      await progress('Planting forests & towns');
      this.buildTrees();
      this.buildTowns();
      this.buildRain();
      this.cloudGroup = new THREE.Group();
      S.add(this.cloudGroup);
      this.puffTex = canvasTex(256, 256, (g, w, h) => {
        const rnd = FS.rng(9);
        // soft core
        const core = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.48);
        core.addColorStop(0, 'rgba(255,255,255,0.95)');
        core.addColorStop(0.45, 'rgba(250,250,250,0.75)');
        core.addColorStop(0.8, 'rgba(240,240,240,0.18)');
        core.addColorStop(1, 'rgba(240,240,240,0)');
        g.fillStyle = core;
        g.fillRect(0, 0, w, h);
        // cauliflower lumps
        for (let i = 0; i < 40; i++) {
          const a = rnd() * Math.PI * 2,
            d = Math.sqrt(rnd()) * w * 0.28;
          const x = w / 2 + Math.cos(a) * d,
            y = h / 2 + Math.sin(a) * d * 0.9,
            r = w * (0.07 + rnd() * 0.12);
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          const b = 215 + rnd() * 40;
          gr.addColorStop(0, `rgba(${b},${b},${b},0.5)`);
          gr.addColorStop(1, `rgba(${b},${b},${b},0)`);
          g.fillStyle = gr;
          g.fillRect(0, 0, w, h);
        }
      });
    }

    // ---------------- sky ----------------
    buildSky() {
      this.skyMat = new THREE.ShaderMaterial({
        vertexShader: SKY_VS,
        fragmentShader: SKY_FS,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color(0x3a4450) },
          sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 0.95, 0.85) },
          haze: { value: 0 }, hazeColor: { value: new THREE.Color() }, sunVis: { value: 1 },
        },
      });
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.skyMat);
      this.sky.renderOrder = -10;
      this.sky.frustumCulled = false;
      this.scene.add(this.sky);
      // stars
      const pos = [];
      const rnd = FS.rng(77);
      for (let i = 0; i < 2500; i++) {
        const u = rnd() * 2 - 1,
          a = rnd() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        if (u < -0.05) continue;
        pos.push(s * Math.cos(a) * 150000, u * 150000, s * Math.sin(a) * 150000);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
      this.stars = new THREE.Points(g, this.starMat);
      this.stars.renderOrder = -9;
      this.stars.frustumCulled = false;
      this.scene.add(this.stars);
    }

    // ---------------- terrain ----------------
    buildTerrain() {
      const T = this.terrain;
      const N = T.n,
        step = T.step,
        half = T.half;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * N * 3);
      const uv = new Float32Array(N * N * 2);
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const k = j * N + i;
          const e = -half + i * step,
            n = -half + j * step;
          pos[k * 3] = e;
          pos[k * 3 + 1] = T.heights[k];
          pos[k * 3 + 2] = -n;
          uv[k * 2] = i / (N - 1);
          uv[k * 2 + 1] = j / (N - 1);
        }
      const idx = new Uint32Array((N - 1) * (N - 1) * 6);
      let p = 0;
      for (let j = 0; j < N - 1; j++)
        for (let i = 0; i < N - 1; i++) {
          const a = j * N + i,
            b = a + 1,
            c = a + N + 1,
            d = a + N;
          // same split as Terrain.height(): (i,j)-(i+1,j+1)
          idx[p++] = a;
          idx[p++] = b;
          idx[p++] = c;
          idx[p++] = a;
          idx[p++] = c;
          idx[p++] = d;
        }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();

      const colorTex = this.makeGroundTexture();
      const detail = canvasTex(256, 256, (g, w, h) => {
        const img = g.createImageData(w, h);
        const nz = new FS.Noise(5);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const v = 0.5 + 0.28 * nz.fbm(x / 16, y / 16, 4) + (Math.random() - 0.5) * 0.18;
            const c = FS.clamp(v, 0, 1) * 255;
            const i = (y * w + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
            img.data[i + 3] = 255;
          }
        g.putImageData(img, 0, 0);
      });
      detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
      const mat = new THREE.MeshLambertMaterial({ map: colorTex });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.detailMap = { value: detail };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D detailMap;')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
             vec3 dt1 = texture2D(detailMap, vUv * 1100.0).rgb;
             vec3 dt2 = texture2D(detailMap, vUv * 90.0).rgb;
             diffuseColor.rgb *= mix(vec3(1.0), dt1 * 1.9, 0.55) * mix(vec3(1.0), dt2 * 1.9, 0.35);`
          );
      };
      this.terrainMesh = new THREE.Mesh(geo, mat);
      this.scene.add(this.terrainMesh);

      // ocean
      const wg = new THREE.PlaneGeometry(600000, 600000);
      wg.rotateX(-Math.PI / 2);
      this.waterMat = new THREE.MeshPhongMaterial({ color: 0x1d4a66, specular: 0x557788, shininess: 60, transparent: true, opacity: 0.88 });
      this.water = new THREE.Mesh(wg, this.waterMat);
      this.water.position.y = 0.05;
      this.water.renderOrder = 1;
      this.scene.add(this.water);
    }

    makeGroundTexture() {
      const T = this.terrain;
      const R = 2048;
      const c = document.createElement('canvas');
      c.width = c.height = R;
      const g = c.getContext('2d');
      const img = g.createImageData(R, R);
      const size = T.size,
        half = T.half;
      const nz = new FS.Noise(19);
      const H = new Float32Array(R * R);
      const px = size / R;
      for (let y = 0; y < R; y++) {
        const n = half - (y + 0.5) * px;
        for (let x = 0; x < R; x++) H[y * R + x] = T.height(n, -half + (x + 0.5) * px);
      }
      const fieldCols = [
        [0.62, 0.58, 0.33], [0.4, 0.52, 0.23], [0.5, 0.42, 0.28], [0.52, 0.6, 0.3], [0.33, 0.45, 0.2], [0.68, 0.62, 0.42], [0.45, 0.5, 0.25],
      ];
      const hash = (a, b) => {
        let h = (a * 374761393 + b * 668265263) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      };
      for (let y = 0; y < R; y++) {
        const n = half - (y + 0.5) * px;
        for (let x = 0; x < R; x++) {
          const e = -half + (x + 0.5) * px;
          const k = y * R + x;
          const h = H[k];
          const hx = H[y * R + Math.min(x + 1, R - 1)] - H[y * R + Math.max(x - 1, 0)];
          const hy = H[Math.min(y + 1, R - 1) * R + x] - H[Math.max(y - 1, 0) * R + x];
          const slope = Math.hypot(hx, hy) / (2 * px);
          const v = nz.fbm(e / 700, n / 700, 3);
          let r, gg, b;
          if (h < 0.3) {
            const t = FS.clamp(-h / 40, 0, 1);
            r = FS.lerp(0.62, 0.08, t);
            gg = FS.lerp(0.62, 0.22, t);
            b = FS.lerp(0.48, 0.3, t);
          } else if (h < 4 + v * 3) {
            r = 0.78;
            gg = 0.72;
            b = 0.55;
          } else {
            r = 0.36 + v * 0.06;
            gg = 0.47 + v * 0.07;
            b = 0.22;
            // agricultural fields in lowlands
            const fi = Math.floor((n + 1000 * nz.noise(e / 3000, 1)) / 420),
              fj = Math.floor((e + 1000 * nz.noise(2, n / 3000)) / 300);
            const hv = hash(fi, fj);
            const fieldOK = h < 380 && slope < 0.1 && hv < 0.8;
            const forest = T.forest(n, e);
            if (fieldOK && forest < 0.5) {
              const fc = fieldCols[Math.floor(hv * 7.99)];
              const t = 0.85 * (1 - forest * 2);
              r = FS.lerp(r, fc[0], t);
              gg = FS.lerp(gg, fc[1], t);
              b = FS.lerp(b, fc[2], t);
            }
            const f = forest * FS.smoothstep(1.2, 0.5, slope) * FS.smoothstep(1100, 800, h);
            r = FS.lerp(r, 0.14, f);
            gg = FS.lerp(gg, 0.25, f);
            b = FS.lerp(b, 0.11, f);
            const rock = FS.clamp(FS.smoothstep(0.35, 0.8, slope) + FS.smoothstep(700, 1100, h) * 0.7, 0, 1);
            r = FS.lerp(r, 0.46 + v * 0.05, rock);
            gg = FS.lerp(gg, 0.43 + v * 0.05, rock);
            b = FS.lerp(b, 0.39, rock);
            const snow = FS.smoothstep(1250 + v * 150, 1400 + v * 150, h) * FS.smoothstep(1.3, 0.7, slope);
            r = FS.lerp(r, 0.95, snow);
            gg = FS.lerp(gg, 0.96, snow);
            b = FS.lerp(b, 0.98, snow);
          }
          const i4 = k * 4;
          img.data[i4] = r * 255;
          img.data[i4 + 1] = gg * 255;
          img.data[i4 + 2] = b * 255;
          img.data[i4 + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      const toPx = (n, e) => [((e + half) / size) * R, ((half - n) / size) * R];
      // towns
      for (const t of TOWNS) {
        const [x, y] = toPx(t.n, t.e);
        const rr = (t.r / size) * R;
        const gr = g.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, 'rgba(120,112,105,0.9)');
        gr.addColorStop(0.7, 'rgba(120,115,100,0.55)');
        gr.addColorStop(1, 'rgba(120,115,100,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.fill();
        const rnd = FS.rng(t.n | 0);
        for (let s = 0; s < t.r / 6; s++) {
          const a = rnd() * Math.PI * 2,
            d = Math.sqrt(rnd()) * rr;
          const v = 90 + rnd() * 70;
          g.fillStyle = `rgba(${v},${v - 5},${v - 12},0.9)`;
          g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
        }
      }
      // roads
      g.strokeStyle = 'rgba(70,68,66,0.95)';
      g.lineWidth = 1.2;
      g.lineJoin = 'round';
      for (const r of ROADS) {
        g.beginPath();
        r.forEach((p, i) => {
          const [x, y] = toPx(p[0], p[1]);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke();
      }
      // airport grass (mown, lighter)
      for (const ap of FS.AIRPORTS)
        for (const rw of ap.runways) {
          const [x, y] = toPx(rw.n, rw.e);
          g.save();
          g.translate(x, y);
          g.rotate(rw.hdg * DEG);
          g.fillStyle = 'rgba(110,140,70,0.8)';
          const L = ((rw.length + 500) / size) * R,
            W = (420 / size) * R;
          g.fillRect(-W / 2, -L / 2, W, L);
          g.restore();
        }
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.encoding = THREE.sRGBEncoding;
      return tex;
    }

    // ---------------- airports ----------------
    runwayTexture(rw) {
      const Wpx = 256,
        Lpx = 4096;
      const pxW = Wpx / rw.width,
        pxL = Lpx / rw.length;
      const t = canvasTex(Wpx, Lpx, (g) => {
        g.fillStyle = '#3b3d40';
        g.fillRect(0, 0, Wpx, Lpx);
        // asphalt texture & tyre marks
        for (let i = 0; i < 9000; i++) {
          const v = 50 + Math.random() * 25;
          g.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
          g.fillRect(Math.random() * Wpx, Math.random() * Lpx, 2, 3);
        }
        for (const endTop of [false, true]) {
          for (let i = 0; i < 70; i++) {
            const y = (endTop ? 0.02 + Math.random() * 0.2 : 0.78 + Math.random() * 0.2) * Lpx;
            g.fillStyle = 'rgba(15,15,15,0.18)';
            g.fillRect(Wpx / 2 + (Math.random() - 0.5) * 40 - 8, y, 5, 40 + Math.random() * 150);
            g.fillRect(Wpx / 2 + (Math.random() - 0.5) * 40 + 8, y, 5, 40 + Math.random() * 150);
          }
        }
        g.fillStyle = '#e8e8e8';
        // edge lines
        g.fillRect(1.0 * pxW, 0, 0.9 * pxW, Lpx);
        g.fillRect(Wpx - 1.9 * pxW, 0, 0.9 * pxW, Lpx);
        // centreline dashes (36 m, 24 m gap)
        for (let s = 90; s < rw.length - 90; s += 60) g.fillRect(Wpx / 2 - 0.45 * pxW, Lpx - (s + 36) * pxL, 0.9 * pxW, 36 * pxL);
        const drawEnd = (label, top) => {
          g.save();
          if (top) {
            g.translate(Wpx, Lpx);
            g.rotate(Math.PI);
          }
          // threshold bars (piano keys)
          const bars = rw.width >= 45 ? 12 : 8;
          const bw = 1.8 * pxW;
          const total = bars * bw * 2 - bw;
          for (let i = 0; i < bars; i++) {
            const x0 = Wpx / 2 - total / 2 + i * bw * 2;
            const xx = i < bars / 2 ? x0 - bw : x0 + bw;
            g.fillRect(xx, Lpx - 36 * pxL, bw, 30 * pxL);
          }
          // number
          g.save();
          g.translate(Wpx / 2, Lpx - 48 * pxL);
          g.scale(pxW / 5.2, (pxL * 18) / 90);
          g.font = 'bold 90px Arial';
          g.textAlign = 'center';
          g.textBaseline = 'bottom';
          g.fillText(label, 0, 0);
          g.restore();
          // aiming point & touchdown zone
          g.fillRect(Wpx / 2 - 8 * pxW, Lpx - 350 * pxL, 5 * pxW, 45 * pxL);
          g.fillRect(Wpx / 2 + 3 * pxW, Lpx - 350 * pxL, 5 * pxW, 45 * pxL);
          for (const [d, nb] of [[150, 3], [450, 2], [600, 2], [750, 1]]) {
            if (d + 30 > rw.length / 2) continue;
            for (let k = 0; k < nb; k++) {
              g.fillRect(Wpx / 2 - (6 + k * 2.2) * pxW, Lpx - (d + 22) * pxL, 1.5 * pxW, 22 * pxL);
              g.fillRect(Wpx / 2 + (4.5 + k * 2.2) * pxW, Lpx - (d + 22) * pxL, 1.5 * pxW, 22 * pxL);
            }
          }
          g.restore();
        };
        drawEnd(rw.ends[0], false);
        drawEnd(rw.ends[1], true);
      });
      t.encoding = THREE.sRGBEncoding;
      return t;
    }

    flatRect(n, e, hdg, len, wid, elev, mat, yOff) {
      const g = new THREE.PlaneGeometry(wid, len, 1, Math.max(1, Math.round(len / 100)));
      g.rotateX(-Math.PI / 2);
      g.rotateY(-hdg * DEG);
      const m = new THREE.Mesh(g, mat);
      m.position.copy(T3(n, e, elev + yOff));
      this.scene.add(m);
      return m;
    }

    buildAirports() {
      const taxiMat = new THREE.MeshPhongMaterial({ color: 0x55575a, shininess: 5, specular: 0x111111, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const lightPos = [],
        lightCol = [],
        lightSize = [];
      const addLight = (n, e, alt, c, s) => {
        lightPos.push(e, alt, -n);
        lightCol.push(c[0], c[1], c[2]);
        lightSize.push(s || 1);
      };
      this.thrLights = [];
      this.papis = [];
      this.flashers = [];
      this.beacons = [];
      this.windsocks = [];
      const bldMat = new THREE.MeshLambertMaterial({ color: 0xd9d4c7 });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x6d7378 });
      const glassMat = new THREE.MeshPhongMaterial({ color: 0x1a2f3a, specular: 0x88aacc, shininess: 90 });

      for (const ap of FS.AIRPORTS) {
        const el = ap.elev;
        for (const p of ap.pavement) this.flatRect(p[0], p[1], p[2], p[3], p[4], el, taxiMat, 0.1);
        for (const rw of ap.runways) {
          const mat = new THREE.MeshPhongMaterial({ map: this.runwayTexture(rw), shininess: 8, specular: 0x151515, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
          this.flatRect(rw.n, rw.e, rw.hdg, rw.length, rw.width, el, mat, 0.15);
          const dn = rw.dirN,
            de = rw.dirE;
          const pn = -de,
            pe = dn; // right-hand perpendicular (looking along hdg)
          // edge lights every 60 m
          for (let s = 0; s <= rw.length; s += 60) {
            for (const side of [-1, 1]) {
              const off = rw.width / 2 + 1.5;
              const n = rw.thr[0].n + dn * s + pn * off * side,
                e = rw.thr[0].e + de * s + pe * off * side;
              addLight(n, e, el + 0.5, [1, 0.95, 0.8], 0.9);
            }
          }
          // threshold/end rows (green toward approach, red toward rollout)
          for (let t = 0; t < 2; t++) {
            const thr = rw.thr[t];
            const sgn = t === 0 ? -1 : 1;
            const idxStart = lightPos.length / 3;
            for (let k = -6; k <= 6; k++) {
              const off = (k / 6) * (rw.width / 2 + 2);
              addLight(thr.n + dn * sgn * 2 + pn * off, thr.e + de * sgn * 2 + pe * off, el + 0.5, [0.2, 1, 0.3], 1.1);
            }
            this.thrLights.push({ start: idxStart, count: 13, thr, hdg: thr.hdg });
          }
          // approach lighting systems and PAPIs
          for (let t = 0; t < 2; t++) {
            const thr = rw.thr[t];
            const h = thr.hdg * DEG;
            const an = Math.cos(h),
              ae = Math.sin(h); // landing direction
            const rn = -ae,
              re = an; // right of landing direction
            if (rw.als && rw.als[t]) {
              for (let d = 30; d <= 720; d += 30) {
                for (let k = -2; k <= 2; k++) {
                  const n = thr.n - an * d + rn * k * 1.2,
                    e = thr.e - ae * d + re * k * 1.2;
                  addLight(n, e, el + 0.6 + d * 0.004, [1, 0.93, 0.8], 1.3);
                }
                if (d === 300)
                  for (let k = -7; k <= 7; k++) if (Math.abs(k) > 2) addLight(thr.n - an * d + rn * k * 1.5, thr.e - ae * d + re * k * 1.5, el + 1.8, [1, 0.93, 0.8], 1.3);
                if (d >= 300) {
                  const i = lightPos.length / 3;
                  addLight(thr.n - an * d, thr.e - ae * d, el + 2.2 + d * 0.004, [0, 0, 0], 3.0);
                  this.flashers.push({ i, d });
                }
              }
              // approach light towers (visual)
            }
            if (rw.lights) {
              // PAPI left of runway, 300 m past threshold
              const pd = 300;
              const base = lightPos.length / 3;
              const ang = [3.5, 3.1667, 2.8333, 2.5]; // inner -> outer
              for (let k = 0; k < 4; k++) {
                const off = -(rw.width / 2 + 15 + k * 9);
                addLight(thr.n + an * pd + rn * off, thr.e + ae * pd + re * off, el + 1.0, [1, 1, 1], 1.6);
              }
              this.papis.push({ base, thr, pd, ang, elev: el, an, ae });
            }
          }
        }
        // taxiway edge lights (blue)
        for (const p of ap.pavement) {
          if (p[4] > 40) continue;
          const h = p[2] * DEG;
          const dn = Math.cos(h),
            de = Math.sin(h),
            pn = -de,
            pe = dn;
          for (let s = -p[3] / 2; s <= p[3] / 2; s += 50)
            for (const side of [-1, 1]) addLight(p[0] + dn * s + pn * side * (p[4] / 2 + 1), p[1] + de * s + pe * side * (p[4] / 2 + 1), el + 0.4, [0.2, 0.35, 1], 0.7);
        }
        // buildings
        if (ap.tower) {
          const tw = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 22, 10), bldMat);
          tw.position.copy(T3(ap.tower.n, ap.tower.e, el + 11));
          this.scene.add(tw);
          const cab = new THREE.Mesh(new THREE.CylinderGeometry(6, 5, 5, 8), glassMat);
          cab.position.copy(T3(ap.tower.n, ap.tower.e, el + 24.5));
          this.scene.add(cab);
          const rf = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 1, 8), roofMat);
          rf.position.copy(T3(ap.tower.n, ap.tower.e, el + 27.5));
          this.scene.add(rf);
          ap.towerView = { n: ap.tower.n, e: ap.tower.e, alt: el + 25 };
          addLight(ap.tower.n, ap.tower.e, el + 28.5, [1, 0.1, 0.05], 1.2);
        } else ap.towerView = { n: ap.n + 300, e: ap.e + 300, alt: el + 15 };
        for (const hg of ap.hangars) {
          const g = new THREE.BoxGeometry(34, 11, 28);
          const m = new THREE.Mesh(g, bldMat);
          m.position.copy(T3(hg[0], hg[1], el + 5.5));
          m.rotation.y = -hg[2] * DEG;
          this.scene.add(m);
          const r = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 14.5, 34.2, 12, 1, false, 0, Math.PI), roofMat);
          r.rotation.z = Math.PI / 2;
          r.position.set(0, 0, 0);
          const rg = new THREE.Group();
          rg.add(r);
          r.scale.set(1, 1, 0.35);
          rg.position.copy(T3(hg[0], hg[1], el + 11));
          rg.rotation.y = -hg[2] * DEG;
          this.scene.add(rg);
        }
        // windsock
        if (ap.windsock) {
          const g = new THREE.Group();
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
          pole.position.y = 3;
          g.add(pole);
          const sockG = new THREE.CylinderGeometry(0.45, 0.2, 3.6, 12, 5, true);
          sockG.rotateX(Math.PI / 2);
          sockG.translate(0, 0, -1.8);
          const cols = [];
          const pa = sockG.attributes.position;
          for (let i = 0; i < pa.count; i++) {
            const band = Math.floor(((-pa.getZ(i)) / 3.6) * 5 - 0.001);
            const c = band % 2 === 0 ? [1, 0.35, 0.05] : [1, 1, 1];
            cols.push(...c);
          }
          sockG.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
          const sock = new THREE.Mesh(sockG, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
          const pivot = new THREE.Group();
          pivot.position.y = 5.8;
          pivot.add(sock);
          g.add(pivot);
          g.position.copy(T3(ap.windsock.n, ap.windsock.e, el));
          this.scene.add(g);
          this.windsocks.push({ pivot, sock });
          addLight(ap.windsock.n, ap.windsock.e, el + 6.5, [1, 0.2, 0.1], 0.8);
        }
        if (ap.beacon) {
          const i = lightPos.length / 3;
          addLight(ap.beacon.n, ap.beacon.e, el + 18, [0, 0, 0], 3);
          this.beacons.push(i);
          const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 18, 6), new THREE.MeshLambertMaterial({ color: 0xaa2222 }));
          tw.position.copy(T3(ap.beacon.n, ap.beacon.e, el + 9));
          this.scene.add(tw);
        }
      }
      // town lights (visible at night) go into their own point cloud
      const townPos = [],
        townCol = [],
        townSize = [];
      const addTown = (n, e, alt, c, s) => {
        townPos.push(e, alt, -n);
        townCol.push(c[0], c[1], c[2]);
        townSize.push(s);
      };
      const rnd = FS.rng(3);
      for (const t of TOWNS)
        for (let i = 0; i < 260; i++) {
          const a = rnd() * Math.PI * 2,
            r = Math.sqrt(rnd()) * t.r;
          const n = t.n + Math.cos(a) * r,
            e = t.e + Math.sin(a) * r;
          const h = this.terrain.height(n, e);
          if (h < 1) continue;
          const w = rnd();
          addTown(n, e, h + 6, w < 0.7 ? [1, 0.75, 0.4] : [0.9, 0.9, 1], 0.9);
        }
      this.townLightStart = 0;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
      this.lightColors = new THREE.Float32BufferAttribute(lightCol, 3);
      this.lightBase = Float32Array.from(lightCol);
      geo.setAttribute('color', this.lightColors);
      geo.setAttribute('size', new THREE.Float32BufferAttribute(lightSize, 1));
      this.lightMat = new THREE.ShaderMaterial({
        vertexShader: LIGHT_VS,
        fragmentShader: LIGHT_FS,
        uniforms: { fogDensity: { value: 0 }, intensity: { value: 1 }, pixelRatio: { value: this.renderer.getPixelRatio() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.lightPoints = new THREE.Points(geo, this.lightMat);
      this.lightPoints.frustumCulled = false;
      this.lightPoints.renderOrder = 5;
      this.scene.add(this.lightPoints);
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(townPos, 3));
      tg.setAttribute('color', new THREE.Float32BufferAttribute(townCol, 3));
      tg.setAttribute('size', new THREE.Float32BufferAttribute(townSize, 1));
      this.townMat = this.lightMat.clone();
      this.townMat.uniforms = THREE.UniformsUtils.clone(this.lightMat.uniforms);
      this.townLights = new THREE.Points(tg, this.townMat);
      this.townLights.frustumCulled = false;
      this.townLights.renderOrder = 5;
      this.scene.add(this.townLights);
    }

    buildNavaidSites() {
      const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
      for (const v of this.navaids) {
        if (v.type === 'VOR') {
          const g = new THREE.Group();
          const b = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 4, 16), white);
          b.position.y = 2;
          const c = new THREE.Mesh(new THREE.ConeGeometry(3, 5, 12), white);
          c.position.y = 6.5;
          g.add(b, c);
          g.position.copy(T3(v.n, v.e, this.terrain.groundHeight(v.n, v.e)));
          this.scene.add(g);
        } else if (v.type === 'LOC') {
          const g = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 1), new THREE.MeshLambertMaterial({ color: 0xcc3322 }));
          g.position.copy(T3(v.n, v.e, v.elev + 1.5));
          g.rotation.y = -v.course * DEG + Math.PI / 2;
          this.scene.add(g);
          if (v.gs) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), new THREE.MeshLambertMaterial({ color: 0xcc3322 }));
            m.position.copy(T3(v.gs.n, v.gs.e, v.elev + 7));
            this.scene.add(m);
          }
        }
      }
    }

    // ---------------- vegetation & towns ----------------
    buildTrees() {
      const T = this.terrain;
      const rnd = FS.rng(42);
      const mats = [];
      const MAX = 60000;
      let count = 0;
      const tries = 400000;
      for (let t = 0; t < tries && count < MAX; t++) {
        // bias toward the main airport area
        const rr = rnd() < 0.6 ? 16000 : 34000;
        const n = (rnd() - 0.5) * 2 * rr,
          e = (rnd() - 0.5) * 2 * rr;
        const f = T.forest(n, e);
        if (f < 0.35 || rnd() > f) continue;
        const h = T.height(n, e);
        if (h < 4 || h > 1050) continue;
        const gr = T.gradient(n, e);
        if (Math.hypot(gr.dn, gr.de) > 0.7) continue;
        if (T.nearAirport(n, e, 150)) continue;
        let inTown = false;
        for (const tw of TOWNS) if (Math.hypot(n - tw.n, e - tw.e) < tw.r) inTown = true;
        if (inTown) continue;
        const s = 0.8 + rnd() * 0.8;
        mats.push([e, h, -n, s, rnd()]);
        count++;
      }
      const cone = new THREE.ConeGeometry(4.2, 14, 6);
      cone.translate(0, 9, 0);
      const trunk = new THREE.CylinderGeometry(0.6, 0.8, 3, 5);
      trunk.translate(0, 1.5, 0);
      const mesh = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: 0xffffff }), mats.length);
      const tmesh = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x4a3a28 }), mats.length);
      const m4 = new THREE.Matrix4(),
        q = new THREE.Quaternion(),
        sc = new THREE.Vector3(),
        p = new THREE.Vector3(),
        col = new THREE.Color();
      mats.forEach((a, i) => {
        p.set(a[0], a[1] - 0.5, a[2]);
        sc.set(a[3], a[3] * (0.8 + a[4] * 0.6), a[3]);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a[4] * 6.28);
        m4.compose(p, q, sc);
        mesh.setMatrixAt(i, m4);
        tmesh.setMatrixAt(i, m4);
        const d = 0.7 + a[4] * 0.5;
        col.setRGB(0.13 * d, 0.27 * d, 0.1 * d);
        mesh.setColorAt(i, col);
      });
      this.scene.add(mesh, tmesh);
      this.trees = mesh;
    }

    buildTowns() {
      const T = this.terrain;
      const rnd = FS.rng(11);
      const list = [];
      for (const t of TOWNS) {
        const nB = Math.round(t.r * 0.45);
        for (let i = 0; i < nB; i++) {
          const a = rnd() * Math.PI * 2,
            r = Math.pow(rnd(), 0.8) * t.r;
          const n = t.n + Math.cos(a) * r,
            e = t.e + Math.sin(a) * r;
          const h = T.height(n, e);
          if (h < 2 || T.nearAirport(n, e, 120)) continue;
          const center = 1 - r / t.r;
          const hgt = 5 + rnd() * 8 + (center > 0.7 && rnd() < 0.3 ? rnd() * 35 : 0);
          list.push([n, e, h, 8 + rnd() * 14, hgt, 8 + rnd() * 14, rnd()]);
        }
      }
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0.5, 0);
      const mesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), list.length);
      const m4 = new THREE.Matrix4(),
        q = new THREE.Quaternion(),
        col = new THREE.Color();
      const palette = [0xd8d0c0, 0xc9b8a0, 0xe8e2d8, 0xa8a8a8, 0xb07560, 0xd0c8b8, 0x9aa0a8];
      list.forEach((b, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b[6] * Math.PI);
        m4.compose(new THREE.Vector3(b[1], b[2] - 1, -b[0]), q, new THREE.Vector3(b[3], b[4], b[5]));
        mesh.setMatrixAt(i, m4);
        col.setHex(palette[Math.floor(b[6] * 7)]);
        mesh.setColorAt(i, col);
      });
      this.scene.add(mesh);
    }

    // ---------------- precipitation ----------------
    buildRain() {
      const N = 3000;
      this.rainN = N;
      this.rainP = new Float32Array(N * 3);
      for (let i = 0; i < N * 3; i++) this.rainP[i] = (Math.random() - 0.5) * 80;
      const g = new THREE.BufferGeometry();
      this.rainPos = new THREE.BufferAttribute(new Float32Array(N * 6), 3);
      this.rainPos.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.rainPos);
      this.rainMat = new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.45, fog: false });
      this.rain = new THREE.LineSegments(g, this.rainMat);
      this.rain.frustumCulled = false;
      this.rain.visible = false;
      this.scene.add(this.rain);
    }

    // ---------------- clouds ----------------
    buildClouds(weather) {
      while (this.cloudGroup.children.length) {
        const c = this.cloudGroup.children.pop();
        c.geometry.dispose();
      }
      this.cloudVersion = weather.version;
      const puffs = [...weather.cloudField.allPuffs()];
      if (puffs.length) {
        const base = new THREE.PlaneGeometry(1, 1);
        const g = new THREE.InstancedBufferGeometry();
        g.index = base.index;
        g.attributes.position = base.attributes.position;
        g.attributes.uv = base.attributes.uv;
        const off = new Float32Array(puffs.length * 3),
          sc = new Float32Array(puffs.length),
          sh = new Float32Array(puffs.length),
          sd = new Float32Array(puffs.length);
        puffs.forEach(({ p }, i) => {
          off[i * 3] = p.e;
          off[i * 3 + 1] = p.alt;
          off[i * 3 + 2] = -p.n;
          sc[i] = p.r;
          sh[i] = p.shade;
          sd[i] = Math.random();
        });
        g.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
        g.setAttribute('scale', new THREE.InstancedBufferAttribute(sc, 1));
        g.setAttribute('shade', new THREE.InstancedBufferAttribute(sh, 1));
        g.setAttribute('seed', new THREE.InstancedBufferAttribute(sd, 1));
        g.instanceCount = puffs.length;
        this.cloudSort = { puffs: puffs.map(({ p }, i) => ({ x: p.e, y: p.alt, z: -p.n, r: p.r, sh: p.shade, sd: sd[i] })), off, sc, sh, sd, geo: g, last: null, t: 0 };
        this.cloudMat =
          this.cloudMat ||
          new THREE.ShaderMaterial({
            vertexShader: CLOUD_VS,
            fragmentShader: CLOUD_FS,
            uniforms: {
              map: { value: this.puffTex }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
              litColor: { value: new THREE.Color(1, 1, 1) }, darkColor: { value: new THREE.Color(0.55, 0.58, 0.63) },
            },
            transparent: true,
            depthWrite: false,
          });
        const m = new THREE.Mesh(g, this.cloudMat);
        m.frustumCulled = false;
        m.renderOrder = 10;
        this.cloudGroup.add(m);
      }
      // solid layers: base & top decks
      this.decks = [];
      const deckTex = canvasTex(256, 256, (gc, w, h) => {
        const nz = new FS.Noise(3);
        const img = gc.createImageData(w, h);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            // tileable-ish noise
            const v = 0.5 + 0.5 * nz.fbm(Math.cos((x / w) * 6.283) * 1.5 + 3, Math.sin((x / w) * 6.283) * 1.5 + (y / h) * 6, 4);
            const c = 190 + v * 65;
            const i = (y * w + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
            img.data[i + 3] = 255;
          }
        gc.putImageData(img, 0, 0);
      });
      deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
      deckTex.repeat.set(60, 60);
      for (const L of weather.layers) {
        if (!L.solid) continue;
        const pg = new THREE.PlaneGeometry(160000, 160000);
        pg.rotateX(-Math.PI / 2);
        const bot = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0x8c939c, map: deckTex, side: THREE.DoubleSide }));
        bot.position.y = L.base + 15;
        const top = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xffffff, map: deckTex, side: THREE.DoubleSide }));
        top.position.y = L.top - 15;
        this.cloudGroup.add(bot, top);
        this.decks.push({ bot, top, L });
      }
    }

    // ---------------- per-frame ----------------
    update(dt, st) {
      this.time += dt;
      const { camera, weather, ac, hours } = st;
      if (weather.version !== this.cloudVersion) this.buildClouds(weather);
      const cam = camera.position;
      const camN = -cam.z,
        camE = cam.x,
        camAlt = cam.y;

      // ---- sun & sky
      const lat = 40 * DEG,
        dec = 12 * DEG;
      const H = (hours - 12) * 15 * DEG;
      const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
      const el = Math.asin(sinEl);
      const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
      const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      this.sunDir = sunDir;
      this.sunEl = el;
      const day = FS.smoothstep(-0.12, 0.12, el);
      const golden = FS.smoothstep(0.35, 0.02, el) * FS.smoothstep(-0.1, 0.02, el);
      this.night = 1 - FS.smoothstep(-0.14, 0.02, el);
      // overcast / cloud cover above camera
      let cover = 0;
      for (const L of weather.layers) if (camAlt < L.top) cover = Math.max(cover, L.cover / 8);
      const overcast = FS.smoothstep(0.5, 1, cover);
      const inCloud = weather.cloudField.density(camN, camE, camAlt);
      const zen = new THREE.Color(0.2, 0.42, 0.82).lerp(new THREE.Color(0.012, 0.016, 0.04), 1 - day);
      const hor = new THREE.Color(0.68, 0.79, 0.93).lerp(new THREE.Color(1.0, 0.58, 0.32), golden * 0.8).lerp(new THREE.Color(0.03, 0.04, 0.08), 1 - day);
      const grey = new THREE.Color(0.62, 0.65, 0.7).multiplyScalar(0.25 + 0.75 * day);
      zen.lerp(grey, overcast * 0.9);
      hor.lerp(grey, overcast * 0.85);
      const vis = weather.visibilityAt(camN, camE, camAlt);
      this.visibility = vis;
      const fogCol = hor.clone().lerp(new THREE.Color(0.75, 0.77, 0.8).multiplyScalar(0.2 + 0.8 * day), FS.smoothstep(15000, 1500, vis) * 0.7);
      if (inCloud > 0) fogCol.lerp(new THREE.Color(0.85, 0.86, 0.88).multiplyScalar(0.15 + 0.85 * day * (1 - overcast * 0.3)), FS.smoothstep(0, 0.5, inCloud));
      const U = this.skyMat.uniforms;
      U.zenith.value.copy(zen);
      U.horizon.value.copy(hor);
      U.ground.value.copy(fogCol).multiplyScalar(0.8);
      U.sunDir.value.copy(sunDir);
      U.sunColor.value.setRGB(1, 0.9 - golden * 0.3, 0.8 - golden * 0.5);
      U.sunVis.value = (1 - overcast) * FS.smoothstep(-0.05, 0.02, el);
      U.haze.value = FS.clamp(FS.smoothstep(20000, 800, vis) + inCloud, 0, 1);
      U.hazeColor.value.copy(fogCol);
      this.sky.position.copy(cam);
      this.stars.position.copy(cam);
      this.starMat.opacity = this.night * (1 - overcast) * FS.smoothstep(3000, 15000, vis);

      this.scene.fog.color.copy(fogCol);
      this.scene.fog.density = 1.98 / Math.max(vis, 20);
      this.renderer.setClearColor(fogCol);

      const sunI = day * (1 - overcast * 0.7) * (1 - inCloud * 0.5);
      this.sun.intensity = 1.05 * sunI;
      this.sun.color.setRGB(1, 0.92 - golden * 0.25, 0.82 - golden * 0.45);
      this.sun.position.copy(cam).addScaledVector(sunDir, 5000);
      this.sun.target.position.copy(cam);
      this.hemi.intensity = 0.035 + 0.62 * day;
      this.hemi.color.copy(zen).lerp(new THREE.Color(1, 1, 1), 0.5);
      this.amb.intensity = 0.015 + 0.13 * day + 0.2 * overcast * day;
      this.waterMat.color.setRGB(0.11, 0.29, 0.4).multiplyScalar(0.3 + 0.7 * day);

      // ---- clouds: back-to-front sort of the billboards (periodically)
      const cs = this.cloudSort;
      if (cs && cs.puffs.length) {
        cs.t -= dt;
        const moved = !cs.last || cs.last.distanceTo(cam) > 150;
        if (moved || cs.t <= 0) {
          cs.t = 0.5;
          cs.last = cam.clone();
          for (const p of cs.puffs) p.d = (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2;
          cs.puffs.sort((a, b) => b.d - a.d);
          cs.puffs.forEach((p, i) => {
            cs.off[i * 3] = p.x;
            cs.off[i * 3 + 1] = p.y;
            cs.off[i * 3 + 2] = p.z;
            cs.sc[i] = p.r;
            cs.sh[i] = p.sh;
            cs.sd[i] = p.sd;
          });
          for (const k of ['offset', 'scale', 'shade', 'seed']) cs.geo.attributes[k].needsUpdate = true;
        }
      }
      if (this.cloudMat) {
        const cu = this.cloudMat.uniforms;
        cu.fogColor.value.copy(fogCol);
        cu.fogDensity.value = 1.98 / Math.max(weather.vis, 800);
        const lit = new THREE.Color(1, 0.99, 0.97).lerp(new THREE.Color(1, 0.7, 0.5), golden * 0.6).multiplyScalar((0.12 + 0.95 * day) * (1 - overcast * 0.25));
        cu.litColor.value.copy(lit);
        cu.darkColor.value.copy(lit).multiplyScalar(0.68);
      }
      if (this.decks)
        for (const d of this.decks) {
          const b = 0.1 + 0.9 * day;
          d.bot.material.color.setRGB(0.52 * b, 0.55 * b, 0.6 * b);
          d.top.material.color.setRGB(b, b * (1 - golden * 0.1), b * (1 - golden * 0.2));
          d.bot.position.x = d.top.position.x = cam.x;
          d.bot.position.z = d.top.position.z = cam.z;
          const off = d.bot.material.map.offset;
          off.set(cam.x / (160000 / 60), -cam.z / (160000 / 60));
          d.bot.visible = camAlt < d.L.base + 60;
          d.top.visible = camAlt > d.L.top - 60;
        }

      // ---- lights
      const lu = this.lightMat.uniforms;
      lu.fogDensity.value = this.scene.fog.density;
      lu.intensity.value = 0.35 + 0.65 * Math.max(this.night, FS.smoothstep(5000, 800, vis), overcast * 0.5);
      this.townMat.uniforms.fogDensity.value = this.scene.fog.density;
      this.townMat.uniforms.intensity.value = this.night;
      this.townLights.visible = this.night > 0.05;
      const col = this.lightColors.array;
      const base = this.lightBase;
      // threshold rows: green seen from approach side, red from the other side
      for (const t of this.thrLights) {
        const h = t.hdg * DEG;
        const along = (camN - t.thr.n) * Math.cos(h) + (camE - t.thr.e) * Math.sin(h);
        const green = along < 0;
        for (let k = 0; k < t.count; k++) {
          const i = (t.start + k) * 3;
          col[i] = green ? 0.2 : 1.0;
          col[i + 1] = green ? 1.0 : 0.12;
          col[i + 2] = green ? 0.3 : 0.08;
        }
      }
      // PAPI
      for (const P of this.papis) {
        const n0 = P.thr.n + P.an * P.pd,
          e0 = P.thr.e + P.ae * P.pd;
        const dist = Math.hypot(camN - n0, camE - e0);
        const ang = Math.atan2(camAlt - P.elev - 1, dist) * RAD;
        for (let k = 0; k < 4; k++) {
          const i = (P.base + k) * 3;
          const white = ang > P.ang[k];
          col[i] = 1;
          col[i + 1] = white ? 1 : 0.1;
          col[i + 2] = white ? 1 : 0.08;
        }
      }
      // sequenced flashers ("the rabbit"), 2 per second
      const ph = (this.time * 2) % 1;
      for (const f of this.flashers) {
        const want = 1 - (f.d - 300) / 420; // 0 at far end
        const on = Math.abs(ph - want * 0.9) < 0.04;
        const i = f.i * 3;
        col[i] = col[i + 1] = col[i + 2] = on ? 3 : 0;
      }
      // rotating beacons (white/green alternating)
      const bph = (this.time * 0.8) % 1;
      for (const bi of this.beacons) {
        const i = bi * 3;
        const on = bph < 0.12 || (bph > 0.5 && bph < 0.62);
        const green = bph > 0.5;
        const k = on ? (this.night > 0.3 ? 2.5 : 1) : 0;
        col[i] = green ? 0.1 * k : k;
        col[i + 1] = k;
        col[i + 2] = green ? 0.4 * k : k;
      }
      this.lightColors.needsUpdate = true;

      // ---- windsocks
      const wind = weather.meanWind(camAlt, 5);
      const wspd = Math.hypot(wind.n, wind.e);
      for (const w of this.windsocks) {
        const gust = weather.gust ? weather.gust.val : 0;
        const s = wspd + gust * 0.8;
        const dirTo = Math.atan2(wind.e, wind.n); // direction the air moves to
        w.pivot.rotation.order = 'YXZ';
        w.pivot.rotation.y = -dirTo;
        const ext = FS.clamp(s / 7.7, 0, 1); // fully extended at 15 kt
        w.pivot.rotation.x = -(1 - ext) * 1.2 + Math.sin(this.time * 3 + s) * 0.05;
      }

      // ---- precipitation
      const rainOn = weather.precip > 0.02 && weather.layers.length && camAlt < weather.layers[0].base + 50;
      this.rain.visible = !!rainOn;
      if (rainOn) {
        const snow = weather.atmosphere(camAlt).tempC < 0.5;
        const fall = snow ? 1.6 : 9;
        const N = Math.floor(this.rainN * FS.clamp(weather.precip * 1.4, 0.15, 1));
        const P = this.rainP,
          A = this.rainPos.array;
        const v = ac && ac.velNED ? ac.velNED : { x: 0, y: 0, z: 0 };
        const w3 = weather.meanWind(camAlt, 30);
        // velocity of drops relative to the camera (three coords)
        const rx = w3.e - v.y,
          ry = -fall + v.z,
          rz = -(w3.n - v.x);
        const sl = snow ? 0.02 : 0.035;
        for (let i = 0; i < this.rainN; i++) {
          const k = i * 3;
          P[k] += rx * dt;
          P[k + 1] += ry * dt;
          P[k + 2] += rz * dt;
          for (let a = 0; a < 3; a++) {
            if (P[k + a] > 40) P[k + a] -= 80;
            if (P[k + a] < -40) P[k + a] += 80;
          }
          const o = i * 6;
          if (i >= N) {
            A[o] = A[o + 1] = A[o + 2] = A[o + 3] = A[o + 4] = A[o + 5] = 1e6;
            continue;
          }
          A[o] = cam.x + P[k];
          A[o + 1] = cam.y + P[k + 1];
          A[o + 2] = cam.z + P[k + 2];
          A[o + 3] = A[o] - rx * sl;
          A[o + 4] = A[o + 1] - ry * sl - (snow ? 0.05 : 0);
          A[o + 5] = A[o + 2] - rz * sl;
        }
        this.rainPos.needsUpdate = true;
        this.rainMat.color.setRGB(snow ? 1 : 0.7, snow ? 1 : 0.75, snow ? 1 : 0.8).multiplyScalar(0.3 + 0.7 * day);
        this.rainMat.opacity = snow ? 0.8 : 0.45;
      }
    }
  }

  FS.Scenery = Scenery;
  FS.T3 = T3;
  FS.TOWNS = TOWNS;
})(typeof window !== 'undefined' ? window : globalThis);
