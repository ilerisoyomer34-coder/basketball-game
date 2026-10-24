// Converts a Sketchfab car GLB into the game's canonical car asset:
//   +Z forward, +Y up, +X left; ground (tyre bottoms) at y = 0; mid-wheelbase at z = 0;
//   nodes: "body" + "wheel_FL" / "wheel_FR" / "wheel_RL" / "wheel_RR" (node origin = wheel centre).
// Geometry is simplified, materials deduplicated, textures resized to WebP, meshopt-compressed.
// Usage: node prep-car.mjs <car> <hi|lo>   (needs @gltf-transform/{core,functions,extensions}@4, meshoptimizer, sharp)
// Sources are the original Sketchfab downloads (not in the repo); output goes to out/<car>_<lod>.glb.
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMaterialsTransmission, KHRMaterialsVolume, KHRMaterialsSpecular, KHRMaterialsIOR } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplifyPrimitive, compactPrimitive, join, textureCompress, transformPrimitive, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

const U = '/root/.claude/uploads/cd537e86-e984-516e-a089-79fd3da27a9e/';
const CARS = {
  porsche: {
    paint: /^paint$/,
    src: U + '3c5bec76-free_porsche_911_carrera_4s.glb',
    wheelbase: 2.45,
    // 'coat' is a dark alpha-blended shell over the paint (the clear coat is done by the game's paint material)
    classify: (chain, mat) => (/\/Plane\/Plane_0$/.test(chain) || mat === 'coat' ? 'drop' : /Cylinder\.00[01]_[012]$/.test(chain) ? 'wheel' : 'body'),
  },
  ferrari: {
    paint: /^Body$/,
    src: U + 'b8750ae2-ferrari_laferrari__www.vecarz.com.glb',
    wheelbase: 2.65,
    classify: (chain) => (/\/tire [1-4]_\d+\//.test(chain) ? 'wheel' : 'body'),
  },
  bugatti: {
    paint: /Paint_Material/,
    src: 'bugatti_fixed.glb',
    wheelbase: 2.75,
    classify: (chain, mat) => (/Calliper/i.test(chain) ? 'body' : /Combined_Wheels_3D/.test(chain) || /Wheel1A_3D_3DWheel1A/.test(mat) ? 'wheel' : 'body'),
  },
  lambo: {
    paint: /^vehicle_generic_smallspecmap_PRIMARY$/,
    keep: /^(material|przemo_l|hltex1_diff)$/, // lamp materials the game drives (must keep their names)
    src: U + '389aeeb5-lamborghini_fenomeno_2026.glb',
    wheelbase: 2.779,
    flip: true, // modelled facing -Z
    classify: (chain, mat) => (/caliper1_Caliper/i.test(chain) && /rims|tires|rotors/i.test(mat) ? 'wheel' : 'body'),
  },
  clk: {
    paint: /^$/,
    src: U + '5d111c29-1998_mercedes-benz_clk_lm_2.glb',
    wheelbase: 2.67,
    classify: (chain) => (/LOD_A_(TYRE|WHEEL|ROTOR)_/.test(chain) ? 'wheel' : 'body'),
  },
};
const LOD = {
  hi: { body: 90000, wheel: 6000, error: 0.0015, wheelErr: [0.008, 0.03], tex: 1024 },
  lo: { body: 11000, wheel: 700, error: 0.02, wheelErr: [0.02, 0.08], tex: 256 },
};

const [carId, lodId] = process.argv.slice(2);
const cfg = CARS[carId], lod = LOD[lodId];
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(cfg.src);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];

// ---------------------------------------------------------------- matrices (column-major)
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const trs = (tx, ty, tz, sc) => [sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, sc, 0, tx, ty, tz, 1];

