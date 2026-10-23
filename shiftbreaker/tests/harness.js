// 1-D longitudinal test rig shared by the drivetrain tests and debugging scripts.
'use strict';
const path = require('path');
const SB = require(path.join(__dirname, '../js/util.js'));
require(path.join(__dirname, '../js/data.js'));
require(path.join(__dirname, '../js/drivetrain.js'));
const H = 1 / 240;
// 1-D longitudinal car: two driven wheels through the real drivetrain + tyre model,
// undriven axle modelled as rolling wheels with friction-type brakes.
function makeSim(carId, opts) {
  const car = SB.U.clone(SB.DATA.CARS[carId]);
  const dt = new SB.Drivetrain(car, opts);
  const g = 9.81, M = car.mass;
  const wheel = () => ({ omega: 0, I: car.wheel.inertia, R: car.wheel.radius, vx: 0, vy: 0, Fz: 0, mu: car.tire.mu, tp: car.tire, Tb: 0 });
  const sim = { car, dt, v: 0, slope: 0, brake: 0, handbrake: 0, t: 0, wl: wheel(), wr: wheel(), ev: [] };
  const o = {};
  sim.step = () => {
    const drivenFront = car.drive === 'FWD';
    const share = drivenFront ? car.weightFront : 1 - car.weightFront;
    const N = M * g * Math.cos(sim.slope);
    for (const w of [sim.wl, sim.wr]) {
      w.vx = sim.v;
      w.vy = 0;
      w.Fz = (N * share) / 2;
      const bt = (drivenFront ? car.brakes.front : car.brakes.rear) * sim.brake + (!drivenFront ? car.brakes.hand * sim.handbrake : 0);
      w.Tb = bt + 0.012 * w.Fz * w.R;
    }
    dt.input.brake = sim.brake;
    dt.step(H, sim.wl, sim.wr, sim.v);
    let F = 0;
    for (const w of [sim.wl, sim.wr]) { SB.Tire.forces(w, w.omega, o); F += o.fx; }
    F -= M * g * Math.sin(sim.slope);
    F -= 0.5 * 1.2 * car.aero.cdA * sim.v * Math.abs(sim.v);
    // undriven axle: rolling resistance + brakes (+ handbrake on the rear for FWD cars)
    const otherN = N * (1 - share);
    const capB = (((drivenFront ? car.brakes.rear : car.brakes.front) * sim.brake + (drivenFront ? car.brakes.hand * sim.handbrake : 0)) * 2) / car.wheel.radius;
    const cap = Math.min(capB, otherN * car.tire.mu) + 0.012 * otherN;
    if (sim.v !== 0) {
      const s = Math.sign(sim.v);
      const v2 = sim.v + ((F - s * cap) / M) * H;
      sim.v = Math.sign(v2) === s ? v2 : Math.abs(F) <= cap ? 0 : ((F - Math.sign(F) * cap) / M) * H;
    } else if (Math.abs(F) > cap) sim.v = ((F - Math.sign(F) * cap) / M) * H;
    sim.t += H;
    for (const e of dt.drainEvents()) sim.ev.push(e);
  };
  sim.run = (sec, fn) => {
    const n = Math.round(sec / H);
    for (let i = 0; i < n; i++) { if (fn) fn(i * H); sim.step(); }
  };
  sim.has = (type) => sim.ev.some((e) => e.type === type);
  sim.clear = () => (sim.ev = []);
  sim.kmh = () => sim.v * 3.6;
  // put the car in gear g, rolling at kmh, engine running, clutch locked
  sim.place = (gear, kmh) => {
    sim.v = kmh / 3.6;
    const w = sim.v / car.wheel.radius;
    sim.wl.omega = sim.wr.omega = w;
    dt.running = true;
    dt.state = gear === 0 ? 'N' : 'ENG';
    dt.gear = gear;
    dt.target = gear;
    dt.lastEngaged = gear;
    dt.locked = gear !== 0;
    dt.omegaE = gear === 0 ? car.engine.idle * SB.RPM2W : Math.max(car.engine.idle * SB.RPM2W, w * Math.abs(dt.ratio(gear)));
    const p = dt.slotPos(gear);
    dt.lever.x = p[0]; dt.lever.y = p[1];
    dt.input.clutch = 0;
    dt.input.throttle = 0;
    dt.speed = sim.v;
    dt.wheelAvg = w;
  };
  return sim;
}

module.exports = { SB, makeSim, H };
