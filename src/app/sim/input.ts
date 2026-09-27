/*
 * Pilot input: keyboard (with progressive deflection & auto-centering), mouse yoke, gamepads/joysticks and the
 * on-screen touch stick. Also device detection and pointer (mouse / touch / pen) handling for clickable canvases.
 */
import { clamp } from '../core/math';

// ---- device detection: phones & tablets get the touch interface (iPadOS reports itself as a Mac)
const nav = (typeof window !== 'undefined' ? window.navigator : {}) as any;
const ua = nav.userAgent || '';
const touchPoints = nav.maxTouchPoints || 0;
const iPadOS = /Macintosh/.test(ua) && touchPoints > 1;
const ios = /iPhone|iPad|iPod/.test(ua) || iPadOS;
const mobileUA = ios || /Android|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua);
const coarse = !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches);
const mobile = mobileUA || (coarse && touchPoints > 0);
const shortSide = typeof screen !== 'undefined' ? Math.min(screen.width, screen.height) : 1000;

export const DEVICE = {
  mobile,
  ios,
  phone: mobile && shortSide < 600,
  tablet: mobile && shortSide >= 600,
  touch: touchPoints > 0 || ('ontouchstart' in (typeof window !== 'undefined' ? window : {})),
};

export function bindRegions(canvas: HTMLCanvasElement, hit: (x: number, y: number) => any, o: any = {}) {
  const active = new Map<number, any>();
  const STEP = 14;
  (canvas as any).style.touchAction = 'none';
  const click = (s: any, button: number) => (o.click ? o.click(s.r, s.d, s.rel, s.relY, button) : s.r.click(s.d, s.rel, s.relY, button));
  canvas.addEventListener('wheel', (e: WheelEvent) => {
    const r = hit((e as any).offsetX, (e as any).offsetY);
    if (r && r.wheel) {
      e.preventDefault();
      r.wheel(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    }
  }, { passive: false });
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (o.down) o.down(e);
    const r = hit((e as any).offsetX, (e as any).offsetY);
    if (!r) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const rel = ((e as any).offsetX - r.x) / r.w, relY = ((e as any).offsetY - r.y) / r.h;
    const s = { r, x: e.clientX, y: e.clientY, d: rel < 0.5 ? -1 : 1, rel, relY, acc: 0, moved: 0, knob: e.pointerType !== 'mouse' && !!r.wheel && !r.drag };
    active.set(e.pointerId, s);
    if (!s.knob && r.click) click(s, e.button);
  });
  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && o.hover) {
      const r = hit((e as any).offsetX, (e as any).offsetY);
      (canvas as any).style.cursor = r ? 'pointer' : 'default';
      o.hover(r);
    }
    const s = active.get(e.pointerId);
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    s.x = e.clientX; s.y = e.clientY;
    s.moved += Math.abs(dx) + Math.abs(dy);
    if (s.r.drag) s.r.drag(dx, dy);
    else if (s.knob) {
      s.acc += dx - dy;
      while (Math.abs(s.acc) >= STEP) {
        const k = Math.sign(s.acc);
        s.r.wheel(k, false);
        s.acc -= k * STEP;
      }
    }
  });
  const end = (e: PointerEvent) => {
    const s = active.get(e.pointerId);
    if (!s) return;
    active.delete(e.pointerId);
    if (s.r.release) s.r.release();
    if (s.knob && s.moved < 10 && e.type === 'pointerup') {
      if (s.r.click) click(s, 0);
      else s.r.wheel(s.d, false);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export class Input {
  keys: Set<string>;
  axes: { pitch: number; roll: number; yaw: number };
  mouseYoke: boolean;
  mouse: { x: number; y: number };
  gamepad: number | null;
  gpActive: boolean;
  gpThrottle: any;
  sensitivity: number;
  touch: any;
  onKey?: (e: any) => void;
  onKeyUp?: (e: any) => void;
  onMessage?: (msg: string) => void;

  constructor() {
    this.keys = new Set();
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.mouseYoke = false;
    this.mouse = { x: 0, y: 0 };
    this.gamepad = null;
    this.gpActive = false;
    this.gpThrottle = null;
    this.sensitivity = 1;
    this.touch = null;
    window.addEventListener('keydown', (e) => {
      if (e.target && ((e.target as any).tagName === 'INPUT' || (e.target as any).tagName === 'SELECT')) return;
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
    window.addEventListener('gamepadconnected', (e: any) => {
      this.gamepad = e.gamepad.index;
      if (this.onMessage) this.onMessage('Controller connected: ' + e.gamepad.id.slice(0, 40));
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepad = null;
      this.gpActive = false;
    });
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number, view: any): any {
    const A = this.axes;
    const k = (pos: string[], neg: string[]) => (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0);
    const kp = k(['ArrowDown', 'KeyS'], ['ArrowUp', 'KeyW']);
    const kr = k(['ArrowRight', 'KeyD'], ['ArrowLeft', 'KeyA']);
    const ky = k(['KeyE'], ['KeyQ']);
    const move = (cur: number, tgt: number, rateIn: number, rateOut: number) => {
      const r = tgt === 0 ? rateOut : Math.sign(tgt) !== Math.sign(cur) && cur !== 0 ? rateOut + rateIn : rateIn;
      const d = tgt - cur;
      return Math.abs(d) < r * dt ? tgt : cur + Math.sign(d) * r * dt;
    };
    let pitch: number, roll: number, yaw: number;
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
      if (!kr) roll = clamp(mx, -1, 1);
      if (!kp) pitch = clamp(my, -1, 1);
    }
    let brake: number | null = null, throttle: number | null = null, throttleRate = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = this.gamepad != null ? pads[this.gamepad] : [...pads].find((p) => p);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
      const curve = (v: number) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
      const ax = (gp.axes as any).map(dz);
      if (ax.some((v: number) => v !== 0) || gp.buttons.some((b) => b.pressed)) this.gpActive = true;
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
          if (gp.axes.length > 2 && ax[2] !== undefined) throttle = clamp((1 - gp.axes[2]) / 2, 0, 1);
          const rz = gp.axes.length > 5 ? ax[5] : gp.axes.length > 3 ? ax[3] : 0;
          if (rz) yaw = curve(rz);
          if (gp.buttons[0] && gp.buttons[0].pressed) brake = 1;
        }
      }
    }
    if (this.touch) {
      const curve = (v: number) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
      if (!kp) pitch = clamp(curve(this.touch.pitch) * s, -1, 1);
      if (!kr) roll = clamp(curve(this.touch.roll) * s, -1, 1);
    }
    return { pitch, roll, yaw, brake, throttle, throttleRate };
  }
}
