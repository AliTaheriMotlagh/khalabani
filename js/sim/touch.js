/*
 * On-screen touch controls for phones and tablets: a virtual stick (pitch/roll), rudder buttons, a thrust lever with
 * detents, a toolbar and aircraft-specific action buttons. Buttons send the same key codes as the keyboard, so every
 * action goes through the normal key handling in main.js.
 *
 * Button spec: { label, key, shift?, hold?, repeat?, on?: () => bool, fn?: () => void, title? }
 *   hold   — key stays pressed while the finger is down (brakes, trim, starter…)
 *   repeat — key is re-sent while held (OBS / heading bug)
 */
(function (root) {
  'use strict';
  const FS = root.FS;

  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  class TouchControls {
    // env: { input, lever: { get() → 0..1, set(frac), marks() → [[frac, label]] } }
    constructor(container, env) {
      this.root = container;
      this.env = env;
      this.input = env.input;
      this.enabled = false;
      this.showSticks = true;
      this.buttons = [];
      const bar = (this.bar = el('div', 't-bar', container));
      this.barMain = el('div', 't-row', bar);
      this.moreBtn = this.button(bar, { label: '⋯', title: 'More controls', fn: () => this.toggleMore() });
      if (document.fullscreenEnabled || document.webkitFullscreenEnabled) this.button(bar, { label: '⛶', title: 'Full screen', fn: () => TouchControls.toggleFullscreen() });
      this.more = el('div', 't-more hidden', container);
      // left: stick + rudder
      const left = (this.left = el('div', 't-left', container));
      this.stick = el('div', 't-stick', left);
      this.knob = el('div', 't-knob', this.stick);
      const rud = el('div', 't-col', left);
      this.button(rud, { label: '◀ RUD', key: 'KeyQ', hold: true, title: 'Left rudder / nosewheel' });
      this.button(rud, { label: 'RUD ▶', key: 'KeyE', hold: true, title: 'Right rudder / nosewheel' });
      // right: action buttons + thrust lever
      const right = (this.right = el('div', 't-right', container));
      this.quick = el('div', 't-col t-quick', right);
      this.lever = el('div', 't-lever', right);
      this.leverMarks = el('div', 't-marks', this.lever);
      this.handle = el('div', 't-handle', this.lever);
      this.bindStick();
      this.bindLever();
      container.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    static toggleFullscreen() {
      const d = document,
        fs = d.fullscreenElement || d.webkitFullscreenElement;
      if (fs) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else {
        const e = d.documentElement,
          req = e.requestFullscreen || e.webkitRequestFullscreen;
        if (!req) return;
        const p = req.call(e);
        // Android: keep the sim in landscape while full screen
        if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
      }
    }

    setEnabled(on) {
      this.enabled = on;
      document.body.classList.toggle('touch-ui', on);
      this.root.classList.toggle('hidden', !on);
      if (!on) this.input.touch = null;
    }

    // bar: toolbar buttons, quick: next to the thrust lever, more: the ⋯ drawer
    setButtons({ bar, quick, more }) {
      this.buttons = this.buttons.filter((b) => b.fixed);
      for (const box of [this.barMain, this.quick, this.more]) box.innerHTML = '';
      bar.forEach((b) => this.button(this.barMain, b));
      quick.forEach((b) => this.button(this.quick, b));
      more.forEach((b) => this.button(this.more, b));
      this.drawMarks();
    }

    button(parent, b) {
      const e = el('button', 't-btn', parent, b.label);
      if (b.title) e.title = b.title;
      const inp = this.input;
      const inMore = parent === this.more;
      let timer = null;
      const send = () => inp.onKey && inp.onKey({ code: b.key, key: '', shiftKey: !!b.shift, repeat: false, preventDefault() {}, target: document.body });
      const down = (ev) => {
        ev.preventDefault();
        try {
          e.setPointerCapture(ev.pointerId);
        } catch (_) {}
        e.classList.add('down');
        if (b.fn) return b.fn();
        if (b.shift) inp.keys.add('ShiftLeft');
        if (b.hold) inp.keys.add(b.key);
        else send();
        if (b.repeat) timer = setTimeout(function rep() {
          send();
          timer = setTimeout(rep, 70);
        }, 350);
        if (!b.hold && !b.repeat && b.shift) inp.keys.delete('ShiftLeft');
        if (inMore && !b.hold && !b.repeat) setTimeout(() => this.toggleMore(false), 150); // one-shot actions close the drawer
      };
      const up = () => {
        e.classList.remove('down');
        clearTimeout(timer);
        if (b.fn) return;
        if (b.hold) inp.keys.delete(b.key);
        if (b.shift) inp.keys.delete('ShiftLeft');
      };
      e.addEventListener('pointerdown', down);
      e.addEventListener('pointerup', up);
      e.addEventListener('pointercancel', up);
      const rec = { b, e, fixed: parent === this.bar || parent.parentNode === this.left };
      this.buttons.push(rec);
      return rec;
    }

    toggleMore(open) {
      const o = open != null ? open : this.more.classList.contains('hidden');
      this.more.classList.toggle('hidden', !o);
      this.moreBtn.e.classList.toggle('on', o);
    }

    bindStick() {
      const st = this.stick;
      let id = null;
      const set = (ev) => {
        const r = st.getBoundingClientRect();
        const R = r.width / 2;
        let x = (ev.clientX - r.left - R) / (R * 0.8),
          y = (ev.clientY - r.top - R) / (R * 0.8);
        const m = Math.hypot(x, y);
        if (m > 1) (x /= m), (y /= m);
        this.input.touch = { roll: x, pitch: y };
        this.knob.style.transform = `translate(${x * R * 0.8}px, ${y * R * 0.8}px)`;
      };
      st.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (id != null) return;
        id = ev.pointerId;
        try {
          st.setPointerCapture(id);
        } catch (_) {}
        st.classList.add('active');
        set(ev);
      });
      st.addEventListener('pointermove', (ev) => ev.pointerId === id && set(ev));
      const end = (ev) => {
        if (ev.pointerId !== id) return;
        id = null;
        st.classList.remove('active');
        this.input.touch = null;
        this.knob.style.transform = '';
      };
      st.addEventListener('pointerup', end);
      st.addEventListener('pointercancel', end);
    }

    // relative drag: touching the lever never makes the thrust jump
    bindLever() {
      const lv = this.lever;
      let drag = null;
      lv.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        try {
          lv.setPointerCapture(ev.pointerId);
        } catch (_) {}
        drag = { id: ev.pointerId, y: ev.clientY, f: this.env.lever.get() };
        lv.classList.add('active');
      });
      lv.addEventListener('pointermove', (ev) => {
        if (!drag || ev.pointerId !== drag.id) return;
        const h = lv.clientHeight - this.handle.offsetHeight;
        drag.f = FS.clamp(drag.f - (ev.clientY - drag.y) / Math.max(40, h), 0, 1);
        drag.y = ev.clientY;
        this.env.lever.set(drag.f);
        this.placeHandle();
      });
      const end = (ev) => {
        if (!drag || ev.pointerId !== drag.id) return;
        drag = null;
        lv.classList.remove('active');
      };
      lv.addEventListener('pointerup', end);
      lv.addEventListener('pointercancel', end);
    }

    drawMarks() {
      this.leverMarks.innerHTML = '';
      for (const [f, label] of this.env.lever.marks()) {
        const m = el('div', 't-mark', this.leverMarks, label);
        m.style.bottom = `calc(var(--hh) / 2 + (100% - var(--hh)) * ${f.toFixed(3)})`;
      }
    }

    placeHandle() {
      const f = FS.clamp(this.env.lever.get(), 0, 1);
      this.handle.style.bottom = `calc((100% - var(--hh)) * ${f.toFixed(3)})`;
    }

    // ph: instrument panel height; side: free margin beside the panel on phones (stick & lever go there)
    layout({ W, H, ph, side, hideSticks }) {
      const s = this.root.style;
      const size = side ? side - 16 : Math.round(FS.clamp(Math.min(H - ph - 24, W * 0.2), 84, 150));
      s.setProperty('--stick', size + 'px');
      s.setProperty('--pb', (side ? 0 : ph) + 'px');
      s.setProperty('--ph', ph + 'px');
      s.setProperty('--side', side + 'px');
      this.root.classList.toggle('side', !!side);
      this.root.classList.toggle('above', ph > 0 && (!!side || H - ph < 220)); // short screen: button rows just above the panel
      this.root.classList.toggle('no-sticks', !this.showSticks || !!hideSticks);
    }

    // popups: { mcdu, ovhd } — open pop-up panels push the stick / lever out of the way
    update(visible, popups = {}) {
      this.root.classList.toggle('hidden', !this.enabled || !visible);
      if (!this.enabled || !visible) return;
      this.root.classList.toggle('pop-right', !!(popups.mcdu || popups.ovhd));
      this.root.classList.toggle('pop-left', !!popups.ovhd);
      for (const { b, e } of this.buttons) if (b.on) e.classList.toggle('on', !!b.on());
      this.placeHandle();
    }
  }

  FS.TouchControls = TouchControls;
})(typeof window !== 'undefined' ? window : globalThis);
