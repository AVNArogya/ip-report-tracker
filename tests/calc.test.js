const test = require('node:test');
const assert = require('node:assert');
const Calc = require('../web/calc.js');

const cats = Calc.defaultCategories();
const WALK = Calc.SOURCES[0], VIRTUAL = Calc.SOURCES[1], CORP = Calc.SOURCES[2];

function admit(id, room, admission, extra) {
  return Object.assign({ id, name: 'P' + id, source: WALK, type: 'admission', visitDate: admission, admission, room, extensions: [] }, extra || {});
}

test('room categories match the room list', () => {
  const idx = Calc.roomIndex(cats);
  assert.strictEqual(idx.total, 64);
  assert.strictEqual(idx.inHouse, 56);
  assert.deepStrictEqual(idx.duplicates, []);
  assert.deepStrictEqual(cats.map(c => c.rooms.length), [12, 7, 24, 2, 6, 4, 1, 6, 2]);
  assert.strictEqual(idx.byRoom['J 10'].name, 'Economy');
  assert.strictEqual(idx.byRoom['2'].name, 'Hotel rooms');
  assert.deepStrictEqual(Calc.blocksOf(cats), ['J', 'S', 'SW']);
});

test('columns start with the report layout', () => {
  const labels = Calc.columns(cats).map(c => c.label);
  assert.deepStrictEqual(labels.slice(0, 32), [
    'Date', 'Walk-in (PCE)', 'Virtual (tele)', 'Corporate', 'Clinic referral (AVN clinics)', 'Other (patient referral)',
    'Admitted: total', 'Before plan', 'Discharged: total', 'Stays extended today', 'Patients in house (end of day)',
    'Plan: patients in house (KR)', 'Economy (of 12)', 'Executive JF (of 7)', 'Executive S (of 24)', 'Deluxe (of 2)',
    'Classic villa (of 6)', 'Deluxe villa (of 4)', 'Royal villa (of 1)', 'J block', 'S block', 'SW block',
    'In-house rooms occupied', 'In-house rooms vacant and available', 'In-house occupancy',
    'Apartment rooms in use (of 6)', 'Hotel rooms in use (of 2)', 'Patients sharing a room', 'Discharges confirmed',
    'Planned admissions: walk-in', 'Planned admissions: virtual', 'Planned admissions: corporate / clinic / other'
  ]);
});

test('admission, occupancy and discharge by date', () => {
  const patients = [
    admit('1', 'J 1', '2026-10-10', { plannedDischarge: '2026-10-13', discharge: '2026-10-12' }),
    admit('2', '101', '2026-10-10', { source: VIRTUAL }),
    admit('3', '131', '2026-10-11', { source: CORP })
  ];
  const d10 = Calc.day('2026-10-10', cats, patients, [], {});
  assert.strictEqual(d10.admitted, 2);
  assert.strictEqual(d10['src:' + WALK], 1);
  assert.strictEqual(d10['src:' + VIRTUAL], 1);
  assert.strictEqual(d10['adm:Economy'], 1);
  assert.strictEqual(d10['adm:Executive (S block)'], 1);
  assert.strictEqual(d10['occ:Economy'], 1);
  assert.strictEqual(d10.inHouseOccupied, 2);
  assert.strictEqual(d10.inHouseAvailable, 54);
  assert.strictEqual(d10.totalOccupied, 2);
  assert.strictEqual(d10.totalAvailable, 62);

  const d11 = Calc.day('2026-10-11', cats, patients, [], {});
  assert.strictEqual(d11.admitted, 1);
  assert.strictEqual(d11['occ:Apartment rooms'], 1);
  assert.strictEqual(d11.inHouseOccupied, 2);
  assert.strictEqual(d11.totalOccupied, 3);
  assert.strictEqual(d11.dischargesConfirmed, 0);

  // Discharged on the 12th, the day before the planned 13th: counted on the 12th only.
  const d12 = Calc.day('2026-10-12', cats, patients, [], {});
  assert.strictEqual(d12.discharged, 1);
  assert.strictEqual(d12['occ:Economy'], 0);
  assert.strictEqual(d12.inHousePatients, 2);
  assert.strictEqual(d12.totalAvailable, 62);
  assert.strictEqual(Calc.day('2026-10-13', cats, patients, [], {}).discharged, 0);
});

