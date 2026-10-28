/**
 * IP Report tracker: Google Apps Script backend, bound to the Google Sheet.
 *
 * Visible tabs:
 *   IP Report        one row per date, every count calculated from the patients entered in the app,
 *                    plus a summary for the date in C1 (blank = today).
 *   Room Categories  category, room numbers and total rooms; occupied / available for the same date.
 * Hidden data tabs (written by the app): patients, rooms out of service, and the KR plan.
 *
 * The calculations live in web/calc.js. backend/Code-all-in-one.gs is this file plus calc.js;
 * paste that one into Apps Script (npm run build regenerates it).
 */

var REPORT = 'IP Report';
var ROOMS = 'Room Categories';
var PATIENTS = 'Data: patients';
var BLOCKS = 'Data: out of service';
var PLAN = 'Data: plan';

var REPORT_DATE_CELL = 'C1';   // date picked for the summary (blank = today)
var REPORT_SHOW_CELL = 'E1';   // the date actually shown
var REPORT_KEY_ROW = 5;        // hidden row of column keys, used by the lookup formulas
var REPORT_HEAD_ROW = 6;
var REPORT_FIRST_ROW = 7;
var ROOMS_HEAD_ROW = 3;
var ROOMS_FIRST_ROW = 4;

var PATIENT_FIELDS = [
  ['id', 'ID'], ['name', 'Patient name'], ['phone', 'Phone'], ['source', 'Source'], ['type', 'Type'],
  ['visitDate', 'Visit / entry date'], ['plannedAdmission', 'Planned admission'], ['admission', 'Admission date'],
  ['room', 'Room'], ['category', 'Room category'], ['plannedDischarge', 'Planned discharge'],
  ['extensions', 'Stay extended on'], ['discharge', 'Discharge date'],
  ['roomFreed', 'Room vacated (admitted before 1 Oct)'], ['notes', 'Notes'],
  ['created', 'Created'], ['updated', 'Updated']
];
var BLOCK_FIELDS = [
  ['id', 'ID'], ['room', 'Room'], ['category', 'Room category'], ['from', 'Out of service from'],
  ['until', 'Until'], ['reason', 'Reason'], ['created', 'Created'], ['updated', 'Updated']
];
var DATE_FIELDS = ['visitDate', 'plannedAdmission', 'admission', 'plannedDischarge', 'discharge', 'from', 'until'];

var COLOURS = { head: '#1f4e79', headText: '#ffffff', formula: '#eef2f7', summary: '#deebf7', total: '#f2f2f2' };