// ---------------------------------------------------------------- collect primitives, baked to world space
const chainOf = (n) => { const out = []; let p = n; while (p && p.propertyType === 'Node') { out.unshift(p.getName()); p = p.getParentNode(); } return out.join('/'); };
const cloneDeep = (prim) => {
  const p = prim.clone();
  for (const sem of p.listSemantics()) p.setAttribute(sem, p.getAttribute(sem).clone());
  if (p.getIndices()) p.setIndices(p.getIndices().clone());
  for (const t of p.listTargets()) p.removeTarget(t);
  return p;
};
const items = [];
scene.traverse((node) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  const chain = chainOf(node);
  const W = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const mat = prim.getMaterial();
    const cls = cfg.classify(chain, mat ? mat.getName() : '');
    if (cls === 'drop') continue;
    const p = cloneDeep(prim);
    transformPrimitive(p, W);
    items.push({ prim: p, cls, chain });
  }
});

// ---------------------------------------------------------------- helpers over triangles
const triIndex = (prim) => {
  const idx = prim.getIndices();
  if (idx) return idx.getArray();
  const n = prim.getAttribute('POSITION').getCount();
  return Uint32Array.from({ length: n }, (_, i) => i);
};
const bboxOf = (prims) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) {
    const a = p.getAttribute('POSITION'), v = [0, 0, 0];
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; } }
  }
  return { mn, mx };
};
// new primitive holding only the given triangles (compacted vertex arrays)
const extract = (prim, tris) => {
  const idx = triIndex(prim);
  const remap = new Map();
  const order = [];
  const outIdx = new Uint32Array(tris.length * 3);
  let o = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const vi = idx[t * 3 + k];
    let ni = remap.get(vi);
    if (ni === undefined) { ni = order.length; remap.set(vi, ni); order.push(vi); }
    outIdx[o++] = ni;
  }
  const p = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(4);
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem), size = a.getElementSize();
    const src = a.getArray();
    const dst = new src.constructor(order.length * size);
    for (let i = 0; i < order.length; i++) for (let k = 0; k < size; k++) dst[i * size + k] = src[order[i] * size + k];
    p.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setNormalized(a.getNormalized()).setBuffer(root.listBuffers()[0]));
  }
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(outIdx).setBuffer(root.listBuffers()[0]));
  return p;
};
const applyAll = (M) => { for (const it of items) transformPrimitive(it.prim, M); };

// ---------------------------------------------------------------- orientation: length along Z, front +Z
{
  const b = bboxOf(items.map((i) => i.prim));
  if (b.mx[0] - b.mn[0] > b.mx[2] - b.mn[2]) applyAll(rotY(Math.PI / 2));
  if (cfg.flip) applyAll(rotY(Math.PI));
}