test('same-day admission and discharge', () => {
  const v = Calc.day('2026-10-05', cats, [admit('1', 'J 2', '2026-10-05', { discharge: '2026-10-05' })], [], {});
  assert.strictEqual(v.admitted, 1);
  assert.strictEqual(v.discharged, 1);
  assert.strictEqual(v.inHousePatients, 0);
  assert.strictEqual(v.totalOccupied, 0);
});

test('sharing, extensions, planned discharges and bookings', () => {
  const patients = [
    admit('1', '501', '2026-10-01', { plannedDischarge: '2026-10-04', extensions: ['2026-10-03'] }),
    admit('2', '501', '2026-10-02', { plannedDischarge: '2026-10-04' }),
    { id: '3', name: 'B', source: VIRTUAL, type: 'booking', visitDate: '2026-10-01', plannedAdmission: '2026-10-04' },
    { id: '4', name: 'C', source: CORP, type: 'booking', visitDate: '2026-10-01', plannedAdmission: '2026-10-04' },
    { id: '5', name: 'W', source: WALK, type: 'visit', visitDate: '2026-10-03' },
    admit('6', 'J 3', '2026-10-03', { plannedAdmission: '2026-10-06' })
  ];
  const v = Calc.day('2026-10-03', cats, patients, [], { '2026-10-03': 55.5 });
  assert.strictEqual(v.sharing, 2);
  assert.strictEqual(v['occ:Classic villa'], 1);
  assert.strictEqual(v.inHousePatients, 3);
  assert.strictEqual(v.totalOccupied, 2);
  assert.strictEqual(v.extended, 1);
  assert.strictEqual(v.dischargesConfirmed, 2);
  assert.strictEqual(v.plannedVirtual, 1);
  assert.strictEqual(v.plannedOther, 1);
  assert.strictEqual(v.walkInVisits, 2); // the visit and the walk-in admitted that day
  assert.strictEqual(v.beforePlan, 1);
  assert.strictEqual(v.plan, 55.5);
});

test('out of service rooms by block', () => {
  const blocks = [{ room: 'J 4', from: '2026-10-01', until: '2026-10-02' }, { room: '601', from: '2026-10-02' }, { room: '1', from: '2026-10-02' }];
  const v = Calc.day('2026-10-02', cats, [], blocks, {});
  assert.strictEqual(v['oosBlock:J'], 1);
  assert.strictEqual(v['oosBlock:SW'], 1);
  assert.strictEqual(v['oos:Hotel rooms'], 1);
  assert.strictEqual(v.inHouseAvailable, 54);
  assert.strictEqual(v.totalOutOfService, 3);
  assert.strictEqual(v.totalAvailable, 61);
  assert.strictEqual(Calc.day('2026-10-03', cats, [], blocks, {})['oosBlock:J'], 0);
});

test('report runs from the opening date to today', () => {
  assert.deepStrictEqual(Calc.report(cats, [], [], {}, '2026-10-22').dates, []);
  const r = Calc.report(cats, [admit('1', 'J 1', '2026-10-20', { discharge: '2026-10-25' })], [], {}, '2026-10-22');
  assert.strictEqual(r.dates[0], '2026-09-30'); // starts at the opening balance
  assert.strictEqual(r.dates[r.dates.length - 1], '2026-10-25');
  assert.strictEqual(r.days[22].inHousePatients, 1);
});