// Committed KR plan (patients in house each night), written to the plan tab by setup.
var SEED_PLAN = {"2026-10-01":50,"2026-10-02":52,"2026-10-03":49,"2026-10-04":49,"2026-10-05":56,"2026-10-06":55,"2026-10-07":53,"2026-10-08":55,"2026-10-09":59.96,"2026-10-10":56.66,"2026-10-11":55.54,"2026-10-12":58.89,"2026-10-13":53.31,"2026-10-14":56.66,"2026-10-15":53.31,"2026-10-16":54.43,"2026-10-17":56.66,"2026-10-18":58.89,"2026-10-19":57.77,"2026-10-20":57.77,"2026-10-21":59.96,"2026-10-22":59.96,"2026-10-23":59.96,"2026-10-24":59.96,"2026-10-25":59.96,"2026-10-26":59.96,"2026-10-27":59.96,"2026-10-28":59.96,"2026-10-29":63.35,"2026-10-30":61.12,"2026-10-31":58.89,"2026-11-01":52.2,"2026-11-02":48.85,"2026-11-03":43.28,"2026-11-04":39.93,"2026-11-05":34.36,"2026-11-06":31.02,"2026-11-07":27.67,"2026-11-08":27.67,"2026-11-09":32.13,"2026-11-10":34.36,"2026-11-11":39.93,"2026-11-12":38.82,"2026-11-13":39.93,"2026-11-14":35.48,"2026-11-15":38.82,"2026-11-16":39.93,"2026-11-17":38.82,"2026-11-18":37.71,"2026-11-19":41.05,"2026-11-20":44.39,"2026-11-21":47.74,"2026-11-22":49.97,"2026-11-23":48.85,"2026-11-24":48.85,"2026-11-25":45.51,"2026-11-26":44.39,"2026-11-27":46.62,"2026-11-28":44.39,"2026-11-29":43.28,"2026-11-30":42.16,"2026-12-01":51.08,"2026-12-02":56.66,"2026-12-03":56.66,"2026-12-04":58.89,"2026-12-05":58.89,"2026-12-06":60,"2026-12-07":63.35,"2026-12-08":65.58,"2026-12-09":61.12,"2026-12-10":57.77,"2026-12-11":61.12,"2026-12-12":57.77,"2026-12-13":57.77,"2026-12-14":58.89,"2026-12-15":61.12,"2026-12-16":57.77,"2026-12-17":56.66,"2026-12-18":54.43,"2026-12-19":55.54,"2026-12-20":62.23,"2026-12-21":60,"2026-12-22":66.35,"2026-12-23":65.58,"2026-12-24":68.76,"2026-12-25":68.24,"2026-12-26":68.12,"2026-12-27":67.78,"2026-12-28":65.36,"2026-12-29":65.36,"2026-12-30":60,"2026-12-31":52.15};

/* ---------- setup and menu ---------- */

// Builds the tabs. Safe to run again: room numbers and data already entered are kept.
function setup() {
  var ss = SpreadsheetApp.getActive();
  var rooms = ss.getSheetByName(ROOMS);
  if (!rooms) {
    rooms = ss.insertSheet(ROOMS);
    rooms.getRange(ROOMS_FIRST_ROW, 1, Calc.DEFAULT_CATEGORIES.length, 5).setValues(Calc.DEFAULT_CATEGORIES);
  }
  if (!ss.getSheetByName(REPORT)) ss.insertSheet(REPORT, 0);
  dataSheet_(PATIENTS, PATIENT_FIELDS);
  dataSheet_(BLOCKS, BLOCK_FIELDS);
  var plan = dataSheet_(PLAN, [['date', 'Date'], ['plan', 'Plan: patients in house (KR)']]);
  if (plan.getLastRow() < 2) {
    var rows = Object.keys(SEED_PLAN).sort().map(function (d) { return [d, SEED_PLAN[d]]; });
    plan.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  ss.setActiveSheet(ss.getSheetByName(REPORT));
  ss.moveActiveSheet(1);
  ss.setActiveSheet(ss.getSheetByName(ROOMS));
  ss.moveActiveSheet(2);
  refresh_();
  ss.setActiveSheet(ss.getSheetByName(REPORT));
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('IP Report')
    .addItem('Refresh now', 'menuRefresh')
    .addItem('Install daily refresh (rolls the report over to each new day)', 'installTriggers')
    .addSeparator()
    .addItem('Set up / repair the tabs', 'setup')
    .addItem('Show the data tabs', 'menuShowData')
    .addToUi();
}

function menuRefresh() { withLock_(refresh_); toast_('IP Report refreshed.'); }
function menuShowData() { [PATIENTS, BLOCKS, PLAN].forEach(function (n) { sheet_(n).showSheet(); }); }
function toast_(msg) { try { SpreadsheetApp.getActive().toast(msg, 'IP Report', 6); } catch (e) { Logger.log(msg); } }

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyRefresh') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyRefresh').timeBased().everyDays(1).atHour(0).nearMinute(15).create();
  toast_('The report now refreshes every night just after midnight.');
}
function dailyRefresh() { withLock_(refresh_); }

