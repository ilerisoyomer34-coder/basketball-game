// SHIFTBREAKER — people for the police scenes: articulated low-poly officers and the driver,
// pose blending with a procedural walk, pistol / handcuffs / notepad props.
(function () {
  'use strict';
  const SB = window.SB;
  const U = SB.U;
  const T = THREE;

  // shared geometry / materials (figures come and go; these stay)
  const G = {};
  const geo = (k, make) => G[k] || (G[k] = make());
  const M = {};
  const mat = (c, o) => {
    const k = c + (o ? JSON.stringify(o) : '');
    return M[k] || (M[k] = new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8, metalness: 0 }, o)));
  };
  let labelTex = null;
  function policeLabel() {
    if (labelTex) return labelTex;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#16233f'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#ffffff';
    g.font = '900 64px "Barlow Condensed", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POLİS', 128, 52);
    labelTex = new T.CanvasTexture(c);
    return labelTex;
  }

  const OUTFIT = {
    officer: { shirt: 0x1d2c4c, pants: 0x141b2c, shoes: 0x111111, skin: 0xc89a7c, hair: 0x1d1612 },
    driver: { shirt: 0x34373e, pants: 0x30486e, shoes: 0xe6e6e6, skin: 0xd6a888, hair: 0x2a1d14 },
  };

  // joint targets [x, y, z] (radians); limbs hang along -Y, the figure faces +Z, its left is +X
  const POSES = {
    stand: { shL: [0.05, 0, 0.08], shR: [0.05, 0, -0.08], elL: [-0.15, 0, 0], elR: [-0.15, 0, 0] },
    aim: { chest: [0, 0.18, 0], neck: [0.04, -0.12, 0], shR: [-1.47, 0.32, 0], elR: [-0.06, 0, 0], shL: [-1.33, -0.42, 0], elL: [-0.42, 0, 0] },
    aimLow: { chest: [0.08, 0.12, 0], neck: [0.12, -0.08, 0], shR: [-0.75, 0.3, 0], elR: [-0.1, 0, 0], shL: [-0.7, -0.4, 0], elL: [-0.4, 0, 0] },
    handsUp: { shL: [0, 0, 1.42], elL: [0, 0, 1.75], shR: [0, 0, -1.42], elR: [0, 0, -1.75], neck: [-0.05, 0, 0] },
    handsBehind: { chest: [0.06, 0, 0], neck: [0.2, 0, 0], shL: [0.62, 0, -0.1], elL: [0, 0, -1.32], shR: [0.62, 0, 0.1], elR: [0, 0, 1.32] },
    cuff: { chest: [0.22, 0, 0], neck: [0.25, 0, 0], shL: [-0.95, -0.32, 0], elL: [-0.55, 0, 0], shR: [-0.95, 0.32, 0], elR: [-0.55, 0, 0] },
    escort: { shR: [-0.55, 0.45, 0], elR: [-0.45, 0, 0], shL: [0.1, 0, 0.08], elL: [-0.2, 0, 0] },
    write: { neck: [0.38, 0, 0], shL: [-0.85, -0.5, 0], elL: [-1.25, 0, 0], shR: [-0.75, 0.32, 0], elR: [-1.1, 0, 0] },
    talk: { shL: [0.05, 0, 0.1], elL: [-0.2, 0, 0], shR: [-0.35, 0.2, -0.1], elR: [-1.2, 0, 0] },
    radio: { neck: [0.1, -0.3, 0], shL: [-0.2, -0.2, 0], elL: [-2.1, 0, 0], shR: [0.05, 0, -0.08], elR: [-0.15, 0, 0] },
    reach: { chest: [0.15, 0, 0], shL: [-1.25, -0.25, 0], elL: [-0.35, 0, 0], shR: [-1.25, 0.25, 0], elR: [-0.35, 0, 0] },
    // officer down on one knee beside someone lying on the ground
    kneel: { y: -0.45, chest: [0.55, 0, 0], neck: [0.3, 0, 0], hipL: [-1.5, 0, 0], knL: [1.5, 0, 0], hipR: [0.05, 0, 0], knR: [1.6, 0, 0], shL: [-1.05, -0.25, 0], elL: [-0.35, 0, 0], shR: [-1.05, 0.25, 0], elR: [-0.35, 0, 0] },
    // on both knees, hands up (about to be put face down)
    kneelDown: { y: -0.45, hipL: [0.05, 0, 0], hipR: [0.05, 0, 0], knL: [1.6, 0, 0], knR: [1.6, 0, 0], shL: [0, 0, 1.42], elL: [0, 0, 1.75], shR: [0, 0, -1.42], elR: [0, 0, -1.75] },
    // lying face down (with lie()), arms stretched past the head
    proneArms: { neck: [-0.5, 0, 0], shL: [-2.85, 0, 0.3], elL: [-0.1, 0, 0], shR: [-2.85, 0, -0.3], elR: [-0.1, 0, 0] },
    // patting someone down who lies face down
    frisk: { y: -0.45, chest: [0.7, 0, 0], neck: [0.35, 0, 0], hipL: [-1.5, 0, 0], knL: [1.5, 0, 0], hipR: [0.05, 0, 0], knR: [1.6, 0, 0], shL: [-0.85, -0.2, 0], elL: [-0.2, 0, 0], shR: [-0.85, 0.2, 0], elR: [-0.2, 0, 0] },
    // hands up on the wall, feet apart (being searched)
    wallHands: { chest: [0.12, 0, 0], neck: [0.15, 0, 0], shL: [-2.0, 0, 0.35], elL: [-0.25, 0, 0], shR: [-2.0, 0, -0.35], elR: [-0.25, 0, 0], hipL: [0, 0, 0.16], hipR: [0, 0, -0.16] },
    // searching someone standing at the wall
    friskStand: { chest: [0.45, 0, 0], neck: [0.25, 0, 0], shL: [-1.15, -0.2, 0], elL: [-0.25, 0, 0], shR: [-1.15, 0.2, 0], elR: [-0.25, 0, 0] },
    // baton raised, then the swing (the scene cuts to black before it lands)
    strikeUp: { chest: [0, -0.25, 0], shR: [-2.75, 0.25, 0], elR: [-0.6, 0, 0], shL: [-0.6, -0.3, 0], elL: [-0.4, 0, 0] },
    strikeDown: { chest: [0.45, 0.1, 0], neck: [0.3, 0, 0], shR: [-0.7, 0.3, 0], elR: [-0.15, 0, 0], shL: [-0.5, -0.3, 0], elL: [-0.4, 0, 0] },
    // on the bench, both hands cuffed behind to the pole at the back
    sitBehind: { y: -0.42, chest: [0.04, 0, 0], neck: [0.1, 0, 0], hipL: [-1.35, 0, 0], hipR: [-1.35, 0, 0], knL: [1.45, 0, 0], knR: [1.45, 0, 0], shL: [0.8, 0, -0.08], elL: [0, 0, -1.25], shR: [0.8, 0, 0.08], elR: [0, 0, 1.25] },
    sitCuffed: { y: -0.42, chest: [0.12, 0.1, 0], neck: [0.1, 0.15, 0], hipL: [-1.35, 0, 0], hipR: [-1.35, 0, 0], knL: [1.45, 0, 0], knR: [1.45, 0, 0], shL: [-0.45, 0, 0.1], elL: [-0.7, 0, 0], shR: [0.35, 0, -0.75], elR: [-0.35, 0, 0] },
    sit: { y: -0.42, chest: [0.32, 0, 0], neck: [-0.15, 0, 0], hipL: [-1.35, 0, 0], hipR: [-1.35, 0, 0], knL: [1.45, 0, 0], knR: [1.45, 0, 0], shL: [-0.5, 0, 0.1], shR: [-0.5, 0, -0.1], elL: [-0.6, 0, 0], elR: [-0.6, 0, 0] },
  };
  const JOINTS = ['chest', 'neck', 'shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'knL', 'knR'];
  const ARMS = ['shL', 'shR', 'elL', 'elR'];

  class Figure {
    constructor(game, kind) {
      this.game = game;
      this.kind = kind;
      const O = OUTFIT[kind] || OUTFIT.driver;
      const shadow = game.quality !== 'low';
      const add = (parent, g, m, x, y, z) => {
        const o = new T.Mesh(g, m);
        o.position.set(x || 0, y || 0, z || 0);
        o.castShadow = shadow;
        parent.add(o);
        return o;
      };
      const joint = (parent, x, y, z, order) => {
        const j = new T.Group();
        j.position.set(x, y, z);
        if (order) j.rotation.order = order;
        parent.add(j);
        return j;
      };
      const shirt = mat(O.shirt), pants = mat(O.pants), skin = mat(O.skin, { roughness: 0.65 }), shoes = mat(O.shoes, { roughness: 0.5 });
      const root = (this.root = new T.Group());
      root.rotation.order = 'YXZ';
      const J = (this.j = {});
      // pelvis + legs
      J.hips = joint(root, 0, 0.95, 0);
      add(J.hips, geo('pelvis', () => new T.CylinderGeometry(0.17, 0.16, 0.18, 10).scale(1, 1, 0.62)), pants, 0, 0, 0);
      for (const [k, sx] of [['L', 1], ['R', -1]]) {
        const hip = (J['hip' + k] = joint(J.hips, sx * 0.095, -0.05, 0));
        add(hip, geo('thigh', () => new T.CylinderGeometry(0.082, 0.062, 0.44, 8).translate(0, -0.22, 0)), pants);
        const kn = (J['kn' + k] = joint(hip, 0, -0.44, 0));
        add(kn, geo('shin', () => new T.CylinderGeometry(0.06, 0.045, 0.43, 8).translate(0, -0.215, 0)), pants);
        add(kn, geo('foot', () => new T.BoxGeometry(0.095, 0.075, 0.25).translate(0, -0.46, 0.05)), shoes);
      }
      // torso, head
      J.chest = joint(J.hips, 0, 0.08, 0);
      add(J.chest, geo('torso', () => new T.CylinderGeometry(0.205, 0.17, 0.46, 10).scale(1, 1, 0.56).translate(0, 0.23, 0)), shirt);
      J.neck = joint(J.chest, 0, 0.47, 0);
      add(J.neck, geo('neckM', () => new T.CylinderGeometry(0.045, 0.05, 0.09, 8).translate(0, 0.03, 0)), skin);
      const head = joint(J.neck, 0, 0.13, 0.01);
      add(head, geo('head', () => new T.SphereGeometry(0.112, 14, 10).scale(0.92, 1.05, 1)), skin);
      for (const sx of [-1, 1]) add(head, geo('eye', () => new T.SphereGeometry(0.014, 6, 4)), mat(0x16120f, { roughness: 0.3 }), sx * 0.038, 0.02, 0.098);
      add(head, geo('nose', () => new T.BoxGeometry(0.022, 0.04, 0.03)), skin, 0, -0.012, 0.11);
      // shoulders → arms → hands
      for (const [k, sx] of [['L', 1], ['R', -1]]) {
        const sh = (J['sh' + k] = joint(J.chest, sx * 0.225, 0.4, 0, 'YXZ'));
        add(sh, geo('shoulder', () => new T.SphereGeometry(0.062, 8, 6)), shirt);
        add(sh, geo('upper', () => new T.CylinderGeometry(0.056, 0.046, 0.29, 8).translate(0, -0.145, 0)), shirt);
        const el = (J['el' + k] = joint(sh, 0, -0.29, 0));
        add(el, geo('fore', () => new T.CylinderGeometry(0.045, 0.036, 0.26, 8).translate(0, -0.13, 0)), kind === 'officer' ? shirt : skin);
        const hand = (J['hand' + k] = joint(el, 0, -0.27, 0));
        add(hand, geo('hand', () => new T.BoxGeometry(0.055, 0.09, 0.03).translate(0, -0.035, 0)), skin);
        J['wrist' + k] = joint(el, 0, -0.235, 0);
      }
      if (kind === 'officer') {
        const navy = mat(0x15203a), black = mat(0x0d0d0e, { roughness: 0.5 }), gold = mat(0xd9b24a, { metalness: 0.8, roughness: 0.3 });
        // peaked cap
        add(head, geo('capTop', () => new T.CylinderGeometry(0.128, 0.118, 0.075, 14)), navy, 0, 0.1, 0);
        add(head, geo('capBand', () => new T.CylinderGeometry(0.119, 0.119, 0.03, 14)), black, 0, 0.068, 0);
        add(head, geo('visor', () => new T.BoxGeometry(0.17, 0.012, 0.075)), black, 0, 0.062, 0.12).rotation.x = 0.25;
        add(head, geo('capBadge', () => new T.BoxGeometry(0.04, 0.035, 0.01)), gold, 0, 0.1, 0.122);
        // belt, holster, radio, badge, "POLİS" on the back
        add(J.hips, geo('belt', () => new T.CylinderGeometry(0.178, 0.178, 0.05, 12).scale(1, 1, 0.64)), black, 0, 0.07, 0);
        this.holster = add(J.hips, geo('holster', () => new T.BoxGeometry(0.05, 0.15, 0.09)), black, -0.18, -0.02, 0.02);
        add(J.chest, geo('radioBox', () => new T.BoxGeometry(0.05, 0.08, 0.03)), black, 0.1, 0.36, 0.1);
        add(J.chest, geo('badge', () => new T.BoxGeometry(0.05, 0.06, 0.01)), gold, -0.1, 0.33, 0.112);
        const lab = add(J.chest, geo('label', () => new T.PlaneGeometry(0.3, 0.11)), M.label || (M.label = new T.MeshStandardMaterial({ map: policeLabel(), roughness: 0.8 })), 0, 0.3, -0.118);
        lab.rotation.y = Math.PI;
        lab.castShadow = false;
        // pistol in the right hand: barrel along the fingers (-Y), grip toward the palm side
        const gun = (this.gun = new T.Group());
        add(gun, geo('slide', () => new T.BoxGeometry(0.03, 0.18, 0.036)), black, 0, -0.07, 0.03);
        add(gun, geo('grip', () => new T.BoxGeometry(0.028, 0.05, 0.11)), black, 0, 0.0, -0.02).rotation.x = -0.25;
        gun.visible = false;
        J.handR.add(gun);
        // ticket book (left hand) and pen (right hand)
        // baton: on the belt, in the hand for the strike
        const batonG = geo('baton', () => new T.CylinderGeometry(0.018, 0.022, 0.6, 8));
        this.batonBelt = add(J.hips, batonG, black, 0.19, -0.1, -0.04);
        this.baton = add(J.handR, batonG, black, 0, -0.3, 0.02);
        this.baton.visible = false;
        // a wad of banknotes found in a search
        this.cash = add(J.handL, geo('cash', () => new T.BoxGeometry(0.075, 0.03, 0.16)), mat(0x5f9a5b, { roughness: 0.9 }), 0, -0.08, 0.03);
        add(this.cash, geo('cashBand', () => new T.BoxGeometry(0.078, 0.032, 0.03)), mat(0xe8dcc0), 0, 0, 0);
        this.cash.visible = false;
        const pad = (this.pad = add(J.handL, geo('pad', () => new T.BoxGeometry(0.11, 0.15, 0.015)), mat(0xf2efe6), 0, -0.07, 0.03));
        pad.rotation.x = 0.4;
        pad.visible = false;
      } else {
        const hair = mat(O.hair, { roughness: 0.9 });
        add(head, geo('hair', () => new T.SphereGeometry(0.118, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.02, 1.04)), hair, 0, 0.012, -0.006);
        add(J.chest, geo('collar', () => new T.CylinderGeometry(0.1, 0.13, 0.06, 10).scale(1, 1, 0.7)), shirt, 0, 0.45, 0);
      }
      // handcuffs: a ring on each wrist, the chain is re-laid every frame
      this.cuffs = null;
      this.pose = 'stand';
      this.cur = {};
      for (const k of JOINTS) this.cur[k] = new T.Vector3();
      this.curY = 0;
      this.walkPh = 0;
      this.walkAmt = 0;
      this.x = 0; this.z = 0; this.yaw = 0;
      this.path = null;
      this.speed = 1.3;
      this.follow = null;
      this.faceTo = null;
      this.vis = true;
      this.lean = 0; // forward tilt of the whole body about the feet (π/2: lying face down)
      this.leanT = 0;
      this.floorY = null; // indoor sets: a fixed floor height instead of the terrain
      game.scene.add(root);
    }
    place(x, z, yaw) {
      this.x = x; this.z = z;
      if (yaw != null) this.yaw = yaw;
      this.path = null;
      this.sync();
    }
    setPose(name, snap) {
      this.pose = name;
      if (snap) {
        const P = POSES[name] || {};
        for (const k of JOINTS) { const v = P[k]; this.cur[k].set(v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0); }
        this.curY = P.y || 0;
      }
      if (this.gun) this.gun.visible = name === 'aim' || name === 'aimLow';
      if (this.holster) this.holster.scale.y = this.gun && this.gun.visible ? 0.75 : 1;
      if (this.pad) this.pad.visible = name === 'write';
      if (this.baton) { this.baton.visible = name === 'strikeUp' || name === 'strikeDown'; this.batonBelt.visible = !this.baton.visible; }
    }
    // walk a polyline of {x, z}; done() fires on arrival
    go(points, speed, done) {
      this.path = points.slice();
      this.speed = speed || 1.3;
      this.onArrive = done || null;
    }
    face(x, z) { this.faceTo = { x, z }; }
    lie(on) { this.leanT = on ? Math.PI / 2 : 0; }
    // a booking board hung in front of the chest
    holdPlacard(m) {
      if (!this.placard) {
        this.placard = new T.Mesh(geo('placard', () => new T.PlaneGeometry(0.42, 0.24)), m);
        this.placard.position.set(0, 0.2, 0.15);
        this.j.chest.add(this.placard);
      }
      this.placard.material = m;
      this.placard.visible = true;
    }
    dropPlacard() { if (this.placard) this.placard.visible = false; }
    removeCuffs() {
      const c = this.cuffs;
      if (!c) return;
      c.L.visible = c.R.visible = c.on = false;
      c.chain.visible = c.fixed.visible = false;
      if (c.chain2) c.chain2.visible = false;
      c.anchor = null;
      c.both = false;
    }
    // right wrist cuffed to a fixed point (a ring round a pole at p); both: both wrists behind to it
    cuffTo(p, both) {
      this.putCuffs(both ? 'both' : 'R');
      const c = this.cuffs;
      c.L.visible = !!both;
      c.both = !!both;
      if (both && !c.chain2) { c.chain2 = c.chain.clone(); this.game.scene.add(c.chain2); }
      c.anchor = p.clone();
      c.fixed.position.copy(p);
      c.fixed.visible = true;
      c.on = true;
    }
    show(on) {
      this.vis = on;
      this.root.visible = on;
      const c = this.cuffs;
      if (c) { c.chain.visible = on && c.on; c.fixed.visible = on && !!c.anchor; if (c.chain2) c.chain2.visible = on && c.on && c.both; }
    }
    putCuffs(side) {
      if (!this.cuffs) {
        const steel = mat(0xc9ced4, { metalness: 0.95, roughness: 0.22 });
        const ring = geo('cuffRing', () => new T.TorusGeometry(0.044, 0.009, 6, 16).rotateX(Math.PI / 2));
        const mk = (w) => { const m = new T.Mesh(ring, steel); m.visible = false; w.add(m); return m; };
        const chain = new T.Mesh(geo('cuffChain', () => new T.CylinderGeometry(0.006, 0.006, 1, 5).translate(0, 0.5, 0).rotateX(Math.PI / 2)), steel);
        chain.visible = false;
        this.game.scene.add(chain);
        const fixed = new T.Mesh(geo('cuffFixed', () => new T.TorusGeometry(0.05, 0.009, 6, 16).rotateX(Math.PI / 2)), steel);
        fixed.visible = false;
        this.game.scene.add(fixed);
        this.cuffs = { L: mk(this.j.wristL), R: mk(this.j.wristR), chain, fixed, anchor: null, on: false };
      }
      const c = this.cuffs;
      if (side === 'L' || side === 'both') c.L.visible = true;
      if (side === 'R' || side === 'both') c.R.visible = true;
      c.on = (c.L.visible && c.R.visible) || !!c.anchor;
    }
    pos(out) { return (out || new T.Vector3()).set(this.x, this.root.position.y, this.z); }
    wristPos(side, out) { this.root.updateMatrixWorld(true); return this.j['wrist' + side].getWorldPosition(out || new T.Vector3()); }
    headPos(out) { return (out || new T.Vector3()).set(this.x, this.root.position.y + 1.62 + this.curY, this.z); }
    update(dt) {
      if (!this.vis) return;
      let moving = 0;
      // follow another figure (escort) at an offset in its frame
      if (this.follow) {
        const f = this.follow;
        const fx = Math.sin(f.fig.yaw), fz = Math.cos(f.fig.yaw);
        const tx = f.fig.x + fz * f.side - fx * f.back, tz = f.fig.z - fx * f.side - fz * f.back;
        const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
        if (d > 0.02) {
          const k = Math.min(1, dt * 6);
          this.x += dx * k; this.z += dz * k;
          moving = Math.min(1, (d * k) / Math.max(1e-4, dt) / 1.2);
        }
        this.yaw += U.angleWrap(f.fig.yaw - this.yaw) * Math.min(1, dt * 6);
      } else if (this.path && this.path.length) {
        const tg = this.path[0];
        const dx = tg.x - this.x, dz = tg.z - this.z, d = Math.hypot(dx, dz);
        const step = this.speed * dt;
        if (d <= step) {
          this.x = tg.x; this.z = tg.z;
          this.path.shift();
          if (!this.path.length) { this.path = null; const cb = this.onArrive; this.onArrive = null; if (cb) cb(this); }
        } else {
          this.x += (dx / d) * step; this.z += (dz / d) * step;
          const want = Math.atan2(dx, dz);
          this.yaw += U.clamp(U.angleWrap(want - this.yaw), -7 * dt, 7 * dt);
        }
        moving = 1;
      } else if (this.faceTo) {
        const want = Math.atan2(this.faceTo.x - this.x, this.faceTo.z - this.z);
        this.yaw += U.clamp(U.angleWrap(want - this.yaw), -5 * dt, 5 * dt);
      }
      this.walkAmt = U.lerp(this.walkAmt, moving, 1 - Math.exp(-dt * 8));
      this.walkPh += dt * this.walkAmt * (this.follow ? 1.1 : this.speed) * (Math.PI * 2 / 1.25);
      // blend toward the pose, then lay the walk on top
      const P = POSES[this.pose] || {};
      const k = 1 - Math.exp(-dt * 9);
      for (const n of JOINTS) {
        const v = P[n], c = this.cur[n];
        c.x += ((v ? v[0] : 0) - c.x) * k;
        c.y += ((v ? v[1] : 0) - c.y) * k;
        c.z += ((v ? v[2] : 0) - c.z) * k;
      }
      this.curY += ((P.y || 0) - this.curY) * k;
      this.lean += (this.leanT - this.lean) * (1 - Math.exp(-dt * 4.5));
      const J = this.j, w = this.walkAmt, s = Math.sin(this.walkPh), cs = Math.cos(this.walkPh);
      for (const n of JOINTS) J[n].rotation.set(this.cur[n].x, this.cur[n].y, this.cur[n].z);
      if (this.lookSide) J.neck.rotation.y += this.lookSide;
      // frisking: hands working along the back and legs
      if (this.pose === 'frisk' || this.pose === 'friskStand') {
        const q = (this.frPh = (this.frPh || 0) + dt);
        J.shL.rotation.x += Math.sin(q * 9) * 0.25;
        J.shR.rotation.x += Math.sin(q * 9 + 1.6) * 0.25;
        J.chest.rotation.y += Math.sin(q * 1.6) * 0.2;
      }
      // dozing: head drops forward
      if (this.doze > 0.01) {
        J.neck.rotation.x += 0.65 * this.doze;
        J.chest.rotation.x += 0.08 * this.doze;
      }
      // crying: head down, shoulders heaving
      if (this.sob > 0.01) {
        const q = (this.sobPh = (this.sobPh || 0) + dt), w = this.sob, h = Math.sin(q * 8.5);
        J.neck.rotation.x += 0.42 * w;
        J.chest.rotation.x += (0.12 + h * 0.05) * w;
        J.shL.rotation.z += h * 0.05 * w;
        J.shR.rotation.z -= h * 0.05 * w;
      }
      // struggling on the ground: twist and kick (wiggle fades unless kept up)
      if (this.wiggle > 0.01) {
        const q = (this.wigPh = (this.wigPh || 0) + dt), w = this.wiggle;
        J.chest.rotation.z += Math.sin(q * 17) * 0.22 * w;
        J.shL.rotation.z += Math.sin(q * 13) * 0.45 * w;
        J.shR.rotation.z -= Math.sin(q * 15 + 1) * 0.45 * w;
        J.hipL.rotation.x += Math.sin(q * 12) * 0.4 * w;
        J.hipR.rotation.x -= Math.sin(q * 12) * 0.4 * w;
        J.knL.rotation.x += Math.max(0, Math.sin(q * 12)) * 0.6 * w;
        J.knR.rotation.x += Math.max(0, -Math.sin(q * 12)) * 0.6 * w;
        this.wiggle = Math.max(0, w - dt * 2.5);
      }
      if (w > 0.01) {
        J.hipL.rotation.x += -0.48 * s * w;
        J.hipR.rotation.x += 0.48 * s * w;
        J.knL.rotation.x += (0.08 + 0.75 * Math.max(0, cs)) * w;
        J.knR.rotation.x += (0.08 + 0.75 * Math.max(0, -cs)) * w;
        if (!ARMS.some((a) => P[a]) || this.pose === 'stand' || this.pose === 'talk') {
          J.shL.rotation.x += 0.35 * s * w;
          J.shR.rotation.x += -0.35 * s * w;
        }
      }
      const bob = -0.022 * Math.abs(s) * w;
      this.sync(bob);
      // cuff chain between the wrists
      const c = this.cuffs;
      if (c && c.on) {
        const a = c.anchor ? _a.copy(c.anchor) : this.wristPos('L', _a), b = this.wristPos('R', _b);
        const lay = (ch, p, q) => { ch.position.copy(p); ch.lookAt(q); ch.scale.set(1, 1, Math.max(0.02, p.distanceTo(q))); ch.visible = true; };
        lay(c.chain, a, b);
        if (c.both && c.chain2) lay(c.chain2, a, this.wristPos('L', _b));
      }
    }
    sync(bob) {
      const y = this.floorY != null ? this.floorY : this.game.world.heightAt(this.x, this.z);
      this.root.position.set(this.x, y + (bob || 0) + Math.sin(this.lean) * 0.13, this.z);
      this.j.hips.position.y = 0.95 + this.curY;
      this.root.rotation.y = this.yaw;
      this.root.rotation.x = this.lean;
    }
    dispose() {
      this.game.scene.remove(this.root);
      if (this.cuffs) { this.game.scene.remove(this.cuffs.chain, this.cuffs.fixed); if (this.cuffs.chain2) this.game.scene.remove(this.cuffs.chain2); }
    }
  }
  const _a = new T.Vector3(), _b = new T.Vector3();

  SB.People = { Figure, POSES };
})();
