// SHIFTBREAKER — input: keyboard (rebindable), gamepad (right stick = H-shifter), steering wheels
// (calibration), touch controls with a draggable H-pattern knob and an editable layout.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;

  const GEAR_ACTIONS = { gR: -1, gN: 0, g1: 1, g2: 2, g3: 3, g4: 4, g5: 5, g6: 6 };
  // ---------------------------------------------------------------- touch control artwork
  const ribs = (n, x, y0, w, step, h) => Array.from({ length: n }, (_, i) => `<rect class="pp-rib" x="${x}" y="${y0 + i * step}" width="${w}" height="${h}" rx="${h / 2}"/>`).join('');
  const PEDAL_SVG = {
    // floor-hinged organ pedal
    gas: '<svg viewBox="0 0 60 130" aria-hidden="true"><rect class="pp-plate" x="3" y="3" width="54" height="120" rx="11"/>' + ribs(9, 13, 14, 34, 12, 5) + '<rect class="pp-glow" x="3" y="3" width="54" height="120" rx="11"/><rect class="pp-hinge" x="12" y="119" width="36" height="9" rx="4"/></svg>',
    // hanging pedals: arm from the top
    brake: '<svg viewBox="0 0 90 86" aria-hidden="true"><rect class="pp-arm" x="38" y="0" width="14" height="22" rx="3"/><rect class="pp-plate" x="3" y="16" width="84" height="66" rx="13"/>' + ribs(5, 14, 26, 62, 11, 5) + '<rect class="pp-glow" x="3" y="16" width="84" height="66" rx="13"/></svg>',
  };
  PEDAL_SVG.clutch = PEDAL_SVG.brake;
  const WHEEL_SVG = '<svg viewBox="-100 -100 200 200" aria-hidden="true">' +
    '<circle class="tw-rim" r="82"/>' +
    '<path class="tw-grip" d="M-74 -36 A82 82 0 0 1 -36 -74"/><path class="tw-grip" d="M36 -74 A82 82 0 0 1 74 -36"/>' +
    '<circle class="tw-edge" r="91"/><circle class="tw-edge" r="73"/>' +
    '<path class="tw-spoke" d="M-75 4 L-30 -2 L-22 22 L22 22 L30 -2 L75 4 L75 -12 L28 -16 L-28 -16 L-75 -12 Z"/>' +
    '<path class="tw-spoke" d="M-14 22 L14 22 L10 76 L-10 76 Z"/>' +
    '<circle class="tw-hub" r="26"/><text class="tw-logo" y="5">SB</text>' +
    '<rect class="tw-mark" x="-6" y="-99" width="12" height="18" rx="3"/></svg>';
  const LEVER_SVG = '<svg viewBox="0 0 110 150" aria-hidden="true"><g class="lv-arm"><rect class="lv-shaft" x="14" y="30" width="14" height="96" rx="7"/>' +
    '<rect class="lv-grip" x="10" y="12" width="22" height="58" rx="11"/>' + [24, 34, 44, 54].map((y) => `<rect class="lv-rib" x="14" y="${y}" width="14" height="3" rx="1.5"/>`).join('') +
    '<circle class="lv-btn" cx="21" cy="10" r="7"/></g>' +
    '<path class="lv-boot" d="M4 146 L10 118 Q12 110 22 110 L44 110 Q54 110 56 118 L62 146 Z"/></svg>';
  const STEER_MAX_DEG = 120; // wheel rotation at full lock

  const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'AltLeft', 'AltRight', 'F3', 'Tab', 'ShiftLeft']);

  class Input {
    constructor(game) {
      this.game = game;
      this.down = new Set();
      this.state = { throttle: 0, brake: 0, steer: 0, clutch: 0, handbrake: 0, lookX: 0, lookY: 0 };
      // phones and tablets start out as touch so the first hints name the on-screen controls
      this.device = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
      document.body.dataset.device = this.device;
      this.holdKey = null;
      this.touch = { steer: 0, gas: 0, brake: 0, clutch: 0, hand: 0, left: false, right: false, active: false };
      this.gp = { prev: [], hgear: null, look: { x: 0, y: 0 } };
      this.mouse = { dragging: false, x: 0, y: 0, lookX: 0, lookY: 0 };
      this.tilt = null;
      this.listenKeys();
      this.listenMouse();
    }
    keys() { return this.game.settings.keys || SB.DATA.KEYS_DEFAULT; }
    actionOf(code) {
      const k = this.keys();
      for (const a of Object.keys(k)) if (k[a].includes(code)) return a;
      return null;
    }
    held(action) {
      const k = this.keys()[action] || [];
      for (const c of k) if (this.down.has(c)) return true;
      return false;
    }

    listenKeys() {
      window.addEventListener('keydown', (e) => {
        if (this.capture) { e.preventDefault(); this.capture(e.code); return; }
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        const a = this.actionOf(e.code);
        if (this.game.state === 'play' && (PREVENT.has(e.code) || a)) e.preventDefault();
        if (e.repeat) return;
        this.down.add(e.code);
        this.setDevice('keyboard');
        if (!a) return;
        this.onAction(a, true, e.code);
      });
      window.addEventListener('keyup', (e) => {
        this.down.delete(e.code);
        const a = this.actionOf(e.code);
        if (a) this.onAction(a, false, e.code);
      });
      window.addEventListener('blur', () => { this.down.clear(); });
    }
    listenMouse() {
      const c = this.game.renderer.domElement;
      c.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') return;
        this.mouse.dragging = true;
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      });
      window.addEventListener('pointermove', (e) => {
        if (!this.mouse.dragging || e.pointerType !== 'mouse') return;
        this.mouse.lookX = U.clamp(this.mouse.lookX + (e.clientX - this.mouse.x) * 0.006, -2.6, 2.6);
        this.mouse.lookY = U.clamp(this.mouse.lookY + (e.clientY - this.mouse.y) * 0.004, -0.5, 0.8);
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      });
      window.addEventListener('pointerup', () => { this.mouse.dragging = false; });
    }
    setDevice(d) {
      if (this.device === d) return;
      this.device = d;
      this.game.hud && this.game.hud.setDevice(d);
    }

    onAction(a, isDown, code) {
      const g = this.game;
      if (g.state !== 'play' && g.state !== 'photo') {
        if (isDown && a === 'pause' && g.state === 'pause') g.resume();
        return;
      }
      const car = g.player;
      const dt = car && car.dt;
      // a quick tap can start and end between two frames: latch it for the next one
      if (a === 'ignition' && isDown) this.ignTap = true;
      if (a in GEAR_ACTIONS) {
        if (!dt) return;
        if (isDown) {
          dt.requestGear(GEAR_ACTIONS[a], true);
          this.holdKey = code;
          if (g.settings.shifter === 'SEQ' || car.car.gearbox === 'sequential') g.hud.toast(SB.i18n.t('msg.directInSeq'), 'warn', 1.6);
        } else if (this.holdKey === code) { dt.releaseHold(); this.holdKey = null; }
        return;
      }
      if (a === 'shiftUp' || a === 'shiftDown') {
        if (!dt) return;
        if (isDown) {
          if (a === 'shiftUp') dt.shiftUp(true); else dt.shiftDown(true);
          this.holdKey = code;
        } else if (this.holdKey === code) { dt.releaseHold(); this.holdKey = null; }
        return;
      }
      g.action(a, isDown);
    }

    // ---------------------------------------------------------------- per frame
    update(dt) {
      const s = this.game.settings;
      const st = this.state;
      const car = this.game.player;
      this.pollGamepads(dt);
      const kb = this.device === 'keyboard';
      const tc = this.device === 'touch';
      let thrT = 0, brkT = 0, steerT = 0, clutchT = 0, handT = 0;
      if (kb) {
        thrT = this.held('throttle') ? 1 : 0;
        brkT = this.held('brake') ? 1 : 0;
        steerT = (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0);
        handT = this.held('handbrake') ? 1 : 0;
        const bite = car ? car.car.clutch.bite : 0.45;
        if (this.held('halfClutch')) clutchT = 1 - bite - 0.07;
        else clutchT = this.held('clutch') ? 1 : 0;
        const ramp = (v, target, up, down) => (target > v ? Math.min(target, v + up * dt) : Math.max(target, v - down * dt));
        st.throttle = ramp(st.throttle, thrT, 6, 10);
        st.brake = ramp(st.brake, brkT, 7, 12);
        const speed = car ? Math.abs(car.speed) : 0;
        const rate = (steerT !== 0 ? 2.6 : 4.2) / (1 + speed * 0.012);
        const sgnFlip = steerT !== 0 && Math.sign(steerT) !== Math.sign(st.steer) ? 2.2 : 1;
        st.steer += U.clamp(steerT * Math.min(1, s.steerSens) - st.steer, -rate * sgnFlip * dt, rate * sgnFlip * dt);
        const cRate = clutchT > st.clutch ? s.clutchPress : s.clutchRelease;
        st.clutch = U.clamp(st.clutch + U.clamp(clutchT - st.clutch, -cRate * dt, cRate * dt), 0, 1);
        st.handbrake = ramp(st.handbrake, handT, 10, 10);
      } else if (this.device === 'gamepad' || this.device === 'wheel') {
        const g = this.gp.vals || {};
        st.throttle = g.throttle || 0;
        st.brake = g.brake || 0;
        st.steer = g.steer || 0;
        st.handbrake = g.hand || 0;
        if (this.device === 'wheel' && g.clutchAxis != null) st.clutch = g.clutchAxis;
        else {
          const cT = g.clutch ? 1 : 0;
          const cRate = cT > st.clutch ? s.clutchPress : s.clutchRelease;
          st.clutch = U.clamp(st.clutch + U.clamp(cT - st.clutch, -cRate * dt, cRate * dt), 0, 1);
        }
      } else if (tc) {
        const t = this.touch;
        if (s.touchSteer === 'buttons') {
          steerT = (t.left ? 1 : 0) - (t.right ? 1 : 0);
          st.steer += U.clamp(steerT - st.steer, -3.2 * dt, 3.2 * dt);
        } else if (s.touchSteer === 'tilt' && this.tilt != null) st.steer = U.clamp(-this.tilt * s.gyroSens, -1, 1);
        else {
          if (s.touchSteer === 'wheel' && !t.wheelDrag) t.steer -= U.clamp(t.steer, -6 * dt, 6 * dt);
          st.steer = t.steer;
        }
        st.throttle = t.gas;
        st.brake = t.brake;
        st.clutch = t.clutch;
        st.handbrake = t.hand;
      }
      // look-around: mouse drag returns to centre when released
      if (!this.mouse.dragging) {
        this.mouse.lookX = U.damp(this.mouse.lookX, 0, 3, dt);
        this.mouse.lookY = U.damp(this.mouse.lookY, 0, 3, dt);
      }
      st.lookX = this.mouse.lookX + this.gp.look.x;
      st.lookY = this.mouse.lookY + this.gp.look.y;
      // dead zone
      if (Math.abs(st.steer) < (this.device === 'keyboard' ? 0 : s.deadzone)) st.steer = 0;
      // ignition is a held action from any device
      this.ignitionHeld = this.held('ignition') || this.touch.ign || (this.gp.vals && this.gp.vals.ign) || !!this.ignTap;
      this.ignTap = false;
      this.rewindHeld = this.held('rewind') || this.touch.rewind || (this.gp.vals && this.gp.vals.rewind);
    }

    pollGamepads(dt) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null;
      for (const p of pads) if (p && p.connected) { pad = p; break; }
      if (!pad) { this.gp.vals = null; return; }
      this.pad = pad;
      const s = this.game.settings;
      const isWheel = /wheel|g29|g920|g923|t300|t150|tmx|fanatec|csl|dfgt|driving force|thrustmaster/i.test(pad.id) || !!s.wheelMap;
      const b = (i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      const bv = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const ax = (i) => pad.axes[i] || 0;
      const vals = {};
      let activity = false;
      if (isWheel && s.wheelMap) {
        const m = s.wheelMap;
        const norm = (cfg) => { if (!cfg) return 0; const v = ax(cfg.axis); return U.clamp((v - cfg.rest) / (cfg.full - cfg.rest || 1), 0, 1); };
        vals.steer = U.clamp(-((ax(m.steer.axis) - (m.steer.center || 0)) / (m.steer.range || 1)) * (m.steer.invert ? -1 : 1), -1, 1);
        vals.throttle = norm(m.gas);
        vals.brake = norm(m.brake);
        vals.clutchAxis = m.clutch ? norm(m.clutch) : null;
        vals.hand = m.hand != null && b(m.hand) ? 1 : 0;
        activity = Math.abs(vals.steer) > 0.05 || vals.throttle > 0.05;
        // H-shifter buttons
        if (m.gears) {
          let g = 0;
          for (const [btn, gear] of Object.entries(m.gears)) if (b(+btn)) g = +gear;
          if (g !== this.gp.hgear) {
            this.gp.hgear = g;
            if (this.game.state === 'play' && this.game.player) this.game.player.dt.requestGear(g, g !== 0);
          }
        }
        this.edge(pad, m.paddleUp, 'shiftUp');
        this.edge(pad, m.paddleDown, 'shiftDown');
      } else {
        const dz = s.deadzone;
        const sx = ax(0);
        vals.steer = Math.abs(sx) < dz ? 0 : -Math.sign(sx) * ((Math.abs(sx) - dz) / (1 - dz)) * s.steerSens;
        vals.throttle = bv(7);
        vals.brake = bv(6);
        vals.clutch = b(4);
        vals.hand = b(0) ? 1 : 0;
        vals.ign = b(5);
        vals.rewind = b(8);
        activity = Math.abs(sx) > 0.3 || vals.throttle > 0.1 || vals.brake > 0.1 || pad.buttons.some((x) => x && x.pressed);
        const hMode = s.shifter === 'H' && this.game.player && this.game.player.car.gearbox !== 'sequential';
        if (hMode) {
          // right stick is the gear lever; D-pad looks around
          this.stickShifter(ax(2), ax(3));
          this.gp.look.x = (b(14) ? 1.6 : 0) - (b(15) ? 1.6 : 0);
          this.gp.look.y = 0;
        } else {
          this.gp.look.x = Math.abs(ax(2)) > 0.2 ? -ax(2) * 2 : 0;
          this.gp.look.y = Math.abs(ax(3)) > 0.2 ? ax(3) * 0.6 : 0;
          this.edge(pad, 12, 'lights');
          this.edge(pad, 14, 'indL');
          this.edge(pad, 15, 'indR');
        }
        this.edge(pad, 1, 'shiftUp');
        this.edge(pad, 2, 'shiftDown');
        this.edge(pad, 3, 'camera');
        this.edge(pad, 9, 'pause');
        this.edge(pad, 10, 'horn');
        this.edge(pad, 13, 'map');
      }
      if (activity) this.setDevice(isWheel ? 'wheel' : 'gamepad');
      this.gp.vals = vals;
      this.gp.prev = pad.buttons.map((x) => !!(x && x.pressed));
      void dt;
    }
    edge(pad, i, action) {
      if (i == null || !pad.buttons[i]) return;
      const now = pad.buttons[i].pressed;
      const was = this.gp.prev[i];
      if (now && !was) { this.setDevice(this.device === 'wheel' ? 'wheel' : 'gamepad'); this.onAction(action, true, 'pad' + i); }
      if (!now && was) this.onAction(action, false, 'pad' + i);
    }
    // map right-stick position onto the car's H-pattern gates
    stickShifter(x, y) {
      const car = this.game.player;
      if (!car || this.game.state !== 'play') return;
      const lay = SB.DATA.LAYOUTS[car.car.layout] || SB.DATA.LAYOUTS.A;
      let g = 0;
      if (Math.abs(y) > 0.55) {
        const row = y < 0 ? 1 : -1;
        const xs = Object.values(lay).map((p) => p[0]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const gx = minX + ((x + 1) / 2) * (maxX - minX);
        let best = null, bd = 9;
        for (const [k, p] of Object.entries(lay)) if (p[1] === row && Math.abs(p[0] - gx) < bd) { bd = Math.abs(p[0] - gx); best = +k; }
        if (best != null && bd < 0.6) g = best;
      } else if (Math.abs(y) > 0.3 && this.gp.hgear) g = this.gp.hgear;
      if (g !== this.gp.hgear) {
        this.gp.hgear = g;
        car.dt.requestGear(g, g !== 0);
        if (g === 0) car.dt.releaseHold();
      }
    }

    rumble(strong, dur) {
      const k = this.game.settings.vibration;
      if (!k) return;
      if (this.pad && this.pad.vibrationActuator && this.pad.vibrationActuator.playEffect) {
        try { this.pad.vibrationActuator.playEffect('dual-rumble', { duration: dur * 1000, strongMagnitude: U.clamp(strong * k, 0, 1), weakMagnitude: U.clamp(strong * k * 0.7, 0, 1) }); } catch (e) { /* unsupported */ }
      }
      if (this.device === 'touch' && navigator.vibrate) { try { navigator.vibrate(Math.round(dur * 1000 * k)); } catch (e) { /* blocked */ } }
    }

    // ---------------------------------------------------------------- touch controls
    buildTouch(root) {
      this.touchRoot = root;
      root.innerHTML = '';
      const s = this.game.settings;
      const el = (id, cls, html) => {
        const d = document.createElement('div');
        d.className = 'tc ' + cls;
        d.dataset.id = id;
        if (html) d.innerHTML = html;
        root.appendChild(d);
        return d;
      };
      const t = this.touch;
      const t9 = SB.i18n.t;
      // steering
      this.wheelRot = null;
      if (s.touchSteer === 'wheel') {
        // turn the wheel with a finger: the angle swept around its centre steers, it re-centres on release
        const box = el('wheel', 'tc-wheel', '<div class="tc-wrot">' + WHEEL_SVG + '</div>');
        const rot = box.firstChild;
        this.wheelRot = rot;
        let pid = null, aPrev = 0, cur = 0;
        const polar = (e) => {
          const r = box.getBoundingClientRect();
          const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
          return { a: (Math.atan2(dy, dx) * 180) / Math.PI, d: Math.hypot(dx, dy) / (r.width / 2) };
        };
        box.addEventListener('pointerdown', (e) => {
          pid = e.pointerId;
          box.setPointerCapture(pid);
          this.setDevice('touch');
          t.wheelDrag = true;
          aPrev = polar(e).a;
          cur = -t.steer * STEER_MAX_DEG;
        });
        box.addEventListener('pointermove', (e) => {
          if (e.pointerId !== pid) return;
          const q = polar(e);
          if (q.d > 0.22) {
            let d = q.a - aPrev;
            if (d > 180) d -= 360;
            if (d < -180) d += 360;
            cur = U.clamp(cur + d, -STEER_MAX_DEG, STEER_MAX_DEG);
          }
          aPrev = q.a;
          t.steer = -cur / STEER_MAX_DEG;
        });
        const up = (e) => { if (e.pointerId !== pid) return; pid = null; t.wheelDrag = false; };
        box.addEventListener('pointerup', up);
        box.addEventListener('pointercancel', up);
      } else if (s.touchSteer === 'buttons') {
        const L = el('steerL', 'tc-btn tc-steer', '◀');
        const R = el('steerR', 'tc-btn tc-steer', '▶');
        this.hold(L, (v) => (t.left = v));
        this.hold(R, (v) => (t.right = v));
      } else if (s.touchSteer === 'slider') {
        const pad = el('steer', 'tc-pad', '<div class="tc-knob"></div><span>' + t9('touch.steer') + '</span>');
        const knob = pad.firstChild;
        let id = null, x0 = 0;
        pad.addEventListener('pointerdown', (e) => { id = e.pointerId; x0 = e.clientX; pad.setPointerCapture(id); this.setDevice('touch'); });
        pad.addEventListener('pointermove', (e) => {
          if (e.pointerId !== id) return;
          const w = pad.clientWidth * 0.42;
          t.steer = U.clamp(-(e.clientX - x0) / w, -1, 1);
          knob.style.transform = `translateX(${-t.steer * w}px)`;
        });
        const up = (e) => { if (e.pointerId !== id) return; id = null; t.steer = 0; knob.style.transform = ''; };
        pad.addEventListener('pointerup', up);
        pad.addEventListener('pointercancel', up);
      } else {
        el('tiltInfo', 'tc-info', t9('touch.tilt'));
        this.enableTilt();
      }
      // pedals
      // pedals: press anywhere; the higher up the plate, the deeper the pedal goes
      this.pedalViews = [];
      const pedal = (id, label, key) => {
        const p = el(id, 'tc-pedal tc-' + id, '<div class="pp">' + PEDAL_SVG[id] + '</div><span>' + label + '</span>');
        this.pedalViews.push({ key, hinge: id === 'gas' ? 1 : -1, pp: p.firstChild, glow: p.querySelector('.pp-glow') });
        let pid = null;
        const setv = (e) => {
          const r = p.getBoundingClientRect();
          const v = U.clamp((r.bottom - e.clientY) / r.height, 0, 1);
          t[key] = 0.3 + v * 0.7;
        };
        p.addEventListener('pointerdown', (e) => { pid = e.pointerId; p.setPointerCapture(pid); this.setDevice('touch'); setv(e); });
        p.addEventListener('pointermove', (e) => { if (e.pointerId === pid) setv(e); });
        const up = (e) => { if (e.pointerId !== pid) return; pid = null; t[key] = 0; };
        p.addEventListener('pointerup', up);
        p.addEventListener('pointercancel', up);
      };
      pedal('gas', t9('touch.gas'), 'gas');
      pedal('brake', t9('touch.brake'), 'brake');
      // the clutch pedal appears whenever the car is driven with the manual clutch (setting or race gearbox)
      const pc = this.game.player;
      this.touchClutch = pc ? !pc.dt.opts.autoClutch : s.clutchMode === 'manual';
      if (this.touchClutch) pedal('clutch', t9('touch.clutch'), 'clutch');
      // shifter
      const car = this.game.player;
      const seq = s.shifter === 'SEQ' || (car && car.car.gearbox === 'sequential');
      if (seq) {
        const up = el('seqUp', 'tc-btn tc-seq', '+');
        const dn = el('seqDn', 'tc-btn tc-seq', '−');
        up.addEventListener('pointerdown', () => { this.setDevice('touch'); car && car.dt.shiftUp(false); });
        dn.addEventListener('pointerdown', () => { this.setDevice('touch'); car && car.dt.shiftDown(false); });
      } else this.buildHWidget(el('hshift', 'tc-hshift', '<canvas width="300" height="240"></canvas>'));
      // handbrake lever: drag up to pull, down to release, tap to toggle; it shows the real state
      const hb = el('hand', 'tc-lever', LEVER_SVG + '<span>' + t9('touch.hand') + '</span>');
      this.leverView = { box: hb, arm: hb.querySelector('.lv-arm'), a: 45 };
      {
        let pid = null, y0 = 0, moved = false;
        hb.addEventListener('pointerdown', (e) => { pid = e.pointerId; hb.setPointerCapture(pid); this.setDevice('touch'); y0 = e.clientY; moved = false; });
        hb.addEventListener('pointermove', (e) => {
          if (e.pointerId !== pid) return;
          const dy = e.clientY - y0;
          if (dy < -12) { t.hand = 1; moved = true; y0 = e.clientY; }
          else if (dy > 12) { t.hand = 0; moved = true; y0 = e.clientY; }
        });
        const up = (e) => { if (e.pointerId !== pid) return; pid = null; if (!moved) t.hand = t.hand ? 0 : 1; };
        hb.addEventListener('pointerup', up);
        hb.addEventListener('pointercancel', () => { pid = null; });
      }
      // buttons
      const btn = (id, label, onDown, onUp) => {
        const b = el(id, 'tc-btn tc-small', label);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setDevice('touch'); onDown && onDown(); });
        if (onUp) { b.addEventListener('pointerup', onUp); b.addEventListener('pointercancel', onUp); b.addEventListener('pointerleave', onUp); }
        return b;
      };
      btn('ign', t9('touch.ign'), () => { t.ign = true; this.ignTap = true; }, () => (t.ign = false));
      btn('cam', '🎥', () => this.game.action('camera', true));
      btn('horn', '📯', () => this.game.action('horn', true), () => this.game.action('horn', false));
      btn('lights', '💡', () => this.game.action('lights', true));
      btn('rewind', '⏪', () => (t.rewind = true), () => (t.rewind = false));
      btn('pause', '❚❚', () => this.game.action('pause', true));
      btn('mapb', '🗺', () => this.game.action('map', true));
      this.applyTouchLayout();
    }
    hold(elm, fn) {
      elm.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setDevice('touch'); fn(true); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) elm.addEventListener(ev, () => fn(false));
    }
    enableTilt() {
      if (this._tiltOn) return;
      this._tiltOn = true;
      const onOri = (e) => {
        const landscape = Math.abs(window.orientation || 0) === 90 || window.innerWidth > window.innerHeight;
        const v = landscape ? e.beta * (window.orientation === -90 ? -1 : 1) : e.gamma;
        if (v == null) return;
        this.tilt = U.clamp(v / 30, -1, 1);
      };
      try {
        if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
          DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') window.addEventListener('deviceorientation', onOri); }).catch(() => {});
        } else window.addEventListener('deviceorientation', onOri);
      } catch (e) { /* motion unavailable: tilt stays null and the slider is used */ }
      setTimeout(() => { if (this.tilt == null) this.game.hud.toast(SB.i18n.t('msg.tiltUnavailable'), 'warn', 3); }, 1500);
    }

    // Draggable H-pattern knob: magnetic gates, haptic grind feedback; 6→1 works here too.
    buildHWidget(box) {
      const cv = box.firstChild;
      const g = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const st = { kx: -0.5, ky: 0, drag: false, pid: null, req: null };
      this.hw = st;
      const lay = () => SB.DATA.LAYOUTS[(this.game.player && this.game.player.car.layout) || 'A'];
      const xs = () => Object.values(lay()).map((p) => p[0]);
      const toPx = (x, y) => {
        const a = xs(), mn = Math.min(...a), mx = Math.max(...a);
        return [W * 0.14 + ((x - mn) / (mx - mn || 1)) * W * 0.72, H / 2 - y * H * 0.36];
      };
      const fromPx = (px, py) => {
        const a = xs(), mn = Math.min(...a), mx = Math.max(...a);
        return [mn + ((px - W * 0.14) / (W * 0.72)) * (mx - mn), -(py - H / 2) / (H * 0.36)];
      };
      const cols = () => Array.from(new Set(xs())).sort((p, q) => p - q);
      const slotAt = (x, y) => { for (const [k, p] of Object.entries(lay())) if (Math.abs(p[0] - x) < 0.01 && p[1] === y) return +k; return null; };
      const draw = () => {
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(10,12,16,0.55)';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = 'rgba(220,225,232,0.55)';
        g.lineWidth = 10;
        g.lineCap = 'round';
        const c = cols();
        const [x0, y0] = toPx(c[0], 0), [x1] = toPx(c[c.length - 1], 0);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.stroke();
        g.font = '700 26px "Chakra Petch", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const dt = this.game.player && this.game.player.dt;
        for (const [k, p] of Object.entries(lay())) {
          const [px, py] = toPx(p[0], p[1]);
          g.beginPath(); g.moveTo(px, y0); g.lineTo(px, py); g.stroke();
          const gear = +k;
          const engaged = dt && dt.state === 'ENG' && dt.gear === gear;
          g.fillStyle = engaged ? '#ffb43a' : 'rgba(240,240,240,0.85)';
          g.fillText(gear === -1 ? 'R' : String(gear), px, py + (p[1] > 0 ? -22 : 24));
        }
        const [kx, ky] = toPx(st.kx, st.ky);
        const grinding = dt && dt.state === 'GRIND';
        const j = grinding ? (Math.random() - 0.5) * 6 : 0;
        g.fillStyle = grinding ? '#e5482d' : '#f2efe8';
        g.beginPath(); g.arc(kx + j, ky + j, 22, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath(); g.arc(kx + j - 5, ky + j - 6, 8, 0, Math.PI * 2); g.fill();
      };
      st.draw = draw;
      const move = (e) => {
        const r = cv.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
        let [x, y] = fromPx(px, py);
        const c = cols();
        if (Math.abs(st.ky) < 0.15) {
          // in the neutral channel: slide sideways, or enter a column
          x = U.clamp(x, c[0], c[c.length - 1]);
          let near = c[0];
          for (const cx of c) if (Math.abs(cx - x) < Math.abs(near - x)) near = cx;
          if (Math.abs(near - x) < 0.22 && Math.abs(y) > 0.12) { x = near; }
          else y = 0;
        } else x = st.kx;
        const up = slotAt(x, 1) != null, dn = slotAt(x, -1) != null;
        y = U.clamp(y, dn ? -1 : 0, up ? 1 : 0);
        // magnetic snap into gates
        if (Math.abs(y) > 0.72) y = Math.sign(y);
        st.kx = x;
        st.ky = y;
        const dt = this.game.player && this.game.player.dt;
        if (!dt) return;
        const target = Math.abs(y) === 1 ? slotAt(x, y) : Math.abs(y) < 0.5 ? 0 : st.req;
        if (target !== st.req && target != null) {
          st.req = target;
          dt.requestGear(target, target !== 0);
        }
      };
      cv.addEventListener('pointerdown', (e) => { st.drag = true; st.pid = e.pointerId; cv.setPointerCapture(e.pointerId); this.setDevice('touch'); move(e); });
      cv.addEventListener('pointermove', (e) => { if (st.drag && e.pointerId === st.pid) move(e); });
      const end = (e) => {
        if (e.pointerId !== st.pid) return;
        st.drag = false;
        const dt = this.game.player && this.game.player.dt;
        if (!dt) return;
        dt.releaseHold();
        if (dt.state === 'GRIND' || (Math.abs(st.ky) > 0 && Math.abs(st.ky) < 1)) { st.ky = 0; st.req = 0; dt.requestGear(0, false); }
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    }
    updateTouchWidget() {
      if (!this.touchRoot || this.touchRoot.hidden) return;
      const car = this.game.player, t = this.touch;
      if (this.wheelRot) this.wheelRot.style.transform = `rotate(${(-t.steer * STEER_MAX_DEG).toFixed(1)}deg)`;
      for (const v of this.pedalViews || []) {
        const x = t[v.key] || 0;
        v.pp.style.transform = `perspective(260px) rotateX(${(v.hinge * x * 30).toFixed(1)}deg) translateY(${(x * 4).toFixed(1)}px)`;
        v.glow.style.opacity = (x * 0.6).toFixed(2);
      }
      if (this.leverView && car) {
        // follows the brake actually applied (also the automatic parking brake while the engine is off)
        const L = this.leverView, on = car.input.handbrake > 0.5;
        L.a += ((on ? 8 : 45) - L.a) * 0.35;
        L.arm.setAttribute('transform', `rotate(${L.a.toFixed(1)} 21 122)`);
        L.box.classList.toggle('on', on);
      }
      const st = this.hw;
      if (!st) return;
      const dt = this.game.player && this.game.player.dt;
      if (dt && !st.drag) { st.kx = dt.lever.x; st.ky = Math.abs(dt.lever.y) > 0.95 ? Math.sign(dt.lever.y) : dt.lever.y; st.req = dt.leverGear(); }
      if (dt && dt.state === 'GRIND' && st.drag && Math.random() < 0.25) this.rumble(0.4, 0.03);
      st.draw();
    }
    applyTouchLayout() {
      const L = this.game.settings.touchLayout || {};
      const op = this.game.settings.touchOpacity;
      for (const d of this.touchRoot.querySelectorAll('.tc')) {
        const p = L[d.dataset.id];
        d.style.opacity = op;
        if (p) { d.style.left = p.x + '%'; d.style.top = p.y + '%'; d.style.right = 'auto'; d.style.bottom = 'auto'; d.style.transform = `scale(${p.s || 1})`; d.style.transformOrigin = 'top left'; }
      }
    }
    // layout editor: drag controls, pinch-free size via the slider in the toolbar
    editLayout(on, sizeSlider) {
      const root = this.touchRoot;
      root.classList.toggle('editing', on);
      const s = this.game.settings;
      s.touchLayout = s.touchLayout || {};
      this.selected = null;
      if (!on) { this.game.saveSettings(); return; }
      for (const d of root.querySelectorAll('.tc')) {
        if (d._edit) continue;
        d._edit = true;
        d.addEventListener('pointerdown', (e) => {
          if (!root.classList.contains('editing')) return;
          e.stopPropagation();
          e.preventDefault();
          this.selected = d;
          for (const x of root.querySelectorAll('.tc')) x.classList.toggle('sel', x === d);
          const r = d.getBoundingClientRect();
          const ox = e.clientX - r.left, oy = e.clientY - r.top;
          const mv = (ev) => {
            const x = U.clamp(((ev.clientX - ox) / window.innerWidth) * 100, 0, 95), y = U.clamp(((ev.clientY - oy) / window.innerHeight) * 100, 0, 95);
            const cur = s.touchLayout[d.dataset.id] || { s: 1 };
            s.touchLayout[d.dataset.id] = { x, y, s: cur.s || 1 };
            this.applyTouchLayout();
          };
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', mv);
          window.addEventListener('pointerup', up);
          if (sizeSlider) sizeSlider.value = (s.touchLayout[d.dataset.id] && s.touchLayout[d.dataset.id].s) || 1;
        }, true);
      }
    }
    setSelectedScale(v) {
      if (!this.selected) return;
      const s = this.game.settings;
      const id = this.selected.dataset.id;
      const r = this.selected.getBoundingClientRect();
      const cur = s.touchLayout[id] || { x: (r.left / window.innerWidth) * 100, y: (r.top / window.innerHeight) * 100 };
      s.touchLayout[id] = { x: cur.x, y: cur.y, s: v };
      this.applyTouchLayout();
    }

    // ---------------------------------------------------------------- wheel calibration
    // step: 'steer' | 'gas' | 'brake' | 'clutch' | gear numbers; resolves the axis/button that moved most
    calibrateStep(kind, cb) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find((p) => p && p.connected);
      if (!pad) { cb(null); return; }
      const base = pad.axes.slice();
      const baseB = pad.buttons.map((b) => b.pressed);
      const t0 = performance.now();
      const tick = () => {
        const p = (navigator.getGamepads() || [])[pad.index];
        if (!p) { cb(null); return; }
        if (typeof kind === 'number' || kind === 'paddleUp' || kind === 'paddleDown') {
          for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i].pressed && !baseB[i]) { cb({ button: i }); return; }
        } else {
          let bi = -1, bd = 0.35;
          for (let i = 0; i < p.axes.length; i++) { const d = Math.abs(p.axes[i] - base[i]); if (d > bd) { bd = d; bi = i; } }
          if (bi >= 0 && performance.now() - t0 > 400) {
            setTimeout(() => {
              const q = (navigator.getGamepads() || [])[pad.index];
              const full = q ? q.axes[bi] : p.axes[bi];
              cb({ axis: bi, rest: base[bi], full, center: base[bi], range: Math.abs(full - base[bi]) || 1, invert: full < base[bi] });
            }, 700);
            return;
          }
        }
        if (performance.now() - t0 > 9000) { cb(null); return; }
        requestAnimationFrame(tick);
      };
      tick();
    }
  }

  SB.Input = Input;
})();
