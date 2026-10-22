/* IP Report tracker: the web app. Data lives in the Google Sheet (or this browser in practice mode). */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var DEMO = !CFG.API_URL || /[?&]demo=1/.test(location.search);
  var DEMO_KEY = 'ip-report-demo';
  var state = { categories: Calc.defaultCategories(), patients: [], blocks: [], plan: {}, today: localToday() };
  var editing = null; // patient being edited, or null for a new entry

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- helpers ---------- */

  function localToday() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function short(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function status(msg, kind) {
    var el = $('#status');
    el.textContent = msg;
    el.className = 'status ' + (kind || '');
    el.hidden = !msg;
    clearTimeout(status.t);
    if (msg && kind !== 'error') status.t = setTimeout(function () { el.hidden = true; }, 4000);
  }
  function catOf(room) { var c = Calc.roomIndex(state.categories).byRoom[room]; return c ? c.name : ''; }

  /* ---------- data: Google Sheet or this browser ---------- */

  function unwrap(r) {
    return r.json().then(function (j) {
      if (!j.ok) throw new Error(j.error || 'The sheet returned an error.');
      return j.data;
    });
  }
  function load() {
    if (DEMO) return Promise.resolve(demoRead());
    return fetch(CFG.API_URL + '?action=data&key=' + encodeURIComponent(CFG.APP_KEY)).then(unwrap);
  }
  function send(action, record) {
    if (DEMO) {
      try { return Promise.resolve(demoWrite(action, record)); } catch (e) { return Promise.reject(e); }
    }
    return fetch(CFG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: CFG.APP_KEY, action: action, record: record })
    }).then(unwrap);
  }

  function demoRead() {
    var d = {};
    try { d = JSON.parse(localStorage.getItem(DEMO_KEY) || '{}'); } catch (e) { d = {}; }
    return { categories: Calc.defaultCategories(), patients: d.patients || [], blocks: d.blocks || [], plan: d.plan || {}, today: localToday() };
  }
  // Same checks as the sheet, so practice mode behaves like the real thing.
  function demoWrite(action, rec) {
    var d = demoRead(), saved = null;
    var id = function () { return Math.random().toString(16).slice(2, 10); };
    if (action === 'savePatient') {
      var res = Calc.checkPatient(rec, d.patients.filter(function (p) { return p.id !== rec.id; }), d.categories, d.blocks);
      if (res.errors.length) throw new Error(res.errors.join(' '));
      saved = res.patient;
      saved.category = catOf(saved.room);
      if (!saved.id) { saved.id = id(); d.patients.push(saved); }
      else d.patients = d.patients.map(function (p) { return p.id === saved.id ? saved : p; });
    } else if (action === 'deletePatient') {
      d.patients = d.patients.filter(function (p) { return p.id !== rec.id; });
    } else if (action === 'saveBlock') {
      var rb = Calc.checkBlock(rec, d.categories);
      if (rb.errors.length) throw new Error(rb.errors.join(' '));
      saved = rb.block;
      if (!saved.id) { saved.id = id(); d.blocks.push(saved); }
      else d.blocks = d.blocks.map(function (b) { return b.id === saved.id ? saved : b; });
    } else if (action === 'deleteBlock') {
      d.blocks = d.blocks.filter(function (b) { return b.id !== rec.id; });
    } else if (action === 'savePlan') {
      if (rec.plan === '' || rec.plan === null) delete d.plan[rec.date]; else d.plan[rec.date] = Number(rec.plan);
    }
    try { localStorage.setItem(DEMO_KEY, JSON.stringify({ patients: d.patients, blocks: d.blocks, plan: d.plan })); } catch (e) { /* storage unavailable */ }
    d.saved = saved;
    return d;
  }

  var BACKEND_VERSION = 5; // the Apps Script version this app needs

  // Rooms by category. Older sheet code sent a one-row-per-room tab as many empty categories; regroup those here.
  function categoriesFrom(cats) {
    if (!cats || !cats.length) return Calc.defaultCategories();
    var rooms = cats.reduce(function (a, c) { return a + (c.rooms || []).length; }, 0);
    if (rooms) return cats;
    return Calc.parseCategories(cats.map(function (c) { return [c.name, c.short, '', '', '']; }));
  }

  function apply(data) {
    if (!DEMO && !(data.version >= BACKEND_VERSION)) {
      status('The Google Sheet is running old code, so saving may fail. In the sheet: Extensions → Apps Script → paste the latest ' +
        'backend/Code-all-in-one.gs from GitHub → Save → Deploy → Manage deployments → Edit → New version → Deploy.', 'error');
    }
    state.categories = categoriesFrom(data.categories);
    state.patients = data.patients || [];
    state.blocks = data.blocks || [];
    state.plan = data.plan || {};
    state.today = data.today || localToday();
    renderAll();
  }
  function save(action, record, okMsg) {
    status('Saving…');
    return send(action, record).then(function (data) {
      apply(data);
      status(okMsg || 'Saved.', 'ok');
      return data;
    }).catch(function (e) { status(e.message, 'error'); throw e; });
  }

  /* ---------- tabs ---------- */

  function showTab(name) {
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    $$('.tab').forEach(function (t) { t.hidden = t.id !== 'tab-' + name; });
  }
  $$('#tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  function renderAll() { renderRoomOptions(); renderPatients(); renderBoard(); renderReport(); }

  /* ---------- entry form ---------- */

  var form = $('#entry');
  Calc.SOURCES.forEach(function (s) { form.source.add(new Option(s, s)); });

  function typeNow() { return $('input[name=type]:checked', form).value; }
  function syncFields() {
    var t = typeNow();
    $$('[data-for]', form).forEach(function (el) {
      var show = el.dataset.for.split(' ').indexOf(t) >= 0 && (!el.classList.contains('edit-only') || editing || t === 'carried');
      el.hidden = !show;
    });
    if (t === 'carried' && !form.discharge.value) form.discharge.value = state.today;
    renderRoomOptions();
  }
  $$('input[name=type]', form).forEach(function (r) { r.addEventListener('change', syncFields); });
  form.admission.addEventListener('change', renderRoomOptions);

  // Rooms grouped by category, with what each one is doing on the admission date.
  function renderRoomOptions() {
    var date = form.admission.value || state.today;
    var current = form.room.value;
    var board = Calc.roomBoard(date, state.categories, state.patients.filter(function (p) { return !editing || p.id !== editing.id; }), state.blocks);
    form.room.innerHTML = '<option value="">Choose a room</option>';
    state.categories.forEach(function (c) {
      var g = document.createElement('optgroup');
      var free = board.filter(function (r) { return r.category === c.name && (r.status === 'available' || r.status === 'discharged'); }).length;
      g.label = c.name + ' (' + free + ' of ' + c.rooms.length + ' free)';
      board.filter(function (r) { return r.category === c.name; }).forEach(function (r) {
        var note = r.status === 'out' ? ' (out of service)' : r.patients.length ? ' (occupied: ' + r.patients.map(function (p) { return p.name; }).join(', ') + ')' : '';
        var o = new Option(r.room + note, r.room);
        o.disabled = r.status === 'out' || r.patients.length >= 2;
        g.appendChild(o);
      });
      form.room.appendChild(g);
    });
    form.room.value = current;
  }

  function resetForm(p) {
    editing = p || null;
    form.reset();
    $('#entry-title').textContent = p ? 'Edit ' + p.name : 'New entry';
    $('#entry-cancel').hidden = !p;
    var today = state.today;
    form.visitDate.value = today;
    form.admission.value = today;
    if (p) {
      ['id', 'name', 'phone', 'source', 'visitDate', 'plannedAdmission', 'admission', 'plannedDischarge', 'discharge', 'notes'].forEach(function (k) {
        form[k].value = p[k] || '';
      });
      form.extensions.value = (p.extensions || []).join(', ');
      $('input[name=type][value=' + p.type + ']', form).checked = true;
    }
    syncFields();
    if (p) {
      form.room.value = p.room || '';
      form.share.checked = sharing(p);
      form.roomFreed.checked = p.type !== 'carried' || /^yes$/i.test(p.roomFreed);
    }
  }
  // True when another patient is in the same room during this patient's stay.
  function sharing(p) {
    if (!Calc.isAdmitted(p)) return false;
    return state.patients.some(function (o) {
      return o.id !== p.id && Calc.isAdmitted(o) && o.room === p.room &&
        o.admission < (p.discharge || '9999') && p.admission < (o.discharge || '9999');
    });
  }
  $('#entry-cancel').addEventListener('click', function () { resetForm(); showTab('patients'); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = typeNow();
    var rec = {
      id: form.id.value, type: t, name: form.name.value, phone: form.phone.value, source: form.source.value,
      visitDate: form.visitDate.value, plannedAdmission: form.plannedAdmission.value, notes: form.notes.value,
      plannedDischarge: form.plannedDischarge.value
    };
    if (t === 'admission') {
      rec.admission = form.admission.value; rec.room = form.room.value; rec.share = form.share.checked;
      rec.discharge = editing ? form.discharge.value : '';
      rec.extensions = editing ? form.extensions.value : [];
      // A walk-in or booking admitted later keeps the date they first came; a direct admission uses its admission date.
      rec.visitDate = (editing && editing.visitDate) || rec.admission;
    }
    if (t === 'carried') {
      rec.room = form.room.value; rec.discharge = form.discharge.value; rec.roomFreed = form.roomFreed.checked;
    }
    var wasEditing = !!editing;
    var who = rec.name || (t === 'carried' ? 'the discharge' : '');
    save('savePatient', rec, wasEditing ? 'Updated ' + who + '.' : 'Saved ' + who + '. The IP Report is updated.').then(function () {
      resetForm();
      if (wasEditing) showTab('patients');
    }, function () {});
  });

  function admitFrom(p) {
    resetForm(p);
    $('input[name=type][value=admission]', form).checked = true;
    form.admission.value = p.plannedAdmission && p.plannedAdmission >= state.today ? p.plannedAdmission : state.today;
    syncFields();
    $('#entry-title').textContent = 'Admit ' + p.name;
    showTab('entry');
  }

  /* ---------- dialogs ---------- */

  function ask(title, fieldsHtml, onOk) {
    var dlg = $('#dlg');
    $('#dlg-title').textContent = title;
    $('#dlg-body').innerHTML = fieldsHtml;
    dlg.onclose = function () {
      if (dlg.returnValue !== 'ok') return;
      var vals = {};
      $$('#dlg-body [name]').forEach(function (i) { vals[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      onOk(vals);
    };
    dlg.showModal();
  }

  function discharge(p) {
    ask('Discharge ' + p.name + ' (room ' + p.room + ')',
      '<label>Discharge date <input type="date" name="date" required value="' + state.today + '"></label>' +
      '<p class="hint">Counted as a discharge on this date; the room is free from this date.</p>',
      function (v) { save('savePatient', Object.assign({}, p, { discharge: v.date, share: sharing(p) }), p.name + ' discharged on ' + short(v.date) + '.'); });
  }
  function extend(p) {
    ask('Extend the stay of ' + p.name,
      '<label>New planned discharge <input type="date" name="until" required value="' + (p.plannedDischarge || '') + '"></label>' +
      '<label>Extended on <input type="date" name="on" required value="' + state.today + '"></label>',
      function (v) {
        var ext = (p.extensions || []).concat(v.on);
        save('savePatient', Object.assign({}, p, { plannedDischarge: v.until, extensions: ext, share: sharing(p) }), 'Stay extended to ' + short(v.until) + '.');
      });
  }
  function remove(p) {
    if (confirm('Delete ' + p.name + '? Use this only for an entry made by mistake; it is removed from the report.')) {
      save('deletePatient', { id: p.id }, 'Deleted.');
    }
  }
  function markOut(room) {
    ask('Room ' + room + ': out of service',
      '<label>From <input type="date" name="from" required value="' + ($('#rooms-date').value || state.today) + '"></label>' +
      '<label>Until (blank = until put back) <input type="date" name="until"></label>' +
      '<label>Reason <input name="reason"></label>',
      function (v) { save('saveBlock', { room: room, from: v.from, until: v.until, reason: v.reason }, 'Room ' + room + ' marked out of service.'); });
  }

  /* ---------- patients list ---------- */

  var filter = 'inhouse';
  $$('#patient-filter button').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.f;
      $$('#patient-filter button').forEach(function (x) { x.classList.toggle('active', x === b); });
      renderPatients();
    });
  });
  $('#patient-search').addEventListener('input', renderPatients);

  function stateOf(p) {
    if (p.type === 'visit') return 'Walk-in visit';
    if (p.type === 'booking') return 'Booking';
    if (p.type === 'carried') return 'Discharged';
    if (p.discharge && p.discharge <= state.today) return 'Discharged';
    if (p.admission > state.today) return 'Admission (future)';
    return 'In house';
  }

  function renderPatients() {
    var q = $('#patient-search').value.trim().toLowerCase();
    var list = state.patients.filter(function (p) {
      var s = stateOf(p);
      if (filter === 'inhouse' && s !== 'In house' && s !== 'Admission (future)') return false;
      if (filter === 'booking' && p.type !== 'booking') return false;
      if (filter === 'visit' && p.type !== 'visit') return false;
      if (filter === 'discharged' && s !== 'Discharged') return false;
      return !q || [p.name, p.phone, p.room].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      return String(b.admission || b.plannedAdmission || b.visitDate).localeCompare(String(a.admission || a.plannedAdmission || a.visitDate));
    });
    var rows = list.map(function (p) {
      var s = stateOf(p);
      var acts = [];
      if (p.type === 'visit' || p.type === 'booking') acts.push('<button data-a="admit">Admit</button>');
      if (s === 'In house') acts.push('<button data-a="discharge">Discharge</button>', '<button data-a="extend">Extend</button>');
      acts.push('<button data-a="edit">Edit</button>', '<button data-a="delete" class="danger">Delete</button>');
      return '<tr data-id="' + esc(p.id) + '"><td><b>' + esc(p.name) + '</b><br><small>' + esc(p.phone) + '</small></td>' +
        '<td>' + esc(s) + '</td><td>' + esc(p.source) + '</td>' +
        '<td>' + esc(p.room) + '<br><small>' + esc(catOf(p.room)) + '</small></td>' +
        '<td>' + (p.type === 'admission' ? 'Admitted ' + short(p.admission) : p.type === 'carried' ? 'Admitted before 1 Oct' : p.type === 'booking' ? 'Planned ' + short(p.plannedAdmission) : 'Visited ' + short(p.visitDate)) +
        (p.plannedDischarge ? '<br><small>Planned discharge ' + short(p.plannedDischarge) + '</small>' : '') +
        (p.discharge ? '<br><small>Discharged ' + short(p.discharge) + '</small>' : '') + '</td>' +
        '<td class="acts">' + acts.join('') + '</td></tr>';
    });
    $('#patient-table').innerHTML = '<thead><tr><th>Patient</th><th>Status</th><th>Source</th><th>Room</th><th>Dates</th><th></th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="6" class="empty">Nothing here yet.</td></tr>') + '</tbody>';
  }
  $('#patient-table').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-a]');
    if (!btn) return;
    var id = btn.closest('tr').dataset.id;
    var p = state.patients.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    ({ admit: admitFrom, discharge: discharge, extend: extend, delete: remove,
      edit: function (x) { resetForm(x); showTab('entry'); } })[btn.dataset.a](p);
  });

  /* ---------- room board ---------- */

  function renderBoard() {
    var date = $('#rooms-date').value || state.today;
    $('#rooms-date').value = date;
    var board = Calc.roomBoard(date, state.categories, state.patients, state.blocks);
    $('#board').innerHTML = state.categories.map(function (c) {
      var rooms = board.filter(function (r) { return r.category === c.name; });
      var occ = rooms.filter(function (r) { return r.patients.length; }).length;
      return '<div class="cat"><h3>' + esc(c.name) + ' <small>' + occ + ' of ' + c.rooms.length + ' occupied</small></h3><div class="tiles">' +
        rooms.map(function (r) {
          var who = r.patients.map(function (p) { return esc(p.name); }).join('<br>') ||
            (r.status === 'discharged' ? r.leaving.map(function (p) { return esc(p.name); }).join('<br>') : r.status === 'out' ? esc(r.block.reason || 'Out of service') : '');
          return '<button class="tile ' + r.status + '" data-room="' + esc(r.room) + '"><b>' + esc(r.room) + '</b><span>' + who + '</span></button>';
        }).join('') + '</div></div>';
    }).join('');

    var blocks = state.blocks.slice().sort(function (a, b) { return String(b.from).localeCompare(String(a.from)); });
    $('#block-table').innerHTML = '<thead><tr><th>Room</th><th>Category</th><th>From</th><th>Until</th><th>Reason</th><th></th></tr></thead><tbody>' +
      (blocks.map(function (b) {
        return '<tr data-id="' + esc(b.id) + '"><td>' + esc(b.room) + '</td><td>' + esc(catOf(b.room)) + '</td><td>' + short(b.from) + '</td><td>' +
          (b.until ? short(b.until) : 'until put back') + '</td><td>' + esc(b.reason) + '</td><td class="acts">' +
          (!b.until ? '<button data-a="back">Put back in service</button>' : '') + '<button data-a="del" class="danger">Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="empty">No rooms out of service.</td></tr>') + '</tbody>';
  }
  $('#rooms-date').addEventListener('change', renderBoard);
  $('#board').addEventListener('click', function (e) {
    var tile = e.target.closest('.tile');
    if (!tile) return;
    var date = $('#rooms-date').value || state.today;
    var r = Calc.roomBoard(date, state.categories, state.patients, state.blocks).filter(function (x) { return x.room === tile.dataset.room; })[0];
    if (r.patients.length) {
      var p = r.patients[0];
      var others = r.patients.slice(1).map(function (x) { return x.name; });
      ask('Room ' + r.room + ': ' + r.patients.map(function (x) { return x.name; }).join(' and '),
        '<p>Admitted ' + fmtDate(p.admission) + (p.plannedDischarge ? ', planned discharge ' + fmtDate(p.plannedDischarge) : '') + '.</p>' +
        '<label>Action <select name="act"><option value="discharge">Discharge ' + esc(p.name) + '</option>' +
        '<option value="extend">Extend ' + esc(p.name) + '</option>' +
        (others.length ? '<option value="discharge2">Discharge ' + esc(others[0]) + '</option>' : '') +
        (r.patients.length < 2 ? '<option value="share">Admit a second patient (sharing)</option>' : '') + '</select></label>',
        function (v) {
          if (v.act === 'discharge') discharge(p);
          else if (v.act === 'extend') extend(p);
          else if (v.act === 'discharge2') discharge(r.patients[1]);
          else if (v.act === 'share') admitTo(r.room, date, true);
        });
    } else if (r.status === 'out') {
      ask('Room ' + r.room + ' is out of service', '<p>' + esc(r.block.reason || '') + '</p><label class="check"><input type="checkbox" name="back"> Put it back in service from ' + fmtDate(date) + '</label>',
        function (v) {
          if (v.back) save('saveBlock', Object.assign({}, r.block, { until: Calc.addDays(date, -1) < r.block.from ? r.block.from : Calc.addDays(date, -1) }), 'Room ' + r.room + ' back in service.');
        });
    } else {
      ask('Room ' + r.room + ' is free on ' + fmtDate(date),
        '<label>Action <select name="act"><option value="admit">Admit a patient</option><option value="out">Mark out of service</option></select></label>',
        function (v) { if (v.act === 'admit') admitTo(r.room, date, false); else markOut(r.room); });
    }
  });
  $('#block-table').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-a]');
    if (!btn) return;
    var b = state.blocks.filter(function (x) { return x.id === btn.closest('tr').dataset.id; })[0];
    if (btn.dataset.a === 'del') { if (confirm('Delete this out-of-service entry?')) save('deleteBlock', { id: b.id }, 'Deleted.'); }
    else ask('Put room ' + b.room + ' back in service', '<label>Last day out of service <input type="date" name="until" required value="' + Calc.addDays(state.today, -1) + '"></label>',
      function (v) { save('saveBlock', Object.assign({}, b, { until: v.until }), 'Room ' + b.room + ' back in service.'); });
  });

  function admitTo(room, date, share) {
    resetForm();
    form.admission.value = date;
    syncFields();
    form.room.value = room;
    form.share.checked = share;
    showTab('entry');
    form.name.focus();
  }

  /* ---------- report ---------- */

  function renderReport() {
    var date = $('#report-date').value || state.today;
    $('#report-date').value = date;
    $('#plan-value').value = state.plan[date] !== undefined ? state.plan[date] : '';
    var cols = Calc.columns(state.categories);
    var v = Calc.day(date, state.categories, state.patients, state.blocks, state.plan);
    var cards = [
      ['Total rooms', v.totalRooms], ['Occupied rooms', v.totalOccupied], ['Available rooms', v.totalAvailable],
      ['Out of service', v.totalOutOfService], ['Walk-in (PCE) admitted', v['src:' + Calc.SOURCES[0]]],
      ['Walk-in visits', v.walkInVisits], ['Admitted', v.admitted], ['Discharged', v.discharged],
      ['Patients in house', v.inHousePatients], ['In-house occupancy', Math.round(v.inHouseOccupancy * 100) + '%']
    ];
    $('#summary').innerHTML = cards.map(function (c) { return '<div class="stat"><span>' + c[0] + '</span><b>' + c[1] + '</b></div>'; }).join('');

    $('#cat-table').innerHTML = '<thead><tr><th>Category</th><th>Total</th><th>Occupied</th><th>Out of service</th><th>Available</th><th>Admitted</th></tr></thead><tbody>' +
      state.categories.map(function (c) {
        var occ = v['occ:' + c.name], oos = v['oos:' + c.name];
        return '<tr><td>' + esc(c.name) + '</td><td>' + c.rooms.length + '</td><td>' + occ + '</td><td>' + oos + '</td><td>' +
          (c.rooms.length - occ - oos) + '</td><td>' + v['adm:' + c.name] + '</td></tr>';
      }).join('') +
      '<tr class="total"><td>Total</td><td>' + v.totalRooms + '</td><td>' + v.totalOccupied + '</td><td>' + v.totalOutOfService + '</td><td>' +
      v.totalAvailable + '</td><td>' + v.admitted + '</td></tr></tbody>';

    var month = date.slice(0, 7);
    var first = month + '-01';
    var last = Calc.addDays(Calc.addDays(first, 32).slice(0, 7) + '-01', -1);
    var days = Calc.datesBetween(first, last).map(function (d) { return Calc.day(d, state.categories, state.patients, state.blocks, state.plan); });
    $('#month-title').textContent = new Date(+month.slice(0, 4), +month.slice(5) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    $('#month-table').innerHTML = '<thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      days.map(function (row) {
        return '<tr class="' + (row.date === date ? 'sel' : '') + '">' + cols.map(function (c) { return '<td>' + cell(c, row) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
    renderReport.days = days; renderReport.cols = cols; renderReport.month = month;
  }
  function cell(c, row) {
    if (c.key === 'date') return short(row.date);
    if (c.kind === 'percent') return Math.round(row[c.key] * 100) + '%';
    return row[c.key] === '' ? '' : esc(row[c.key]);
  }
  $('#report-date').addEventListener('change', renderReport);
  $('#plan-save').addEventListener('click', function () {
    save('savePlan', { date: $('#report-date').value, plan: $('#plan-value').value }, 'Plan saved.');
  });
  $('#csv').addEventListener('click', function () {
    var cols = renderReport.cols;
    var lines = [cols.map(function (c) { return '"' + c.label.replace(/"/g, '""') + '"'; }).join(',')].concat(renderReport.days.map(function (row) {
      return cols.map(function (c) { return c.kind === 'percent' ? (row[c.key] * 100).toFixed(1) + '%' : row[c.key]; }).join(',');
    }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'IP Report ' + renderReport.month + '.csv';
    a.click();
  });

  /* ---------- start ---------- */

  $('#mode').textContent = DEMO ? 'Practice mode: saved in this browser only' : '';
  resetForm();
  renderAll();
  status('Loading…');
  load().then(function (d) { apply(d); resetForm(); if (DEMO || d.version >= BACKEND_VERSION) status(''); }).catch(function (e) { status('Could not load the sheet: ' + e.message, 'error'); });
})();
