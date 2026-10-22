// Runs backend/Code-all-in-one.gs against a small in-memory imitation of Google Sheets, to check that
// setup, saving through the web app API and the IP Report / Room Categories tabs work end to end.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

require('../build.js');

function colNum(letters) { return letters.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0); }

class Sheet {
  constructor(name) { this.name = name; this.cells = {}; this.maxRows = 1000; this.maxCols = 26; this.hidden = false; }
  getName() { return this.name; }
  key(r, c) { return r + ',' + c; }
  get(r, c) { const v = this.cells[this.key(r, c)]; return v === undefined ? '' : v; }
  set(r, c, v) {
    if (typeof v === 'string' && v[0] === "'") v = v.slice(1);
    if (v === '' || v === null) delete this.cells[this.key(r, c)]; else this.cells[this.key(r, c)] = v;
    if (r > this.maxRows) this.maxRows = r;
    if (c > this.maxCols) this.maxCols = c;
  }
  getLastRow() { let m = 0; Object.keys(this.cells).forEach(k => { m = Math.max(m, +k.split(',')[0]); }); return m; }
  getLastColumn() { let m = 0; Object.keys(this.cells).forEach(k => { m = Math.max(m, +k.split(',')[1]); }); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)$/);
      return new Range(this, +m[2], colNum(m[1]), 1, 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, i) => this.set(r, i + 1, v)); }
  deleteRow(r) {
    const next = {};
    Object.keys(this.cells).forEach(k => {
      const [rr, cc] = k.split(',').map(Number);
      if (rr < r) next[k] = this.cells[k]; else if (rr > r) next[(rr - 1) + ',' + cc] = this.cells[k];
    });
    this.cells = next;
  }
  hideSheet() { this.hidden = true; } showSheet() { this.hidden = false; }
  hideRows() {} setFrozenRows() {} setFrozenColumns() {} setColumnWidth() {} setRowHeight() {}
  protect() { const p = { setWarningOnly: () => p, setDescription: () => p }; return p; }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  grid(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i, this.c + j)); out.push(row); } return out; }
  getValues() { return this.grid((r, c) => this.sh.get(r, c)); }
  getDisplayValues() { return this.grid((r, c) => String(this.sh.get(r, c))); }
  getDisplayValue() { return String(this.sh.get(this.r, this.c)); }
  setValues(v) {
    assert.strictEqual(v.length, this.nr, 'setValues rows on ' + this.sh.name);
    v.forEach((row, i) => { assert.strictEqual(row.length, this.nc, 'setValues columns on ' + this.sh.name); row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x)); });
    return this;
  }
  setFormulas(v) { return this.setValues(v); }
  setValue(v) { this.sh.set(this.r, this.c, v); return this; }
  setFormula(v) { return this.setValue(v); }
  clear() { this.grid((r, c) => this.sh.set(r, c, '')); return this; }
  clearContent() { return this.clear(); }
}
['setFontSize', 'setFontWeight', 'setHorizontalAlignment', 'setNumberFormat', 'setFontColor', 'setBackground', 'setWrap',
  'setVerticalAlignment', 'setDataValidation'].forEach(m => { Range.prototype[m] = function () { return this; }; });

