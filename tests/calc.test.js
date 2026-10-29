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
  assert.strictEqual(idx.byRoom['172'].name, 'Hotel rooms');
  assert.deepStrictEqual(Calc.blocksOf(cats), ['J', 'S', 'SW']);
});

test('columns start with the report layout', () => {
  const labels = Calc.columns(cats).map(c => c.label);
  assert.deepStrictEqual(labels.slice(0, 33), [
    'Date', 'Walk-in (PCE)', 'Virtual (tele)', 'Corporate', 'Clinic referral (AVN clinics)', 'Other (patient referral)',
    'Admitted: total', 'As planned', 'Before plan', 'Discharged: total', 'Stays extended today', 'Patients in house (end of day)',
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
  assert.strictEqual(d10['occ:Economy'], 11); // 10 from 30 Sep + 1
  // Every total includes the 49 patients in 47 rooms from 30 Sep (45 in-house, 2 apartment).
  assert.strictEqual(d10.inHouseOccupied, 48);
  assert.strictEqual(d10.inHouseAvailable, 8);
  assert.strictEqual(d10.totalOccupied, 49);
  assert.strictEqual(d10.totalAvailable, 15);

  const d11 = Calc.day('2026-10-11', cats, patients, [], {});
  assert.strictEqual(d11.admitted, 1);
  assert.strictEqual(d11['occ:Apartment rooms'], 2);
  assert.strictEqual(d11.inHouseOccupied, 48);
  assert.strictEqual(d11.totalOccupied, 50);
  assert.strictEqual(d11.dischargesConfirmed, 0);

  // Discharged on the 12th, the day before the planned 13th: counted on the 12th only.
  const d12 = Calc.day('2026-10-12', cats, patients, [], {});
  assert.strictEqual(d12.discharged, 1);
  assert.strictEqual(d12['occ:Economy'], 10);
  assert.strictEqual(d12.inHousePatients, 51);
  assert.strictEqual(d12.totalAvailable, 15);
  assert.strictEqual(Calc.day('2026-10-13', cats, patients, [], {}).discharged, 0);
});

test('same-day admission and discharge', () => {
  const v = Calc.day('2026-10-05', cats, [admit('1', 'J 2', '2026-10-05', { discharge: '2026-10-05' })], [], {});
  assert.strictEqual(v.admitted, 1);
  assert.strictEqual(v.discharged, 1);
  assert.strictEqual(v.inHousePatients, 49);
  assert.strictEqual(v.totalOccupied, 47);
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
  assert.strictEqual(v.sharing, 3); // 2 from 30 Sep + the second patient in 501
  assert.strictEqual(v['occ:Classic villa'], 5);
  assert.strictEqual(v.inHousePatients, 52);
  assert.strictEqual(v.totalOccupied, 49);
  assert.strictEqual(v.extended, 1);
  assert.strictEqual(v.dischargesConfirmed, 2);
  // Bookings planned for 4 Oct count on 4 Oct only, not on the days before.
  assert.strictEqual(v.plannedVirtual + v.plannedOther, 0);
  const v4 = Calc.day('2026-10-04', cats, patients, [], {});
  assert.strictEqual(v4.plannedVirtual, 1);
  assert.strictEqual(v4.plannedOther, 1);
  assert.strictEqual(v.walkInVisits, 2); // the visit and the walk-in admitted that day
  assert.strictEqual(v.beforePlan, 1);
  assert.strictEqual(v.asPlanned, 0);
  const onDate = Calc.day('2026-10-06', cats, [admit('7', 'J 4', '2026-10-06', { plannedAdmission: '2026-10-06' })], [], {});
  assert.strictEqual(onDate.asPlanned, 1);
  assert.strictEqual(onDate.beforePlan, 0);
  assert.strictEqual(v.plan, 55.5);
});

test('out of service rooms by block', () => {
  const blocks = [{ room: 'J 4', from: '2026-10-01', until: '2026-10-02' }, { room: '601', from: '2026-10-02' }, { room: '171', from: '2026-10-02' }];
  const v = Calc.day('2026-10-02', cats, [], blocks, {});
  assert.strictEqual(v['oosBlock:J'], 1);
  assert.strictEqual(v['oosBlock:SW'], 1);
  assert.strictEqual(v['oos:Hotel rooms'], 1);
  assert.strictEqual(v.inHouseAvailable, 8);
  assert.strictEqual(v.totalOutOfService, 3);
  assert.strictEqual(v.totalAvailable, 14);
  assert.strictEqual(Calc.day('2026-10-03', cats, [], blocks, {})['oosBlock:J'], 0);
});

test('report runs from 30 Sep to today', () => {
  const empty = Calc.report(cats, [], [], {}, '2026-10-22');
  assert.strictEqual(empty.dates.length, 23);
  assert.strictEqual(empty.days[0].inHousePatients, 49);
  const r = Calc.report(cats, [admit('1', 'J 1', '2026-10-20', { discharge: '2026-10-25' })], [], {}, '2026-10-22');
  assert.strictEqual(r.dates[0], '2026-09-30');
  assert.strictEqual(r.dates[r.dates.length - 1], '2026-10-25');
  assert.strictEqual(r.days[22].inHousePatients, 50);
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

test('fixed 30 Sep position: 49 patients in 47 rooms, entries from 1 Oct', () => {
  const sep30 = Calc.day('2026-09-30', cats, [], [], {});
  assert.strictEqual(sep30.inHousePatients, 49);
  assert.strictEqual(sep30.totalOccupied, 47);
  assert.strictEqual(sep30.totalRooms, 64);
  assert.strictEqual(sep30.totalAvailable, 17);
  assert.strictEqual(sep30.admitted, 0);

  const patients = [
    admit('1', '131', '2026-10-01'),
    // Two of the 49 leave on 2 Oct: one frees a room, the other was sharing so the room stays occupied.
    { id: 'c1', type: 'carried', name: 'A', discharge: '2026-10-02', room: 'J 5', roomFreed: 'Yes' },
    { id: 'c2', type: 'carried', name: 'B', discharge: '2026-10-02', roomFreed: 'No' }
  ];
  const oct1 = Calc.day('2026-10-01', cats, patients, [], {});
  assert.strictEqual(oct1.admitted, 1);
  assert.strictEqual(oct1.inHousePatients, 50);
  assert.strictEqual(oct1.totalOccupied, 48);
  assert.strictEqual(oct1.totalAvailable, 16);
  const oct2 = Calc.day('2026-10-02', cats, patients, [], {});
  assert.strictEqual(oct2.discharged, 2);
  assert.strictEqual(oct2.inHousePatients, 48);
  assert.strictEqual(oct2.totalOccupied, 47);
  assert.strictEqual(oct2.inHouseOccupied, 45);
  assert.strictEqual(oct2['occ:Economy'], 9); // J 5 vacated
  assert.strictEqual(oct2.sharing, 1);
  assert.strictEqual(oct2.totalAvailable, 17);

  assert.match(Calc.checkPatient({ name: 'X', source: WALK, type: 'admission', admission: '2026-09-29', room: 'J 1' }, [], cats, []).errors.join(' '), /starting figures/);
  assert.match(Calc.checkPatient({ type: 'carried', discharge: '2026-10-05', roomFreed: true }, [], cats, []).errors.join(' '), /Choose the room/);
  const c = Calc.checkPatient({ type: 'carried', discharge: '2026-10-05', room: '102', roomFreed: true }, [], cats, []);
  assert.deepStrictEqual(c.errors, []);
  assert.strictEqual(c.patient.roomFreed, 'Yes');
  assert.match(Calc.checkPatient({ type: 'carried', discharge: '2026-09-30' }, [], cats, []).errors.join(' '), /after/);
});

test('Room Categories typed as one row per room', () => {
  const rows = [['Category', 'Room', '', '', '']];
  Calc.DEFAULT_CATEGORIES.forEach(d => Calc.splitRooms(d[4]).forEach(r => rows.push([d[0], r, '', '', ''])));
  const parsed = Calc.parseCategories(rows);
  assert.deepStrictEqual(parsed, cats);
  assert.strictEqual(Calc.roomIndex(parsed).total, 64);
  assert.deepStrictEqual(Calc.categoryRows(parsed), Calc.DEFAULT_CATEGORIES);
});

test('30 Sep starting figures match the old Daily IP Report', () => {
  const v = Calc.day('2026-09-30', cats, [], [], {});
  assert.deepStrictEqual(cats.map(c => v['occ:' + c.name]), [10, 6, 22, 1, 4, 2, 1, 1, 0]);
  assert.strictEqual(v.inHouseOccupied, 46);
  assert.strictEqual(v.totalOccupied, 47);
  assert.strictEqual(v.sharing, 2);
  assert.strictEqual(v.inHousePatients, 49);
  // 1 Oct: two admissions into Economy and one into Executive S are added to 30 Sep.
  const p = [admit('a', 'J 1', '2026-10-01'), admit('b', 'J 2', '2026-10-01'), admit('c', '101', '2026-10-01')];
  const o1 = Calc.day('2026-10-01', cats, p, [], {});
  assert.strictEqual(o1['occ:Economy'], 12);
  assert.strictEqual(o1['occ:Executive (S block)'], 23);
  assert.strictEqual(o1.inHousePatients, 52);
  assert.strictEqual(o1['adm:Economy'], 2);
  // ...and they are still counted on 2 Oct (cumulative), with nothing new entered.
  assert.strictEqual(Calc.day('2026-10-02', cats, p, [], {})['occ:Economy'], 12);
});

test('three or more patients can share a room when sharing is ticked', () => {
  const two = [admit('1', '601', '2026-10-05'), admit('2', '601', '2026-10-05')];
  const third = Calc.checkPatient({ name: 'C', source: WALK, type: 'admission', admission: '2026-10-06', room: '601', share: true }, two, cats, []);
  assert.deepStrictEqual(third.errors, []);
  const noTick = Calc.checkPatient({ name: 'C', source: WALK, type: 'admission', admission: '2026-10-06', room: '601' }, two, cats, []);
  assert.match(noTick.errors.join(' '), /Tick "sharing a room"/);
  const v = Calc.day('2026-10-06', cats, two.concat(admit('3', '601', '2026-10-06')), [], {});
  assert.strictEqual(v['occ:Deluxe villa'], 2 + 1);   // 2 from 30 Sep + room 601 once
  assert.strictEqual(v.sharing, 2 + 2);               // 2 from 30 Sep + 2 extra patients in 601
});

test('room change JF1 → JF2 moves the room count on the change date, not the admission', () => {
  const p = admit('p1', 'JF1', '2026-10-10', { plannedDischarge: '2026-10-20' });
  const move = { id: 'p1/move/1', type: 'move', name: 'P', room: 'JF2', visitDate: '2026-10-15' };
  const res = Calc.checkPatient(move, [p], cats, []);
  assert.deepStrictEqual(res.errors, []);
  const list = [p, res.patient];
  const before = Calc.day('2026-10-14', cats, list, [], {});
  const moved = Calc.day('2026-10-15', cats, list, [], {});
  const without = Calc.day('2026-10-15', cats, [p], [], {});
  // Same totals as with no room change; same category here (JF1 and JF2 are both Executive JF).
  ['admitted', 'discharged', 'inHousePatients', 'totalOccupied', 'inHouseOccupied', 'occ:Executive (J block)'].forEach(k => assert.strictEqual(moved[k], without[k], k));
  assert.strictEqual(moved.admitted, 0);
  assert.strictEqual(Calc.day('2026-10-10', cats, list, [], {}).admitted, 1);
  assert.strictEqual(Calc.day('2026-10-10', cats, list, [], {})['adm:Executive (J block)'], 1);
  // Room board: JF1 on the 14th, JF2 from the 15th.
  const room = (d, r) => Calc.roomBoard(d, cats, list, []).find(x => x.room === r).patients.length;
  assert.deepStrictEqual([room('2026-10-14', 'JF1'), room('2026-10-14', 'JF2'), room('2026-10-15', 'JF1'), room('2026-10-15', 'JF2')], [1, 0, 0, 1]);
  assert.strictEqual(before.inHousePatients, moved.inHousePatients);
});

test('room change to another category: old category down, new category up from that date', () => {
  const p = admit('p1', 'J 3', '2026-10-10');
  const list = [p, { id: 'p1/move/1', type: 'move', name: 'P', room: '101', visitDate: '2026-10-12' }];
  const d11 = Calc.day('2026-10-11', cats, list, [], {}), d12 = Calc.day('2026-10-12', cats, list, [], {});
  assert.strictEqual(d11['occ:Economy'], 11); assert.strictEqual(d11['occ:Executive (S block)'], 22);
  assert.strictEqual(d12['occ:Economy'], 10); assert.strictEqual(d12['occ:Executive (S block)'], 23);
  assert.strictEqual(d12.admitted, 0); assert.strictEqual(d12.discharged, 0);
  assert.strictEqual(d12['adm:Executive (S block)'], 0);
  assert.strictEqual(d11.totalOccupied, d12.totalOccupied);
  // The freed room can take a new patient from the 12th; the new room is taken.
  assert.deepStrictEqual(Calc.checkPatient({ name: 'N', source: WALK, type: 'admission', admission: '2026-10-12', room: 'J 3' }, list, cats, []).errors, []);
  assert.match(Calc.checkPatient({ name: 'N', source: WALK, type: 'admission', admission: '2026-10-12', room: '101' }, list, cats, []).errors.join(' '), /occupied/);
});

test('room change checks', () => {
  const p = admit('p1', 'J 3', '2026-10-10', { discharge: '2026-10-14' });
  const q = admit('q1', '101', '2026-10-10');
  const chk = m => Calc.checkPatient(Object.assign({ type: 'move', id: 'p1/move/1' }, m), [p, q], cats, []).errors.join(' ');
  assert.match(chk({ room: 'J 4', visitDate: '2026-10-10' }), /after the admission date/);
  assert.match(chk({ room: 'J 4', visitDate: '2026-10-14' }), /not in house/);
  assert.match(chk({ room: 'J 3', visitDate: '2026-10-12' }), /already in room/);
  assert.match(chk({ room: '101', visitDate: '2026-10-12' }), /Tick "sharing a room"/);
  assert.strictEqual(chk({ room: '101', visitDate: '2026-10-12', share: true }), '');
  assert.match(chk({ room: 'J 4', visitDate: '2026-10-12', id: 'zz/move/1' }), /Choose the patient/);
});

test('30 Sep patients sharing a room: only the last one out vacates it', () => {
  // 601 had two 30 Sep patients; both entries say "room vacated" (as in the live sheet).
  const out = [
    { id: 'a', type: 'carried', name: 'A', room: '601', discharge: '2026-10-04', roomFreed: 'Yes', created: '1' },
    { id: 'b', type: 'carried', name: 'B', room: '601', discharge: '2026-10-06', roomFreed: 'Yes', created: '2' }
  ];
  const v4 = Calc.day('2026-10-04', cats, out, [], {}), v6 = Calc.day('2026-10-06', cats, out, [], {});
  assert.strictEqual(v4['occ:Deluxe villa'], 2);      // B still in 601
  assert.strictEqual(v4.inHousePatients, 48);
  assert.strictEqual(v6['occ:Deluxe villa'], 1);      // 601 now empty
  assert.strictEqual(v6.discharged, 1);
});

test('30 Sep rooms never exceed 30 Sep patients, and reach 0 when the last one leaves', () => {
  // All 49 leave, every one marked "room vacated", spread over categories that do not match 30 Sep.
  const rooms = ['J 1', 'J 2', 'J 3', 'J 4', 'J 5', 'J 6', 'J 7', 'J 8', 'J 9', 'J 10', 'J 11', 'J 12',
    '501', '502', '503', '504', '505', '506', '601', '602', '603', '604', '112', '113', '701', '131', '132',
    '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '121', '122', '151', '152', '153', '154', '155', '156', '157', '158', '159'];
  const out = rooms.map((r, i) => ({ id: 'c' + i, type: 'carried', name: 'P' + i, room: r, discharge: '2026-10-' + String(1 + (i % 20)).padStart(2, '0'), roomFreed: 'Yes', created: String(i) }));
  for (let day = 1; day <= 21; day++) {
    const v = Calc.day('2026-10-' + String(day).padStart(2, '0'), cats, out, [], {});
    assert.ok(v.totalOccupied <= v.inHousePatients, 'day ' + day + ': ' + v.totalOccupied + ' rooms for ' + v.inHousePatients + ' patients');
    assert.ok(cats.every(c => v['occ:' + c.name] >= 0));
  }
  const end = Calc.day('2026-10-21', cats, out, [], {});
  assert.strictEqual(end.inHousePatients, 0);
  assert.strictEqual(end.totalOccupied, 0);
  assert.strictEqual(end.totalAvailable, 64);
});

test('hotel rooms renumbered 171 and 172: an entry saved as room 1 counts in 171', () => {
  assert.deepStrictEqual(cats.find(c => c.name === 'Hotel rooms').rooms, ['171', '172']);
  const old = admit('h', '1', '2026-10-19');
  const v = Calc.day('2026-10-20', cats, [old], [], {});
  assert.strictEqual(v['occ:Hotel rooms'], 1);
  assert.strictEqual(Calc.roomBoard('2026-10-20', cats, [old], []).find(r => r.room === '171').patients.length, 1);
  assert.match(Calc.checkPatient({ name: 'N', source: WALK, type: 'admission', admission: '2026-10-20', room: '171' }, [old], cats, []).errors.join(' '), /occupied/);
});

test('a planned admission counts only on its planned date, and stays counted after the patient is admitted', () => {
  // Entered on 29 Oct for 30 Oct: 1 on 30 Oct only.
  const booking = { id: 'b1', type: 'booking', name: 'L', source: WALK, visitDate: '2026-10-29', plannedAdmission: '2026-10-30' };
  const n = (d, list) => { const v = Calc.day(d, cats, list, [], {}); return v.plannedWalkIn + v.plannedVirtual + v.plannedOther; };
  assert.deepStrictEqual(['2026-10-29', '2026-10-30', '2026-10-31'].map(d => n(d, [booking])), [0, 1, 0]);
  const admitted = Object.assign({}, booking, { type: 'admission', admission: '2026-10-30', room: 'J 6', extensions: [] });
  assert.deepStrictEqual(['2026-10-29', '2026-10-30', '2026-10-31'].map(d => n(d, [admitted])), [0, 1, 0]);
  const v30 = Calc.day('2026-10-30', cats, [admitted], [], {});
  assert.strictEqual(v30.plannedWalkIn, 1);
  assert.strictEqual(v30.admitted, 1);
  assert.strictEqual(v30.asPlanned, 1);
  // Admissions without a planned date and room changes are not planned admissions.
  const plain = Calc.day('2026-10-31', cats, [admit('a', 'J 7', '2026-10-31'), { id: 'a/move/1', type: 'move', room: 'J 8', visitDate: '2026-10-31' }], [], {});
  assert.strictEqual(plain.plannedWalkIn + plain.plannedVirtual + plain.plannedOther, 0);
});
