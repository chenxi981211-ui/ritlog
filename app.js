/* Ritlog — rittenregistratie voor de auto van de zaak.
   Vanilla JS, geen build. Data staat in localStorage en wordt via een
   Google Apps Script web-app naar de Google Sheet gestuurd. */
(() => {
  'use strict';

  const STORE_KEY = 'ritlog.v1';
  const I18N = window.RitlogI18n;
  const tr = I18N.t;
  const CFG = window.RITLOG_CONFIG || {};
  const PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';
  const OSRM = 'https://router.project-osrm.org/route/v1/driving';

  // Sheet-kolommen in dezelfde volgorde als de Google Sheet
  const COLUMNS = [
    ['ts', 'Tijdstempel'], ['desc', 'Beschrijving'], ['date', 'Datum'], ['start', 'Starttijd'],
    ['end', 'Eindtijd'], ['km', 'Afstand (km)'], ['detourBiz', 'I.v.t. Zakelijke Omrijkilometers'],
    ['detourPriv', 'I.v.t. Privé Omrijkilometers'], ['odoStart', 'Beginstand km-teller'],
    ['odoEnd', 'Eindstand km-teller'], ['fee', 'Vergoeding'], ['from', 'Vertrekadres'],
    ['to', 'Aankomstadres'], ['type', 'Type rit'], ['car', 'Auto'], ['plate', 'Kenteken'], ['driver', 'Rijder'],
  ];

  /* ---------- helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => isoDate(new Date());
  const monthKey = (iso) => iso.slice(0, 7);
  const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return isNaN(h) ? null : h * 60 + (m || 0); };
  const fromMin = (min) => { min = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; };
  const round5 = (min) => Math.round(min / 5) * 5;
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  const nf2 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
  const fmtKm = (n) => (n == null || n === '' || isNaN(n) ? '' : nf2.format(n));
  const fmtEur = (n) => '€ ' + nf2.format(n || 0);
  const fmtOdo = (n) => (n == null || n === '' || isNaN(n) ? '' : nf0.format(n));
  // "22,60 km" → 22.6 ; "1.234,5" → 1234.5 ; "22.6" → 22.6
  const parseDec = (s) => {
    if (typeof s === 'number') return s;
    s = String(s || '').replace(/[^\d,.\-]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };
  // km-teller: "147.976 km" → 147976
  const parseInt0 = (s) => { if (typeof s === 'number') return s; const d = String(s || '').replace(/\D/g, ''); return d ? parseInt(d, 10) : null; };
  // "9-10-2026" → "2026-10-09"
  const parseSheetDate = (s) => {
    s = String(s || '').trim();
    let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : '';
  };
  const parseSheetTime = (s) => { const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : ''; };
  const sheetDate = (iso) => { const [y, m, d] = iso.split('-'); return `${+d}-${+m}-${y}`; };
  const dayLabel = (iso) => new Date(iso + 'T12:00').toLocaleDateString(I18N.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const monthLabel = (key) => new Date(key + '-15T12:00').toLocaleDateString(I18N.locale(), { month: 'long', year: 'numeric' });

  let toastTimer;
  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  async function fetchJSON(url, opts = {}, timeout = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  /* ---------- state ---------- */
  function defaultState() {
    const routes = {};
    (CFG.knownRoutes || []).forEach(([a, b, km, min]) => { routes[norm(a) + '→' + norm(b)] = { km, min, n: 1, seed: true }; });
    return {
      settings: {
        scriptUrl: CFG.scriptUrl || '', token: CFG.token || '',
        rate: CFG.rate ?? 0.25, car: CFG.car || '', plate: CFG.plate || '', driver: CFG.driver || '',
        defaultType: CFG.defaultType || 'Zakelijk', voiceLang: CFG.voiceLang || 'nl-NL',
      },
      lastOdo: CFG.lastOdo || null,
      places: (CFG.places || []).map((p) => ({ id: uid(), aliases: [], role: '', ...p })),
      routes,
      trips: [],
      lastPull: null,
    };
  }
  let state;
  try { state = JSON.parse(localStorage.getItem(STORE_KEY)) || defaultState(); } catch { state = defaultState(); }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); } };

  const liveTrips = () => state.trips.filter((t) => t.sync !== 'delete');
  const sortTrips = (arr) => arr.sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const placeByAddress = (addr) => state.places.find((p) => norm(p.address) === norm(addr));
  const placeByRole = (role) => state.places.find((p) => p.role === role);
  const placeName = (addr) => placeByAddress(addr)?.name || String(addr || '').split(',')[0];

  function latestOdo() {
    let max = state.lastOdo || 0;
    liveTrips().forEach((t) => { if (t.odoEnd > max) max = t.odoEnd; });
    return max || null;
  }

  /* ---------- routes / distance ---------- */
  function learnRoute(from, to, km, min) {
    if (!from || !to || !km) return;
    const key = norm(from) + '→' + norm(to);
    const r = state.routes[key];
    if (!r || r.seed) state.routes[key] = { km, min: min || r?.min || null, n: 1 };
    else { r.km = km; r.min = min || r.min; r.n += 1; }
  }
  function knownRoute(from, to) {
    return state.routes[norm(from) + '→' + norm(to)] || null;
  }

  const geoCache = {};
  async function geocode(addr) {
    const key = norm(addr);
    if (geoCache[key]) return geoCache[key];
    const place = placeByAddress(addr);
    if (place?.lat) return (geoCache[key] = { lat: place.lat, lon: place.lon });
    const data = await fetchJSON(`${PDOK}/free?rows=1&q=${encodeURIComponent(addr)}`);
    const doc = data.response?.docs?.[0];
    const m = doc?.centroide_ll?.match(/POINT\(([\d.\-]+) ([\d.\-]+)\)/);
    if (!m) throw new Error(tr('Adres niet gevonden: {a}', { a: addr }));
    return (geoCache[key] = { lon: +m[1], lat: +m[2] });
  }
  async function routeDistance(from, to) {
    const [a, b] = await Promise.all([geocode(from), geocode(to)]);
    const data = await fetchJSON(`${OSRM}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
    const r = data.routes?.[0];
    if (!r) throw new Error(tr('Geen route gevonden'));
    return { km: Math.round(r.distance / 10) / 100, min: Math.round(r.duration / 60) };
  }
  const tidyAddress = (s) => String(s || '').replace(/,?\s*\d{4}\s?[A-Z]{2}\b/, ',').replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/,\s*/g, ', ').trim();

  async function suggestAddresses(q) {
    const data = await fetchJSON(`${PDOK}/suggest?rows=5&fq=type:(adres OR weg OR woonplaats OR postcode)&q=${encodeURIComponent(q)}`, {}, 6000);
    return (data.response?.docs || []).map((d) => tidyAddress(d.weergavenaam));
  }
  async function reverseGeocode(lat, lon) {
    const near = state.places.find((p) => p.lat && haversine(lat, lon, p.lat, p.lon) < 0.15);
    if (near) return near.address;
    const data = await fetchJSON(`${PDOK}/reverse?type=adres&rows=1&lat=${lat}&lon=${lon}`);
    const doc = data.response?.docs?.[0];
    if (!doc) throw new Error(tr('Geen adres gevonden'));
    return tidyAddress(doc.weergavenaam);
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, toR = (x) => (x * Math.PI) / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error(tr('Locatie niet beschikbaar')));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => reject(new Error(tr('Geen toegang tot locatie'))),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
      );
    });
  }

  /* ---------- navigation ---------- */
  function go(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.go === name));
    $('#screen-title').textContent = tr($('#screen-' + name).dataset.title);
    if (name === 'trips') renderTrips();
    if (name === 'summary') renderSummary();
    if (name === 'settings') renderSettings();
    window.scrollTo({ top: 0 });
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) go(g.dataset.go);
  });

  /* ---------- trip form ---------- */
  const form = $('#trip-form');
  const F = (name) => form.elements[name];
  let descDirty = false, odoEndDirty = false, editingId = null, distanceReq = 0;

  function autoDesc() {
    const from = placeByAddress(F('from').value), to = placeByAddress(F('to').value);
    if (from?.role === 'home' && to?.role === 'work') return 'Van huis naar werk';
    if (from?.role === 'work' && to?.role === 'home') return 'Van werk naar huis';
    if (to?.role === 'home') return 'Naar huis';
    if (to?.role === 'work') return 'Naar werk';
    if (F('to').value) return 'Naar ' + placeName(F('to').value);
    return '';
  }
  function setType(type) {
    F('type').value = type;
    $$('#type-seg button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
  }
  function updateFee() {
    const km = parseDec(F('km').value);
    const parts = [];
    if (km) parts.push(fmtKm(km) + ' km', fmtEur(km * state.settings.rate));
    if (F('from').value && F('to').value) parts.unshift(placeName(F('from').value) + ' → ' + placeName(F('to').value));
    $('#save-summary').textContent = parts.join(' · ');
  }
  function updateOdoEnd() {
    if (odoEndDirty) return;
    const start = parseInt0(F('odoStart').value), km = parseDec(F('km').value);
    F('odoEnd').value = start && km ? fmtOdo(start + Math.round(km)) : '';
  }
  function setTimesForDuration(min) {
    if (!min) return;
    if (editingId) return;
    // Standaard: rit is net afgelopen → eindtijd nu, starttijd terugrekenen.
    const isToday = F('date').value === todayISO();
    const end = toMin(F('end').value) ?? round5(nowMin());
    if (isToday && !F('end').dataset.touched) F('end').value = fromMin(round5(nowMin()));
    if (!F('start').dataset.touched) F('start').value = fromMin(round5((toMin(F('end').value) ?? end) - min));
  }

  async function updateDistance(force = false) {
    const from = F('from').value.trim(), to = F('to').value.trim();
    if (!descDirty) F('desc').value = autoDesc();
    updateFee();
    if (!from || !to) return;
    const hint = $('#km-hint');
    const known = !force && (knownRoute(from, to) || knownRoute(to, from));
    if (known) {
      F('km').value = fmtKm(known.km);
      hint.textContent = tr('Op basis van eerdere ritten');
      hint.classList.remove('warn');
      setTimesForDuration(known.min);
      updateOdoEnd(); updateFee();
      return;
    }
    const req = ++distanceReq;
    hint.textContent = tr('Route berekenen…');
    hint.classList.remove('warn');
    try {
      const r = await routeDistance(from, to);
      if (req !== distanceReq) return;
      F('km').value = fmtKm(r.km);
      hint.textContent = tr('Berekend via snelste route (~{min} min) — pas aan indien nodig', { min: r.min });
      setTimesForDuration(r.min);
      updateOdoEnd(); updateFee();
    } catch (err) {
      if (req !== distanceReq) return;
      hint.textContent = navigator.onLine ? tr('Kon afstand niet berekenen: {e}', { e: err.message }) : tr('Offline — vul de afstand zelf in');
      hint.classList.add('warn');
    }
  }

  function resetForm(prefill = {}) {
    editingId = null; descDirty = false; odoEndDirty = false;
    form.reset();
    F('id').value = '';
    delete F('start').dataset.touched; delete F('end').dataset.touched;
    const s = state.settings;
    F('date').value = todayISO();
    F('end').value = fromMin(round5(nowMin()));
    F('start').value = fromMin(round5(nowMin() - 30));
    F('car').value = s.car; F('plate').value = s.plate; F('driver').value = s.driver;
    F('odoStart').value = fmtOdo(latestOdo());
    setType(s.defaultType);
    $('#km-hint').textContent = '';
    $('#save-btn').textContent = tr('Rit opslaan');
    $('#delete-btn').classList.add('hidden');
    $('#cancel-edit-btn').classList.add('hidden');
    $('#repeat-btn').classList.add('hidden');
    Object.entries(prefill).forEach(([k, v]) => { if (F(k) && v != null) F(k).value = v; });
    if (prefill.type) setType(prefill.type);
    updateFee();
    if (F('from').value && F('to').value) updateDistance();
  }

  function fillFromTrip(t, asEdit) {
    resetForm();
    const vals = { ...t, km: fmtKm(t.km), odoStart: fmtOdo(t.odoStart), odoEnd: fmtOdo(t.odoEnd), detourBiz: fmtKm(t.detourBiz), detourPriv: fmtKm(t.detourPriv) };
    ['from', 'to', 'desc', 'km', 'detourBiz', 'detourPriv', 'car', 'plate', 'driver'].forEach((k) => { F(k).value = vals[k] ?? ''; });
    setType(t.type || state.settings.defaultType);
    descDirty = true;
    if (asEdit) {
      editingId = t.id;
      F('id').value = t.id;
      ['date', 'start', 'end', 'odoStart', 'odoEnd'].forEach((k) => { F(k).value = vals[k] ?? ''; });
      odoEndDirty = true;
      $('#save-btn').textContent = tr('Wijziging opslaan');
      $('#delete-btn').classList.remove('hidden');
      $('#cancel-edit-btn').classList.remove('hidden');
      $('#repeat-btn').classList.remove('hidden');
    } else {
      const dur = (toMin(t.end) - toMin(t.start) + 1440) % 1440 || 30;
      F('end').value = fromMin(round5(nowMin()));
      F('start').value = fromMin(round5(nowMin() - dur));
      updateOdoEnd();
    }
    updateFee();
    go('new');
  }

  function readForm() {
    const v = (k) => F(k).value.trim();
    const km = parseDec(v('km'));
    return {
      desc: v('desc'), date: v('date'), start: v('start'), end: v('end'), km,
      detourBiz: parseDec(v('detourBiz')), detourPriv: parseDec(v('detourPriv')),
      odoStart: parseInt0(v('odoStart')), odoEnd: parseInt0(v('odoEnd')),
      fee: km ? Math.round(km * state.settings.rate * 100) / 100 : 0,
      from: v('from'), to: v('to'), type: F('type').value || state.settings.defaultType,
      car: v('car'), plate: v('plate'), driver: v('driver'),
    };
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = readForm();
    const missing = [];
    if (!data.from) missing.push(tr('vertrekadres'));
    if (!data.to) missing.push(tr('aankomstadres'));
    if (!data.date) missing.push(tr('datum'));
    if (!data.start || !data.end) missing.push(tr('tijden'));
    if (!data.km) missing.push(tr('afstand'));
    if (missing.length) return toast(tr('Vul nog in: {f}', { f: missing.join(', ') }));

    const dur = (toMin(data.end) - toMin(data.start) + 1440) % 1440;
    learnRoute(data.from, data.to, data.km, dur || null);
    const stamp = new Date().toISOString();

    if (editingId) {
      const t = state.trips.find((x) => x.id === editingId);
      if (t) {
        Object.assign(t, data, { modified: stamp });
        if (t.sync === 'synced' || t.sync === 'error-update') t.sync = 'update';
        else if (t.sync === 'local' && state.settings.scriptUrl) t.sync = 'add';
      }
      toast(tr('Rit bijgewerkt'));
    } else {
      state.trips.push({ id: uid(), ...data, created: stamp, modified: stamp, sync: state.settings.scriptUrl ? 'add' : 'local' });
      toast(state.settings.scriptUrl ? tr('Rit opgeslagen ✓') : tr('Rit opgeslagen op deze telefoon'));
    }
    if (data.odoEnd && data.odoEnd > (state.lastOdo || 0)) state.lastOdo = data.odoEnd;
    save();

    // Volgende rit alvast klaarzetten: vanaf de bestemming van deze rit.
    const wasEdit = !!editingId;
    resetForm(wasEdit ? {} : { from: data.to });
    renderQuick();
    flush();
    if (wasEdit) go('trips');
  });

  $('#delete-btn').addEventListener('click', () => {
    if (!editingId || !confirm(state.settings.scriptUrl ? tr('Deze rit verwijderen (ook uit de Google Sheet)?') : tr('Deze rit verwijderen?'))) return;
    const t = state.trips.find((x) => x.id === editingId);
    if (t) {
      if (t.sync === 'synced' || t.sync === 'update' || t.sync === 'error-update') { t.sync = 'delete'; t.modified = new Date().toISOString(); }
      else state.trips = state.trips.filter((x) => x.id !== editingId);
    }
    save(); resetForm(); flush(); go('trips');
    toast(tr('Rit verwijderd'));
  });
  $('#cancel-edit-btn').addEventListener('click', () => { resetForm(); go('trips'); });
  $('#repeat-btn').addEventListener('click', () => {
    const t = state.trips.find((x) => x.id === editingId);
    if (t) { fillFromTrip(t, false); toast(tr('Zelfde rit voor vandaag klaargezet')); }
  });

  F('desc').addEventListener('input', () => { descDirty = F('desc').value.trim() !== ''; });
  F('odoEnd').addEventListener('input', () => { odoEndDirty = true; });
  F('odoStart').addEventListener('input', updateOdoEnd);
  F('km').addEventListener('input', () => { updateOdoEnd(); updateFee(); });
  ['start', 'end'].forEach((k) => F(k).addEventListener('input', () => { F(k).dataset.touched = '1'; }));
  $('#type-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setType(b.dataset.type); });
  $('#calc-btn').addEventListener('click', () => updateDistance(true));
  $('#swap-btn').addEventListener('click', () => {
    const a = F('from').value; F('from').value = F('to').value; F('to').value = a;
    descDirty = false; updateDistance();
  });

  /* ---------- address autocomplete ---------- */
  let suggestTimer;
  function showSuggestions(field) {
    const input = F(field), box = $(`[data-suggest="${field}"]`);
    const q = input.value.trim();
    const qn = norm(q);
    const placeHits = state.places.filter((p) => !qn || norm(p.name).includes(qn) || norm(p.address).includes(qn) || p.aliases.some((a) => norm(a).includes(qn)));
    const render = (extra = []) => {
      const items = placeHits.map((p) => ({ label: p.name, sub: p.address, value: p.address }))
        .concat(extra.filter((a) => !placeHits.some((p) => norm(p.address) === norm(a))).map((a) => ({ label: a, value: a })));
      if (!items.length || document.activeElement !== input) { box.classList.add('hidden'); return; }
      box.innerHTML = items.slice(0, 7).map((i) => `<button type="button" data-value="${esc(i.value)}">${esc(i.label)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</button>`).join('');
      box.classList.remove('hidden');
    };
    render();
    clearTimeout(suggestTimer);
    if (q.length >= 3 && navigator.onLine) {
      suggestTimer = setTimeout(async () => {
        try { const hits = await suggestAddresses(q); if (input.value.trim() === q) render(hits); } catch { /* offline */ }
      }, 250);
    }
  }
  ['from', 'to'].forEach((field) => {
    const input = F(field), box = $(`[data-suggest="${field}"]`);
    input.addEventListener('focus', () => showSuggestions(field));
    input.addEventListener('input', () => showSuggestions(field));
    input.addEventListener('blur', () => setTimeout(() => { box.classList.add('hidden'); }, 180));
    input.addEventListener('change', () => { descDirty = descDirty && F('desc').value !== autoDesc(); updateDistance(); });
    box.addEventListener('pointerdown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      input.value = b.dataset.value;
      box.classList.add('hidden');
      input.blur();
      updateDistance();
    });
  });
  $$('[data-locate]').forEach((btn) => btn.addEventListener('click', async () => {
    const field = btn.dataset.locate;
    const old = btn.textContent; btn.textContent = '…';
    try {
      const pos = await currentPosition();
      F(field).value = await reverseGeocode(pos.lat, pos.lon);
      updateDistance();
    } catch (err) { toast(err.message); }
    btn.textContent = old;
  }));

  /* ---------- quick routes ---------- */
  function quickRoutes() {
    const home = placeByRole('home'), work = placeByRole('work');
    const list = [];
    const add = (from, to, label, tag) => {
      if (!from || !to || norm(from) === norm(to) || list.some((r) => norm(r.from) === norm(from) && norm(r.to) === norm(to))) return;
      const k = knownRoute(from, to) || knownRoute(to, from);
      list.push({ from, to, label, tag, km: k?.km, min: k?.min });
    };
    const morning = new Date().getHours() < 13;
    if (home && work) {
      if (morning) { add(home.address, work.address, tr('Huis → Werk')); add(work.address, home.address, tr('Werk → Huis')); }
      else { add(work.address, home.address, tr('Werk → Huis')); add(home.address, work.address, tr('Huis → Werk')); }
    }
    // Vaakst gereden andere routes van de laatste 60 dagen
    const since = isoDate(new Date(Date.now() - 60 * 864e5));
    const counts = {};
    liveTrips().filter((t) => t.date >= since).forEach((t) => {
      const k = norm(t.from) + '→' + norm(t.to);
      (counts[k] ||= { from: t.from, to: t.to, n: 0 }).n++;
    });
    Object.values(counts).sort((a, b) => b.n - a.n).forEach((r) => {
      if (list.length < 4) add(r.from, r.to, placeName(r.from) + ' → ' + placeName(r.to));
    });
    const last = sortTrips(liveTrips())[0];
    if (last && list.length < 4) add(last.to, home?.address, placeName(last.to) + ' → ' + (home ? tr('Huis') : ''), tr('Terug'));
    return list.slice(0, 4);
  }
  function renderQuick() {
    const routes = quickRoutes();
    $('#quick-routes').innerHTML = routes.map((r, i) => `
      <button type="button" class="quick-btn${i === 0 ? ' hero' : ''}" data-q="${i}">
        ${i === 0 ? `<span class="tag">${tr('Voorstel')}</span>` : r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ''}
        <strong>${esc(r.label)}</strong>
        <small>${r.km ? fmtKm(r.km) + ' km' : tr('afstand berekenen')}${r.min ? ' · ~' + r.min + ' min' : ''}</small>
      </button>`).join('');
    $('#quick-routes').onclick = (e) => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      const r = routes[+b.dataset.q];
      resetForm({ from: r.from, to: r.to });
      $('#save-btn').focus({ preventScroll: true });
      $('.save-bar').scrollIntoView({ behavior: 'smooth', block: 'end' });
      toast(tr('Controleer en tik op “Rit opslaan”'));
    };
  }

  /* ---------- voice input ---------- */
  const NUMWORDS = { twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13, veertien: 14, vijftien: 15, zestien: 16, zeventien: 17, achttien: 18, negentien: 19, twintig: 20, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const WEEKDAYS = { zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const MONTHS = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12, january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, august: 8, october: 10 };

  function parseSpeech(raw) {
    let text = ' ' + raw.toLowerCase().replace(/[“”"]/g, '') + ' ';
    Object.entries(NUMWORDS).forEach(([w, n]) => { text = text.replace(new RegExp(`(\\s)${w}(?=[\\s,.])`, 'g'), `$1${n}`); });
    const out = {};
    const cut = (re) => { text = text.replace(re, ' '); };

    // Datum
    const d = new Date();
    let m;
    if (/\beergisteren\b/.test(text)) { d.setDate(d.getDate() - 2); out.date = isoDate(d); cut(/\beergisteren\b/); }
    else if (/\b(gisteren|yesterday)\b/.test(text)) { d.setDate(d.getDate() - 1); out.date = isoDate(d); cut(/\b(gisteren|yesterday)\b/); }
    else if (/\b(vandaag|today)\b/.test(text)) { out.date = todayISO(); cut(/\b(vandaag|today)\b/); }
    else if ((m = text.match(new RegExp(`\\b(?:op |on )?(\\d{1,2}) (${Object.keys(MONTHS).join('|')})\\b`)))) {
      const y = d.getFullYear(); let dt = new Date(y, MONTHS[m[2]] - 1, +m[1]);
      if (dt > new Date()) dt = new Date(y - 1, MONTHS[m[2]] - 1, +m[1]);
      out.date = isoDate(dt); cut(m[0]);
    } else if ((m = text.match(new RegExp(`\\b(?:afgelopen |vorige |last |on |op )?(${Object.keys(WEEKDAYS).join('|')})\\b`)))) {
      const diff = (d.getDay() - WEEKDAYS[m[1]] + 7) % 7;
      d.setDate(d.getDate() - diff); out.date = isoDate(d); cut(m[0]);
    }

    // Kilometerstand
    if ((m = text.match(/\b(?:begin ?stand|kilometerstand|km-stand|km stand|teller(?:stand)?|odometer)\s*(?:is|was|:)?\s*([\d.\s]{4,9}\d)/))) {
      out.odoStart = parseInt0(m[1]); cut(m[0]);
    }
    // Afstand expliciet
    if ((m = text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:km|kilometer)\b/))) { out.km = parseDec(m[1]); cut(m[0]); }

    // Tijden
    const timeRe = '(?:(?:kwart (?:over|voor)|half|quarter (?:past|to))\\s+\\d{1,2}|\\d{1,2}(?:[:.]\\d{2})?\\s*(?:uur|u|am|pm|a\\.m\\.|p\\.m\\.)?(?:\\s*\\d{2}(?=\\s))?)';
    // Spraak zonder am/pm: "van 5 tot half 6" → middag (1–7 uur wordt 13–19 uur)
    const toTime = (s) => {
      s = s.trim(); let mm, h, min = 0, ampm = '';
      if ((mm = s.match(/half\s+(\d{1,2})/))) { h = +mm[1] - 1; min = 30; }
      else if ((mm = s.match(/(?:kwart over|quarter past)\s+(\d{1,2})/))) { h = +mm[1]; min = 15; }
      else if ((mm = s.match(/(?:kwart voor|quarter to)\s+(\d{1,2})/))) { h = +mm[1] - 1; min = 45; }
      else {
        mm = s.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:uur|u)?\s*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/);
        if (!mm) return null;
        h = +mm[1]; min = +(mm[2] || mm[3] || 0); ampm = mm[4] || '';
      }
      if (/p/.test(ampm) && h < 12) h += 12;
      if (h > 23 || min > 59) return null;
      if (!ampm && h >= 1 && h <= 7) h += 12;
      return fromMin(h * 60 + min);
    };
    if ((m = text.match(new RegExp(`\\b(?:van|tussen|from|between)\\s+(${timeRe})\\s+(?:tot|en|to|until|and|-)\\s+(${timeRe})`)))) {
      out.start = toTime(m[1]); out.end = toTime(m[2]); cut(m[0]);
    } else {
      if ((m = text.match(new RegExp(`\\b(?:vertrokken|vertrek|weg|left|departed|gestart)\\s+(?:om|at)?\\s*(${timeRe})`)))) { out.start = toTime(m[1]); cut(m[0]); }
      if ((m = text.match(new RegExp(`\\b(?:aangekomen|aankomst|tot|arrived|until)\\s+(?:om|at)?\\s*(${timeRe})`)))) { out.end = toTime(m[1]); cut(m[0]); }
      if (!out.start && (m = text.match(new RegExp(`\\b(?:om|at)\\s+(${timeRe})`)))) { out.start = toTime(m[1]); cut(m[0]); }
    }

    // Type
    if (/(^|[\s,])(priv[eé]|private)(?=[\s,.]|$)/.test(text)) { out.type = 'Privé'; cut(/(^|[\s,])(priv[eé]|private)(?=[\s,.]|$)/); }
    else if (/\bzakelijk\b|\bbusiness\b/.test(text)) { out.type = 'Zakelijk'; cut(/\bzakelijk\b|\bbusiness\b/); }

    // Omschrijving na "omschrijving"/"reden"/"voor"
    if ((m = text.match(/\b(?:omschrijving|reden|description|purpose)\s*:?\s*(.+)$/))) { out.desc = m[1].trim(); cut(m[0]); }

    // Plaatsen: "van X naar Y" / "from X to Y" / "naar Y"
    text = text.replace(/\s+/g, ' ').trim();
    let segs = text.split(/\s*,\s*/).filter((x) => x.replace(/[\s.]/g, ''));
    let routeSeg = segs.find((s) => /\b(naar|to)\b/.test(s)) || '';
    if ((m = routeSeg.match(/\b(?:van|vanaf|vanuit|from)\s+(.+?)\s+(?:naar|to)\s+(.+)$/))) { out.fromText = m[1]; out.toText = m[2]; }
    else if ((m = routeSeg.match(/\b(?:naar|to)\s+(.+)$/))) { out.toText = m[1]; }
    const rest = segs.filter((s) => s !== routeSeg).join(', ').trim();
    if (!out.desc && rest.length > 3) out.desc = rest.charAt(0).toUpperCase() + rest.slice(1);
    return out;
  }

  function resolvePlace(text) {
    if (!text) return null;
    const t = norm(text.replace(/^(het|de|mijn|the|my)\s+/, ''));
    const hit = state.places.find((p) => norm(p.name) === t || p.aliases.some((a) => norm(a) === t))
      || state.places.find((p) => t.includes(norm(p.name)) || p.aliases.some((a) => a.length > 3 && t.includes(norm(a))));
    return hit ? hit.address : null;
  }
  async function normaliseAddress(text) {
    try {
      const data = await fetchJSON(`${PDOK}/free?rows=1&q=${encodeURIComponent(text)}`, {}, 6000);
      const doc = data.response?.docs?.[0];
      if (doc) return tidyAddress(doc.weergavenaam);
    } catch { /* offline */ }
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function applySpeech(raw) {
    if (!raw.trim()) return;
    const p = parseSpeech(raw);
    const lastTo = sortTrips(liveTrips())[0]?.to;
    let from = resolvePlace(p.fromText) || (p.fromText ? await normaliseAddress(p.fromText) : null);
    const to = resolvePlace(p.toText) || (p.toText ? await normaliseAddress(p.toText) : null);
    if (!from && to) from = F('from').value || lastTo || placeByRole('work')?.address;
    if (!editingId) resetForm();
    if (from) F('from').value = from;
    if (to) F('to').value = to;
    if (p.date) F('date').value = p.date;
    if (p.start) { F('start').value = p.start; F('start').dataset.touched = '1'; }
    if (p.end) { F('end').value = p.end; F('end').dataset.touched = '1'; }
    if (p.start && !p.end) delete F('end').dataset.touched;
    if (p.type) setType(p.type);
    if (p.odoStart) F('odoStart').value = fmtOdo(p.odoStart);
    if (p.desc) { F('desc').value = p.desc; descDirty = true; }
    await updateDistance();
    if (p.km) { F('km').value = fmtKm(p.km); $('#km-hint').textContent = tr('Ingesproken afstand'); updateOdoEnd(); updateFee(); }
    // Alleen starttijd genoemd → eindtijd = start + reistijd
    if (p.start && !p.end) {
      const k = knownRoute(F('from').value, F('to').value);
      F('end').value = fromMin(toMin(p.start) + (k?.min || 30));
    }
    // "van 7 tot half 8" vandaag terwijl het nog ochtend is → ochtend, niet avond
    if (F('date').value === todayISO() && toMin(F('start').value) > nowMin() + 30 && toMin(F('start').value) >= 13 * 60) {
      F('start').value = fromMin(toMin(F('start').value) - 720);
      F('end').value = fromMin(toMin(F('end').value) - 720);
    }
    const missing = [!F('from').value && tr('van'), !F('to').value && tr('naar')].filter(Boolean);
    if (!missing.length) { $('#voice-panel').classList.add('hidden'); $('#voice-text').value = ''; }
    toast(missing.length ? tr('Niet verstaan: {f} — vul even aan', { f: missing.join(' ' + tr('en') + ' ') }) : tr('Ingevuld — controleer en sla op'));
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  $('#voice-btn').addEventListener('click', () => {
    const panel = $('#voice-panel'), btn = $('#voice-btn'), ta = $('#voice-text');
    panel.classList.remove('hidden');
    if (!SR) { ta.focus(); toast(tr('Tik op de microfoon op je toetsenbord om in te spreken')); return; }
    if (rec) { rec.stop(); return; }
    try {
      rec = new SR();
      rec.lang = state.settings.voiceLang;
      rec.interimResults = true;
      rec.continuous = false;
      ta.value = '';
      rec.onresult = (e) => { ta.value = [...e.results].map((r) => r[0].transcript).join(' '); };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast(tr('Geen toegang tot microfoon — gebruik de microfoon op je toetsenbord'));
        ta.focus();
      };
      rec.onend = () => {
        btn.classList.remove('listening'); rec = null;
        if (ta.value.trim()) applySpeech(ta.value);
      };
      btn.classList.add('listening');
      rec.start();
    } catch { rec = null; btn.classList.remove('listening'); ta.focus(); }
  });
  $('#voice-apply').addEventListener('click', () => applySpeech($('#voice-text').value));
  $('#voice-close').addEventListener('click', () => { $('#voice-panel').classList.add('hidden'); rec?.abort(); });

  /* ---------- sync with Google Sheet ---------- */
  let flushing = false;
  async function api(payload) {
    const { scriptUrl, token } = state.settings;
    if (!scriptUrl) throw new Error(tr('Geen Sheet gekoppeld'));
    // text/plain = "simple request" zonder CORS-preflight; Apps Script leest de body.
    const res = await fetchJSON(scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, ...payload }) }, 25000);
    if (!res.ok) throw new Error(tr(res.error || 'Onbekende fout'));
    return res;
  }
  const tripPayload = (t) => Object.fromEntries(COLUMNS.map(([k]) => [k, t[k] ?? '']).filter(([k]) => k !== 'ts'));

  async function flush() {
    renderSyncPill();
    if (flushing || !state.settings.scriptUrl || !navigator.onLine) return;
    const queue = state.trips.filter((t) => ['add', 'update', 'delete', 'error-add', 'error-update', 'error-delete'].includes(t.sync))
      .sort((a, b) => (a.modified || '').localeCompare(b.modified || ''));
    if (!queue.length) return;
    flushing = true; renderSyncPill();
    let ok = 0, failed = 0;
    for (const t of queue) {
      const op = t.sync.replace('error-', '');
      try {
        if (op === 'add') { const r = await api({ action: 'add', trip: tripPayload(t) }); t.orig = r.row?.orig; t.sync = 'synced'; }
        else if (op === 'update') { const r = await api({ action: 'update', orig: t.orig, trip: tripPayload(t) }); t.orig = r.row?.orig || t.orig; t.sync = 'synced'; }
        else if (op === 'delete') { await api({ action: 'delete', orig: t.orig }); state.trips = state.trips.filter((x) => x !== t); }
        delete t.error; ok++;
      } catch (err) {
        t.sync = 'error-' + op; t.error = err.message; failed++;
        if (!navigator.onLine) break;
      }
      save();
    }
    flushing = false;
    renderSyncPill();
    if (failed) toast(tr('{n} rit(ten) niet verstuurd — tik op de status bovenin om opnieuw te proberen', { n: failed }), 4000);
    else if (ok) toast(tr(ok > 1 ? '{n} ritten in Google Sheet gezet ✓' : '{n} rit in Google Sheet gezet ✓', { n: ok }));
    if ($('#screen-trips').classList.contains('active')) renderTrips();
  }

  function rowToTrip(r) {
    const t = {
      desc: r.desc || '', date: parseSheetDate(r.date), start: parseSheetTime(r.start), end: parseSheetTime(r.end),
      km: parseDec(r.km), detourBiz: parseDec(r.detourBiz), detourPriv: parseDec(r.detourPriv),
      odoStart: parseInt0(r.odoStart), odoEnd: parseInt0(r.odoEnd), fee: parseDec(r.fee),
      from: (r.from || '').trim(), to: (r.to || '').trim(), type: r.type || '', car: r.car || '', plate: r.plate || '', driver: r.driver || '',
      orig: r.orig, sync: 'synced',
    };
    t.id = 'sheet:' + (r.orig.ts || [r.orig.date, r.orig.start, r.orig.from].join('|'));
    return t;
  }

  async function pull(silent = false) {
    if (!state.settings.scriptUrl || !navigator.onLine) return;
    try {
      const res = await api({ action: 'list', limit: 400 });
      const pending = state.trips.filter((t) => t.sync !== 'synced' && t.sync !== 'local');
      const pendingIds = new Set(pending.map((t) => t.id));
      const fromSheet = res.rows.map(rowToTrip).filter((t) => t.date && !pendingIds.has(t.id));
      const locals = state.trips.filter((t) => t.sync === 'local');
      state.trips = [...fromSheet, ...pending, ...locals];
      // Afstanden en reistijden leren van oudste naar nieuwste
      [...fromSheet].reverse().forEach((t) => learnRoute(t.from, t.to, t.km, (toMin(t.end) - toMin(t.start) + 1440) % 1440 || null));
      state.lastPull = new Date().toISOString();
      save();
      renderQuick(); renderSyncPill();
      if (!editingId && !F('odoStart').dataset.touched) { F('odoStart').value = fmtOdo(latestOdo()); updateOdoEnd(); }
      if (!silent) toast(tr('{n} ritten opgehaald uit Google Sheet', { n: fromSheet.length }));
      if ($('#screen-trips').classList.contains('active')) renderTrips();
    } catch (err) {
      if (!silent) toast(tr('Ophalen mislukt: {e}', { e: err.message }), 4000);
    }
  }

  function renderSyncPill() {
    const pill = $('#sync-pill');
    const pending = state.trips.filter((t) => /add|update|delete/.test(t.sync)).length;
    const errors = state.trips.filter((t) => /^error/.test(t.sync)).length;
    const local = state.trips.filter((t) => t.sync === 'local').length;
    pill.className = 'sync-pill';
    if (!state.settings.scriptUrl) { pill.textContent = local ? tr('{n} lokaal', { n: local }) : tr('Niet gekoppeld'); }
    else if (flushing) { pill.textContent = tr('Versturen…'); pill.classList.add('pending'); }
    else if (pending) { pill.textContent = tr('{n} in wachtrij', { n: pending }) + (errors ? ' ⚠' : ''); pill.classList.add('pending'); }
    else { pill.textContent = navigator.onLine ? tr('✓ Gesynchroniseerd') : 'Offline'; pill.classList.add('ok'); }
    $('#setup-banner').classList.toggle('hidden', !!state.settings.scriptUrl);
    $('#setup-banner-text').textContent = state.places.length
      ? tr('Nog niet gekoppeld aan Google Sheet — ritten worden lokaal bewaard.')
      : tr('Eerste keer? Plak je persoonlijke instellingen-link onder Instellingen.');
  }
  $('#sync-pill').addEventListener('click', () => {
    if (!state.settings.scriptUrl) return go('settings');
    const err = state.trips.find((t) => t.error);
    if (err) toast(tr('Laatste fout: {e}', { e: err.error }), 4000);
    flush().then(() => pull(true));
  });
  $('#pull-btn').addEventListener('click', () => pull(false));
  window.addEventListener('online', () => flush().then(() => pull(true)));
  window.addEventListener('offline', renderSyncPill);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderQuick(); flush(); } });

  /* ---------- trips list ---------- */
  function monthOptions(select) {
    const keys = new Set([monthKey(todayISO()), ...liveTrips().map((t) => monthKey(t.date))]);
    const cur = select.value || monthKey(todayISO());
    select.innerHTML = [...keys].sort().reverse().map((k) => `<option value="${k}">${monthLabel(k)}</option>`).join('');
    select.value = keys.has(cur) ? cur : monthKey(todayISO());
  }
  function statusClass(t) {
    if (t.sync === 'synced') return '';
    if (t.sync === 'local') return 'local';
    return /^error/.test(t.sync) ? 'error' : 'pending';
  }
  function renderTrips() {
    const sel = $('#trips-month');
    monthOptions(sel);
    const trips = sortTrips(liveTrips().filter((t) => monthKey(t.date) === sel.value));
    if (!trips.length) {
      $('#trip-list').innerHTML = `<div class="empty">${tr('Geen ritten in {m}.', { m: monthLabel(sel.value) })}${state.settings.scriptUrl ? '<br>' + tr('Tik op “Ophalen uit Sheet” om bestaande ritten te laden.') : ''}</div>`;
      return;
    }
    let html = '', day = '';
    trips.forEach((t) => {
      if (t.date !== day) { day = t.date; html += `<div class="day-head">${dayLabel(day)}</div>`; }
      html += `<button type="button" class="trip" data-id="${esc(t.id)}">
        <span class="status ${statusClass(t)}" title="${esc(t.error || t.sync)}"></span>
        <span class="t-main">
          <div class="t-route">${esc(placeName(t.from))} → ${esc(placeName(t.to))}</div>
          <div class="t-sub">${esc(t.start)}–${esc(t.end)} · ${esc(t.desc || '')}</div>
        </span>
        <span class="t-km">${fmtKm(t.km)} km<small>${fmtEur(t.fee)}</small></span>
      </button>`;
    });
    $('#trip-list').innerHTML = html;
  }
  $('#trips-month').addEventListener('change', renderTrips);
  $('#trip-list').addEventListener('click', (e) => {
    const b = e.target.closest('.trip'); if (!b) return;
    const t = state.trips.find((x) => x.id === b.dataset.id); if (!t) return;
    tripActions(t);
  });
  function tripActions(t) { fillFromTrip(t, true); }

  /* ---------- summary + export ---------- */
  function renderSummary() {
    const sel = $('#summary-month');
    monthOptions(sel);
    const trips = liveTrips().filter((t) => monthKey(t.date) === sel.value);
    const sum = (f) => trips.reduce((a, t) => a + (f(t) || 0), 0);
    const km = sum((t) => t.km), fee = sum((t) => t.fee);
    const biz = sum((t) => (t.type !== 'Privé' ? t.km : 0)), priv = sum((t) => (t.type === 'Privé' ? t.km : 0));
    const days = new Set(trips.map((t) => t.date)).size;
    const odos = trips.map((t) => [t.odoStart, t.odoEnd]).flat().filter(Boolean);
    const routes = {};
    trips.forEach((t) => { const k = placeName(t.from) + ' → ' + placeName(t.to); (routes[k] ||= { n: 0, km: 0 }); routes[k].n++; routes[k].km += t.km || 0; });
    $('#summary').innerHTML = `
      <div class="stats">
        <div class="stat"><b>${fmtKm(km)}</b><span>${tr('km totaal')}</span></div>
        <div class="stat"><b>${fmtEur(fee)}</b><span>${tr('vergoeding ({r}/km)', { r: fmtEur(state.settings.rate) })}</span></div>
        <div class="stat"><b>${trips.length}</b><span>${tr(days === 1 ? 'ritten op {d} dag' : 'ritten op {d} dagen', { d: days })}</span></div>
        <div class="stat"><b>${fmtKm(biz)}</b><span>${tr('zakelijk')}${priv ? ` · ${fmtKm(priv)} ${tr('privé')}` : ''}</span></div>
      </div>
      ${odos.length ? `<p class="hint">${tr('Km-teller: {a} → {b}', { a: fmtOdo(Math.min(...odos)), b: fmtOdo(Math.max(...odos)) })}</p>` : ''}
      ${trips.length ? `<div class="card"><h2>Routes</h2><div class="routes-list">${Object.entries(routes).sort((a, b) => b[1].n - a[1].n)
        .map(([k, r]) => `<div><span>${esc(k)} <small class="hint">×${r.n}</small></span><b>${fmtKm(r.km)} km</b></div>`).join('')}</div></div>` : ''}`;
  }
  $('#summary-month').addEventListener('change', renderSummary);

  function exportRows() {
    const key = $('#summary-month').value;
    return sortTrips(liveTrips().filter((t) => monthKey(t.date) === key)).map((t) => ({
      ts: '', desc: t.desc, date: sheetDate(t.date), start: t.start, end: t.end,
      km: t.km != null ? fmtKm(t.km) + ' km' : '', detourBiz: t.detourBiz ? fmtKm(t.detourBiz) + ' km' : '',
      detourPriv: t.detourPriv ? fmtKm(t.detourPriv) + ' km' : '', odoStart: t.odoStart ? fmtOdo(t.odoStart) + ' km' : '',
      odoEnd: t.odoEnd ? fmtOdo(t.odoEnd) + ' km' : '', fee: fmtEur(t.fee), from: t.from, to: t.to, type: t.type, car: t.car, plate: t.plate, driver: t.driver,
    }));
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#export-csv').addEventListener('click', () => {
    const rows = exportRows();
    if (!rows.length) return toast(tr('Geen ritten in deze maand'));
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [COLUMNS.map(([, h]) => cell(h)).join(';'), ...rows.map((r) => COLUMNS.map(([k]) => cell(r[k])).join(';'))].join('\r\n');
    download(`ritten-${$('#summary-month').value}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  });
  $('#export-copy').addEventListener('click', async () => {
    const rows = exportRows();
    if (!rows.length) return toast(tr('Geen ritten in deze maand'));
    const tsv = rows.map((r) => COLUMNS.map(([k]) => String(r[k] ?? '').replace(/\t/g, ' ')).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); toast(tr('{n} ritten gekopieerd — plak in rij 2 van de Sheet', { n: rows.length })); }
    catch { toast(tr('Kopiëren lukte niet')); }
  });

  /* ---------- settings ---------- */
  function renderSettings() {
    const s = state.settings;
    $('#s-url').value = s.scriptUrl; $('#s-token').value = s.token;
    $('#s-rate').value = String(s.rate).replace('.', ',');
    $('#s-type').value = s.defaultType; $('#s-car').value = s.car; $('#s-plate').value = s.plate; $('#s-driver').value = s.driver;
    $('#s-odo').value = fmtOdo(latestOdo()); $('#s-lang').value = s.voiceLang;
    $('#place-list').innerHTML = state.places.map((p) => `
      <button type="button" class="place-item" data-pid="${p.id}">
        <span>${esc(p.name)}<small>${esc(p.address)}</small></span>
        ${p.role ? `<span class="badge">${p.role === 'home' ? tr('Thuis') : tr('Werk')}</span>` : ''}
      </button>`).join('') || `<p class="hint">${tr('Nog geen plekken.')}</p>`;
  }
  $('#s-test').addEventListener('click', async () => {
    state.settings.scriptUrl = $('#s-url').value.trim();
    state.settings.token = $('#s-token').value.trim();
    state.trips.forEach((t) => { if (t.sync === 'local' && state.settings.scriptUrl) t.sync = 'add'; });
    save(); renderSyncPill();
    const out = $('#s-test-result');
    if (!state.settings.scriptUrl) { out.textContent = tr('Ontkoppeld'); return; }
    out.textContent = tr('Testen…');
    try {
      const r = await api({ action: 'ping' });
      out.textContent = tr('✓ Verbonden met tabblad “{s}”', { s: r.sheet });
      await flush(); await pull(true);
    } catch (err) { out.textContent = '✗ ' + err.message; }
  });
  $('#s-save-defaults').addEventListener('click', () => {
    const s = state.settings;
    s.rate = parseDec($('#s-rate').value) ?? s.rate;
    s.defaultType = $('#s-type').value; s.car = $('#s-car').value.trim(); s.plate = $('#s-plate').value.trim();
    s.driver = $('#s-driver').value.trim(); s.voiceLang = $('#s-lang').value;
    const odo = parseInt0($('#s-odo').value);
    if (odo) state.lastOdo = odo;
    save(); if (!editingId) resetForm(); renderVoiceHint(); toast(tr('Opgeslagen'));
  });
  $('#backup-btn').addEventListener('click', () => download(`ritlog-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json'));
  $('#reset-btn').addEventListener('click', () => {
    if (!confirm(tr('Alle ritten en instellingen op deze telefoon wissen? (De Google Sheet blijft ongewijzigd.)'))) return;
    localStorage.removeItem(STORE_KEY); location.reload();
  });

  // Plekken
  const dlg = $('#place-dialog'), pf = $('#place-form');
  function openPlace(p) {
    pf.reset();
    pf.elements.id.value = p?.id || '';
    pf.elements.name.value = p?.name || '';
    pf.elements.address.value = p?.address || '';
    pf.elements.aliases.value = (p?.aliases || []).join(', ');
    pf.elements.role.value = p?.role || '';
    $('#place-dialog-title').textContent = p ? tr('Plek bewerken') : tr('Nieuwe plek');
    $('#p-delete').classList.toggle('hidden', !p);
    dlg.showModal();
  }
  $('#add-place').addEventListener('click', () => openPlace(null));
  $('#place-list').addEventListener('click', (e) => { const b = e.target.closest('[data-pid]'); if (b) openPlace(state.places.find((p) => p.id === b.dataset.pid)); });
  $('#p-cancel').addEventListener('click', () => dlg.close());
  $('#p-delete').addEventListener('click', () => {
    state.places = state.places.filter((p) => p.id !== pf.elements.id.value);
    save(); dlg.close(); renderSettings(); renderQuick();
  });
  $('#p-locate').addEventListener('click', async () => {
    try { const pos = await currentPosition(); pf.elements.address.value = await reverseGeocode(pos.lat, pos.lon); pf.dataset.lat = pos.lat; pf.dataset.lon = pos.lon; }
    catch (err) { toast(err.message); }
  });
  pf.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = pf.elements;
    if (!v.name.value.trim() || !v.address.value.trim()) return toast(tr('Naam en adres zijn nodig'));
    const data = {
      name: v.name.value.trim(), address: v.address.value.trim(), role: v.role.value,
      aliases: v.aliases.value.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
    };
    if (pf.dataset.lat) { data.lat = +pf.dataset.lat; data.lon = +pf.dataset.lon; }
    delete pf.dataset.lat; delete pf.dataset.lon;
    if (data.role) state.places.forEach((p) => { if (p.role === data.role) p.role = ''; });
    const existing = state.places.find((p) => p.id === v.id.value);
    if (existing) { if (norm(existing.address) !== norm(data.address)) { delete existing.lat; delete existing.lon; } Object.assign(existing, data); }
    else state.places.push({ id: uid(), ...data });
    save(); dlg.close(); renderSettings(); renderQuick();
  });

  /* ---------- persoonlijke instellingen-link ---------- */
  // Adressen, auto en Sheet-koppeling staan niet in de openbare code maar in een
  // link (…/#setup=…). Het deel na # wordt nooit naar de server gestuurd.
  const b64enc = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64dec = (str) => JSON.parse(decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/')))));
  function importSetup(text, ask = true) {
    const m = String(text || '').match(/setup=([\w-]+)/);
    if (!m) return false;
    let cfg;
    try { cfg = b64dec(m[1]); } catch { toast(tr('Deze instellingen-link is ongeldig')); return false; }
    if (ask && (state.places.length || state.trips.length) && !confirm(tr('Instellingen uit deze link laden? Vaste plekken en standaardwaarden worden vervangen; ritten blijven bewaard.'))) return false;
    const st = state.settings;
    ['scriptUrl', 'token', 'rate', 'car', 'plate', 'driver', 'defaultType', 'voiceLang'].forEach((k) => { if (cfg[k] != null && cfg[k] !== '') st[k] = cfg[k]; });
    if (cfg.lastOdo) state.lastOdo = Math.max(cfg.lastOdo, state.lastOdo || 0);
    if (Array.isArray(cfg.places)) state.places = cfg.places.map((pl) => ({ id: uid(), aliases: [], role: '', ...pl }));
    (cfg.knownRoutes || []).forEach(([a, b, km, min]) => { const k = norm(a) + '→' + norm(b); if (!state.routes[k]) state.routes[k] = { km, min, n: 1, seed: true }; });
    if (st.scriptUrl) state.trips.forEach((t) => { if (t.sync === 'local') t.sync = 'add'; });
    save();
    if (!editingId) resetForm();
    renderQuick(); renderSyncPill();
    toast(tr('Persoonlijke instellingen geladen ✓'));
    flush().then(() => pull(true));
    return true;
  }
  function setupLink() {
    const st = state.settings;
    const routes = Object.entries(state.routes).sort((a, b) => (b[1].n || 0) - (a[1].n || 0)).slice(0, 40)
      .map(([k, r]) => [...k.split('→'), r.km, r.min || null]);
    const cfg = {
      scriptUrl: st.scriptUrl, token: st.token, rate: st.rate, car: st.car, plate: st.plate, driver: st.driver,
      defaultType: st.defaultType, voiceLang: st.voiceLang, lastOdo: latestOdo(),
      places: state.places.map(({ name, address, aliases, role }) => ({ name, address, aliases, role })),
      knownRoutes: routes,
    };
    return location.origin + location.pathname + '#setup=' + b64enc(cfg);
  }
  $('#setup-load').addEventListener('click', () => {
    if (importSetup($('#setup-input').value)) { $('#setup-input').value = ''; renderSettings(); }
    else if (!/setup=/.test($('#setup-input').value)) toast(tr('Plak de volledige link (met #setup=…)'));
  });
  $('#setup-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(setupLink()); toast(tr('Link gekopieerd — bewaar of stuur hem privé')); }
    catch { prompt(tr('Kopieer deze link:'), setupLink()); }
  });

  /* ---------- taal / language ---------- */
  function renderVoiceHint() {
    const ex = state.settings.voiceLang === 'en-US'
      ? 'yesterday from work to Coolsingel 40 Rotterdam from 5 to 5:30'
      : 'gisteren van werk naar Coolsingel 40 Rotterdam van 5 tot half 6';
    $('#voice-hint').textContent = tr('Bijv. “{x}”', { x: ex });
  }
  function applyLang() {
    I18N.setLang(state.settings.uiLang);
    I18N.apply();
    const en = I18N.lang === 'en';
    $('#lang-btn').innerHTML = en ? 'NL <b>EN</b>' : '<b>NL</b> EN';
    const active = $('.screen.active');
    $('#screen-title').textContent = tr(active.dataset.title);
    $('#save-btn').textContent = tr(editingId ? 'Wijziging opslaan' : 'Rit opslaan');
    renderVoiceHint(); renderQuick(); renderSyncPill(); updateFee();
    if (active.id === 'screen-trips') renderTrips();
    if (active.id === 'screen-summary') renderSummary();
    if (active.id === 'screen-settings') renderSettings();
  }
  $('#lang-btn').addEventListener('click', () => {
    state.settings.uiLang = I18N.lang === 'en' ? 'nl' : 'en';
    save(); applyLang();
  });

  /* ---------- start ---------- */
  if (/setup=/.test(location.hash)) {
    const h = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => importSetup(h), 0);
  }
  if (!state.settings.uiLang) state.settings.uiLang = /^nl/i.test(navigator.language || '') ? 'nl' : 'en';
  I18N.setLang(state.settings.uiLang);
  resetForm();
  applyLang();
  flush().then(() => pull(true));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Voor tests in de browser
  window.__ritlog = { state: () => state, parseSpeech };
})();
