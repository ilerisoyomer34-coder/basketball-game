// Automated rule tests for the SHIFTBREAKER drivetrain (spec §16 acceptance criteria).
// Run: node shiftbreaker/tests/drivetrain.test.js
'use strict';
const { SB, makeSim, H } = require('./harness.js');
let passed = 0, failed = 0;
function check(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (info ? '  → ' + info : '')); }
}

function startEngine(sim) {
  sim.dt.input.ignition = true;
  sim.run(1.7);
  sim.dt.input.ignition = false;
  sim.run(0.5);
}

console.log('\nKontak & marş');
{
  const s = makeSim('lodos');
  startEngine(s);
  check('N + kontak → motor çalışır', s.dt.running, 'rpm ' + s.dt.rpm().toFixed(0));
  s.run(2);
  check('rölanti 750–950 rpm', s.dt.rpm() > 750 && s.dt.rpm() < 950, s.dt.rpm().toFixed(0));
}
{
  const s = makeSim('lodos');
  s.dt.input.clutch = 1;
  s.run(0.2);
  s.dt.requestGear(1);
  s.run(0.4);
  s.dt.input.clutch = 0;
  s.run(0.3);
  s.dt.input.ignition = true;
  s.run(1.7);
  s.dt.input.ignition = false;
  s.run(0.3);
  check('viteste + debriyajsız marş → sıçrar ve stop eder', !s.dt.running && s.has('jolt') && s.has('stall'), s.ev.map((e) => e.type).join(','));
}
{
  const s = makeSim('lodos');
  s.dt.input.clutch = 1;
  s.run(0.2);
  s.dt.requestGear(1);
  s.run(0.4);
  startEngine(s);
  check('viteste + debriyaj basılı → marş tutar', s.dt.running);
}

console.log('\nKalkış ve stop etme');
function launch(gear, releaseSec, throttle, stalling = true, car = 'lodos') {
  const s = makeSim(car, { stalling });
  startEngine(s);
  s.dt.input.clutch = 1;
  s.run(0.3);
  s.dt.requestGear(gear);
  s.run(0.5);
  s.dt.input.throttle = throttle;
  s.run(0.4);
  s.run(releaseSec, (t) => { s.dt.input.clutch = Math.max(0, 1 - t / releaseSec); });
  s.dt.input.clutch = 0;
  s.run(2.0);
  return s;
}
{
  const s = launch(1, 1.4, 0.25);
  check('1. viteste debriyaj yavaşça bırakılınca araç kalkar', s.dt.running && s.kmh() > 5, 'v=' + s.kmh().toFixed(1) + ' running=' + s.dt.running);
}
{
  const s = launch(1, 0.02, 0);
  check('1. viteste debriyaj aniden bırakılınca stop eder (stop etme açık)', !s.dt.running && s.has('stall'));
}
{
  const s = launch(1, 0.02, 0, false);
  check('stop etme kapalıyken motor stop etmez', s.dt.running && !s.has('stall'), 'rpm ' + s.dt.rpm().toFixed(0));
}
{
  const s = launch(3, 0.8, 0.3);
  check('3. viteste kalkış denemesi zorlanır ve stop eder', !s.dt.running && s.has('stall'), 'v=' + s.kmh().toFixed(1));
}

console.log('\nDebriyajsız vites ve dişli sürtme');
{
  const s = makeSim('lodos');
  s.place(3, 50);
  s.dt.input.throttle = 0;
  s.dt.requestGear(2, true);
  s.run(0.6);
  check('devri eşleşmeyen debriyajsız geçişte dişli sürter', s.has('grind') && s.dt.state === 'GRIND');
  check('vites girmez', s.dt.state !== 'ENG');
  s.dt.releaseHold();
  s.run(0.6);
  check('kol bırakılınca boşa düşer', s.dt.state === 'N');
}
{
  const s = makeSim('lodos');
  s.place(2, 40);
  s.run(0.2);
  // engine rpm in 2nd at 40 km/h ≈ 2800; target 3rd ≈ 1930 → let revs fall, then shift on match
  s.dt.input.throttle = 0;
  s.dt.leaveGear();
  s.dt.state = 'N';
  let engaged = false;
  for (let i = 0; i < 600 && !engaged; i++) {
    if (Math.abs(s.dt.rpm() - s.dt.rpmInGear(3)) < 150 && s.dt.state === 'N') s.dt.requestGear(3, true);
    s.step();
    engaged = s.dt.state === 'ENG' && s.dt.gear === 3;
  }
  check('devir eşleşince debriyajsız geçiş olur', engaged);
}

