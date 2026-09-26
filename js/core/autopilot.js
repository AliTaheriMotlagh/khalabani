/*
 * Two-axis autopilot modelled on the Bendix/King KAP 140.
 *   Lateral : ROL (wing leveller), HDG (heading bug), NAV (VOR/LOC track), APR (LOC + glideslope), REV (back course)
 *   Vertical: VS (vertical speed hold), ALT (altitude hold / capture of the preselected altitude), GS (glideslope)
 * It drives the aileron and elevator servos and runs the electric pitch trim, so a disconnect leaves the airplane trimmed.
 */
(function (root) {
  'use strict';
  const FS = root.FS;
  const { DEG, RAD, FPM, FT } = FS.U;

  class Autopilot {
    constructor() {
      this.on = false;
      this.lateral = 'ROL';
      this.vertical = 'VS';
      this.armLat = null; // 'NAV' | 'APR' | 'REV'
      this.armGS = false;
      this.armAlt = true;
      this.hdgBug = 0;
      this.altSel = 3000; // ft
      this.vsSel = 0; // fpm
      this.altHold = 0;
      this.pitchInt = 0;
      this.navInt = 0;
      this.alert = 0;
      this.msg = '';
      this.elevCmd = 0;
      this.ailCmd = 0;
    }

    engage(ac, indAltFt) {
      if (!ac.hasPower()) return;
      this.on = true;
      this.lateral = 'ROL';
      this.vertical = 'VS';
      this.armLat = null;
      this.armGS = false;
      this.vsSel = Math.round(ac.vs / FPM / 100) * 100;
      this.pitchInt = ac.pitch;
      this.navInt = 0;
      this.altHold = indAltFt != null ? indAltFt : ac.alt / FT;
      this.msg = 'AP ENGAGED';
    }

    disengage(reason) {
      if (!this.on) return;
      this.on = false;
      this.armLat = null;
      this.armGS = false;
      this.alert = 2.5;
      this.msg = reason || 'AP DISCONNECT';
    }

    toggle(ac, indAltFt) {
      if (this.on) this.disengage();
      else this.engage(ac, indAltFt);
    }

    // Mode buttons
    press(btn, ac, indAltFt, nav) {
      if (btn === 'AP') return this.toggle(ac, indAltFt);
      if (!this.on) {
        if (['HDG', 'NAV', 'APR', 'REV'].includes(btn)) this.engage(ac, indAltFt);
        else return;
      }
      switch (btn) {
        case 'HDG':
          if (this.lateral === 'HDG' && !this.armLat) this.lateral = 'ROL';
          else this.lateral = 'HDG';
          this.armLat = null;
          break;
        case 'NAV':
        case 'APR':
        case 'REV':
          if (this.armLat === btn || this.lateral === btn) {
            this.armLat = null;
            if (this.lateral === btn) this.lateral = 'ROL';
            this.armGS = false;
            if (this.vertical === 'GS') this.vertical = 'VS';
          } else {
            // arm; keep flying heading (or wings level) until the needle comes alive
            if (this.lateral !== 'HDG') this.lateral = 'ROL';
            this.armLat = btn;
            this.armGS = btn === 'APR';
            this.navInt = 0;
          }
          break;
        case 'ALT':
          if (this.vertical === 'ALT') {
            this.vertical = 'VS';
            this.vsSel = 0;
          } else {
            this.vertical = 'ALT';
            this.altHold = indAltFt;
          }
          break;
        case 'UP':
        case 'DN': {
          const d = btn === 'UP' ? 100 : -100;
          if (this.vertical === 'VS') this.vsSel = FS.clamp(this.vsSel + d, -1500, 1500);
          else if (this.vertical === 'ALT') this.altHold += d / 5; // 20 ft per click in ALT
          break;
        }
        case 'ARM':
          this.armAlt = !this.armAlt;
          break;
      }
    }

    update(dt, ac, nav, indAltFt, indHdg) {
      if (this.alert > 0) this.alert -= dt;
      if (!this.on) return;
      if (!ac.hasPower() || ac.crashed) return this.disengage('AP FAIL');
      const alt = indAltFt != null ? indAltFt : ac.alt / FT;
      const hdg = indHdg != null ? indHdg : ac.heading;
      const vs = ac.vs / FPM;
      const bank = ac.bank,
        pitch = ac.pitch;

      // ---------- lateral ----------
      let navOK = nav && nav.valid;
      if (this.armLat && navOK) {
        const isLoc = nav.type === 'LOC';
        if (this.armLat === 'APR' && !isLoc && nav.type !== 'VOR') navOK = false;
        const cdi = this.armLat === 'REV' ? -nav.cdi : nav.cdi;
        if (navOK && Math.abs(cdi) < (isLoc ? 0.85 : 0.75)) {
          this.lateral = this.armLat;
          this.armLat = null;
          this.navInt = 0;
          this.msg = this.lateral + ' CAPTURED';
        }
      }
      let bankCmd = 0;
      if (this.lateral === 'HDG') {
        bankCmd = FS.clamp(FS.wrap180(this.hdgBug - hdg) * 1.0, -20, 20);
      } else if (this.lateral === 'NAV' || this.lateral === 'APR' || this.lateral === 'REV') {
        if (navOK) {
          const isLoc = nav.type === 'LOC';
          let course = isLoc ? nav.locCourse : nav.obs != null ? nav.obs : this.hdgBug;
          let cdi = nav.cdi;
          if (this.lateral === 'REV') {
            course = FS.wrap360(course + 180);
            cdi = -cdi;
          }
          const gain = isLoc ? 30 : 40;
          if (Math.abs(cdi) < 0.4) this.navInt = FS.clamp(this.navInt + cdi * dt * (isLoc ? 2.0 : 1.2), -20, 20);
          const hdgCmd = course + FS.clamp(cdi * gain, -45, 45) + this.navInt;
          bankCmd = FS.clamp(FS.wrap180(hdgCmd - hdg) * 1.3, -20, 20);
        } else bankCmd = 0; // flagged: hold wings level
      }
      const aErr = bankCmd * DEG - bank;
      this.ailCmd = FS.clamp(2.2 * aErr - 0.9 * ac.omega.x, -0.5, 0.5);

      // ---------- vertical ----------
      if (this.armGS && this.lateral === 'APR' && nav && nav.gsValid && nav.gs < 0.15 && this.vertical !== 'GS') {
        this.vertical = 'GS';
        this.armGS = false;
        this.msg = 'GS CAPTURED';
      }
      if (this.vertical === 'GS' && !(nav && nav.gsValid)) {
        this.vertical = 'VS';
        this.vsSel = Math.round(vs / 100) * 100;
      }
      // altitude capture of preselect
      if (this.vertical === 'VS' && this.armAlt) {
        const toGo = this.altSel - alt;
        const lead = Math.max(Math.abs(vs) * 0.12, 40);
        if (Math.abs(toGo) < lead && Math.sign(toGo) === Math.sign(this.vsSel || 1) && this.vsSel !== 0) {
          this.vertical = 'ALT';
          this.altHold = this.altSel;
          this.msg = 'ALT CAPTURED';
        }
      }
      let vsCmd = 0;
      if (this.vertical === 'VS') vsCmd = this.vsSel;
      else if (this.vertical === 'ALT') vsCmd = FS.clamp((this.altHold - alt) * 4, -700, 700);
      else if (this.vertical === 'GS') {
        const gsKt = ac.gs / FS.U.KT;
        vsCmd = -gsKt * 101.27 * Math.tan(3 * DEG) + FS.clamp(nav.gs, -1, 1) * 450;
      }
      const vsErr = FS.clamp(vsCmd - vs, -1500, 1500);
      this.pitchInt = FS.clamp(this.pitchInt + vsErr * 1.4e-5 * dt * 60 * DEG, -15 * DEG, 18 * DEG);
      const pitchCmd = FS.clamp(this.pitchInt + vsErr * 0.004 * DEG, -15 * DEG, 18 * DEG);
      this.elevCmd = FS.clamp(3.0 * (pitchCmd - pitch) - 1.4 * ac.omega.y, -0.6, 0.6);

      // electric trim offloads the pitch servo
      ac.ctl.trim = FS.clamp(ac.ctl.trim + FS.clamp(this.elevCmd * 0.5, -0.06, 0.06) * dt, -1, 1);
      ac.ctl.aileron = this.ailCmd;
      ac.ctl.elevator = this.elevCmd;
    }

    annunciation() {
      if (!this.on) return this.alert > 0 ? this.msg : '';
      let s = this.lateral;
      if (this.armLat) s += ' ' + this.armLat + '(ARM)';
      s += '  ' + this.vertical;
      if (this.armGS) s += ' GS(ARM)';
      return s;
    }
  }

  FS.Autopilot = Autopilot;
})(typeof window !== 'undefined' ? window : globalThis);
