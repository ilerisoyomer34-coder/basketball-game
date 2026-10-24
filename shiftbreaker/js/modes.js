// SHIFTBREAKER — game modes: free roam activities, police, races with AI rivals, drag, parking, license course.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;
  const t = (k, p) => SB.i18n.t(k, p);
  const W2RPM = 60 / (2 * Math.PI);

  // ------------------------------------------------------------------ race events
  SB.RACES = [
    { id: 'coast', type: 'circuit', laps: 3, wp: [[240, -240], [345, -240], [345, 240], [240, 240]], closed: true, rivals: 7, reward: 9000 },
    { id: 'historic', type: 'sprint', wp: [[-240, -240], [-300, -240], [-300, -300], [-360, -300], [-360, -360], [-420, -360], [-420, -420], [-480, -420], [-480, -480], [-540, -480], [-540, -540], [-600, -540], [-600, -600], [-690, -600]], rivals: 5, reward: 7500 },
    { id: 'sprintBridge', type: 'sprint', wp: [[-240, 0], [345, 0], [655, 0], [655, 300], [655, 600]], rivals: 7, reward: 8500 },
    { id: 'drift', type: 'drift', loop: [[205, -690 + 25], [325, -665], [325, -480], [205, -480]], closed: true, time: 90, stars: [6000, 15000, 30000], reward: 6000 },
    { id: 'drag400', type: 'drag', dist: 400, reward: 5000 },
    { id: 'drag800', type: 'drag', dist: 800, reward: 6500 },
    { id: 'business', type: 'timeattack', laps: 2, wp: [[-120, 360], [240, 360], [240, 600], [-120, 600]], closed: true, reward: 7000 },
    { id: 'elim', type: 'elimination', wp: [[-240, -120], [0, -120], [0, 120], [-240, 120]], closed: true, rivals: 5, reward: 10000 },
    { id: 'hill', type: 'hillclimb', edgeName: 'serpUp', rivals: 3, reward: 8000 },
    { id: 'street', type: 'street', wp: [[-120, 360], [240, 360], [240, -240], [-240, -240], [-240, 120]], rivals: 3, reward: 9500, traffic: true },
    { id: 'champ', type: 'championship', events: ['coast', 'sprintBridge', 'hill'], reward: 25000 },
  ];

  // ------------------------------------------------------------------ route
  class Route {
    constructor(world, pts, closed) {
      this.world = world;
      this.closed = closed;
      // resample to 2 m and round corners a little for the racing line
      let p = [];
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
        const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / 2));
        for (let k = 0; k < n; k++) p.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
      }
      if (!closed) p.push([pts[pts.length - 2], pts[pts.length - 1]]);
      for (let it = 0; it < 6; it++) {
        const q = p.map((v) => v.slice());
        for (let i = 1; i < p.length - 1; i++) { q[i][0] = (p[i - 1][0] + p[i][0] * 2 + p[i + 1][0]) / 4; q[i][1] = (p[i - 1][1] + p[i][1] * 2 + p[i + 1][1]) / 4; }
        if (closed && p.length > 2) {
          const n = p.length;
          q[0][0] = (p[n - 1][0] + p[0][0] * 2 + p[1][0]) / 4; q[0][1] = (p[n - 1][1] + p[0][1] * 2 + p[1][1]) / 4;
          q[n - 1][0] = (p[n - 2][0] + p[n - 1][0] * 2 + p[0][0]) / 4; q[n - 1][1] = (p[n - 2][1] + p[n - 1][1] * 2 + p[0][1]) / 4;
        }
        p = q;
      }
      this.p = p;
      const n = p.length;
      this.cum = new Float32Array(n + 1);
      for (let i = 1; i <= n; i++) {
        const a = p[i - 1], b = p[i % n];
        if (i === n && !closed) { this.cum[i] = this.cum[i - 1]; break; }
        this.cum[i] = this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      this.len = closed ? this.cum[n] : this.cum[n - 1];
      // curvature → speed profile (computed per car grip later)
      this.kappa = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = p[(i - 4 + n) % n], b = p[i], c = p[(i + 4) % n];
        if (!closed && (i < 4 || i > n - 5)) { this.kappa[i] = 0; continue; }
        const a1 = Math.atan2(b[0] - a[0], b[1] - a[1]), a2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
        const d = Math.abs(U.angleWrap(a2 - a1));
        this.kappa[i] = d / Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]));
      }
      // road width for lateral room
      this.halfW = p.map(([x, z]) => {
        const r = world.nearestRoad(x, z, false);
        return r ? Math.max(3, r.edge.w / 2 - 1.2) : 4;
      });
    }
    index(s) {
      let sMod = this.closed ? ((s % this.len) + this.len) % this.len : U.clamp(s, 0, this.len);
      let lo = 0, hi = this.p.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.cum[m] <= sMod) lo = m; else hi = m - 1; }
      return { i: lo, f: (sMod - this.cum[lo]) / Math.max(1e-6, this.cum[lo + 1] - this.cum[lo]) };
    }
    at(s, out) {
      const { i, f } = this.index(s);
      const n = this.p.length;
      const a = this.p[i], b = this.p[(i + 1) % n];
      out.x = a[0] + (b[0] - a[0]) * f;
      out.z = a[1] + (b[1] - a[1]) * f;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out.tx = (b[0] - a[0]) / l;
      out.tz = (b[1] - a[1]) / l;
      out.i = i;
      return out;
    }
    // nearest s to (x,z), searching around a hint
    project(x, z, hint) {
      const n = this.p.length;
      let best = -1, bd = Infinity;
      const range = hint == null ? n : 40;
      const start = hint == null ? 0 : hint - 20;
      for (let k = 0; k < range; k++) {
        let i = start + k;
        if (this.closed) i = ((i % n) + n) % n; else if (i < 0 || i >= n - 1) continue;
        const a = this.p[i], b = this.p[(i + 1) % n];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz || 1;
        const tt = U.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1);
        const qx = a[0] + dx * tt, qz = a[1] + dz * tt;
        const d = (qx - x) ** 2 + (qz - z) ** 2;
        if (d < bd) { bd = d; best = i + tt; }
      }
      const i = Math.floor(best);
      return { s: this.cum[i] + (best - i) * (this.cum[i + 1] - this.cum[i]), i, dist: Math.sqrt(bd) };
    }
    speedProfile(mu, vmax) {
      const n = this.p.length;
      const v = new Float32Array(n);
      for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt((mu * 9.81) / Math.max(1e-4, this.kappa[i])));
      const ab = mu * 7.0;
      for (let pass = 0; pass < 2; pass++)
        for (let k = n - 2 + (this.closed ? n : 0); k >= 0; k--) {
          const i = k % n, j = (k + 1) % n;
          const ds = Math.max(0.5, this.cum[i + 1] - this.cum[i]);
          v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * ab * ds));
        }
      return v;
    }
  }
  SB.Route = Route;

  // route polyline from waypoints via road graph shortest paths
  function routeFromWaypoints(world, wp, closed) {
    const ids = wp.map(([x, z]) => world.nearestNode(x, z, false).id);
    if (closed) ids.push(ids[0]);
    let path = [ids[0]];
    for (let i = 0; i < ids.length - 1; i++) {
      const seg = world.findPath(ids[i], ids[i + 1], true) || [ids[i], ids[i + 1]];
      path = path.concat(seg.slice(1));
    }
    const pts = world.pathPolyline(path);
    if (closed) { pts.pop(); pts.pop(); }
    return pts;
  }

  // ------------------------------------------------------------------ gates (checkpoints)
  class Gates {
    constructor(scene) {
      this.scene = scene;
      this.group = new T.Group();
      scene.add(this.group);
      const post = new T.CylinderGeometry(0.22, 0.22, 4.2, 10);
      post.translate(0, 2.1, 0);
      this.postGeo = post;
      this.mats = [new T.MeshBasicMaterial({ color: 0xffb43a }), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })];
      this.bannerMat = [new T.MeshBasicMaterial({ color: 0xffb43a, transparent: true, opacity: 0.85, side: T.DoubleSide }), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: T.DoubleSide })];
      this.items = [];
      for (let k = 0; k < 2; k++) {
        const g = new T.Group();
        const a = new T.Mesh(post, this.mats[k]), b = new T.Mesh(post, this.mats[k]);
        const ban = new T.Mesh(new T.PlaneGeometry(1, 0.8), this.bannerMat[k]);
        g.add(a, b, ban);
        this.group.add(g);
        this.items.push({ g, a, b, ban });
      }
      this.finishMat = null;
    }
    show(k, cp, world, finish) {
      const it = this.items[k];
      if (!cp) { it.g.visible = false; return; }
      it.g.visible = true;
      const y = world.heightAt(cp.x, cp.z);
      it.g.position.set(cp.x, y, cp.z);
      it.g.rotation.y = Math.atan2(cp.tx, cp.tz) + Math.PI / 2;
      it.a.position.set(-cp.w, 0, 0);
      it.b.position.set(cp.w, 0, 0);
      it.ban.position.set(0, 3.8, 0);
      it.ban.scale.set(cp.w * 2, 1, 1);
      it.ban.material = finish ? this.bannerMat[0] : this.bannerMat[k];
    }
    dispose() { this.scene.remove(this.group); }
  }

  // ------------------------------------------------------------------ opponent bodies
  // The simple procedural shape at once; for real cars it is swapped for the light GLB model when loaded.
  function opponentModel(car, color, material) {
    const grp = new T.Group();
    const md = SB.CarModel.buildSimple(car.body === 'track' ? 'track' : car.body === 'coupe' ? 'coupe' : 'hatch');
    const simple = new T.Mesh(md.geo, material || new T.MeshStandardMaterial({ vertexColors: true, color, roughness: 0.35, metalness: 0.3 }));
    simple.castShadow = !material;
    grp.add(simple);
    grp.userData.geo = md.geo;
    if (car.glb && T.GLTFLoader) {
      SB.CarModel.loadGLB(car.glb.lo).then((sc) => {
        if (grp.userData.disposed) return;
        const m = SB.CarModel.buildGLBSimple(sc, car, color, { material });
        m.traverse((o) => { if (o.isMesh) o.castShadow = !material; });
        grp.remove(simple);
        grp.add(m);
        grp.userData.wheels = m.userData.wheels;
      }).catch((e) => console.warn('opponent model kept simple:', e && e.message));
    }
    return { grp, len: md.len, wid: md.wid };
  }
  function disposeOpponent(scene, grp) {
    grp.userData.disposed = true;
    scene.remove(grp);
    grp.userData.geo.dispose();
  }
  function spinWheels(grp, v, dt, R) {
    const ws = grp.userData.wheels;
    if (!ws) return;
    const a = (v * dt) / (R || 0.33);
    for (const w of ws) w.rotation.x += a;
  }

  // ------------------------------------------------------------------ AI rival (simplified manual gearbox)
  class Rival {
    constructor(game, route, carId, level, name, color, lateral) {
      this.game = game;
      this.route = route;
      this.car = SB.DATA.CARS[carId];
      this.L = SB.DATA.AI_LEVELS[level];
      this.name = name;
      this.s = 0;
      this.v = 0;
      this.gear = 1;
      this.shiftT = 0;
      this.lat = lateral;
      this.latT = lateral;
      this.lap = 0;
      this.finished = false;
      this.started = false;
      this.react = this.L.react * (0.8 + Math.random() * 0.5);
      this.mistakeT = 0;
      this.shiftPoint = U.lerp(this.L.shiftLo, this.L.shiftHi, Math.random());
      this.profile = route.speedProfile(this.car.tire.mu * 0.92 * this.L.corner, 85);
      const md = opponentModel(this.car, color);
      this.mesh = md.grp;
      game.scene.add(this.mesh);
      this.len = md.len;
      this.wid = md.wid;
      this.mass = this.car.mass;
      this.pt = { x: 0, z: 0, tx: 0, tz: 1 };
      this.rpm = this.car.engine.idle;
      this.x = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0;
      this.rubber = 1;
      this.eliminated = false;
    }
    dispose() { disposeOpponent(this.game.scene, this.mesh); }
    ratio(g) { const gs = this.car.gears; return gs.ratios[g - 1] * gs.final; }
    update(dt, raceT, others) {
      if (this.eliminated) { this.mesh.visible = false; return; }
      const car = this.car, R = car.wheel.radius;
      if (!this.started) { if (raceT > this.react) this.started = true; else { this.place(); return; } }
      if (this.finished) this.v = Math.max(0, this.v - 4 * dt);
      const r = this.route;
      const look = this.s + Math.max(8, this.v * 1.1);
      const { i } = r.index(look);
      let vT = this.profile[i] * this.L.pace * this.rubber;
      if (this.mistakeT > 0) { this.mistakeT -= dt; vT *= 0.8; } else if (Math.random() < this.L.mistake * dt) this.mistakeT = 0.8;
      // engine-limited acceleration through the gears
      const G = this.ratio(this.gear);
      this.rpm = Math.max(car.engine.idle, (this.v / R) * G * W2RPM);
      let drive = 0;
      if (this.shiftT > 0) this.shiftT -= dt;
      else {
        const tq = car.engine.maxTorque * U.interp(car.engine.curve, Math.min(this.rpm, car.engine.limiter));
        drive = this.rpm >= car.engine.limiter ? 0 : (tq * G * 0.88) / R;
        if (this.rpm > car.engine.redline * this.shiftPoint && this.gear < 6) { this.gear++; this.shiftT = this.L.shiftTime; this.shiftPoint = U.lerp(this.L.shiftLo, this.L.shiftHi, Math.random()); }
        else if (this.gear > 1 && this.rpm < car.engine.redline * 0.5 && this.rpm * (this.ratio(this.gear - 1) / G) < car.engine.redline * 0.88) { this.gear--; this.shiftT = this.L.shiftTime * 0.6; }
      }
      const drag = 0.5 * 1.2 * car.aero.cdA * this.v * this.v + 0.012 * this.mass * 9.81;
      const traction = car.tire.mu * this.mass * 9.81 * 0.55;
      let a;
      if (this.v < vT) a = (Math.min(drive, traction) - drag) / this.mass;
      else a = -Math.min(7.5 * this.L.corner, (this.v - vT) * 3);
      // don't drive into the car ahead
      for (const o of others) {
        if (o === this || o.eliminated) continue;
        const ds = o.progress() - this.progress();
        if (ds > 0 && ds < 9 && Math.abs(o.lat - this.lat) < 1.9) {
          if (o.v < this.v) {
            const hw = r.halfW[i];
            const side = this.lat >= o.lat ? 1 : -1;
            this.latT = U.clamp(o.lat + side * 2.6, -hw, hw);
            if (Math.abs(this.latT) >= hw - 0.1) this.latT = U.clamp(o.lat - side * 2.6, -hw, hw);
            if (ds < 5) a = Math.min(a, (o.v - this.v) * 2);
          }
        }
      }
      this.v = Math.max(0, this.v + a * dt);
      this.lat = U.damp(this.lat, this.latT, 1.5, dt);
      this.s += this.v * dt;
      if (r.closed && this.s >= r.len) { this.s -= r.len; this.lap++; }
      this.place();
    }
    progress() { return this.lap * this.route.len + this.s; }
    place() {
      const r = this.route;
      r.at(this.s, this.pt);
      const p = this.pt;
      const hw = r.halfW[p.i] || 4;
      this.lat = U.clamp(this.lat, -hw, hw);
      this.x = p.x - p.tz * this.lat;
      this.z = p.z + p.tx * this.lat;
      this.yaw = Math.atan2(p.tx, p.tz);
      this.vx = p.tx * this.v;
      this.vz = p.tz * this.v;
      const y = this.game.world.heightAt(this.x, this.z);
      this.mesh.position.set(this.x, y, this.z);
      this.mesh.rotation.set(0, this.yaw, 0);
      spinWheels(this.mesh, this.v, this.game.frameDt || 0.016, this.car.wheel.radius);
      this.y = y + 0.7;
    }
    rect() { return { x: this.x, z: this.z, hl: this.len / 2, hw: this.wid / 2, ang: this.yaw, y: this.y, vx: this.vx, vz: this.vz, mass: this.mass }; }
    bump(res) {
      // pushed by the player: lose speed, slide sideways
      const p = this.pt;
      if (res.push) { this.s += res.push.x * p.tx + res.push.z * p.tz; this.lat += -(res.push.x * -p.tz + res.push.z * p.tx); }
      const dvAlong = (res.dvx || 0) * p.tx + (res.dvz || 0) * p.tz;
      const dvSide = (res.dvx || 0) * -p.tz + (res.dvz || 0) * p.tx;
      this.v = Math.max(0, this.v + dvAlong);
      this.latT = this.lat - dvSide * 0.6;
    }
  }

  // ------------------------------------------------------------------ skill chains
  class Skills {
    constructor(game) { this.game = game; this.chain = []; this.points = 0; this.mult = 1; this.t = 0; this.driftAcc = 0; }
    add(kind, pts) {
      this.chain.push(kind);
      this.mult = Math.min(5, 1 + Math.floor(this.chain.length / 3));
      this.points += pts;
      this.t = 4;
      this.render();
    }
    lose() {
      if (!this.chain.length) return;
      this.game.hud.toast(t('skill.lost'), 'bad', 1.6);
      this.chain = []; this.points = 0; this.mult = 1; this.render();
    }
    update(dt) {
      const pl = this.game.player;
      // drift: slip angle at speed
      const sp = pl.vel.length();
      if (sp > 11 && pl.contactsGround >= 3) {
        const slip = Math.abs(Math.atan2(pl.vel.dot(pl.left), Math.max(0.1, pl.vel.dot(pl.fwd))));
        if (slip > 0.26 && slip < 1.5) { this.driftAcc += slip * sp * dt * 18; if (this.driftAcc > 120) { this.add('drift', Math.round(this.driftAcc)); this.driftAcc = 0; } }
      }
      if (pl.airTime > 0.6 && !this._air) { this._air = true; }
      if (this._air && pl.contactsGround >= 3) { if (pl.lastAir > 0.6) this.add('air', Math.round(pl.lastAir * 300)); this._air = false; }
      if (this.t > 0) {
        this.t -= dt;
        if (this.t <= 0 && this.chain.length) {
          const total = this.points * this.mult;
          const cr = Math.round(total * SB.DATA.ECONOMY.skillToCredits);
          this.game.addCredits(cr);
          this.game.hud.toast(t('skill.banked', { n: U.fmtInt(total), c: U.fmtInt(cr) }), 'good', 2.4);
          this.chain = []; this.points = 0; this.mult = 1;
        }
        this.render();
      }
    }
    render() {
      const el = document.getElementById('skills');
      if (!this.chain.length) { el.hidden = true; return; }
      el.hidden = false;
      const last = this.chain.slice(-3).map((k) => t('skill.' + k)).join(' · ');
      el.innerHTML = `<div class="sk-mult">×${this.mult}</div><div class="sk-pts">${U.fmtInt(this.points)}</div><div class="sk-list"></div><div class="sk-bar" style="width:${U.clamp(this.t / 4, 0, 1) * 100}%"></div>`;
      el.querySelector('.sk-list').textContent = last;
    }
  }

  // ------------------------------------------------------------------ free roam
  class FreeRoam {
    constructor(game) {
      this.game = game;
      this.kind = 'free';
      this.noTraffic = false;
      this.trapLast = {};
      this.radarLast = {};
      this.drift = null;
      this.jump = null;
      this.redCooldown = 0;
      this.hitRun = null;
      this.wrongT = 0;
      this.nazarMeshes = [];
      this.buildNazar();
      this.markers = this.buildMarkers();
    }
    buildNazar() {
      const g = this.game, W = g.world;
      const ring = new T.TorusGeometry(0.55, 0.16, 10, 24);
      const eye = new T.CircleGeometry(0.42, 20);
      const blue = new T.MeshStandardMaterial({ color: 0x1d4fd6, emissive: new T.Color(0x0a2a9a), emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.2 });
      const white = new T.MeshBasicMaterial({ color: 0xf4f6ff, side: T.DoubleSide });
      const iris = new T.MeshBasicMaterial({ color: 0x5ab8ff, side: T.DoubleSide });
      const pupil = new T.MeshBasicMaterial({ color: 0x08142c, side: T.DoubleSide });
      for (const c of W.collectibles) {
        if (g.save.collected[c.id]) continue;
        const grp = new T.Group();
        grp.add(new T.Mesh(ring, blue));
        const e1 = new T.Mesh(eye, white); grp.add(e1);
        const e2 = new T.Mesh(new T.CircleGeometry(0.27, 18), iris); e2.position.z = 0.01; grp.add(e2);
        const e3 = new T.Mesh(new T.CircleGeometry(0.12, 14), pupil); e3.position.z = 0.02; grp.add(e3);
        grp.position.set(c.x, W.heightAt(c.x, c.z) + 1.4, c.z);
        g.scene.add(grp);
        this.nazarMeshes.push({ c, grp });
      }
    }
    buildMarkers() {
      const g = this.game, W = g.world;
      const out = [];
      const geo = new T.CylinderGeometry(1, 1, 0.12, 40, 1, true);
      for (const p of W.pois) {
        const col = new T.Color(SB.HUD.POI_COLORS[p.type] || '#ffffff');
        const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
        m.scale.set(p.r, 6, p.r);
        m.position.set(p.x, W.heightAt(p.x, p.z) + 0.4, p.z);
        g.scene.add(m);
        out.push({ p, m });
      }
      return out;
    }
    dispose() {
      for (const n of this.nazarMeshes) this.game.scene.remove(n.grp);
      for (const m of this.markers) this.game.scene.remove(m.m);
    }
    setVisible(v) {
      for (const n of this.nazarMeshes) n.grp.visible = v;
      for (const m of this.markers) m.m.visible = v;
    }
    nearPOI() {
      const pl = this.game.player;
      let best = null;
      for (const { p } of this.markers) {
        const d = Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z);
        if (d < p.r + 1.5 && (!best || d < best.d)) best = { p, d };
      }
      return best && best.p;
    }
    update(dt) {
      const g = this.game, W = g.world, pl = g.player;
      const kmh = Math.abs(pl.speed) * 3.6;
      for (const m of this.markers) m.m.material.opacity = 0.35 + Math.sin(g.time * 3) * 0.15;
      // POI prompt
      const poi = this.nearPOI();
      this.poi = poi && kmh < 14 ? poi : null;
      g.hud.prompt(this.poi ? t('poi.prompt.' + this.poi.type, { key: g.keyLabel('interact') }) : null);
      // collectibles
      for (const n of this.nazarMeshes) {
        if (!n.grp.visible) continue;
        n.grp.rotation.y += dt * 2;
        if (Math.hypot(n.c.x - pl.pos.x, n.c.z - pl.pos.z) < 3.2 && Math.abs(n.grp.position.y - pl.pos.y) < 4) {
          n.grp.visible = false;
          g.save.collected[n.c.id] = true;
          g.addCredits(SB.DATA.ECONOMY.collectible);
          const have = Object.keys(g.save.collected).length;
          g.hud.toast(t('nazar.found', { n: have, total: W.collectibles.length }), 'good', 2.5);
          g.audio.chime();
          if (have >= W.collectibles.length) g.achieve('nazar');
          g.persist();
        }
      }
      // speed traps
      for (const tr of W.speedTraps) {
        const d = Math.hypot(tr.x - pl.pos.x, tr.z - pl.pos.z);
        if (d < 11 && !this.trapLast[tr.id] && kmh > 30) {
          this.trapLast[tr.id] = true;
          const best = g.save.records['trap_' + tr.id] || 0;
          const stars = tr.stars.filter((s) => kmh >= s).length;
          if (kmh > best) g.save.records['trap_' + tr.id] = Math.round(kmh);
          g.hud.big(t('trap.title') + ' ' + Math.round(kmh) + ' ' + t('ui.kmh'), '★'.repeat(stars) + '☆'.repeat(3 - stars) + (kmh > best ? '  ' + t('ui.newRecord') : ''), 2.2, 'good');
          if (kmh > 250) g.achieve('speed');
          g.audio.chime();
        } else if (d > 25) this.trapLast[tr.id] = false;
      }
      // radar cameras (fines)
      for (const r of W.radars) {
        const d = Math.hypot(r.x - pl.pos.x, r.z - pl.pos.z);
        if (d < 14 && !this.radarLast[r.id]) {
          this.radarLast[r.id] = true;
          if (kmh > r.limit + 10) { g.hud.flash(); g.police.crime('radar'); }
        } else if (d > 30) this.radarLast[r.id] = false;
      }
      // red lights
      this.redCooldown -= dt;
      if (kmh > 15 && this.redCooldown <= 0) {
        for (const s of W.signals) {
          const n = W.nodes[s.node];
          if (Math.abs(pl.pos.x - n.x) < n.half && Math.abs(pl.pos.z - n.z) < n.half) {
            const vx = pl.vel.x, vz = pl.vel.z;
            const axis = Math.abs(vz) >= Math.abs(vx) ? 'NS' : 'EW';
            if (s.state[axis] === 'red' && (!this.lastNode || this.lastNode !== n.id)) { g.police.crime('redLight'); this.redCooldown = 6; }
            this.lastNode = n.id;
          }
        }
      }
      // drift zones
      for (const z of W.driftZones) {
        const inside = Math.hypot(z.x - pl.pos.x, z.z - pl.pos.z) < z.r;
        if (inside && !this.drift) { this.drift = { z, score: 0, t: 0 }; g.hud.toast(t('drift.enter'), 'info', 1.6); }
        if (this.drift && this.drift.z === z) {
          if (!inside) {
            const sc = Math.round(this.drift.score);
            const st = z.stars.filter((s) => sc >= s).length;
            const best = g.save.records['drift_' + z.id] || 0;
            if (sc > best) g.save.records['drift_' + z.id] = sc;
            if (sc > 0) g.hud.big(t('drift.score', { n: U.fmtInt(sc) }), '★'.repeat(st) + '☆'.repeat(3 - st), 2.4, 'good');
            if (sc >= 15000) g.achieve('drift');
            this.drift = null;
          } else {
            const sp = pl.vel.length();
            const slip = Math.abs(Math.atan2(pl.vel.dot(pl.left), Math.max(0.1, pl.vel.dot(pl.fwd))));
            if (sp > 8 && slip > 0.25 && slip < 1.5) this.drift.score += slip * sp * dt * 60;
            g.hud.setText('driftScore', t('drift.live', { n: U.fmtInt(Math.round(this.drift.score)) }));
          }
        }
      }
      g.hud.show('driftScore', !!this.drift);
      // jumps
      if (pl.airTime > 0.25 && !this.jump) this.jump = { x: pl.pos.x, z: pl.pos.z };
      if (this.jump && pl.contactsGround >= 2 && pl.airTime === 0) {
        const d = Math.hypot(pl.pos.x - this.jump.x, pl.pos.z - this.jump.z);
        if (d > 12) {
          const best = g.save.records.jump || 0;
          if (d > best) g.save.records.jump = Math.round(d);
          g.hud.big(t('jump.dist', { n: d.toFixed(1) }), d > best ? t('ui.newRecord') : '', 1.8, 'good');
        }
        this.jump = null;
      }
      // hit-and-run: drove away after hitting traffic
      if (this.hitRun) {
        this.hitRun.t += dt;
        const d = Math.hypot(pl.pos.x - this.hitRun.x, pl.pos.z - this.hitRun.z);
        if (kmh < 3 && d < 25) this.hitRun = null;
        else if (d > 45 && this.hitRun.t < 10) { g.police.crime('hitAndRun'); this.hitRun = null; }
        else if (this.hitRun.t > 10) this.hitRun = null;
      }
      // wrong way on two-way roads (right-hand traffic)
      if (kmh > 35) {
        const r = W.nearestRoad(pl.pos.x, pl.pos.z, true);
        if (r && r.dist < r.edge.w / 2 && r.edge.kind !== 'lane') {
          const along = pl.vel.x * r.tx + pl.vel.z * r.tz;
          const side = (pl.pos.x - r.x) * -r.tz + (pl.pos.z - r.z) * r.tx; // + is right of a→b
          const wrong = (along > 0 && side < -1.2) || (along < 0 && side > 1.2);
          this.wrongT = wrong ? this.wrongT + dt : 0;
          if (this.wrongT > 4) { this.wrongT = -20; g.police.crime('wrongWay'); }
        }
      }
    }
    onImpact(e) {
      // hitting a traffic or parked car and driving off is a hit-and-run (rammed cruisers are handled by the police)
      const o = e.other && (e.other.src || (e.other.parked ? e.other : null));
      if (o && !o.isPolice && e.speed > 5) this.hitRun = { x: this.game.player.pos.x, z: this.game.player.pos.z, t: 0 };
    }
    minimapDots(dot) {
      for (const n of this.nazarMeshes) if (n.grp.visible) dot(n.c.x, n.c.z, '#2e6bff', 3.5);
      for (const tr of this.game.world.speedTraps) dot(tr.x, tr.z, '#ff9f1a', 3.5);
    }
  }

  // ------------------------------------------------------------------ race (circuit/sprint/time attack/elimination/hillclimb/street/drift)
  class Race {
    constructor(game, ev, opts) {
      this.game = game;
      this.ev = ev;
      this.kind = 'race';
      this.opts = opts;
      this.noTraffic = !ev.traffic;
      this.noPolice = true;
      const W = game.world;
      let pts;
      if (ev.type === 'hillclimb') {
        const e = W.edges.find((x) => x.name === ev.edgeName);
        pts = Array.from(e.pts);
      } else if (ev.type === 'drift') {
        pts = [];
        for (const [x, z] of ev.loop) pts.push(x, z);
      } else pts = routeFromWaypoints(W, ev.wp, ev.closed);
      this.route = new Route(W, pts, !!ev.closed);
      this.routePts = this.route.p.flatMap((p) => p);
      if (ev.closed) this.routePts.push(this.route.p[0][0], this.route.p[0][1]);
      this.laps = ev.type === 'elimination' ? (ev.rivals || 5) + 1 : ev.laps || 1;
      if (opts.laps) this.laps = opts.laps;
      this.gates = new Gates(game.scene);
      // checkpoints every ~110 m
      this.cps = [];
      const step = ev.type === 'drift' ? 60 : 110;
      const L = this.route.len;
      const pt = { x: 0, z: 0, tx: 0, tz: 0 };
      for (let s = step; s < L - (ev.closed ? 20 : 1); s += step) { this.route.at(s, pt); this.cps.push({ s, x: pt.x, z: pt.z, tx: pt.tx, tz: pt.tz, w: this.route.halfW[pt.i] + 2.2 }); }
      this.route.at(ev.closed ? 0.01 : L - 0.01, pt);
      this.cps.push({ s: ev.closed ? L : L, x: pt.x, z: pt.z, tx: pt.tx, tz: pt.tz, w: this.route.halfW[pt.i] + 2.2, finish: true });
      this.cpi = 0;
      this.lap = 0;
      this.t = -3.5;
      this.lapStart = 0;
      this.best = Infinity;
      this.lapTimes = [];
      this.rivals = [];
      this.finished = false;
      this.result = null;
      this.driftScore = 0;
      this.ghostRec = [];
      this.rewinds = game.rewindAllowance();
      const n = ev.type === 'timeattack' || ev.type === 'drift' ? 0 : Math.min(11, opts.rivals != null ? opts.rivals : ev.rivals || 0);
      const lvl = opts.ai != null ? opts.ai : game.settings.aiLevel;
      const names = SB.DATA.AI_NAMES.slice().sort(() => Math.random() - 0.5);
      // grid: two cars per row, the player starts at the back. Closed routes start behind the line.
      const gridBack = 8 * (Math.floor(n / 2) + 1);
      for (let i = 0; i < n; i++) {
        const lat = (i % 2 ? 1 : -1) * 2.2;
        const r = new Rival(game, this.route, game.player.car.id, lvl, names[i], U.pick(SB.DATA.PAINT), lat);
        const row = Math.floor(i / 2);
        if (ev.closed) { r.s = this.route.len - 8 * (row + 1); r.lap = -1; }
        else r.s = gridBack - 8 * row;
        r.place();
        this.rivals.push(r);
      }
      this.playerS0 = ev.closed ? this.route.len - gridBack : 0.5;
      this.route.at(this.playerS0, pt);
      const plat = n % 2 ? 2.2 : 0;
      game.player.place(pt.x - pt.tz * plat, pt.z + pt.tx * plat, Math.atan2(pt.tx, pt.tz));
      game.prepareStart(true);
      this.pHint = this.route.project(game.player.pos.x, game.player.pos.z).i;
      this.pS = this.playerS0;
      this.pLap = ev.closed ? -1 : 0;
      this.ghost = ev.type === 'timeattack' ? game.loadGhost(ev.id) : null;
      if (this.ghost) this.buildGhost();
      this.countdown = 3.5;
      if (game.settings.racingLine) this.buildLine();
      game.hud.show('racePanel', true);
      this.updateGates();
    }
    // ground ribbon along the route, coloured against the player's current speed:
    // green = throttle, amber = ease off, red = brake zone for the corner ahead
    buildLine() {
      const r = this.route, n = r.p.length, W = this.game.world;
      this.lineMu = this.game.player.car.tire.mu * 0.85;
      this.lineV = r.speedProfile(this.lineMu, 90);
      const segs = r.closed ? n : n - 1;
      const pos = new Float32Array((segs + 1) * 6), col = new Float32Array((segs + 1) * 6), idx = [];
      for (let k = 0; k <= segs; k++) {
        const i = k % n, a = r.p[(i - 1 + n) % n], b = r.p[(i + 1) % n], c = r.p[i];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        if (!r.closed && (k === 0 || k === segs)) { const o = r.p[k === 0 ? 1 : n - 2]; tx = (c[0] - o[0]) * (k === 0 ? -1 : 1); tz = (c[1] - o[1]) * (k === 0 ? -1 : 1); }
        const l = Math.hypot(tx, tz) || 1, nx = (-tz / l) * 0.4, nz = (tx / l) * 0.4;
        const y = W.heightAt(c[0], c[1]) + 0.07;
        pos.set([c[0] + nx, y, c[1] + nz, c[0] - nx, y, c[1] - nz], k * 6);
        col.set([0.15, 0.85, 0.3, 0.15, 0.85, 0.3], k * 6);
        if (k < segs) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, fog: false });
      this.lineMesh = new T.Mesh(geo, mat);
      this.lineMesh.renderOrder = 2;
      this.lineSegs = segs;
      this.game.scene.add(this.lineMesh);
    }
    paintLine() {
      const r = this.route, n = r.p.length, v = this.lineV, segs = this.lineSegs;
      const col = this.lineMesh.geometry.attributes.color;
      const sp = Math.abs(this.game.player.speed), p0 = this.pHint;
      for (let d = -10; d <= 200; d++) {
        let k = p0 + d;
        if (r.closed) k = ((k % (segs + 1)) + (segs + 1)) % (segs + 1); else if (k < 0 || k > segs) continue;
        // the braking profile drops below the current speed here → the brake zone starts
        const q = sp / Math.max(1, v[k % n]);
        let cr, cg, cb;
        if (q > 0.97) { cr = 0.95; cg = 0.12; cb = 0.06; }
        else if (q > 0.85) { const f = (q - 0.85) / 0.12; cr = 1.0 - 0.05 * f; cg = 0.62 - 0.5 * f; cb = 0.08 - 0.02 * f; }
        else { const f = U.clamp((q - 0.7) / 0.15, 0, 1); cr = 0.15 + 0.85 * f; cg = 0.85 - 0.23 * f; cb = 0.3 - 0.22 * f; }
        col.setXYZ(k * 2, cr, cg, cb);
        col.setXYZ(k * 2 + 1, cr, cg, cb);
      }
      col.needsUpdate = true;
    }
    buildGhost() {
      this.ghostMesh = opponentModel(this.game.player.car, 0x7fd3ff, new T.MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.35, depthWrite: false })).grp;
      this.game.scene.add(this.ghostMesh);
    }
    dispose() {
      for (const r of this.rivals) r.dispose();
      this.gates.dispose();
      if (this.ghostMesh) disposeOpponent(this.game.scene, this.ghostMesh);
      if (this.lineMesh) { this.game.scene.remove(this.lineMesh); this.lineMesh.geometry.dispose(); this.lineMesh.material.dispose(); }
      this.game.hud.show('racePanel', false);
      this.game.hud.show('raceLights', false);
    }
    updateGates() {
      const c0 = this.cps[this.cpi], c1 = this.cps[this.cpi + 1];
      this.gates.show(0, c0, this.game.world, c0 && c0.finish && this.lap >= this.laps - 1);
      this.gates.show(1, this.ev.type === 'drift' ? null : c1, this.game.world, false);
    }
    playerProgress() { return this.pLap * this.route.len + this.pS; }
    position() {
      const mine = this.playerProgress();
      let pos = 1;
      for (const r of this.rivals) if (!r.eliminated && (r.finished ? r.finishT < (this.finishT || Infinity) : r.progress() + (this.ev.closed ? 0 : 0) > mine)) pos++;
      return pos;
    }
    update(dt) {
      const g = this.game, pl = g.player;
      if (this.countdown > 0) {
        const prevOn = Math.min(3, Math.floor(3.5 - this.countdown + 0.5));
        this.countdown -= dt;
        const on = Math.min(3, Math.floor(3.5 - this.countdown + 0.5));
        const go = this.countdown <= 0;
        g.hud.show('raceLights', true);
        g.hud.setHTML('raceLights', [0, 1, 2].map((i) => `<i class="${go ? 'go' : i < on ? 'on' : ''}"></i>`).join(''));
        if (on !== prevOn && !go) g.audio.beep(660, 0.15, 0.15);
        if (go) { g.audio.beep(1320, 0.4, 0.2); g.hud.big(t('race.go'), '', 1, 'good'); setTimeout(() => g.hud.show('raceLights', false), 900); this.t = 0; g.goHintT = 1.4; }
        else { g.lockPlayer = 'hold'; for (const r of this.rivals) r.place(); this.renderPanel(); return; }
      }
      g.lockPlayer = null;
      if (!this.finished) this.t += dt;
      // rivals
      const raceT = this.t;
      for (const r of this.rivals) {
        if (g.settings.rubberBand !== false && this.opts.rubber !== false) {
          const gap = r.progress() - this.playerProgress();
          r.rubber = U.clamp(1 - gap / 1800, 0.9, 1.06);
        }
        r.update(dt, raceT, this.rivals);
        if (!r.finished && r.lap >= this.laps && this.ev.closed) { r.finished = true; r.finishT = this.t; }
        if (!r.finished && !this.ev.closed && r.s >= this.route.len - 0.5) { r.finished = true; r.finishT = this.t; }
      }
      // player progress & checkpoints
      const pr = this.route.project(pl.pos.x, pl.pos.z, this.pHint);
      this.pHint = pr.i;
      const prevS = this.pS;
      this.pS = pr.s;
      if (this.lineMesh) this.paintLine();
      if (this.ev.closed && prevS > this.route.len * 0.8 && this.pS < this.route.len * 0.2) this.pLap += 1;
      if (this.ev.closed && prevS < this.route.len * 0.2 && this.pS > this.route.len * 0.8) this.pLap -= 1;
      const cp = this.cps[this.cpi];
      if (cp && !this.finished) {
        const lx = -cp.tz, lz = cp.tx;
        const crossed = U.segCross(this.lastX ?? pl.pos.x, this.lastZ ?? pl.pos.z, pl.pos.x, pl.pos.z, cp.x - lx * cp.w, cp.z - lz * cp.w, cp.x + lx * cp.w, cp.z + lz * cp.w) >= 0;
        if (crossed) this.passCheckpoint(cp);
      }
      this.lastX = pl.pos.x;
      this.lastZ = pl.pos.z;
      // wrong way
      const pt = this.route.at(this.pS, {});
      const along = pl.vel.x * pt.tx + pl.vel.z * pt.tz;
      this.wrongT = along < -3 ? (this.wrongT || 0) + dt : 0;
      g.hud.show('wrongWay', this.wrongT > 1.2);
      // drift scoring
      if (this.ev.type === 'drift' && !this.finished) {
        const sp = pl.vel.length();
        const slip = Math.abs(Math.atan2(pl.vel.dot(pl.left), Math.max(0.1, pl.vel.dot(pl.fwd))));
        if (sp > 8 && slip > 0.25 && slip < 1.5) this.driftScore += slip * sp * dt * 60;
        if (this.t >= this.ev.time) this.finish();
      }
      // ghost record + playback
      if (this.ev.type === 'timeattack' && !this.finished) {
        if (!this._gt || this.t - this._gt >= 0.1) { this._gt = this.t; this.ghostRec.push([+pl.pos.x.toFixed(2), +pl.pos.y.toFixed(2), +pl.pos.z.toFixed(2), +pl.yaw.toFixed(3)]); }
        if (this.ghostMesh && this.ghost) {
          const k = Math.min(this.ghost.frames.length - 1, Math.floor(this.t / 0.1));
          const f = this.ghost.frames[k];
          if (f) { this.ghostMesh.position.set(f[0], f[1] - pl.car.cgHeight, f[2]); this.ghostMesh.rotation.set(0, f[3], 0); }
        }
      }
      if (this.ev.type === 'elimination') this.checkElimination();
      this.renderPanel();
      if (this.finished && !this.result) this.finalize();
    }
    passCheckpoint(cp) {
      const g = this.game;
      g.audio.beep(cp.finish ? 1500 : 1100, 0.08, 0.12);
      this.cpi++;
      if (cp.finish) {
        const lapT = this.t - this.lapStart;
        this.lapTimes.push(lapT);
        if (lapT < this.best) this.best = lapT;
        this.lap++;
        this.lapStart = this.t;
        if (this.lap >= this.laps || !this.ev.closed) { this.finish(); return; }
        g.hud.toast(t('race.lap', { n: this.lap + 1, total: this.laps }) + '  ' + U.fmtTime(lapT), 'info', 2);
        this.cpi = 0;
      }
      this.updateGates();
    }
    checkElimination() {
      const alive = this.rivals.filter((r) => !r.eliminated);
      const leaderLap = Math.max(this.lap, ...alive.map((r) => r.lap));
      if (leaderLap > (this.elimLap || 0) && leaderLap < this.laps) {
        this.elimLap = leaderLap;
        // last place drops out
        let last = null, lp = Infinity;
        for (const r of alive) if (r.progress() < lp) { lp = r.progress(); last = r; }
        if (this.playerProgress() < lp) { this.game.hud.big(t('race.eliminated'), '', 2.5, 'bad'); this.finish(true); return; }
        if (last) { last.eliminated = true; this.game.hud.toast(t('race.out', { name: last.name }), 'warn', 2); }
        if (!this.rivals.some((r) => !r.eliminated)) this.finish();
      }
    }
    finish(dnf) {
      if (this.finished) return;
      this.finished = true;
      this.finishT = this.t;
      this.dnf = !!dnf;
      this.gates.show(0, null); this.gates.show(1, null);
    }
    renderPanel() {
      const g = this.game, ev = this.ev;
      const lines = [];
      const T_ = (k) => t(k);
      if (ev.type === 'drift') {
        lines.push(`<div class="rp-big">${U.fmtInt(Math.round(this.driftScore))}</div><div class="rp-lbl">${T_('race.driftPts')}</div>`);
        lines.push(`<div class="rp-row"><span>${T_('race.time')}</span><b>${Math.max(0, ev.time - Math.max(0, this.t)).toFixed(1)}</b></div>`);
      } else {
        if (this.rivals.length) lines.push(`<div class="rp-big">${this.position()}<small>/${this.rivals.filter((r) => !r.eliminated).length + 1}</small></div><div class="rp-lbl">${T_('race.pos')}</div>`);
        if (ev.closed) lines.push(`<div class="rp-row"><span>${T_('race.lapLbl')}</span><b>${Math.min(this.laps, this.lap + 1)}/${this.laps}</b></div>`);
        lines.push(`<div class="rp-row"><span>${T_('race.time')}</span><b>${U.fmtTime(Math.max(0, this.t))}</b></div>`);
        if (isFinite(this.best)) lines.push(`<div class="rp-row"><span>${T_('race.best')}</span><b>${U.fmtTime(this.best)}</b></div>`);
        if (this.ghost) lines.push(`<div class="rp-row"><span>${T_('race.ghost')}</span><b>${U.fmtTime(this.ghost.time)}</b></div>`);
      }
      if (isFinite(this.rewinds)) lines.push(`<div class="rp-row"><span>${T_('race.rewinds')}</span><b>${this.rewinds}</b></div>`);
      g.hud.setHTML('racePanel', lines.join(''));
    }
    finalize() {
      const g = this.game, ev = this.ev;
      const pos = this.rivals.length ? this.position() : 1;
      let mult = SB.DATA.REWARD.aiMult[this.opts.ai != null ? this.opts.ai : g.settings.aiLevel];
      mult *= SB.DATA.REWARD.gearbox[this.opts.gearbox || 'clutch'];
      mult *= g.assistMultiplier();
      let base = ev.reward;
      let stars = 0;
      if (ev.type === 'drift') { stars = ev.stars.filter((s) => this.driftScore >= s).length; base *= stars / 3; }
      else if (ev.type === 'timeattack') {
        const prev = g.save.records['ta_' + ev.id];
        if (!prev || this.t < prev) { g.save.records['ta_' + ev.id] = this.t; g.saveGhost(ev.id, { time: this.t, frames: this.ghostRec }); }
        base *= prev && this.t < prev ? 1.2 : 0.8;
      } else base *= SB.DATA.REWARD.positions[pos - 1] || 0.04;
      if (this.dnf) base = 0;
      const reward = Math.round(base * mult / 10) * 10;
      g.addCredits(reward);
      if (!this.dnf && pos === 1 && this.rivals.length) g.achieve('firstWin');
      this.result = { pos, time: this.t, best: this.best, reward, dnf: this.dnf, drift: Math.round(this.driftScore), stars, field: this.rivals.length + 1 };
      g.persist();
      setTimeout(() => g.ui.raceResult(this), 1200);
    }
    minimapDots(dot) {
      for (const r of this.rivals) if (!r.eliminated) dot(r.x, r.z, '#ffffff', 3.5);
      const c = this.cps[this.cpi];
      if (c) dot(c.x, c.z, '#ffb43a', 5);
    }
  }

  // ------------------------------------------------------------------ drag race (runway, christmas tree)
  class Drag {
    constructor(game, ev, opts) {
      this.game = game;
      this.ev = ev;
      this.opts = opts;
      this.kind = 'drag';
      this.noTraffic = true;
      this.noPolice = true;
      this.x0 = 783; this.z0 = -570;
      this.zEnd = this.z0 + ev.dist;
      this.state = 'stage';
      this.t = 0;
      this.tree = -2.6;
      this.rewinds = 0;
      const pl = game.player;
      pl.place(this.x0, this.z0, 0);
      game.prepareStart(true);
      const md = opponentModel(pl.car, U.pick(SB.DATA.PAINT));
      this.rival = { mesh: md.grp, z: this.z0, v: 0, gear: 1, shiftT: 0, car: pl.car, L: SB.DATA.AI_LEVELS[opts.ai != null ? opts.ai : game.settings.aiLevel], started: false, x: 797, len: md.len, wid: md.wid };
      game.scene.add(this.rival.mesh);
      this.placeRival();
      this.perfect = 0;
      this.shifts = 0;
      game.hud.show('racePanel', true);
    }
    dispose() { disposeOpponent(this.game.scene, this.rival.mesh); this.game.hud.show('racePanel', false); for (const m of this.game.world.dragTree) m.emissiveIntensity = 0.05; }
    placeRival() {
      const r = this.rival;
      r.mesh.position.set(r.x, this.game.world.heightAt(r.x, r.z), r.z);
      spinWheels(r.mesh, r.v, this.game.frameDt || 0.016, r.car.wheel.radius);
      r.mesh.rotation.y = 0;
      r.vx = 0; r.vz = r.v;
    }
    update(dt) {
      const g = this.game, pl = g.player, tree = g.world.dragTree;
      if (this.state === 'stage') {
        this.tree += dt;
        const k = this.tree;
        // pre-stage/stage → three ambers 0.5 s apart → green
        tree.forEach((m, i) => (m.emissiveIntensity = 0.05));
        if (k > -2.0) tree[0].emissiveIntensity = 2;
        if (k > -1.4) tree[1].emissiveIntensity = 2;
        if (k > -1.0) tree[2].emissiveIntensity = 2.4;
        if (k > -0.5) tree[3].emissiveIntensity = 2.4;
        if (k > 0) tree[4].emissiveIntensity = 2.4;
        g.lockPlayer = null;
        if (Math.abs(pl.pos.z - this.z0) > 0.6 && k < 0.5) { tree[7].emissiveIntensity = 3; this.state = 'done'; this.result = { foul: true }; g.hud.big(t('drag.foul'), '', 2.5, 'bad'); setTimeout(() => g.ui.dragResult(this), 1800); return; }
        if (k > 0.5) { tree[6].emissiveIntensity = 3; this.state = 'run'; this.t = 0; g.audio.beep(1400, 0.25, 0.18); this.react = null; }
        this.renderPanel();
        return;
      }
      if (this.state !== 'run') return;
      this.t += dt;
      if (this.react == null && Math.abs(pl.pos.z - this.z0) > 0.3) this.react = this.t;
      if (this.t > 0.9) for (const m of tree) m.emissiveIntensity = 0.05;
      // rival longitudinal sim (same gearbox model as race rivals)
      const r = this.rival, car = r.car, R = car.wheel.radius;
      if (!r.started && this.t > r.L.react) r.started = true;
      if (r.started && !r.done) {
        const G = car.gears.ratios[r.gear - 1] * car.gears.final;
        const rpm = Math.max(car.engine.idle, (r.v / R) * G * W2RPM);
        let F = 0;
        if (r.shiftT > 0) r.shiftT -= dt;
        else {
          F = rpm >= car.engine.limiter ? 0 : (car.engine.maxTorque * U.interp(car.engine.curve, rpm) * G * 0.88) / R;
          if (rpm > car.engine.redline * U.lerp(r.L.shiftLo, r.L.shiftHi, 0.5) && r.gear < 6) { r.gear++; r.shiftT = r.L.shiftTime; }
        }
        F = Math.min(F, car.tire.mu * car.mass * 9.81 * 0.55);
        r.v += ((F - 0.5 * 1.2 * car.aero.cdA * r.v * r.v - 0.012 * car.mass * 9.81) / car.mass) * dt;
        r.z += r.v * dt;
        if (r.z >= this.zEnd && !r.done) { r.done = true; r.et = this.t; }
      } else if (r.done) { r.v = Math.max(0, r.v - 6 * dt); r.z += r.v * dt; }
      this.placeRival();
      if (pl.pos.z >= this.zEnd && !this.et) {
        this.et = this.t;
        this.trap = Math.abs(pl.speed) * 3.6;
        this.state = 'done';
        this.result = { et: this.et, trap: this.trap, react: this.react || 0, win: !r.done || this.et < r.et, rivalEt: r.et, perfect: this.perfect, shifts: this.shifts };
        const E = SB.DATA.REWARD;
        const reward = Math.round(((this.result.win ? 1 : 0.35) * this.ev.reward * E.aiMult[this.opts.ai != null ? this.opts.ai : g.settings.aiLevel] * E.gearbox[this.opts.gearbox || 'clutch'] * g.assistMultiplier()) / 10) * 10;
        this.result.reward = reward;
        g.addCredits(reward);
        const key = 'drag_' + this.ev.dist;
        if (!g.save.records[key] || this.et < g.save.records[key]) g.save.records[key] = this.et;
        g.persist();
        setTimeout(() => g.ui.dragResult(this), 1500);
      }
      this.renderPanel();
    }
    onShift(e) {
      if (this.state !== 'run' || e.type !== 'engage') return;
      this.shifts++;
    }
    onPerfect() { if (this.state === 'run') { this.perfect++; this.game.hud.big(t('drag.perfect'), '', 0.9, 'good'); } }
    renderPanel() {
      const pl = this.game.player;
      const d = Math.max(0, pl.pos.z - this.z0);
      this.game.hud.setHTML('racePanel', `<div class="rp-big">${Math.min(this.ev.dist, d).toFixed(0)}<small> m</small></div><div class="rp-lbl">${t('drag.title', { n: this.ev.dist })}</div><div class="rp-row"><span>${t('race.time')}</span><b>${this.state === 'run' ? this.t.toFixed(3) : '0.000'}</b></div><div class="rp-row"><span>${t('drag.react')}</span><b>${this.react != null ? this.react.toFixed(3) : '-'}</b></div><div class="rp-row"><span>${t('drag.perfectN')}</span><b>${this.perfect}</b></div>`);
    }
    minimapDots(dot) { dot(this.rival.x, this.rival.z, '#fff', 3.5); }
  }

  // ------------------------------------------------------------------ parking missions
  const PARK = {
    parallel: { start: [64, 117, Math.PI / 2], target: { x: 90, z: 114.9, ang: Math.PI / 2, hl: 3.3, hw: 1.15 }, cars: [[95.7, 114.9, Math.PI / 2], [84.3, 114.9, Math.PI / 2]], par: { time: 60, moves: 4 }, curb: { axis: 'z', at: 114.0 } },
    bay: { start: [150, -48, Math.PI / 2], target: { x: 136 + 9.5 * 2.75, z: -36, ang: Math.PI, hl: 2.6, hw: 1.375 }, par: { time: 45, moves: 3 } },
    angled: { start: [150, -78, Math.PI / 2], target: { x: 140 + 10.5 * 3.8, z: -97, ang: -0.75 * Math.PI, hl: 2.6, hw: 1.35 }, par: { time: 40, moves: 2 } },
    hill: { start: [-418, -304, 0], target: { x: -423.1, z: -268, ang: 0, hl: 3.3, hw: 1.15 }, cars: [[-423.1, -262.3, 0], [-423.1, -273.7, 0]], par: { time: 70, moves: 4 }, hill: true },
    exit: { start: [17, -95, Math.PI], target: { x: 17, z: -66, ang: null, hl: 3.4, hw: 2.4 }, walls: [[15.2, -90.5, 0.15, 10.5], [18.8, -90.5, 0.15, 10.5], [17, -101.2, 2, 0.2]], par: { time: 40, moves: 2 } },
  };
  class Parking {
    constructor(game, id) {
      this.game = game;
      this.kind = 'parking';
      this.id = id;
      this.def = PARK[id];
      this.noPolice = true;
      this.noTraffic = false;
      this.t = 0;
      this.hits = 0;
      this.hitSev = 0;
      this.moves = 0;
      this.dirSign = 0;
      this.stalls = 0;
      this.grinds = 0;
      this.temp = [];
      this.done = false;
      const W = game.world, d = this.def;
      // obstacles
      const parkedMat = new T.MeshStandardMaterial({ vertexColors: true, color: 0x8a95a0, roughness: 0.4, metalness: 0.3 });
      for (const c of d.cars || []) {
        const md = SB.CarModel.buildSimple('sedan');
        const m = new T.Mesh(md.geo, parkedMat);
        m.position.set(c[0], W.heightAt(c[0], c[1]), c[1]);
        m.rotation.y = c[2];
        m.castShadow = true;
        game.scene.add(m);
        const col = W.addCollider({ type: 'box', x: c[0], z: c[1], hl: md.len / 2, hw: md.wid / 2, ang: c[2], y0: -50, y1: 99, solid: true, mission: true });
        this.temp.push({ m, col });
      }
      for (const w of d.walls || []) {
        const m = new T.Mesh(new T.BoxGeometry(w[2] * 2, 3, w[3] * 2), new T.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 }));
        m.position.set(w[0], W.heightAt(w[0], w[1]) + 1.5, w[1]);
        m.castShadow = true;
        game.scene.add(m);
        const col = W.addCollider({ type: 'box', x: w[0], z: w[1], hl: w[3], hw: w[2], ang: 0, y0: -50, y1: 99, solid: true, mission: true });
        this.temp.push({ m, col });
      }
      // target outline
      const tg = d.target;
      const shape = new T.Shape();
      shape.moveTo(-tg.hw, -tg.hl); shape.lineTo(tg.hw, -tg.hl); shape.lineTo(tg.hw, tg.hl); shape.lineTo(-tg.hw, tg.hl); shape.lineTo(-tg.hw, -tg.hl);
      const hole = new T.Path();
      const k = 0.16;
      hole.moveTo(-tg.hw + k, -tg.hl + k); hole.lineTo(-tg.hw + k, tg.hl - k); hole.lineTo(tg.hw - k, tg.hl - k); hole.lineTo(tg.hw - k, -tg.hl + k); hole.lineTo(-tg.hw + k, -tg.hl + k);
      shape.holes.push(hole);
      const geo = new T.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      this.outlineMat = new T.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.9, depthWrite: false });
      this.outline = new T.Mesh(geo, this.outlineMat);
      this.outline.position.set(tg.x, W.heightAt(tg.x, tg.z) + 0.07, tg.z);
      this.outline.rotation.y = tg.ang || 0;
      game.scene.add(this.outline);
      game.player.place(d.start[0], d.start[1], d.start[2]);
      game.prepareStart(true);
      game.hud.show('racePanel', true);
      game.hud.big(t('park.title.' + id), t('park.goal.' + id), 3.5);
    }
    dispose() {
      for (const o of this.temp) { this.game.scene.remove(o.m); this.game.world.removeCollider(o.col); }
      this.game.scene.remove(this.outline);
      this.game.hud.show('racePanel', false);
    }
    onImpact(e) { if (!this.done) { this.hits++; this.hitSev = Math.max(this.hitSev, e.speed); } }
    onEvent(e) { if (e.type === 'stall') this.stalls++; if (e.type === 'grind') this.grinds++; }
    update(dt) {
      if (this.done) return;
      const g = this.game, pl = g.player, d = this.def, tg = d.target;
      this.t += dt;
      const v = pl.vel.dot(pl.fwd);
      const s = Math.abs(v) > 0.4 ? Math.sign(v) : 0;
      if (s && s !== this.dirSign) { if (this.dirSign) this.moves++; this.dirSign = s; }
      // inside check: all four body corners within the target
      const rect = pl.carRect();
      const cs = U.rectCorners(rect, []);
      const tr = { x: tg.x, z: tg.z, hl: tg.hl + 0.2, hw: tg.hw + 0.2, ang: tg.ang || 0 };
      let inside = true;
      for (let i = 0; i < 8; i += 2) if (!U.pointInRect(cs[i], cs[i + 1], tr)) inside = false;
      const angErr = tg.ang == null ? 0 : Math.abs(U.angleWrap(pl.yaw - tg.ang)) * 57.3;
      const aligned = angErr < 12;
      this.outlineMat.color.set(inside && aligned ? 0x52e07a : inside ? 0xffc23a : 0x5ce1ff);
      const stopped = pl.vel.length() < 0.15;
      const dtr = pl.dt;
      let ok = inside && aligned && stopped && pl.input.handbrake > 0.5;
      let gearOk = true;
      if (d.hill) gearOk = dtr.state === 'ENG' && (dtr.gear === 1 || dtr.gear === -1);
      if (d.hill) ok = ok && gearOk;
      const need = [];
      if (!inside) need.push(t('park.need.inside'));
      else if (!aligned) need.push(t('park.need.align', { n: angErr.toFixed(0) }));
      else if (!stopped) need.push(t('park.need.stop'));
      else if (pl.input.handbrake < 0.5) need.push(t('park.need.hand', { key: g.keyLabel('handbrake') }));
      else if (!gearOk) need.push(t('park.need.gear'));
      g.hud.setHTML('racePanel', `<div class="rp-big">${this.t.toFixed(1)}<small>s</small></div><div class="rp-lbl">${t('park.title.' + this.id)}</div><div class="rp-row"><span>${t('park.hits')}</span><b>${this.hits}</b></div><div class="rp-row"><span>${t('park.moves')}</span><b>${this.moves}</b></div><div class="rp-note">${need.join(' ')}</div>`);
      if (ok) {
        this.done = true;
        let stars = 3;
        if (this.hits > 0) stars -= this.hitSev > 4 ? 2 : 1;
        if (this.moves > d.par.moves) stars--;
        if (this.t > d.par.time * 1.5) stars--;
        if (this.stalls) stars--;
        if (angErr > 6) stars--;
        if (d.curb) { const sideDist = Math.abs(pl.pos.z - d.curb.at) - pl.bodyBox.hw; if (sideDist > 0.45) stars--; }
        if (d.hill) {
          // facing downhill should be left in R, uphill in 1st
          const up = g.world.rawH(pl.pos.x + pl.fwd.x * 2, pl.pos.z + pl.fwd.z * 2) > g.world.rawH(pl.pos.x, pl.pos.z);
          const right = up ? dtr.gear === 1 : dtr.gear === -1;
          if (!right) stars--;
        }
        stars = U.clamp(stars, 1, 3);
        const reward = [0, 1500, 2500, 4000][stars];
        g.addCredits(reward);
        const key = 'park_' + this.id;
        g.save.records[key] = Math.max(g.save.records[key] || 0, stars);
        if (stars === 3) g.achieve('parking');
        g.persist();
        g.ui.parkResult(this, { stars, reward, time: this.t, hits: this.hits, moves: this.moves, angErr });
      }
    }
  }

  // ------------------------------------------------------------------ license course (driving school)
  class License {
    constructor(game) {
      this.game = game;
      this.kind = 'license';
      this.noPolice = true;
      this.noTraffic = true;
      this.step = 0;
      this.data = {};
      this.mistakes = 0;
      const pl = game.player;
      pl.place(735, 370, 0);
      game.prepareStart(false);
      this.steps = this.makeSteps();
      this.enterStep();
      game.hud.show('lesson', true);
      this.target = null;
    }
    dispose() { this.game.hud.show('lesson', false); if (this.outline) this.game.scene.remove(this.outline); }
    makeSteps() {
      const g = this.game;
      const pl = () => g.player, dt = () => g.player.dt;
      const kmh = () => Math.abs(g.player.speed) * 3.6;
      return [
        { id: 'ign', check: () => dt().running },
        { id: 'gear1', check: () => dt().state === 'ENG' && dt().gear === 1 },
        { id: 'launch', check: () => dt().running && kmh() > 8 && dt().gear === 1 },
        { id: 'gear2', check: () => dt().state === 'ENG' && dt().gear === 2 && kmh() > 12 },
        { id: 'gear3', check: () => dt().state === 'ENG' && dt().gear === 3 && kmh() > 25 },
        { id: 'down', check: () => dt().state === 'ENG' && dt().gear === 2 },
        { id: 'stop', check: () => kmh() < 1 && dt().state === 'N' && dt().running },
        { id: 'hillGo', check: () => { const p = pl().pos; return Math.abs(p.x - 735) < 7 && p.z > 410 && p.z < 430 && kmh() < 1 && pl().input.handbrake > 0.5; }, onEnter: () => this.marker(735, 420, 0) },
        { id: 'hillUp', check: () => { const p = pl().pos; return p.z > 437 && p.z < 452 && dt().running; }, onEnter: () => this.marker(735, 444, 0) },
        { id: 'reverse', onEnter: () => { this.data.rz = null; this.marker(null); }, check: () => { const p = pl().pos; if (dt().state === 'ENG' && dt().gear === -1) { if (this.data.rz == null) this.data.rz = [p.x, p.z]; return Math.hypot(p.x - this.data.rz[0], p.z - this.data.rz[1]) > 10; } return false; } },
        { id: 'park', onEnter: () => this.marker(718, 500, Math.PI, true), check: () => this.inMarker() && kmh() < 0.5 && pl().input.handbrake > 0.5 },
        { id: 'warn61', info: true },
        { id: 'exam', onEnter: () => this.startExam(), check: () => this.examDone },
      ];
    }
    marker(x, z, ang, park) {
      const g = this.game;
      if (this.outline) { g.scene.remove(this.outline); this.outline = null; }
      if (x == null) { this.target = null; return; }
      const hl = park ? 2.7 : 3.2, hw = park ? 1.4 : 2.6;
      const geo = new T.PlaneGeometry(hw * 2, hl * 2);
      geo.rotateX(-Math.PI / 2);
      this.outline = new T.Mesh(geo, new T.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.35, depthWrite: false }));
      this.outline.position.set(x, g.world.heightAt(x, z) + 0.08, z);
      this.outline.rotation.y = ang;
      g.scene.add(this.outline);
      this.target = { x, z, hl, hw, ang };
    }
    inMarker() {
      if (!this.target) return false;
      const r = this.game.player.carRect();
      const cs = U.rectCorners(r, []);
      const tr = { x: this.target.x, z: this.target.z, hl: this.target.hl + 0.3, hw: this.target.hw + 0.3, ang: this.target.ang };
      for (let i = 0; i < 8; i += 2) if (!U.pointInRect(cs[i], cs[i + 1], tr)) return false;
      return true;
    }
    startExam() {
      this.examCps = [[735, 395], [750, 470], [764, 500], [760, 520], [722, 500], [710, 420], [735, 380]];
      this.examIdx = 0;
      this.examErr = 0;
      this.examDone = false;
      this.marker(this.examCps[0][0], this.examCps[0][1], 0);
    }
    onEvent(e) {
      if (e.type === 'stall') { this.mistakes++; if (this.step === this.steps.length - 1) this.examErr++; this.game.hud.toast(t('lic.stallHint', { key: this.game.keyLabel('ignition') }), 'warn', 3.5); }
      if (e.type === 'grind') { this.mistakes++; if (this.step === this.steps.length - 1) this.examErr++; }
    }
    onImpact() { if (this.step === this.steps.length - 1) this.examErr++; }
    onCone() { if (this.step === this.steps.length - 1) { this.examErr++; this.game.hud.toast(t('lic.cone'), 'warn', 1.2); } }
    enterStep() {
      const s = this.steps[this.step];
      if (s.onEnter) s.onEnter();
      this.game.audio.chime();
      this.render();
    }
    render() {
      const s = this.steps[this.step], g = this.game;
      const keys = { ign: g.keyLabel('ignition'), clutch: g.keyLabel('clutch'), up: g.keyLabel('shiftUp'), down: g.keyLabel('shiftDown'), hand: g.keyLabel('handbrake'), half: g.keyLabel('halfClutch'), interact: g.keyLabel('interact') };
      const prog = `${this.step + 1}/${this.steps.length}`;
      let body = t('lic.' + s.id, keys);
      if (s.id === 'exam' && this.examCps) body += `<div class="ls-ex">${t('lic.examProg', { n: this.examIdx, total: this.examCps.length, e: this.examErr })}</div>`;
      g.hud.setHTML('lesson', `<div class="ls-head"><span>${t('lic.title')}</span><b>${prog}</b></div><div class="ls-body">${body}</div>${s.info ? `<button class="btn primary" id="lsNext">${t('ui.continue')}</button>` : ''}`);
      const b = document.getElementById('lsNext');
      if (b) b.onclick = () => this.next();
    }
    next() { this.step++; if (this.step >= this.steps.length) return this.finish(); this.enterStep(); }
    update() {
      const s = this.steps[this.step];
      if (!s) return;
      if (s.id === 'exam' && this.examCps && !this.examDone) {
        if (this.inMarker() || Math.hypot(this.game.player.pos.x - this.target.x, this.game.player.pos.z - this.target.z) < 3.5) {
          this.examIdx++;
          this.game.audio.beep(1200, 0.08, 0.1);
          if (this.examIdx >= this.examCps.length) { this.examDone = true; this.marker(null); }
          else { const c = this.examCps[this.examIdx]; this.marker(c[0], c[1], 0); }
          this.render();
        }
      }
      if (s.info) return;
      if (s.check()) this.next();
    }
    finish() {
      const g = this.game;
      const pass = (this.examErr || 0) <= 3;
      if (pass) {
        if (!g.save.license) { g.addCredits(3000); g.achieve('license'); }
        g.save.license = true;
        g.persist();
      }
      g.ui.licenseResult(pass, this.examErr || 0);
    }
    minimapDots(dot) { if (this.target) dot(this.target.x, this.target.z, '#5ce1ff', 5); }
  }

  SB.Modes = { FreeRoam, Race, Drag, Parking, License, Skills, Rival, PARK };
})();