test('checkPatient catches double booking and allows sharing', () => {
  const others = [admit('1', 'J 1', '2026-10-10')];
  const clash = Calc.checkPatient({ name: 'X', source: WALK, type: 'admission', admission: '2026-10-12', room: 'J 1' }, others, cats, []);
  assert.match(clash.errors.join(' '), /occupied/);
  const shared = Calc.checkPatient({ name: 'X', source: WALK, type: 'admission', admission: '2026-10-12', room: 'J 1', share: true }, others, cats, []);
  assert.deepStrictEqual(shared.errors, []);
  assert.strictEqual(shared.patient.visitDate, '2026-10-12');
  const after = Calc.checkPatient({ name: 'X', source: WALK, type: 'admission', admission: '2026-10-12', room: 'J 1' },
    [admit('1', 'J 1', '2026-10-10', { discharge: '2026-10-12' })], cats, []);
  assert.deepStrictEqual(after.errors, []);
  const bad = Calc.checkPatient({ name: 'X', source: WALK, type: 'admission', admission: '2026-10-12', room: 'Z9' }, [], cats, []);
  assert.match(bad.errors.join(' '), /not in the Room Categories/);
  const oos = Calc.checkPatient({ name: 'X', source: WALK, type: 'admission', admission: '2026-10-12', room: 'J 5' }, [], cats, [{ room: 'J 5', from: '2026-10-11', until: '2026-10-12' }]);
  assert.match(oos.errors.join(' '), /out of service/);
});

test('toIso reads dates', () => {
  assert.strictEqual(Calc.toIso('5/10/2026'), '2026-10-05');
  assert.strictEqual(Calc.toIso('2026-10-05T00:00:00Z'), '2026-10-05');
  assert.strictEqual(Calc.toIso(new Date(2026, 9, 5)), '2026-10-05');
  assert.strictEqual(Calc.toIso(''), null);
});

test('opening balance: 49 patients in 47 rooms carried forward from 30 Sep', () => {
  const all = Calc.roomIndex(cats);
  const rooms = Object.keys(all.byRoom).filter(r => !['131', '132', '137', '138', '139', '140', '1', '2'].includes(r)).slice(0, 47);
  const save = rooms.map(room => ({ type: 'admission', admission: '2026-09-30', room, source: '', share: ['J 1', 'J 2'].includes(room) }));
  save.push({ type: 'admission', admission: '2026-09-30', room: 'J 1', share: true }, { type: 'admission', admission: '2026-09-30', room: 'J 2', share: true });
  const batch = Calc.checkBatch(save, [], [], cats, []);
  assert.deepStrictEqual(batch.errors, []);
  assert.strictEqual(batch.saved.find(p => p.room === 'J 1').name, 'Carried forward (J 1)');
  const patients = batch.saved.map((p, i) => Object.assign(p, { id: 'c' + i }));

  const sep30 = Calc.day('2026-09-30', cats, patients, [], {});
  assert.strictEqual(sep30.inHousePatients, 49);
  assert.strictEqual(sep30.totalOccupied, 47);
  assert.strictEqual(sep30.totalAvailable, 17);
  assert.strictEqual(sep30.sharing, 4);
  assert.strictEqual(sep30.admitted, 0, 'carried-forward patients are not admissions');

  // 1 Oct: one admission to a free room, one carried-forward patient discharged.
  patients.push({ id: 'n1', name: 'New', source: WALK, type: 'admission', visitDate: '2026-10-01', admission: '2026-10-01', room: '131', extensions: [] });
  patients[5].discharge = '2026-10-01';
  const oct1 = Calc.day('2026-10-01', cats, patients, [], {});
  assert.strictEqual(oct1.admitted, 1);
  assert.strictEqual(oct1.discharged, 1);
  assert.strictEqual(oct1.inHousePatients, 49);
  assert.strictEqual(oct1.totalOccupied, 47);
  assert.strictEqual(oct1['occ:Apartment rooms'], 1);
  assert.strictEqual(Calc.report(cats, patients, [], {}, '2026-10-22').dates[0], '2026-09-30');

  // A second patient in an occupied room without "sharing" is refused.
  const clash = Calc.checkBatch([{ type: 'admission', admission: '2026-09-30', room: rooms[10] }], [], patients, cats, []);
  assert.match(clash.errors.join(' '), /occupied/);
});