// Typing in Room Categories (room numbers, names, locations) or the data tabs updates the report.
function onEdit(e) {
  var name = e && e.range && e.range.getSheet().getName();
  if (name === ROOMS && e.range.getRow() >= ROOMS_FIRST_ROW && e.range.getColumn() <= 5) refresh_();
  else if (name === PATIENTS || name === BLOCKS || name === PLAN) refresh_();
  else if (name === REPORT && e.range.getA1Notation() === REPORT_DATE_CELL) refresh_(); // new date for Room Categories
}

/* ---------- web app API ---------- */

// The tabs are built on the first request if setup hasn't been run (or a tab was deleted).
function ensureTabs_() {
  var ss = SpreadsheetApp.getActive();
  var missing = [REPORT, ROOMS, PATIENTS, BLOCKS, PLAN].some(function (n) { return !ss.getSheetByName(n); });
  if (missing) setup();
  repairIds_();
  renumberHotelRooms_();
}

// Hotel rooms 1 and 2 became 171 and 172 (28 Oct). Changes only that cell of Room Categories, and only while
// it still reads exactly "1, 2". Entries saved with room 1 or 2 are counted in 171 / 172 (see Calc.canonRoom).
function renumberHotelRooms_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(ROOMS);
  if (!sh || sh.getLastRow() < ROOMS_FIRST_ROW) return;
  var rows = sh.getRange(ROOMS_FIRST_ROW, 1, sh.getLastRow() - ROOMS_FIRST_ROW + 1, 5).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    if (/^hotel rooms$/i.test(String(rows[i][0]).trim()) && Calc.splitRooms(rows[i][4]).join(',') === '1,2') {
      sh.getRange(ROOMS_FIRST_ROW + i, 5).setValue('171, 172');
      refresh_();
      return;
    }
  }
}

function doGet(e) {
  return handle_(function () {
    checkKey_(e.parameter.key);
    withLock_(ensureTabs_);
    var action = e.parameter.action || 'data';
    if (action === 'data') return readAll_();
    throw new Error('Unknown action: ' + action);
  });
}

function doPost(e) {
  return handle_(function () {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');
    checkKey_(body.key);
    return withLock_(function () {
      ensureTabs_();
      var d = readAll_();
      var saved = null;
      if (body.action === 'savePatient') saved = savePatient_(d, body.record);
      else if (body.action === 'deletePatient') deleteRow_(PATIENTS, body.record.id);
      else if (body.action === 'saveBlock') saved = saveBlock_(d, body.record);
      else if (body.action === 'deleteBlock') deleteRow_(BLOCKS, body.record.id);
      else if (body.action === 'savePlan') savePlan_(body.record);
      else throw new Error('Unknown action: ' + body.action);
      refresh_();
      var out = readAll_();
      out.saved = saved;
      return out;
    });
  });
}

