// SHIFTBREAKER — custom drivetrain: engine, clutch, gearbox state machine, differential, tyre model.
// Pure logic (no THREE), runs at a fixed step and also in Node for the automated rule tests.
//
// Gearbox state machine (all transitions live in this file):
//   N ──request──▶ SEL (lever travelling) ──arrive──▶ ENG(n) | GRIND(n) | N
//   ENG(n) ──request──▶ SEL            (blocked under load without clutch → stays ENG, "shiftBlocked")
//   GRIND(n) ──clutch in / revs match / speed ok──▶ ENG(n)
//   GRIND(n) ──released > grindToNeutral──▶ N      GRIND(R) ──forced──▶ ENG(R) "clank" | N "gearboxBreak"
//   gear health 0 → that gear is BROKEN: every attempt grinds.
// Signature rule (checked when the lever arrives): last engaged gear 6, lever reaches 1 or R within
// 2.0 s with no gear engaged in between (N allowed), speed ≥ threshold → engine explodes.
// Sequential: 6 → 1 by consecutive downshifts completed within 1.5 s above the 6→1 threshold.
(function (root) {
  'use strict';
  const SB = (root.SB = root.SB || {});
  const TAU = Math.PI * 2, W2RPM = 60 / TAU, RPM2W = TAU / 60;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

  const VDEN_LONG = 2.0; // m/s floor for the slip-ratio denominator (keeps low-speed tyre maths stable)
  const VDEN_LAT = 2.5;

  // ------------------------------------------------------------------ tyre
  // Combined slip "similarity" model: normalise slip ratio and slip angle by their peaks, run one
  // Pacejka-shaped curve on the combined magnitude, split the force back along the slip direction.
  const Tire = {
    shape(rho, C) {
      const B = Math.tan(Math.PI / (2 * C)); // peak exactly at rho = 1
      return Math.sin(C * Math.atan(B * rho));
    },
    forces(w, omega, out) {
      const p = w.tp;
      const sr = (omega * w.R - w.vx) / Math.max(Math.abs(w.vx), VDEN_LONG);
      const ta = w.vy / Math.max(Math.abs(w.vx), VDEN_LAT);
      const sx = sr / p.peakSlip, sy = ta / p.peakAngle;
      const rho = Math.sqrt(sx * sx + sy * sy);
      out.sr = sr; out.ta = ta; out.rho = rho;
      const muFz = w.mu * w.Fz;
      if (rho < 1e-9 || muFz <= 0) { out.fx = 0; out.fy = 0; return out; }
      const f = (muFz * Tire.shape(rho, p.C)) / rho;
      out.fx = f * sx;
      out.fy = -f * sy;
      return out;
    },
    // Linearise the tyre's reaction torque on the wheel: T(ω') ≈ T0 − k (ω' − ω)
    linearize(w) {
      if (w.parts) {
        // composite wheel (AWD side): parts turn together, their tyre torques and stiffnesses add up
        let T0 = 0, k = 0;
        for (const p of w.parts) { p.omega = w.omega; Tire.linearize(p); T0 += p.T0; k += p.k; }
        w.T0 = T0;
        w.k = k;
        return;
      }
      const o = Tire._t;
      Tire.forces(w, w.omega, o);
      const fx0 = o.fx;
      const d = 0.05 + Math.abs(w.omega) * 0.002;
      Tire.forces(w, w.omega + d, o);
      w.T0 = -fx0 * w.R;
      w.k = Math.max(0, ((o.fx - fx0) / d) * w.R);
    },
    _t: { fx: 0, fy: 0, sr: 0, ta: 0, rho: 0 },
  };
  SB.Tire = Tire;

  // Semi-implicit spin integration with a friction-type torque Tb (brakes, rolling resistance,
  // stopped-engine compression) that can hold the shaft at exactly zero.
  function integrateSpin(omega, I, h, Tnet, k, Tb) {
    const den = I + h * k;
    if (omega !== 0) {
      const s = omega > 0 ? 1 : -1;
      const w2 = omega + (h * (Tnet - s * Tb)) / den;
      if (w2 * s > 0) return w2;
    }
    if (Math.abs(Tnet) <= Tb) return 0;
    const s2 = Tnet > 0 ? 1 : -1;
    return (h * (Tnet - s2 * Tb)) / den;
  }
  SB.integrateSpin = integrateSpin;

  const ORDER = [-1, 0, 1, 2, 3, 4, 5, 6];
  const STATE_KEYS = [
    'omegaE', 'running', 'cranking', 'autoCrank', 'crankT', 'crankNeed', 'startGrace', 'fuelCut', 'boost', 'idleI', 'locked',
    'state', 'gear', 'target', 'selT', 'selDur', 'grindKind', 'grindT', 'forceT', 'releasedT', 'lastEngaged',
    'left6At', 'seqChain', 'seqChainStart', 'pendingOverRev', 'exploded', 'seized', 'clutchTemp', 'engineTemp',
    'fuel', 'wrongFuel', 'time', 'lockupT', 'misfireT', 'lugging', 'shiftDirLast', 'leaveRpm', 'leaveTime',
  ];

  class Drivetrain {
    constructor(car, opts) {
      this.car = car;
      this.R = SB.DATA.RULES;
      this.layout = SB.DATA.LAYOUTS[car.layout] || SB.DATA.LAYOUTS.A;
      this.ev = [];
      this.tune = { power: 0, rev: 0, clutchCap: 0, shifter: 1 };
      this.opts = Object.assign(
        {
          stalling: true,
          autoClutch: false,
          autoBlip: false,
          autoShift: false,
          shifter: 'H',
          mechanical: true,
          fuel: true,
          explosion: { enabled: true, thr61: this.R.explosion.thr61, thr6R: this.R.explosion.thr6R },
        },
        opts || {}
      );
      this.input = { throttle: 0, brake: 0, clutch: 0, ignition: false, tcs: 1 };
      this.health = { engine: 1, gearbox: 1, clutch: 1, radiator: 1 };
      this.gearHealth = { '-1': 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
      this.fuel = car.fuelTank * 0.75;
      this.fuelType = car.fuelType;
      this.reset();
      const e = car.engine;
      const wot = e.maxTorque * SB.U.interp(e.curve, e.idle);
      const br = e.maxTorque * (e.fric0 + (e.fric1 * e.idle) / 1000);
      this.idleBase = br / (wot + br);
    }

    reset() {
      this.omegaE = 0;
      this.running = false;
      this.cranking = false;
      this.autoCrank = false;
      this.crankT = 0;
      this.crankNeed = 1;
      this.startGrace = 0;
      this.ignLatch = false;
      this.prevIgnition = false;
      this.fuelCut = false;
      this.boost = 0;
      this.idleI = 0;
      this.locked = false;
      this.Tc = 0;
      this.Tcap = 0;
      this.slipW = 0;
      this.clutchPedal = 0;
      this.engagement = 1;
      this.state = 'N';
      this.gear = 0;
      this.target = 0;
      this.selT = 0;
      this.selDur = 0;
      this.grindKind = null;
      this.grindT = 0;
      this.forceT = 0;
      this.releasedT = 0;
      this.holding = false;
      this.blockedReq = null;
      this.lever = { x: -0.5, y: 0 };
      this.leverFrom = { x: -0.5, y: 0 };
      this.seqPulse = 0;
      this.lastEngaged = 0;
      this.left6At = -99;
      this.seqChain = false;
      this.seqChainStart = -99;
      this.pendingOverRev = false;
      this.exploded = false;
      this.seized = false;
      this.clutchTemp = 40;
      this.engineTemp = this.R.engineHeat.normal;
      this.wrongFuel = this.wrongFuel || 0;
      this.time = 0;
      this.lockupT = 0;
      this.misfireT = 0;
      this.lugging = false;
      this.antiStall = false;
      this.shiftDirLast = 0;
      this.leaveRpm = 0;
      this.leaveTime = -99;
      this.wheelAvg = 0;
      this.speed = 0;
      this.thrEff = 0;
      this.Te = 0;
      this.ac = { phase: 'idle', p: 1, pending: null };
      this.revHold = 0;
      this.sinceShift = 0;
      this.throttleLast = 0;
      this._evT = {};
    }

    // ---------------------------------------------------------------- helpers
    seqMode() { return this.car.gearbox === 'sequential' || this.opts.shifter === 'SEQ'; }
    dogBox() { return this.car.gearbox === 'sequential'; }
    rpm() { return this.omegaE * W2RPM; }
    redline() { return this.car.engine.redline + (this.tune.rev || 0); }
    limiter() { return this.car.engine.limiter + (this.tune.rev || 0); }
    maxTorque() { return this.car.engine.maxTorque * (1 + (this.tune.power || 0)); }
    ratio(g) {
      const gs = this.car.gears;
      if (g === -1) return -gs.reverse * gs.final;
      if (g <= 0) return 0;
      return gs.ratios[g - 1] * gs.final;
    }
    rpmInGear(g) { return Math.abs(this.wheelAvg * this.ratio(g)) * W2RPM; }
    leverGear() {
      if (this.state === 'ENG') return this.gear;
      if (this.state === 'SEL' || this.state === 'GRIND') return this.target;
      return 0;
    }
    displayGear() {
      // what the big HUD indicator shows
      if (this.state === 'ENG') return this.gear;
      return 0;
    }
    emit(type, data, throttleSec) {
      if (throttleSec) {
        const last = this._evT[type] || -99;
        if (this.time - last < throttleSec) return;
        this._evT[type] = this.time;
      }
      const e = data || {};
      e.type = type;
      this.ev.push(e);
    }
    drainEvents() {
      const e = this.ev;
      this.ev = [];
      return e;
    }
    slotPos(g) {
      if (this.seqMode()) return [0, 0];
      const p = this.layout[String(g)];
      return p ? p : [this.lever.x, 0];
    }

    // ---------------------------------------------------------------- engine torque
    wot(rpm) {
      const e = this.car.engine;
      let t = this.maxTorque() * SB.U.interp(e.curve, rpm);
      if (e.turbo) t *= 1 - e.turbo.share * (1 - this.boost);
      t *= 0.45 + 0.55 * this.health.engine;
      if (this.engineTemp > this.R.engineHeat.critical) t *= 0.6;
      else if (this.engineTemp > this.R.engineHeat.overheat) t *= 0.82;
      if (this.lugging) t *= this.R.lug.torque;
      return t;
    }
    engBrake(rpm) {
      const e = this.car.engine;
      return this.maxTorque() * (e.fric0 + (e.fric1 * Math.max(0, rpm)) / 1000);
    }

    // ---------------------------------------------------------------- shifting API
    shiftUp(holding = true) {
      if (this.exploded) return;
      const cur = this.ac.phase === 'press' && this.ac.pending !== null ? this.ac.pending : this.leverGear();
      if (cur >= 6) return;
      const t = ORDER[ORDER.indexOf(cur) + 1];
      this.seqChain = false;
      this.shiftDirLast = 1;
      this.holding = holding;
      this.seqPulse = 1;
      this.request(t);
    }
    shiftDown(holding = true) {
      if (this.exploded) return;
      const cur = this.ac.phase === 'press' && this.ac.pending !== null ? this.ac.pending : this.leverGear();
      if (cur <= -1) return;
      const t = ORDER[ORDER.indexOf(cur) - 1];
      if (this.seqMode()) {
        if (t === -1 && Math.abs(this.speed) * 3.6 > this.R.shift.rEngageKmh) {
          this.emit('rLocked', null, 0.6);
          return;
        }
        if (cur === 6) {
          this.seqChain = true;
          this.seqChainStart = this.time;
        }
      }
      this.shiftDirLast = -1;
      this.holding = holding;
      this.seqPulse = -1;
      this.request(t);
    }
    requestGear(g, holding = true) {
      if (this.exploded || this.seqMode()) return;
      const cur = this.leverGear();
      this.holding = holding;
      if (g === cur) return;
      this.shiftDirLast = g === 0 ? 0 : Math.sign(ORDER.indexOf(g) - ORDER.indexOf(cur));
      this.request(g);
    }
    releaseHold() { this.holding = false; }

    request(target) {
      if (this.opts.autoClutch && !this.dogBox() && this.clutchPedal < 0.97 && this.state === 'ENG') {
        this.ac.phase = 'press';
        this.ac.pending = target;
        return;
      }
      if (this.ac.phase === 'press') { this.ac.pending = target; return; }
      this.applyRequest(target);
    }

    canDisengage() {
      return this.engagement < 0.3 || this.input.throttle < this.R.shift.disengageMaxThrottle || !this.running || this.dogBox();
    }

    applyRequest(target) {
      if (target === this.leverGear() && this.state !== 'GRIND') return;
      if (this.state === 'ENG') {
        if (!this.canDisengage()) {
          this.blockedReq = target;
          this.emit('shiftBlocked', null, 1.2);
          return;
        }
        this.leaveGear();
      }
      this.blockedReq = null;
      this.startSelect(target);
    }

    leaveGear() {
      this.leaveRpm = this.rpm();
      this.leaveTime = this.time;
      if (this.gear === 6) this.left6At = this.time;
      this.gear = 0;
      this.locked = false;
      this.pendingOverRev = false;
    }

    startSelect(target) {
      const S = this.R.shift;
      let dur;
      if (this.seqMode()) {
        dur = S.seqTravel * (this.dogBox() ? 0.75 : 1);
      } else {
        const [tx, ty] = target === 0 ? [this.lever.x, 0] : this.slotPos(target);
        const dist = Math.abs(this.lever.y) + Math.abs(this.lever.x - tx) + Math.abs(ty);
        dur = (S.leverBase + S.leverPerGate * dist) * (this.tune.shifter || 1);
      }
      this.leverFrom = { x: this.lever.x, y: this.lever.y };
      this.selStartKmh = Math.abs(this.speed) * 3.6;
      this.state = 'SEL';
      this.target = target;
      this.selT = 0;
      this.selDur = dur;
    }

    arrive(g) {
      if (this.checkExplosion(g)) return;
      if (g === 0) {
        this.state = 'N';
        this.gear = 0;
        this.target = 0;
        return;
      }
      this.tryEngage(g, true);
    }

    checkExplosion(g) {
      const ex = this.opts.explosion;
      if (!ex || !ex.enabled || this.exploded) return false;
      // speed when the lever started toward 1/R (the player's action) or on arrival, whichever is higher
      const kmh = Math.max(Math.abs(this.speed) * 3.6, this.selStartKmh || 0);
      let fire = false;
      if (this.seqMode()) {
        if (g === 1 && this.seqChain && this.time - this.seqChainStart <= this.R.explosion.seqWindow + 1e-9 && Math.round(kmh) >= ex.thr61) fire = true;
      } else if ((g === 1 || g === -1) && this.lastEngaged === 6 && this.time - this.left6At <= this.R.explosion.hWindow + 1e-9) {
        if (Math.round(kmh) >= (g === 1 ? ex.thr61 : ex.thr6R)) fire = true;
      }
      if (!fire) return false;
      const imposed = Math.max(Math.abs(this.wheelAvg), Math.abs(this.speed) / this.car.wheel.radius) * Math.abs(this.ratio(g)) * W2RPM;
      this.exploded = true;
      this.running = false;
      this.cranking = false;
      this.state = 'ENG';
      this.gear = g;
      this.target = g;
      this.locked = false;
      const p = this.slotPos(g);
      this.lever.x = p[0];
      this.lever.y = p[1];
      this.emit('explode', { from: 6, to: g, kmh, rpm: Math.max(this.rpm(), imposed) });
      return true;
    }

    // Try to put gear g in. Returns true when engaged.
    tryEngage(g, fresh) {
      const S = this.R.shift;
      const kmh = this.speed * 3.6;
      const clutchIn = this.engagement < S.cleanEngagement;
      let ok = false, kind = null;
      if (this.gearHealth[g] <= 0) kind = 'broken';
      else if (g === -1) {
        if (kmh > S.rEngageKmh) kind = kmh > S.rGrindKmh ? 'fast' : 'slow';
        else if (clutchIn || this.rpm() < 120) ok = true;
        else kind = 'noclutch';
      } else {
        if (kmh < -S.rEngageKmh) kind = kmh < -S.rGrindKmh ? 'fast' : 'slow';
        else if (clutchIn || this.dogBox()) ok = true;
        else if (this.input.throttle <= S.clutchlessMaxThrottle && Math.abs(this.rpm() - this.rpmInGear(g)) <= S.clutchlessRpmWindow) {
          ok = true;
          if (this.running) this.emit('clutchless', { gear: g });
        } else kind = 'noclutch';
      }
      if (ok) {
        this.engage(g, clutchIn);
        return true;
      }
      if (fresh || this.state !== 'GRIND') {
        this.state = 'GRIND';
        this.target = g;
        this.grindKind = kind;
        this.grindT = 0;
        this.forceT = 0;
        this.releasedT = 0;
        this.emit('grind', { kind, gear: g });
        if (kind === 'broken') this.emit('gearBroken', { gear: g }, 1);
      }
      return false;
    }

    engage(g, clutchIn) {
      const S = this.R.shift;
      if (clutchIn && g > 0 && this.opts.mechanical) {
        const dr = Math.abs(this.rpm() - this.rpmInGear(g));
        this.health.gearbox = Math.max(0, this.health.gearbox - dr * S.synchroWearPerRpm);
      }
      const prev = this.lastEngaged;
      this.state = 'ENG';
      this.gear = g;
      this.target = g;
      this.lastEngaged = g;
      this.pendingOverRev = true;
      this.locked = false;
      this.sinceShift = 0;
      this.engagedAt = this.time;
      this.engageDir = g > prev ? 1 : -1;
      this.revMatchCheck = this.engageDir < 0 && g > 0;
      this.emit('engage', { gear: g, clutchless: !clutchIn });
      if (g > 1 && prev === g - 1 && this.running) {
        const rl = this.redline();
        if (this.leaveRpm > rl * 0.86 && this.leaveRpm < rl * 1.01 && this.time - this.leaveTime < 0.55) this.emit('perfectShift', { gear: g });
      }
    }

    updateGrind(h) {
      const S = this.R.shift;
      const g = this.target;
      const kind = this.grindKind;
      this.grindT += h;
      if (this.holding) { this.forceT += h; this.releasedT = 0; } else this.releasedT += h;
      if (this.opts.mechanical && kind !== 'broken') {
        const sev = kind === 'fast' ? 3 : kind === 'slow' ? 1.6 : 1;
        this.gearHealth[g] = Math.max(0, this.gearHealth[g] - S.grindWear * h * sev);
        this.health.gearbox = Math.max(0, this.health.gearbox - 0.004 * h * sev);
      }
      if (kind !== 'broken' && this.tryEngage(g, false)) { this.emit('grindStop'); return; }
      if (this.holding && (kind === 'slow' || kind === 'fast')) {
        if (kind === 'slow' && this.forceT >= S.rForceSlow) {
          // forced in with a loud clank: car jolts, engine stalls, light gearbox damage
          if (this.opts.mechanical) {
            this.gearHealth[g] = Math.max(0, this.gearHealth[g] - 0.15);
            this.health.gearbox = Math.max(0, this.health.gearbox - 0.05);
          }
          this.emit('grindStop');
          this.emit('clank', { gear: g });
          this.emit('jolt', { strength: 0.6, dir: g === -1 ? -1 : 1 });
          this.state = 'ENG';
          this.gear = g;
          this.lastEngaged = g;
          this.locked = false;
          if (this.running) this.stall('clank');
          return;
        }
        if (kind === 'fast' && this.forceT >= S.rForceFast) {
          // teeth break: drive wheels lock for a moment, heavy gearbox damage, gear lost
          if (this.opts.mechanical) {
            this.gearHealth[g] = 0;
            const others = [1, 2, 3, 4, 5, 6].filter((x) => x !== g);
            const victim = others[Math.floor(Math.random() * others.length)];
            this.gearHealth[victim] = Math.max(0, this.gearHealth[victim] - 0.35);
            this.health.gearbox = Math.max(0, this.health.gearbox - 0.35);
          }
          this.emit('grindStop');
          this.emit('gearboxBreak', { gear: g });
          this.emit('jolt', { strength: 1, dir: 1 });
          this.lockupT = 0.6;
          this.state = 'N';
          this.gear = 0;
          this.target = 0;
          return;
        }
      }
      if (!this.holding && this.releasedT > S.grindToNeutral) {
        this.state = 'N';
        this.gear = 0;
        this.target = 0;
        this.emit('grindStop');
      }
    }

    updateLever(h) {
      if (this.seqMode()) {
        this.seqPulse = approach(this.seqPulse, 0, h * 6);
        this.lever.x = 0;
        this.lever.y = this.seqPulse;
        return;
      }
      if (this.state === 'SEL') {
        const g = this.target;
        const [tx, ty] = g === 0 ? [this.leverFrom.x, 0] : this.slotPos(g);
        const f = this.leverFrom;
        const s1 = Math.abs(f.y), s2 = Math.abs(f.x - tx), s3 = Math.abs(ty);
        const tot = s1 + s2 + s3 || 1;
        let d = clamp(this.selT / this.selDur, 0, 1) * tot;
        if (d <= s1) { this.lever.x = f.x; this.lever.y = f.y * (1 - d / (s1 || 1)); return; }
        d -= s1;
        if (d <= s2) { this.lever.x = f.x + (tx - f.x) * (d / (s2 || 1)); this.lever.y = 0; return; }
        d -= s2;
        this.lever.x = tx;
        this.lever.y = ty * (d / (s3 || 1));
      } else if (this.state === 'ENG' || this.state === 'GRIND') {
        const p = this.slotPos(this.state === 'ENG' ? this.gear : this.target);
        const j = this.state === 'GRIND' ? 0.82 + Math.sin(this.time * 90) * 0.06 : 1;
        this.lever.x = p[0];
        this.lever.y = p[1] * j;
      } else {
        this.lever.y = approach(this.lever.y, 0, h * 8);
      }
    }

    stall(reason) {
      if (!this.running) return;
      this.running = false;
      this.fuelCut = false;
      this.emit('stall', { reason });
    }

    // ---------------------------------------------------------------- clutch
    engFromPedal(p) {
      const c = this.car.clutch;
      const x = clamp((1 - p - c.bite) / c.band, 0, 1);
      return x * x * (3 - 2 * x);
    }
    pedalForEng(e) {
      const c = this.car.clutch;
      return e >= 1 ? 0 : clamp(1 - (c.bite + c.band * e), 0, 1);
    }
    autoClutch(h) {
      const ac = this.ac;
      const c = this.car.clutch;
      if (ac.phase === 'press') {
        ac.p = Math.min(1, ac.p + h * 16);
        if (ac.p >= 1) {
          ac.phase = 'shift';
          const r = ac.pending;
          ac.pending = null;
          this.engagement = 0;
          if (r !== null) this.applyRequest(r);
        }
        return ac.p;
      }
      if (ac.phase === 'shift') {
        if (this.state === 'SEL' || (this.state === 'GRIND' && this.holding)) { ac.p = 1; return 1; }
        ac.phase = 'idle';
      }
      let target;
      // dog box: shifts stay clutchless (engaged through SEL); only launches and stops use the clutch
      if (this.dogBox() && this.state === 'SEL') target = 0;
      else if (this.state !== 'ENG' || this.cranking) target = 1;
      else if (!this.running) target = 0;
      else {
        const e = this.car.engine;
        const rpm = this.rpm();
        const wheelRpm = this.rpmInGear(this.gear);
        const thr = this.input.throttle;
        // hard braking: disengage early so locked/slow wheels can't drag the engine down
        if (this.input.brake > 0.6 && rpm < e.idle + 900) target = 1;
        // launch: the harder the throttle, the longer the clutch slips to keep the engine on boost
        else if (wheelRpm < e.idle + 300 + 1100 * thr) {
          let eT;
          const launch = e.idle + 600 + 2400 * thr;
          if (thr < 0.04) eT = this.input.brake > 0.1 ? 0 : clamp((rpm - (e.idle - 120)) / 500, 0, 0.42);
          else eT = clamp((rpm - (e.idle + 200)) / Math.max(250, launch - e.idle - 200), 0, 1);
          // synced with the wheels → close it, unless a hard launch has bogged the engine below its band
          if (wheelRpm > rpm - 120 && rpm > e.idle - 50 && (thr < 0.3 || rpm > launch * 0.75)) eT = 1;
          if (rpm < e.idle - 90) eT = Math.min(eT, 0.06);
          target = this.pedalForEng(eT);
        } else target = 0;
      }
      const rate = target > ac.p ? 24 : this.shiftDirLast < 0 ? 3.4 : 4.6;
      ac.p = approach(ac.p, target, rate * h);
      void c;
      return ac.p;
    }
    updateClutch(h) {
      let p;
      if (this.exploded) p = 0;
      else if (this.opts.autoClutch) p = this.autoClutch(h);
      else p = clamp(this.input.clutch, 0, 1);
      this.clutchPedal = p;
      this.engagement = this.engFromPedal(p);
      const C = this.R.clutchHeat;
      const wearF = 0.25 + 0.75 * this.health.clutch;
      const heatF = this.clutchTemp > C.hot ? Math.max(0.55, 1 - (this.clutchTemp - C.hot) / 220) : 1;
      this.Tcap = this.car.clutch.capacity * (1 + (this.tune.clutchCap || 0)) * this.maxTorque() * this.engagement * wearF * heatF;
    }

    // ---------------------------------------------------------------- throttle
    throttleEff(h) {
      const e = this.car.engine;
      const inp = this.input;
      const rpm = this.rpm();
      // pedal → torque fraction: progressive, small openings give most of the torque at low rpm
      const ped = clamp(inp.throttle, 0, 1);
      let thr = 1 - Math.pow(1 - ped, 2 + 2.5 * clamp(1 - rpm / this.redline(), 0, 1));
      // traction control trims torque, not pedal (the progressive map would hide a pedal cut)
      if (inp.tcs != null) thr *= inp.tcs;
      // automatic blip on downshifts (assist, auto clutch, or dog box)
      if ((this.opts.autoBlip || this.opts.autoClutch || this.dogBox()) && this.shiftDirLast < 0) {
        const busy = this.state === 'SEL' || (this.state === 'ENG' && this.engagement < 0.6 && this.time - (this.engagedAt || -9) < 0.6);
        if (busy) {
          const g = this.state === 'SEL' ? this.target : this.gear;
          if (g > 0) {
            const tr = this.rpmInGear(g);
            if (tr < this.limiter()) thr = Math.max(thr, clamp((tr - rpm) / 500, 0, 1));
          }
        }
      }
      // idle air control (PI) — keeps idle and gently resists stalling
      const err = (e.idle - rpm) / e.idle;
      this.idleI = clamp(this.idleI + err * h * 2.0, -0.08, 0.22);
      const thrIdle = clamp(this.idleBase + err * 3.0 + this.idleI, 0, 0.38);
      thr = Math.max(thr, thrIdle);
      if (this.startGrace > 0) thr = Math.max(thr, 0.7);
      // rev limiter: fuel cut, ~200 rpm bounce
      const lim = this.limiter();
      if (rpm >= lim) {
        if (!this.fuelCut) this.emit('limiter', null, 0.15);
        this.fuelCut = true;
      } else if (rpm < lim - 200) this.fuelCut = false;
      if (this.fuelCut) thr = 0;
      // launch control (track car): hold launch rpm while clutch is in at a standstill
      if (this.car.launchControl && Math.abs(this.speed) < 1 && this.engagement < 0.2 && inp.throttle > 0.85 && rpm > this.car.launchControl) thr = 0;
      // dog box ignition cut while upshifting
      if (this.dogBox() && this.state === 'SEL' && this.shiftDirLast > 0) thr = 0;
      if (this.misfireT > 0) thr *= 0.15;
      return thr;
    }

    // ---------------------------------------------------------------- main step
    // wl, wr: driven wheels {omega, I, R, vx, vy, Fz, mu, tp, Tb}
    step(h, wl, wr, speed) {
      const R = this.R, e = this.car.engine;
      this.time += h;
      this.speed = speed;
      this.wheelAvg = (wl.omega + wr.omega) * 0.5;
      const inp = this.input;

      // ignition / starter
      const ign = !!inp.ignition;
      if (ign && !this.prevIgnition && this.running) {
        this.running = false;
        this.ignLatch = true;
        this.emit('off');
      }
      if (!ign) this.ignLatch = false;
      this.prevIgnition = ign;
      // push-button start: a tap keeps the starter turning until the engine fires (or gives up)
      if (this.exploded || this.seized || this.running) this.autoCrank = false;
      if (!this.running && (ign || this.autoCrank) && !this.ignLatch && !this.exploded && !this.seized) {
        if (!this.cranking) {
          this.cranking = true;
          this.autoCrank = true;
          this.crankT = 0;
          this.crankNeed = R.starter.minCrank + Math.random() * (R.starter.maxCrank - R.starter.minCrank);
          this.emit('crank');
        }
        this.crankT += h;
        if (this.crankT >= this.crankNeed && this.health.engine > 0 && this.fuel > 0) {
          this.cranking = false;
          this.autoCrank = false;
          const inGear = this.state === 'ENG' && this.engagement > 0.3 && !this.opts.autoClutch;
          if (inGear) {
            // fires against a loaded driveline: the car lurches and the engine dies
            this.emit('jolt', { strength: 0.7, dir: this.gear === -1 ? -1 : 1 });
            this.emit('stall', { reason: 'startInGear' });
            this.crankT = 0;
            this.ignLatch = true;
          } else {
            this.running = true;
            this.startGrace = R.stall.grace;
            if (this.omegaE < 300 * RPM2W) this.omegaE = 300 * RPM2W;
            this.emit('start');
          }
        } else if (this.crankT >= this.crankNeed && this.fuel <= 0) {
          this.emit('noFuel', null, 2);
          this.autoCrank = false;
        } else if (this.crankT > R.starter.maxCrank + 1.5) this.autoCrank = false;
      } else if (this.cranking) {
        this.cranking = false;
        this.emit('crankStop');
      }

      // gearbox selection
      if (this.blockedReq !== null && this.state === 'ENG') {
        if (!this.holding) this.blockedReq = null;
        else if (this.canDisengage()) this.applyRequest(this.blockedReq);
      }
      if (this.state === 'SEL') {
        this.selT += h;
        if (this.selT >= this.selDur) this.arrive(this.target);
      } else if (this.state === 'GRIND') this.updateGrind(h);
      this.updateLever(h);

      this.updateClutch(h);
      this.sinceShift += h;

      // engine torque
      const rpm = this.rpm();
      let Te = 0, TbE = 0;
      if (this.running) {
        if (e.turbo) {
          const tgt = clamp(inp.throttle, 0, 1) * clamp((rpm - e.turbo.spool[0]) / (e.turbo.spool[1] - e.turbo.spool[0]), 0, 1);
          this.boost += (tgt - this.boost) * (1 - Math.exp(-h / (tgt > this.boost ? e.turbo.lag : 0.22)));
          if (this.throttleLast > 0.6 && inp.throttle < 0.2 && this.boost > 0.5) this.emit('blowoff', null, 0.8);
        }
        const lugRpm = R.lug.base + R.lug.perGear * this.gear;
        this.lugging = this.state === 'ENG' && this.gear >= 2 && this.locked && rpm < lugRpm && inp.throttle > 0.25;
        if (this.lugging) this.emit('lug', null, 0.9);
        const thr = this.throttleEff(h);
        this.thrEff = thr;
        Te = thr * this.wot(rpm) - (1 - thr) * this.engBrake(rpm);
        if (this.throttleLast > 0.6 && inp.throttle < 0.1 && rpm > this.redline() * 0.55 && Math.random() < (e.turbo || this.dogBox() ? 0.8 : 0.45)) this.emit('backfire', null, 0.5);
        if (this.fuelCut && Math.random() < h * 6) this.emit('backfire', { small: true }, 0.2);
      } else {
        this.thrEff = 0;
        this.lugging = false;
        if (this.cranking) {
          Te = this.maxTorque() * R.starter.torque * Math.max(0, 1 - rpm / R.starter.maxRpm) - this.engBrake(rpm) * 0.5;
        } else {
          TbE = this.seized || this.exploded ? 1e6 : Math.max(this.maxTorque() * 0.3, this.engBrake(rpm));
        }
      }
      this.throttleLast = inp.throttle;
      this.Te = Te;

      // driveline integration
      if (this.exploded || this.lockupT > 0) {
        wl.Tb += 1e6;
        wr.Tb += 1e6;
        if (this.lockupT > 0) this.lockupT -= h;
      }
      this.integrate(h, wl, wr, Te, TbE);

      // stall / anti-stall
      const rpm2 = this.rpm();
      if (this.running) {
        if (this.startGrace > 0) this.startGrace -= h;
        else if (rpm2 < e.stallRpm) {
          if (this.opts.stalling || this.state !== 'ENG') this.stall('lowRpm');
        }
        if (!this.opts.stalling && this.state === 'ENG' && this.engagement > 0.05 && rpm2 < e.idle * 0.92) {
          this.omegaE = e.idle * 0.92 * RPM2W;
          this.locked = false;
          if (!this.antiStall) this.emit('antiStall', null, 0.8);
          this.antiStall = true;
        } else this.antiStall = false;
      } else this.antiStall = false;

      this.postChecks(h);
      if (this.opts.autoShift) this.autoShift(h);
    }

    integrate(h, wl, wr, Te, TbE) {
      const Ie = this.car.engine.inertia;
      Tire.linearize(wl);
      Tire.linearize(wr);
      const G = this.state === 'ENG' && !this.exploded ? this.ratio(this.gear) : 0;
      const diff = this.car.diff;
      const lsdOn = diff.type === 'lsd' || this.tune.lsd;
      const d = wl.omega - wr.omega;
      const lsdCap = lsdOn ? (diff.preload || 60) + (diff.bias || 0.3) * Math.abs(G * this.Tc) : 0;
      const Tlsd = lsdOn ? clamp((diff.k || 60) * d, -lsdCap, lsdCap) : 0;

      if (G === 0) {
        this.omegaE = Math.max(0, integrateSpin(this.omegaE, Ie, h, Te, 0, TbE));
        wl.omega = integrateSpin(wl.omega, wl.I, h, wl.T0 - Tlsd, wl.k, wl.Tb);
        wr.omega = integrateSpin(wr.omega, wr.I, h, wr.T0 + Tlsd, wr.k, wr.Tb);
        this.locked = false;
        this.Tc = 0;
        this.slipW = 0;
        return;
      }
      const Tcap = this.Tcap;
      const avg = (wl.omega + wr.omega) * 0.5;
      const slip = this.omegaE - G * avg;

      if (this.locked && !this.antiStall) {
        const J = wl.I + wr.I + Ie * G * G;
        const Tsum = G * Te + wl.T0 + wr.T0;
        const K = wl.k + wr.k;
        const Tb = wl.Tb + wr.Tb + TbE * Math.abs(G);
        const avg2 = integrateSpin(avg, J, h, Tsum, K, Tb);
        const Tc = TbE > 0 ? -(wl.T0 + wr.T0) / G : Te - (Ie * (G * avg2 - this.omegaE)) / h;
        if (Math.abs(Tc) <= Tcap) {
          // differential mode (open diff splits torque equally; LSD resists the difference)
          const Id = (wl.I + wr.I) * 0.5;
          let d2 = d + (h * (wl.T0 - wr.T0 - 2 * Tlsd)) / (Id + h * K * 0.5);
          if ((d * d2 < 0 && lsdOn) || wl.Tb + wr.Tb > 1e5) d2 = 0;
          wl.omega = avg2 + d2 * 0.5;
          wr.omega = avg2 - d2 * 0.5;
          this.omegaE = G * avg2;
          this.Tc = Tc;
          this.slipW = 0;
          if (this.omegaE < 0) this.omegaE = 0;
          return;
        }
        this.locked = false;
      }
      // slipping clutch
      let sg = slip > 0 ? 1 : slip < 0 ? -1 : Te >= 0 ? 1 : -1;
      let Tc = Tcap * sg;
      if (this.antiStall) Tc = sg * Math.min(Tcap, 0.5 * this.wot(this.car.engine.idle));
      let we2 = Math.max(0, integrateSpin(this.omegaE, Ie, h, Te - Tc, 0, TbE));
      const Tw = G * Tc * 0.5;
      let l2 = integrateSpin(wl.omega, wl.I, h, Tw + wl.T0 - Tlsd, wl.k, wl.Tb);
      let r2 = integrateSpin(wr.omega, wr.I, h, Tw + wr.T0 + Tlsd, wr.k, wr.Tb);
      const slip2 = we2 - G * (l2 + r2) * 0.5;
      if (Tcap > 0 && !this.antiStall && (slip2 * sg <= 0 || Math.abs(slip2) < 0.4)) {
        const Jd = (wl.I + wr.I) / (G * G);
        const a2 = (l2 + r2) * 0.5;
        const u = Math.max(0, (Ie * we2 + Jd * G * a2) / (Ie + Jd));
        const dA = u / G - a2;
        l2 += dA;
        r2 += dA;
        we2 = u;
        this.locked = true;
      }
      // clutch heat from slip power
      const C = this.R.clutchHeat;
      const P = Math.abs(Tc * slip);
      this.clutchTemp += (P * h) / C.capacity;
      if (this.opts.mechanical && this.clutchTemp > C.hot) this.health.clutch = Math.max(0, this.health.clutch - P * h * C.wearPerJoule * (1 + (this.clutchTemp - C.hot) / 100));
      this.slipW = slip;
      this.Tc = Tc;
      this.omegaE = we2;
      wl.omega = l2;
      wr.omega = r2;
    }

    postChecks(h) {
      const R = this.R, e = this.car.engine;
      const rpm = this.rpm();
      // clutch cooling + warnings
      const C = R.clutchHeat;
      this.clutchTemp -= C.cool * (this.clutchTemp - 40) * h;
      if (this.clutchTemp > C.burn) this.emit('clutchBurn', null, 3);
      else if (this.clutchTemp > C.hot) this.emit('clutchHot', null, 4);

      // over-rev ("money shift") check when the clutch starts transmitting after an engagement
      if (this.state === 'ENG' && this.pendingOverRev && this.engagement > 0.35) {
        this.pendingOverRev = false;
        const imposed = Math.max(Math.abs(this.wheelAvg), Math.abs(this.speed) / this.car.wheel.radius) * Math.abs(this.ratio(this.gear)) * W2RPM;
        const ratio = imposed / this.redline();
        const O = R.overRev;
        if (imposed > this.limiter() + 100 && ratio >= O.valveFloat) {
          if (ratio >= O.seize) {
            if (this.opts.mechanical) {
              this.health.engine = 0;
              this.seized = true;
              this.running = false;
              this.locked = false;
            }
            this.emit('seize', { rpm: imposed, ratio });
          } else if (ratio >= O.damage) {
            const amt = O.damageMin + ((O.damageMax - O.damageMin) * (ratio - O.damage)) / (O.seize - O.damage);
            if (this.opts.mechanical) this.health.engine = Math.max(0.05, this.health.engine - amt);
            this.emit('engineDamage', { rpm: imposed, ratio, amount: amt });
          } else {
            if (this.opts.mechanical) this.health.engine = Math.max(0.05, this.health.engine - O.valveFloatWear);
            this.emit('valveFloat', { rpm: imposed, ratio });
          }
        }
        if (this.revMatchCheck && this.running && Math.abs(rpm - imposed) < 300 && imposed < this.limiter()) this.emit('revMatch', { gear: this.gear });
        this.revMatchCheck = false;
      }
      // continuous over-speed (dragged past the limiter) and limiter bouncing wear
      if (this.opts.mechanical) {
        if (rpm > this.limiter() + 150) {
          this.health.engine = Math.max(0.05, this.health.engine - 0.01 * h);
          this.emit('valveFloat', { rpm, ratio: rpm / this.redline(), continuous: true }, 1.5);
        } else if (this.fuelCut) this.health.engine = Math.max(0.05, this.health.engine - R.overRev.limiterWearPerSec * h);
      }

      // engine temperature
      const H = R.engineHeat;
      const load = this.running ? this.thrEff * (rpm / this.redline()) : 0;
      const tgt = (this.running ? H.normal + 14 * load : 40) + (1 - this.health.radiator) * 42 * (this.running ? 1 : 0);
      this.engineTemp += (tgt - this.engineTemp) * (1 - Math.exp(-h / H.tau));
      if (this.engineTemp > H.overheat) this.emit('overheat', null, 6);
      if (this.engineTemp > H.critical && this.opts.mechanical) this.health.engine = Math.max(0.05, this.health.engine - 0.004 * h);

      // fuel
      if (this.running && this.opts.fuel) {
        const F = R.fuel;
        const lps = F.base * (rpm / e.idle) * (F.idleShare + this.thrEff * F.throttle);
        this.fuel = Math.max(0, this.fuel - lps * h);
        this.lps = lps;
        if (this.fuel <= 0) { this.stall('noFuel'); this.emit('noFuel', null, 2); }
      } else this.lps = 0;

      // misfires: damaged engine, wrong fuel, almost-empty tank
      if (this.misfireT > 0) this.misfireT -= h;
      else if (this.running) {
        let rate = 0;
        if (this.health.engine < 0.6) rate += (0.6 - this.health.engine) * 9;
        if (this.wrongFuel > 1.5) rate += 3;
        if (this.opts.fuel && this.fuel < 0.6) rate += 4;
        if (rate > 0 && Math.random() < rate * h) {
          this.misfireT = 0.07 + Math.random() * 0.06;
          this.emit('misfire', null, 0.12);
        }
        if (this.wrongFuel > 1.5 && this.opts.mechanical) this.health.engine = Math.max(0.05, this.health.engine - 0.0015 * h);
      }
    }

    autoShift(h) {
      if (this.exploded || !this.running || this.ac.phase !== 'idle') return;
      const inp = this.input;
      const rl = this.redline();
      if (this.state === 'N') {
        if (inp.throttle > 0.1 && Math.abs(this.speed) < 2) this.request(1);
        else if (inp.brake > 0.5 && Math.abs(this.speed) < 0.4) this.request(-1);
        return;
      }
      if (this.state !== 'ENG') return;
      const g = this.gear, rpm = this.rpm();
      if (g >= 1) {
        if (g < 6 && rpm > rl * 0.94 && this.sinceShift > 0.35) { this.shiftDirLast = 1; this.request(g + 1); return; }
        if (g > 1 && this.sinceShift > 0.6) {
          const lower = rpm * (this.ratio(g - 1) / this.ratio(g));
          const downAt = inp.throttle > 0.8 ? rl * 0.6 : rl * 0.3;
          if (rpm < downAt && lower < rl * 0.86) { this.shiftDirLast = -1; this.request(g - 1); return; }
        }
        if (Math.abs(this.speed) < 0.4 && inp.brake > 0.5 && inp.throttle < 0.05) {
          this.revHold += h;
          if (this.revHold > 0.45) { this.revHold = 0; this.shiftDirLast = -1; this.request(-1); }
        } else this.revHold = 0;
      } else if (g === -1) {
        if (Math.abs(this.speed) < 0.4 && inp.brake > 0.5 && inp.throttle < 0.05) {
          this.revHold += h;
          if (this.revHold > 0.45) { this.revHold = 0; this.shiftDirLast = 1; this.request(1); }
        } else this.revHold = 0;
      }
    }

    // ---------------------------------------------------------------- repair / snapshot
    repairAll() {
      this.health = { engine: 1, gearbox: 1, clutch: 1, radiator: 1 };
      this.gearHealth = { '-1': 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
      this.exploded = false;
      this.seized = false;
      this.wrongFuel = 0;
      this.clutchTemp = 40;
      this.engineTemp = this.R.engineHeat.normal;
    }
    snapshot() {
      const s = {};
      for (const k of STATE_KEYS) s[k] = this[k];
      s.health = Object.assign({}, this.health);
      s.gearHealth = Object.assign({}, this.gearHealth);
      s.lever = { x: this.lever.x, y: this.lever.y };
      return s;
    }
    restore(s) {
      for (const k of STATE_KEYS) this[k] = s[k];
      this.health = Object.assign({}, s.health);
      this.gearHealth = Object.assign({}, s.gearHealth);
      this.lever = { x: s.lever.x, y: s.lever.y };
      this.ac = { phase: 'idle', p: this.state === 'ENG' ? 0 : 1, pending: null };
      this.blockedReq = null;
      this.holding = false;
    }
  }

  SB.Drivetrain = Drivetrain;
  SB.W2RPM = W2RPM;
  SB.RPM2W = RPM2W;
  if (typeof module !== 'undefined' && module.exports) module.exports = SB;
})(typeof window !== 'undefined' ? window : globalThis);