console.log('\nR (geri vites) kuralları');
{
  const s = makeSim('lodos');
  s.place(3, 50);
  s.dt.input.clutch = 1;
  s.run(0.1);
  s.dt.requestGear(-1, true);
  s.run(0.5);
  check('50 km/s ileri giderken R: sürtme sesi, vites girmez', s.has('grind') && s.dt.state === 'GRIND');
  s.run(1.6);
  check('ısrarla zorlanırsa şanzıman hasarı oluşur', s.has('gearboxBreak') && s.dt.gearHealth['-1'] === 0 && s.dt.health.gearbox < 0.7, JSON.stringify(s.dt.health));
  check('motor patlamaz', !s.dt.exploded && !s.has('explode'));
}
{
  const s = makeSim('lodos');
  startEngine(s);
  s.dt.input.clutch = 1;
  s.run(0.2);
  s.dt.requestGear(-1, true);
  s.run(0.5);
  check('araç dururken debriyajla R temiz girer', s.dt.state === 'ENG' && s.dt.gear === -1);
}
{
  const s = makeSim('lodos');
  s.place(2, 10);
  s.dt.input.clutch = 1;
  s.run(0.1);
  s.dt.requestGear(-1, true);
  s.run(1.4);
  check('3–15 km/s R ısrarı: klank sesiyle girer, motor stop eder', s.has('clank') && s.dt.gear === -1 && !s.dt.running);
}

console.log('\nİmza mekaniği: 6→1 / 6→R');
function sixTo(target, kmh, opts) {
  const s = makeSim('lodos', opts);
  s.place(6, kmh);
  s.run(0.1);
  s.dt.input.clutch = 1;
  s.run(0.1);
  s.dt.requestGear(target, true);
  s.run(0.6);
  return s;
}
{
  let all = true;
  for (let i = 0; i < 5; i++) { const s = sixTo(1, 40); if (!s.has('explode')) all = false; }
  check('6. viteste 40 km/s’de 6→1: patlama her seferinde tetiklenir', all);
  const s39 = sixTo(1, 39);
  check('39 km/s’de tetiklenmez', !s39.has('explode'));
  const r = sixTo(-1, 12);
  check('6→R 12 km/s: patlar (eşik 10)', r.has('explode'));
  const r9 = sixTo(-1, 9);
  check('6→R 9 km/s: patlamaz', !r9.has('explode'));
  const any = sixTo(1, 5, { explosion: { enabled: true, thr61: 0, thr6R: 0 } });
  check('"her hızda patla": eşik 0', any.has('explode'));
  const off = sixTo(1, 90, { explosion: { enabled: false } });
  check('patlama kuralı kapalıyken patlamaz', !off.has('explode'));
}
{
  const s = makeSim('lodos');
  s.place(6, 60);
  s.dt.input.clutch = 1;
  s.run(0.1);
  s.dt.requestGear(0, true);
  s.run(2.3);
  s.dt.requestGear(1, true);
  s.run(0.5);
  check('6→N, 2 s’den uzun bekleyip 1: patlamaz', !s.has('explode'), s.kmh().toFixed(1));
}
{
  const s = makeSim('lodos');
  s.place(6, 100);
  s.dt.input.clutch = 1;
  s.run(0.1);
  s.dt.requestGear(5, true);
  s.run(0.4);
  s.dt.input.clutch = 0;
  s.run(0.3);
  s.dt.input.clutch = 1;
  s.run(0.1);
  s.dt.requestGear(1, true);
  s.run(0.4);
  check('6→5→1 (araya vites girerek): patlama olmaz', !s.has('explode'));
  s.dt.input.clutch = 0;
  s.run(0.5);
  check('6→5→1: aşırı devir hasarı hesaplanır', s.has('seize') || s.has('engineDamage'), s.ev.map((e) => e.type).join(','));
}
console.log('\nSekansiyel mod');
function seqDown(carId, spacing, kmh, opts) {
  const s = makeSim(carId, Object.assign({ shifter: 'SEQ' }, opts || {}));
  s.place(6, kmh);
  s.run(0.1);
  for (let i = 0; i < 5; i++) { s.dt.shiftDown(true); s.run(spacing); }
  s.run(0.3);
  return s;
}
{
  const fast = seqDown('poyraz', 0.22, 70);
  check('sekansiyel 6→1, 1.5 s içinde: patlama', fast.has('explode'));
  const slow = seqDown('poyraz', 0.5, 110);
  check('sekansiyel 2 s’de yavaşça düşürme: patlama yok', !slow.has('explode'));
  check('… yalnızca devre bağlı hasar', slow.has('seize') || slow.has('engineDamage') || slow.has('valveFloat'), slow.ev.map((e) => e.type).join(','));
  const hSeq = seqDown('lodos', 0.2, 60, { autoClutch: true });
  check('H araç, sekansiyel + otomatik debriyaj: 6→1 hızlı → patlama', hSeq.has('explode'));
}

