/**
 * Ritlog ↔ Google Sheet koppeling.
 *
 * Plak dit in de Sheet via Extensies → Apps Script, verander TOKEN in een
 * eigen geheime code, en publiceer als Web-app (zie README.md).
 * Nieuwe ritten komen bovenaan (rij 2), net als de bestaande ritten.
 */
const TOKEN = 'VERANDER-DIT-IN-EEN-GEHEIME-CODE';
const SHEET_NAME = ''; // leeg = automatisch het tabblad met de kolom "Afstand (km)"

const HEADERS = {
  ts: 'Tijdstempel', desc: 'Beschrijving', date: 'Datum', start: 'Starttijd', end: 'Eindtijd',
  km: 'Afstand (km)', detourBiz: 'I.v.t. Zakelijke Omrijkilometers', detourPriv: 'I.v.t. Privé Omrijkilometers',
  odoStart: 'Beginstand km-teller', odoEnd: 'Eindstand km-teller', fee: 'Vergoeding',
  from: 'Vertrekadres', to: 'Aankomstadres', type: 'Type rit', car: 'Auto', plate: 'Kenteken', driver: 'Rijder',
};
const NUMERIC = ['km', 'detourBiz', 'detourPriv', 'odoStart', 'odoEnd', 'fee'];

function doGet(e) { return handle_((e && e.parameter) || {}); }
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { /* lege body */ }
  return handle_(p);
}

