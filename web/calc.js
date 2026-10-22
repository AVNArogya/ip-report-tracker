/**
 * IP Report tracker: every calculation, shared by the web app and the Google Sheets backend.
 *
 * The web app loads this file, and backend/Code-all-in-one.gs contains it, so the app and the
 * sheet always count the same way. Keep it plain ES5: Apps Script runs it too.
 * Dates are 'yyyy-mm-dd' strings throughout.
 *
 * Records:
 *   category { name, short, block, location: 'In-house'|'Apartment'|'Hotel', rooms: ['J 1', ...] }
 *   patient  { id, name, phone, source, type: 'visit'|'booking'|'admission', visitDate,
 *              plannedAdmission, admission, room, plannedDischarge, extensions: ['yyyy-mm-dd'],
 *              discharge, notes }
 *   block    { id, room, from, until, reason }   (room out of service; until blank = open-ended)
 *   plan     { 'yyyy-mm-dd': number }            (KR: planned patients in house)
 */
var Calc = (function () {
  'use strict';

  var SOURCES = ['Walk-in (PCE)', 'Virtual (tele)', 'Corporate', 'Clinic referral (AVN clinics)', 'Other (patient referral)'];
  var WALK_IN = SOURCES[0];

  // Patients already in house at the end of this date are entered once, as the opening balance
  // (admission date on or before it). The report starts with this date as its "brought forward" row,
  // and admissions, discharges and other day counts start the day after.
  var OPENING_DATE = '2026-09-30';
  function isCarried(p) { return p.type === 'admission' && !!p.admission && p.admission <= OPENING_DATE; }
  var TYPES = { visit: 'Walk-in visit', booking: 'Booking', admission: 'Admission' };

  // Room Categories tab as it is first set up: [category, short name, block, location, rooms].
  var DEFAULT_CATEGORIES = [
    ['Economy', 'Economy', 'J', 'In-house', 'J 1, J 2, J 3, J 4, J 5, J 6, J 7, J 8, J 9, J 10, J 11, J 12'],
    ['Executive (J block)', 'Executive JF', 'J', 'In-house', 'JF1, JF2, JF3, JF4, JF5, JF6, JF7'],
    ['Executive (S block)', 'Executive S', 'S', 'In-house', '101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 121, 122, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161'],
    ['Deluxe', 'Deluxe', 'S', 'In-house', '112, 113'],
    ['Classic villa', 'Classic villa', 'SW', 'In-house', '501, 502, 503, 504, 505, 506'],
    ['Deluxe villa', 'Deluxe villa', 'SW', 'In-house', '601, 602, 603, 604'],
    ['Royal villa', 'Royal villa', 'SW', 'In-house', '701'],
    ['Apartment rooms', 'Apartment rooms', '', 'Apartment', '131, 132, 137, 138, 139, 140'],
    ['Hotel rooms', 'Hotel rooms', '', 'Hotel', '1, 2']
  ];

  /* ---------- helpers ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function addDays(iso, n) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)).toISOString().slice(0, 10);
  }
  function datesBetween(from, to) {
    var out = [];
    for (var d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  // Any cell value → 'yyyy-mm-dd', or null. Accepts Date objects, ISO text and dd-mm-yyyy text.
  function toIso(v) {
    if (v === '' || v === null || v === undefined) return null;
    if (Object.prototype.toString.call(v) === '[object Date]') {
      return isNaN(v.getTime()) ? null : v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
    }
    var s = String(v).trim(), m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) return m[3] + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
    return null;
  }
  function roomName(v) { return String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' '); }
  function splitRooms(text) {
    return String(text || '').split(/[,\n]/).map(roomName).filter(function (r) { return r; });
  }
  function isInHouse(cat) { return String(cat.location || '').toLowerCase() === 'in-house'; }

  /* ---------- rooms ---------- */

  // Rows of the Room Categories tab ([category, short, block, location, rooms text]) → categories.
  function parseCategories(rows) {
    var cats = [];
    (rows || []).forEach(function (r) {
      var name = roomName(r[0]);
      if (!name || /^total/i.test(name) || /^in-house total/i.test(name)) return;
      cats.push({
        name: name,
        short: roomName(r[1]) || name,
        block: roomName(r[2]),
        location: roomName(r[3]) || 'In-house',
        rooms: splitRooms(r[4])
      });
    });
    return cats;
  }
  function defaultCategories() { return parseCategories(DEFAULT_CATEGORIES); }

  // { room: category } plus totals. A room listed twice belongs to its first category.
  function roomIndex(cats) {
    var byRoom = {}, dupes = [];
    cats.forEach(function (c) {
      c.rooms.forEach(function (r) {
        if (byRoom[r]) dupes.push(r); else byRoom[r] = c;
      });
    });
    var total = 0, inHouse = 0;
    cats.forEach(function (c) { total += c.rooms.length; if (isInHouse(c)) inHouse += c.rooms.length; });
    return { byRoom: byRoom, total: total, inHouse: inHouse, duplicates: dupes };
  }
  function blocksOf(cats) {
    var seen = {}, out = [];
    cats.forEach(function (c) { if (isInHouse(c) && c.block && !seen[c.block]) { seen[c.block] = 1; out.push(c.block); } });
    return out;
  }

  /* ---------- report columns ---------- */

  // Every IP Report column, in order: { key, label, kind }.
  // kind: 'date' | 'value' (calculated here) | 'formula' (the sheet links it to Room Categories) | 'percent'.
  // The first 32 columns are the report's own layout; the rest are totals and per-category detail.
  function columns(cats) {
    var cols = [{ key: 'date', label: 'Date', kind: 'date' }];
    var srcLabels = ['Walk-in (PCE)', 'Virtual (tele)', 'Corporate', 'Clinic referral (AVN clinics)', 'Other (patient referral)'];
    SOURCES.forEach(function (s, i) { cols.push({ key: 'src:' + s, label: srcLabels[i], kind: 'value' }); });
    cols.push(
      { key: 'admitted', label: 'Admitted: total', kind: 'value' },
      { key: 'beforePlan', label: 'Before plan', kind: 'value' },
      { key: 'discharged', label: 'Discharged: total', kind: 'value' },
      { key: 'extended', label: 'Stays extended today', kind: 'value' },
      { key: 'inHousePatients', label: 'Patients in house (end of day)', kind: 'value' },
      { key: 'plan', label: 'Plan: patients in house (KR)', kind: 'value' }
    );
    cats.filter(isInHouse).forEach(function (c) {
      cols.push({ key: 'occ:' + c.name, label: c.short + ' (of ' + c.rooms.length + ')', kind: 'value' });
    });
    blocksOf(cats).forEach(function (b) { cols.push({ key: 'oosBlock:' + b, label: b + ' block', kind: 'value' }); });
    cols.push(
      { key: 'inHouseOccupied', label: 'In-house rooms occupied', kind: 'value' },
      { key: 'inHouseAvailable', label: 'In-house rooms vacant and available', kind: 'formula' },
      { key: 'inHouseOccupancy', label: 'In-house occupancy', kind: 'percent' }
    );
    cats.filter(function (c) { return !isInHouse(c); }).forEach(function (c) {
      cols.push({ key: 'occ:' + c.name, label: c.name + ' in use (of ' + c.rooms.length + ')', kind: 'value' });
    });
    cols.push(
      { key: 'sharing', label: 'Patients sharing a room', kind: 'value' },
      { key: 'dischargesConfirmed', label: 'Discharges confirmed', kind: 'value' },
      { key: 'plannedWalkIn', label: 'Planned admissions: walk-in', kind: 'value' },
      { key: 'plannedVirtual', label: 'Planned admissions: virtual', kind: 'value' },
      { key: 'plannedOther', label: 'Planned admissions: corporate / clinic / other', kind: 'value' },
      // Totals across every room.
      { key: 'walkInVisits', label: 'Walk-in visits (incl. not admitted)', kind: 'value' },
      { key: 'totalRooms', label: 'Total rooms', kind: 'formula' },
      { key: 'totalOccupied', label: 'Total rooms occupied', kind: 'value' },
      { key: 'totalOutOfService', label: 'Total rooms out of service', kind: 'value' },
      { key: 'totalAvailable', label: 'Total rooms available', kind: 'formula' }
    );
    cats.forEach(function (c) { cols.push({ key: 'adm:' + c.name, label: 'Admitted: ' + c.short, kind: 'value' }); });
    cats.forEach(function (c) { cols.push({ key: 'oos:' + c.name, label: 'Out of service: ' + c.short, kind: 'value' }); });
    return cols;
  }

  /* ---------- the counts ---------- */

  function isAdmitted(p) { return p.type === 'admission' && !!p.admission; }
  // In house at the end of day d: admitted on or before d and not discharged by d.
  function inHouseOn(p, d) { return isAdmitted(p) && p.admission <= d && (!p.discharge || p.discharge > d); }
  function blockedOn(b, d) { return b.from && b.from <= d && (!b.until || b.until >= d); }

  // All counts for one date. Values only; the 'formula' columns are worked out here too so the app
  // can show them, and the sheet replaces them with formulas linked to Room Categories.
  function day(d, cats, patients, blocks, plan) {
    var idx = roomIndex(cats);
    var tomorrow = addDays(d, 1);
    var v = {};
    SOURCES.forEach(function (s) { v['src:' + s] = 0; });
    cats.forEach(function (c) { v['occ:' + c.name] = 0; v['adm:' + c.name] = 0; v['oos:' + c.name] = 0; });
    blocksOf(cats).forEach(function (b) { v['oosBlock:' + b] = 0; });
    v.admitted = v.beforePlan = v.discharged = v.extended = v.inHousePatients = 0;
    v.dischargesConfirmed = v.plannedWalkIn = v.plannedVirtual = v.plannedOther = v.walkInVisits = 0;
    v.plan = plan && plan[d] !== undefined && plan[d] !== '' ? Number(plan[d]) : '';

    var inRoom = {}; // room → patients in house tonight
    var counted = d > OPENING_DATE; // the brought-forward row shows who is in house, not the day's movements
    patients.forEach(function (p) {
      var cat = idx.byRoom[p.room];
      if (counted && p.source === WALK_IN && p.visitDate === d) v.walkInVisits++;
      if (p.type !== 'admission' && p.plannedAdmission === tomorrow) {
        if (p.source === WALK_IN) v.plannedWalkIn++;
        else if (p.source === SOURCES[1]) v.plannedVirtual++;
        else v.plannedOther++;
      }
      if (!isAdmitted(p)) return;
      if (counted && p.admission === d) {
        v.admitted++;
        if (v['src:' + p.source] !== undefined) v['src:' + p.source]++;
        else v['src:' + SOURCES[4]]++;
        if (cat) v['adm:' + cat.name]++;
        if (p.plannedAdmission && p.plannedAdmission > d) v.beforePlan++;
      }
      if (counted && p.discharge === d) v.discharged++;
      if (counted && (p.extensions || []).indexOf(d) >= 0) v.extended++;
      if (inHouseOn(p, d)) {
        v.inHousePatients++;
        (inRoom[p.room] = inRoom[p.room] || []).push(p);
        if (p.plannedDischarge === tomorrow) v.dischargesConfirmed++;
      }
    });

    var occInHouse = 0, occAll = 0;
    v.sharing = 0;
    Object.keys(inRoom).forEach(function (room) {
      var cat = idx.byRoom[room];
      occAll++;
      if (inRoom[room].length > 1) v.sharing += inRoom[room].length;
      if (!cat) return;
      v['occ:' + cat.name]++;
      if (isInHouse(cat)) occInHouse++;
    });

    // An occupied room is not counted again as out of service.
    var oosRooms = {};
    (blocks || []).forEach(function (b) { if (blockedOn(b, d) && !inRoom[b.room] && idx.byRoom[b.room]) oosRooms[b.room] = 1; });
    var oosInHouse = 0, oosAll = 0;
    Object.keys(oosRooms).forEach(function (room) {
      var cat = idx.byRoom[room];
      oosAll++;
      v['oos:' + cat.name]++;
      if (isInHouse(cat)) {
        oosInHouse++;
        if (cat.block) v['oosBlock:' + cat.block]++;
      }
    });

    v.inHouseOccupied = occInHouse;
    v.inHouseAvailable = idx.inHouse - occInHouse - oosInHouse;
    v.inHouseOccupancy = idx.inHouse ? occInHouse / idx.inHouse : 0;
    v.totalRooms = idx.total;
    v.totalOccupied = occAll;
    v.totalOutOfService = oosAll;
    v.totalAvailable = idx.total - occAll - oosAll;
    v.date = d;
    return v;
  }

  // The report's date range: from the opening balance date to today, or to the latest date entered.
  function reportRange(patients, blocks, today) {
    var first = null, last = today;
    function see(x) {
      if (!x) return;
      if (!first || x < first) first = x;
      if (x > last) last = x;
    }
    patients.forEach(function (p) {
      see(p.visitDate);
      if (isAdmitted(p)) { see(p.admission); see(p.discharge); }
      (p.extensions || []).forEach(see);
    });
    (blocks || []).forEach(function (b) { see(b.from); });
    if (!first) return null;
    return { from: OPENING_DATE, to: last };
  }

  // The whole report: { columns, dates, days: [values by key] }. Empty until something is entered.
  function report(cats, patients, blocks, plan, today) {
    var range = reportRange(patients, blocks, today);
    var dates = range ? datesBetween(range.from, range.to) : [];
    return {
      columns: columns(cats),
      dates: dates,
      days: dates.map(function (d) { return day(d, cats, patients, blocks, plan); })
    };
  }

  /* ---------- rooms on a date (for the app's room board) ---------- */

  // [{ room, category, status, patients, block }]; status: available | occupied | admitted | discharged | out.
  function roomBoard(d, cats, patients, blocks) {
    var out = [];
    cats.forEach(function (c) {
      c.rooms.forEach(function (room) {
        var here = patients.filter(function (p) { return isAdmitted(p) && p.room === room; });
        var tonight = here.filter(function (p) { return inHouseOn(p, d); });
        var leaving = here.filter(function (p) { return p.discharge === d; });
        var block = (blocks || []).filter(function (b) { return b.room === room && blockedOn(b, d); })[0] || null;
        var status = 'available';
        if (tonight.length) status = tonight.some(function (p) { return p.admission === d; }) ? 'admitted' : 'occupied';
        else if (block) status = 'out';
        else if (leaving.length) status = 'discharged';
        out.push({ room: room, category: c.name, status: status, patients: tonight, leaving: leaving, block: block });
      });
    });
    return out;
  }

  /* ---------- checks before saving ---------- */

  function stayEnd(p) { return p.discharge || '9999-12-31'; }
  function overlaps(a, b) { return a.admission < stayEnd(b) && b.admission < stayEnd(a); }

  // Normalises a patient record and returns { patient, errors }. `others` are the other patients.
  function checkPatient(input, others, cats, blocks) {
    var idx = roomIndex(cats);
    var p = {
      id: input.id || '',
      name: roomName(input.name),
      phone: String(input.phone || '').trim(),
      source: SOURCES.indexOf(input.source) >= 0 ? input.source : '',
      type: TYPES[input.type] ? input.type : '',
      visitDate: toIso(input.visitDate),
      plannedAdmission: toIso(input.plannedAdmission),
      admission: toIso(input.admission),
      room: roomName(input.room),
      plannedDischarge: toIso(input.plannedDischarge),
      extensions: (Array.isArray(input.extensions) ? input.extensions : String(input.extensions || '').split(','))
        .map(toIso).filter(function (x) { return x; }),
      discharge: toIso(input.discharge),
      notes: String(input.notes || '').trim(),
      share: !!input.share
    };
    var errors = [];
    var carried = isCarried(p);
    // The opening balance only needs the room; name and source are optional there.
    if (carried && !p.name) p.name = 'Carried forward (' + p.room + ')';
    if (!p.name) errors.push('Enter the patient name.');
    if (!p.source && !carried) errors.push('Choose the source.');
    if (carried && p.discharge && p.discharge <= OPENING_DATE) errors.push('Room ' + p.room + ': a patient carried forward is discharged after ' + OPENING_DATE + '.');
    if (!p.type) errors.push('Choose walk-in visit, booking or admission.');
    if (p.type === 'visit' && !p.visitDate) errors.push('Enter the visit date.');
    if (p.type === 'booking' && !p.plannedAdmission) errors.push('Enter the planned admission date.');
    if (p.type === 'admission') {
      if (!p.admission) errors.push('Enter the admission date.');
      if (!p.room) errors.push('Choose a room.');
      else if (!idx.byRoom[p.room]) errors.push('Room ' + p.room + ' is not in the Room Categories tab.');
      if (p.plannedDischarge && p.admission && p.plannedDischarge < p.admission) errors.push('The planned discharge is before the admission date.');
      if (p.discharge && p.admission && p.discharge < p.admission) errors.push('The discharge date is before the admission date.');
      if (!p.visitDate) p.visitDate = p.admission;
    } else {
      p.admission = null; p.room = ''; p.discharge = null; p.plannedDischarge = p.plannedDischarge || null;
      if (!p.visitDate) p.visitDate = p.plannedAdmission;
    }
    if (p.type === 'admission' && p.admission && idx.byRoom[p.room]) {
      var clash = others.filter(function (o) { return o.id !== p.id && isAdmitted(o) && o.room === p.room && overlaps(o, p); });
      if (clash.length >= 2) errors.push('Room ' + p.room + ' already has two patients then.');
      else if (clash.length === 1 && !p.share) {
        errors.push('Room ' + p.room + ' is occupied by ' + clash[0].name + ' from ' + clash[0].admission +
          (clash[0].discharge ? ' to ' + clash[0].discharge : '') + '. Tick "sharing a room" to put both patients in it.');
      }
      var blocked = (blocks || []).filter(function (b) {
        return b.room === p.room && b.from < stayEnd(p) && (!b.until || b.until >= p.admission);
      })[0];
      if (blocked) errors.push('Room ' + p.room + ' is out of service from ' + blocked.from + (blocked.until ? ' to ' + blocked.until : '') + '.');
    }
    delete p.share;
    return { patient: p, errors: errors };
  }

  // Several patients saved together (the opening balance). Checks each one against the others and the
  // rest of the batch; returns { saved, removed, errors }. Nothing should be written if errors is not empty.
  function checkBatch(saves, removeIds, patients, cats, blocks) {
    var removed = removeIds || [];
    var list = patients.filter(function (p) { return removed.indexOf(p.id) < 0; });
    var saved = [], errors = [];
    (saves || []).forEach(function (input, i) {
      var key = input.id || 'new' + i;
      var res = checkPatient(input, list.filter(function (p) { return (p.id || p._key) !== key; }), cats, blocks);
      res.errors.forEach(function (e) { errors.push((input.room ? 'Room ' + input.room + ': ' : '') + e); });
      res.patient._key = key;
      list = list.filter(function (p) { return (p.id || p._key) !== key; }).concat(res.patient);
      saved.push(res.patient);
    });
    saved.forEach(function (p) { delete p._key; });
    return { saved: saved, removed: removed, errors: errors };
  }

  function checkBlock(input, cats) {
    var idx = roomIndex(cats);
    var b = { id: input.id || '', room: roomName(input.room), from: toIso(input.from), until: toIso(input.until), reason: String(input.reason || '').trim() };
    var errors = [];
    if (!idx.byRoom[b.room]) errors.push('Choose a room from the Room Categories tab.');
    if (!b.from) errors.push('Enter the date the room goes out of service.');
    if (b.until && b.from && b.until < b.from) errors.push('"Until" is before "from".');
    return { block: b, errors: errors };
  }

  return {
    SOURCES: SOURCES, TYPES: TYPES, DEFAULT_CATEGORIES: DEFAULT_CATEGORIES, OPENING_DATE: OPENING_DATE, isCarried: isCarried,
    addDays: addDays, datesBetween: datesBetween, toIso: toIso, splitRooms: splitRooms, isInHouse: isInHouse,
    parseCategories: parseCategories, defaultCategories: defaultCategories, roomIndex: roomIndex, blocksOf: blocksOf,
    columns: columns, day: day, report: report, reportRange: reportRange, roomBoard: roomBoard,
    inHouseOn: inHouseOn, isAdmitted: isAdmitted, checkPatient: checkPatient, checkBatch: checkBatch, checkBlock: checkBlock
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