console.log('\nAşırı devir kademeleri');
function moneyShift(from, to, kmh) {
  const s = makeSim('lodos');
  s.place(from, kmh);
  s.dt.input.clutch = 1;
  s.run(0.1);
  s.dt.requestGear(to, true);
  s.run(0.4);
  s.dt.input.clutch = 0;
  s.run(0.3);
  return s;
}
{
  const a = moneyShift(4, 2, 120);
  check('120 km/s 4→2 → orta hasar', a.has('engineDamage') && a.dt.health.engine < 0.9 && !a.dt.seized, a.ev.map((e) => e.type).join(','));
  const b = moneyShift(6, 2, 150);
  check('150 km/s 6→2 → motor kilitlenir', b.has('seize') && b.dt.seized);
  const c = moneyShift(5, 4, 100);
  check('100 km/s 5→4 → hasar yok', !c.has('engineDamage') && !c.has('seize') && c.dt.health.engine > 0.99);
}

console.log('\nYokuş kalkışı');
{
  const s = makeSim('lodos');
  startEngine(s);
  s.slope = Math.atan(0.1);
  s.run(2.0);
  check('eğimde fren bırakılınca araç geri kayar', s.v < -0.5, s.kmh().toFixed(2));
}
{
  const s = makeSim('lodos');
  startEngine(s);
  s.slope = Math.atan(0.1);
  s.handbrake = 1;
  s.dt.input.clutch = 1;
  s.run(0.3);
  s.dt.requestGear(1, true);
  s.run(0.4);
  check('el freni aracı tutar', Math.abs(s.v) < 0.05);
  s.dt.input.throttle = 0.35;
  s.run(1.3, (t) => { s.dt.input.clutch = Math.max(0.42, 1 - t / 1.0); });
  s.handbrake = 0;
  s.run(1.0, (t) => { s.dt.input.clutch = Math.max(0, 0.42 - t / 1.0); });
  s.run(1.0);
  check('el freni + yarım debriyaj ile kalkış yapılabilir', s.v > 1 && s.dt.running, 'v=' + s.kmh().toFixed(1) + ' running ' + s.dt.running);
}

console.log('\nOtomatik debriyaj');
{
  const s = makeSim('lodos', { autoClutch: true });
  startEngine(s);
  s.dt.requestGear(1, true);
  s.run(0.5);
  s.dt.input.throttle = 0.4;
  s.run(3);
  check('otomatik debriyajla kalkış (stop yok)', s.dt.running && s.kmh() > 15, s.kmh().toFixed(1));
  s.dt.input.throttle = 0;
  s.dt.requestGear(2, true);
  s.run(0.6);
  check('otomatik debriyajla vites geçişi temiz', s.dt.state === 'ENG' && s.dt.gear === 2 && !s.has('grind'));
  s.sim = null;
  s.brake = 1;
  s.run(4);
  check('otomatik debriyaj frenle durunca stop ettirmez', s.dt.running && Math.abs(s.v) < 0.2);
}

console.log(`\n${passed} geçti, ${failed} kaldı`);
process.exit(failed ? 1 : 0);
