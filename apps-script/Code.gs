/**
 * Ritlog ↔ Google Sheet koppeling / connection.
 *
 * 1. Plak dit in de Sheet via Extensies → Apps Script en klik op Opslaan.
 * 2. Implementeren → Nieuwe implementatie → Web-app, "Wie heeft toegang": Iedereen.
 * 3. Open de Web-app-link die Google toont en scan de QR-code met je telefoon.
 *
 * Er hoeft niets aangepast te worden. De Web-app-link zelf is de sleutel:
 * deel hem alleen met je eigen telefoon.
 */
const APP_URL = 'https://chenxi981211-ui.github.io/ritlog/';
const TOKEN = '';      // optioneel: extra geheime code (leeg = de link is de sleutel)
const SHEET_NAME = ''; // leeg = automatisch het tabblad met de kolom "Afstand (km)"

const HEADERS = {
  ts: 'Tijdstempel', desc: 'Beschrijving', date: 'Datum', tripNo: 'Rit-nr', start: 'Starttijd', end: 'Eindtijd',
  km: 'Afstand (km)', detourBiz: 'I.v.t. Zakelijke Omrijkilometers', detourPriv: 'I.v.t. Privé Omrijkilometers',
  odoStart: 'Beginstand km-teller', odoEnd: 'Eindstand km-teller', fee: 'Vergoeding',
  from: 'Vertrekadres', to: 'Aankomstadres', type: 'Type rit', car: 'Auto', plate: 'Kenteken', driver: 'Rijder',
};
const NUMERIC = ['tripNo', 'km', 'detourBiz', 'detourPriv', 'odoStart', 'odoEnd', 'fee'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.action) return connectPage_(); // geopend in de browser → koppelpagina met QR-code
  return handle_(p);
}
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { /* lege body */ }
  return handle_(p);
}