function handle_(fn) {
  var out;
  try { out = { ok: true, data: fn() }; } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('APP_KEY');
  if (!expected) throw new Error('APP_KEY is not set in Apps Script → Project Settings → Script properties.');
  if (key !== expected) throw new Error('Invalid app key.');
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- saving ---------- */

function savePatient_(d, input) {
  var others = d.patients.filter(function (p) { return p.id !== input.id; });
  var res = Calc.checkPatient(input, others, d.categories, d.blocks);
  if (res.errors.length) throw new Error(res.errors.join(' '));
  var p = res.patient;
  var cat = Calc.roomIndex(d.categories).byRoom[p.room];
  p.category = cat ? cat.name : '';
  p.extensions = p.extensions.join(', ');
  return writeRow_(PATIENTS, PATIENT_FIELDS, p, p.type === 'move'); // a room change arrives with its id
}

function saveBlock_(d, input) {
  var res = Calc.checkBlock(input, d.categories);
  if (res.errors.length) throw new Error(res.errors.join(' '));
  var b = res.block;
  b.category = Calc.roomIndex(d.categories).byRoom[b.room].name;
  return writeRow_(BLOCKS, BLOCK_FIELDS, b);
}

function savePlan_(input) {
  var date = Calc.toIso(input.date);
  if (!date) throw new Error('Enter a date for the plan.');
  var sh = sheet_(PLAN);
  var dates = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues() : [];
  var value = input.plan === '' || input.plan === null || input.plan === undefined ? '' : Number(input.plan);
  for (var i = 0; i < dates.length; i++) {
    if (Calc.toIso(dates[i][0]) === date) { sh.getRange(i + 2, 2).setValue(value); return; }
  }
  sh.appendRow([date, value]);
}

// Adds or updates a record (matched on ID) and returns it.
// newWithId: the record is new although it already has an id (a room change). Otherwise an id that
// isn't found is an error, so an edit can never turn into a second copy of the entry.
function writeRow_(name, fields, rec, newWithId) {
  var sh = sheet_(name);
  var now = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm');
  var row = rec.id ? findRow_(sh, rec.id) : 0;
  if (!row && rec.id && !newWithId) throw new Error('That entry was not found; it may have been deleted already. Reload the app and try again.');
  if (!row) { rec.id = rec.id || newId_(); rec.created = now; }
  else rec.created = sh.getRange(row, fieldIndex_(fields, 'created') + 1).getDisplayValue();
  rec.updated = now;
  var values = [fields.map(function (f) {
    var v = rec[f[0]];
    if (v === null || v === undefined) return '';
    // Keep text as typed: phone numbers keep their + and leading 0, and nothing is read as a formula.
    // IDs too: an id like 50807e10 would otherwise be read as a number (5.08E+12).
    if (typeof v === 'string' && v && (f[0] === 'phone' || f[0] === 'id' || /^[=+\-@]/.test(v))) return "'" + v;
    return v;
  })];
  if (row) sh.getRange(row, 1, 1, fields.length).setValues(values);
  else sh.appendRow(values[0]);
  return rec;
}

function deleteRow_(name, id) {
  var sh = sheet_(name);
  var row = findRow_(sh, id);
  if (!row) throw new Error('That entry was not found; it may have been deleted already.');
  sh.deleteRow(row);
}

// IDs are compared exactly as readRows_ hands them to the app, so every entry the app shows can be found.
function findRow_(sh, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (idText_(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
function idText_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
// Starts with a letter, so the sheet can never read it as a number.
function newId_() { return 'p' + Utilities.getUuid().replace(/-/g, '').slice(0, 7); }

// Gives a fresh id to rows whose id the sheet turned into a number, or that share an id with an earlier
// row (both made entries impossible to edit or delete). Only the ID cell changes; room changes that
// pointed at a renamed id follow it. Nothing is deleted.
function repairIds_() {
  [PATIENTS, BLOCKS].forEach(function (name) {
    var sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var range = sh.getRange(2, 1, sh.getLastRow() - 1, 1);
    var ids = range.getValues();
    var seen = {}, renamed = {}, changed = false;
    ids.forEach(function (r, i) {
      var text = idText_(r[0]);
      var broken = typeof r[0] === 'number' || (text && seen[text]);
      if (text) seen[text] = true;
      if (!broken) return;
      var fresh = newId_();
      if (!renamed[text]) renamed[text] = fresh; // the first row with this id keeps its room changes
      ids[i][0] = "'" + fresh;
      changed = true;
    });
    if (!changed) return;
    // Room change rows ('<patient id>/move/…') follow their patient's new id.
    ids.forEach(function (r, i) {
      var text = idText_(r[0]).replace(/^'/, '');
      var k = text.indexOf(Calc.MOVE_SEP);
      if (k > 0 && renamed[text.slice(0, k)]) ids[i][0] = "'" + renamed[text.slice(0, k)] + text.slice(k);
      else if (typeof r[0] === 'string' && r[0].charAt(0) !== "'") ids[i][0] = "'" + r[0];
    });
    range.setValues(ids);
  });
}
function fieldIndex_(fields, key) {
  for (var i = 0; i < fields.length; i++) if (fields[i][0] === key) return i;
  return -1;
}

/* ---------- reading ---------- */

// Bumped with each backend change; the app warns when the sheet's code is older than it expects.
var BACKEND_VERSION = 10;

function readAll_() {
  return {
    version: BACKEND_VERSION,
    categories: readCategories_(),
    patients: readRows_(PATIENTS, PATIENT_FIELDS).map(function (p) {
      p.extensions = String(p.extensions || '').split(',').map(Calc.toIso).filter(function (x) { return x; });
      return p;
    }),
    blocks: readRows_(BLOCKS, BLOCK_FIELDS),
    plan: readPlan_(),
    today: todayIso_()
  };
}

function readCategories_() {
  var sh = sheet_(ROOMS);
  var n = sh.getLastRow() - ROOMS_FIRST_ROW + 1;
  if (n < 1) return [];
  var rows = sh.getRange(ROOMS_FIRST_ROW, 1, n, 5).getDisplayValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!String(rows[i][0]).trim() || /^(in-house )?total/i.test(String(rows[i][0]).trim())) break;
    out.push(rows[i]);
  }
  return Calc.parseCategories(out);
}

// Data tab → records. Columns are found by their heading, so they can be reordered.
function readRows_(name, fields) {
  var sh = sheet_(name);
  if (sh.getLastRow() < 2) return [];
  var grid = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var col = {};
  grid[0].forEach(function (h, i) {
    fields.forEach(function (f) { if (String(h).trim().toLowerCase() === f[1].toLowerCase()) col[f[0]] = i; });
  });
  var out = [];
  for (var r = 1; r < grid.length; r++) {
    var rec = {};
    fields.forEach(function (f) {
      var v = col[f[0]] === undefined ? '' : grid[r][col[f[0]]];
      if (DATE_FIELDS.indexOf(f[0]) >= 0) v = isoOf_(v);
      else if (v instanceof Date) v = Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm');
      else v = String(v === null || v === undefined ? '' : v).trim();
      rec[f[0]] = v;
    });
    if (rec.id || rec.name || rec.room) out.push(rec);
  }
  return out;
}

function readPlan_() {
  var sh = sheet_(PLAN), plan = {};
  if (sh.getLastRow() < 2) return plan;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var d = isoOf_(r[0]);
    if (d && r[1] !== '' && r[1] !== null) plan[d] = Number(r[1]);
  });
  return plan;
}

/* ---------- writing the two visible tabs ---------- */

function refresh_() {
  var d = readAll_(), cats = d.categories;
  var rep = Calc.report(cats, d.patients, d.blocks, d.plan, d.today);
  var layout = writeRoomCategories_(cats);
  writeReport_(rep, cats, layout);
  writeRoomLookups_(cats, layout, rep.columns.length, d);
}

// Room Categories: A–E are typed (category, short name, block, location, room numbers); F onwards are formulas.
function writeRoomCategories_(cats) {
  var sh = sheet_(ROOMS);
  sh.getRange('A1').setValue(ROOMS).setFontSize(14).setFontWeight('bold');
  sh.getRange('C1').setValue('Showing:').setHorizontalAlignment('right');
  sh.getRange('D1').setFormula("='" + REPORT + "'!" + REPORT_SHOW_CELL).setNumberFormat('ddd d mmm yyyy').setFontWeight('bold');
  sh.getRange('E1').setValue('Pick the date in ' + REPORT + ' cell ' + REPORT_DATE_CELL + '.').setFontColor('#666666');
  sh.getRange('A2').setValue('Edit room numbers in column E, separated by commas. Totals, the IP Report and the app follow them. ' +
    'Location "In-house" counts towards in-house occupancy; Apartment and Hotel rooms are counted separately.').setFontColor('#666666');
  var head = ['Category', 'Short name (report heading)', 'Block', 'Location', 'Room numbers', 'Total rooms',
    'Occupied', 'Out of service', 'Available', 'Admitted that day'];
  sh.getRange(ROOMS_HEAD_ROW, 1, 1, head.length).setValues([head])
    .setBackground(COLOURS.head).setFontColor(COLOURS.headText).setFontWeight('bold').setWrap(true);

  var n = cats.length, first = ROOMS_FIRST_ROW, last = first + n - 1;
  var totalRow = last + 1, inHouseRow = last + 2;
  // Clear anything left below the categories (old total rows), then write the two total rows.
  // One row per category (a tab typed as one row per room is tidied into this), then clear what's below.
  if (n) sh.getRange(first, 1, n, 5).setValues(Calc.categoryRows(cats));
  var clearFrom = totalRow;
  if (sh.getMaxRows() >= clearFrom) sh.getRange(clearFrom, 1, sh.getMaxRows() - clearFrom + 1, head.length).clear();
  if (n) {
    var totals = [];
    for (var r = first; r <= last; r++) totals.push(['=IF(TRIM(E' + r + ')="",0,COUNTA(SPLIT(E' + r + ',",")))']);
    sh.getRange(first, 6, n, 1).setFormulas(totals);
  }
  var sumRow = ['Total', '', '', '', 'All rooms'], inRow = ['In-house total', '', '', '', 'Location = In-house'];
  ['F', 'G', 'H', 'I', 'J'].forEach(function (c) {
    sumRow.push('=SUM(' + c + first + ':' + c + Math.max(first, last) + ')');
    inRow.push('=SUMIF($D$' + first + ':$D$' + Math.max(first, last) + ',"In-house",' + c + first + ':' + c + Math.max(first, last) + ')');
  });
  sh.getRange(totalRow, 1, 2, head.length).setValues([sumRow, inRow])
    .setFontWeight('bold').setBackground(COLOURS.total);
  sh.getRange(first, 6, n + 2, 5).setHorizontalAlignment('center');
  sh.getRange(first, 7, n, 4).setBackground(COLOURS.formula);
  sh.getRange(first, 4, Math.max(n, 1), 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['In-house', 'Apartment', 'Hotel'], true).setAllowInvalid(false).build());
  sh.setFrozenRows(ROOMS_HEAD_ROW);
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 140); sh.setColumnWidth(3, 60); sh.setColumnWidth(4, 90);
  sh.setColumnWidth(5, 420); sh.getRange(first, 5, Math.max(n, 1), 1).setWrap(true);
  for (var c = 6; c <= 10; c++) sh.setColumnWidth(c, 95);
  return { totalRow: totalRow, inHouseRow: inHouseRow };
}

