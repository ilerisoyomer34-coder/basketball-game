// SHIFTBREAKER — rigid-body chassis: raycast suspension on analytic terrain, combined-slip tyres
// driven by the custom drivetrain, body/ground contacts (rollovers, explosion flips) and static collisions.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;
  const G = 9.81;
  const RHO = 1.2;

  const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _v4 = new T.Vector3(), _v5 = new T.Vector3();
  const _q = new T.Quaternion(), _qi = new T.Quaternion();
  const _g = { h: 0, nx: 0, ny: 1, nz: 0, surf: 'asphalt', water: false };
  const _tf = { fx: 0, fy: 0, sr: 0, ta: 0, rho: 0 };

  class Vehicle {
    constructor(game, car, look) {
      this.game = game;
      this.world = game.world;
      this.car = car;
      this.look = look || {};
      const wf = car.weightFront, wb = car.wheelbase, cg = car.cgHeight;
      this.a = wb * (1 - wf);
      this.b = wb * wf;
      this.zShift = this.a - wb / 2;
      this.mass = car.mass * (1 - (car.tune && car.tune.weight ? car.tune.weight : 0));
      const L = car.dims.length, W = car.dims.width, H = car.dims.height, s = car.inertiaScale;
      this.I = new T.Vector3(((L * L + H * H) / 12) * this.mass * s, ((L * L + W * W) / 12) * this.mass * s, ((W * W + H * H) / 12) * this.mass * s);
      this.bodyBox = { hl: L / 2, hw: W / 2, y0: 0.2 - cg, y1: H - cg, zc: this.zShift };
      this.pos = new T.Vector3();
      this.quat = new T.Quaternion();
      this.vel = new T.Vector3();
      this.angVel = new T.Vector3();
      this.fwd = new T.Vector3(0, 0, 1);
      this.up = new T.Vector3(0, 1, 0);
      this.left = new T.Vector3(1, 0, 0);
      this.steerAngle = 0;
      this.speed = 0;
      this.yaw = 0;
      this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 };
      this.dt = new SB.Drivetrain(car, {});
      this.dt.tune = Object.assign(this.dt.tune, car.tune || {});
      const sp = car.susp, R = car.wheel.radius;
      const tuneS = car.tune || {};
      const corner = (front) => (this.mass * (front ? wf : 1 - wf)) / 2;
      this.wheels = [];
      const ht = car.track / 2;
      const defs = [[ht, this.a, true], [-ht, this.a, true], [ht, -this.b, false], [-ht, -this.b, false]];
      for (const [x, z, front] of defs) {
        const mc = corner(front);
        const f = sp.freq * (1 + (tuneS.susp || 0) * 0.5) * Math.sqrt(front ? tuneS.springF || 1 : tuneS.springR || 1);
        const k = mc * Math.pow(2 * Math.PI * f, 2);
        const c = 2 * sp.zeta * Math.sqrt(k * mc) * (tuneS.damp || 1);
        const stat = (mc * G) / k;
        const hpY = R - cg + (sp.restLen - stat);
        this.wheels.push({
          hp: new T.Vector3(x, hpY, z), front, left: x > 0, ks: k, cs: c, rest: sp.restLen, travel: sp.travel,
          driven: car.drive === 'AWD' || (car.drive === 'FWD' ? front : !front),
          R, I: car.wheel.inertia, omega: 0, rot: 0, comp: stat, contact: false, Fz: 0, vx: 0, vy: 0, mu: 1, tp: car.tire, Tb: 0,
          T0: 0, k_: 0, surf: 'asphalt', cp: new T.Vector3(), fg: new T.Vector3(), lg: new T.Vector3(), n: new T.Vector3(0, 1, 0),
          fx: 0, fy: 0, sr: 0, rho: 0, skid: 0, temp: 40, wear: 0, burst: false, brakeTemp: 40, steer: 0, susp: sp.restLen - stat, absT: 0,
        });
      }
      this.driven = this.wheels.filter((w) => w.driven);
      // AWD: the drivetrain drives one wheel pair, so each side's front and rear wheel are joined into one
      // composite wheel (locked centre coupling); Tire.linearize sums the parts' tyre torques
      if (car.drive === 'AWD') {
        const side = (f, r) => ({ parts: [f, r], omega: 0, I: f.I + r.I, R, Tb: 0, T0: 0, k: 0 });
        this.awd = [side(this.wheels[0], this.wheels[2]), side(this.wheels[1], this.wheels[3])];
      }
      this.damage = { body: 0, steering: 0, headL: false, headR: false, susp: [0, 0, 0, 0], tires: [0, 0, 0, 0], dents: 0 };
      this.tcsF = 1;
      this.hillHold = 0;
      this.prevBrake = 0;
      this.lightsMode = 0; // 0 off, 1 low, 2 high
      this.ind = 0; // -1 left, 1 right, 2 hazard
      this.indT = 0;
      this.horn = false;
      this.submerged = 0;
      this.onDeck = false;
      this.events = [];
      this.contactsGround = 0;
      this.airTime = 0;
      this.flipped = 0;
      this.visual = SB.CarModel.buildPlayer(car, look);
      this.root = this.visual.root;
      // align the model's axles with the physics hardpoints (CG is not mid-wheelbase)
      this.visual.body.position.z = this.zShift;
      for (const w of this.visual.wheels) w.steer.position.z += this.zShift;
      for (const k of ['enginePos', 'cockpitEye', 'hoodEye', 'bumperEye']) this.visual[k].z += this.zShift;
      for (const e of this.visual.exhaust) e.z += this.zShift;
      this.visual.zShift = this.zShift;
      game.scene.add(this.root);
      // real cars: the detailed GLB replaces the procedural shell as soon as it is loaded
      if (car.glb && T.GLTFLoader) {
        SB.CarModel.loadGLB(car.glb.hi).then((sc) => {
          if (this.disposed) return;
          SB.CarModel.applyGLB(this.visual, sc, car, { color: this.look.color, finish: this.look.finish, defaultColor: SB.DATA.CARS[car.id].color });
          if (this.charred) this.setCharred(this.charred);
        }).catch((e) => console.warn('car model failed to load, keeping the procedural body', e));
      }
      // headlight beam
      this.beam = new T.SpotLight(0xfff1d8, 0, 70, 0.55, 0.45, 1.4);
      this.beam.position.set(0, 0.2, this.a + 0.8);
      this.beamTarget = new T.Object3D();
      this.beamTarget.position.set(0, -0.6, this.a + 14);
      this.root.add(this.beam, this.beamTarget);
      this.beam.target = this.beamTarget;
    }

    dispose() {
      this.disposed = true;
      this.game.scene.remove(this.root);
      // GLB geometry is shared with the model cache; only the procedural parts belong to this car
      this.root.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    }

    place(x, z, heading, yOff) {
      const h = this.world.heightAt(x, z);
      this.pos.set(x, h + this.car.cgHeight + 0.05 + (yOff || 0), z);
      this.quat.setFromAxisAngle(_v1.set(0, 1, 0), heading);
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0, 0);
      for (const w of this.wheels) { w.omega = 0; w.comp = (this.mass * G) / 4 / w.ks; }
      this.steerAngle = 0;
      this.teleported = true;
      this.updateAxes();
      this.syncVisual(0);
    }

    updateAxes() {
      this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
      this.up.set(0, 1, 0).applyQuaternion(this.quat);
      this.left.set(1, 0, 0).applyQuaternion(this.quat);
      this.yaw = Math.atan2(this.fwd.x, this.fwd.z);
    }

    // ---------------------------------------------------------------- physics step
    step(h, env) {
      const car = this.car, inp = this.input, st = this.game.settings;
      const dt = this.dt;
      this.updateAxes();
      const fwdSpeed = this.vel.dot(this.fwd);
      this.speed = fwdSpeed;

      // steering (speed-sensitive lock, rate-limited, damaged alignment pulls)
      const effMax = car.steer.max * U.clamp(1 - Math.abs(fwdSpeed) / 85, 0.3, 1);
      const pull = (this.damage.susp[0] - this.damage.susp[1]) * 0.05 + this.damage.steering * Math.sin(this.game.time * 9) * 0.01;
      const target = inp.steer * effMax + pull;
      const rate = car.steer.rate * (Math.abs(target) < Math.abs(this.steerAngle) ? 1.6 : 1);
      this.steerAngle += U.clamp(target - this.steerAngle, -rate * h, rate * h);
      const sa = this.steerAngle;

      // ---- wheels: suspension + contact frames
      const grip = env ? env.grip : 1;
      const wetF = env ? env.wet : 0;
      const W = this.world;
      let contacts = 0;
      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i];
        const hpW = _v1.copy(w.hp).applyQuaternion(this.quat).add(this.pos);
        W.groundAt(hpW.x, hpW.z, _g);
        const n = w.n.set(_g.nx, _g.ny, _g.nz);
        const nUp = n.dot(this.up);
        w.contact = false;
        w.Fz = 0;
        if (nUp > 0.3) {
          const t = (n.y * (hpW.y - _g.h)) / nUp;
          const susp = t - w.R;
          if (susp < w.rest) {
            let comp = Math.min(w.rest - susp, w.travel + 0.12);
            const cv = (comp - w.comp) / h;
            let Fs = w.ks * comp + w.cs * cv;
            if (comp > w.travel) Fs += w.ks * 10 * (comp - w.travel);
            w.comp = comp;
            w.susp = w.rest - comp;
            w.Fz = Math.max(0, Fs);
            w.contact = true;
            contacts++;
            w.cp.copy(this.up).multiplyScalar(-t).add(hpW);
            // wheel heading on the ground plane
            const ang = w.front ? (sa > 0 === w.left ? sa * 1.08 : sa * 0.94) : 0;
            w.steer = ang;
            const c = Math.cos(ang), s = Math.sin(ang);
            _v2.copy(this.fwd).multiplyScalar(c).addScaledVector(this.left, s);
            w.fg.copy(_v2).addScaledVector(n, -n.dot(_v2)).normalize();
            w.lg.crossVectors(n, w.fg).normalize();
            const vC = _v3.copy(w.cp).sub(this.pos);
            _v4.crossVectors(this.angVel, vC).add(this.vel);
            w.vx = _v4.dot(w.fg);
            w.vy = _v4.dot(w.lg);
            const S = SB.DATA.SURFACES[_g.surf] || SB.DATA.SURFACES.asphalt;
            w.surf = _g.surf;
            let mu = car.tire.mu * (1 + ((car.tune && car.tune.grip) || 0)) * U.lerp(S.mu, S.wet, wetF) * grip;
            mu *= 1 - w.wear * 0.25;
            if (w.burst) mu *= 0.35;
            if (env && env.aquaplane && _g.surf === 'asphalt' && Math.abs(w.vx) > 22 && this.game.world.isPuddle && this.game.world.isPuddle(w.cp.x, w.cp.z)) mu *= 0.3;
            w.mu = mu;
            w.rr = S.rr;
          } else { w.comp = 0; w.susp = w.rest; }
        } else { w.comp = 0; w.susp = w.rest; }
        if (!w.contact) { w.vx = this.vel.dot(this.fwd); w.vy = 0; w.mu = 0; }
      }
      this.contactsGround = contacts;
      // anti-roll bars
      const arb = (i, j, k) => {
        const a = this.wheels[i], b = this.wheels[j];
        if (!a.contact || !b.contact) return;
        const f = (a.comp - b.comp) * k;
        a.Fz = Math.max(0, a.Fz + f);
        b.Fz = Math.max(0, b.Fz - f);
      };
      arb(0, 1, car.susp.arbF * ((car.tune && car.tune.arbF) || 1));
      arb(2, 3, car.susp.arbR * ((car.tune && car.tune.arbR) || 1));

      // ---- brakes, handbrake, ABS, hill-start assist
      const bias = (car.tune && car.tune.brakeBias) || 0;
      const bForce = ((car.tune && car.tune.brakeForce) || 1) * (1 + ((car.tune && car.tune.brakes) || 0));
      const engagedInGear = dt.state === 'ENG' && (dt.gear === 1 || dt.gear === -1);
      if (st.hillAssist && engagedInGear && Math.abs(fwdSpeed) < 0.3 && this.prevBrake > 0.2 && inp.brake < 0.05 && this.slope() > 0.03) this.hillHold = 2.0;
      if (this.hillHold > 0) {
        this.hillHold -= h;
        if (inp.throttle > 0.2 && dt.engagement > 0.35) this.hillHold = 0;
      }
      this.prevBrake = inp.brake;
      const brake = Math.max(inp.brake, this.hillHold > 0 ? 0.6 : 0);
      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i];
        let tb = (w.front ? car.brakes.front : car.brakes.rear) * brake * bForce;
        if (bias) tb *= w.front ? bias / 0.62 : (1 - bias) / 0.38;
        if (!w.front) tb += car.brakes.hand * inp.handbrake;
        if (w.brakeTemp > 550) tb *= 0.7;
        // ABS: release a locking wheel
        if (st.abs && brake > 0.1 && w.contact && Math.abs(w.vx) > 2.5) {
          const sr = (w.omega * w.R - w.vx) / Math.max(Math.abs(w.vx), 2);
          if (sr * Math.sign(w.vx) < -0.14) w.absT = 0.06;
          if (w.absT > 0) { w.absT -= h; tb *= inp.handbrake > 0.1 && !w.front ? 1 : 0.25; this.absActive = 0.2; }
        }
        w.Tb = tb + (w.contact ? (w.rr || 0.012) * w.Fz * w.R : 0.4);
        w.brakeTemp += ((tb * Math.abs(w.omega)) / 26000) * h;
        w.brakeTemp -= (w.brakeTemp - 40) * (0.04 + Math.abs(fwdSpeed) * 0.004) * h;
      }

      // ---- traction control: trim throttle when the driven wheels spin up
      if (st.tcs) {
        let maxSr = 0;
        for (const w of this.driven) if (w.contact) maxSr = Math.max(maxSr, (w.omega * w.R - w.vx) / Math.max(Math.abs(w.vx), 3));
        // proportional cut around the tyre's peak slip, so the wheels keep pulling instead of bogging
        const over = maxSr - car.tire.peakSlip * 1.6;
        this.tcsF = over > 0 ? Math.max(0.3, this.tcsF - h * (2 + 15 * over)) : Math.min(1, this.tcsF + h * 4);
        if (this.tcsF < 0.95) this.tcsActive = 0.2;
      } else this.tcsF = 1;
      // ESC: reduce throttle and brake the outer front wheel on oversteer
      if (st.esc && Math.abs(fwdSpeed) > 8 && contacts >= 3) {
        const expected = (fwdSpeed * Math.tan(sa)) / car.wheelbase;
        const actual = this.angVel.dot(this.up);
        const err = actual - expected;
        if (Math.abs(err) > 0.35 && Math.sign(err) === Math.sign(actual)) {
          this.tcsF = Math.min(this.tcsF, 0.5);
          const outer = actual > 0 ? this.wheels[1] : this.wheels[0];
          outer.Tb += 900;
          this.escActive = 0.2;
        }
      }

      // ---- drivetrain (driven wheels) + free wheels
      dt.input.throttle = inp.throttle;
      dt.input.brake = inp.brake;
      dt.input.clutch = inp.clutch;
      dt.input.tcs = this.tcsF;
      for (const w of this.wheels) if (!w.contact) { w.Fz = 0; }
      if (this.awd) {
        for (const c of this.awd) { c.omega = (c.parts[0].omega + c.parts[1].omega) / 2; c.Tb = c.parts[0].Tb + c.parts[1].Tb; }
        dt.step(h, this.awd[0], this.awd[1], fwdSpeed);
        for (const c of this.awd) c.parts[0].omega = c.parts[1].omega = c.omega;
      } else dt.step(h, this.driven[0], this.driven[1], fwdSpeed);
      for (const w of this.wheels) {
        if (w.driven) continue;
        SB.Tire.linearize(w);
        w.omega = SB.integrateSpin(w.omega, w.I, h, w.T0, w.k, w.Tb);
      }

      // ---- forces
      const F = _v5.set(0, -G * this.mass, 0);
      const tau = _v4.set(0, 0, 0);
      for (const w of this.wheels) {
        w.rot += w.omega * h;
        if (!w.contact) { w.fx = w.fy = 0; w.skid = 0; continue; }
        SB.Tire.forces(w, w.omega, _tf);
        w.fx = _tf.fx;
        w.fy = _tf.fy;
        w.sr = _tf.sr;
        w.rho = _tf.rho;
        const slipV = Math.hypot(w.omega * w.R - w.vx, w.vy);
        w.skid = U.clamp((slipV - 2.2) / 7, 0, 1) * (w.surf === 'asphalt' || w.surf === 'concrete' || w.surf === 'deck' ? 1 : 0.5);
        // tyre heat & wear from slip power
        const p = Math.abs(w.fx * (w.omega * w.R - w.vx)) + Math.abs(w.fy * w.vy);
        w.temp += (p / 9000 - (w.temp - 40) * 0.02) * h;
        if (st.damage === 'full') w.wear = Math.min(1, w.wear + p * 1.2e-9 * h * 240);
        _v1.copy(this.up).multiplyScalar(w.Fz).addScaledVector(w.fg, w.fx).addScaledVector(w.lg, w.fy);
        F.add(_v1);
        _v2.copy(w.cp).sub(this.pos);
        tau.add(_v3.crossVectors(_v2, _v1));
      }
      // aero
      const vmag = this.vel.length();
      F.addScaledVector(this.vel, -0.5 * RHO * car.aero.cdA * vmag);
      const dfA = car.aero.clA * (1 + ((car.tune && car.tune.aero) || 0));
      if (dfA) F.addScaledVector(this.up, -0.5 * RHO * dfA * fwdSpeed * fwdSpeed);
      if (env && env.wind) F.add(_v1.set(env.wind.x, 0, env.wind.z).multiplyScalar(this.mass));
      // integrate linear
      this.vel.addScaledVector(F, h / this.mass);
      this.pos.addScaledVector(this.vel, h);
      // integrate angular in body frame
      _qi.copy(this.quat).invert();
      const tl = _v1.copy(tau).applyQuaternion(_qi);
      const wl = _v2.copy(this.angVel).applyQuaternion(_qi);
      const Iw = _v3.set(this.I.x * wl.x, this.I.y * wl.y, this.I.z * wl.z);
      const gyro = _v4.crossVectors(wl, Iw);
      wl.x += ((tl.x - gyro.x) / this.I.x) * h;
      wl.y += ((tl.y - gyro.y) / this.I.y) * h;
      wl.z += ((tl.z - gyro.z) / this.I.z) * h;
      this.angVel.copy(wl.applyQuaternion(this.quat));
      this.integrateRotation(h);

      this.bodyGround(h);
      this.collideStatic(h);
      this.staticHold(h);
      this.updateAxes();

      if (contacts === 0) this.airTime += h;
      else { if (this.airTime > 0) this.lastAir = this.airTime; this.airTime = 0; }
      this.flipped = this.up.y < 0.25 && Math.abs(fwdSpeed) < 2 ? this.flipped + h : 0;
      // water
      const gw = W.rawH(this.pos.x, this.pos.z);
      if (gw < -0.5 && this.pos.y < 0.2) this.submerged += h; else this.submerged = 0;
      if (this.submerged > 0) {
        this.vel.multiplyScalar(1 - Math.min(1, h * 2.5));
        this.vel.y += 6 * h;
        this.angVel.multiplyScalar(1 - Math.min(1, h * 2));
      }
      // drivetrain events that act on the chassis
      for (let i = this._evIdx || 0; i < dt.ev.length; i++) {
        const e = dt.ev[i];
        if (e.type === 'jolt') {
          const s = e.strength || 0.5;
          this.vel.addScaledVector(this.fwd, (e.dir || 1) * s * 1.1);
          this.angVel.addScaledVector(this.left, -(e.dir || 1) * s * 0.9);
        }
      }
      this._evIdx = dt.ev.length;
    }

    integrateRotation(h) {
      const w = this.angVel;
      _q.set(w.x * h * 0.5, w.y * h * 0.5, w.z * h * 0.5, 0).multiply(this.quat);
      this.quat.set(this.quat.x + _q.x, this.quat.y + _q.y, this.quat.z + _q.z, this.quat.w + _q.w).normalize();
    }

    slope() {
      _g.ny = 1;
      this.world.groundAt(this.pos.x, this.pos.z, _g);
      return Math.sqrt(1 - _g.ny * _g.ny) / Math.max(0.2, _g.ny);
    }

    // Apply impulse j (world vector) at world point p.
    applyImpulse(j, p) {
      this.vel.addScaledVector(j, 1 / this.mass);
      const r = _v1.copy(p).sub(this.pos);
      const ti = _v2.crossVectors(r, j);
      _qi.copy(this.quat).invert();
      ti.applyQuaternion(_qi);
      ti.set(ti.x / this.I.x, ti.y / this.I.y, ti.z / this.I.z).applyQuaternion(this.quat);
      this.angVel.add(ti);
    }
    // effective inverse mass along n at contact offset r
    invMassAt(r, n) {
      _qi.copy(this.quat).invert();
      const rn = _v3.crossVectors(r, n).applyQuaternion(_qi);
      rn.set(rn.x / this.I.x, rn.y / this.I.y, rn.z / this.I.z).applyQuaternion(this.quat);
      const k = _v4.crossVectors(rn, r);
      return 1 / this.mass + n.dot(k);
    }
    pointVel(p, out) {
      const r = _v1.copy(p).sub(this.pos);
      return out.crossVectors(this.angVel, r).add(this.vel);
    }

    // body corners vs terrain (rollovers, landing after the explosion flip)
    bodyGround(h) {
      const bb = this.bodyBox;
      const pts = Vehicle._corners || (Vehicle._corners = []);
      if (!pts.length) for (const y of [0, 1]) for (const z of [-1, 1]) for (const x of [-1, 1]) pts.push([x, y, z]);
      const n = new T.Vector3();
      const p = new T.Vector3(), r = new T.Vector3(), vp = new T.Vector3(), j = new T.Vector3();
      let hit = 0;
      for (const c of pts) {
        p.set(c[0] * bb.hw * 0.92, c[1] ? bb.y1 - 0.05 : bb.y0 + 0.08, bb.zc + c[2] * bb.hl * 0.95).applyQuaternion(this.quat).add(this.pos);
        this.world.groundAt(p.x, p.z, _g);
        const pen = _g.h - p.y;
        if (pen <= 0) continue;
        hit++;
        n.set(_g.nx, _g.ny, _g.nz);
        this.pos.addScaledVector(n, pen * 0.6);
        r.copy(p).sub(this.pos);
        this.pointVel(p, vp);
        const vn = vp.dot(n);
        if (vn < 0) {
          const k = this.invMassAt(r, n);
          const jn = (-(1 + 0.25) * vn) / k;
          j.copy(n).multiplyScalar(jn);
          this.applyImpulse(j, p);
          // friction
          this.pointVel(p, vp);
          const vt = vp.addScaledVector(n, -vp.dot(n));
          const vtl = vt.length();
          if (vtl > 1e-3) {
            const kt = this.invMassAt(r, vt.clone().divideScalar(vtl));
            const jt = Math.min(0.55 * jn, vtl / kt);
            this.applyImpulse(vt.multiplyScalar(-jt / vtl), p);
          }
          if (-vn > 3) this.events.push({ type: 'scrape', speed: -vn, p: p.clone() });
        }
      }
      return hit;
    }

    carRect() {
      const bb = this.bodyBox;
      return { x: this.pos.x + this.fwd.x * bb.zc, z: this.pos.z + this.fwd.z * bb.zc, hl: bb.hl, hw: bb.hw, ang: this.yaw };
    }

    collideStatic() {
      const rect = this.carRect();
      const yMin = this.pos.y + this.bodyBox.y0 - 0.3, yMax = this.pos.y + this.bodyBox.y1;
      const N = new T.Vector3(), P = new T.Vector3(), r = new T.Vector3(), vp = new T.Vector3(), j = new T.Vector3();
      this.world.query(rect.x, rect.z, 7, (c) => {
        if (c.y1 < yMin || c.y0 > yMax) return;
        let res;
        if (c.type === 'circle') res = SB.U.circleRect(c.x, c.z, c.r, rect);
        else res = SB.U.obbOverlap(rect, c);
        if (!res) return;
        if (!c.solid) { this.events.push({ type: 'cone', c }); return; }
        N.set(res.nx, 0, res.nz);
        this.pos.addScaledVector(N, res.depth + 0.002);
        rect.x += N.x * res.depth; rect.z += N.z * res.depth;
        P.set(res.px, this.pos.y - 0.05, res.pz);
        r.copy(P).sub(this.pos);
        this.pointVel(P, vp);
        const vn = vp.dot(N);
        if (vn < 0) {
          const k = this.invMassAt(r, N);
          const jn = (-(1 + 0.18) * vn) / k;
          j.copy(N).multiplyScalar(jn);
          this.applyImpulse(j, P);
          this.pointVel(P, vp);
          const vt = vp.addScaledVector(N, -vp.dot(N));
          vt.y = 0;
          const vtl = vt.length();
          if (vtl > 1e-3) {
            const kt = this.invMassAt(r, vt.clone().divideScalar(vtl));
            const jt = Math.min(0.3 * jn, vtl / kt);
            this.applyImpulse(vt.multiplyScalar(-jt / vtl), P);
          }
          if (-vn > 1.2) this.impact(-vn, P, N, c);
        }
      });
    }

    // Collide with a moving box (traffic, rivals, police). Returns impulse magnitude or 0.
    collideDynamic(o) {
      const rect = this.carRect();
      if (Math.abs(this.pos.y - o.y) > 3) return 0;
      const res = SB.U.obbOverlap(rect, o);
      if (!res) return 0;
      const N = new T.Vector3(res.nx, 0, res.nz);
      const share = o.mass / (o.mass + this.mass);
      this.pos.addScaledVector(N, res.depth * share);
      o.push = { x: -N.x * res.depth * (1 - share), z: -N.z * res.depth * (1 - share) };
      const P = new T.Vector3(res.px, this.pos.y - 0.05, res.pz);
      const r = new T.Vector3().copy(P).sub(this.pos);
      const vp = this.pointVel(P, new T.Vector3());
      const rel = vp.x * N.x + vp.z * N.z - (o.vx * N.x + o.vz * N.z);
      if (rel >= 0) return 0;
      const k = this.invMassAt(r, N) + 1 / o.mass;
      const jn = (-(1 + 0.2) * rel) / k;
      this.applyImpulse(N.clone().multiplyScalar(jn), P);
      o.dvx = (-N.x * jn) / o.mass;
      o.dvz = (-N.z * jn) / o.mass;
      if (-rel > 1.2) this.impact(-rel, P, N, o);
      return jn;
    }

    impact(speed, P, N, other) {
      const st = this.game.settings;
      const sev = speed;
      this.events.push({ type: 'impact', speed: sev, p: P.clone(), n: N.clone(), other });
      if (st.damage === 'off') return;
      // dent the body toward the inside at the contact point
      const local = P.clone().sub(this.pos).applyQuaternion(_qi.copy(this.quat).invert());
      local.z -= this.zShift;
      const nl = N.clone().applyQuaternion(_qi);
      if (sev > 2.5) SB.CarModel.dent(this.visual, local, nl, sev * 0.6);
      this.damage.body = Math.min(1, this.damage.body + sev * 0.006);
      this.damage.dents++;
      const front = local.z > this.visual.length * 0.25, rear = local.z < -this.visual.length * 0.25;
      if (front && sev > 6) { if (local.x > 0) this.damage.headL = true; else this.damage.headR = true; }
      if (st.damage !== 'full') return;
      const dt = this.dt;
      if (front) dt.health.radiator = Math.max(0, dt.health.radiator - sev * 0.012);
      if (front && sev > 14) dt.health.engine = Math.max(0.05, dt.health.engine - (sev - 14) * 0.01);
      // suspension of the nearest corner
      let bi = 0, bd = Infinity;
      this.wheels.forEach((w, i) => { const d = Math.hypot(w.hp.x - local.x, w.hp.z - local.z - this.zShift); if (d < bd) { bd = d; bi = i; } });
      if (bd < 1.2 && sev > 4) this.damage.susp[bi] = Math.min(1, this.damage.susp[bi] + sev * 0.02);
      if (sev > 9 && bd < 1.0) { this.damage.tires[bi] = Math.min(1, this.damage.tires[bi] + sev * 0.03); if (this.damage.tires[bi] >= 1) this.wheels[bi].burst = true; }
      if (front && sev > 8) this.damage.steering = Math.min(1, this.damage.steering + sev * 0.01);
      void rear;
    }

    staticHold() {
      const inp = this.input;
      if (this.contactsGround < 3) return;
      if (this.vel.lengthSq() > 0.02 || this.angVel.lengthSq() > 0.05) return;
      const dt = this.dt;
      const gearHold = dt.state === 'ENG' && dt.engagement > 0.8 && !dt.running && dt.gear !== 0;
      if (inp.brake > 0.15 || inp.handbrake > 0.4 || this.hillHold > 0 || gearHold) {
        if (inp.throttle > 0.05 && dt.running) return;
        this.vel.x *= 0.2;
        this.vel.z *= 0.2;
        this.angVel.multiplyScalar(0.5);
      }
    }

    // ---------------------------------------------------------------- explosion physics
    explodeImpulse(power) {
      const p = power || 1;
      this.vel.y += (8.5 + Math.random() * 3) * p;
      this.vel.addScaledVector(this.fwd, -1.5);
      const flips = 1 + Math.floor(Math.random() * 3);
      const airtime = (2 * this.vel.y) / G;
      const spin = ((flips * Math.PI * 2) / Math.max(0.8, airtime)) * (Math.random() < 0.5 ? 1 : -1);
      const axis = Math.random() < 0.6 ? this.left : this.fwd;
      this.angVel.addScaledVector(axis, spin).addScaledVector(this.up, (Math.random() - 0.5) * 2);
    }

    // ---------------------------------------------------------------- visuals
    syncVisual(frameDt, t) {
      const v = this.visual;
      this.root.position.copy(this.pos);
      this.root.quaternion.copy(this.quat);
      for (let i = 0; i < 4; i++) {
        const w = this.wheels[i], vw = v.wheels[i];
        vw.steer.position.y = w.hp.y - w.susp;
        vw.steer.rotation.y = w.steer || (w.front ? this.steerAngle : 0);
        vw.spin.rotation.x = w.rot % (Math.PI * 2);
        vw.steer.scale.setScalar(w.burst ? 0.9 : 1);
        vw.disc.material.emissiveIntensity = U.clamp((w.brakeTemp - 300) / 400, 0, 1.4);
      }
      const dt = this.dt, m = v.mats;
      const on = !this.exploded;
      const brk = this.input.brake > 0.05 && on;
      m.tail.emissiveIntensity = !on ? 0 : brk ? 2.2 : this.lightsMode ? 0.6 : 0.08;
      m.rev.emissiveIntensity = dt.state === 'ENG' && dt.gear === -1 && on ? 1.6 : 0;
      this.indT += frameDt || 0;
      const blink = Math.floor(this.indT * 2.6) % 2 === 0;
      m.indL.emissiveIntensity = (this.ind === -1 || this.ind === 2) && blink ? 2 : 0;
      m.indR.emissiveIntensity = (this.ind === 1 || this.ind === 2) && blink ? 2 : 0;
      const headOn = this.lightsMode > 0 && on && (dt.running || dt.cranking || true);
      m.head.emissiveIntensity = headOn ? (this.lightsMode === 2 ? 2.6 : 1.6) : 0.05;
      if (m.glbTail) {
        for (const g of m.glbTail) g.emissiveIntensity = m.tail.emissiveIntensity * 0.8;
        for (const g of m.glbHead) g.emissiveIntensity = m.head.emissiveIntensity > 0.1 ? m.head.emissiveIntensity * 0.7 : 0;
      }
      if (!v.glb) {
        v.heads[0].visible = !this.damage.headL;
        v.heads[1].visible = !this.damage.headR;
      }
      const workingHeads = (this.damage.headL ? 0 : 1) + (this.damage.headR ? 0 : 1);
      this.beam.intensity = headOn ? (this.lightsMode === 2 ? 2.6 : 1.5) * (workingHeads / 2) : 0;
      this.beam.distance = this.lightsMode === 2 ? 120 : 65;
      this.beamTarget.position.y = this.lightsMode === 2 ? -0.2 : -1.1;
      // cockpit: steering wheel, lever, right arm
      if (v.interior.visible) {
        v.steeringWheel.rotation.z = -this.steerAngle * 7;
        const lx = dt.lever.x, ly = dt.lever.y;
        v.lever.rotation.z = -lx * 0.16;
        v.lever.rotation.x = ly * 0.32;
        const shifting = dt.state === 'SEL' || dt.state === 'GRIND' || (this.game.time - (this.lastShiftT || -9)) < 0.35;
        if (shifting) this.lastShiftT = dt.state === 'SEL' || dt.state === 'GRIND' ? this.game.time : this.lastShiftT;
        this.handK = U.damp(this.handK || 0, shifting ? 1 : 0, 16, frameDt || 0.016);
        const a = v.arm;
        const knob = _v1.set(0, 0.25, 0);
        v.lever.localToWorld(knob);
        v.interior.worldToLocal(knob);
        const rim = _v2.set(-0.17, -0.02, 0);
        v.steeringWheel.localToWorld(rim);
        v.interior.worldToLocal(rim);
        const hand = _v3.copy(rim).lerp(knob, this.handK);
        const sh = a.shoulder;
        const elbow = _v4.copy(sh).lerp(hand, 0.5);
        elbow.y -= 0.14;
        elbow.x += 0.06;
        const place = (mesh, p0, p1) => {
          mesh.position.copy(p0).add(p1).multiplyScalar(0.5);
          const d = _v5.copy(p1).sub(p0);
          mesh.scale.set(1, d.length(), 1);
          mesh.quaternion.setFromUnitVectors(Vehicle._yAxis || (Vehicle._yAxis = new T.Vector3(0, 1, 0)), d.normalize());
        };
        place(a.upper, sh, elbow);
        place(a.fore, elbow, hand);
        a.hand.position.copy(hand);
      }
      // wipers
      if (this.wipersOn) {
        const ph = (t || 0) * 2.4;
        const ang = (Math.sin(ph) * 0.5 + 0.5) * 1.5;
        v.wipers[0].rotation.z = ang;
        v.wipers[1].rotation.z = ang;
      }
    }

    get exploded() { return this.dt.exploded; }
    speedKmh() { return Math.abs(this.speed) * 3.6; }

    // compact state for the rewind buffer
    snapshot() {
      return {
        p: this.pos.toArray(), q: this.quat.toArray(), v: this.vel.toArray(), w: this.angVel.toArray(),
        wo: this.wheels.map((w) => w.omega), sa: this.steerAngle, dt: this.dt.snapshot(),
      };
    }
    restore(s) {
      this.pos.fromArray(s.p);
      this.quat.fromArray(s.q);
      this.vel.fromArray(s.v);
      this.angVel.fromArray(s.w);
      s.wo.forEach((o, i) => (this.wheels[i].omega = o));
      this.steerAngle = s.sa;
      this.dt.restore(s.dt);
      this.updateAxes();
    }
  }

  SB.Vehicle = Vehicle;
})();