// ---------------------------------------------------------------- split wheel geometry into four wheels
const wheelItems = items.filter((i) => i.cls === 'wheel');
const wb0 = bboxOf(wheelItems.map((i) => i.prim));
const cx = (wb0.mn[0] + wb0.mx[0]) / 2, cz = (wb0.mn[2] + wb0.mx[2]) / 2;
const WHEELS = { FL: [], FR: [], RL: [], RR: [] };
for (const it of wheelItems) {
  const idx = triIndex(it.prim), pos = it.prim.getAttribute('POSITION');
  const groups = { FL: [], FR: [], RL: [], RR: [] };
  const v = [0, 0, 0];
  for (let t = 0; t < idx.length / 3; t++) {
    let x = 0, z = 0;
    for (let k = 0; k < 3; k++) { pos.getElement(idx[t * 3 + k], v); x += v[0]; z += v[2]; }
    x /= 3; z /= 3;
    groups[(z > cz ? 'F' : 'R') + (x > cx ? 'L' : 'R')].push(t);
  }
  for (const k of Object.keys(groups)) if (groups[k].length) WHEELS[k].push(extract(it.prim, groups[k]));
}
const wheelInfo = {};
for (const k of Object.keys(WHEELS)) {
  if (!WHEELS[k].length) throw new Error('no geometry for wheel ' + k);
  // un-steer: seen from above a tyre is longer (diameter) than wide; its principal axis gives the yaw
  // the model was posed with, which is rotated back out around the wheel's own centre
  const b0 = bboxOf(WHEELS[k]);
  const c0 = [(b0.mn[0] + b0.mx[0]) / 2, (b0.mn[2] + b0.mx[2]) / 2];
  let sxx = 0, szz = 0, sxz = 0;
  const v = [0, 0, 0];
  for (const p of WHEELS[k]) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); const dx = v[0] - c0[0], dz = v[2] - c0[1]; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; } }
  let yaw = 0.5 * Math.atan2(2 * sxz, szz - sxx); // angle of the long axis from +Z towards +X
  if (Math.abs(yaw) > 0.02 && Math.abs(yaw) < 0.6) {
    const R = mul(trs(c0[0], 0, c0[1], 1), mul(rotY(-yaw), trs(-c0[0], 0, -c0[1], 1)));
    for (const p of WHEELS[k]) transformPrimitive(p, R);
  } else yaw = 0;
  const b = bboxOf(WHEELS[k]);
  wheelInfo[k] = { c: [0, 1, 2].map((i) => (b.mn[i] + b.mx[i]) / 2), r: Math.max(b.mx[1] - b.mn[1], b.mx[2] - b.mn[2]) / 2, w: b.mx[0] - b.mn[0], ground: b.mn[1], yaw };
}
// the geometry stays centred on its own hub; the nodes go to symmetric axle positions
const sym = {};
for (const [l, r] of [['FL', 'FR'], ['RL', 'RR']]) {
  const L = wheelInfo[l].c, R = wheelInfo[r].c;
  const xm = (L[0] + R[0]) / 2, hx = (L[0] - R[0]) / 2, z = (L[2] + R[2]) / 2, y = (L[1] + R[1]) / 2;
  sym[l] = [xm + hx, y, z];
  sym[r] = [xm - hx, y, z];
}
if (process.env.DEBUG) for (const k of Object.keys(WHEELS)) { const b = bboxOf(WHEELS[k]); console.log('wheel', k, 'yaw', (wheelInfo[k].yaw * 57.3).toFixed(1), 'c', wheelInfo[k].c.map((x) => x.toFixed(3)).join(','), 'r', wheelInfo[k].r.toFixed(3), 'bbox', b.mn.map((x) => x.toFixed(2)).join(','), '..', b.mx.map((x) => x.toFixed(2)).join(','), 'prims', WHEELS[k].length); }
const zF = sym.FL[2], zR = sym.RL[2];
const xc = (sym.FL[0] + sym.FR[0] + sym.RL[0] + sym.RR[0]) / 4;
const ground = Math.min(...Object.values(wheelInfo).map((w) => w.ground));
const s = cfg.wheelbase ? cfg.wheelbase / (zF - zR) : 1;
const M = mul(trs(0, 0, 0, s), trs(-xc, -ground, -(zF + zR) / 2, 1));
const tp = (c) => [(c[0] - xc) * s, (c[1] - ground) * s, (c[2] - (zF + zR) / 2) * s];
const bodyPrims = items.filter((i) => i.cls === 'body').map((i) => i.prim);
for (const p of bodyPrims) transformPrimitive(p, M);
for (const k of Object.keys(WHEELS)) {
  const hub = tp(wheelInfo[k].c);
  for (const p of WHEELS[k]) transformPrimitive(p, mul(trs(-hub[0], -hub[1], -hub[2], 1), M));
  wheelInfo[k].c = tp(sym[k]);
  wheelInfo[k].r *= s;
  wheelInfo[k].w *= s;
}

// ---------------------------------------------------------------- new scene graph
for (const n of scene.listChildren()) scene.removeChild(n);
const body = doc.createNode('body').setMesh(doc.createMesh('body'));
for (const p of bodyPrims) body.getMesh().addPrimitive(p);
scene.addChild(body);
for (const k of Object.keys(WHEELS)) {
  const n = doc.createNode('wheel_' + k).setTranslation(wheelInfo[k].c).setMesh(doc.createMesh('wheel_' + k));
  for (const p of WHEELS[k]) n.getMesh().addPrimitive(p);
  scene.addChild(n);
}
for (const n of root.listNodes()) if (!['body', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].includes(n.getName())) n.dispose();

