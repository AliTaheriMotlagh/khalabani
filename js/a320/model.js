/*
 * 3D Airbus A320 in Iran Air livery (white fuselage, dark-blue tail with the white Homa bird, "IRAN AIR" titles).
 * Built from primitives + canvas-painted textures. Animated: ailerons, spoilers, flaps, slats, elevators, rudder,
 * gear retraction, engine fans, reversers; nav/strobe/beacon/landing/taxi/logo lights.
 * Model space: +X right wing, +Y up, -Z forward; origin at the CG (~ 25 % MAC). Length 37.6 m, span 35.8 m.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG } = FS.U;
  const NAVY = '#1c2f63';

  // Stylised Homa (griffin-like bird of Persian mythology) drawn with bezier paths
  function drawHoma(g, cx, cy, s, col) {
    g.save();
    g.translate(cx, cy);
    g.scale(s, s);
    g.fillStyle = col;
    g.beginPath();
    // body & neck
    g.moveTo(-10, 40);
    g.bezierCurveTo(-30, 20, -28, -10, -8, -28);
    g.bezierCurveTo(0, -36, 10, -40, 16, -48); // neck up to head
    g.bezierCurveTo(22, -56, 34, -56, 38, -48); // head
    g.lineTo(48, -46); // beak
    g.lineTo(38, -40);
    g.bezierCurveTo(30, -36, 24, -30, 20, -20);
    g.bezierCurveTo(16, -8, 18, 6, 26, 18); // breast
    g.bezierCurveTo(30, 28, 22, 40, 10, 44);
    g.closePath();
    g.fill();
    // raised wing (stylised feathers)
    g.beginPath();
    g.moveTo(-6, -8);
    g.bezierCurveTo(-30, -40, -46, -70, -44, -96);
    g.bezierCurveTo(-30, -80, -16, -70, -2, -64);
    g.bezierCurveTo(-10, -56, -12, -44, -8, -34);
    g.bezierCurveTo(2, -44, 12, -52, 20, -58);
    g.bezierCurveTo(8, -40, 0, -24, -6, -8);
    g.closePath();
    g.fill();
    // tail feathers
    g.beginPath();
    g.moveTo(-14, 30);
    g.bezierCurveTo(-40, 40, -60, 60, -70, 86);
    g.bezierCurveTo(-50, 72, -34, 64, -20, 60);
    g.bezierCurveTo(-36, 74, -44, 90, -46, 104);
    g.bezierCurveTo(-26, 86, -10, 70, 0, 50);
    g.closePath();
    g.fill();
    // legs
    g.fillRect(-6, 40, 5, 22);
    g.fillRect(6, 40, 5, 22);
    g.fillRect(-10, 60, 12, 4);
    g.fillRect(4, 60, 12, 4);
    g.restore();
  }
  FS.drawHoma = drawHoma;

  function tex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  class A320Model {
    constructor(scene, reg) {
      this.scene = scene;
      this.reg = reg || 'EP-IEB';
      this.root = new THREE.Group();
      this.body = new THREE.Group();
      this.root.add(this.body);
      const phong = (o) => new THREE.MeshPhongMaterial(Object.assign({ shininess: 60, specular: 0x444444 }, o));
      const white = phong({ color: 0xf5f5f3 });
      const grey = phong({ color: 0xb8bcc2 });
      const dark = phong({ color: 0x2a2c30 });
      const navy = phong({ color: 0x1c2f63 });
      const metal = phong({ color: 0x9aa0a6, shininess: 90 });
      const tyre = phong({ color: 0x151515, shininess: 5 });
      this.mat = { white, grey, dark, navy };

      // ---------------- fuselage (lathe) with painted livery
      const L = 37.57,
        Rf = 1.98,
        noseZ = -17.0;
      const prof = [];
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const z = (i / N) * L; // from nose (0) to tail (L)
        let r;
        if (z < 6) r = Rf * Math.pow(Math.sin((z / 6) * Math.PI * 0.5), 0.65);
        else if (z < 26) r = Rf;
        else r = Rf * (1 - Math.pow((z - 26) / (L - 26), 1.6) * 0.9);
        prof.push(new THREE.Vector2(Math.max(r, 0.05), z));
      }
      const fg = new THREE.LatheGeometry(prof, 48);
      // lathe: axis = Y, profile x = radius. Rotate so Y->Z (nose at -Z)
      fg.rotateX(Math.PI / 2);
      fg.translate(0, 0, noseZ);
      // upsweep of tail cone and flattened belly
      const p = fg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i) - noseZ;
        if (z > 26) {
          const k = (z - 26) / (L - 26);
          p.setY(i, p.getY(i) + k * k * 1.6);
        }
        if (z < 4) p.setY(i, p.getY(i) - (1 - z / 4) * 0.35);
      }
      fg.computeVertexNormals();
      const livery = tex(2048, 256, (g, w, h) => {
        // u = around circumference (0 at bottom?), v = along length. Lathe uv: u along circumference, v along profile
        g.fillStyle = '#f6f6f4';
        g.fillRect(0, 0, w, h);
        // belly grey
        g.fillStyle = '#c9ccd1';
        g.fillRect(0, 0, w, h * 0.0);
        void NAVY;
      });
      this.bodyTex = this.paintFuselage();
      const fus = new THREE.Mesh(fg, phong({ map: this.bodyTex, shininess: 70 }));
      this.body.add(fus);
      void livery;
      // cockpit windows
      const cwG = new THREE.BoxGeometry(2.2, 0.45, 1.2);
      const cw = new THREE.Mesh(cwG, phong({ color: 0x0c1218, shininess: 120, specular: 0x8899aa }));
      cw.position.set(0, 0.95, noseZ + 2.45);
      cw.rotation.x = -0.45;
      this.body.add(cw);

      // ---------------- wings (swept, with sharklets)
      this.wings = new THREE.Group();
      this.root.add(this.wings);
      this.ailerons = [];
      this.flapsG = [];
      this.slatsG = [];
      this.spoilers = [];
      const wingY = -0.9,
        rootZ = -1.4;
      for (const sd of [-1, 1]) {
        const half = new THREE.Group();
        half.position.set(sd * 1.8, wingY, rootZ);
        half.rotation.z = sd * 5 * DEG; // dihedral
        this.wings.add(half);
        const span = 15.8,
          cRoot = 6.2,
          cTip = 1.6,
          sweep = Math.tan(25 * DEG);
        const shape = new THREE.BufferGeometry();
        const t0 = 0.28,
          t1 = 0.12;
        const V = [
          // root LE, root TE, tip TE, tip LE (top & bottom)
          [0, t0 / 2, 0], [0, t0 / 2, cRoot], [sd * span, t1 / 2, span * sweep + cTip], [sd * span, t1 / 2, span * sweep],
          [0, -t0 / 2, 0], [0, -t0 / 2, cRoot], [sd * span, -t1 / 2, span * sweep + cTip], [sd * span, -t1 / 2, span * sweep],
        ];
        const idx = sd > 0 ? [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7] : [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 7, 3, 0, 4, 7, 1, 6, 5, 1, 2, 6, 3, 6, 2, 3, 7, 6];
        shape.setAttribute('position', new THREE.Float32BufferAttribute(V.flat(), 3));
        shape.setIndex(idx);
        shape.computeVertexNormals();
        const wing = new THREE.Mesh(shape, grey);
        half.add(wing);
        // sharklet
        const sh = new THREE.BoxGeometry(0.08, 2.4, 1.4);
        sh.translate(0, 1.1, 0);
        const shm = new THREE.Mesh(sh, white);
        shm.position.set(sd * (span + 0.05), 0.05, span * sweep + cTip * 0.55);
        shm.rotation.x = -0.35;
        shm.rotation.z = -sd * 0.18;
        half.add(shm);
        // sharklet Homa-blue tip
        const shTop = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.7, 0.9), navy);
        shTop.position.set(0, 1.9, -0.25);
        shm.add(shTop);
        // control surfaces along trailing edge
        const teAt = (s) => s * sweep + FS.lerp(cRoot, cTip, s / span);
        const addSurf = (s0, s1, chord, list, m) => {
          const piv = new THREE.Group();
          const z0 = teAt(s0) - 0.02;
          piv.position.set(sd * s0, 0, z0);
          const len = s1 - s0;
          const dz = teAt(s1) - teAt(s0);
          const g = new THREE.BoxGeometry(len, 0.07, chord);
          g.translate((sd * len) / 2, 0, chord / 2);
          const mesh = new THREE.Mesh(g, m || grey);
          piv.add(mesh);
          piv.rotation.y = -sd * Math.atan2(dz, len);
          half.add(piv);
          list.push({ piv, sd });
          return piv;
        };
        addSurf(1.0, 5.2, 1.6, this.flapsG);
        addSurf(5.6, 11.8, 1.1, this.flapsG);
        addSurf(12.2, 15.2, 0.8, this.ailerons);
        // spoilers (5 per side) on the upper surface ahead of the flaps
        for (let k = 0; k < 5; k++) {
          const s0 = 2.2 + k * 2.0;
          const piv = new THREE.Group();
          const z = teAt(s0) - 1.7;
          piv.position.set(sd * s0, t0 / 2 - k * 0.02 + 0.03, z);
          const g = new THREE.BoxGeometry(1.8, 0.04, 0.9);
          g.translate((sd * 1.8) / 2, 0, 0.45);
          piv.add(new THREE.Mesh(g, grey));
          piv.rotation.y = -sd * Math.atan2(sweep * 1.8, 1.8) * 0.4;
          half.add(piv);
          this.spoilers.push({ piv, sd, k });
        }
        // slats (leading edge)
        for (const [s0, s1] of [[2.5, 8.5], [8.8, 15.2]]) {
          const piv = new THREE.Group();
          piv.position.set(sd * s0, 0, s0 * sweep);
          const len = s1 - s0;
          const g = new THREE.BoxGeometry(len, 0.12, 0.45);
          g.translate((sd * len) / 2, 0, -0.2);
          piv.add(new THREE.Mesh(g, grey));
          piv.rotation.y = -sd * Math.atan2(sweep * len, len);
          half.add(piv);
          this.slatsG.push({ piv, sd });
        }
        // wing lights (nav red left / green right) + strobes handled via point sprites
      }
      // ---------------- engines (CFM56) under the wings
      this.fans = [];
      this.reversers = [];
      for (const sd of [-1, 1]) {
        const eg = new THREE.Group();
        eg.position.set(sd * 5.75, -1.6, -3.5);
        this.root.add(eg);
        const nac = new THREE.CylinderGeometry(1.05, 0.9, 4.2, 28, 1, true);
        nac.rotateX(Math.PI / 2);
        const nm = new THREE.Mesh(nac, phong({ color: 0xf2f2f0, side: THREE.DoubleSide }));
        eg.add(nm);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.08, 8, 28), metal);
        lip.position.z = -2.1;
        eg.add(lip);
        // navy engine band with Homa-blue
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1.06, 1.06, 0.5, 28, 1, true), navy);
        band.rotateX(Math.PI / 2);
        band.position.z = -1.2;
        eg.add(band);
        const fan = new THREE.Group();
        fan.position.z = -1.7;
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), phong({ color: 0x33363a }));
        fan.add(disc);
        for (let k = 0; k < 12; k++) {
          const bl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.04), metal);
          bl.position.y = 0.45;
          const pv = new THREE.Group();
          pv.rotation.z = (k / 12) * Math.PI * 2;
          bl.rotation.y = 0.5;
          pv.add(bl);
          fan.add(pv);
        }
        const spin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 16), metal);
        spin.rotation.x = -Math.PI / 2;
        spin.position.z = -0.3;
        fan.add(spin);
        eg.add(fan);
        this.fans.push(fan);
        const noz = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 16), dark);
        noz.rotation.x = Math.PI / 2;
        noz.position.z = 2.6;
        eg.add(noz);
        // reverser cowl sections (translate aft)
        const rev = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.92, 0.9, 28, 1, true), phong({ color: 0xe6e6e4, side: THREE.DoubleSide }));
        rev.rotateX(Math.PI / 2);
        rev.position.z = 1.6;
        eg.add(rev);
        this.reversers.push(rev);
        // pylon
        const py = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 3.8), white);
        py.position.set(0, 0.75, 0.8);
        eg.add(py);
      }
      // ---------------- tail: vertical fin with Iran Air tail art, horizontal stabilizer
      const finTex = tex(512, 512, (g, w, h) => {
        g.fillStyle = NAVY;
        g.fillRect(0, 0, w, h);
        drawHoma(g, w * 0.5, h * 0.52, 1.75, '#ffffff');
      });
      const finShape = new THREE.Shape();
      finShape.moveTo(0, 0);
      finShape.lineTo(6.2, 0);
      finShape.lineTo(6.8, 6.0);
      finShape.lineTo(4.7, 6.0);
      finShape.closePath();
      const finG = new THREE.ExtrudeGeometry(finShape, { depth: 0.3, bevelEnabled: false });
      // UVs from the shape x/y extent
      const fp = finG.attributes.position,
        fuv = finG.attributes.uv;
      for (let i = 0; i < fp.count; i++) fuv.setXY(i, fp.getX(i) / 7, fp.getY(i) / 6.2);
      finG.rotateY(-Math.PI / 2);
      finG.translate(0.15, 0, 0);
      this.finMat = phong({ map: finTex, shininess: 80 });
      const fin = new THREE.Mesh(finG, this.finMat);
      fin.position.set(0, 1.5, 11.6);
      this.body.add(fin);
      this.finMesh = fin;
      this.rudPiv = new THREE.Group();
      this.rudPiv.position.set(0, 1.6, 17.9);
      const rud = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.4, 0.9), navy);
      rud.position.set(0, 2.95, 0.3);
      rud.rotation.x = -0.08;
      this.rudPiv.add(rud);
      this.body.add(this.rudPiv);
      this.elevs = [];
      const planform = (sd, span, cr, ct, sweepDeg, th, m) => {
        const sw = Math.tan(sweepDeg * DEG);
        const V = [
          [0, th / 2, 0], [0, th / 2, cr], [sd * span, th / 3, span * sw + ct], [sd * span, th / 3, span * sw],
          [0, -th / 2, 0], [0, -th / 2, cr], [sd * span, -th / 3, span * sw + ct], [sd * span, -th / 3, span * sw],
        ];
        const idx = sd > 0 ? [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7] : [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 7, 3, 0, 4, 7, 1, 6, 5, 1, 2, 6, 3, 6, 2, 3, 7, 6];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(V.flat(), 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, m);
      };
      for (const sd of [-1, 1]) {
        const hs = new THREE.Group();
        hs.position.set(sd * 0.3, 1.25, 13.6);
        hs.rotation.z = sd * 6 * DEG;
        this.body.add(hs);
        hs.add(planform(sd, 6.0, 3.3, 1.3, 32, 0.22, grey));
        // elevator along the trailing edge
        const piv = new THREE.Group();
        piv.position.set(0, 0, 3.25);
        const el = planform(sd, 5.8, 0.9, 0.5, 28, 0.08, grey);
        piv.add(el);
        hs.add(piv);
        this.elevs.push(piv);
        this.ths = this.ths || [];
        this.ths.push(hs);
      }
      // wing-to-body fairing & belly
      const fair = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 9), grey);
      fair.position.set(0, -1.45, -0.5);
      this.body.add(fair);
      // ---------------- landing gear
      const wheel = new THREE.CylinderGeometry(0.57, 0.57, 0.38, 20);
      wheel.rotateZ(Math.PI / 2);
      const nwheel = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 16);
      nwheel.rotateZ(Math.PI / 2);
      this.mains = [];
      for (const sd of [-1, 1]) {
        const gg = new THREE.Group();
        gg.position.set(sd * 3.8, -1.2, 1.3);
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.3, 10), metal);
        strut.position.y = -0.7;
        strut.scale.y = 0.65;
        gg.add(strut);
        for (const o of [-0.4, 0.4]) {
          const w2 = new THREE.Mesh(wheel, tyre);
          w2.position.set(o, -1.43, 0);
          gg.add(w2);
        }
        this.root.add(gg);
        gg.userData.sd = sd;
        this.mains.push(gg);
      }
      this.nose = new THREE.Group();
      this.nose.position.set(0, -1.2, -11.0);
      const ns = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.9, 10), metal);
      ns.position.y = -0.75;
      this.nose.add(ns);
      for (const o of [-0.22, 0.22]) {
        const w3 = new THREE.Mesh(nwheel, tyre);
        w3.position.set(o, -1.52, 0);
        this.nose.add(w3);
      }
      this.root.add(this.nose);
      // ---------------- lights (point sprites) and spot lights
      const lp = [
        [-17.3, -0.3, 1.4, 1, 0.1, 0.1], [17.3, -0.3, 1.4, 0.1, 1, 0.2], [0, 1.6, 18.8, 1, 1, 1], // nav
        [0, 2.05, 0, 1, 0.1, 0.1], [0, -2.0, 1, 1, 0.1, 0.1], // beacons top/bottom
        [-17.3, -0.3, 1.9, 1, 1, 1], [17.3, -0.3, 1.9, 1, 1, 1], [0, 1.8, 19, 1, 1, 1], // strobes
        [-4.5, -1.2, -2.5, 1, 1, 0.95], [4.5, -1.2, -2.5, 1, 1, 0.95], // landing
        [0, -2.4, -11.2, 1, 1, 0.9], // nose taxi
      ];
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(lp.flatMap((l) => l.slice(0, 3)), 3));
      this.lpCol = new THREE.Float32BufferAttribute(lp.flatMap((l) => l.slice(3)), 3);
      this.lpBase = lp.map((l) => l.slice(3));
      pg.setAttribute('color', this.lpCol);
      this.sprites = new THREE.Points(pg, new THREE.PointsMaterial({ size: 12, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: FS.glowTexture() }));
      this.sprites.frustumCulled = false;
      this.root.add(this.sprites);
      this.landL = new THREE.SpotLight(0xfff6e8, 0, 1500, 10 * DEG, 0.4, 1);
      this.landL.position.set(-3, -1.2, -3);
      this.landL.target.position.set(-3, -30, -300);
      this.taxiL = new THREE.SpotLight(0xfff6e8, 0, 300, 25 * DEG, 0.5, 1);
      this.taxiL.position.set(0, -2.4, -11.3);
      this.taxiL.target.position.set(0, -8, -60);
      this.logoL = new THREE.PointLight(0xffffff, 0, 14, 2);
      this.logoL.position.set(0, 4.5, 11);
      this.root.add(this.landL, this.landL.target, this.taxiL, this.taxiL.target, this.logoL);
      // cockpit interior for the outside cockpit view: glareshield, window frames, sidesticks, thrust levers
      this.interior = new THREE.Group();
      const im = phong({ color: 0x3a3e44, shininess: 10 });
      const glare = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 0.9), phong({ color: 0x1e2023, shininess: 5 }));
      glare.position.set(0, 0.18, -15.3);
      this.interior.add(glare);
      const panelM = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.2), im);
      panelM.position.set(0, -0.35, -15.2);
      this.interior.add(panelM);
      // DUs as dark screens
      for (let k = 0; k < 4; k++) {
        const du = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ color: 0x06121e }));
        du.position.set(-1.05 + k * 0.7, -0.3, -15.09);
        this.interior.add(du);
      }
      for (const sd of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.06), im);
        post.position.set(sd * 1.02, 0.78, -15.55);
        post.rotation.z = sd * 0.22;
        post.rotation.x = -0.45;
        this.interior.add(post);
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 1.6), im);
        side.position.set(sd * 1.45, -0.6, -14.2);
        this.interior.add(side);
      }
      const cpost = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.6, 0.05), im);
      cpost.position.set(0, 0.72, -15.75);
      cpost.rotation.x = -0.5;
      this.interior.add(cpost);
      // sidestick (captain, left console)
      this.stick = new THREE.Group();
      this.stick.position.set(-1.45, -0.42, -14.0);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 12), phong({ color: 0x111111 }));
      this.stick.add(base);
      this.stickGrip = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 8), phong({ color: 0x222222 }));
      shaft.position.y = 0.06;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.14, 10), phong({ color: 0x2b2b2b }));
      grip.position.set(0, 0.17, 0.01);
      grip.rotation.x = 0.25;
      const redB = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), phong({ color: 0xcc2222 }));
      redB.position.set(-0.02, 0.24, 0.0);
      this.stickGrip.add(shaft, grip, redB);
      this.stick.add(this.stickGrip);
      this.interior.add(this.stick);
      // thrust levers on the pedestal
      this.tl = [];
      for (const sd of [-1, 1]) {
        const lv = new THREE.Group();
        lv.position.set(sd * 0.07, -0.55, -14.6);
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), phong({ color: 0xdddddd }));
        h.position.y = 0.1;
        lv.add(h);
        this.interior.add(lv);
        this.tl.push(lv);
      }
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 1.2), im);
      ped.position.set(0, -0.75, -14.3);
      this.interior.add(ped);
      this.root.add(this.interior);
      // shadow
      const sc = document.createElement('canvas');
      sc.width = sc.height = 256;
      const g = sc.getContext('2d');
      g.filter = 'blur(4px)';
      g.fillStyle = '#000';
      g.fillRect(122, 10, 12, 236); // fuselage
      g.beginPath();
      g.moveTo(128, 110);
      g.lineTo(8, 150);
      g.lineTo(12, 162);
      g.lineTo(128, 140);
      g.lineTo(244, 162);
      g.lineTo(248, 150);
      g.closePath();
      g.fill();
      g.fillRect(90, 225, 76, 14);
      const sg = new THREE.PlaneGeometry(38, 38);
      sg.rotateX(-Math.PI / 2);
      this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      this.shadow.renderOrder = 3;
      scene.add(this.shadow);
      scene.add(this.root);
      // the CG sits ~3 m above the gear contact points; model origin = CG
      this.t = 0;
    }

    paintFuselage() {
      // LatheGeometry UVs after our rotation: u = 0 belly, 0.25 right side, 0.5 crown, 0.75 left side;
      // v = 0 at the nose, 1 at the tail. Canvas y = (1 - v) * h because of flipY.
      const reg = this.reg;
      return tex(1024, 2048, (g, w, h) => {
        const X = (u) => u * w,
          Y = (v) => (1 - v) * h;
        g.fillStyle = '#f7f7f5';
        g.fillRect(0, 0, w, h);
        // light-grey belly
        g.fillStyle = '#d0d3d8';
        g.fillRect(0, 0, X(0.09), h);
        g.fillRect(X(0.91), 0, X(0.09), h);
        const side = (uc, right) => {
          // passenger windows along the cabin
          g.fillStyle = '#1b2530';
          for (let v = 0.2; v < 0.76; v += 0.0142) g.fillRect(X(uc) - w * 0.006, Y(v) - h * 0.004, w * 0.012, h * 0.0075);
          // cockpit side windows
          g.fillStyle = '#10161c';
          g.fillRect(X(uc) - w * 0.025, Y(0.085), w * 0.05, h * 0.028);
          // doors (fwd, overwing exits, aft)
          g.strokeStyle = '#98a0a8';
          g.lineWidth = 2;
          for (const v of [0.155, 0.43, 0.46, 0.82]) g.strokeRect(X(uc) - w * 0.03, Y(v) - h * 0.012, w * 0.06, h * (v > 0.4 && v < 0.5 ? 0.012 : 0.024));
          const title = (text, v, size, font) => {
            g.save();
            g.translate(X(uc + (right ? 0.05 : -0.05)), Y(v));
            g.rotate(right ? Math.PI / 2 : -Math.PI / 2);
            g.scale(1, 0.5);
            g.fillStyle = NAVY;
            g.font = `bold ${size}px ${font}`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(text, 0, 0);
            g.restore();
          };
          title('IRAN AIR', 0.33, w * 0.07, 'Arial, sans-serif');
          title('ایران ایر', 0.56, w * 0.066, 'Tahoma, Arial, sans-serif');
          // registration on the aft fuselage
          g.save();
          g.translate(X(uc - (right ? 0.02 : -0.02)), Y(0.87));
          g.rotate(right ? Math.PI / 2 : -Math.PI / 2);
          g.scale(1, 0.6);
          g.fillStyle = '#333';
          g.font = `bold ${w * 0.028}px Arial`;
          g.textAlign = 'center';
          g.fillText(reg, 0, 0);
          g.restore();
          // small Homa near the forward door
          g.save();
          g.translate(X(uc + (right ? 0.05 : -0.05)), Y(0.2));
          g.rotate(right ? Math.PI / 2 : -Math.PI / 2);
          g.scale(right ? 1 : -1, 0.55);
          FS.drawHoma(g, 0, 0, 0.3, NAVY);
          g.restore();
        };
        side(0.25, true);
        side(0.75, false);
      });
    }

    update(dt, ac, terrain, sunDir, night, view) {
      this.t += dt;
      const p = ac.pos,
        q = ac.q;
      this.root.position.set(p.y, -p.z, -p.x);
      this.root.quaternion.set(q.y, -q.z, -q.x, q.w);
      const inCockpit = view === 'panel' || view === 'wide';
      this.body.visible = !inCockpit;
      this.interior.visible = view === 'wide';
      this.fans.forEach((f) => (f.parent.visible = !inCockpit || view === 'wide'));
      // surfaces
      for (const a of this.ailerons) a.piv.rotation.x = -a.sd * ac.surf.ail * 25 * DEG;
      const fd = (ac.flap / 40) * 35 * DEG;
      for (const f of this.flapsG) {
        f.piv.rotation.x = fd;
        f.piv.children[0].position.z = (ac.flap / 40) * 0.8;
      }
      for (const s of this.slatsG) {
        s.piv.rotation.x = (ac.slat / 27) * 20 * DEG;
        s.piv.children[0].position.z = -0.2 - (ac.slat / 27) * 0.35;
      }
      for (const s of this.spoilers) {
        const a = ac.surf.spl[s.k + (s.sd > 0 ? 5 : 0)] || 0;
        s.piv.rotation.x = -a * DEG;
      }
      for (const e of this.elevs) e.rotation.x = -ac.surf.elev;
      if (this.ths) for (const h of this.ths) h.rotation.x = -ac.ths * DEG * 0.5;
      this.rudPiv.rotation.y = -ac.surf.rud * 30 * DEG;
      // gear retraction (mains fold inboard, nose forward)
      const gp = ac.gearPos;
      for (const m of this.mains) {
        m.rotation.z = -m.userData.sd * (1 - gp) * 88 * DEG;
        m.visible = gp > 0.02;
        // oleo compression
        const i = m.userData.sd < 0 ? 1 : 2;
        m.position.y = -1.2 + Math.min(ac.gearForce[i] / 1.45e6, 0.35);
      }
      this.nose.rotation.x = -(1 - gp) * 95 * DEG;
      this.nose.visible = gp > 0.02;
      this.nose.rotation.y = ac.onGround ? -ac.ctl.rudder * 0.5 : 0;
      // fans & reversers
      ac.eng.forEach((e, i) => {
        this.fans[i].rotation.z += (e.n1 / 100) * 80 * dt;
        this.reversers[i].position.z = 1.6 + e.rev * 0.9;
      });
      // lights
      const L = ac.lights,
        pw = ac.hasPower();
      const c = this.lpCol.array;
      const set = (i, on) => {
        for (let k = 0; k < 3; k++) c[i * 3 + k] = on ? this.lpBase[i][k] : 0;
      };
      const tt = this.t;
      set(0, pw && L.nav);
      set(1, pw && L.nav);
      set(2, pw && L.nav);
      set(3, pw && L.beacon && tt % 1.0 < 0.1);
      set(4, pw && L.beacon && (tt + 0.5) % 1.0 < 0.1);
      const strobe = pw && L.strobe && (tt % 1.2 < 0.05 || (tt % 1.2 > 0.12 && tt % 1.2 < 0.16));
      set(5, strobe);
      set(6, strobe);
      set(7, strobe);
      set(8, pw && L.landing);
      set(9, pw && L.landing);
      set(10, pw && L.taxi && gp > 0.9);
      this.lpCol.needsUpdate = true;
      this.sprites.material.size = 8 + 10 * night;
      this.landL.intensity = pw && L.landing ? 3 : 0;
      this.taxiL.intensity = pw && L.taxi && gp > 0.9 ? 2 : 0;
      this.logoL.intensity = pw && L.logo ? 1.5 * night : 0;
      this.finMat.emissive = this.finMat.emissive || new THREE.Color();
      this.finMat.emissive.setScalar(pw && L.logo ? 0.35 * night : 0);
      // interior sidestick & thrust levers
      if (this.interior.visible) {
        this.stickGrip.rotation.x = -ac.ctl.stickPitch * 0.35;
        this.stickGrip.rotation.z = -ac.ctl.stickRoll * 0.35;
        this.tl.forEach((lv, i) => (lv.rotation.x = -(ac.ctl.tla[i] / 45) * 0.8 + 0.2));
      }
      // shadow
      const gh = terrain.groundHeight(p.x, p.y);
      const agl = -p.z - gh;
      const sd = sunDir && sunDir.y > 0.05 ? sunDir : new THREE.Vector3(0, 1, 0);
      const sn = p.x + (sd.z / sd.y) * agl,
        se = p.y + (-sd.x / sd.y) * agl;
      this.shadow.position.set(se, terrain.groundHeight(sn, se) + 0.3, -sn);
      this.shadow.rotation.y = -ac.heading * DEG;
      this.shadow.visible = agl < 800 && sunDir && sunDir.y > 0.05;
      this.shadow.material.opacity = 0.45 * FS.clamp(1 - agl / 800, 0, 1) * (1 - night);
    }

    dispose() {
      this.scene.remove(this.root);
      this.scene.remove(this.shadow);
    }
  }

  // simple traffic aircraft (low-detail A320 silhouette in another livery)
  class TrafficModel {
    constructor(scene, color) {
      const g = new THREE.Group();
      const m = new THREE.MeshPhongMaterial({ color: color || 0xe8e8e8 });
      const f = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 34, 12), m);
      f.rotation.x = Math.PI / 2;
      g.add(f);
      const w = new THREE.Mesh(new THREE.BoxGeometry(34, 0.3, 4), m);
      w.position.set(0, -0.8, 1);
      g.add(w);
      const tp = new THREE.Mesh(new THREE.BoxGeometry(11, 0.2, 2.2), m);
      tp.position.set(0, 1, 15);
      g.add(tp);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 3.5), new THREE.MeshPhongMaterial({ color: 0xc03030 }));
      fin.position.set(0, 3.5, 15);
      g.add(fin);
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.9, 4, 12), m);
        e.rotation.x = Math.PI / 2;
        e.position.set(s * 5.7, -2, -2);
        g.add(e);
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute([-17, -0.8, 1, 17, -0.8, 1, 0, 2, 0, 0, -2, 0], 3));
      pg.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.1, 0.1, 0.1, 1, 0.2, 1, 0.1, 0.1, 1, 1, 1], 3));
      this.lights = new THREE.Points(pg, new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: FS.glowTexture() }));
      g.add(this.lights);
      scene.add(g);
      this.root = g;
      this.scene = scene;
    }
    update(t) {
      this.root.position.set(t.e, t.alt, -t.n);
      this.root.rotation.set(0, -t.hdg * DEG, 0, 'YXZ');
      this.root.rotateX(-t.pitch || 0);
    }
    dispose() {
      this.scene.remove(this.root);
    }
  }

  FS.A320Model = A320Model;
  FS.TrafficModel = TrafficModel;
})(typeof window !== 'undefined' ? window : globalThis);
