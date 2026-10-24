// SHIFTBREAKER — Kıyıkent: procedural Istanbul-inspired fictional city.
// Terrain height is analytic (exact for physics), roads form a graph used by traffic, GPS and races.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;

  const B = { minX: -1100, maxX: 1300, minZ: -1100, maxZ: 1100 }; // rendered terrain
  const PLAY = { minX: -720, maxX: 920, minZ: -720, maxZ: 720 }; // drivable area
  const SG = { minX: -760, minZ: -760, w: 1720, h: 1520, res: 1 }; // surface grid (1 m cells)
  const S_ID = { grass: 0, asphalt: 1, cobble: 2, dirt: 3, gravel: 4, concrete: 5, deck: 6, sidewalk: 7 };
  const S_NAME = ['grass', 'asphalt', 'cobble', 'dirt', 'gravel', 'concrete', 'deck', 'concrete'];
  const CURB = 0.06;

  const KIND = {
    highway: { w: 18, lanes: 2, limit: 90, tex: 'road4', walk: false, surf: 'asphalt' },
    avenue: { w: 16, lanes: 2, limit: 70, tex: 'road4', walk: true, surf: 'asphalt' },
    street: { w: 12, lanes: 1, limit: 50, tex: 'road2', walk: true, surf: 'asphalt' },
    hstreet: { w: 10, lanes: 1, limit: 40, tex: 'cobble', walk: true, surf: 'cobble' },
    lane: { w: 8, lanes: 1, limit: 30, tex: 'cobble', walk: true, surf: 'cobble' },
    industrial: { w: 14, lanes: 1, limit: 50, tex: 'road2', walk: false, surf: 'asphalt' },
    bridge: { w: 18, lanes: 2, limit: 90, tex: 'road4', walk: false, surf: 'deck' },
    serp: { w: 9, lanes: 1, limit: 60, tex: 'road2', walk: false, surf: 'asphalt' },
    taxi: { w: 12, lanes: 1, limit: 50, tex: 'road2', walk: false, surf: 'asphalt' },
    runway: { w: 46, lanes: 1, limit: 0, tex: 'runway', walk: false, surf: 'asphalt', noTraffic: true },
  };

  // ---------------------------------------------------------------- analytic terrain
  const RAMPS = [
    { x: 258, z: -640, ang: 0, len: 13, len2: 4, w: 7, h: 2.4 },
    { x: 712, z: -180, ang: 0, len: 14, len2: 4, w: 8, h: 3.0 },
    { x: 600, z: -40, ang: Math.PI, len: 0, len2: 0, w: 0, h: 0 }, // placeholder (disabled)
  ].filter((r) => r.len > 0);
  const HILL = { x: 735, z: 405, up: 30, flat: 18, down: 30, h: 3, w: 16 }; // license-course test slope

  // deterministic 0..1 hash (keeps prop choices independent of the city's random stream)
  function hash01(x, z) {
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return h - Math.floor(h);
  }

  function zoneAt(x, z) {
    if (x > 360 && x < 640) return 'water';
    if (x >= 640) return 'east';
    if (x < -690 || z < -690 || z > 690) return 'outside';
    if (x < -240 && z < -240) return 'historic';
    if (x < -240 && z > 240) return 'forest';
    if (x > -240 && z > 240) return 'business';
    if (x > 0 && z < -360) return 'port';
    return 'city';
  }

  function rampH(x, z) {
    let add = 0;
    for (let i = 0; i < RAMPS.length; i++) {
      const r = RAMPS[i];
      const s = Math.sin(r.ang), c = Math.cos(r.ang);
      const dx = x - r.x, dz = z - r.z;
      const u = dx * s + dz * c, v = dx * c - dz * s;
      if (Math.abs(v) > r.w * 0.5 || u < 0 || u > r.len + r.len2) continue;
      add += u <= r.len ? (r.h * u) / r.len : r.h * (1 - (u - r.len) / r.len2);
    }
    const hh = HILL;
    if (Math.abs(x - hh.x) < hh.w * 0.5) {
      const u = z - hh.z;
      if (u > 0 && u < hh.up + hh.flat + hh.down) {
        if (u < hh.up) add += (hh.h * u) / hh.up;
        else if (u < hh.up + hh.flat) add += hh.h;
        else add += hh.h * (1 - (u - hh.up - hh.flat) / hh.down);
      }
    }
    return add;
  }

  function terrainH(x, z) {
    let h = 3 +
      30 * Math.exp(-((x + 430) * (x + 430) + (z + 430) * (z + 430)) / 57800) +
      42 * Math.exp(-((x + 470) * (x + 470) + (z - 470) * (z - 470)) / 72200) +
      1.2 * Math.sin(x * 0.011) * Math.cos(z * 0.013);
    // distant hills on the horizon
    const r = Math.max(Math.abs(x - 100) - 850, Math.abs(z) - 820);
    if (r > 0) h += Math.min(60, r * 0.25) * (0.6 + 0.4 * Math.sin(x * 0.004 + z * 0.006));
    // the strait (Boğaz) runs north–south
    if (x > 360 && x < 640) {
      const d = Math.min(x - 360, 640 - x);
      h = U.lerp(h, -9, U.smoothstep(0, 22, d));
    }
    // airport runway is flat
    if (x > 740 && x < 840 && Math.abs(z) < 640) h = U.lerp(h, 3, U.smoothstep(50, 30, Math.abs(x - 790)));
    return h;
  }

  // Bridge deck: meets the coastal-road junctions exactly, arches 9.5 m over the strait (≤ 10 % grade)
  let DECK0 = null, DECK1 = null;
  function deckH(x) {
    if (DECK0 === null) { DECK0 = terrainH(345, 0); DECK1 = terrainH(655, 0); }
    const t = U.clamp((x - 345) / 310, 0, 1);
    return U.lerp(DECK0, DECK1, t) + 9.5 * Math.sin(Math.PI * t);
  }

  // InstancedMesh in r128 never frustum-culls. Split instances into ~240 m cells, each with its own
  // geometry clone whose bounding sphere covers that cell, so culling (and shadows) skip off-screen cells.
  function chunkInstances(parent, geo, mat, items, matrixOf, opts) {
    const o = opts || {};
    const cell = o.cell || 240;
    const groups = new Map();
    for (const it of items) {
      const k = Math.floor(it.x / cell) * 1000 + Math.floor(it.z / cell);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(it);
    }
    const out = [];
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const gr = geo.boundingSphere.radius + (o.extra || 0);
    const m = new T.Matrix4(), c = new T.Color();
    for (const list of groups.values()) {
      const g2 = geo.clone();
      const inst = new T.InstancedMesh(g2, mat, list.length);
      let cx = 0, cz = 0, cy = 0;
      list.forEach((it, i) => {
        matrixOf(it, m);
        inst.setMatrixAt(i, m);
        if (it.color != null) inst.setColorAt(i, c.set(it.color));
        cx += it.x; cz += it.z; cy += it.y || 0;
        it.inst = inst;
        it.idx = i;
      });
      cx /= list.length; cz /= list.length; cy /= list.length;
      let r = 0;
      for (const it of list) r = Math.max(r, Math.hypot(it.x - cx, it.z - cz));
      g2.boundingSphere = new T.Sphere(new T.Vector3(cx, cy, cz), r + gr * (o.scale || 1) + 8);
      inst.frustumCulled = true;
      inst.castShadow = !!o.shadow;
      inst.receiveShadow = true;
      inst.userData.center = g2.boundingSphere.center;
      inst.userData.maxDist = o.maxDist || 0;
      parent.add(inst);
      out.push(inst);
    }
    return out;
  }

  class World {
    constructor(scene, opts) {
      this.scene = scene;
      this.opts = opts || {};
      this.quality = this.opts.quality || 'high';
      this.rng = U.mulberry32(1453);
      this.group = new T.Group();
      scene.add(this.group);
      this.colliders = [];
      this.cgrid = new Map();
      this.surf = new Uint8Array(SG.w * SG.h);
      this.nodes = [];
      this.edges = [];
      this.pois = [];
      this.parked = [];
      this.signals = [];
      this.speedTraps = [];
      this.radars = [];
      this.collectibles = [];
      this.driftZones = [];
      this.jumps = RAMPS.map((r, i) => ({ id: 'jump' + i, x: r.x, z: r.z, ang: r.ang, len: r.len + r.len2 }));
      this.lampGlows = [];
      this.nightMats = [];
      this.props = []; // GLB buildings, landmarks and stations: { id, x, y, z, rot }
      this.unlitMats = []; // scanned (unlit) models, darkened at night
      this.time = 0;
      this.anisotropy = this.opts.anisotropy || 4;
      this.buildRoads();
      this.rasterRoads();
      this.definePOIs();
      this.placeParked();
      this.buildTerrain();
      this.buildRoadMeshes();
      this.buildBlocks();
      this.buildLandmarks();
      this.buildBridge();
      this.buildStreetFurniture();
      this.buildSignals();
      this.buildWater();
      this.buildMinimap();
    }

    // ---------------------------------------------------------------- queries
    zoneAt(x, z) { return zoneAt(x, z); }
    surfIdx(x, z) {
      const ix = Math.floor(x - SG.minX), iz = Math.floor(z - SG.minZ);
      if (ix < 0 || iz < 0 || ix >= SG.w || iz >= SG.h) return 0;
      return this.surf[iz * SG.w + ix];
    }
    rawH(x, z) {
      let h = terrainH(x, z) + rampH(x, z);
      if (x > 345 && x < 655 && Math.abs(z) < 10.5) {
        const d = deckH(x);
        if (d > h - 0.6) h = d;
      }
      return h;
    }
    heightAt(x, z) {
      const h = this.rawH(x, z);
      return this.surfIdx(x, z) === 7 ? h + CURB : h;
    }
    // Ground under (x, z) for the wheels: height, normal, surface name, water flag.
    groundAt(x, z, out) {
      const e = 0.35;
      const h = this.heightAt(x, z);
      const hx = this.rawH(x + e, z) - this.rawH(x - e, z);
      const hz = this.rawH(x, z + e) - this.rawH(x, z - e);
      let nx = -hx, ny = 2 * e, nz = -hz;
      const l = Math.hypot(nx, ny, nz);
      out.h = h;
      out.nx = nx / l; out.ny = ny / l; out.nz = nz / l;
      const si = this.surfIdx(x, z);
      out.surf = S_NAME[si];
      out.water = h < -0.4;
      return out;
    }
    surfaceName(x, z) { return S_NAME[this.surfIdx(x, z)]; }
    inPlay(x, z) { return x > PLAY.minX && x < PLAY.maxX && z > PLAY.minZ && z < PLAY.maxZ; }

    addCollider(c) {
      c.id = this.colliders.length;
      this.colliders.push(c);
      const r = c.r || Math.hypot(c.hl || 0, c.hw || 0);
      const x0 = Math.floor((c.x - r) / 16), x1 = Math.floor((c.x + r) / 16);
      const z0 = Math.floor((c.z - r) / 16), z1 = Math.floor((c.z + r) / 16);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const k = ix * 4096 + iz;
        let a = this.cgrid.get(k);
        if (!a) this.cgrid.set(k, (a = []));
        a.push(c.id);
      }
      return c;
    }
    removeCollider(c) {
      c.dead = true;
    }
    // calls fn(collider) for statics near (x, z) within radius r (deduplicated)
    query(x, z, r, fn) {
      const stamp = (this._qs = (this._qs || 0) + 1);
      const x0 = Math.floor((x - r) / 16), x1 = Math.floor((x + r) / 16);
      const z0 = Math.floor((z - r) / 16), z1 = Math.floor((z + r) / 16);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const a = this.cgrid.get(ix * 4096 + iz);
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const c = this.colliders[a[i]];
          if (c.dead || c._q === stamp) continue;
          c._q = stamp;
          fn(c);
        }
      }
    }

    // ---------------------------------------------------------------- road graph
    buildRoads() {
      const segsX = [], segsZ = [];
      const addX = (x, z0, z1, kind) => segsX.push({ x, a: z0, b: z1, kind });
      const addZ = (z, x0, x1, kind) => segsZ.push({ z, a: x0, b: x1, kind });
      const histKind = (x, z) => (zoneAt(x, z) === 'historic' ? 'hstreet' : 'street');
      // west city verticals
      for (const x of [-690, -600, -480, -360, -240, -120, 0, 120, 240, 345]) {
        if (x === -690 || x === 345) addX(x, -690, 690, 'highway');
        else if (x === 0 || x === -240) addX(x, -690, 690, 'avenue');
        else if (x < -240) { addX(x, -690, -240, 'hstreet'); addX(x, -240, 240, 'street'); }
        else if (x < 0) addX(x, -690, 690, 'street');
        else addX(x, -360, 690, 'street');
      }
      addX(170, -690, -360, 'industrial');
      for (const z of [-690, -600, -480, -360, -240, -120, 0, 120, 240, 360, 480, 600, 690]) {
        if (z === -690 || z === 690) addZ(z, -690, 345, 'highway');
        else if (z === 0 || z === 360) addZ(z, z === 360 ? -240 : -690, 345, 'avenue');
        else if (z > 240) addZ(z, -240, 345, 'street');
        else if (z < -360) { addZ(z, -690, -240, 'hstreet'); addZ(z, -240, 0, 'street'); }
        else if (z === -360 || z === -240) { addZ(z, -690, -240, 'hstreet'); addZ(z, -240, 345, 'street'); }
        else addZ(z, -690, 345, 'street');
      }
      // historic lanes (cobblestone, narrow)
      for (const x of [-540, -420, -300]) addX(x, -600, -240, 'lane');
      for (const z of [-540, -420, -300]) addZ(z, -600, -240, 'lane');
      // east side
      addX(655, -600, 600, 'highway');
      for (const z of [-300, 0, 300]) addZ(z, 655, 790, 'taxi');
      addX(790, -620, 620, 'runway');
      void histKind;

      const nodeMap = new Map();
      const node = (x, z) => {
        const k = Math.round(x) + ',' + Math.round(z);
        let n = nodeMap.get(k);
        if (!n) { n = { id: this.nodes.length, x, z, edges: [] }; this.nodes.push(n); nodeMap.set(k, n); }
        return n;
      };
      // special nodes that must split segments
      const extra = [[-690, 480], [-240, 360], [345, 0], [655, 0]];
      for (const sx of segsX) {
        const pts = [sx.a, sx.b];
        for (const sz of segsZ) if (sx.x >= sz.a - 0.1 && sx.x <= sz.b + 0.1 && sz.z >= sx.a - 0.1 && sz.z <= sx.b + 0.1) pts.push(sz.z);
        for (const [ex, ez] of extra) if (Math.abs(ex - sx.x) < 0.1 && ez >= sx.a && ez <= sx.b) pts.push(ez);
        sx.pts = Array.from(new Set(pts)).sort((p, q) => p - q);
      }
      for (const sz of segsZ) {
        const pts = [sz.a, sz.b];
        for (const sx of segsX) if (sx.x >= sz.a - 0.1 && sx.x <= sz.b + 0.1 && sz.z >= sx.a - 0.1 && sz.z <= sx.b + 0.1) pts.push(sx.x);
        for (const [ex, ez] of extra) if (Math.abs(ez - sz.z) < 0.1 && ex >= sz.a && ex <= sz.b) pts.push(ex);
        sz.pts = Array.from(new Set(pts)).sort((p, q) => p - q);
      }
      for (const sx of segsX) for (let i = 0; i < sx.pts.length - 1; i++) this.addEdge(node(sx.x, sx.pts[i]), node(sx.x, sx.pts[i + 1]), sx.kind, null);
      for (const sz of segsZ) for (let i = 0; i < sz.pts.length - 1; i++) this.addEdge(node(sz.pts[i], sz.z), node(sz.pts[i + 1], sz.z), sz.kind, null);

      // bridge over the strait (deck follows deckH)
      {
        const pts = [];
        for (let x = 345; x <= 655.01; x += 5) pts.push(x, 0);
        this.addEdge(node(345, 0), node(655, 0), 'bridge', pts, 'bridge');
      }
      // forest serpentine: up to the summit, then down to the ring
      {
        const up = [[-240, 360], [-262, 372], [-300, 384], [-330, 410], [-332, 446], [-306, 470], [-282, 500], [-306, 530], [-352, 528], [-392, 500], [-420, 470], [-440, 446], [-470, 446]];
        const down = [[-470, 446], [-500, 452], [-528, 480], [-530, 516], [-500, 548], [-470, 576], [-500, 604], [-552, 600], [-590, 570], [-618, 530], [-650, 498], [-690, 480]];
        const smooth = (cp) => {
          const v = cp.map((p) => new T.Vector3(p[0], 0, p[1]));
          const curve = new T.CatmullRomCurve3(v, false, 'centripetal');
          const len = curve.getLength();
          const n = Math.max(2, Math.round(len / 5));
          const out = [];
          for (let i = 0; i <= n; i++) { const p = curve.getPointAt(i / n); out.push(p.x, p.z); }
          return out;
        };
        const summit = node(-470, 446);
        summit.summit = true;
        this.addEdge(node(-240, 360), summit, 'serp', smooth(up), 'serpUp');
        this.addEdge(summit, node(-690, 480), 'serp', smooth(down), 'serpDown');
      }
      for (const n of this.nodes) {
        let w = 0;
        for (const ei of n.edges) w = Math.max(w, this.edges[ei].w);
        n.half = n.edges.length > 2 || n.summit ? w * 0.5 : n.edges.length === 2 ? w * 0.5 : 0;
        n.deg = n.edges.length;
      }
    }

    addEdge(a, b, kind, pts, name) {
      const K = KIND[kind];
      if (!pts) pts = [a.x, a.z, b.x, b.z];
      const e = { id: this.edges.length, a: a.id, b: b.id, kind, w: K.w, lanes: K.lanes, limit: K.limit, tex: K.tex, surf: K.surf, walk: K.walk, noTraffic: !!K.noTraffic, name: name || null, pts: Float32Array.from(pts) };
      const n = pts.length / 2;
      e.cum = new Float32Array(n);
      for (let i = 1; i < n; i++) e.cum[i] = e.cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      e.len = e.cum[n - 1];
      this.edges.push(e);
      a.edges.push(e.id);
      b.edges.push(e.id);
      return e;
    }

    // Point at distance d along edge (from node a). out: {x, z, tx, tz} ; hint speeds up sequential lookups.
    edgePoint(e, d, out, hint) {
      const n = e.cum.length;
      d = U.clamp(d, 0, e.len);
      let i = hint && hint.i < n - 1 ? hint.i : 0;
      if (e.cum[i] > d) i = 0;
      while (i < n - 2 && e.cum[i + 1] < d) i++;
      if (hint) hint.i = i;
      const sl = e.cum[i + 1] - e.cum[i] || 1;
      const t = (d - e.cum[i]) / sl;
      const x0 = e.pts[i * 2], z0 = e.pts[i * 2 + 1], x1 = e.pts[i * 2 + 2], z1 = e.pts[i * 2 + 3];
      out.x = x0 + (x1 - x0) * t;
      out.z = z0 + (z1 - z0) * t;
      out.tx = (x1 - x0) / sl;
      out.tz = (z1 - z0) / sl;
      return out;
    }
    otherNode(e, nid) { return e.a === nid ? e.b : e.a; }

    // Nearest point on any road (optionally only traffic roads).
    nearestRoad(x, z, trafficOnly) {
      let best = null, bd = Infinity;
      for (const e of this.edges) {
        if (trafficOnly && e.noTraffic) continue;
        const p = e.pts;
        for (let i = 0; i < p.length - 2; i += 2) {
          const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
          const dx = bx - ax, dz = bz - az;
          const l2 = dx * dx + dz * dz || 1;
          const t = U.clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
          const qx = ax + dx * t, qz = az + dz * t;
          const d = (qx - x) * (qx - x) + (qz - z) * (qz - z);
          if (d < bd) {
            bd = d;
            const l = Math.sqrt(l2);
            best = { edge: e, s: e.cum[i / 2] + t * l, x: qx, z: qz, tx: dx / l, tz: dz / l, dist: Math.sqrt(d) };
          }
        }
      }
      return best;
    }
    nearestNode(x, z, trafficOnly) {
      let best = null, bd = Infinity;
      for (const n of this.nodes) {
        if (trafficOnly && n.edges.every((ei) => this.edges[ei].noTraffic)) continue;
        const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    }
    // A* over the road graph. Returns array of node ids or null.
    findPath(fromId, toId, allowRunway) {
      const N = this.nodes;
      const g = new Map([[fromId, 0]]);
      const came = new Map();
      const open = [fromId];
      const goal = N[toId];
      const hcost = (id) => Math.hypot(N[id].x - goal.x, N[id].z - goal.z);
      const f = new Map([[fromId, hcost(fromId)]]);
      let guard = 0;
      while (open.length && guard++ < 5000) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (f.get(open[i]) < f.get(open[bi])) bi = i;
        const cur = open.splice(bi, 1)[0];
        if (cur === toId) {
          const path = [cur];
          let c = cur;
          while (came.has(c)) { c = came.get(c); path.unshift(c); }
          return path;
        }
        for (const ei of N[cur].edges) {
          const e = this.edges[ei];
          if (e.noTraffic && !allowRunway) continue;
          const nb = this.otherNode(e, cur);
          const ng = g.get(cur) + e.len;
          if (!g.has(nb) || ng < g.get(nb)) {
            g.set(nb, ng);
            f.set(nb, ng + hcost(nb));
            came.set(nb, cur);
            if (!open.includes(nb)) open.push(nb);
          }
        }
      }
      return null;
    }
    edgeBetween(a, b) {
      for (const ei of this.nodes[a].edges) {
        const e = this.edges[ei];
        if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
      }
      return null;
    }
    // Polyline [x,z,...] following a node path (edge geometry, correct direction).
    pathPolyline(path) {
      const out = [];
      for (let i = 0; i < path.length - 1; i++) {
        const e = this.edgeBetween(path[i], path[i + 1]);
        if (!e) continue;
        const fwd = e.a === path[i];
        const n = e.pts.length / 2;
        for (let k = 0; k < n; k++) {
          const j = fwd ? k : n - 1 - k;
          if (out.length && k === 0) continue;
          out.push(e.pts[j * 2], e.pts[j * 2 + 1]);
        }
      }
      return out;
    }

    // ---------------------------------------------------------------- surface raster
    markRect(x0, z0, x1, z1, id, onlyIf) {
      const ix0 = Math.max(0, Math.floor(x0 - SG.minX)), ix1 = Math.min(SG.w - 1, Math.floor(x1 - SG.minX));
      const iz0 = Math.max(0, Math.floor(z0 - SG.minZ)), iz1 = Math.min(SG.h - 1, Math.floor(z1 - SG.minZ));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const k = iz * SG.w + ix;
        if (onlyIf === undefined || onlyIf.includes(this.surf[k])) this.surf[k] = id;
      }
    }
    markSeg(ax, az, bx, bz, half, id, keep) {
      const x0 = Math.min(ax, bx) - half, x1 = Math.max(ax, bx) + half;
      const z0 = Math.min(az, bz) - half, z1 = Math.max(az, bz) + half;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const ix0 = Math.max(0, Math.floor(x0 - SG.minX)), ix1 = Math.min(SG.w - 1, Math.floor(x1 - SG.minX));
      const iz0 = Math.max(0, Math.floor(z0 - SG.minZ)), iz1 = Math.min(SG.h - 1, Math.floor(z1 - SG.minZ));
      for (let iz = iz0; iz <= iz1; iz++) {
        const cz = SG.minZ + iz + 0.5;
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = SG.minX + ix + 0.5;
          const t = U.clamp(((cx - ax) * dx + (cz - az) * dz) / l2, 0, 1);
          const qx = ax + dx * t - cx, qz = az + dz * t - cz;
          if (qx * qx + qz * qz <= half * half) {
            const k = iz * SG.w + ix;
            if (keep && keep.includes(this.surf[k])) continue;
            this.surf[k] = id;
          }
        }
      }
    }
    rasterRoads() {
      // base by zone
      for (let iz = 0; iz < SG.h; iz += 1) {
        const z = SG.minZ + iz + 0.5;
        for (let ix = 0; ix < SG.w; ix++) {
          const x = SG.minX + ix + 0.5;
          const zn = zoneAt(x, z);
          let id = S_ID.grass;
          if (zn === 'city' || zn === 'business' || zn === 'historic') id = S_ID.concrete;
          else if (zn === 'port') id = S_ID.concrete;
          else if (zn === 'forest') id = (Math.sin(x * 0.07) + Math.cos(z * 0.05)) > 0.6 ? S_ID.dirt : S_ID.grass;
          this.surf[iz * SG.w + ix] = id;
        }
      }
      const roadIds = [S_ID.asphalt, S_ID.cobble, S_ID.deck];
      // sidewalks first, then roads on top
      for (const e of this.edges) {
        if (!e.walk) continue;
        const p = e.pts;
        for (let i = 0; i < p.length - 2; i += 2) this.markSeg(p[i], p[i + 1], p[i + 2], p[i + 3], e.w * 0.5 + 3.5, S_ID.sidewalk, roadIds);
      }
      for (const e of this.edges) {
        const p = e.pts;
        const id = S_ID[e.surf];
        for (let i = 0; i < p.length - 2; i += 2) this.markSeg(p[i], p[i + 1], p[i + 2], p[i + 3], e.w * 0.5, id);
      }
      // intersections are road
      for (const n of this.nodes) if (n.half > 0) {
        const e0 = this.edges[n.edges[0]];
        const id = n.edges.some((ei) => this.edges[ei].surf === 'asphalt') ? S_ID.asphalt : S_ID[e0.surf];
        this.markRect(n.x - n.half, n.z - n.half, n.x + n.half, n.z + n.half, id);
      }
      // port yards, runway apron, license course
      this.markRect(178, -682, 337, -368, S_ID.asphalt, [S_ID.concrete, S_ID.sidewalk]);
      this.markRect(700, 360, 770, 520, S_ID.asphalt, [S_ID.grass]);
      this.markRect(700, -260, 760, -100, S_ID.dirt, [S_ID.grass]);
    }

    // ---------------------------------------------------------------- POIs & reserved lots
    definePOIs() {
      // lot rects are block cells; marker sits in front of the building facing the road
      const P = (id, type, x, z, heading, extra) => {
        const p = Object.assign({ id, type, x, z, heading, r: 7 }, extra || {});
        this.pois.push(p);
        return p;
      };
      this.reserved = [];
      const reserve = (x0, z0, x1, z1, kind, extra) => this.reserved.push(Object.assign({ x0, z0, x1, z1, kind }, extra || {}));
      reserve(10, -110, 110, -14, 'garage');
      P('garage', 'garage', 60, -22, 0);
      reserve(130, -110, 230, -14, 'parkinglot');
      P('gas1', 'gas', -180, 22, Math.PI, { fuel: true });
      reserve(-230, 14, -130, 110, 'gas');
      P('gas2', 'gas', 230, -300, Math.PI / 2, { fuel: true });
      reserve(130, -350, 232, -250, 'gas');
      P('gas3', 'gas', 680, 110, -Math.PI / 2, { fuel: true });
      P('repair1', 'repair', -60, -132, 0);
      reserve(-110, -230, -10, -134, 'repair');
      P('repair2', 'repair', 180, 372, Math.PI);
      reserve(130, 368, 230, 470, 'repair');
      P('gallery', 'gallery', -60, 132, Math.PI);
      reserve(-110, 128, -10, 230, 'gallery');
      P('modshop', 'modshop', 292, 10, Math.PI);
      reserve(250, 10, 336, 110, 'modshop');
      P('license', 'license', 742, 368, 0, { r: 9 });
      P('drag', 'drag', 790, -585, 0, { r: 10 });
      // landmarks
      reserve(-478, -478, -422, -422, 'mosque');
      reserve(-235, -115, -125, -5, 'mosque', { garden: true });
      reserve(-358, -298, -302, -242, 'tower');
      reserve(-110, -110, -10, -14, 'park');
      reserve(-350, 10, -250, 110, 'park');
      // street race invites & parking missions (markers on roads)
      P('street1', 'streetRace', -100, 360, Math.PI / 2, { event: 'street' });
      P('street2', 'streetRace', 345, -150, 0, { event: 'sprintBridge' });
      P('park_parallel', 'parking', 64, 117, Math.PI / 2, { mission: 'parallel' });
      P('park_bay', 'parking', 160, -24, Math.PI, { mission: 'bay' });
      P('park_angled', 'parking', 205, -24, Math.PI, { mission: 'angled' });
      P('park_hill', 'parking', -418, -304, 0, { mission: 'hill' });
      P('park_exit', 'parking', 17, -66, Math.PI, { mission: 'exit' });
      // parking lot layout (bays referenced by parking missions and parked cars)
      this.lot = {
        rows: [
          { z: -36, x0: 136, n: 32, w: 2.75, depth: 5.2, ang: 0, open: -1 },
          { z: -62, x0: 136, n: 32, w: 2.75, depth: 5.2, ang: 0, open: 1 },
          { z: -97, x0: 140, n: 22, w: 3.8, depth: 5.2, ang: Math.PI / 4, open: 1 },
        ],
      };
      // free-roam activities
      this.speedTraps = [
        { id: 'trapCoast', x: 345, z: -420, axis: 'z', stars: [110, 140, 170] },
        { id: 'trapRing', x: -300, z: 690, axis: 'x', stars: [120, 150, 180] },
        { id: 'trapBridge', x: 500, z: 0, axis: 'x', stars: [110, 140, 170] },
        { id: 'trapRunway', x: 790, z: 200, axis: 'z', stars: [180, 220, 250] },
      ];
      this.radars = [
        { id: 'radar1', x: 0, z: -300, limit: 70 },
        { id: 'radar2', x: -240, z: 60, limit: 70 },
        { id: 'radar3', x: 120, z: 300, limit: 50 },
        { id: 'radar4', x: 345, z: 300, limit: 90 },
      ];
      this.driftZones = [{ id: 'driftPort', x: 258, z: -520, r: 70, stars: [8000, 20000, 40000] }, { id: 'driftApron', x: 735, z: 440, r: 45, stars: [6000, 15000, 30000] }];
      const rnd = this.rng;
      const spots = [[-450, -400], [-300, 520], [500, -30], [790, 500], [258, -470], [-600, -100], [100, 620], [-120, -600], [655, -450], [-470, 446], [0, 0], [-360, -540], [240, 690], [345, 600], [-690, -300], [120, -200], [700, -580], [-540, 300], [790, -420], [-240, 480]];
      this.collectibles = spots.map((s, i) => ({ id: 'nazar' + i, x: s[0] + (rnd() - 0.5) * 4, z: s[1] + (rnd() - 0.5) * 4 }));
    }
    // Static parked cars along streets and in the parking lot (rendered by the traffic module).
    placeParked() {
      const r = this.rng;
      const p = {};
      const near = (x, z, d) => this.pois.some((q) => Math.hypot(q.x - x, q.z - z) < d);
      for (const e of this.edges) {
        if (e.kind !== 'street' && e.kind !== 'hstreet') continue;
        const A = this.nodes[e.a], Bn = this.nodes[e.b];
        const off = e.w / 2 - 1.05;
        for (let d = A.half + 12; d < e.len - Bn.half - 12; d += 6.5 + r() * 4) {
          if (r() > 0.32) continue;
          this.edgePoint(e, d, p);
          const side = r() < 0.5 ? 1 : -1;
          const x = p.x - p.tz * side * off, z = p.z + p.tx * side * off;
          if (near(x, z, 16)) continue;
          const heading = Math.atan2(p.tx * -side, p.tz * -side) + (side < 0 ? Math.PI : 0);
          this.parked.push({ x, z, heading: Math.atan2(side > 0 ? p.tx : -p.tx, side > 0 ? p.tz : -p.tz), type: r() < 0.18 ? 'hatch' : r() < 0.85 ? 'sedan' : 'van', color: U.pick(SB.DATA.PAINT, r) });
          void heading;
        }
      }
      // parking lot: leave mission bays free
      for (let ri = 0; ri < this.lot.rows.length; ri++) {
        const row = this.lot.rows[ri];
        for (let i = 0; i < row.n; i++) {
          if (r() > 0.55) continue;
          if (ri === 0 && i >= 8 && i <= 11) continue;
          if (ri === 2 && i >= 9 && i <= 12) continue;
          const x = row.x0 + (i + 0.5) * row.w;
          const facing = row.open > 0 ? 0 : Math.PI;
          this.parked.push({ x, z: row.z, heading: row.ang ? facing + row.ang : facing, type: r() < 0.3 ? 'hatch' : 'sedan', color: U.pick(SB.DATA.PAINT, r), lot: true });
        }
      }
      for (const c of this.parked) {
        const L = c.type === 'van' ? 5.1 : c.type === 'hatch' ? 4.0 : 4.6;
        c.len = L;
        c.wid = c.type === 'van' ? 2.0 : 1.8;
        c.collider = this.addCollider({ type: 'box', x: c.x, z: c.z, hl: L / 2, hw: c.wid / 2, ang: c.heading, y0: 0, y1: 99, solid: true, parked: c });
      }
    }
    isReserved(x, z, pad) {
      for (const r of this.reserved) if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return r;
      return null;
    }

    // ---------------------------------------------------------------- textures
    canvasTex(w, h, draw, repeat) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      draw(g, w, h);
      const t = new T.CanvasTexture(c);
      if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
      t.anisotropy = this.anisotropy;
      return t;
    }
    noise(g, w, h, base, amp, n) {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      const r = this.rng;
      for (let i = 0; i < n; i++) {
        const v = Math.floor((r() - 0.5) * amp);
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
    }
    roadTexture(kind) {
      return this.canvasTex(128, 512, (g, w, h) => {
        if (kind === 'cobble') {
          g.fillStyle = '#5d5650';
          g.fillRect(0, 0, w, h);
          const r = this.rng;
          for (let y = 0; y < h; y += 12) {
            const off = (y / 12) % 2 ? 6 : 0;
            for (let x = -12; x < w + 12; x += 13) {
              const l = 80 + Math.floor(r() * 40);
              g.fillStyle = `rgb(${l + 18},${l + 10},${l})`;
              g.beginPath();
              g.roundRect ? g.roundRect(x + off + 1, y + 1, 11, 10, 3) : g.rect(x + off + 1, y + 1, 11, 10);
              g.fill();
            }
          }
          return;
        }
        this.noise(g, w, h, kind === 'runway' ? '#3b3d40' : '#3f4144', 70, 6000);
        g.fillStyle = 'rgba(255,255,255,0.03)';
        for (let i = 0; i < 40; i++) g.fillRect(this.rng() * w, 0, 1, h);
        const line = (u, dash, color, width) => {
          g.fillStyle = color;
          const x = u * w - width / 2;
          if (!dash) g.fillRect(x, 0, width, h);
          else for (let y = 0; y < h; y += dash[0] + dash[1]) g.fillRect(x, y, width, dash[0]);
        };
        const white = 'rgba(232,232,226,0.92)';
        if (kind === 'road2') {
          line(0.045, null, white, 3);
          line(0.955, null, white, 3);
          line(0.5, [170, 170], white, 3);
        } else if (kind === 'road4') {
          line(0.035, null, white, 3);
          line(0.965, null, white, 3);
          line(0.49, null, white, 2);
          line(0.51, null, white, 2);
          line(0.27, [128, 213], white, 2);
          line(0.73, [128, 213], white, 2);
        } else if (kind === 'runway') {
          line(0.02, null, white, 2);
          line(0.98, null, white, 2);
          line(0.5, [256, 256], white, 3);
        }
      }, true);
    }

    // ---------------------------------------------------------------- terrain
    buildTerrain() {
      const step = this.quality === 'low' ? 20 : 10;
      const nx = Math.round((B.maxX - B.minX) / step), nz = Math.round((B.maxZ - B.minZ) / step);
      const geo = new T.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ, nx, nz);
      geo.rotateX(-Math.PI / 2);
      geo.translate((B.minX + B.maxX) / 2, 0, (B.minZ + B.maxZ) / 2);
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const c = new T.Color();
      const tmp = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = terrainH(x, z);
        const under = this.surfIdx(x, z);
        pos.setY(i, h - (under === 1 || under === 2 || under === 6 || under === 7 ? 0.45 : 0.06));
        const zn = zoneAt(x, z);
        const s = this.surfIdx(x, z);
        if (h < -0.5) c.set(0x6d6650);
        else if (h < 1.5 && (zn === 'water' || zn === 'east')) c.set(0xb9a77e);
        else if (zn === 'forest') c.set(s === S_ID.dirt ? 0x6b5a3e : 0x3f5a2c);
        else if (zn === 'outside') c.set(h > 25 ? 0x5d6b45 : 0x5a7a3c);
        else if (zn === 'east') c.set(0x8a9254);
        else if (s === S_ID.concrete || s === S_ID.sidewalk) c.set(zn === 'historic' ? 0x6f665b : 0x67655f);
        else c.set(0x5f7d3d);
        tmp.setHSL(0, 0, (Math.sin(x * 0.13) * Math.cos(z * 0.11)) * 0.04);
        c.r += tmp.r; c.g += tmp.g; c.b += tmp.b;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const tex = this.canvasTex(256, 256, (g, w, h) => this.noise(g, w, h, '#d8d8d8', 110, 9000), true);
      tex.repeat.set((B.maxX - B.minX) / 12, (B.maxZ - B.minZ) / 12);
      const mat = new T.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.95, metalness: 0 });
      this.terrainMat = mat;
      const mesh = new T.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.terrain = mesh;
    }

    // ---------------------------------------------------------------- road meshes
    stripGeometry(list) {
      // list of {pts:[x,z...], w, y, v0, vScale, color?}; wide strips get extra columns so they hug the terrain
      let nv = 0, ni = 0;
      for (const s of list) {
        s._cols = s.cols || Math.max(1, Math.ceil(s.w / 6));
        const n = s.pts.length / 2;
        nv += n * (s._cols + 1);
        ni += (n - 1) * 6 * s._cols;
      }
      const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), nor = new Float32Array(nv * 3);
      const col = new Float32Array(nv * 3);
      const idx = new Uint32Array(ni);
      let v = 0, k = 0;
      for (const s of list) {
        const p = s.pts, n = p.length / 2, C = s._cols;
        let dist = s.v0 || 0;
        const c = new T.Color(s.color != null ? s.color : 0xffffff);
        const hw = s.w * 0.5;
        const off = s.off || 0;
        for (let i = 0; i < n; i++) {
          const x = p[i * 2], z = p[i * 2 + 1];
          const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
          let tx = p[i1 * 2] - p[i0 * 2], tz = p[i1 * 2 + 1] - p[i0 * 2 + 1];
          const tl = Math.hypot(tx, tz) || 1;
          tx /= tl; tz /= tl;
          const rx = -tz, rz = tx;
          if (i > 0) dist += Math.hypot(x - p[i * 2 - 2], z - p[i * 2 - 1]);
          const row = v;
          for (let j = 0; j <= C; j++) {
            const u = j / C;
            const o = off - hw + u * s.w;
            const px = x + rx * o, pz = z + rz * o;
            const py = (s.flatY != null ? s.flatY : this.rawH(px, pz)) + s.y;
            pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
            nor[v * 3 + 1] = 1;
            uv[v * 2] = u;
            uv[v * 2 + 1] = dist / (s.vScale || 12);
            col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
            v++;
          }
          if (i < n - 1) {
            for (let j = 0; j < C; j++) {
              const a = row + j, b = a + 1, cc = a + C + 1, d = cc + 1;
              idx[k++] = a; idx[k++] = b; idx[k++] = cc;
              idx[k++] = b; idx[k++] = d; idx[k++] = cc;
            }
          }
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      return geo;
    }
    resample(pts, step) {
      const out = [];
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
        const l = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(l / step));
        for (let k = 0; k < n; k++) out.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
      }
      out.push(pts[pts.length - 2], pts[pts.length - 1]);
      return out;
    }
    trimmed(e) {
      // edge polyline with both ends cut back by the intersection half-size
      const A = this.nodes[e.a], Bn = this.nodes[e.b];
      const t0 = A.half, t1 = e.len - Bn.half;
      if (t1 <= t0 + 0.5) return null;
      const out = [];
      const p = {};
      this.edgePoint(e, t0, p);
      out.push(p.x, p.z);
      for (let i = 1; i < e.cum.length - 1; i++) if (e.cum[i] > t0 && e.cum[i] < t1) out.push(e.pts[i * 2], e.pts[i * 2 + 1]);
      this.edgePoint(e, t1, p);
      out.push(p.x, p.z);
      return out;
    }
    buildRoadMeshes() {
      const byTex = {};
      const walks = [];
      for (const e of this.edges) {
        const tp = this.trimmed(e);
        if (!tp) continue;
        const pts = this.resample(tp, e.kind === 'bridge' ? 5 : 6);
        (byTex[e.tex] = byTex[e.tex] || []).push({ pts, w: e.w, y: 0.03, vScale: e.tex === 'runway' ? 40 : 12 });
        if (e.walk) {
          walks.push({ pts, w: 3.5, y: CURB + 0.02, off: e.w * 0.5 + 1.75, vScale: 3.5, color: 0xffffff });
          walks.push({ pts, w: 3.5, y: CURB + 0.02, off: -(e.w * 0.5 + 1.75), vScale: 3.5, color: 0xffffff });
        }
      }
      this.roadMats = [];
      for (const tex of Object.keys(byTex)) {
        const mat = new T.MeshStandardMaterial({ map: this.roadTexture(tex), roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        mat.userData.baseRough = 0.9;
        this.roadMats.push(mat);
        const m = new T.Mesh(this.stripGeometry(byTex[tex]), mat);
        m.receiveShadow = true;
        this.group.add(m);
      }
      // sidewalks (raised, tiled) + corner pads
      const walkTex = this.canvasTex(64, 64, (g, w, h) => {
        this.noise(g, w, h, '#7d7a74', 40, 600);
        g.strokeStyle = 'rgba(60,60,60,0.35)';
        g.lineWidth = 2;
        g.strokeRect(0, 0, w, h);
      }, true);
      const walkMat = new T.MeshStandardMaterial({ map: walkTex, roughness: 0.92, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const wm = new T.Mesh(this.stripGeometry(walks), walkMat);
      wm.receiveShadow = true;
      this.group.add(wm);
      // intersections
      const inter = [];
      const pads = [];
      for (const n of this.nodes) {
        if (n.half <= 0) continue;
        const h = n.half;
        inter.push({ pts: [n.x, n.z - h, n.x, n.z + h], w: h * 2, y: 0.032, vScale: 12, color: 0xffffff });
        if (n.edges.some((ei) => this.edges[ei].walk)) {
          for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const cx = n.x + sx * (h + 1.75), cz = n.z + sz * (h + 1.75);
            if (this.surfIdx(cx, cz) === 7) pads.push({ pts: [cx, cz - 1.75, cx, cz + 1.75], w: 3.5, y: CURB + 0.02, vScale: 3.5, color: 0xffffff });
          }
        }
      }
      const iMat = new T.MeshStandardMaterial({ map: this.roadTexture('plain'), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      iMat.userData.baseRough = 0.9;
      this.roadMats.push(iMat);
      const im = new T.Mesh(this.stripGeometry(inter), iMat);
      im.receiveShadow = true;
      this.group.add(im);
      if (pads.length) {
        const pm = new T.Mesh(this.stripGeometry(pads), walkMat);
        pm.receiveShadow = true;
        this.group.add(pm);
      }
      // special paved areas: port yard, apron, garage lots
      const areas = [
        [178, -682, 337, -368, 0x4a4b4d],
        [700, 360, 770, 520, 0x46474a],
        [700, -260, 760, -100, 0x6e5c43],
        [130, -110, 230, -14, 0x4a4b4d],
        [10, -110, 110, -14, 0x4f5052],
        [-230, 14, -130, 110, 0x505154],
        [130, -350, 232, -250, 0x505154],
        [663, 60, 740, 160, 0x505154],
        [-110, -230, -10, -134, 0x4d4e50],
        [130, 368, 230, 470, 0x4d4e50],
        [-110, 128, -10, 230, 0x56575a],
        [250, 10, 336, 110, 0x4d4e50],
      ];
      const ap = [];
      for (const [x0, z0, x1, z1, c] of areas) {
        const pts = this.resample([(x0 + x1) / 2, z0, (x0 + x1) / 2, z1], 8);
        ap.push({ pts, w: x1 - x0, y: 0.025, vScale: 12, color: c });
        if (c !== 0x6e5c43) this.markRect(x0, z0, x1, z1, S_ID.asphalt);
      }
      const aMat = new T.MeshStandardMaterial({ map: this.canvasTex(128, 128, (g, w, h) => this.noise(g, w, h, '#cfcfcf', 80, 2500), true), vertexColors: true, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const am = new T.Mesh(this.stripGeometry(ap), aMat);
      am.receiveShadow = true;
      this.group.add(am);
      this.markings = [];
      this.buildMarkings();
    }

    // flat white paint quads: stop lines, crosswalks, parking bays, runway, drag strip
    buildMarkings() {
      const quads = [];
      const q = (x, z, ang, len, wid, color, yOff) => quads.push({ x, z, ang, len, wid, color: color || 0xeeeeea, y: yOff || 0.045 });
      this.paintQuad = q;
      // parking lot bays
      for (const row of this.lot.rows) {
        for (let i = 0; i <= row.n; i++) {
          const x = row.x0 + i * row.w;
          if (row.ang) q(x + Math.sin(row.ang) * 0, row.z, row.ang, row.depth / Math.cos(row.ang) * 0.9, 0.12);
          else q(x, row.z, 0, row.depth, 0.12);
        }
        q(row.x0 + (row.n * row.w) / 2, row.z - (row.open * row.depth) / 2, Math.PI / 2, row.n * row.w, 0.12);
      }
      // runway markings
      for (const zEnd of [-610, 610]) for (let i = -5; i <= 5; i++) q(790 + i * 3.6, zEnd + (zEnd < 0 ? 20 : -20), 0, 30, 1.6);
      // drag strip start, 400 m and 800 m lines
      q(790, -570, Math.PI / 2, 40, 0.6, 0xffffff);
      q(790, -170, Math.PI / 2, 40, 0.8, 0xe8c547);
      q(790, 230, Math.PI / 2, 40, 0.8, 0xe8c547);
      const n = quads.length;
      const pos = new Float32Array(n * 12), col = new Float32Array(n * 12), idx = new Uint32Array(n * 6);
      const c = new T.Color();
      quads.forEach((m, i) => {
        const s = Math.sin(m.ang), co = Math.cos(m.ang);
        const corners = [[m.len / 2, m.wid / 2], [m.len / 2, -m.wid / 2], [-m.len / 2, -m.wid / 2], [-m.len / 2, m.wid / 2]];
        c.set(m.color);
        corners.forEach(([f, l], k) => {
          const x = m.x + f * s + l * co, z = m.z + f * co - l * s;
          pos[i * 12 + k * 3] = x;
          pos[i * 12 + k * 3 + 1] = this.rawH(x, z) + m.y;
          pos[i * 12 + k * 3 + 2] = z;
          col[i * 12 + k * 3] = c.r; col[i * 12 + k * 3 + 1] = c.g; col[i * 12 + k * 3 + 2] = c.b;
        });
        const b = i * 4;
        idx.set([b, b + 2, b + 1, b, b + 3, b + 2], i * 6);
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // ---------------------------------------------------------------- buildings
    facadeTextures() {
      const r = this.rng;
      const mk = (kind, lit) => this.canvasTex(256, 256, (g, w, h) => {
        const cw = w / 8, ch = h / 8;
        if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
        else if (kind === 'glass') { g.fillStyle = '#d6dde3'; g.fillRect(0, 0, w, h); }
        else if (kind === 'industrial') { this.noise(g, w, h, '#e6e6e2', 30, 800); }
        else { this.noise(g, w, h, '#f1ede6', 26, 1200); }
        for (let iy = 0; iy < 8; iy++) for (let ix = 0; ix < 8; ix++) {
          const x = ix * cw, y = iy * ch;
          if (kind === 'glass') {
            if (lit) { if (r() < 0.45) { g.fillStyle = `rgba(255,${210 + r() * 40},${150 + r() * 60},${0.55 + r() * 0.4})`; g.fillRect(x + 1, y + 3, cw - 2, ch - 6); } }
            else {
              g.fillStyle = `rgb(${40 + r() * 20},${62 + r() * 22},${84 + r() * 24})`;
              g.fillRect(x + 1, y + 3, cw - 2, ch - 6);
              g.fillStyle = 'rgba(255,255,255,0.16)';
              g.fillRect(x + 1, y + 3, cw - 2, 3);
            }
          } else if (kind === 'industrial') {
            if (!lit) { g.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < 6; k++) g.fillRect(x + k * (cw / 6), y, 1.5, ch); }
            if (iy === 1 && ix % 3 === 0) {
              if (lit) { if (r() < 0.5) { g.fillStyle = 'rgba(255,240,200,0.8)'; g.fillRect(x + 4, y + 8, cw - 8, ch - 16); } }
              else { g.fillStyle = '#3c4650'; g.fillRect(x + 4, y + 8, cw - 8, ch - 16); }
            }
          } else {
            const wx = x + cw * 0.22, wy = y + ch * 0.2, ww = cw * 0.56, wh = ch * 0.6;
            if (lit) {
              if (r() < 0.38) { g.fillStyle = `rgba(255,${200 + r() * 40},${120 + r() * 70},${0.6 + r() * 0.4})`; g.fillRect(wx, wy, ww, wh); }
            } else {
              g.fillStyle = 'rgba(0,0,0,0.25)';
              g.fillRect(wx - 2, wy - 2, ww + 4, wh + 5);
              g.fillStyle = `rgb(${46 + r() * 30},${56 + r() * 30},${66 + r() * 30})`;
              g.fillRect(wx, wy, ww, wh);
              g.fillStyle = 'rgba(255,255,255,0.1)';
              g.fillRect(wx, wy, ww, 3);
              g.fillStyle = 'rgba(255,255,255,0.5)';
              g.fillRect(wx - 2, wy + wh + 1, ww + 4, 2);
            }
          }
        }
      }, true);
      const out = {};
      for (const k of ['punched', 'glass', 'industrial']) {
        const mat = new T.MeshStandardMaterial({ map: mk(k, false), emissiveMap: mk(k, true), emissive: new T.Color(0xffd8a0), emissiveIntensity: 0, vertexColors: true, roughness: k === 'glass' ? 0.35 : 0.85, metalness: k === 'glass' ? 0.45 : 0 });
        this.nightMats.push({ mat, max: k === 'glass' ? 1.1 : 1.0 });
        out[k] = mat;
      }
      return out;
    }

    buildBlocks() {
      const mats = this.facadeTextures();
      const roofMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      const xs = [-690, -600, -540, -480, -420, -360, -300, -240, -120, 0, 120, 170, 240, 345];
      const zs = [-690, -600, -540, -480, -420, -360, -300, -240, -120, 0, 120, 240, 360, 480, 600, 690];
      this.chunks = new Map(); // key → {facade:{kind:[]}, roof:[]}
      const r = this.rng;
      const isRoad = (x, z) => { const s = this.surfIdx(x, z); return s === 1 || s === 2 || s === 6 || s === 7; };
      const shrinkSide = (x, z, dx, dz) => {
        // walk inward until we leave the road/sidewalk band
        let d = 0;
        while (d < 20 && isRoad(x + dx * d, z + dz * d)) d += 0.5;
        return d + 1.2;
      };
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        let x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const zone = zoneAt(cx, cz);
        if (zone === 'forest' || zone === 'outside' || zone === 'water' || zone === 'east') continue;
        if (zone === 'port') { this.buildPortBlock(x0, z0, x1, z1, mats); continue; }
        // inset from roads on each side
        x0 += shrinkSide(x0, cz, 1, 0);
        x1 -= shrinkSide(x1, cz, -1, 0);
        z0 += shrinkSide(cx, z0, 0, 1);
        z1 -= shrinkSide(cx, z1, 0, -1);
        if (x1 - x0 < 8 || z1 - z0 < 8) continue;
        this.fillBlock(x0, z0, x1, z1, zone, mats, r);
      }
      // merge chunk geometry
      for (const [, ch] of this.chunks) {
        for (const kind of Object.keys(ch.facade)) {
          const m = new T.Mesh(this.boxesGeometry(ch.facade[kind], false), mats[kind]);
          m.castShadow = this.quality !== 'low';
          m.receiveShadow = true;
          this.group.add(m);
        }
        if (ch.roof.length) {
          const m = new T.Mesh(this.boxesGeometry(ch.roof, true), roofMat);
          m.castShadow = this.quality !== 'low';
          m.receiveShadow = true;
          this.group.add(m);
        }
      }
    }
    chunkOf(x, z) {
      const k = Math.floor((x + 1200) / 240) * 100 + Math.floor((z + 1200) / 240);
      let c = this.chunks.get(k);
      if (!c) this.chunks.set(k, (c = { facade: {}, roof: [] }));
      return c;
    }
    // building record: x,z (center), hw (x half), hd (z half), y0, y1, color, kind, roof
    addBuilding(b) {
      const ch = this.chunkOf(b.x, b.z);
      (ch.facade[b.kind] = ch.facade[b.kind] || []).push(b);
      ch.roof.push(b);
      this.addCollider({ type: 'box', x: b.x, z: b.z, hl: b.hd, hw: b.hw, ang: 0, y0: b.y0, y1: b.y1, solid: true });
    }
    fillBlock(x0, z0, x1, z1, zone, mats, r) {
      const res = this.isReserved((x0 + x1) / 2, (z0 + z1) / 2, 0);
      if (res) { this.buildReserved(res, x0, z0, x1, z1); return; }
      const W = x1 - x0, D = z1 - z0;
      const pal = {
        historic: [0xd8b27a, 0xe8dcc0, 0xc8775a, 0xd9a3a0, 0xb7c4a0, 0xe0c9a0, 0xcfa98a],
        city: [0xc8c4bc, 0xb8b0a4, 0xd7d2c8, 0xa9a39a, 0xc9b9a3, 0xe0d7c6, 0x9fa6a8],
        business: [0x8fa7b8, 0x6f8fa8, 0xa5b4bf, 0x5d7486, 0x9aa9b0, 0xb9c3c9],
      }[zone] || [0xc0bab0];
      const rows = D > 46 ? 2 : 1;
      const lotMin = zone === 'business' ? 26 : zone === 'historic' ? 11 : 16;
      const lotMax = zone === 'business' ? 44 : zone === 'historic' ? 20 : 28;
      for (let row = 0; row < rows; row++) {
        const rz0 = rows === 1 ? z0 : row === 0 ? z0 : z0 + D / 2 + 1;
        const rz1 = rows === 1 ? z1 : row === 0 ? z0 + D / 2 - 1 : z1;
        let x = x0;
        while (x < x1 - 6) {
          const model = this.modelLot(zone, x, x1, rz0, rz1, rows, row);
          if (model) { x += model.lw; continue; }
          let lw = Math.min(x1 - x, lotMin + r() * (lotMax - lotMin));
          if (x1 - (x + lw) < lotMin * 0.6) lw = x1 - x;
          const gap = zone === 'historic' ? 0.2 : 1.5 + r() * 2;
          const bx0 = x + gap * 0.5, bx1 = x + lw - gap * 0.5;
          const depth = rz1 - rz0;
          const bd = zone === 'business' ? Math.min(depth, 20 + r() * 22) : Math.min(depth, depth * (0.7 + r() * 0.3));
          const bz0 = row === 0 && rows === 2 ? rz0 : rows === 1 ? (rz0 + rz1) / 2 - bd / 2 : rz1 - bd;
          const bz1 = bz0 + bd;
          if (zone === 'city' && r() < 0.06) { this.parkPatch(bx0, bz0, bx1, bz1); x += lw; continue; }
          let hgt;
          if (zone === 'historic') hgt = 8 + r() * 11;
          else if (zone === 'business') {
            const dc = Math.hypot((bx0 + bx1) / 2 - 60, (bz0 + bz1) / 2 - 480);
            hgt = 40 + r() * 60 + Math.max(0, 140 - dc * 0.6) * r();
          } else hgt = 12 + r() * 26;
          const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
          let y0 = Infinity, ymax = -Infinity;
          for (const [px, pz] of [[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1], [cx, cz]]) { const h = this.rawH(px, pz); y0 = Math.min(y0, h); ymax = Math.max(ymax, h); }
          const kind = zone === 'business' ? (r() < 0.85 ? 'glass' : 'punched') : 'punched';
          const b = { x: cx, z: cz, hw: (bx1 - bx0) / 2, hd: (bz1 - bz0) / 2, y0: y0 - 1.5, y1: ymax + hgt, color: U.pick(pal, r), kind, roof: zone === 'historic' && r() < 0.65 ? 'pitched' : 'flat', zone };
          this.addBuilding(b);
          if (zone === 'business' && hgt > 110 && r() < 0.6) {
            // setback crown
            const s = 0.6 + r() * 0.15;
            this.addBuilding({ x: cx, z: cz, hw: b.hw * s, hd: b.hd * s, y0: b.y1 - 1, y1: b.y1 + 10 + r() * 24, color: b.color, kind: 'glass', roof: 'flat', zone });
          }
          x += lw;
        }
      }
    }
    // Some lots get a real building model instead of a procedural block: Soviet panel towers and
    // Stalin-era houses in the city, New York towers downtown; copies of one model stay 140 m apart.
    modelLot(zone, x, x1, rz0, rz1, rows, row) {
      const cand = { city: ['panel', 'stalin'], historic: ['stalin'], business: ['nyc', 'panel'] }[zone];
      if (!cand || hash01(x * 0.37 + rz0 * 1.91, rz1 * 0.73 - x * 0.11) > 0.16) return null;
      const id = cand[Math.floor(hash01(x * 1.3, rz0 * 2.7) * cand.length)];
      const count = (this.modelCount = this.modelCount || {});
      if ((count[id] || 0) >= { panel: 7, stalin: 9, nyc: 6 }[id]) return null;
      const [fw, fd] = SB.DATA.PROPS[id].footprint;
      const lw = fw + 3;
      if (x + lw > x1 || rz1 - rz0 < fd + 1) return null;
      const cx = x + lw / 2;
      // the facade (+Z) faces the street on this row's side of the block
      const faceNeg = rows === 2 ? row === 0 : hash01(cx, rz0) < 0.5;
      const cz = faceNeg ? rz0 + fd / 2 + 0.5 : rz1 - fd / 2 - 0.5;
      if (this.props.some((p) => p.id === id && Math.hypot(p.x - cx, p.z - cz) < 140)) return null;
      const rot = faceNeg ? Math.PI : 0;
      this.placeProp(id, cx, this.groundUnder(id, cx, cz, rot) - 0.3, cz, rot);
      count[id] = (count[id] || 0) + 1;
      return { lw };
    }
    parkPatch(x0, z0, x1, z1) {
      this.treesExtra = this.treesExtra || [];
      for (let i = 0; i < 6; i++) this.treesExtra.push([U.lerp(x0, x1, this.rng()), U.lerp(z0, z1, this.rng()), 'round']);
    }
    buildReserved(res, x0, z0, x1, z1) {
      res.rect = [x0, z0, x1, z1];
      if (res.kind === 'park') this.parkPatch(x0 + 4, z0 + 4, x1 - 4, z1 - 4);
      // mosque garden: trees in the corners around the courtyard
      if (res.kind === 'mosque' && res.garden) for (const [a, b] of [[x0 + 3, z0 + 3], [x1 - 25, z0 + 3], [x0 + 3, z1 - 25], [x1 - 25, z1 - 25]]) this.parkPatch(a, b, a + 22, b + 22);
      // POI/landmark geometry is built in buildLandmarks()
    }
    buildPortBlock() {
      if (this._portDone) return;
      this._portDone = true;
      const r = this.rng;
      // warehouses on the west yard (x 8..162)
      for (let i = 0; i < 4; i++) {
        const z = -660 + i * 76;
        const b = { x: 86, z: z + 30, hw: 62, hd: 26, y0: 1, y1: this.rawH(86, z + 30) + 10 + r() * 5, color: U.pick([0x8c8a7a, 0x7a8890, 0x9b8f7a, 0x7d8a7a], r), kind: 'industrial', roof: 'flat', zone: 'port' };
        this.addBuilding(b);
      }
      // container stacks on the east yard (leave the drift area clear)
      this.containers = [];
      const cols = [0xb8452c, 0x2c6fb8, 0x2f8a4b, 0xd8a12c, 0x7a3fa0, 0xcfcfcf, 0x2b2b2b, 0xc24f87];
      for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) {
        const x = 200 + row * 9;
        const z = -430 + i * 6.6;
        if (z > -370) continue;
        const stack = 1 + Math.floor(r() * 3);
        for (let k = 0; k < stack; k++) this.containers.push({ x, z, y: 3 + k * 2.6, color: U.pick(cols, r) });
        this.addCollider({ type: 'box', x, z, hl: 1.25, hw: 3.05, ang: 0, y0: 0, y1: 3 + stack * 2.6, solid: true });
      }
      for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) {
        const x = 320 - row * 7;
        const z = -670 + i * 6.6;
        const stack = 1 + Math.floor(r() * 3);
        for (let k = 0; k < stack; k++) this.containers.push({ x, z, y: 3 + k * 2.6, color: U.pick(cols, r) });
        this.addCollider({ type: 'box', x, z, hl: 1.25, hw: 3.05, ang: 0, y0: 0, y1: 3 + stack * 2.6, solid: true });
      }
    }

    // Merge boxes into one geometry. Facades get UVs scaled to window cells; roofs get flat color.
    boxesGeometry(list, roofs) {
      const P = [], N = [], UV = [], C = [], I = [];
      const col = new T.Color();
      const push = (x, y, z, nx, ny, nz, u, v) => { P.push(x, y, z); N.push(nx, ny, nz); UV.push(u, v); C.push(col.r, col.g, col.b); };
      const quad = (a, b, c, d, n, uvs) => {
        const base = P.length / 3;
        push(...a, ...n, uvs[0], uvs[1]); push(...b, ...n, uvs[2], uvs[3]); push(...c, ...n, uvs[4], uvs[5]); push(...d, ...n, uvs[6], uvs[7]);
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      const cellW = 3.4 * 8, cellH = 3.2 * 8;
      for (const b of list) {
        const x0 = b.x - b.hw, x1 = b.x + b.hw, z0 = b.z - b.hd, z1 = b.z + b.hd, y0 = b.y0, y1 = b.y1;
        if (!roofs) {
          col.set(b.color);
          const ou = b.uo != null ? b.uo : (b.uo = Math.floor(this.rng() * 8) / 8);
          const ov = 0.0;
          const h = (y1 - y0) / cellH;
          const wx = (x1 - x0) / cellW, wz = (z1 - z0) / cellW;
          quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [ou, ov, ou + wx, ov, ou + wx, ov + h, ou, ov + h]);
          quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [ou, ov, ou + wx, ov, ou + wx, ov + h, ou, ov + h]);
          quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [ou, ov, ou + wz, ov, ou + wz, ov + h, ou, ov + h]);
          quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [ou, ov, ou + wz, ov, ou + wz, ov + h, ou, ov + h]);
        } else {
          if (b.roof === 'pitched') {
            col.set(0x9c4a32);
            const peak = [b.x, y1 + Math.min(b.hw, b.hd) * 0.7, b.z];
            const tri = (a, c) => {
              const base = P.length / 3;
              const nx = (a[0] + c[0]) / 2 - b.x, nz = (a[2] + c[2]) / 2 - b.z;
              const l = Math.hypot(nx, 1.2, nz);
              push(...a, nx / l, 1.2 / l, nz / l, 0, 0); push(...c, nx / l, 1.2 / l, nz / l, 1, 0); push(...peak, nx / l, 1.2 / l, nz / l, 0.5, 1);
              I.push(base, base + 1, base + 2);
            };
            tri([x0, y1, z1], [x1, y1, z1]);
            tri([x1, y1, z1], [x1, y1, z0]);
            tri([x1, y1, z0], [x0, y1, z0]);
            tri([x0, y1, z0], [x0, y1, z1]);
          } else {
            col.set(b.zone === 'business' ? 0x55606a : 0x77736d);
            quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
            // parapet strip + rooftop clutter (AC units, water tanks)
            if (b.zone !== 'business' && b.hw > 5 && b.hd > 5 && this.rng() < 0.7) {
              col.set(0x8d8a84);
              const bx = b.x + (this.rng() - 0.5) * b.hw, bz = b.z + (this.rng() - 0.5) * b.hd, s = 1.2 + this.rng();
              const yy = y1 + s;
              quad([bx - s, yy, bz + s], [bx + s, yy, bz + s], [bx + s, yy, bz - s], [bx - s, yy, bz - s], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
              quad([bx - s, y1, bz + s], [bx + s, y1, bz + s], [bx + s, yy, bz + s], [bx - s, yy, bz + s], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1]);
              quad([bx + s, y1, bz - s], [bx - s, y1, bz - s], [bx - s, yy, bz - s], [bx + s, yy, bz - s], [0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1]);
              quad([bx + s, y1, bz + s], [bx + s, y1, bz - s], [bx + s, yy, bz - s], [bx + s, yy, bz + s], [1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
              quad([bx - s, y1, bz - s], [bx - s, y1, bz + s], [bx - s, yy, bz + s], [bx - s, yy, bz - s], [-1, 0, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
            }
          }
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(UV, 2));
      g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
      g.setIndex(I);
      return g;
    }

    // ---------------------------------------------------------------- landmarks & POIs
    textTexture(text, bg, fg, w = 512, h = 128) {
      return this.canvasTex(w, h, (g) => {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.fillStyle = fg;
        g.font = `800 ${Math.floor(h * 0.62)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 4);
      });
    }
    sign(text, x, y, z, rotY, w, h, bg, fg) {
      const mat = new T.MeshBasicMaterial({ map: this.textTexture(text, bg || '#1d2a36', fg || '#f3efe6') });
      const m = new T.Mesh(new T.PlaneGeometry(w, h), mat);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      this.group.add(m);
      const back = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({ color: 0x30343a }));
      back.position.copy(m.position);
      back.rotation.y = rotY + Math.PI;
      this.group.add(back);
      return m;
    }
    boxMesh(w, h, d, color, x, y, z, opts) {
      const mat = (opts && opts.mat) || new T.MeshStandardMaterial({ color, roughness: (opts && opts.rough) || 0.8, metalness: (opts && opts.metal) || 0 });
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = this.quality !== 'low';
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    }
    // ---------------------------------------------------------------- GLB props (buildings, landmarks, stations)
    // Colliders go in at once (from SB.DATA.PROPS); the meshes arrive with loadProps().
    placeProp(id, x, y, z, rot) {
      const P = SB.DATA.PROPS[id];
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const [x0, z0, x1, z1, y0, y1] of P.colliders) {
        const lx = (x0 + x1) / 2, lz = (z0 + z1) / 2;
        this.addCollider({ type: 'box', x: x + lx * c + lz * s, z: z - lx * s + lz * c, hl: (z1 - z0) / 2, hw: (x1 - x0) / 2, ang: rot, y0: y + y0 - 1, y1: y + y1, solid: true, prop: id });
      }
      this.props.push({ id, x, y, z, rot });
    }
    // lowest terrain under a prop's footprint (so it never floats on a slope)
    groundUnder(id, x, z, rot) {
      const [mn, mx] = SB.DATA.PROPS[id].bounds;
      const c = Math.cos(rot), s = Math.sin(rot);
      let h = Infinity;
      for (const fx of [0, 0.5, 1]) for (const fz of [0, 0.5, 1]) {
        const lx = mn[0] + (mx[0] - mn[0]) * fx, lz = mn[2] + (mx[2] - mn[2]) * fz;
        h = Math.min(h, this.rawH(x + lx * c + lz * s, z - lx * s + lz * c));
      }
      return h;
    }
    loadProps() {
      const ids = [...new Set(this.props.map((p) => p.id))].filter((id) => id !== 'trolley');
      return Promise.all(ids.map((id) => SB.CarModel.loadGLB(SB.DATA.PROPS[id].url).then((scene) => {
        scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = this.quality !== 'low';
          o.receiveShadow = true;
          SB.CarModel.displayTextures(o.material);
          if (o.material.isMeshBasicMaterial && !this.unlitMats.includes(o.material)) this.unlitMats.push(o.material);
        });
        for (const p of this.props) {
          if (p.id !== id) continue;
          const m = scene.clone();
          m.position.set(p.x, p.y, p.z);
          m.rotation.y = p.rot;
          this.group.add(m);
        }
      }).catch((e) => console.warn('prop model failed to load:', id, e && e.message))));
    }
    buildLandmarks() {
      const stone = new T.MeshStandardMaterial({ color: 0xd2cbbd, roughness: 0.85 });
      const lead = new T.MeshStandardMaterial({ color: 0x8c9399, roughness: 0.5, metalness: 0.3 });
      const T_ = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = this.quality !== 'low'; m.receiveShadow = true; this.group.add(m); return m; };
      // mosques: the Great Mosque of Tirana model on the hilltop and in a garden block downtown
      this.placeProp('mosque', -450, this.groundUnder('mosque', -450, -450, 0) - 0.2, -450, 0);
      this.placeProp('mosque', -180, this.groundUnder('mosque', -180, -60, 0) - 0.2, -60, 0);
      // round stone tower with a conical cap
      {
        const cx = -330, cz = -270, gy = this.rawH(cx, cz) - 1;
        T_(new T.CylinderGeometry(8, 9, 48, 24), new T.MeshStandardMaterial({ color: 0xb9a98e, roughness: 0.9 }), cx, gy + 24, cz);
        T_(new T.CylinderGeometry(9.6, 9.6, 2, 24), stone, cx, gy + 44, cz);
        T_(new T.ConeGeometry(9, 15, 24), new T.MeshStandardMaterial({ color: 0x59646e, roughness: 0.6 }), cx, gy + 55, cz);
        this.addCollider({ type: 'circle', x: cx, z: cz, r: 9.2, y0: gy, y1: gy + 60, solid: true });
      }
      // islet tower in the strait
      {
        const cx = 425, cz = -300;
        T_(new T.CylinderGeometry(14, 18, 6, 18), new T.MeshStandardMaterial({ color: 0x6f6658, roughness: 1 }), cx, -1, cz);
        T_(new T.BoxGeometry(10, 8, 12), stone, cx, 6, cz);
        T_(new T.CylinderGeometry(2.6, 2.8, 16, 14), stone, cx + 2, 12, cz);
        T_(new T.ConeGeometry(3.2, 6, 14), lead, cx + 2, 23, cz);
        this.islet = { x: cx, z: cz };
      }
      // quay walls along both shores
      const quay = new T.MeshStandardMaterial({ color: 0x8a8274, roughness: 0.95 });
      for (const x of [361, 639]) {
        const m = T_(new T.BoxGeometry(3, 10, 2400), quay, x, -2.5, 0);
        m.castShadow = false;
      }
      // POI buildings
      const poiMat = (c) => new T.MeshStandardMaterial({ color: c, roughness: 0.75 });
      for (const p of this.pois) {
        const gy = this.rawH(p.x, p.z);
        const s = Math.sin(p.heading), c = Math.cos(p.heading);
        const back = (d, l) => [p.x - s * d + c * l, p.z - c * d - s * l];
        if (p.type === 'gas') {
          // station model: forecourt edge 2 m behind the kerb marker, street side (+Z) facing the road
          const P = SB.DATA.PROPS.gas;
          const [ox, oz] = back(2 + P.bounds[1][2], 0);
          this.placeProp('gas', ox, this.groundUnder('gas', ox, oz, p.heading) - 0.05, oz, p.heading);
          const [sx, sz] = back(-2, 13);
          this.boxMesh(0.4, 7, 0.4, 0x555555, sx, gy + 3.5, sz);
          this.sign(SB.i18n ? SB.i18n.t('poi.gas').toLocaleUpperCase('tr-TR') : 'AKARYAKIT', sx, gy + 7.2, sz, p.heading, 5.2, 1.5, '#1f5f8b');
          // the fuel marker moves under the canopy, beside the pump island
          p.x = ox;
          p.z = oz;
          p.r = 6;
        } else if (p.type === 'repair' || p.type === 'modshop' || p.type === 'garage' || p.type === 'gallery') {
          const [bx, bz] = back(p.type === 'gallery' ? 30 : 34, 0);
          const color = { repair: 0xb7b0a2, modshop: 0x2b2f36, garage: 0xa8b0a0, gallery: 0xdfe6ea }[p.type];
          this.addBuilding({ x: bx, z: bz, hw: Math.abs(c) > 0.5 ? 22 : 16, hd: Math.abs(c) > 0.5 ? 16 : 22, y0: gy - 1, y1: gy + (p.type === 'gallery' ? 9 : 8), color, kind: p.type === 'gallery' ? 'glass' : 'industrial', roof: 'flat', zone: 'city' });
          const [sx, sz] = back(17.7, 0);
          const label = { repair: 'poi.repair', modshop: 'poi.modshop', garage: 'poi.garage', gallery: 'poi.gallery' }[p.type];
          const txt = SB.i18n ? SB.i18n.t(label).toLocaleUpperCase('tr-TR') : p.type.toUpperCase();
          this.sign(txt, sx, gy + 9.5, sz, p.heading, 12, 2.6, { repair: '#8b2f1f', modshop: '#d4622a', garage: '#2d4a3a', gallery: '#1d2a36' }[p.type]);
        }
      }
      // parking lot: parked cars handled by traffic; lamp posts here
      // drag strip "christmas tree"
      {
        const x = 768, z = -566, gy = 3;
        this.boxMesh(0.4, 4, 0.4, 0x333333, x, gy + 2, z);
        this.dragTree = [];
        const colors = [0xffd24a, 0xffd24a, 0xffd24a, 0xffb020, 0xffb020, 0xffb020, 0x2fe05a, 0xff2a2a];
        for (let i = 0; i < colors.length; i++) {
          const mat = new T.MeshStandardMaterial({ color: 0x222222, emissive: new T.Color(colors[i]), emissiveIntensity: 0.05 });
          const b = new T.Mesh(new T.SphereGeometry(0.22, 10, 8), mat);
          b.position.set(x + 0.3, gy + 4.4 - i * 0.42, z + (i % 2 ? 0.25 : -0.25));
          this.group.add(b);
          this.dragTree.push(mat);
        }
        this.boxMesh(0.4, 0.4, 3, 0x2a2a2a, x + 0.1, gy + 4.4, z);
      }
      // license course: cones on the apron
      this.cones = [];
      const coneSpots = [];
      for (let i = 0; i < 6; i++) coneSpots.push([712 + i * 9, 375], [712 + i * 9, 383]);
      for (let i = 0; i < 5; i++) coneSpots.push([760, 470 + i * 8], [768, 470 + i * 8]);
      const coneGeo = new T.ConeGeometry(0.28, 0.7, 10);
      const coneMat = new T.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 });
      const cones = new T.InstancedMesh(coneGeo, coneMat, coneSpots.length);
      const mtx = new T.Matrix4();
      coneSpots.forEach(([x, z], i) => {
        mtx.makeTranslation(x, this.heightAt(x, z) + 0.35, z);
        cones.setMatrixAt(i, mtx);
        this.addCollider({ type: 'circle', x, z, r: 0.3, y0: 0, y1: 10, solid: false, cone: true });
      });
      this.group.add(cones);
      // license hill ramp mesh (matches rampH)
      this.rampMeshes();
      // port gantry cranes
      const crane = new T.MeshStandardMaterial({ color: 0xc23b22, roughness: 0.6, metalness: 0.2 });
      for (const z of [-650, -560, -470]) {
        const x = 352;
        for (const dz of [-6, 6]) {
          this.boxMesh(1.2, 34, 1.2, null, x - 6, 17, z + dz, { mat: crane });
          this.boxMesh(1.2, 34, 1.2, null, x + 14, 17, z + dz, { mat: crane });
          this.addCollider({ type: 'circle', x: x - 6, z: z + dz, r: 0.9, y0: 0, y1: 40, solid: true });
        }
        this.boxMesh(46, 2.2, 2, null, x + 8, 34, z - 6, { mat: crane });
        this.boxMesh(46, 2.2, 2, null, x + 8, 34, z + 6, { mat: crane });
        this.boxMesh(4, 3, 14, 0xe8e3d6, x + 2, 36, z);
      }
      if (this.containers && this.containers.length) {
        const cg = new T.BoxGeometry(6.1, 2.6, 2.5);
        const cm = new T.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 });
        const inst = new T.InstancedMesh(cg, cm, this.containers.length);
        const col = new T.Color();
        this.containers.forEach((c, i) => {
          mtx.makeTranslation(c.x, c.y - 1.7, c.z);
          inst.setMatrixAt(i, mtx);
          inst.setColorAt(i, col.set(c.color));
        });
        inst.castShadow = this.quality !== 'low';
        inst.receiveShadow = true;
        this.group.add(inst);
      }
      // ferries on the strait (animated in update)
      this.ferries = [];
      const hull = new T.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.6 });
      const dark = new T.MeshStandardMaterial({ color: 0x23313d, roughness: 0.5 });
      for (let i = 0; i < 3; i++) {
        const g = new T.Group();
        const h1 = new T.Mesh(new T.BoxGeometry(9, 3, 34), hull); h1.position.y = 1.2; g.add(h1);
        const h2 = new T.Mesh(new T.BoxGeometry(8, 2.6, 26), hull); h2.position.y = 4; g.add(h2);
        const h3 = new T.Mesh(new T.BoxGeometry(8.2, 1, 26.2), dark); h3.position.y = 3.2; g.add(h3);
        const fun = new T.Mesh(new T.CylinderGeometry(1, 1.2, 4, 12), dark); fun.position.set(0, 7, 2); g.add(fun);
        g.traverse((o) => { if (o.isMesh) o.castShadow = this.quality !== 'low'; });
        this.group.add(g);
        this.ferries.push({ g, phase: i * 2.1, x0: 472 + i * 28, z0: -900 + i * 600, speed: 4 + i });
      }
    }
    rampMeshes() {
      const mat = new T.MeshStandardMaterial({ color: 0x8b8f93, roughness: 0.85 });
      const build = (cx, cz, ang, w, profile) => {
        // profile: [[u, h], ...] along ramp direction
        const s = Math.sin(ang), c = Math.cos(ang);
        const P = [], I = [];
        for (let i = 0; i < profile.length; i++) {
          const [u, h] = profile[i];
          for (const v of [-w / 2, w / 2]) {
            const x = cx + u * s + v * c, z = cz + u * c - v * s;
            P.push(x, terrainH(x, z) + h + 0.04, z);
          }
          for (const v of [-w / 2, w / 2]) {
            const x = cx + u * s + v * c, z = cz + u * c - v * s;
            P.push(x, terrainH(x, z) - 0.3, z);
          }
        }
        for (let i = 0; i < profile.length - 1; i++) {
          const a = i * 4, b = (i + 1) * 4;
          I.push(a, b, a + 1, a + 1, b, b + 1); // top
          I.push(a, a + 2, b, b, a + 2, b + 2); // side L
          I.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); // side R
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
        g.setIndex(I);
        g.computeVertexNormals();
        const m = new T.Mesh(g, mat);
        m.castShadow = this.quality !== 'low';
        m.receiveShadow = true;
        this.group.add(m);
      };
      for (const r of RAMPS) build(r.x, r.z, r.ang, r.w, [[0, 0], [r.len, r.h], [r.len + 0.01, r.h], [r.len + r.len2, 0]]);
      const h = HILL;
      build(h.x, h.z, 0, h.w, [[0, 0], [h.up, h.h], [h.up + h.flat, h.h], [h.up + h.flat + h.down, 0]]);
    }

    // ---------------------------------------------------------------- suspension bridge
    buildBridge() {
      const deckMat = new T.MeshStandardMaterial({ color: 0x6e7378, roughness: 0.8, metalness: 0.1 });
      const steel = new T.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.5, metalness: 0.4 });
      // deck slab under the road strip
      const pts = [];
      for (let x = 348; x <= 652; x += 4) pts.push(x);
      const P = [], I = [];
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i], y = deckH(x);
        P.push(x, y - 0.02, -10.5, x, y - 0.02, 10.5, x, y - 1.8, -10.5, x, y - 1.8, 10.5);
        if (i < pts.length - 1) {
          const a = i * 4, b = a + 4;
          I.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // bottom
          I.push(a, b, a + 2, a + 2, b, b + 2); // side -z
          I.push(a + 1, a + 3, b + 1, b + 1, a + 3, b + 3); // side +z
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      const deck = new T.Mesh(g, deckMat);
      deck.castShadow = true;
      this.group.add(deck);
      // railings (also colliders)
      for (const z of [-10.2, 10.2]) {
        const rp = [];
        for (let x = 362; x <= 638; x += 8) rp.push(x);
        for (let i = 0; i < rp.length - 1; i++) {
          const xa = rp[i], xb = rp[i + 1], xm = (xa + xb) / 2;
          const ya = deckH(xa), yb = deckH(xb);
          const m = new T.Mesh(new T.BoxGeometry(Math.hypot(xb - xa, yb - ya), 1.1, 0.35), steel);
          m.position.set(xm, (ya + yb) / 2 + 0.55, z);
          m.rotation.z = Math.atan2(yb - ya, xb - xa);
          this.group.add(m);
          this.addCollider({ type: 'box', x: xm, z: z + Math.sign(z) * 0.3, hl: 0.5, hw: 4.05, ang: 0, y0: -20, y1: 40, solid: true, rail: true });
        }
      }
      // towers
      const towerMat = new T.MeshStandardMaterial({ color: 0xa7adb3, roughness: 0.6, metalness: 0.2 });
      const towers = [430, 570];
      for (const tx of towers) {
        for (const z of [-12.5, 12.5]) {
          const leg = new T.Mesh(new T.BoxGeometry(3.2, 82, 3.2), towerMat);
          leg.position.set(tx, 82 / 2 - 6, z);
          leg.castShadow = true;
          this.group.add(leg);
          this.addCollider({ type: 'box', x: tx, z, hl: 1.7, hw: 1.7, ang: 0, y0: -10, y1: 80, solid: true });
        }
        for (const y of [deckH(tx) + 14, 52, 74]) {
          const beam = new T.Mesh(new T.BoxGeometry(2.6, 3, 28), towerMat);
          beam.position.set(tx, y, 0);
          this.group.add(beam);
        }
      }
      // main cables (catenary-like parabola between tower tops and anchorages)
      const top = 75;
      const cableY = (x) => {
        if (x < towers[0]) return U.lerp(deckH(352) + 2, top, (x - 352) / (towers[0] - 352));
        if (x > towers[1]) return U.lerp(top, deckH(648) + 2, (x - towers[1]) / (648 - towers[1]));
        const t = (x - towers[0]) / (towers[1] - towers[0]);
        const sag = 46;
        return top - sag * 4 * t * (1 - t);
      };
      this.bridgeLights = [];
      const hangP = [];
      for (const z of [-12.5, 12.5]) {
        const cps = [];
        for (let x = 352; x <= 648; x += 4) cps.push(new T.Vector3(x, cableY(x), z));
        const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(cps), 160, 0.45, 6), steel);
        this.group.add(tube);
        for (let x = 356; x < 646; x += 8) {
          const y0 = deckH(x) + 0.8, y1 = cableY(x);
          if (y1 - y0 > 1.5) hangP.push(x, y0, z * 0.84, x, y1, z);
          this.bridgeLights.push([x, y1 + 0.6, z]);
        }
      }
      const hg = new T.BufferGeometry();
      hg.setAttribute('position', new T.Float32BufferAttribute(hangP, 3));
      this.group.add(new T.LineSegments(hg, new T.LineBasicMaterial({ color: 0xcfd4d8, transparent: true, opacity: 0.8 })));
      // LED lights along the cables (night): plain points are far cheaper than instanced spheres
      const lg = new T.BufferGeometry();
      lg.setAttribute('position', new T.Float32BufferAttribute(this.bridgeLights.flat(), 3));
      const lm = new T.PointsMaterial({ color: 0x8fd3ff, size: 1.1, sizeAttenuation: true });
      this.bridgeLightMat = lm;
      this.group.add(new T.Points(lg, lm));
    }

    // ---------------------------------------------------------------- trees, lamps
    buildStreetFurniture() {
      const r = this.rng;
      const trees = [];
      // forest
      const nForest = this.quality === 'low' ? 900 : 1900;
      let guard = 0;
      while (trees.length < nForest && guard++ < 20000) {
        const x = -700 + r() * 470, z = 245 + r() * 470;
        if (zoneAt(x, z) !== 'forest') continue;
        const s = this.surfIdx(x, z);
        if (s === 1 || s === 6 || s === 7) continue;
        const nr = this.nearestRoadQuick(x, z);
        if (nr < 7) continue;
        trees.push([x, z, r() < 0.7 ? 'pine' : 'round', 0.8 + r() * 0.6]);
      }
      // outside the ring (horizon groves) + east side
      for (let i = 0; i < (this.quality === 'low' ? 250 : 600); i++) {
        const x = -1000 + r() * 2200, z = -1000 + r() * 2000;
        const zn = zoneAt(x, z);
        if (zn !== 'outside' && zn !== 'east') continue;
        if (terrainH(x, z) < 1.5) continue;
        if (zn === 'east' && (Math.abs(x - 790) < 40 || (x > 690 && x < 780 && z > 340 && z < 540) || this.surfIdx(x, z) === 1)) continue;
        if (zn === 'outside' && x > -720 && x < 360 && z > -720 && z < 720) continue;
        if (this.nearestRoadQuick(x, z) < 8) continue;
        trees.push([x, z, r() < 0.5 ? 'pine' : 'round', 0.9 + r() * 0.7]);
      }
      // avenue trees on sidewalks
      for (const e of this.edges) {
        if (e.kind !== 'avenue') continue;
        const p = {};
        for (let d = 14; d < e.len - 14; d += 18) {
          this.edgePoint(e, d, p);
          for (const sg of [-1, 1]) {
            const x = p.x - p.tz * sg * (e.w / 2 + 2.6), z = p.z + p.tx * sg * (e.w / 2 + 2.6);
            if (this.surfIdx(x, z) !== 7) continue;
            trees.push([x, z, 'round', 0.7 + r() * 0.3]);
          }
        }
      }
      for (const t of this.treesExtra || []) trees.push([t[0], t[1], t[2], 0.9 + r() * 0.5]);
      const trunkG = new T.CylinderGeometry(0.18, 0.26, 2.6, 5, 1, true);
      const pineG = new T.ConeGeometry(2.0, 6.5, 7, 1, true);
      const roundG = new T.IcosahedronGeometry(2.2, this.quality === 'low' ? 0 : 1);
      const trunkM = new T.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
      const pineM = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
      const roundM = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
      const col = new T.Color();
      const items = trees.map(([x, z, type, s]) => {
        const y = this.heightAt(x, z);
        this.addCollider({ type: 'circle', x, z, r: 0.35 * s, y0: y - 1, y1: y + 6, solid: true, tree: true });
        const c = type === 'pine' ? col.setHSL(0.3 + r() * 0.05, 0.35, 0.22 + r() * 0.06).getHex() : col.setHSL(0.25 + r() * 0.06, 0.4, 0.3 + r() * 0.08).getHex();
        return { x, z, y, type, s, rot: r() * 6.28, sy: 0.9 + r() * 0.4, color: c };
      });
      const q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), up = new T.Vector3(0, 1, 0);
      const sh = this.quality !== 'low';
      const trunkItems = items.map((it) => ({ x: it.x, z: it.z, y: it.y, s: it.s, rot: it.rot }));
      this.instChunks = [];
      this.instChunks.push(...chunkInstances(this.group, trunkG, trunkM, trunkItems, (it, m) => m.compose(ps.set(it.x, it.y + 1.3 * it.s, it.z), q.setFromAxisAngle(up, it.rot), sc.set(it.s, it.s, it.s)), { shadow: sh, maxDist: 520 }));
      this.instChunks.push(...chunkInstances(this.group, pineG, pineM, items.filter((i) => i.type === 'pine'), (it, m) => m.compose(ps.set(it.x, it.y + 5.6 * it.s, it.z), q.setFromAxisAngle(up, it.rot), sc.set(it.s, it.s * it.sy, it.s)), { shadow: sh, scale: 1.6, maxDist: 900 }));
      this.instChunks.push(...chunkInstances(this.group, roundG, roundM, items.filter((i) => i.type !== 'pine'), (it, m) => m.compose(ps.set(it.x, it.y + 3.6 * it.s, it.z), q.setFromAxisAngle(up, it.rot), sc.set(it.s, it.s * 0.95, it.s)), { shadow: sh, scale: 1.6, maxDist: 900 }));
      this.treeColorMats = [pineM, roundM];
      const m = new T.Matrix4();

      // street lamps on avenues, highways and the coastal road
      const lamps = [];
      for (const e of this.edges) {
        if (!['avenue', 'highway', 'street', 'serp', 'taxi'].includes(e.kind)) continue;
        const step = e.kind === 'street' ? 46 : 34;
        const p = {};
        let side = 1;
        for (let d = 10; d < e.len - 10; d += step) {
          this.edgePoint(e, d, p);
          side = -side;
          const off = e.w / 2 + (e.walk ? 0.9 : 1.2);
          const x = p.x - p.tz * side * off, z = p.z + p.tx * side * off;
          const zn = zoneAt(x, z);
          if (zn === 'water') continue;
          lamps.push([x, z, Math.atan2(p.tz * side, -p.tx * side), e.kind === 'street' ? 7 : 9]);
        }
      }
      const poleG = new T.CylinderGeometry(0.09, 0.13, 1, 6);
      poleG.translate(0, 0.5, 0);
      const headG = new T.BoxGeometry(0.5, 0.18, 1.1);
      const poleM = new T.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.4 });
      const headMat = new T.MeshStandardMaterial({ color: 0x222222, emissive: new T.Color(0xffd9a0), emissiveIntensity: 0 });
      this.nightMats.push({ mat: headMat, max: 2.2 });
      const glowTex = this.canvasTex(64, 64, (g, w) => {
        const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,214,150,0.55)');
        gr.addColorStop(0.5, 'rgba(255,200,130,0.18)');
        gr.addColorStop(1, 'rgba(255,190,120,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, w);
      });
      const glowMat = new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 });
      const glowG = new T.PlaneGeometry(1, 1);
      glowG.rotateX(-Math.PI / 2);
      this.glowMat = glowMat;
      const li = lamps.map(([x, z, ang, h]) => {
        const y = this.heightAt(x, z);
        this.addCollider({ type: 'circle', x, z, r: 0.16, y0: y - 1, y1: y + h, solid: true, lamp: true });
        return { x, z, y, ang, h };
      });
      this.instChunks.push(...chunkInstances(this.group, poleG, poleM, li, (it, mm) => mm.compose(ps.set(it.x, it.y, it.z), q.identity(), sc.set(1, it.h, 1)), { shadow: this.quality === 'high', scale: 9, maxDist: 600 }));
      this.instChunks.push(...chunkInstances(this.group, headG, headMat, li, (it, mm) => mm.compose(ps.set(it.x + Math.sin(it.ang) * 0.9, it.y + it.h, it.z + Math.cos(it.ang) * 0.9), q.setFromAxisAngle(up, it.ang), sc.set(1, 1, 1)), { extra: 10, maxDist: 900 }));
      this.instChunks.push(...chunkInstances(this.group, glowG, glowMat, li, (it, mm) => { const gx = it.x + Math.sin(it.ang) * 2.2, gz = it.z + Math.cos(it.ang) * 2.2; return mm.compose(ps.set(gx, this.heightAt(gx, gz) + 0.06, gz), q.identity(), sc.set(9, 1, 9)); }, { scale: 9, maxDist: 500 }));
    }
    nearestRoadQuick(x, z) {
      // distance to nearest road cell in a small search window (surface grid)
      for (let r = 1; r < 12; r += 2) {
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
          const s = this.surfIdx(x + dx, z + dz);
          if (s === 1 || s === 2 || s === 6 || s === 7) return r;
        }
      }
      return 99;
    }

    // ---------------------------------------------------------------- traffic lights
    buildSignals() {
      const cand = this.nodes.filter((n) => {
        if (n.deg < 3) return false;
        const kinds = n.edges.map((ei) => this.edges[ei].kind);
        if (kinds.includes('lane') || kinds.includes('runway') || kinds.includes('serp')) return false;
        if (Math.abs(n.x) === 690 || Math.abs(n.z) === 690) return false;
        const big = kinds.filter((k) => k === 'avenue' || k === 'highway').length;
        return big >= 2 || (big >= 1 && n.deg === 4);
      });
      const poleG = new T.CylinderGeometry(0.1, 0.12, 4.2, 6);
      poleG.translate(0, 2.1, 0);
      const headG = new T.BoxGeometry(0.42, 1.2, 0.3);
      const lampG = new T.BoxGeometry(0.24, 0.24, 0.06);
      const n = cand.length;
      const poles = new T.InstancedMesh(poleG, new T.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.6, metalness: 0.3 }), n * 4);
      const heads = new T.InstancedMesh(headG, new T.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }), n * 4);
      const lamps = new T.InstancedMesh(lampG, new T.MeshBasicMaterial({ color: 0xffffff }), n * 12);
      const m = new T.Matrix4(), q = new T.Quaternion(), ps = new T.Vector3(), sc = new T.Vector3(1, 1, 1);
      let k = 0;
      cand.forEach((nd, i) => {
        const sig = { node: nd.id, x: nd.x, z: nd.z, offset: (i * 7.3) % 30, phase: 'NS', state: { NS: 'green', EW: 'red' }, lamps: [] };
        this.signals.push(sig);
        nd.signal = sig;
        const h = nd.half + 1.4;
        // each head sits on the near-right corner of its approach, facing oncoming drivers
        const approaches = [
          { axis: 'NS', px: nd.x - h, pz: nd.z - h, ang: Math.PI },
          { axis: 'NS', px: nd.x + h, pz: nd.z + h, ang: 0 },
          { axis: 'EW', px: nd.x - h, pz: nd.z + h, ang: -Math.PI / 2 },
          { axis: 'EW', px: nd.x + h, pz: nd.z - h, ang: Math.PI / 2 },
        ];
        approaches.forEach((a, j) => {
          const y = this.heightAt(a.px, a.pz);
          m.compose(ps.set(a.px, y, a.pz), q.identity(), sc);
          poles.setMatrixAt(i * 4 + j, m);
          q.setFromAxisAngle(new T.Vector3(0, 1, 0), a.ang);
          m.compose(ps.set(a.px, y + 3.9, a.pz), q, sc);
          heads.setMatrixAt(i * 4 + j, m);
          const fx = Math.sin(a.ang) * 0.17, fz = Math.cos(a.ang) * 0.17;
          for (let c = 0; c < 3; c++) {
            m.compose(ps.set(a.px + fx, y + 4.3 - c * 0.38, a.pz + fz), q.identity(), sc);
            lamps.setMatrixAt(k, m);
            sig.lamps.push({ idx: k, axis: a.axis, color: ['red', 'yellow', 'green'][c] });
            k++;
          }
          this.addCollider({ type: 'circle', x: a.px, z: a.pz, r: 0.18, y0: y - 1, y1: y + 5, solid: true, lamp: true });
        });
      });
      this.signalLamps = lamps;
      this.group.add(poles, heads, lamps);
      this.updateSignals(0, true);
    }
    signalState(sig, t) {
      // 30 s cycle: NS green 12, yellow 3, all-red 1, EW green 11, yellow 3
      const c = (t + sig.offset) % 30;
      if (c < 12) return { NS: 'green', EW: 'red' };
      if (c < 15) return { NS: 'yellow', EW: 'red' };
      if (c < 16) return { NS: 'red', EW: 'red' };
      if (c < 27) return { NS: 'red', EW: 'green' };
      if (c < 29.4) return { NS: 'red', EW: 'yellow' };
      return { NS: 'red', EW: 'red' };
    }
    updateSignals(t, force) {
      const col = new T.Color();
      const on = { red: 0xff2a1a, yellow: 0xffb21a, green: 0x2cff6a };
      const off = { red: 0x3a0e0a, yellow: 0x3a2a0a, green: 0x0a2a14 };
      let dirty = false;
      for (const s of this.signals) {
        const st = this.signalState(s, t);
        if (!force && st.NS === s.state.NS && st.EW === s.state.EW) continue;
        s.state = st;
        dirty = true;
        for (const l of s.lamps) {
          const lit = st[l.axis] === l.color;
          this.signalLamps.setColorAt(l.idx, col.set(lit ? on[l.color] : off[l.color]));
        }
      }
      if (dirty && this.signalLamps.instanceColor) this.signalLamps.instanceColor.needsUpdate = true;
    }
    // Light for traffic travelling along an edge into node nid
    lightFor(nid, tx, tz) {
      const n = this.nodes[nid];
      if (!n.signal) return 'none';
      return Math.abs(tz) >= Math.abs(tx) ? n.signal.state.NS : n.signal.state.EW;
    }

    // ---------------------------------------------------------------- water
    buildWater() {
      const geo = new T.PlaneGeometry(9000, 9000, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new T.ShaderMaterial({
        uniforms: T.UniformsUtils.merge([
          T.UniformsLib.fog,
          { time: { value: 0 }, sunDir: { value: new T.Vector3(0.3, 0.8, 0.2) }, sunColor: { value: new T.Color(1, 0.95, 0.85) }, skyColor: { value: new T.Color(0.55, 0.7, 0.85) }, deepColor: { value: new T.Color(0.05, 0.16, 0.22) }, night: { value: 0 } },
        ]),
        vertexShader: `
          varying vec3 vWorld;
          #include <fog_pars_vertex>
          void main(){
            vec4 wp = modelMatrix * vec4(position,1.0);
            vWorld = wp.xyz;
            vec4 mvPosition = viewMatrix * wp;
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `
          uniform float time; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor; uniform vec3 deepColor; uniform float night;
          varying vec3 vWorld;
          #include <fog_pars_fragment>
          void main(){
            vec2 p = vWorld.xz;
            float w1 = sin(p.x*0.09 + time*1.1) * cos(p.y*0.07 - time*0.8);
            float w2 = sin(p.x*0.23 - p.y*0.19 + time*1.9);
            float w3 = sin(p.x*0.51 + p.y*0.47 - time*2.6);
            vec3 n = normalize(vec3(w1*0.06 + w2*0.035 + w3*0.02, 1.0, w2*0.05 - w1*0.03 + w3*0.02));
            vec3 v = normalize(cameraPosition - vWorld);
            float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
            vec3 col = mix(deepColor, skyColor, 0.15 + 0.75*fres);
            vec3 h = normalize(sunDir + v);
            float spec = pow(max(dot(n, h), 0.0), 180.0) * (1.0 - night);
            col += sunColor * spec * 1.6;
            gl_FragColor = vec4(col, 1.0);
            #include <fog_fragment>
          }`,
        fog: true,
      });
      this.waterMat = mat;
      const w = new T.Mesh(geo, mat);
      w.position.y = 0;
      this.group.add(w);
    }

    // ---------------------------------------------------------------- minimap
    buildMinimap() {
      const sc = 0.5;
      const W = Math.round((PLAY.maxX - PLAY.minX + 80) * sc), H = Math.round((PLAY.maxZ - PLAY.minZ + 80) * sc);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      const ox = PLAY.minX - 40, oz = PLAY.maxZ + 40;
      this.map = { canvas: c, scale: sc, ox, oz, w: W, h: H };
      g.fillStyle = '#25302a';
      g.fillRect(0, 0, W, H);
      // water
      g.fillStyle = '#1d3a4f';
      g.fillRect((360 - ox) * sc, 0, 280 * sc, H);
      // zones tint
      const zfill = (x0, z0, x1, z1, col) => { g.fillStyle = col; g.fillRect((x0 - ox) * sc, (oz - z1) * sc, (x1 - x0) * sc, (z1 - z0) * sc); };
      zfill(-690, -690, -240, -240, '#3a342c');
      zfill(-690, 240, -240, 690, '#1f3420');
      zfill(-240, 240, 345, 690, '#2c3138');
      zfill(0, -690, 345, -360, '#2f2f2c');
      zfill(-240, -240, 345, 240, '#2e322e');
      zfill(-240, -360, 0, -240, '#2e322e');
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const pass of [0, 1]) {
        for (const e of this.edges) {
          g.strokeStyle = pass === 0 ? '#11151a' : e.kind === 'highway' || e.kind === 'bridge' ? '#e8c27a' : e.kind === 'avenue' ? '#d9d6cf' : e.kind === 'runway' ? '#7d8288' : '#a9a6a0';
          g.lineWidth = Math.max(2, e.w * sc * (e.kind === 'runway' ? 0.6 : 1)) + (pass === 0 ? 2 : 0);
          g.beginPath();
          for (let i = 0; i < e.pts.length; i += 2) {
            const x = (e.pts[i] - ox) * sc, y = (oz - e.pts[i + 1]) * sc;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.stroke();
        }
      }
    }
    toMap(x, z) { return [(x - this.map.ox) * this.map.scale, (this.map.oz - z) * this.map.scale]; }
    fromMap(px, py) { return [px / this.map.scale + this.map.ox, this.map.oz - py / this.map.scale]; }

    // ---------------------------------------------------------------- per-frame
    cullChunks(cam) {
      if (!this.instChunks || !cam) return;
      for (const c of this.instChunks) {
        const d = c.userData.maxDist;
        if (!d) continue;
        const ce = c.userData.center;
        c.visible = (ce.x - cam.x) * (ce.x - cam.x) + (ce.z - cam.z) * (ce.z - cam.z) < d * d;
      }
    }
    update(dt, env) {
      this.time += dt;
      this.updateSignals(this.time);
      this.waterMat.uniforms.time.value = this.time;
      if (env) {
        this.waterMat.uniforms.sunDir.value.copy(env.sunDir);
        this.waterMat.uniforms.sunColor.value.copy(env.sunColor);
        this.waterMat.uniforms.skyColor.value.copy(env.horizon);
        this.waterMat.uniforms.night.value = env.night;
        this.waterMat.uniforms.deepColor.value.setRGB(0.05 * (1 - env.night * 0.7), 0.16 * (1 - env.night * 0.8), 0.22 * (1 - env.night * 0.75));
        const n = env.night;
        for (const nm of this.nightMats) nm.mat.emissiveIntensity = nm.max * n;
        for (const m of this.unlitMats) m.color.setScalar(U.lerp(1, 0.2, n));
        this.glowMat.opacity = n * 0.9;
        this.bridgeLightMat.color.setRGB(0.15 + 0.4 * n, 0.25 + 0.6 * n, 0.3 + 0.7 * n);
        const wet = env.wet;
        for (const m of this.roadMats) {
          m.roughness = U.lerp(m.userData.baseRough, 0.35, wet);
          m.color.setScalar(U.lerp(1, 0.62, wet));
        }
        this.terrainMat.color.setScalar(1);
        const snow = env.snowCover || 0;
        if (snow > 0.01) this.terrainMat.color.setRGB(1 + snow * 0.8, 1 + snow * 0.75, 1 + snow * 0.9);
        for (const tm of this.treeColorMats) tm.color.setRGB(1 + snow * 1.5, 1 + snow * 1.5, 1 + snow * 1.6);
      }
      for (const f of this.ferries) {
        const t = this.time * f.speed + f.phase * 100;
        const span = 1800;
        const p = (t % (span * 2)) / span;
        const dir = p < 1 ? 1 : -1;
        const zz = -900 + (p < 1 ? p : 2 - p) * span;
        const xx = f.x0 + Math.sin(zz * 0.004 + f.phase) * 8;
        f.g.position.set(xx, Math.sin(this.time * 0.8 + f.phase) * 0.15, zz);
        f.g.rotation.y = dir > 0 ? 0 : Math.PI;
        f.g.rotation.z = Math.sin(this.time * 0.6 + f.phase) * 0.02;
      }
    }

    // Respawn point: nearest traffic road, in the lane, aligned with travel direction.
    respawnPoint(x, z, heading) {
      const r = this.nearestRoad(x, z, true);
      if (!r) return { x: 60, z: -22, heading: 0 };
      let hx = r.tx, hz = r.tz;
      if (heading != null && Math.sin(heading) * hx + Math.cos(heading) * hz < 0) { hx = -hx; hz = -hz; }
      const off = r.edge.lanes > 1 ? 5.2 : 3;
      const px = r.x - hz * off, pz = r.z + hx * off;
      return { x: px, z: pz, heading: Math.atan2(hx, hz) };
    }
  }

  World.chunkInstances = chunkInstances;
  World.PLAY = PLAY;
  World.KIND = KIND;
  World.terrainH = terrainH;
  World.deckH = deckH;
  SB.World = World;
})();
