// SHIFTBREAKER — procedural vehicle models (fictional designs, no real logos or makes).
// Local frame: +Z forward, +X left, +Y up; origin at the centre of gravity.
(function () {
  'use strict';
  const SB = window.SB;
  const T = THREE;

  // side profiles: x = forward from car centre, y = height above ground
  const PROFILES = {
    hatch: {
      L: 4.05, H: 1.45, cabinW: 0.84,
      lower: [[2.02, 0.62], [1.96, 0.8], [0.75, 0.98], [-1.9, 1.0], [-2.0, 0.95], [-2.03, 0.55], [-1.95, 0.28]],
      front: [2.0, 0.3],
      glass: [[0.75, 0.98], [0.05, 1.42], [-1.45, 1.4], [-1.93, 1.0]],
      roof: [[0.02, 1.425], [-1.45, 1.405]],
      hood: [0.82, 1.92],
    },
    coupe: {
      L: 4.45, H: 1.32, cabinW: 0.8,
      lower: [[2.22, 0.6], [2.15, 0.76], [0.55, 0.92], [-1.9, 0.95], [-2.2, 0.88], [-2.24, 0.5], [-2.15, 0.27]],
      front: [2.2, 0.28],
      glass: [[0.55, 0.92], [-0.25, 1.3], [-1.0, 1.31], [-1.96, 0.96]],
      roof: [[-0.27, 1.312], [-1.0, 1.322]],
      hood: [0.62, 2.12],
    },
    track: {
      L: 4.2, H: 1.2, cabinW: 0.72,
      lower: [[2.12, 0.4], [2.06, 0.64], [0.6, 0.84], [-1.9, 0.88], [-2.1, 0.86], [-2.12, 0.45], [-2.05, 0.24]],
      front: [2.1, 0.22],
      glass: [[0.6, 0.84], [-0.1, 1.17], [-0.9, 1.17], [-1.62, 0.89]],
      roof: [[-0.12, 1.182], [-0.9, 1.182]],
      hood: [0.68, 2.02],
    },
    sedan: {
      L: 4.6, H: 1.47, cabinW: 0.84,
      lower: [[2.3, 0.62], [2.22, 0.8], [0.85, 0.98], [-1.6, 1.0], [-2.25, 0.98], [-2.3, 0.58], [-2.22, 0.28]],
      front: [2.28, 0.3],
      glass: [[0.85, 0.98], [0.15, 1.45], [-1.0, 1.44], [-1.62, 1.0]],
      roof: [[0.12, 1.455], [-1.0, 1.445]],
      hood: [0.9, 2.18],
    },
    van: {
      L: 5.1, H: 2.05, cabinW: 0.93,
      lower: [[2.55, 0.55], [2.5, 0.95], [1.9, 1.15], [-2.5, 1.12], [-2.55, 1.05], [-2.56, 0.5], [-2.5, 0.3]],
      front: [2.53, 0.32],
      glass: [[1.9, 1.15], [1.5, 1.95], [-2.48, 1.98], [-2.54, 1.13]],
      roof: [[1.45, 1.965], [-2.48, 1.995]],
      hood: null,
    },
  };

  function profileShape(P, wb, R) {
    const fA = P.L / 2 - (P.L - wb) / 2 - 0.02 + (P.front[0] - P.L / 2) * 0; // front axle
    void fA;
    const shape = new T.Shape();
    const lw = P.lower;
    const rear = lw[lw.length - 1];
    const ar = R + 0.06;
    const frontAxle = wb / 2 + (P.frontBias || 0), rearAxle = -wb / 2 + (P.frontBias || 0);
    shape.moveTo(rear[0], rear[1]);
    shape.lineTo(rearAxle - ar, rear[1]);
    shape.absarc(rearAxle, R, ar, Math.PI, 0, true);
    shape.lineTo(frontAxle - ar, rear[1]);
    shape.absarc(frontAxle, R, ar, Math.PI, 0, true);
    shape.lineTo(P.front[0], P.front[1]);
    for (let i = 0; i < lw.length - 1; i++) shape.lineTo(lw[i][0], lw[i][1]);
    return shape;
  }
  function polyShape(pts) {
    const s = new T.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    return s;
  }
  // Extrude a side profile across the width; returns geometry in car-local coords.
  function extrudeProfile(shape, width, bevel, cg, lite) {
    const g = new T.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: lite ? 1 : 2, curveSegments: lite ? 4 : 10, steps: lite ? 1 : 3 });
    g.translate(0, -cg, -(width - bevel * 2) / 2);
    g.rotateY(-Math.PI / 2);
    return g;
  }

  function paintMaterial(color, finish) {
    const f = finish || 'gloss';
    return new T.MeshStandardMaterial({ color, roughness: f === 'matte' ? 0.75 : f === 'chrome' ? 0.08 : 0.32, metalness: f === 'chrome' ? 1 : f === 'metal' ? 0.65 : 0.15 });
  }
  function setVertexColor(g, color) {
    const n = g.attributes.position.count;
    const c = new T.Color(color);
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    return g;
  }
  // Concatenate geometries (baked transforms + per-part colour) into one indexed geometry.
  function merge(parts) {
    let nv = 0, ni = 0;
    const gs = parts.map(([g, color, mtx]) => {
      let geo = g.index ? g.toNonIndexed() : g.clone();
      if (mtx) geo.applyMatrix4(mtx);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      setVertexColor(geo, color);
      nv += geo.attributes.position.count;
      ni += geo.attributes.position.count;
      return geo;
    });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    let o = 0;
    for (const g of gs) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('color', new T.BufferAttribute(col, 3));
    void ni;
    return out;
  }

  const M4 = (x, y, z, ry, rx, rz, sx, sy, sz) => {
    const m = new T.Matrix4();
    m.compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(sx || 1, sy || 1, sz || 1));
    return m;
  };

  // ------------------------------------------------------------ traffic / parked (merged)
  // Returns {geo (vertex-coloured, body parts white for instance tint), len, wid, wheelR}
  function buildSimple(type) {
    const parts = [];
    const box = (w, h, d, x, y, z, color, ry) => parts.push([new T.BoxGeometry(w, h, d), color, M4(x, y, z, ry || 0)]);
    const wheelG = new T.CylinderGeometry(1, 1, 1, 8);
    wheelG.rotateZ(Math.PI / 2);
    const wheel = (x, y, z, R, w) => parts.push([wheelG, 0x15161a, M4(x, y, z, 0, 0, 0, w, R, R)]);
    let len, wid, cg = 0;
    if (type === 'bus') {
      len = 11.6; wid = 2.5;
      box(wid, 2.6, len, 0, 1.75, 0, 0xffffff);
      box(wid + 0.02, 1.0, len - 1.2, 0, 2.3, -0.2, 0x1d2630);
      box(wid + 0.02, 1.2, 0.05, 0, 2.2, len / 2, 0x1d2630);
      box(wid * 0.9, 0.25, len * 0.9, 0, 3.15, 0, 0xd7d7d7);
      for (const [z, s] of [[3.9, 1], [-3.6, 1]]) for (const sx of [-1, 1]) wheel(sx * (wid / 2 - 0.25), 0.52, z * s, 0.52, 0.32);
      box(0.3, 0.18, 0.05, 0.8, 0.8, len / 2 + 0.01, 0xfff3d0);
      box(0.3, 0.18, 0.05, -0.8, 0.8, len / 2 + 0.01, 0xfff3d0);
      box(0.3, 0.25, 0.05, 0.9, 0.9, -len / 2 - 0.01, 0xd01a1a);
      box(0.3, 0.25, 0.05, -0.9, 0.9, -len / 2 - 0.01, 0xd01a1a);
    } else if (type === 'truck') {
      len = 7.6; wid = 2.4;
      box(wid, 2.1, 1.9, 0, 1.65, len / 2 - 0.95, 0xffffff);
      box(wid + 0.02, 0.8, 0.05, 0, 2.15, len / 2 + 0.01, 0x1d2630);
      box(wid, 2.6, 5.4, 0, 1.95, -0.95, 0xe8e6e0);
      box(wid * 0.9, 0.3, len, 0, 0.62, 0, 0x2a2a2a);
      for (const z of [2.6, -1.6, -2.8]) for (const sx of [-1, 1]) wheel(sx * (wid / 2 - 0.2), 0.5, z, 0.5, 0.3);
      box(0.3, 0.2, 0.05, 0.85, 0.95, len / 2 + 0.01, 0xfff3d0);
      box(0.3, 0.2, 0.05, -0.85, 0.95, len / 2 + 0.01, 0xfff3d0);
      box(0.3, 0.2, 0.05, 0.9, 0.7, -len / 2 + 0.6, 0xd01a1a);
      box(0.3, 0.2, 0.05, -0.9, 0.7, -len / 2 + 0.6, 0xd01a1a);
    } else {
      const ptype = type === 'taxi' || type === 'police' ? 'sedan' : type === 'dolmus' ? 'van' : type;
      const P = PROFILES[ptype];
      len = P.L;
      wid = ptype === 'van' ? 1.98 : 1.78;
      const wb = ptype === 'van' ? 3.0 : ptype === 'hatch' ? 2.52 : 2.7;
      const R = ptype === 'van' ? 0.33 : 0.31;
      parts.push([extrudeProfile(profileShape(P, wb, R), wid, 0.04, cg, true), 0xffffff, null]);
      const gl = extrudeProfile(polyShape(P.glass), wid * P.cabinW, 0, cg, true);
      parts.push([gl, 0x1a232b, null]);
      for (const sx of [-1, 1]) {
        wheel(sx * (wid / 2 - 0.13), R, wb / 2, R, 0.2);
        wheel(sx * (wid / 2 - 0.13), R, -wb / 2, R, 0.2);
      }
      const fz = P.front[0] + 0.01, rz = P.lower[P.lower.length - 3][0] - 0.01;
      box(0.36, 0.12, 0.06, 0.58, P.lower[0][1] + 0.05, fz, 0xfff3d0);
      box(0.36, 0.12, 0.06, -0.58, P.lower[0][1] + 0.05, fz, 0xfff3d0);
      box(0.32, 0.14, 0.06, 0.62, P.lower[P.lower.length - 2][1] + 0.25, rz, 0xb5141a);
      box(0.32, 0.14, 0.06, -0.62, P.lower[P.lower.length - 2][1] + 0.25, rz, 0xb5141a);
      box(wid * 0.7, 0.12, 0.05, 0, P.front[1] + 0.12, fz, 0x22252a);
      if (type === 'taxi') box(0.7, 0.22, 0.32, 0, P.roof[0][1] + 0.13, -0.5, 0xf5c518);
      if (type === 'police') {
        box(1.1, 0.13, 0.3, 0.3, P.roof[0][1] + 0.08, -0.45, 0x1e5bff);
        box(1.1, 0.13, 0.3, -0.3, P.roof[0][1] + 0.08, -0.45, 0xff2a2a);
        box(wid + 0.02, 0.14, 2.6, 0, 0.75, 0, 0x1e3f8f);
      }
      if (type === 'dolmus') box(wid + 0.02, 0.2, P.L * 0.98, 0, 0.92, 0, 0x1b1b1b);
    }
    const geo = merge(parts);
    return { geo, len, wid };
  }

  // ------------------------------------------------------------ player car (detailed)
  function buildPlayer(car, opts) {
    const o = opts || {};
    const P = Object.assign({}, PROFILES[car.body]);
    const wb = car.wheelbase, R = car.wheel.radius, W = car.dims.width, cg = car.cgHeight;
    // shift the profile so axles sit at ±wb/2 around the weight centre
    P.frontBias = 0;
    const root = new T.Group();
    const body = new T.Group();
    root.add(body);
    const paint = paintMaterial(o.color != null ? o.color : car.color, o.finish);
    paint.vertexColors = true;
    const trim = new T.MeshStandardMaterial({ color: 0x17191c, roughness: 0.6, metalness: 0.2 });
    const glass = new T.MeshStandardMaterial({ color: 0x1a2630, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.78 });
    const chrome = new T.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.2, metalness: 1 });
    const mats = {
      paint, trim, glass, chrome,
      head: new T.MeshStandardMaterial({ color: 0xf4f1e6, emissive: new T.Color(0xfff2d6), emissiveIntensity: 0.05, roughness: 0.2 }),
      tail: new T.MeshStandardMaterial({ color: 0x5a0a0d, emissive: new T.Color(0xff1a1a), emissiveIntensity: 0.15, roughness: 0.3 }),
      rev: new T.MeshStandardMaterial({ color: 0xdedede, emissive: new T.Color(0xffffff), emissiveIntensity: 0, roughness: 0.3 }),
      indL: new T.MeshStandardMaterial({ color: 0x8a4a10, emissive: new T.Color(0xffa020), emissiveIntensity: 0, roughness: 0.3 }),
      indR: new T.MeshStandardMaterial({ color: 0x8a4a10, emissive: new T.Color(0xffa020), emissiveIntensity: 0, roughness: 0.3 }),
      disc: new T.MeshStandardMaterial({ color: 0x55575a, emissive: new T.Color(0xff3a10), emissiveIntensity: 0, roughness: 0.5, metalness: 0.6 }),
    };
    const add = (geo, mat, parent, x, y, z) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = true;
      m.receiveShadow = true;
      (parent || body).add(m);
      return m;
    };
    // lower body (deformable)
    const lowerGeo = extrudeProfile(profileShape(P, wb, R), W, 0.07, cg);
    lowerGeo.computeVertexNormals();
    setVertexColor(lowerGeo, 0xffffff);
    const lower = add(lowerGeo, paint);
    // greenhouse
    const gl = add(extrudeProfile(polyShape(P.glass), W * P.cabinW, 0.05, cg), glass);
    gl.castShadow = false;
    // roof panel + pillars
    const [r0, r1] = P.roof;
    const roofLen = Math.hypot(r0[0] - r1[0], r0[1] - r1[1]);
    const roof = add(new T.BoxGeometry(W * P.cabinW - 0.04, 0.05, roofLen), paint, body, 0, (r0[1] + r1[1]) / 2 - cg + 0.01, (r0[0] + r1[0]) / 2);
    roof.rotation.x = Math.atan2(r0[1] - r1[1], r0[0] - r1[0]) * -1;
    const pillarG = new T.BoxGeometry(0.06, 0.4, 0.12);
    for (const sx of [-1, 1]) {
      const bp = add(pillarG, trim, body, sx * (W * P.cabinW) / 2, (P.glass[0][1] + r0[1]) / 2 - cg, (P.glass[1][0] + P.glass[2][0]) / 2 + 0.1);
      bp.scale.y = (r0[1] - P.glass[0][1]) / 0.4;
    }
    // hood (separate so it can fly off)
    let hood = null;
    if (P.hood) {
      const hz0 = P.hood[0], hz1 = P.hood[1];
      const yAt = (x) => {
        const lw = P.lower;
        for (let i = 0; i < lw.length - 1; i++) {
          const a = lw[i], b = lw[i + 1];
          if ((x <= a[0] && x >= b[0]) || (x >= a[0] && x <= b[0])) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1);
        }
        return lw[1][1];
      };
      const y0 = yAt(hz0), y1 = yAt(hz1);
      const hl = Math.hypot(hz1 - hz0, y1 - y0);
      const hg = new T.BoxGeometry(W * 0.86, 0.035, hl);
      setVertexColor(hg, 0xffffff);
      hood = add(hg, paint, body, 0, (y0 + y1) / 2 - cg + 0.022, (hz0 + hz1) / 2);
      hood.rotation.x = Math.atan2(y0 - y1, hz1 - hz0);
      hood.userData.home = { p: hood.position.clone(), r: hood.rotation.clone() };
    }
    // bumpers, grille, lights
    const fz = P.front[0], fy = P.lower[0][1];
    const rz = P.lower[P.lower.length - 2][0], ry = P.lower[P.lower.length - 2][1];
    add(new T.BoxGeometry(W * 0.94, 0.16, 0.12), trim, body, 0, P.front[1] + 0.1 - cg, fz - 0.02);
    add(new T.BoxGeometry(W * 0.5, 0.12, 0.05), trim, body, 0, fy - 0.08 - cg, fz + 0.02);
    const heads = [], tails = [];
    for (const sx of [-1, 1]) {
      heads.push(add(new T.BoxGeometry(0.38, 0.1, 0.08), mats.head, body, sx * W * 0.33, fy + 0.04 - cg, fz - 0.03));
      tails.push(add(new T.BoxGeometry(0.34, 0.12, 0.06), mats.tail, body, sx * W * 0.36, ry + 0.3 - cg, rz - 0.01));
      add(new T.BoxGeometry(0.1, 0.06, 0.06), sx > 0 ? mats.indL : mats.indR, body, sx * W * 0.45, fy - 0.03 - cg, fz - 0.06);
      add(new T.BoxGeometry(0.08, 0.06, 0.05), sx > 0 ? mats.indL : mats.indR, body, sx * W * 0.45, ry + 0.3 - cg, rz - 0.01);
      // mirrors
      add(new T.BoxGeometry(0.12, 0.1, 0.18), paint, body, sx * (W / 2 + 0.04), P.glass[0][1] + 0.1 - cg, P.glass[0][0] - 0.25);
    }
    add(new T.BoxGeometry(0.16, 0.07, 0.05), mats.rev, body, 0.18, ry + 0.18 - cg, rz - 0.01);
    add(new T.BoxGeometry(W * 0.9, 0.14, 0.1), trim, body, 0, ry + 0.05 - cg, rz + 0.02);
    // track car: wing + splitter + livery
    if (car.body === 'track') {
      const wing = add(new T.BoxGeometry(W * 0.92, 0.04, 0.34), trim, body, 0, 1.26 - cg, -1.86);
      wing.rotation.x = 0.12;
      for (const sx of [-0.55, 0.55]) add(new T.BoxGeometry(0.04, 0.34, 0.14), trim, body, sx, 1.07 - cg, -1.86);
      add(new T.BoxGeometry(W * 0.96, 0.03, 0.3), trim, body, 0, 0.24 - cg, fz + 0.05);
      const stripe = new T.MeshStandardMaterial({ color: 0xd93a22, roughness: 0.4 });
      for (const sx of [-0.16, 0.16]) {
        add(new T.BoxGeometry(0.16, 0.012, 1.4), stripe, hood || body, sx, 0.025, 0);
        add(new T.BoxGeometry(0.16, 0.012, 0.8), stripe, body, sx, r0[1] - cg + 0.045, (r0[0] + r1[0]) / 2);
      }
      const num = document.createElement('canvas');
      num.width = num.height = 128;
      const ng = num.getContext('2d');
      ng.fillStyle = '#fff'; ng.beginPath(); ng.arc(64, 64, 58, 0, 6.3); ng.fill();
      ng.fillStyle = '#111'; ng.font = '900 78px "Barlow Condensed", sans-serif'; ng.textAlign = 'center'; ng.textBaseline = 'middle'; ng.fillText('34', 64, 70);
      const nm = new T.MeshBasicMaterial({ map: new T.CanvasTexture(num), transparent: true });
      for (const sx of [-1, 1]) {
        const d = add(new T.PlaneGeometry(0.55, 0.55), nm, body, sx * (W / 2 + 0.005), 0.62 - cg, -0.2);
        d.rotation.y = sx * Math.PI / 2;
        d.castShadow = false;
      }
    }
    // wheels
    const wheels = [];
    const tireG = new T.CylinderGeometry(R, R, car.wheel.width, 20);
    tireG.rotateZ(Math.PI / 2);
    const rimG = new T.CylinderGeometry(R * 0.66, R * 0.66, car.wheel.width + 0.012, 16);
    rimG.rotateZ(Math.PI / 2);
    const discG = new T.CylinderGeometry(R * 0.52, R * 0.52, 0.03, 16);
    discG.rotateZ(Math.PI / 2);
    const spokeG = new T.BoxGeometry(0.03, R * 1.2, 0.07);
    const tireM = new T.MeshStandardMaterial({ color: 0x141416, roughness: 0.92 });
    const rimM = new T.MeshStandardMaterial({ color: o.rimColor != null ? o.rimColor : 0xb9bec4, roughness: 0.28, metalness: 0.85 });
    const halfT = car.track / 2;
    const ax = [[halfT, wb / 2, true], [-halfT, wb / 2, true], [halfT, -wb / 2, false], [-halfT, -wb / 2, false]];
    for (const [x, z, front] of ax) {
      const steer = new T.Group();
      steer.position.set(x, R - cg, z);
      root.add(steer);
      const spin = new T.Group();
      steer.add(spin);
      add(tireG, tireM, spin);
      add(rimG, rimM, spin);
      for (let k = 0; k < 5; k++) {
        const s = add(spokeG, rimM, spin, Math.sign(x) * (car.wheel.width / 2 + 0.01), 0, 0);
        s.rotation.x = (k / 5) * Math.PI * 2;
      }
      const disc = add(discG, mats.disc, steer, -Math.sign(x) * 0.06, 0, 0);
      disc.castShadow = false;
      wheels.push({ steer, spin, front, x, z, disc });
    }
    // cockpit interior (only visible in cockpit view)
    const interior = new T.Group();
    body.add(interior);
    const dash = new T.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.85 });
    const beltY = P.glass[0][1] - cg;
    const ws = P.glass[0][0];
    // dark trim over the body's top face inside the cabin (door cards, parcel shelf)
    const tubLen = ws - P.glass[3][0];
    const tub = add(new T.PlaneGeometry(W * P.cabinW + 0.02, tubLen), new T.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.9 }), interior, 0, beltY + 0.012, (ws + P.glass[3][0]) / 2);
    tub.rotation.x = -Math.PI / 2;
    add(new T.BoxGeometry(W * 0.86, 0.22, 0.5), dash, interior, 0, beltY + 0.06, ws - 0.25);
    add(new T.BoxGeometry(0.28, 0.32, 0.9), dash, interior, 0, beltY - 0.42, ws - 0.9);
    const seatM = new T.MeshStandardMaterial({ color: car.body === 'track' ? 0x262a30 : 0x3b3530, roughness: 0.9 });
    for (const sx of [0.38, -0.38]) {
      add(new T.BoxGeometry(0.5, 0.14, 0.55), seatM, interior, sx, beltY - 0.62, ws - 1.35);
      const bk = add(new T.BoxGeometry(0.5, 0.7, 0.12), seatM, interior, sx, beltY - 0.25, ws - 1.68);
      bk.rotation.x = -0.18;
    }
    const swPivot = new T.Group();
    swPivot.position.set(0.38, beltY - 0.06, ws - 0.62);
    swPivot.rotation.x = -0.45;
    interior.add(swPivot);
    const steeringWheel = new T.Group();
    swPivot.add(steeringWheel);
    const swM = new T.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.7 });
    add(new T.TorusGeometry(0.18, 0.022, 8, 28), swM, steeringWheel);
    for (let k = 0; k < 3; k++) {
      const sp = add(new T.BoxGeometry(0.02, 0.17, 0.02), swM, steeringWheel, 0, 0, 0);
      sp.rotation.z = (k / 3) * Math.PI * 2 + Math.PI;
      sp.position.set(Math.sin(sp.rotation.z) * -0.085, Math.cos(sp.rotation.z) * 0.085, 0);
    }
    // gear lever on the console
    const leverPivot = new T.Group();
    leverPivot.position.set(0, beltY - 0.26, ws - 0.95);
    interior.add(leverPivot);
    const lever = new T.Group();
    leverPivot.add(lever);
    add(new T.CylinderGeometry(0.012, 0.016, 0.24, 8), chrome, lever, 0, 0.12, 0);
    add(new T.SphereGeometry(0.035, 12, 10), new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }), lever, 0, 0.25, 0);
    add(new T.CylinderGeometry(0.06, 0.07, 0.03, 12), dash, leverPivot, 0, 0, 0);
    // driver's right arm (shoulder → hand), animated between wheel and lever
    const skin = new T.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.8 });
    const arm = { shoulder: new T.Vector3(0.18, beltY + 0.12, ws - 1.45) };
    arm.upper = add(new T.CylinderGeometry(0.045, 0.04, 1, 8), skin, interior);
    arm.fore = add(new T.CylinderGeometry(0.04, 0.035, 1, 8), skin, interior);
    arm.hand = add(new T.SphereGeometry(0.045, 10, 8), new T.MeshStandardMaterial({ color: 0xc89a7c, roughness: 0.7 }), interior);
    arm.fore.castShadow = arm.upper.castShadow = arm.hand.castShadow = false;
    // wipers
    const wipers = [];
    for (const sx of [0.3, -0.25]) {
      const piv = new T.Group();
      piv.position.set(sx, P.glass[0][1] - cg + 0.02, P.glass[0][0] - 0.02);
      body.add(piv);
      const blade = add(new T.BoxGeometry(0.02, 0.62, 0.02), trim, piv, 0, 0.31, 0);
      blade.castShadow = false;
      piv.rotation.x = -0.55;
      wipers.push(piv);
    }
    interior.visible = false;
    root.userData = {};
    return {
      root, body, lower, glassMesh: gl, roof, hood, mats, wheels, interior, steeringWheel, lever, leverPivot, arm, wipers, heads, tails,
      enginePos: new T.Vector3(0, fy + 0.15 - cg, fz - 0.7),
      exhaust: (car.exhaust || [[0, -0.3, -car.dims.length / 2]]).map((e) => new T.Vector3(e[0], e[1], e[2])),
      cockpitEye: new T.Vector3(0.38, r0[1] - cg - 0.3, r0[0] - 0.42),
      hoodEye: new T.Vector3(0, P.lower[2][1] - cg + 0.32, P.lower[2][0] - 0.35),
      bumperEye: new T.Vector3(0, fy - cg, fz + 0.15),
      length: P.L, width: W,
    };
  }

  // Dent the deformable body near a local point (impact) — returns true if anything moved.
  function dent(model, local, normal, strength) {
    const g = model.lower.geometry;
    const pos = g.attributes.position;
    const col = g.attributes.color;
    const rad = 0.35 + Math.min(0.6, strength * 0.1);
    const depth = Math.min(0.14, strength * 0.025);
    let moved = false;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - local.x, dy = pos.getY(i) - local.y, dz = pos.getZ(i) - local.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > rad) continue;
      const f = 1 - d / rad;
      pos.setXYZ(i, pos.getX(i) + normal.x * depth * f, pos.getY(i) + normal.y * depth * f * 0.5, pos.getZ(i) + normal.z * depth * f);
      if (col) {
        const k = 1 - f * Math.min(0.5, strength * 0.08);
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
      }
      moved = true;
    }
    if (moved) {
      pos.needsUpdate = true;
      if (col) col.needsUpdate = true;
      g.computeVertexNormals();
    }
    return moved;
  }

  // ------------------------------------------------------------------ real car models (GLB)
  // Assets are pre-baked by tools/prep-car.mjs: +Z forward, +X left, ground at y = 0, mid-wheelbase
  // at z = 0, nodes "body" and "wheel_FL/FR/RL/RR" whose origin is the hub. They replace the procedural
  // body and wheels inside the usual model skeleton, so physics, lights and effects keep working.
  const glbCache = new Map();
  const glbMats = new Set(); // every GLB material, for environment reflections that follow the time of day
  let envMap = null, envScale = 1;
  function loadGLB(url) {
    if (!glbCache.has(url)) {
      glbCache.set(url, new Promise((resolve, reject) => {
        if (!T.GLTFLoader) return reject(new Error('GLTFLoader missing'));
        const L = new T.GLTFLoader();
        if (window.MeshoptDecoder) L.setMeshoptDecoder(window.MeshoptDecoder);
        L.load(url, (g) => resolve(g.scene), undefined, reject);
      }));
    }
    return glbCache.get(url);
  }
  // soft studio-sky environment for car paint reflections (cars look flat black without one)
  function initEnv(renderer) {
    const pm = new T.PMREMGenerator(renderer);
    const sc = new T.Scene();
    // gradient sky as vertex colours (a custom ShaderMaterial renders black inside the PMREM pass on r128)
    const skyGeo = new T.SphereGeometry(50, 32, 16);
    const sp = skyGeo.attributes.position, col = new Float32Array(sp.count * 3);
    const top = new T.Color(0.62, 0.72, 0.85), hor = new T.Color(0.9, 0.88, 0.84), gnd = new T.Color(0.16, 0.15, 0.14), c = new T.Color();
    for (let i = 0; i < sp.count; i++) {
      const h = sp.getY(i) / 50;
      if (h > 0) c.copy(hor).lerp(top, Math.pow(h, 0.6)); else c.copy(hor).lerp(gnd, Math.pow(-h, 0.4));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute('color', new T.BufferAttribute(col, 3));
    const sky = new T.Mesh(skyGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide }));
    sc.add(sky);
    for (const [x, y, z, w, h] of [[0, 30, 0, 40, 8], [30, 12, 10, 6, 14], [-30, 12, -10, 6, 14]]) {
      const p = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(3, 3, 3), side: T.DoubleSide }));
      p.position.set(x, y, z);
      p.lookAt(0, 0, 0);
      sc.add(p);
    }
    envMap = pm.fromScene(sc, 0.03).texture;
    pm.dispose();
    for (const m of glbMats) { m.envMap = envMap; m.needsUpdate = true; }
  }
  function setEnvIntensity(k) {
    if (Math.abs(k - envScale) < 0.01) return;
    envScale = k;
    for (const m of glbMats) m.envMapIntensity = (m.userData.envBase || 1) * k;
  }
  const rx = (s) => (s ? new RegExp(s) : null);
  // The game renders to a linear framebuffer with colours authored for it (r128, no output gamma):
  // GLB textures are used as stored, like the game's own canvas textures, instead of being sRGB-decoded.
  function displayTextures(m) {
    for (const k of ['map', 'emissiveMap']) if (m[k] && m[k].encoding !== T.LinearEncoding) { m[k].encoding = T.LinearEncoding; m.needsUpdate = true; }
  }
  // material copies for one car instance: glass gets simple alpha (no transmission pass), paint a clear coat
  function prepareMaterial(src, cfg, look, cache) {
    if (cache.has(src)) return cache.get(src);
    let m;
    const isPaint = rx(cfg.paint) && rx(cfg.paint).test(src.name);
    if (isPaint) {
      m = new T.MeshPhysicalMaterial();
      T.MeshStandardMaterial.prototype.copy.call(m, src);
      m.defines = { STANDARD: '', PHYSICAL: '' }; // Standard.copy drops the physical shader path
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.05;
      m.roughness = Math.min(m.roughness, 0.45);
      const c = look && look.color;
      if (c != null && c !== look.defaultColor) m.color.setHex(c);
      if (look && look.finish === 'matte') { m.clearcoat = 0; m.roughness = 0.7; m.metalness = 0.1; }
      else if (look && look.finish === 'metal') { m.metalness = 0.75; m.roughness = 0.32; }
      else if (look && look.finish === 'chrome') { m.metalness = 1; m.roughness = 0.07; m.clearcoat = 0; }
      m.userData.paint = true;
    } else {
      m = src.type === 'MeshPhysicalMaterial' ? new T.MeshStandardMaterial() : src.clone();
      if (src.type === 'MeshPhysicalMaterial') T.MeshStandardMaterial.prototype.copy.call(m, src);
    }
    m.name = src.name;
    displayTextures(m);
    if (m.transparent) { m.depthWrite = false; m.opacity = Math.min(m.opacity, 0.6); }
    m.envMap = envMap;
    m.userData.envBase = m.metalness > 0.5 ? 1.0 : 0.7;
    m.envMapIntensity = m.userData.envBase * envScale;
    glbMats.add(m);
    cache.set(src, m);
    return m;
  }
  // split a mesh that carries both head and tail lights in one material into front/rear halves
  function splitByZ(mesh) {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : pos.count;
    const front = [], rear = [];
    // positions may be quantized: compare in car space (the node matrix holds the dequantization)
    const e = mesh.matrixWorld.elements;
    const zc = (i) => e[2] * pos.getX(i) + e[6] * pos.getY(i) + e[10] * pos.getZ(i) + e[14];
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      const z = (zc(a) + zc(b) + zc(c)) / 3;
      (z > 0 ? front : rear).push(a, b, c);
    }
    const make = (list) => { const gg = g.clone(); gg.setIndex(list); return gg; };
    return { front: front.length ? make(front) : null, rear: rear.length ? make(rear) : null };
  }
  // wheel hub in model space: the centre of the wheel's bounds (the assets centre each wheel on its hub)
  function hubOf(scene, node) {
    scene.updateMatrixWorld(true);
    return new T.Box3().setFromObject(node).getCenter(new T.Vector3());
  }
  // Put a loaded GLB scene into a procedural model (buildPlayer) for car `car`.
  function applyGLB(model, scene, car, look) {
    const cfg = car.glb, cg = car.cgHeight;
    const cache = new Map();
    // hide the procedural shell, keep the groups (lights, effects and physics refer to them)
    for (const o of model.body.children) o.visible = false;
    for (const w of model.wheels) { for (const o of w.spin.children) o.visible = false; w.disc.visible = false; }
    model.interior.visible = false;
    const lightRx = rx(cfg.lights);
    const headMats = [], tailMats = [];
    const shell = new T.Group();
    shell.position.y = -cg;
    model.body.add(shell);
    const src = scene.getObjectByName('body');
    src.updateMatrixWorld(true);
    let paint = null;
    src.traverse((o) => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const sm of list) {
        if (lightRx && lightRx.test(sm.name)) {
          // lamps: emissive copies of the model's lamp material, driven like the procedural ones
          const parts = cfg.lightsSplit ? splitByZ(o) : { front: null, rear: o.geometry };
          for (const [geo, role] of [[parts.front, 'head'], [parts.rear, 'tail']]) {
            if (!geo) continue;
            const m = prepareMaterial(sm, cfg, look, new Map());
            m.emissive = new T.Color(role === 'head' ? 0xfff2d6 : 0xff1a1a);
            m.emissiveIntensity = 0;
            const mesh = new T.Mesh(geo, m);
            mesh.applyMatrix4(o.matrixWorld);
            shell.add(mesh);
            (role === 'head' ? headMats : tailMats).push(m);
          }
          continue;
        }
        const m = prepareMaterial(sm, cfg, look, cache);
        if (m.userData.paint) paint = m;
        const mesh = new T.Mesh(o.geometry, m);
        mesh.userData.shared = true; // geometry belongs to the model cache
        mesh.applyMatrix4(o.matrixWorld);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        shell.add(mesh);
      }
    });
    // wheels: the GLB wheel sits on the hub inside each procedural spin group
    for (const w of model.wheels) {
      const name = 'wheel_' + (w.front ? 'F' : 'R') + (w.x > 0 ? 'L' : 'R');
      const node = scene.getObjectByName(name);
      if (!node) continue;
      const hub = hubOf(scene, node);
      node.traverse((o) => {
        if (!o.isMesh) return;
        const mesh = new T.Mesh(o.geometry, prepareMaterial(o.material, cfg, look, cache));
        // keep the node matrix (it carries the dequantization), re-centred on the hub
        mesh.applyMatrix4(o.matrixWorld);
        mesh.position.sub(hub);
        mesh.castShadow = true;
        mesh.userData.shared = true;
        w.spin.add(mesh);
      });
    }
    if (paint) model.mats.paint = paint;
    model.mats.glbHead = headMats;
    model.mats.glbTail = tailMats;
    // camera eyes from the model's real proportions
    const zs = model.zShift || 0;
    const e = cfg.eye || [0.35, 1.0, 0];
    model.cockpitEye.set(e[0], e[1] - cg, e[2] + zs);
    model.hoodEye.set(0, e[1] - 0.12 - cg, e[2] + 0.9 + zs);
    model.bumperEye.set(0, 0.42 - cg, car.dims.length / 2 - 0.15 + zs);
    // the procedural glass/hood must stay hidden (explosion code toggles and throws them)
    model.glassMesh = new T.Object3D();
    model.hood = null;
    model.glb = true;
    return model;
  }
  // light model for rivals, ghosts and the drag opponent: one group, wheels spin via userData.wheels
  function buildGLBSimple(scene, car, color, opts) {
    const o = opts || {};
    const cfg = car.glb;
    const cache = new Map();
    const root = new T.Group();
    const look = { color, defaultColor: car.color };
    const body = scene.getObjectByName('body').clone();
    body.traverse((m) => { if (m.isMesh) m.material = o.material || prepareMaterial(m.material, cfg, look, cache); });
    root.add(body);
    const wheels = [];
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const n = scene.getObjectByName('wheel_' + k);
      if (!n) continue;
      // spin around the hub: the clone keeps its node matrix inside a pivot placed on the hub
      const hub = hubOf(scene, n);
      const w = n.clone();
      w.traverse((m) => { if (m.isMesh) m.material = o.material || prepareMaterial(m.material, cfg, look, cache); });
      w.position.sub(hub);
      const pivot = new T.Group();
      pivot.position.copy(hub);
      pivot.add(w);
      root.add(pivot);
      wheels.push(pivot);
    }
    root.userData.wheels = wheels;
    root.userData.radius = car.wheel.radius;
    return root;
  }

  SB.CarModel = { buildPlayer, buildSimple, dent, PROFILES, paintMaterial, loadGLB, applyGLB, buildGLBSimple, initEnv, setEnvIntensity, displayTextures };
})();