// Occupied comes from the report by formula. Out of service and admitted are worked out here for the date
// shown (IP Report C1, blank = today) and rewritten whenever C1 or the data changes.
function writeRoomLookups_(cats, layout, width, d) {
  if (!cats.length) return;
  var sh = sheet_(ROOMS);
  var shown = isoOf_(sheet_(REPORT).getRange(REPORT_DATE_CELL).getValue()) || d.today;
  var v = Calc.day(shown, cats, d.patients, d.blocks, d.plan);
  var rows = [];
  for (var i = 0; i < cats.length; i++) {
    var r = ROOMS_FIRST_ROW + i;
    rows.push([lookup_('"occ:"&$A' + r, width, "'" + REPORT + "'!", "'" + REPORT + "'!" + REPORT_SHOW_CELL),
      v['oos:' + cats[i].name],
      '=F' + r + '-G' + r + '-H' + r,
      v['adm:' + cats[i].name]]);
  }
  sh.getRange(ROOMS_FIRST_ROW, 7, rows.length, 4).setValues(rows);
}

// Formula: the value in the report's column with key `keyExpr` on the shown date (0 if none).
function lookup_(keyExpr, width, prefix, dateRef) {
  var lastCol = colLetter_(width);
  var table = prefix + '$A$' + REPORT_FIRST_ROW + ':$' + lastCol;
  return '=IFERROR(INDEX(' + table + ',MATCH(' + dateRef + ',' + prefix + '$A$' + REPORT_FIRST_ROW + ':$A,0),MATCH(' + keyExpr + ',' +
    prefix + '$A$' + REPORT_KEY_ROW + ':$' + lastCol + '$' + REPORT_KEY_ROW + ',0)),0)';
}