// ---------------------------------------------------------------- materials: no transmission/volume/specular (glass becomes alpha-blended)
for (const m of root.listMaterials()) {
  const tr = m.getExtension('KHR_materials_transmission');
  if (tr && tr.getTransmissionFactor() > 0) {
    const c = m.getBaseColorFactor();
    m.setAlphaMode('BLEND').setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 0.35)]);
  }
}
for (const E of [KHRMaterialsTransmission, KHRMaterialsVolume, KHRMaterialsSpecular, KHRMaterialsIOR]) doc.createExtension(E).dispose();
// three r128 only samples UV set 0: textures bound to another set are dropped rather than mis-mapped
for (const m of root.listMaterials()) {
  for (const [get, set] of [['getNormalTexture', 'setNormalTexture'], ['getOcclusionTexture', 'setOcclusionTexture'], ['getEmissiveTexture', 'setEmissiveTexture'], ['getMetallicRoughnessTexture', 'setMetallicRoughnessTexture'], ['getBaseColorTexture', 'setBaseColorTexture']]) {
    const info = m[get + 'Info']();
    if (m[get]() && info && info.getTexCoord() !== 0) m[set](null);
  }
}

// untextured materials → vertex colours on a few shared materials (grouped by roughness/metalness/alpha);
// three r128 can't read the second UV set palette() would use, so colours go into COLOR_0 instead
{
  const groups = new Map();
  const untextured = (m) => !(m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture() || m.getEmissiveTexture() || m.getOcclusionTexture());
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial();
    if (!m || !untextured(m) || cfg.paint.test(m.getName()) || (cfg.keep && cfg.keep.test(m.getName()))) continue;
    const e = m.getEmissiveFactor();
    if (e[0] + e[1] + e[2] > 0.01) continue; // lights keep their own material
    const c = m.getBaseColorFactor();
    const blend = m.getAlphaMode() === 'BLEND';
    const rq = Math.round(m.getRoughnessFactor() * 4) / 4, mq = Math.round(m.getMetallicFactor() * 2) / 2, aq = blend ? Math.round(c[3] * 4) / 4 : 1;
    const key = [m.getAlphaMode(), m.getDoubleSided(), rq, mq, aq].join('|');
    let g = groups.get(key);
    if (!g) {
      g = doc.createMaterial('merged_' + groups.size).setAlphaMode(m.getAlphaMode()).setDoubleSided(m.getDoubleSided()).setRoughnessFactor(rq).setMetallicFactor(mq).setBaseColorFactor([1, 1, 1, aq]);
      groups.set(key, g);
    }
    const pos = prim.getAttribute('POSITION'), n = pos.getCount();
    const old = prim.getAttribute('COLOR_0');
    const col = new Float32Array(n * 3);
    const tmp = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      let r = c[0], gg = c[1], bb = c[2];
      if (old) { old.getElement(i, tmp); r *= tmp[0]; gg *= tmp[1]; bb *= tmp[2]; }
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = bb;
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(root.listBuffers()[0]));
    for (const sem of prim.listSemantics()) if (sem.startsWith('TEXCOORD') || sem === 'TANGENT') prim.setAttribute(sem, null);
    prim.setMaterial(g);
  }
}
await doc.transform(
  dedup(),
  join({ keepMeshes: true, keepNamed: true }),
  weld(),
);
const primTris = (p) => (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
const meshTris = (m) => m.listPrimitives().reduce((a, p) => a + primTris(p), 0);
const count = () => root.listMeshes().reduce((s, m) => s + meshTris(m), 0);
// meshopt simplify with the Prune flag: small disconnected islands (tread blocks, bolts) may vanish
const pruneSimplify = (p, ratio, err) => {
  const pos = p.getAttribute('POSITION');
  const idx = Uint32Array.from(triIndex(p));
  if (idx.length < 6) return;
  const target = Math.min(idx.length, Math.max(3, Math.floor((idx.length * ratio) / 3) * 3));
  const [out] = MeshoptSimplifier.simplify(idx, pos.getArray(), 3, target, err, ['Prune']);
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(out)).setBuffer(root.listBuffers()[0]));
  compactPrimitive(p);
};
// vertex-clustering fallback for meshes the topology-preserving simplifier can't touch (unwelded treads)
const sloppySimplify = (p, ratio, err) => {
  const pos = p.getAttribute('POSITION');
  const idx = Uint32Array.from(triIndex(p));
  if (idx.length < 6) return;
  const target = Math.min(idx.length, Math.max(3, Math.floor((idx.length * ratio) / 3) * 3));
  const [out] = MeshoptSimplifier.simplifySloppy(idx, pos.getArray(), 3, null, target, err);
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(out)).setBuffer(root.listBuffers()[0]));
  compactPrimitive(p);
};
// body and each wheel get their own triangle budget (tyre treads would otherwise eat it)
for (const mesh of root.listMeshes()) {
  const isBody = mesh.getName() === 'body';
  const budget = isBody ? lod.body : lod.wheel;
  // wheels: prune tread blocks at a small tolerance first (keeps the tyre), then plain simplification
  const passes = isBody
    ? [['s', lod.error], ['s', lod.error * 6], ['p', lod.error * 20]]
    : [['p', lod.wheelErr[0]], ['s', lod.wheelErr[1]], ['x', lod.wheelErr[1]]];
  for (const [kind, err] of passes) {
    const t = meshTris(mesh);
    if (t <= budget * 1.05) break;
    for (const p of mesh.listPrimitives()) {
      if (kind === 's') simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: Math.min(1, budget / t), error: err, lockBorder: false });
      else if (kind === 'x') sloppySimplify(p, Math.min(1, budget / t), err);
      else pruneSimplify(p, Math.min(1, budget / t), err);
    }
  }
  // simplification can empty a primitive entirely; empty accessors break the meshopt encoder
  for (const p of mesh.listPrimitives()) if (primTris(p) < 1) { mesh.removePrimitive(p); p.dispose(); }
}
const tris = count();
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lod.tex, lod.tex], quality: 82 }),
  quantize(),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

