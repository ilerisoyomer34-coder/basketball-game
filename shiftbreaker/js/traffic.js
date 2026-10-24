// SHIFTBREAKER — city life: lane-following AI traffic with signals, pedestrians, parked cars, police.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;

  const TYPES = {
    sedan: { cap: 34, mass: 1350, colors: null, w: 10 },
    hatch: { cap: 18, mass: 1150, colors: null, w: 6 },
    taxi: { cap: 14, mass: 1350, colors: [0xf5c518], w: 5 },
    dolmus: { cap: 8, mass: 2300, colors: [0xf2c230], w: 2 },
    bus: { cap: 5, mass: 12000, colors: [0x2a6fb0, 0xd9472b, 0x3c8b4a], w: 1.2 },
    truck: { cap: 6, mass: 7000, colors: [0xe8e6e0, 0x3a6ea5, 0xb83a2a], w: 1.2 },
    police: { cap: 10, mass: 1600, colors: [0xf4f4f4], w: 0 },
    van: { cap: 1, mass: 2000, colors: null, w: 0 },
    // articulated trolleybus (GLB model, two sections): avenues and streets only
    trolley: { cap: 2, mass: 16000, colors: null, w: 0.9, glb: true },
  };
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(1, 1, 1), _up = new T.Vector3(0, 1, 0);
  const _e = { x: 0, z: 0, tx: 0, tz: 0 };

  class Traffic {
    constructor(game) {
      this.game = game;
      this.world = game.world;
      this.scene = game.scene;
      this.cars = [];
      this.peds = [];
      this.police = [];
      this.alarmsT = [];
      this.inst = {};
      this.free = {};
      this.models = {};
      const paintMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
      for (const [type, def] of Object.entries(TYPES)) {
        this.free[type] = Array.from({ length: def.cap }, (_, i) => def.cap - 1 - i);
        if (def.glb) continue;
        const md = SB.CarModel.buildSimple(type === 'van' ? 'van' : type);
        this.models[type] = md;
        const inst = new T.InstancedMesh(md.geo, paintMat, def.cap);
        inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
        inst.castShadow = game.quality !== 'low';
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        _m.makeScale(0, 0, 0);
        const c = new T.Color(1, 1, 1);
        for (let i = 0; i < def.cap; i++) { inst.setMatrixAt(i, _m); inst.setColorAt(i, c); }
        this.scene.add(inst);
        this.inst[type] = inst;
      }
      this.buildTrolleys();
      this.buildParked(paintMat);
      this.buildLights();
      this.buildPeds();
      this.spawnT = 0;
    }

    // ---------------------------------------------------------------- trolleybuses (articulated GLB model)
    // The front section leads; the rear section pivots on the turntable and follows the joint's own trail.
    buildTrolleys() {
      const P = SB.DATA.PROPS.trolley;
      this.tro = { Lf: P.bounds[1][2] - P.split, Lr: P.split - P.bounds[0][2], wid: P.footprint[0] };
      this.models.trolley = { len: this.tro.Lf, wid: this.tro.wid };
      this.trolleyViews = [];
      for (let i = 0; i < TYPES.trolley.cap; i++) {
        const grp = new T.Group(), front = new T.Group(), rear = new T.Group();
        grp.add(front, rear);
        grp.visible = false;
        this.scene.add(grp);
        this.trolleyViews.push({ grp, front, rear });
      }
      if (!T.GLTFLoader) return;
      SB.CarModel.loadGLB(P.url).then((scene) => {
        const joint = new T.Vector3(0, 0, P.split);
        for (const v of this.trolleyViews) for (const part of ['front', 'rear']) {
          const node = scene.getObjectByName(part).clone();
          node.position.sub(joint); // both sections pivot on the joint (node matrices carry the dequantization)
          node.traverse((o) => { if (o.isMesh) { o.castShadow = this.game.quality !== 'low'; o.receiveShadow = true; SB.CarModel.displayTextures(o.material); } });
          v[part].add(node);
        }
        this.trolleyReady = true;
      }).catch((e) => console.warn('trolleybus model failed to load:', e && e.message));
    }
    spawnTrolley(c) {
      c.view = this.trolleyViews[c.idx];
      c.view.grp.visible = true;
      // straight trail behind the joint
      const jx = c.x - c.tx * this.tro.Lf / 2, jz = c.z - c.tz * this.tro.Lf / 2;
      c.trail = [];
      for (let d = 0; d <= 12; d += 0.5) c.trail.push(jx - c.tx * d, jz - c.tz * d);
      this.articulate(c);
    }
    articulate(c) {
      const { Lf, Lr, wid } = this.tro;
      const jx = c.x - c.tx * Lf / 2, jz = c.z - c.tz * Lf / 2;
      const tr = c.trail;
      if (Math.hypot(jx - tr[0], jz - tr[1]) > 0.5) { tr.unshift(jx, jz); if (tr.length > 80) tr.length = 80; }
      // the rear axle runs on the joint's path ~0.7 of the rear section behind it
      const dR = Lr * 0.7;
      let d = 0, px = jx, pz = jz, rx = jx - c.tx * dR, rz = jz - c.tz * dR;
      for (let i = 0; i < tr.length; i += 2) {
        const seg = Math.hypot(tr[i] - px, tr[i + 1] - pz);
        if (d + seg >= dR && seg > 1e-6) { const f = (dR - d) / seg; rx = px + (tr[i] - px) * f; rz = pz + (tr[i + 1] - pz) * f; break; }
        d += seg; px = tr[i]; pz = tr[i + 1];
      }
      let hx = jx - rx, hz = jz - rz;
      const hl = Math.hypot(hx, hz) || 1;
      hx /= hl; hz /= hl;
      const r = c.rear || (c.rear = { parent: c, type: 'trolley', isRear: true });
      r.tx = hx; r.tz = hz;
      r.yaw = Math.atan2(hx, hz);
      r.x = jx - hx * Lr / 2; r.z = jz - hz * Lr / 2;
      r.len = Lr; r.wid = wid;
      r.speed = c.speed; r.vx = c.vx || 0; r.vz = c.vz || 0; r.mass = c.mass * 0.45; r.state = c.state;
      c.jx = jx; c.jz = jz;
    }
    drawTrolley(c, lightsOn, light) {
      const v = c.view, W = this.world;
      const y = W.heightAt(c.jx, c.jz);
      v.front.position.set(c.jx, y, c.jz);
      v.front.rotation.y = c.yaw;
      v.rear.position.set(c.jx, y, c.jz);
      v.rear.rotation.y = c.rear.yaw;
      const hw = c.wid / 2 - 0.35;
      const lx = c.tz, lz = -c.tx, rlx = c.rear.tz, rlz = -c.rear.tx;
      const fx = c.x + c.tx * this.tro.Lf / 2, fz = c.z + c.tz * this.tro.Lf / 2;
      const bx = c.rear.x - c.rear.tx * this.tro.Lr / 2, bz = c.rear.z - c.rear.tz * this.tro.Lr / 2;
      if (lightsOn && c.state !== 'crashed') for (const sg of [-1, 1]) light(fx + lx * hw * sg, y + 0.9, fz + lz * hw * sg, 1, 0.95, 0.8, 0.9, 1.0);
      const braking = c.speed < 3 || (c.prevSpeed != null && c.speed < c.prevSpeed - 0.02);
      c.prevSpeed = c.speed;
      if (lightsOn || braking) for (const sg of [-1, 1]) light(bx + rlx * hw * sg, y + 1.0, bz + rlz * hw * sg, 1, 0.1, 0.05, braking ? 0.95 : 0.5, braking ? 0.8 : 0.5);
    }

    // ---------------------------------------------------------------- parked cars (static instances)
    buildParked(mat) {
      const W = this.world;
      const byType = {};
      for (const p of W.parked) (byType[p.type] = byType[p.type] || []).push(p);
      this.parkedChunks = [];
      for (const [type, list] of Object.entries(byType)) {
        const md = this.models[type] || SB.CarModel.buildSimple(type);
        for (const p of list) p.y = W.heightAt(p.x, p.z);
        const chunks = SB.World.chunkInstances(this.scene, md.geo, mat, list, (p, m) => { _q.setFromAxisAngle(_up, p.heading); return m.compose(_p.set(p.x, p.y, p.z), _q, _s); }, { shadow: this.game.quality !== 'low', maxDist: 380, cell: 200 });
        this.parkedChunks.push(...chunks);
        W.instChunks.push(...chunks);
      }
    }
    // knock a parked car (moves its instance slightly) — returns true if moved
    nudgeParked(p, dx, dz) {
      if (!p.inst) return false;
      p.x += dx;
      p.z += dz;
      p.collider.x = p.x;
      p.collider.z = p.z;
      _q.setFromAxisAngle(_up, p.heading);
      _m.compose(_p.set(p.x, this.world.heightAt(p.x, p.z), p.z), _q, _s);
      p.inst.setMatrixAt(p.idx, _m);
      if (p.inst.geometry.boundingSphere) p.inst.geometry.boundingSphere.radius += 0.5;
      p.inst.instanceMatrix.needsUpdate = true;
      return true;
    }

    // ---------------------------------------------------------------- light sprites (night)
    buildLights() {
      const max = 4 * 120 + 80;
      this.lp = new Float32Array(max * 3);
      this.lc = new Float32Array(max * 4);
      this.ls = new Float32Array(max);
      const g = new T.BufferGeometry();
      this.lpA = new T.BufferAttribute(this.lp, 3).setUsage(T.DynamicDrawUsage);
      this.lcA = new T.BufferAttribute(this.lc, 4).setUsage(T.DynamicDrawUsage);
      this.lsA = new T.BufferAttribute(this.ls, 1).setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.lpA);
      g.setAttribute('aColor', this.lcA);
      g.setAttribute('aSize', this.lsA);
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const gg = c.getContext('2d');
      const gr = gg.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.5)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = gr;
      gg.fillRect(0, 0, 32, 32);
      this.lightMat = new T.ShaderMaterial({
        uniforms: { map: { value: new T.CanvasTexture(c) }, uScale: { value: 600 } },
        vertexShader: 'attribute vec4 aColor; attribute float aSize; varying vec4 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.5,-mv.z); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); }',
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      });
      this.lights = new T.Points(g, this.lightMat);
      this.lights.frustumCulled = false;
      this.scene.add(this.lights);
      this.lmax = max;
    }

    // ---------------------------------------------------------------- pedestrians
    buildPeds() {
      const max = 48;
      const body = new T.CylinderGeometry(0.22, 0.26, 1.15, 8);
      body.translate(0, 0.95, 0);
      const head = new T.SphereGeometry(0.15, 7, 5);
      head.translate(0, 1.68, 0);
      const legs = new T.BoxGeometry(0.36, 0.42, 0.18);
      legs.translate(0, 0.21, 0);
      this.pedBody = new T.InstancedMesh(body, new T.MeshStandardMaterial({ roughness: 0.9 }), max);
      this.pedHead = new T.InstancedMesh(head, new T.MeshStandardMaterial({ color: 0xc89a7c, roughness: 0.8 }), max);
      this.pedLegs = new T.InstancedMesh(legs, new T.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.9 }), max);
      for (const m of [this.pedBody, this.pedHead, this.pedLegs]) {
        m.instanceMatrix.setUsage(T.DynamicDrawUsage);
        m.castShadow = this.game.quality === 'high';
        m.frustumCulled = false;
        this.scene.add(m);
      }
      this.pedMax = max;
      const pal = [0x9b2f2f, 0x2f5f9b, 0x3a7a4a, 0xd8b04a, 0x6a4a8a, 0xe0e0e0, 0x333333, 0xc46a2a];
      const c = new T.Color();
      _m.makeScale(0, 0, 0);
      for (let i = 0; i < max; i++) {
        this.pedBody.setMatrixAt(i, _m); this.pedHead.setMatrixAt(i, _m); this.pedLegs.setMatrixAt(i, _m);
        this.pedBody.setColorAt(i, c.set(pal[i % pal.length]));
      }
    }

    // ---------------------------------------------------------------- spawning
    targetCount() {
      const s = this.game.settings;
      if (this.game.mode && this.game.mode.noTraffic) return 0;
      const base = [0, 14, 26, 40][s.traffic] || 0;
      return Math.round(base * (this.game.quality === 'low' ? 0.6 : 1));
    }
    pickType() {
      const r = Math.random() * Object.values(TYPES).reduce((a, d) => a + d.w, 0);
      let acc = 0;
      for (const [t, d] of Object.entries(TYPES)) { acc += d.w; if (r < acc) return t; }
      return 'sedan';
    }
    laneOff(e, lane) { return ((lane + 0.5) * (e.w / 2)) / e.lanes; }
    posOn(c) {
      const e = c.edge;
      const d = c.dir > 0 ? c.s : e.len - c.s;
      this.world.edgePoint(e, d, _e, c.hint);
      let tx = _e.tx, tz = _e.tz;
      if (c.dir < 0) { tx = -tx; tz = -tz; }
      const off = this.laneOff(e, c.lane);
      c.x = _e.x - tz * off;
      c.z = _e.z + tx * off;
      c.tx = tx;
      c.tz = tz;
    }
    spawnCar(player, cam) {
      const W = this.world;
      const ang = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 170;
      const x = player.x + Math.cos(ang) * dist, z = player.z + Math.sin(ang) * dist;
      if (!W.inPlay(x, z)) return;
      const r = W.nearestRoad(x, z, true);
      if (!r || r.dist > 30) return;
      const e = r.edge;
      if (e.noTraffic) return;
      const A = W.nodes[e.a], Bn = W.nodes[e.b];
      if (r.s < A.half + 4 || r.s > e.len - Bn.half - 6) return;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const lane = Math.floor(Math.random() * e.lanes);
      const c = { edge: e, dir, s: dir > 0 ? r.s : e.len - r.s, lane, speed: 0, state: 'drive', hint: { i: 0 }, x: 0, z: 0, tx: 0, tz: 1 };
      this.posOn(c);
      // not too close to other cars, not right in front of the camera
      for (const o of this.cars) if ((o.x - c.x) ** 2 + (o.z - c.z) ** 2 < 200) return;
      if ((player.x - c.x) ** 2 + (player.z - c.z) ** 2 < 70 * 70) return;
      if (cam) {
        const dx = c.x - cam.position.x, dz = c.z - cam.position.z;
        const l = Math.hypot(dx, dz);
        const f = cam.getWorldDirection(_p);
        const fl = Math.hypot(f.x, f.z) || 1;
        if (l < 150 && (dx * f.x + dz * f.z) / (l * fl) > 0.4) return;
      }
      let type = this.pickType();
      if (type === 'trolley' && (!this.trolleyReady || (e.kind !== 'avenue' && e.kind !== 'street'))) type = 'bus';
      if (e.kind === 'lane' || e.kind === 'hstreet' || e.kind === 'serp') if (type === 'bus' || type === 'truck') type = 'sedan';
      if (type === 'police') type = 'sedan';
      if (!this.free[type].length) return;
      c.type = type;
      c.idx = this.free[type].pop();
      if (type === 'trolley') this.spawnTrolley(c);
      const md = this.models[type];
      c.len = md.len;
      c.wid = md.wid;
      c.mass = TYPES[type].mass;
      c.limitF = 0.85 + Math.random() * 0.25;
      c.speed = Math.min(e.limit / 3.6, 10) * c.limitF;
      c.color = TYPES[type].colors ? U.pick(TYPES[type].colors) : U.pick(SB.DATA.PAINT);
      if (this.inst[type]) {
        this.inst[type].setColorAt(c.idx, new T.Color(c.color));
        if (this.inst[type].instanceColor) this.inst[type].instanceColor.needsUpdate = true;
      }
      c.yaw = Math.atan2(c.tx, c.tz);
      c.blockedT = 0;
      c.honkT = 0;
      c.ind = 0;
      this.cars.push(c);
    }
    remove(c) {
      _m.makeScale(0, 0, 0);
      if (c.view) c.view.grp.visible = false;
      else this.inst[c.type].setMatrixAt(c.idx, _m);
      this.free[c.type].push(c.idx);
      c.dead = true;
    }

    // choose the next edge at the node the car is heading into, build the turn curve
    planTurn(c) {
      const W = this.world;
      const e = c.edge;
      const nid = c.dir > 0 ? e.b : e.a;
      const node = W.nodes[nid];
      const opts = node.edges.map((i) => W.edges[i]).filter((x) => x !== e && !x.noTraffic);
      let next;
      if (!opts.length) next = e;
      else {
        // prefer going straight
        const scored = opts.map((x) => {
          const fromNode = x.a === nid;
          const nt = { x: 0, z: 0, tx: 0, tz: 0 };
          W.edgePoint(x, fromNode ? 1 : x.len - 1, nt);
          const tx = fromNode ? nt.tx : -nt.tx, tz = fromNode ? nt.tz : -nt.tz;
          const dot = tx * c.tx + tz * c.tz;
          return { x, w: dot > 0.8 ? 3 : 1, dot, cross: c.tx * tz - c.tz * tx };
        });
        let tot = scored.reduce((a, b) => a + b.w, 0), r = Math.random() * tot;
        for (const sc of scored) { r -= sc.w; if (r <= 0) { next = sc.x; c.ind = sc.dot > 0.8 ? 0 : sc.cross > 0 ? -1 : 1; break; } }
        if (!next) next = scored[0].x;
      }
      c.nextEdge = next;
      c.nextDir = next.a === nid ? 1 : -1;
      c.nextLane = Math.min(c.lane, next.lanes - 1);
      c.node = node;
    }
    startTurn(c) {
      const W = this.world;
      const node = c.node;
      const p0 = { x: c.x, z: c.z };
      const n = { edge: c.nextEdge, dir: c.nextDir, s: node.half + 2, lane: c.nextLane, hint: { i: 0 } };
      if (c.nextEdge === c.edge) { n.dir = -c.dir; n.s = c.edge.len - (c.dir > 0 ? c.s : c.edge.len - c.s); }
      this.posOn(n);
      const p2 = { x: n.x, z: n.z };
      const dch = Math.hypot(p2.x - p0.x, p2.z - p0.z);
      const p1 = { x: p0.x + c.tx * dch * 0.5, z: p0.z + c.tz * dch * 0.5 };
      // make the control point the intersection of the two travel lines when they cross
      const den = c.tx * n.tz - c.tz * n.tx;
      if (Math.abs(den) > 0.2) {
        const t = ((p2.x - p0.x) * n.tz - (p2.z - p0.z) * n.tx) / den;
        if (t > 0 && t < dch * 1.2) { p1.x = p0.x + c.tx * t; p1.z = p0.z + c.tz * t; }
      }
      c.turn = { p0, p1, p2, t: 0, len: dch * (Math.abs(den) > 0.2 ? 1.15 : 1.0) + 0.1, n };
      c.state = 'turn';
    }

    // ---------------------------------------------------------------- per-frame update
    update(dt, player) {
      const W = this.world;
      const game = this.game;
      const pp = player.pos;
      const env = game.env;
      // spawn / despawn
      this.spawnT -= dt;
      const want = this.targetCount();
      if (this.spawnT <= 0 && this.cars.length < want) { this.spawnT = 0.12; for (let k = 0; k < 3; k++) this.spawnCar(pp, game.camera); }
      for (const c of this.cars) {
        const d2 = (c.x - pp.x) ** 2 + (c.z - pp.z) ** 2;
        if (d2 > 340 * 340 || (c.state === 'crashed' && c.crashT > 25 && d2 > 60 * 60)) this.remove(c);
      }
      if (this.cars.some((c) => c.dead)) this.cars = this.cars.filter((c) => !c.dead);
      while (this.cars.length > want + 4) { this.remove(this.cars[this.cars.length - 1]); this.cars.pop(); }

      const pRect = player.carRect();
      const pfx = player.fwd.x, pfz = player.fwd.z;
      for (const c of this.cars) {
        if (c.state === 'crashed') { this.updateCrashed(c, dt); if (c.view) this.articulate(c); continue; }
        // obstacle ahead (cars, player, police) via a forward probe
        let gap = 99, leadV = 99;
        const probe = (ox, oz, olen, ov) => {
          const dx = ox - c.x, dz = oz - c.z;
          const f = dx * c.tx + dz * c.tz;
          if (f <= 0 || f > 28) return;
          const l = dx * -c.tz + dz * c.tx;
          if (Math.abs(l) > 1.9) return;
          const g = f - (c.len + olen) / 2;
          if (g < gap) { gap = g; leadV = ov; }
        };
        for (const o of this.cars) {
          if (o === c) continue;
          probe(o.x, o.z, o.len, o.state === 'crashed' ? 0 : o.speed);
          if (o.rear) probe(o.rear.x, o.rear.z, o.rear.len, o.state === 'crashed' ? 0 : o.speed);
        }
        for (const o of this.police) probe(o.x, o.z, o.len, o.speed);
        const pv = player.vel.x * c.tx + player.vel.z * c.tz;
        const before = gap;
        probe(pRect.x, pRect.z, player.bodyBox.hl * 2, pv);
        const blockedByPlayer = gap < before;
        // target speed: limit, curve, signals
        const e = c.edge;
        let vT = (Math.max(30, e.limit) / 3.6) * c.limitF;
        if (env && env.wet > 0.5) vT *= 0.85;
        if (c.state === 'flee') { vT *= c.fleeAway ? 1.4 : 0; c.fleeT -= dt; if (c.fleeT <= 0) c.state = 'drive'; }
        if (c.state === 'drive') {
          const endTrim = W.nodes[c.dir > 0 ? e.b : e.a].half + 2.5;
          const remain = e.len - endTrim - c.s;
          if (!c.nextEdge && remain < 45) this.planTurn(c);
          if (c.nextEdge) {
            const light = W.lightFor(c.node.id, c.tx, c.tz);
            const turning = c.ind !== 0;
            if (turning) vT = Math.min(vT, 3 + Math.sqrt(Math.max(0, remain)) * 1.6);
            if ((light === 'red' || (light === 'yellow' && remain > 8)) && remain > -0.5) {
              vT = Math.min(vT, Math.sqrt(Math.max(0, remain - 0.5) * 2 * 3.2));
              if (remain < 1.2) vT = 0;
            }
            if (remain <= 0 && (light === 'green' || light === 'none' || light === 'yellow' || c.speed > 6)) this.startTurn(c);
          }
        } else if (c.state === 'turn') vT = Math.min(vT, c.ind === 0 ? vT : 6.5);
        if (gap < 99) vT = Math.min(vT, Math.max(0, (gap - 2.5) / 1.1), leadV + Math.max(0, gap - 5) * 0.4);
        const acc = vT > c.speed ? 2.4 : -7;
        c.speed = Math.max(0, c.speed + U.clamp(vT - c.speed, -7 * dt, 2.4 * dt) * (acc ? 1 : 1));
        // honk when the player blocks the lane
        if (blockedByPlayer && c.speed < 0.5) {
          c.blockedT += dt;
          if (c.blockedT > 3 && (c.honkT -= dt) <= 0) { c.honkT = 4 + Math.random() * 3; this.honk(c, pp); }
        } else c.blockedT = 0;
        // move
        if (c.state === 'turn') {
          const tn = c.turn;
          tn.t += (c.speed * dt) / tn.len;
          const t = Math.min(1, tn.t), it = 1 - t;
          const x = it * it * tn.p0.x + 2 * it * t * tn.p1.x + t * t * tn.p2.x;
          const z = it * it * tn.p0.z + 2 * it * t * tn.p1.z + t * t * tn.p2.z;
          const dx = 2 * it * (tn.p1.x - tn.p0.x) + 2 * t * (tn.p2.x - tn.p1.x);
          const dz = 2 * it * (tn.p1.z - tn.p0.z) + 2 * t * (tn.p2.z - tn.p1.z);
          const l = Math.hypot(dx, dz) || 1;
          c.x = x; c.z = z; c.tx = dx / l; c.tz = dz / l;
          if (tn.t >= 1) {
            c.edge = tn.n.edge; c.dir = tn.n.dir; c.s = tn.n.s; c.lane = tn.n.lane; c.hint = { i: 0 };
            c.state = 'drive'; c.nextEdge = null; c.ind = 0;
            this.posOn(c);
          }
        } else {
          c.s += c.speed * dt;
          if (c.s > e.len) c.s = e.len;
          this.posOn(c);
        }
        c.yaw = Math.atan2(c.tx, c.tz);
        c.vx = c.tx * c.speed;
        c.vz = c.tz * c.speed;
        if (c.view) this.articulate(c);
        void pfx; void pfz;
      }
      this.updatePolice(dt, player);
      this.updatePeds(dt, player);
      this.writeInstances(game.env ? game.env.night : 0);
    }

    updateCrashed(c, dt) {
      c.crashT = (c.crashT || 0) + dt;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      const f = Math.max(0, 1 - 2.2 * dt);
      c.vx *= f; c.vz *= f;
      c.yaw += c.yawRate * dt;
      c.yawRate *= Math.max(0, 1 - 2 * dt);
      c.tx = Math.sin(c.yaw); c.tz = Math.cos(c.yaw);
      c.speed = Math.hypot(c.vx, c.vz);
      // keep out of buildings
      const rect = this.rectOf(c);
      this.world.query(c.x, c.z, 6, (o) => {
        if (!o.solid || o.type !== 'box') return;
        const r = SB.U.obbOverlap(rect, o);
        if (r) { c.x += r.nx * r.depth; c.z += r.nz * r.depth; c.vx *= -0.2; c.vz *= -0.2; }
      });
      c.ind = 2;
    }

    // player hit a traffic car (impulse already applied to the player)
    hit(c, res) {
      if (c.parent) c = c.parent; // trolleybus rear section
      if (c.isPolice) {
        const dv = Math.hypot(res.dvx || 0, res.dvz || 0);
        if (res.push) { c.x += res.push.x; c.z += res.push.z; }
        c.kx = (c.kx || 0) + (res.dvx || 0);
        c.kz = (c.kz || 0) + (res.dvz || 0);
        c.speed = Math.max(0, c.speed - dv * 0.5);
        c.yaw += (Math.random() - 0.5) * Math.min(1, dv * 0.12);
        c.tx = Math.sin(c.yaw); c.tz = Math.cos(c.yaw);
        // who drove into whom: closing speeds along the line between the two
        const pl = this.game.player, nx = c.x - pl.pos.x, nz = c.z - pl.pos.z, nl = Math.hypot(nx, nz) || 1;
        const mine = (pl.vel.x * nx + pl.vel.z * nz) / nl >= -((c.vx || 0) * nx + (c.vz || 0) * nz) / nl;
        if (this.game.police) this.game.police.onRam(c, dv, mine);
        return;
      }
      if (c.state !== 'crashed') { c.vx = c.tx * c.speed; c.vz = c.tz * c.speed; }
      c.vx += res.dvx || 0;
      c.vz += res.dvz || 0;
      if (res.push) { c.x += res.push.x; c.z += res.push.z; }
      c.yawRate = (c.yawRate || 0) + (Math.random() - 0.5) * Math.hypot(res.dvx || 0, res.dvz || 0) * 0.8;
      c.state = 'crashed';
      c.crashT = 0;
    }
    rectOf(c) { return { x: c.x, z: c.z, hl: c.len / 2, hw: c.wid / 2, ang: c.yaw, y: this.world.heightAt(c.x, c.z) + 0.8, vx: c.vx || 0, vz: c.vz || 0, mass: c.mass, src: c }; }
    // all moving boxes near p (for the player's physics step)
    nearby(p, r) {
      const out = [];
      for (const c of this.cars) {
        if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < r * r) out.push(c);
        if (c.rear && (c.rear.x - p.x) ** 2 + (c.rear.z - p.z) ** 2 < r * r) out.push(c.rear);
      }
      for (const c of this.police) if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < r * r) out.push(c);
      return out;
    }

    honk(c, pp) {
      const d = Math.hypot(c.x - pp.x, c.z - pp.z);
      const a = this.game.audio;
      if (!a.ready || d > 60) return;
      const v = 0.12 * (1 - d / 60);
      a.tone(380, v, 0.35, 'square');
      a.tone(470, v, 0.35, 'square');
    }

    flee(p, r) {
      for (const c of this.cars) {
        const dx = c.x - p.x, dz = c.z - p.z;
        if (dx * dx + dz * dz > r * r || c.state === 'crashed') continue;
        c.state = 'flee';
        c.fleeT = 8;
        c.fleeAway = dx * c.tx + dz * c.tz > 0;
        c.ind = c.fleeAway ? 0 : 2;
      }
      for (const pd of this.peds) {
        const dx = pd.x - p.x, dz = pd.z - p.z;
        if (dx * dx + dz * dz > r * r * 1.5) continue;
        const l = Math.hypot(dx, dz) || 1;
        pd.flee = { vx: (dx / l) * 5.5, vz: (dz / l) * 5.5, t: 4 };
      }
    }
    alarms(p, r) {
      for (const q of this.world.parked) if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < r * r) this.alarmsT.push({ p: q, t: 7 });
    }

    // ---------------------------------------------------------------- pedestrians
    updatePeds(dt, player) {
      const W = this.world, pp = player.pos;
      const want = this.game.mode && this.game.mode.noTraffic ? 0 : [0, 14, 26, 40][this.game.settings.peds] || 0;
      if (this.peds.length < Math.min(want, this.pedMax) && Math.random() < 0.3) {
        const ang = Math.random() * 6.28, dist = 40 + Math.random() * 120;
        const r = W.nearestRoad(pp.x + Math.cos(ang) * dist, pp.z + Math.sin(ang) * dist, true);
        if (r && r.edge.walk && r.dist < 25) {
          const e = r.edge;
          const side = Math.random() < 0.5 ? 1 : -1;
          const pd = { edge: e, side, dir: Math.random() < 0.5 ? 1 : -1, s: r.s, speed: 1.1 + Math.random() * 0.6, phase: Math.random() * 6, hint: { i: 0 }, x: 0, z: 0, yaw: 0, idx: this.peds.length };
          this.pedPos(pd);
          if (Math.hypot(pd.x - pp.x, pd.z - pp.z) > 35) this.peds.push(pd);
        }
      }
      const rect = player.carRect();
      const pvl = player.vel.length();
      for (let i = this.peds.length - 1; i >= 0; i--) {
        const pd = this.peds[i];
        if ((pd.x - pp.x) ** 2 + (pd.z - pp.z) ** 2 > 220 * 220) { this.peds.splice(i, 1); continue; }
        pd.phase += dt * pd.speed * 5;
        if (pd.flee) {
          pd.x += pd.flee.vx * dt; pd.z += pd.flee.vz * dt;
          pd.yaw = Math.atan2(pd.flee.vx, pd.flee.vz);
          pd.flee.t -= dt;
          pd.phase += dt * 10;
          if (pd.flee.t <= 0) { pd.flee = null; pd.back = 1.2; }
        } else {
          pd.s += pd.speed * dt * pd.dir;
          const e = pd.edge;
          if (pd.s > e.len || pd.s < 0) {
            const nid = pd.s > e.len ? e.b : e.a;
            const opts = W.nodes[nid].edges.map((k) => W.edges[k]).filter((x) => x.walk && x !== e);
            const nx = opts.length ? U.pick(opts) : e;
            pd.edge = nx;
            pd.dir = nx.a === nid ? 1 : -1;
            pd.s = pd.dir > 0 ? 0 : nx.len;
            pd.hint = { i: 0 };
          }
          const ox = pd.x, oz = pd.z;
          this.pedPos(pd);
          if (pd.back > 0) { pd.back -= dt; const k = 1 - Math.exp(-3 * dt); pd.x = ox + (pd.x - ox) * k; pd.z = oz + (pd.z - oz) * k; }
        }
        // see the car coming → jump aside; never let the car touch anyone
        const dx = pd.x - rect.x, dz = pd.z - rect.z;
        const d = Math.hypot(dx, dz);
        if (!pd.flee && d < 9 && pvl > 4) {
          const toPed = (dx * player.vel.x + dz * player.vel.z) / (d * pvl);
          if (toPed > 0.5) {
            const sx = -player.vel.z / pvl, sz = player.vel.x / pvl;
            const sg = dx * sx + dz * sz > 0 ? 1 : -1;
            pd.flee = { vx: sx * sg * 6, vz: sz * sg * 6, t: 1.2 };
          }
        }
        if (SB.U.pointInRect(pd.x, pd.z, { x: rect.x, z: rect.z, hl: rect.hl + 0.6, hw: rect.hw + 0.6, ang: rect.ang })) {
          const sx = Math.cos(rect.ang), sz = -Math.sin(rect.ang);
          const sg = dx * sx + dz * sz > 0 ? 1 : -1;
          pd.x = rect.x + sx * sg * (rect.hw + 0.9) + Math.sin(rect.ang) * (dx * Math.sin(rect.ang) + dz * Math.cos(rect.ang));
          pd.z = rect.z + sz * sg * (rect.hw + 0.9) + Math.cos(rect.ang) * (dx * Math.sin(rect.ang) + dz * Math.cos(rect.ang));
          pd.flee = { vx: sx * sg * 5, vz: sz * sg * 5, t: 1 };
        }
      }
      // write instances
      for (let i = 0; i < this.pedMax; i++) {
        const pd = this.peds[i];
        if (!pd) { _m.makeScale(0, 0, 0); this.pedBody.setMatrixAt(i, _m); this.pedHead.setMatrixAt(i, _m); this.pedLegs.setMatrixAt(i, _m); continue; }
        const y = W.heightAt(pd.x, pd.z) + Math.abs(Math.sin(pd.phase)) * 0.05;
        _q.setFromAxisAngle(_up, pd.yaw);
        _m.compose(_p.set(pd.x, y, pd.z), _q, _s);
        this.pedBody.setMatrixAt(i, _m);
        this.pedHead.setMatrixAt(i, _m);
        _m.compose(_p.set(pd.x, y, pd.z), _q, _p2.set(1, 1, 1 + Math.sin(pd.phase) * 0.4));
        this.pedLegs.setMatrixAt(i, _m);
      }
      this.pedBody.instanceMatrix.needsUpdate = this.pedHead.instanceMatrix.needsUpdate = this.pedLegs.instanceMatrix.needsUpdate = true;
    }
    pedPos(pd) {
      const e = pd.edge;
      this.world.edgePoint(e, pd.s, _e, pd.hint);
      const off = pd.side * (e.w / 2 + 1.75);
      pd.x = _e.x - _e.tz * off;
      pd.z = _e.z + _e.tx * off;
      pd.yaw = Math.atan2(_e.tx * pd.dir, _e.tz * pd.dir);
    }

    // ---------------------------------------------------------------- police
    // a cruiser somewhere around the player (or ahead of them: an interceptor coming the other way)
    spawnPolice(player, roadblock, ahead) {
      const W = this.world;
      if (!this.free.police.length) return null;
      let best = null;
      for (let k = 0; k < 12 && !best; k++) {
        const ang = Math.random() * 6.28, dist = roadblock ? 90 : 110 + Math.random() * 80;
        let x = player.pos.x + Math.cos(ang) * dist, z = player.pos.z + Math.sin(ang) * dist;
        if (roadblock || ahead) { x = player.pos.x + player.vel.x * 5 + (ahead ? (Math.random() - 0.5) * 40 : 0); z = player.pos.z + player.vel.z * 5 + (ahead ? (Math.random() - 0.5) * 40 : 0); }
        if (ahead && Math.hypot(x - player.pos.x, z - player.pos.z) < 90) continue;
        if (!W.inPlay(x, z)) continue;
        const r = W.nearestRoad(x, z, true);
        if (r && r.dist < 20) best = r;
      }
      if (!best) return null;
      let yaw = Math.atan2(best.tx, best.tz);
      if (roadblock) yaw += Math.PI / 2;
      else if (ahead && Math.sin(yaw) * (player.pos.x - best.x) + Math.cos(yaw) * (player.pos.z - best.z) < 0) yaw += Math.PI;
      return this.addPolice(best.x, best.z, yaw, roadblock);
    }
    addPolice(x, z, yaw, roadblock) {
      if (!this.free.police.length) return null;
      const md = this.models.police;
      const c = { isPolice: true, type: 'police', idx: this.free.police.pop(), x, z, yaw, tx: Math.sin(yaw), tz: Math.cos(yaw), speed: 0, len: md.len, wid: md.wid, mass: TYPES.police.mass, path: null, pathT: 0, vx: 0, vz: 0, roadblock: !!roadblock, flash: Math.random() * 6, dmg: 0 };
      this.police.push(c);
      return c;
    }
    removePolice(c) {
      const i = this.police.indexOf(c);
      if (i < 0) return;
      this.police.splice(i, 1);
      this.free.police.push(c.idx);
    }
    // keep: leave the cruiser parked after a ticket
    clearPolice(keep) {
      const stay = keep ? this.police.filter((c) => c.leftover) : [];
      for (const c of this.police) if (!stay.includes(c)) this.free.police.push(c.idx);
      this.police = stay;
    }
    updatePolice(dt, player) {
      const W = this.world;
      const pp = player.pos;
      const S = this.game.police ? this.game.police.stars : 0;
      for (const c of this.police) {
        c.flash += dt;
        // knocked by the player: the shove fades out
        if (c.kx || c.kz) {
          c.x += c.kx * dt; c.z += c.kz * dt;
          const f = Math.exp(-dt * 3);
          c.kx *= f; c.kz *= f;
          if (Math.abs(c.kx) + Math.abs(c.kz) < 0.05) c.kx = c.kz = 0;
        }
        if (c.roadblock || c.hold || c.leftover) { c.speed = 0; c.vx = c.kx || 0; c.vz = c.kz || 0; continue; }
        if (c.disabled) {
          // wrecked: rolls to a stop, lights dead
          c.speed = Math.max(0, c.speed - 7 * dt);
          c.vx = c.tx * c.speed + (c.kx || 0); c.vz = c.tz * c.speed + (c.kz || 0);
          c.x += c.tx * c.speed * dt; c.z += c.tz * c.speed * dt;
          continue;
        }
        const dx = pp.x - c.x, dz = pp.z - c.z;
        const d = Math.hypot(dx, dz);
        let tx, tz;
        if (d < 50) {
          const ps = player.vel.length();
          let px = pp.x + player.vel.x * (S >= 3 ? 0.9 : 0.6), pz = pp.z + player.vel.z * (S >= 3 ? 0.9 : 0.6);
          // from three stars they go for the rear quarter (PIT) instead of shadowing you
          const pit = S >= 3 && d < 16 && ps > 6;
          if (pit) {
            const side = Math.sign((c.x - pp.x) * player.left.x + (c.z - pp.z) * player.left.z) || 1;
            px += player.left.x * side * 0.8 - player.fwd.x * 1.4;
            pz += player.left.z * side * 0.8 - player.fwd.z * 1.4;
          }
          tx = px - c.x; tz = pz - c.z;
          const l = Math.hypot(tx, tz) || 1;
          tx /= l; tz /= l;
          let vT;
          if (ps < 3) vT = d < 7 ? 0 : Math.min(14, d * 0.8);
          else if (d < 9) vT = pit ? ps + 3.5 : Math.max(0, ps - 1);
          else vT = Math.min(42 + S * 2, ps + 4 + d * 0.25);
          c.speed += U.clamp(vT - c.speed, -9 * dt, (6 + S * 0.6) * dt);
        } else {
          c.pathT -= dt;
          if (!c.path || c.pathT <= 0) {
            c.pathT = 2.5;
            const a = W.nearestNode(c.x, c.z, true), b = W.nearestNode(pp.x, pp.z, true);
            const path = a && b ? W.findPath(a.id, b.id) : null;
            c.path = path ? path.map((id) => W.nodes[id]) : null;
            c.pi = c.path && c.path.length > 1 ? 1 : 0;
          }
          let tgt = c.path && c.path[c.pi];
          if (tgt && Math.hypot(tgt.x - c.x, tgt.z - c.z) < 6 && c.pi < c.path.length - 1) { c.pi++; tgt = c.path[c.pi]; }
          if (!tgt) tgt = { x: pp.x, z: pp.z };
          tx = tgt.x - c.x; tz = tgt.z - c.z;
          const l = Math.hypot(tx, tz) || 1;
          tx /= l; tz /= l;
          const corner = c.path && c.pi < c.path.length - 1 ? Math.hypot(tgt.x - c.x, tgt.z - c.z) : 99;
          const vT = corner < 25 ? 12 + corner * 0.6 : 34 + S * 3;
          c.speed += U.clamp(vT - c.speed, -9 * dt, 6 * dt);
        }
        // turn toward target with a limited yaw rate
        const want = Math.atan2(tx, tz);
        const dy = U.angleWrap(want - c.yaw);
        c.yaw += U.clamp(dy, -2.4 * dt, 2.4 * dt);
        c.tx = Math.sin(c.yaw); c.tz = Math.cos(c.yaw);
        c.vx = c.tx * c.speed; c.vz = c.tz * c.speed;
        c.x += c.vx * dt; c.z += c.vz * dt;
        // slide along buildings instead of driving through them
        const rect = this.rectOf(c);
        W.query(c.x, c.z, 7, (o) => {
          if (!o.solid) return;
          const r = o.type === 'circle' ? SB.U.circleRect(o.x, o.z, o.r, rect) : SB.U.obbOverlap(rect, o);
          if (!r) return;
          const nx = o.type === 'circle' ? r.nx : r.nx, nz = o.type === 'circle' ? r.nz : r.nz;
          c.x += nx * r.depth; c.z += nz * r.depth;
          c.speed *= 0.97;
        });
      }
    }

    // ---------------------------------------------------------------- render
    writeInstances(night) {
      const W = this.world;
      let li = 0;
      const L = this.lp, C = this.lc, S = this.ls;
      const light = (x, y, z, r, g, b, a, s) => {
        if (li >= this.lmax) return;
        L[li * 3] = x; L[li * 3 + 1] = y; L[li * 3 + 2] = z;
        C[li * 4] = r; C[li * 4 + 1] = g; C[li * 4 + 2] = b; C[li * 4 + 3] = a;
        S[li] = s;
        li++;
      };
      const t = this.game.time;
      const blink = Math.floor(t * 2.6) % 2 === 0;
      const lightsOn = night > 0.3;
      const all = this.cars.concat(this.police);
      // compact live cars into the first `count` instances of each type
      const used = {};
      for (const ty of Object.keys(this.inst)) used[ty] = 0;
      for (const c of all) {
        if (c.view) { this.drawTrolley(c, lightsOn, light); continue; }
        const y = W.heightAt(c.x, c.z);
        _q.setFromAxisAngle(_up, c.yaw);
        _m.compose(_p.set(c.x, y, c.z), _q, _s);
        const inst = this.inst[c.type];
        const k = used[c.type]++;
        if (k >= inst.instanceMatrix.count) continue;
        inst.setMatrixAt(k, _m);
        inst.setColorAt(k, _col.set(c.color != null ? c.color : 0xffffff));
        const fx = c.tx, fz = c.tz, lx = fz, lz = -fx;
        const hl = c.len / 2, hw = c.wid / 2 - 0.3;
        if (lightsOn && c.state !== 'crashed') {
          for (const sg of [-1, 1]) light(c.x + fx * hl + lx * hw * sg, y + 0.7, c.z + fz * hl + lz * hw * sg, 1, 0.95, 0.8, 0.9, 0.9);
        }
        const braking = c.speed < 3 || (c.prevSpeed != null && c.speed < c.prevSpeed - 0.02);
        c.prevSpeed = c.speed;
        if (lightsOn || braking) for (const sg of [-1, 1]) light(c.x - fx * hl + lx * hw * sg, y + 0.8, c.z - fz * hl + lz * hw * sg, 1, 0.1, 0.05, braking ? 0.95 : 0.5, braking ? 0.7 : 0.45);
        if (c.ind && blink) {
          const sides = c.ind === 2 ? [-1, 1] : [c.ind === -1 ? 1 : -1];
          for (const sg of sides) { light(c.x + fx * hl + lx * (hw + 0.2) * sg, y + 0.7, c.z + fz * hl + lz * (hw + 0.2) * sg, 1, 0.6, 0.1, 1, 0.5); light(c.x - fx * hl + lx * (hw + 0.2) * sg, y + 0.8, c.z - fz * hl + lz * (hw + 0.2) * sg, 1, 0.6, 0.1, 1, 0.5); }
        }
        if (c.isPolice && !c.disabled) {
          const ph = Math.floor(c.flash * 7) % 2;
          light(c.x + lx * 0.35, y + 1.6, c.z + lz * 0.35, ph ? 0.1 : 1, 0.15, ph ? 1 : 0.1, 1, 1.4);
          light(c.x - lx * 0.35, y + 1.6, c.z - lz * 0.35, ph ? 1 : 0.1, 0.15, ph ? 0.1 : 1, 1, 1.4);
        }
      }
      for (let i = this.alarmsT.length - 1; i >= 0; i--) {
        const a = this.alarmsT[i];
        a.t -= 1 / 60;
        if (a.t <= 0) { this.alarmsT.splice(i, 1); continue; }
        if (!blink) continue;
        const q = a.p, y = W.heightAt(q.x, q.z) + 0.7;
        const fx = Math.sin(q.heading), fz = Math.cos(q.heading), lx = fz, lz = -fx;
        for (const sg of [-1, 1]) for (const fb of [-1, 1]) light(q.x + fx * fb * q.len * 0.5 + lx * sg * 0.7, y, q.z + fz * fb * q.len * 0.5 + lz * sg * 0.7, 1, 0.6, 0.1, 1, 0.6);
      }
      for (let k = li; k < this.lmax; k++) C[k * 4 + 3] = 0;
      for (const ty of Object.keys(this.inst)) {
        const inst = this.inst[ty];
        inst.count = used[ty];
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      }
      this.lpA.needsUpdate = this.lcA.needsUpdate = this.lsA.needsUpdate = true;
    }
  }
  const _p2 = new T.Vector3();
  const _col = new T.Color();
  SB.Traffic = Traffic;
})();