function writeReport_(rep, cats, layout) {
  var sh = sheet_(REPORT);
  var cols = rep.columns, width = cols.length;
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  // Columns left over from an older, wider layout are removed.
  if (sh.getMaxColumns() > width) sh.deleteColumns(width + 1, sh.getMaxColumns() - width);
  var at = {};
  cols.forEach(function (c, i) { at[c.key] = colLetter_(i + 1); });
  var roomsRef = "'" + ROOMS + "'!";
  var totalRef = roomsRef + '$F$' + layout.totalRow, inHouseRef = roomsRef + '$F$' + layout.inHouseRow;
  var oosInHouse = Calc.blocksOf(cats).map(function (b) { return at['oosBlock:' + b]; }); // in-house rooms out of service, by block

  // Title and the date picker.
  sh.getRange('A1').setValue(REPORT).setFontSize(14).setFontWeight('bold');
  sh.getRange('B1').setValue('Date (blank = today):').setHorizontalAlignment('right');
  sh.getRange(REPORT_DATE_CELL).setNumberFormat('d mmm yyyy').setBackground('#fff2cc')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  sh.getRange('D1').setValue('Showing:').setHorizontalAlignment('right');
  sh.getRange(REPORT_SHOW_CELL).setFormula('=IF(' + REPORT_DATE_CELL + '="",TODAY(),' + REPORT_DATE_CELL + ')')
    .setNumberFormat('ddd d mmm yyyy').setFontWeight('bold');

  // Summary for the shown date.
  var summary = [
    ['Total rooms', '=' + totalRef],
    ['Occupied rooms', lookup_('"totalOccupied"', width, '', REPORT_SHOW_CELL)],
    ['Available rooms', '=A3-B3-D3'],
    ['Out of service', lookup_('"totalOutOfService"', width, '', REPORT_SHOW_CELL)],
    ['Walk-in (PCE) admitted', lookup_('"src:' + Calc.SOURCES[0] + '"', width, '', REPORT_SHOW_CELL)],
    ['Admitted', lookup_('"admitted"', width, '', REPORT_SHOW_CELL)],
    ['Discharged', lookup_('"discharged"', width, '', REPORT_SHOW_CELL)],
    ['Patients in house', lookup_('"inHousePatients"', width, '', REPORT_SHOW_CELL)],
    ['In-house occupancy', lookup_('"inHouseOccupancy"', width, '', REPORT_SHOW_CELL)]
  ];
  sh.getRange(2, 1, 2, width).clear();
  sh.getRange(2, 1, 1, summary.length).setValues([summary.map(function (s) { return s[0]; })])
    .setFontWeight('bold').setWrap(true).setBackground(COLOURS.summary);
  sh.getRange(3, 1, 1, summary.length).setFormulas([summary.map(function (s) { return s[1]; })])
    .setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center').setNumberFormat('0');
  sh.getRange(3, summary.length).setNumberFormat('0%'); // In-house occupancy, the last summary item
  sh.getRange(4, 1).setValue('Category-wise occupied, available and admitted counts for this date are in the ' + ROOMS + ' tab.')
    .setFontColor('#666666');

  // Key row (hidden) and headings.
  sh.getRange(REPORT_KEY_ROW, 1, 2, sh.getMaxColumns()).clear();
  sh.getRange(REPORT_KEY_ROW, 1, 1, width).setValues([cols.map(function (c) { return c.key; })]);
  sh.hideRows(REPORT_KEY_ROW);
  sh.getRange(REPORT_HEAD_ROW, 1, 1, width).setValues([cols.map(function (c) { return c.label; })])
    .setBackground(COLOURS.head).setFontColor(COLOURS.headText).setFontWeight('bold').setWrap(true)
    .setVerticalAlignment('middle').setHorizontalAlignment('center');

  // One row per date.
  var oldRows = sh.getMaxRows() - REPORT_FIRST_ROW + 1;
  if (oldRows > 0) sh.getRange(REPORT_FIRST_ROW, 1, oldRows, sh.getMaxColumns()).clearContent().setBackground(null);
  var n = rep.dates.length;
  if (n) {
    if (sh.getMaxRows() < REPORT_FIRST_ROW + n - 1) sh.insertRowsAfter(sh.getMaxRows(), REPORT_FIRST_ROW + n - 1 - sh.getMaxRows());
    var grid = rep.days.map(function (v, i) {
      var r = REPORT_FIRST_ROW + i;
      return cols.map(function (c) {
        if (c.key === 'date') return serial_(v.date);
        if (c.key === 'totalRooms') return '=' + totalRef;
        if (c.key === 'totalAvailable') return '=' + at.totalRooms + r + '-' + at.totalOccupied + r + '-' + at.totalOutOfService + r;
        if (c.key === 'inHouseAvailable') {
          return '=' + inHouseRef + '-' + at.inHouseOccupied + r + oosInHouse.map(function (l) { return '-' + l + r; }).join('');
        }
        if (c.key === 'inHouseOccupancy') return '=IF(' + inHouseRef + '=0,0,' + at.inHouseOccupied + r + '/' + inHouseRef + ')';
        return v[c.key];
      });
    });
    sh.getRange(REPORT_FIRST_ROW, 1, n, width).setValues(grid).setHorizontalAlignment('center');
    sh.getRange(REPORT_FIRST_ROW, 1, n, 1).setNumberFormat('ddd d mmm yyyy').setHorizontalAlignment('left');
    cols.forEach(function (c, i) {
      if (c.kind === 'formula' || c.kind === 'percent') sh.getRange(REPORT_FIRST_ROW, i + 1, n, 1).setBackground(COLOURS.formula);
      if (c.kind === 'percent') sh.getRange(REPORT_FIRST_ROW, i + 1, n, 1).setNumberFormat('0%');
    });
    // Highlight today's row.
    var todayIdx = rep.dates.indexOf(todayIso_());
    if (todayIdx >= 0) sh.getRange(REPORT_FIRST_ROW + todayIdx, 1).setBackground('#fff2cc');
  }
  sh.setFrozenRows(REPORT_HEAD_ROW);
  sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 130);
  for (var c = 2; c <= width; c++) sh.setColumnWidth(c, 95);
  sh.setRowHeight(REPORT_HEAD_ROW, 60);
}

/* ---------- small helpers ---------- */

function dataSheet_(name, fields) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, fields.length).setValues([fields.map(function (f) { return f[1]; })])
      .setFontWeight('bold').setBackground(COLOURS.head).setFontColor(COLOURS.headText);
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, fields.length).setNumberFormat('@'); // dates kept as yyyy-mm-dd text
    sh.protect().setWarningOnly(true).setDescription('Written by the IP Report app');
  }
  sh.hideSheet();
  return sh;
}
function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. Run IP Report → Set up / repair the tabs.');
  return sh;
}
function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
function todayIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function isoOf_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return Calc.toIso(v);
}
// 'yyyy-mm-dd' → spreadsheet date number (independent of time zones).
function serial_(iso) {
  var p = iso.split('-');
  return (Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 864e5;
}
function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