class Spreadsheet {
  constructor() { this.sheets = [new Sheet('Sheet1')]; this.active = this.sheets[0]; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n, i) { const s = new Sheet(n); if (i === 0) this.sheets.unshift(s); else this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  getSheets() { return this.sheets; }
  setActiveSheet(s) { this.active = s; }
  moveActiveSheet() {}
  getSpreadsheetTimeZone() { return 'Asia/Kolkata'; }
  toast() {}
}

const ss = new Spreadsheet();
const validation = { requireValueInList() { return this; }, requireDate() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } };
let uuid = 0;
const ctx = {
  SpreadsheetApp: { getActive: () => ss, newDataValidation: () => validation, getUi: () => ({}) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-key' }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
  Utilities: {
    getUuid: () => 'id' + (++uuid) + '-0000-0000',
    formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? '2026-10-22' : '2026-10-22 10:00'
  },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Logger: { log() {} }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code-all-in-one.gs'), 'utf8'), ctx);

const post = (action, record) => ctx.doPost({ postData: { contents: JSON.stringify({ key: 'test-key', action, record }) } });

ctx.setup();
assert.deepStrictEqual(ss.sheets.filter(s => !s.hidden).map(s => s.name), ['IP Report', 'Room Categories']);
const rooms = ss.getSheetByName('Room Categories');
const report = ss.getSheetByName('IP Report');
assert.strictEqual(rooms.get(4, 1), 'Economy');
assert.strictEqual(rooms.get(13, 1), 'Total');
assert.strictEqual(rooms.get(14, 1), 'In-house total');
assert.match(String(report.get(3, 1)), /'Room Categories'!\$F\$13/);
assert.strictEqual(report.getLastRow(), 29, 'rows from 30 Sep to today, before any entry');

let res = post('savePatient', { type: 'admission', name: 'Asha', phone: '+91 98450 00000', source: 'Walk-in (PCE)', admission: '2026-10-20', room: 'J 1', plannedDischarge: '2026-10-24' });
assert.ok(res.ok, res.error);
res = post('savePatient', { type: 'admission', name: 'Ravi', source: 'Virtual (tele)', admission: '2026-10-21', room: '501' });
assert.ok(res.ok, res.error);
res = post('savePatient', { type: 'admission', name: 'Clash', source: 'Corporate', admission: '2026-10-21', room: 'J 1' });
assert.ok(!res.ok && /occupied/.test(res.error), 'double booking refused');
res = post('savePatient', { type: 'visit', name: 'Walk only', source: 'Walk-in (PCE)', visitDate: '2026-10-21' });
assert.ok(res.ok, res.error);

const asha = res.data.patients.find(p => p.name === 'Asha');
assert.strictEqual(asha.phone, '+91 98450 00000');
assert.strictEqual(asha.category, 'Economy');
res = post('savePatient', Object.assign({}, asha, { discharge: '2026-10-22' }));
assert.ok(res.ok, res.error);

// Report rows: 30 Sep (fixed: 49 patients, 47 rooms) to 22 Oct.
const keys = {};
for (let c = 1; c <= report.getLastColumn(); c++) keys[report.get(5, c)] = c;
const row = iso => 7 + Math.round((Date.parse(iso) - Date.parse('2026-09-30')) / 864e5);
const val = (iso, key) => report.get(row(iso), keys[key]);
assert.strictEqual(report.getLastRow(), 29);
assert.strictEqual(report.get(6, keys['occ:Economy']), 'Economy (of 12)');
assert.strictEqual(val('2026-10-20', 'admitted'), 1);
assert.strictEqual(val('2026-10-20', 'src:Walk-in (PCE)'), 1);
assert.strictEqual(val('2026-10-20', 'adm:Economy'), 1);
assert.strictEqual(val('2026-10-21', 'adm:Classic villa'), 1);
assert.strictEqual(val('2026-10-21', 'occ:Economy'), 1);
assert.strictEqual(val('2026-10-21', 'walkInVisits'), 1);
assert.strictEqual(val('2026-10-21', 'totalOccupied'), 49); // 47 from 30 Sep + 2
assert.strictEqual(val('2026-10-22', 'discharged'), 1);
assert.strictEqual(val('2026-10-22', 'occ:Economy'), 0);
assert.strictEqual(val('2026-10-22', 'totalOccupied'), 48);
assert.strictEqual(val('2026-10-20', 'plan'), 57.77);
assert.match(String(val('2026-10-22', 'totalAvailable')), /^=/);
assert.match(String(val('2026-10-22', 'inHouseAvailable')), /'Room Categories'!\$F\$14/);
assert.match(String(rooms.get(4, 7)), /"occ:"&\$A4/);

// Out of service and plan entries.
assert.ok(post('saveBlock', { room: '601', from: '2026-10-22', reason: 'Repairs' }).ok);
assert.strictEqual(val('2026-10-22', 'oosBlock:SW'), 1);
assert.ok(post('savePlan', { date: '2026-10-22', plan: 61 }).ok);
assert.strictEqual(val('2026-10-22', 'plan'), 61);

// Deleting removes the patient from the report.
const ravi = post('savePlan', { date: '2026-10-23', plan: '' }).data.patients.find(p => p.name === 'Ravi');
assert.ok(post('deletePatient', { id: ravi.id }).ok);
assert.strictEqual(val('2026-10-21', 'admitted'), 0);

// The fixed 30 Sep position, and a patient from before 1 Oct discharged on 5 Oct.
assert.strictEqual(val('2026-09-30', 'inHousePatients'), 49);
assert.strictEqual(val('2026-09-30', 'totalOccupied'), 47);
assert.strictEqual(val('2026-09-30', 'admitted'), 0);
res = post('savePatient', { type: 'carried', discharge: '2026-10-05', room: '102', roomFreed: true });
assert.ok(res.ok, res.error);
assert.strictEqual(val('2026-10-05', 'discharged'), 1);
assert.strictEqual(val('2026-10-05', 'inHousePatients'), 48);
assert.strictEqual(val('2026-10-05', 'totalOccupied'), 46);
assert.strictEqual(val('2026-10-21', 'inHousePatients'), 49); // 48 + Asha
const early = post('savePatient', { type: 'admission', name: 'Early', source: 'Corporate', admission: '2026-09-28', room: '103' });
assert.ok(!early.ok && /starting figures/.test(early.error), 'admissions before 1 Oct are refused');

assert.ok(!ctx.doPost({ postData: { contents: JSON.stringify({ key: 'wrong', action: 'savePlan', record: {} }) } }).ok, 'wrong key refused');
console.log('backend check: ok');