function handle_(p) {
  try {
    if (!p.token || p.token !== TOKEN) return out_({ ok: false, error: 'Ongeldige code (token)' });
    const sheet = getSheet_();
    const cols = columns_(sheet);
    switch (p.action) {
      case 'ping': return out_({ ok: true, sheet: sheet.getName() });
      case 'list': return out_({ ok: true, rows: list_(sheet, cols, Number(p.limit) || 300) });
      case 'add': return locked_(() => out_({ ok: true, row: add_(sheet, cols, p.trip || {}) }));
      case 'update': return locked_(() => out_({ ok: true, row: update_(sheet, cols, p.orig || {}, p.trip || {}) }));
      case 'delete': return locked_(() => { remove_(sheet, cols, p.orig || {}); return out_({ ok: true }); });
      default: return out_({ ok: false, error: 'Onbekende actie: ' + p.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (SHEET_NAME) {
    const s = ss.getSheetByName(SHEET_NAME);
    if (!s) throw new Error('Tabblad niet gevonden: ' + SHEET_NAME);
    return s;
  }
  const hit = ss.getSheets().find((s) => {
    const head = s.getRange(1, 1, 1, Math.max(1, s.getLastColumn())).getDisplayValues()[0].map((h) => h.trim());
    return head.indexOf(HEADERS.km) >= 0 && head.indexOf(HEADERS.from) >= 0;
  });
  if (!hit) throw new Error('Geen tabblad met de kolom "' + HEADERS.km + '" gevonden');
  return hit;
}

function columns_(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map((h) => h.trim());
  const cols = {};
  Object.keys(HEADERS).forEach((k) => { const i = head.indexOf(HEADERS[k]); if (i >= 0) cols[k] = i + 1; });
  return cols;
}

function rowObj_(display, cols, rowNum) {
  const o = { _row: rowNum };
  Object.keys(cols).forEach((k) => { o[k] = display[cols[k] - 1]; });
  // Waarmee de app deze rij later terugvindt (voor bewerken/verwijderen)
  o.orig = { ts: o.ts || '', date: o.date || '', start: o.start || '', from: (o.from || '').trim() };
  return o;
}

function list_(sheet, cols, limit) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  const rows = [];
  for (let i = 0; i < values.length && rows.length < limit; i++) {
    if (cols.date && !values[i][cols.date - 1]) continue; // totaalrij / lege rij overslaan
    rows.push(rowObj_(values[i], cols, i + 2));
  }
  return rows;
}

function add_(sheet, cols, trip) {
  const lastCol = sheet.getLastColumn();
  const hasTemplate = sheet.getLastRow() >= 2;
  sheet.insertRowBefore(2);
  let templFormulas = [];
  if (hasTemplate) {
    // Opmaak (en eventuele formules) overnemen van de vorige bovenste rit, nu rij 3
    const templ = sheet.getRange(3, 1, 1, lastCol);
    templ.copyTo(sheet.getRange(2, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    templFormulas = templ.getFormulasR1C1()[0];
  }
  writeTrip_(sheet, cols, 2, trip, true, templFormulas);
  fixTotals_(sheet, lastCol);
  SpreadsheetApp.flush();
  return rowObj_(sheet.getRange(2, 1, 1, lastCol).getDisplayValues()[0], cols, 2);
}

function update_(sheet, cols, orig, trip) {
  const r = findRow_(sheet, cols, orig);
  writeTrip_(sheet, cols, r, trip, false, []);
  SpreadsheetApp.flush();
  return rowObj_(sheet.getRange(r, 1, 1, sheet.getLastColumn()).getDisplayValues()[0], cols, r);
}

function remove_(sheet, cols, orig) {
  sheet.deleteRow(findRow_(sheet, cols, orig));
}

function findRow_(sheet, cols, orig) {
  const last = sheet.getLastRow();
  const values = sheet.getRange(2, 1, Math.max(1, last - 1), sheet.getLastColumn()).getDisplayValues();
  const get = (row, k) => (cols[k] ? String(row[cols[k] - 1]).trim() : '');
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (orig.ts && get(v, 'ts') === orig.ts) return i + 2;
    if (!orig.ts && orig.date && get(v, 'date') === orig.date && get(v, 'start') === orig.start && get(v, 'from') === orig.from) return i + 2;
  }
  throw new Error('Rit niet gevonden in de Sheet (misschien handmatig gewijzigd)');
}

function writeTrip_(sheet, cols, r, trip, isNew, templFormulas) {
  const tz = sheet.getParent().getSpreadsheetTimeZone();
  const existing = sheet.getRange(r, 1, 1, sheet.getLastColumn()).getFormulas()[0];
  Object.keys(cols).forEach((k) => {
    const c = cols[k];
    const cell = sheet.getRange(r, c);
    // Kolommen met een formule laten we met rust (bijv. een berekende vergoeding)
    if (templFormulas[c - 1]) { cell.setFormulaR1C1(templFormulas[c - 1]); return; }
    if (!isNew && existing[c - 1]) return;
    let val;
    if (k === 'ts') { if (!isNew) return; val = new Date(); }
    else if (k === 'date') val = trip.date ? Utilities.parseDate(trip.date, tz, 'yyyy-MM-dd') : '';
    else if (NUMERIC.indexOf(k) >= 0) val = trip[k] === '' || trip[k] == null ? '' : Number(trip[k]);
    else val = trip[k] == null ? '' : String(trip[k]);
    if (val === undefined) return;
    cell.setValue(val);
  });
}

// Totaalrij onderaan (bijv. =SUM(F2:F22)) weer laten beginnen bij rij 2,
// want een rij invoegen boven rij 2 schuift het bereik naar F3.
function fixTotals_(sheet, lastCol) {
  const last = sheet.getLastRow();
  if (last <= 3) return;
  const range = sheet.getRange(last, 1, 1, lastCol);
  const formulas = range.getFormulas()[0];
  formulas.forEach((f, i) => {
    if (!f) return;
    const fixed = f.replace(/(\$?)([A-Z]{1,3})(\$?)3:(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, d1, a, d2, d3, b, d4, n) => (a === b ? d1 + a + d2 + '2:' + d3 + b + d4 + n : m));
    if (fixed !== f) sheet.getRange(last, i + 1).setFormula(fixed);
  });
}

function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