function handle_(p) {
  try {
    if (TOKEN && p.token !== TOKEN) return out_({ ok: false, error: 'Ongeldige code (token)' });
    const sheet = getSheet_(p.sheet);
    const cols = columns_(sheet);
    switch (p.action) {
      case 'ping': return out_({ ok: true, sheet: sheet.getName(), tabs: tripTabs_().map((t) => t.getName()) });
      case 'list': return out_({ ok: true, sheet: sheet.getName(), headers: headers_(sheet), rows: list_(sheet, cols, Number(p.limit) || 300) });
      case 'add': return locked_(() => out_({ ok: true, row: add_(sheet, cols, p.trip || {}) }));
      case 'update': return locked_(() => out_({ ok: true, row: update_(sheet, cols, p.orig || {}, p.trip || {}) }));
      case 'delete': return locked_(() => { remove_(sheet, cols, p.orig || {}); return out_({ ok: true }); });
      default: return out_({ ok: false, error: 'Onbekende actie: ' + p.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

// Welk tabblad: gekozen in de app (p.sheet) → SHEET_NAME → anders het tabblad
// met de meeste herkende kolommen (bij gelijkspel het eerste).
function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const wanted = name || SHEET_NAME;
  if (wanted) {
    const s = ss.getSheetByName(wanted);
    if (s) return s;
    if (!name) throw new Error('Tabblad niet gevonden: ' + wanted);
  }
  const tabs = tripTabs_();
  if (!tabs.length) throw new Error('Geen tabblad met de kolom "' + HEADERS.km + '" gevonden');
  return tabs[0];
}

// Tabbladen met ritten, beste match eerst
function tripTabs_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .map((s, i) => ({ s, i, cols: s.getLastColumn() ? columns_(s) : {} }))
    .filter((x) => x.cols.km && x.cols.from && x.cols.date)
    .sort((a, b) => Object.keys(b.cols).length - Object.keys(a.cols).length || a.i - b.i)
    .map((x) => x.s);
}

function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map((h) => h.trim());
}

function columns_(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map((h) => h.trim());
  // Kolomnaam mag extra tekst hebben, bijv. "Vergoeding (€0,25/km)"
  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
  const cols = {};
  Object.keys(HEADERS).forEach((k) => {
    const want = norm(HEADERS[k]);
    let i = head.findIndex((h) => norm(h) === want);
    if (i < 0) i = head.findIndex((h) => norm(h).startsWith(want + ' ') || norm(h).startsWith(want + '('));
    if (i >= 0) cols[k] = i + 1;
  });
  return cols;
}

function rowObj_(display, cols, rowNum) {
  const o = { _row: rowNum };
  Object.keys(cols).forEach((k) => { o[k] = display[cols[k] - 1]; });
  // Waarmee de app deze rij later terugvindt (voor bewerken/verwijderen)
  o.orig = { ts: o.ts || '', date: o.date || '', start: o.start || '', tripNo: o.tripNo || '', from: (o.from || '').trim() };
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
  const r = insertPosition_(sheet, cols, trip);
  sheet.insertRowBefore(r);
  // Opmaak (en eventuele formules) overnemen van een naburige rit
  const t = isDataRow_(sheet, cols, r + 1) ? r + 1 : (r - 1 >= 2 && isDataRow_(sheet, cols, r - 1) ? r - 1 : 0);
  let templFormulas = [];
  if (t) {
    const templ = sheet.getRange(t, 1, 1, lastCol);
    templ.copyTo(sheet.getRange(r, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    templFormulas = templ.getFormulasR1C1()[0];
  }
  writeTrip_(sheet, cols, r, trip, true, templFormulas);
  fixTotals_(sheet, cols, lastCol);
  SpreadsheetApp.flush();
  return rowObj_(sheet.getRange(r, 1, 1, lastCol).getDisplayValues()[0], cols, r);
}

// Nieuwste ritten staan bovenaan: sorteer op datum, dan rit-nr (aflopend).
// Een later ingevulde rit (bijv. vergeten rit 2) komt zo op de juiste plek.
function insertPosition_(sheet, cols, trip) {
  const last = sheet.getLastRow();
  if (last < 2 || !cols.date) return 2;
  const values = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  const key = sortKey_(trip.date, trip.tripNo);
  let lastData = 1;
  for (let i = 0; i < values.length; i++) {
    const d = values[i][cols.date - 1];
    if (!d) continue;
    lastData = i + 2;
    const rk = sortKey_(d, cols.tripNo ? values[i][cols.tripNo - 1] : 0);
    if (rk < key) return i + 2;
  }
  return lastData + 1;
}

function sortKey_(date, tripNo) {
  let y, m, d;
  let x = String(date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = String(date || '').match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else return 0;
  return (y * 10000 + m * 100 + d) * 1000 + (parseInt(String(tripNo || '').replace(/\D/g, ''), 10) || 0);
}

function isDataRow_(sheet, cols, r) {
  if (r < 2 || r > sheet.getLastRow() || !cols.date) return false;
  return sheet.getRange(r, cols.date).getDisplayValue() !== '';
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
    if (!orig.ts && orig.date && get(v, 'date') === orig.date && get(v, 'start') === (orig.start || '') &&
        get(v, 'tripNo') === String(orig.tripNo || '') && get(v, 'from') === orig.from) return i + 2;
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
// Totaalrij onderaan (bijv. =SUM(E2:E28)): laat het bereik altijd alle ritten
// omvatten, van rij 2 tot de rij boven het totaal, waar de nieuwe rit ook staat.
function fixTotals_(sheet, cols, lastCol) {
  const last = sheet.getLastRow();
  if (last <= 3 || isDataRow_(sheet, cols, last)) return;
  const formulas = sheet.getRange(last, 1, 1, lastCol).getFormulas()[0];
  formulas.forEach((f, i) => {
    if (!f) return;
    const fixed = f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+):(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
      (m, d1, a, d2, n1, d3, b, d4) => (a === b && +n1 <= 3 ? d1 + a + d2 + '2:' + d3 + b + d4 + (last - 1) : m));
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

/* ---------- koppelen met de telefoon ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ritlog')
    .addItem('Telefoon koppelen / Connect phone', 'showConnectDialog')
    .addToUi();
}

function showConnectDialog() {
  const html = connectHtml_();
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(380).setHeight(560), 'Ritlog');
}

function connectPage_() {
  return HtmlService.createHtmlOutput(connectHtml_())
    .setTitle('Ritlog koppelen')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function connectHtml_() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    return '<p style="font-family:sans-serif">Nog niet geïmplementeerd. Kies eerst <b>Implementeren → Nieuwe implementatie → Web-app</b>.<br><br>' +
      'Not deployed yet. First choose <b>Deploy → New deployment → Web app</b>.</p>';
  }
  let name = '';
  try { name = getSheet_().getParent().getName(); } catch (err) { /* geen geschikt tabblad */ }
  const link = APP_URL + '#connect=' + encodeURIComponent(url) + (TOKEN ? '&token=' + encodeURIComponent(TOKEN) : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' +
    '<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:20px;color:#15201e;text-align:center}' +
    'h1{font-size:22px;margin:4px 0}p{color:#5d6b68;font-size:15px;line-height:1.4;margin:6px 0}' +
    '#qr{display:inline-block;padding:12px;background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.12);margin:14px 0}' +
    'a.btn,button{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:14px;border-radius:12px;border:0;font:600 16px sans-serif;text-decoration:none;cursor:pointer}' +
    'a.btn{background:#0f766e;color:#fff}button{background:#d9efec;color:#0f766e}.ok{color:#15803d;font-weight:700}</style></head><body>' +
    '<p class="ok">✓ Klaar / Ready' + (name ? ' — ' + esc(name) : '') + '</p>' +
    '<h1>Scan met je iPhone-camera</h1><p>Scan with your iPhone camera</p>' +
    '<div id="qr"></div>' +
    '<a class="btn" target="_top" href="' + esc(link) + '">Open Ritlog op dit apparaat / on this device</a>' +
    '<button id="copy">Kopieer koppel-link / Copy link</button>' +
    '<p style="font-size:13px">Gebruik je Ritlog vanaf het beginscherm? Kopieer de link en plak hem in de app.<br>' +
    'Using Ritlog from the home screen? Copy the link and paste it in the app.</p>' +
    '<script>var L=' + JSON.stringify(link) + ';' +
    'new QRCode(document.getElementById("qr"),{text:L,width:220,height:220,correctLevel:QRCode.CorrectLevel.L});' +
    'document.getElementById("copy").onclick=function(){var b=this;(navigator.clipboard?navigator.clipboard.writeText(L):Promise.reject()).then(function(){b.textContent="✓ Gekopieerd / Copied"},function(){prompt("Link:",L)})};' +
    '</script></body></html>';
}