const bb = getBounds(scene);
const meta = {
  id: carId,
  tris: Math.round(tris),
  materials: root.listMaterials().map((m) => m.getName()),
  wheelbase: +(wheelInfo.FL.c[2] - wheelInfo.RL.c[2]).toFixed(3),
  trackF: +(wheelInfo.FL.c[0] - wheelInfo.FR.c[0]).toFixed(3),
  trackR: +(wheelInfo.RL.c[0] - wheelInfo.RR.c[0]).toFixed(3),
  radiusF: +wheelInfo.FL.r.toFixed(3),
  radiusR: +wheelInfo.RL.r.toFixed(3),
  widthF: +wheelInfo.FL.w.toFixed(3),
  widthR: +wheelInfo.RL.w.toFixed(3),
  length: +(bb.max[2] - bb.min[2]).toFixed(3),
  width: +(bb.max[0] - bb.min[0]).toFixed(3),
  height: +bb.max[1].toFixed(3),
  front: +bb.max[2].toFixed(3),
  rear: +bb.min[2].toFixed(3),
  scale: +s.toFixed(4),
  parts: Object.fromEntries(root.listNodes().map((n) => [n.getName(), n.getMesh() ? n.getMesh().listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0) : 0])),
  drawCalls: root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0),
};
fs.mkdirSync('out', { recursive: true });
await io.write(`out/${carId}_${lodId}.glb`, doc);
fs.writeFileSync(`out/${carId}_${lodId}.json`, JSON.stringify(meta, null, 1));
const { materials: _m, ...brief } = meta;
console.log(carId, lodId, (fs.statSync(`out/${carId}_${lodId}.glb`).size / 1e6).toFixed(2) + 'MB', 'materials', meta.materials.length, JSON.stringify(brief));
