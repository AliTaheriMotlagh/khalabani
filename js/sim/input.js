/*
 * Pilot input: keyboard (with progressive deflection & auto-centering), mouse yoke, and gamepads/joysticks.
 */
(function (root) {
  'use strict';
  const FS = root.FS;

  class Input {
    constructor() {
      this.keys = new Set();
      this.axes = { pitch: 0, roll: 0, yaw: 0 };
      this.mouseYoke = false;
      this.mouse = { x: 0, y: 0 };
      this.gamepad = null;
      this.gpActive = false;
      this.gpThrottle = null;
      this.sensitivity = 1;
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        this.keys.add(e.code);
        if (this.onKey) this.onKey(e);
      });
      window.addEventListener('keyup', (e) => {
        this.keys.delete(e.code);
        if (this.onKeyUp) this.onKeyUp(e);
      });
      window.addEventListener('blur', () => this.keys.clear());
      window.addEventListener('mousemove', (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      });
      window.addEventListener('gamepadconnected', (e) => {
        this.gamepad = e.gamepad.index;
        if (this.onMessage) this.onMessage('Controller connected: ' + e.gamepad.id.slice(0, 40));
      });
      window.addEventListener('gamepaddisconnected', () => {
        this.gamepad = null;
        this.gpActive = false;
      });
    }

    down(...codes) {
      return codes.some((c) => this.keys.has(c));
    }

    // returns pilot commands; view = {w, h} of the 3D area for mouse yoke
    update(dt, view) {
      const A = this.axes;
      const k = (pos, neg) => (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0);
      const kp = k(['ArrowDown', 'KeyS'], ['ArrowUp', 'KeyW']);
      const kr = k(['ArrowRight', 'KeyD'], ['ArrowLeft', 'KeyA']);
      const ky = k(['KeyE'], ['KeyQ']);
      const move = (cur, tgt, rateIn, rateOut) => {
        const r = tgt === 0 ? rateOut : Math.sign(tgt) !== Math.sign(cur) && cur !== 0 ? rateOut + rateIn : rateIn;
        const d = tgt - cur;
        return Math.abs(d) < r * dt ? tgt : cur + Math.sign(d) * r * dt;
      };
      let pitch, roll, yaw;
      const s = this.sensitivity;
      A.pitch = move(A.pitch, kp * 0.85 * s, 1.1, 2.2);
      A.roll = move(A.roll, kr * 0.9 * s, 1.8, 3.0);
      A.yaw = move(A.yaw, ky, 2.0, 2.5);
      pitch = A.pitch;
      roll = A.roll;
      yaw = A.yaw;
      if (this.mouseYoke && view) {
        const mx = (this.mouse.x - view.w / 2) / (view.w * 0.35);
        const my = (this.mouse.y - view.h * 0.5) / (view.h * 0.35);
        if (!kr) roll = FS.clamp(mx, -1, 1);
        if (!kp) pitch = FS.clamp(my, -1, 1);
      }
      // gamepad / joystick
      let brake = null,
        throttle = null,
        throttleRate = 0;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = this.gamepad != null ? pads[this.gamepad] : [...pads].find((p) => p);
      if (gp) {
        const dz = (v) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
        const curve = (v) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
        const ax = gp.axes.map(dz);
        if (ax.some((v) => v !== 0) || gp.buttons.some((b) => b.pressed)) this.gpActive = true;
        if (this.gpActive) {
          if (gp.mapping === 'standard') {
            roll = curve(ax[0] || 0);
            pitch = curve(ax[1] || 0);
            if (ax[2]) yaw = curve(ax[2]);
            throttleRate = -(ax[3] || 0) * 0.5;
            const lt = gp.buttons[6] ? gp.buttons[6].value : 0,
              rt = gp.buttons[7] ? gp.buttons[7].value : 0;
            brake = Math.max(lt, rt);
          } else {
            roll = curve(ax[0] || 0);
            pitch = curve(ax[1] || 0);
            if (gp.axes.length > 2 && ax[2] !== undefined) throttle = FS.clamp((1 - gp.axes[2]) / 2, 0, 1);
            const rz = gp.axes.length > 5 ? ax[5] : gp.axes.length > 3 ? ax[3] : 0;
            if (rz) yaw = curve(rz);
            if (gp.buttons[0] && gp.buttons[0].pressed) brake = 1;
          }
        }
      }
      return { pitch, roll, yaw, brake, throttle, throttleRate };
    }
  }

  FS.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
