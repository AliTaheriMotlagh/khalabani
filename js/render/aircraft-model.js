/*
 * Cessna 172-style 3D model built from primitives, with animated control surfaces, propeller, lights,
 * plus the camera rig (cockpit, chase, tower, fly-by) and ground shadow.
 * Model space: +X right wing, +Y up, -Z forward (nose), origin at the CG.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG } = FS.U;

  function mat(color, opts) {
    return new THREE.MeshPhongMaterial(Object.assign({ color, shininess: 40, specular: 0x333333 }, opts || {}));
  }

  class AircraftModel {
    constructor(scene) {
      this.scene = scene;
      this.root = new THREE.Group();
      this.body = new THREE.Group(); // parts hidden in cockpit view
      this.root.add(this.body);
      const white = mat(0xf4f4f2),
        blue = mat(0x1d3d7a),
        red = mat(0xb02020),
        dark = mat(0x222428),
        glass = mat(0x223344, { transparent: true, opacity: 0.55, shininess: 100, specular: 0xaaaaaa }),
        metal = mat(0x999999),
        tyre = mat(0x111111);
      this.mats = { white, blue };
      const B = this.body;
      const add = (g, m, x, y, z, parent) => {
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(x, y, z);
        (parent || B).add(mesh);
        return mesh;
      };
      // fuselage: cabin
      add(new THREE.BoxGeometry(1.12, 1.25, 2.4), white, 0, 0.35, 0.1);
      // cowling
      // nose parts stay visible from the cockpit
      this.nose = new THREE.Group();
      this.root.add(this.nose);
      const cowl = new THREE.CylinderGeometry(0.4, 0.52, 1.35, 18);
      cowl.rotateX(Math.PI / 2);
      add(cowl, white, 0, -0.04, -1.72, this.nose);
      const spinner = new THREE.ConeGeometry(0.18, 0.4, 14);
      spinner.rotateX(-Math.PI / 2);
      this.spinner = add(spinner, white, 0, -0.04, -2.58, this.nose);
      // tailcone (tapered, top flat-ish)
      const tail = new THREE.CylinderGeometry(0.16, 0.6, 4.0, 14);
      tail.rotateX(Math.PI / 2);
      const tc = add(tail, white, 0, 0.42, 3.3);
      tc.scale.set(1, 1.05, 1);
      // stripes
      add(new THREE.BoxGeometry(1.14, 0.1, 2.4), blue, 0, 0.0, 0.1);
      add(new THREE.BoxGeometry(1.14, 0.05, 2.4), red, 0, 0.08, 0.1);
      // windows
      add(new THREE.BoxGeometry(1.14, 0.55, 1.5), glass, 0, 0.62, 0.05);
      const ws = new THREE.BoxGeometry(1.0, 0.65, 0.05);
      const wsm = add(ws, glass, 0, 0.72, -1.0);
      wsm.rotation.x = -0.9;
      add(new THREE.BoxGeometry(0.9, 0.35, 0.05), glass, 0, 0.72, 1.35).rotation.x = 0.5;
      // wings (visible from cockpit, so parented to root)
      const W = new THREE.Group();
      this.root.add(W);
      this.ailerons = [];
      this.flaps = [];
      for (const s of [-1, 1]) {
        const half = new THREE.Group();
        half.position.set(s * 0.56, 1.02, 0);
        half.rotation.z = s * 1.5 * DEG;
        W.add(half);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.16, 1.2), white);
        wing.position.set(s * 2.45, 0, -0.1);
        half.add(wing);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 1.4), white);
        tip.position.set(s * 4.95, 0, 0.0);
        half.add(tip);
        // flap (inboard) and aileron (outboard) hinged at the trailing edge region
        const flapPivot = new THREE.Group();
        flapPivot.position.set(s * 1.4, 0, 0.5);
        const flap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.38), white);
        flap.position.set(0, 0, 0.19);
        flapPivot.add(flap);
        half.add(flapPivot);
        this.flaps.push(flapPivot);
        const ailPivot = new THREE.Group();
        ailPivot.position.set(s * 3.9, 0, 0.5);
        const ail = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.36), white);
        ail.position.set(0, 0, 0.18);
        ailPivot.add(ail);
        half.add(ailPivot);
        this.ailerons.push({ pivot: ailPivot, side: s });
        // struts
        const st = new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6);
        const strut = new THREE.Mesh(st, white);
        const a = new THREE.Vector3(s * 0.55, -0.25, 0.0),
          b = new THREE.Vector3(s * 2.55, 0.95, 0.0);
        strut.position.copy(a).add(b).multiplyScalar(0.5);
        strut.lookAt(b.clone().add(this.root.position));
        strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        W.add(strut);
        // nav lights
        const nl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: s < 0 ? 0xff2020 : 0x20ff40 }));
        nl.position.set(s * 5.05, 0.02, -0.4);
        half.add(nl);
      }
      this.wings = W;
      // horizontal stabilizer + elevator
      add(new THREE.BoxGeometry(3.4, 0.07, 0.8), white, 0, 0.55, 5.0);
      this.elevPivot = new THREE.Group();
      this.elevPivot.position.set(0, 0.55, 5.4);
      const elev = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 0.45), white);
      elev.position.set(0, 0, 0.22);
      this.elevPivot.add(elev);
      B.add(this.elevPivot);
      // vertical fin + rudder
      const finShape = new THREE.Shape();
      finShape.moveTo(0, 0);
      finShape.lineTo(1.3, 0);
      finShape.lineTo(1.25, 1.45);
      finShape.lineTo(0.75, 1.45);
      finShape.lineTo(-0.3, 0.2);
      const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.07, bevelEnabled: false });
      fin.rotateY(-Math.PI / 2);
      fin.translate(0.035, 0, 0);
      add(fin, white, 0, 0.6, 4.1);
      this.rudPivot = new THREE.Group();
      this.rudPivot.position.set(0, 0.62, 5.38);
      const rud = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.45, 0.42), white);
      rud.position.set(0, 0.72, 0.2);
      this.rudPivot.add(rud);
      B.add(this.rudPivot);
      add(new THREE.BoxGeometry(0.08, 0.3, 0.8), blue, 0, 1.2, 5.0);
      // gear
      const wheelG = new THREE.CylinderGeometry(0.25, 0.25, 0.14, 14);
      wheelG.rotateZ(Math.PI / 2);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.12), metal);
        leg.position.set(s * 0.95, -0.62, 0.42);
        leg.rotation.z = s * 0.75;
        B.add(leg);
        add(wheelG, tyre, s * 1.25, -0.97, 0.42);
        const pant = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), white);
        pant.scale.set(0.55, 0.9, 1.9);
        pant.position.set(s * 1.25, -0.9, 0.42);
        B.add(pant);
      }
      this.noseStrut = add(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), metal, 0, -0.65, -1.2);
      this.noseWheel = add(wheelG, tyre, 0, -1.03, -1.2);
      const npant = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), white);
      npant.scale.set(0.5, 0.85, 1.7);
      npant.position.set(0, -0.96, -1.2);
      B.add(npant);
      // propeller
      this.prop = new THREE.Group();
      this.prop.position.set(0, -0.04, -2.44);
      this.nose.add(this.prop);
      const blade = new THREE.BoxGeometry(0.1, 0.95, 0.03);
      blade.translate(0, 0.5, 0);
      for (const r of [0, Math.PI]) {
        const bl = new THREE.Mesh(blade, dark);
        bl.rotation.z = r;
        this.prop.add(bl);
      }
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.97, 32), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      disc.position.set(0, -0.04, -2.45);
      this.disc = disc;
      this.nose.add(disc);
      // interior visible in the outside-cockpit view: glareshield, dashboard, window frame
      this.interior = new THREE.Group();
      this.root.add(this.interior);
      const dashM = new THREE.MeshLambertMaterial({ color: 0x1c1d20 });
      add(new THREE.BoxGeometry(1.15, 0.5, 0.35), dashM, 0, 0.22, -0.95, this.interior);
      const gs = add(new THREE.BoxGeometry(1.15, 0.05, 0.3), mat(0x121314), 0, 0.49, -0.92, this.interior);
      gs.rotation.x = 0.1;
      const frameM = new THREE.MeshLambertMaterial({ color: 0x8a8a86 });
      for (const s of [-1, 1]) {
        const post = add(new THREE.BoxGeometry(0.035, 0.75, 0.05), frameM, s * 0.56, 0.8, -0.84, this.interior);
        post.rotation.x = -0.75;
      }
      add(new THREE.BoxGeometry(1.15, 0.06, 0.08), frameM, 0, 1.0, -0.55, this.interior);
      add(new THREE.BoxGeometry(0.03, 0.03, 0.35), frameM, 0, 0.98, -0.5, this.interior); // compass mount
      // beacon, tail light
      this.beacon = add(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }), 0, 2.08, 5.3);
      add(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0.45, 5.9);

      // light sprites (points visible from afar)
      const lp = [
        [-5.1, 1.02, -0.4, 1, 0.1, 0.1], [5.1, 1.02, -0.4, 0.1, 1, 0.2], [0, 0.45, 5.95, 1, 1, 1], // nav
        [0, 2.1, 5.3, 1, 0.1, 0.1], // beacon
        [-5.1, 1.02, -0.2, 1, 1, 1], [5.1, 1.02, -0.2, 1, 1, 1], // strobes
        [-2.4, 0.95, -0.72, 1, 1, 0.9], // landing light
      ];
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(lp.flatMap((l) => l.slice(0, 3)), 3));
      this.lpCol = new THREE.Float32BufferAttribute(lp.flatMap((l) => l.slice(3)), 3);
      this.lpBase = lp.map((l) => l.slice(3));
      pg.setAttribute('color', this.lpCol);
      this.lightSprites = new THREE.Points(pg, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: FS.glowTexture() }));
      this.lightSprites.frustumCulled = false;
      this.root.add(this.lightSprites);

      // landing light
      this.landing = new THREE.SpotLight(0xfff4e0, 0, 900, 12 * DEG, 0.5, 1.2);
      this.landing.position.set(-2.4, 0.95, -0.8);
      this.landing.target.position.set(-2.4, -8, -60);
      this.root.add(this.landing, this.landing.target);

      // shadow
      const sc = document.createElement('canvas');
      sc.width = sc.height = 128;
      const g = sc.getContext('2d');
      g.filter = 'blur(3px)';
      g.fillStyle = 'rgba(0,0,0,1)';
      g.fillRect(64 - 58, 52, 116, 12); // wing
      g.fillRect(58, 20, 12, 90); // fuselage
      g.fillRect(64 - 18, 102, 36, 8); // stab
      const st = new THREE.CanvasTexture(sc);
      const sg = new THREE.PlaneGeometry(11.8, 11.8);
      sg.rotateX(-Math.PI / 2);
      this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: st, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      this.shadow.renderOrder = 3;
      scene.add(this.shadow);

      scene.add(this.root);
      this.propAngle = 0;
      this.t = 0;
    }

    update(dt, ac, terrain, sunDir, night, cockpit) {
      this.t += dt;
      const p = ac.pos;
      this.root.position.set(p.y, -p.z, -p.x);
      const q = ac.q;
      this.root.quaternion.set(q.y, -q.z, -q.x, q.w);
      this.body.visible = !cockpit;
      this.interior.visible = cockpit === 'wide';
      this.nose.visible = cockpit !== 'panel';
      // control surfaces
      for (const a of this.ailerons) a.pivot.rotation.x = a.side * ac.ctl.aileron * 15 * DEG;
      for (const f of this.flaps) f.rotation.x = -ac.flapDeg * DEG;
      const e = ac.ctl.elevator;
      this.elevPivot.rotation.x = (e >= 0 ? e * 28 : e * 23) * DEG + ac.ctl.trim * 4 * DEG;
      this.rudPivot.rotation.y = -ac.ctl.rudder * 16 * DEG;
      // propeller
      const rpm = ac.eng.rpm;
      this.propAngle += (rpm / 60) * 2 * Math.PI * dt;
      if (rpm > 400) {
        // strobe-like visual so the blades don't look frozen
        this.prop.rotation.z = this.propAngle * 0.013 + this.t * 3.1;
        this.prop.children.forEach((b) => (b.visible = false));
        this.disc.material.opacity = cockpit ? 0.035 : FS.clamp(rpm / 3000, 0.08, 0.22);
        this.disc.visible = !cockpit;
      } else {
        this.prop.rotation.z = this.propAngle;
        this.prop.children.forEach((b) => (b.visible = true));
        this.disc.visible = false;
      }
      this.spinner.rotation.z = this.prop.rotation.z;
      // lights
      const L = ac.lights,
        pw = ac.hasPower();
      const c = this.lpCol.array;
      const set = (i, on) => {
        for (let k = 0; k < 3; k++) c[i * 3 + k] = on ? this.lpBase[i][k] : 0;
      };
      set(0, pw && L.nav);
      set(1, pw && L.nav);
      set(2, pw && L.nav);
      set(3, pw && L.beacon && this.t % 1.2 < 0.12);
      const strobe = pw && L.strobe && (this.t % 1.1 < 0.05 || (this.t % 1.1 > 0.12 && this.t % 1.1 < 0.16));
      set(4, strobe);
      set(5, strobe);
      set(6, pw && L.landing);
      this.lpCol.needsUpdate = true;
      this.lightSprites.material.size = 6 + 8 * night;
      this.beacon.material.color.setHex(pw && L.beacon && this.t % 1.2 < 0.12 ? 0xff3030 : 0x551010);
      this.landing.intensity = pw && L.landing ? 2.2 : 0;
      // shadow on ground
      const gh = terrain.groundHeight(p.x, p.y);
      const agl = -p.z - gh;
      const sd = sunDir && sunDir.y > 0.05 ? sunDir : new THREE.Vector3(0, 1, 0);
      const offN = (sd.z / sd.y) * agl,
        offE2 = (-sd.x / sd.y) * agl; // shadow is displaced away from the sun
      const sn = p.x + offN,
        se = p.y + offE2;
      this.shadow.position.set(se, terrain.groundHeight(sn, se) + 0.25, -sn);
      this.shadow.rotation.y = -ac.heading * DEG;
      this.shadow.visible = agl < 400 && sunDir && sunDir.y > 0.05;
      this.shadow.material.opacity = 0.45 * FS.clamp(1 - agl / 400, 0, 1) * (1 - night);
    }
  }

  // soft round glow texture
  let glow = null;
  FS.glowTexture = function () {
    if (glow) return glow;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    glow = new THREE.CanvasTexture(c);
    return glow;
  };

  // ---------------- camera rig ----------------
  const VIEWS = ['cockpit', 'cockpit-wide', 'chase', 'tower', 'flyby'];

  class CameraRig {
    constructor(camera) {
      this.camera = camera;
      this.view = 'cockpit';
      this.lookYaw = 0;
      this.lookPitch = -6 * DEG;
      this.orbitYaw = 0;
      this.orbitPitch = 12 * DEG;
      this.dist = 22;
      this.chasePos = null;
      this.flyby = null;
      this.shake = new THREE.Vector3();
      this.zoom = 1;
    }
    cycle(dir = 1) {
      const i = VIEWS.indexOf(this.view);
      this.set(VIEWS[(i + dir + VIEWS.length) % VIEWS.length]);
    }
    set(v) {
      this.view = v;
      this.flyby = null;
      this.chasePos = null;
      if (v.startsWith('cockpit')) {
        this.lookYaw = 0;
        this.lookPitch = v === 'cockpit' ? -4 * DEG : -8 * DEG;
      }
      this.zoom = 1;
    }
    get isCockpit() {
      return this.view.startsWith('cockpit');
    }
    drag(dx, dy) {
      if (this.isCockpit) {
        this.lookYaw = FS.clamp(this.lookYaw - dx * 0.004, -Math.PI * 0.95, Math.PI * 0.95);
        this.lookPitch = FS.clamp(this.lookPitch - dy * 0.004, -1.2, 1.2);
      } else {
        this.orbitYaw -= dx * 0.006;
        this.orbitPitch = FS.clamp(this.orbitPitch + dy * 0.005, -1.2, 1.45);
      }
    }
    wheel(d) {
      if (this.isCockpit || this.view === 'tower' || this.view === 'flyby') this.zoom = FS.clamp(this.zoom * (d > 0 ? 1.1 : 0.9), 0.3, 1.6);
      else this.dist = FS.clamp(this.dist * (d > 0 ? 1.12 : 0.89), 8, 400);
    }
    snap(yawDeg, pitchDeg) {
      this.lookYaw = yawDeg * DEG;
      this.lookPitch = (pitchDeg || -5) * DEG;
    }
    update(dt, ac, model, terrain, fovBase) {
      const cam = this.camera;
      const q = new THREE.Quaternion(ac.q.y, -ac.q.z, -ac.q.x, ac.q.w);
      const pos = new THREE.Vector3(ac.pos.y, -ac.pos.z, -ac.pos.x);
      // buffet / turbulence / ground roughness shake
      const sh = ac.buffet * 0.02 + ac.rough * 0.015 + (ac.env && ac.env.weather ? Math.min(ac.env.weather.lastSigma || 0, 4) * 0.0015 : 0);
      this.shake.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.5);
      let fov = fovBase;
      if (this.isCockpit) {
        const eye = new THREE.Vector3(-0.3, 0.82, -0.3).add(this.shake);
        // head moves with g-load a bit
        eye.y -= FS.clamp((ac.gload - 1) * 0.015, -0.03, 0.05);
        cam.position.copy(eye.applyQuaternion(q).add(pos));
        const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'));
        cam.quaternion.copy(q).multiply(look);
        fov = fovBase * this.zoom;
      } else if (this.view === 'chase') {
        const hdg = Math.atan2(ac.velNED ? ac.velNED.y : 0, ac.velNED ? ac.velNED.x : 1);
        const useHdg = ac.gs > 3 ? -ac.heading * DEG : -ac.heading * DEG;
        const yaw = useHdg + this.orbitYaw;
        const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.orbitPitch), Math.sin(this.orbitPitch), Math.cos(yaw) * Math.cos(this.orbitPitch)).multiplyScalar(this.dist);
        const target = pos.clone().add(off);
        if (!this.chasePos) this.chasePos = target.clone();
        this.chasePos.lerp(target, FS.lagK(dt, 0.25));
        const gh = terrain.groundHeight(-this.chasePos.z, this.chasePos.x);
        if (this.chasePos.y < gh + 1.5) this.chasePos.y = gh + 1.5;
        cam.position.copy(this.chasePos);
        cam.up.set(0, 1, 0);
        cam.lookAt(pos.clone().add(new THREE.Vector3(0, 1, 0)));
        void hdg;
      } else if (this.view === 'tower') {
        let best = null,
          bd = 1e12;
        for (const ap of FS.AIRPORTS) {
          const d = Math.hypot(ap.n - ac.pos.x, ap.e - ac.pos.y);
          if (d < bd) {
            bd = d;
            best = ap;
          }
        }
        const tv = best.towerView;
        cam.position.set(tv.e, tv.alt, -tv.n);
        cam.up.set(0, 1, 0);
        cam.lookAt(pos);
        const dist = cam.position.distanceTo(pos);
        fov = FS.clamp(Math.atan2(35, dist) * 2 * FS.U.RAD, 1.5, 60) * this.zoom;
      } else if (this.view === 'flyby') {
        if (!this.flyby || cam.position.distanceTo(pos) > 600) {
          const v = ac.velNED || { x: 0, y: 0, z: 0 };
          const fwd = new THREE.Vector3(v.y, -v.z, -v.x);
          if (fwd.length() < 5) fwd.set(0, 0, -1).applyQuaternion(q);
          fwd.normalize();
          const side = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
          const p = pos.clone().addScaledVector(fwd, 300).addScaledVector(side, 25);
          const gh = terrain.groundHeight(-p.z, p.x);
          p.y = Math.max(p.y - 5, gh + 2);
          this.flyby = p;
        }
        cam.position.copy(this.flyby);
        cam.up.set(0, 1, 0);
        cam.lookAt(pos);
        fov = 45 * this.zoom;
      }
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }
  }

  FS.AircraftModel = AircraftModel;
  FS.CameraRig = CameraRig;
  FS.VIEWS = VIEWS;
})(typeof window !== 'undefined' ? window : globalThis);
