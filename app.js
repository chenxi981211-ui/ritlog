/* Ritlog — rittenregistratie voor de auto van de zaak.
   Vanilla JS, geen build. Data staat in localStorage en wordt via een
   Google Apps Script web-app naar de Google Sheet gestuurd. */
(() => {
  'use strict';

  const STORE_KEY = 'ritlog.v1';
  // In de iOS-app (Capacitor) zijn native onderdelen beschikbaar: deelvenster, statusbalk
  const NATIVE = !!window.Capacitor?.isNativePlatform?.();
  const Plugins = window.Capacitor?.Plugins || {};
  if (NATIVE) document.documentElement.classList.add('native');
  const APP_VERSION = '2026-11-24.12';
  const I18N = window.RitlogI18n;
  const tr = I18N.t;
  const CFG = window.RITLOG_CONFIG || {};
  const PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';
  const OSRM = 'https://router.project-osrm.org/route/v1/driving';
  // Buitenland: Photon (OpenStreetMap). PDOK kent alleen Nederlandse adressen.
  const PHOTON = 'https://photon.komoot.io';

  // Sheet-kolommen in dezelfde volgorde als de Google Sheet
  const COLUMNS = [
    ['ts', 'Tijdstempel'], ['desc', 'Beschrijving'], ['date', 'Datum'], ['tripNo', 'Rit-nr'], ['km', 'Afstand (km)'], ['detourBiz', 'I.v.t. Zakelijke Omrijkilometers'],
    ['detourPriv', 'I.v.t. Privé Omrijkilometers'], ['odoStart', 'Beginstand km-teller'],
    ['odoEnd', 'Eindstand km-teller'], ['fee', 'Vergoeding'], ['from', 'Vertrekadres'],
    ['to', 'Aankomstadres'], ['type', 'Type rit'], ['car', 'Auto'], ['plate', 'Kenteken'], ['driver', 'Rijder'],
  ];

  /* ---------- helpers ---------- */
  let refreshing = false; // Sheet wordt opnieuw opgehaald (ververs-knop)
  const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    home: svg('<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>'),
    work: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18"/>'),
    pin: svg('<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'),
    grip: svg('<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>'),
    minus: svg('<path d="M6 12h12"/>'),
    plus: svg('<path d="M12 6v12M6 12h12"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    logout: svg('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10"/>'),
    trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    road: svg('<path d="M8 3L4 21M16 3l4 18M12 4v3M12 11v2.5M12 17.5V20"/>'),
    euro: svg('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.6a4.2 4.2 0 1 0 0 6.8M7 10.8h6.5M7 13.4h6.5"/>'),
    wallet: svg('<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 6a2 2 0 0 0 2 2h13a1 1 0 0 1 1 1v3"/><path d="M15 12h6v4h-6a2 2 0 0 1 0-4z"/>'),
    gauge: svg('<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.3"/>'),
    ruler: svg('<path d="M3.5 16.5l13-13 4 4-13 13z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>'),
    calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    repeat: svg('<path d="M17 3l3 3-3 3"/><path d="M4 12v-2a4 4 0 0 1 4-4h12M7 21l-3-3 3-3"/><path d="M20 12v2a4 4 0 0 1-4 4H4"/>'),
    flame: svg('<path d="M12 3c.8 3.6 6 5.6 6 11a6 6 0 0 1-12 0c0-2.8 1.6-4.2 2-6.5 1.6 1 2.6 2.6 2.8 4.5C12 10 12.5 6.5 12 3z"/>'),
    zap: svg('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>'),
    detour: svg('<path d="M5 21v-9a4 4 0 0 1 8 0v2a4 4 0 0 0 8 0V5"/><path d="M18 7.5l3-3 3 3" transform="translate(-1.5 0)"/>'),
    trend: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
    bars: svg('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
    pie: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>'),
    route: svg('<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8.4 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.6"/>'),
    sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
    chev: '<svg class="ico chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  };
  const ICON_REFRESH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>';
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
  { const d = defaultState(); for (const k of ['places', 'routes', 'trips']) if (!state[k]) state[k] = d[k]; state.settings = { ...d.settings, ...state.settings }; }
  // moneyOk: vergoeding en privé-km zelf gecontroleerd. Bestaande gebruikers niet lastigvallen.
  if (state.settings.moneyOk === undefined && state.settings.onboarded) state.settings.moneyOk = true;
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
    window.dispatchEvent(new Event('ritlog:saved')); // account-synchronisatie luistert hiernaar
  };

  const liveTrips = () => state.trips.filter((t) => t.sync !== 'delete');
  const sortKey = (t) => t.date + String(t.tripNo || 0).padStart(3, '0');
  const sortTrips = (arr) => arr.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
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
  const pdokLabels = new Set(); // adressen die uit de PDOK-suggesties kwamen
  const NL_POSTCODE = /\b\d{4}\s?[A-Z]{2}\b/;
  const pdokPoint = (doc) => {
    const m = doc?.centroide_ll?.match(/POINT\(([\d.\-]+) ([\d.\-]+)\)/);
    return m ? { lon: +m[1], lat: +m[2] } : null;
  };
  // Photon-resultaat → leesbaar adres ("Alexanderplatz, Berlin, Germany"); Nederland zonder landnaam
  function photonLabel(p) {
    const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '';
    const head = p.name && p.name !== p.street ? p.name : street || p.name;
    const city = p.city || p.town || p.village || p.county || p.state;
    const parts = [head, head === street ? '' : street, city !== head ? city : '', p.countrycode === 'NL' ? '' : p.country];
    return [...new Set(parts.filter(Boolean))].join(', ');
  }
  async function photonSearch(q, limit) {
    const home = placeByRole('home');
    const bias = home?.lat ? `&lat=${home.lat}&lon=${home.lon}` : '';
    const data = await fetchJSON(`${PHOTON}/api/?limit=${limit}&lang=${I18N.lang === 'en' ? 'en' : 'default'}${bias}&q=${encodeURIComponent(q)}`, {}, 6000);
    return (data.features || []).map((f) => ({ label: photonLabel(f.properties), cc: f.properties.countrycode, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
      .filter((h) => h.label);
  }
  async function pdokGeocode(addr) {
    const data = await fetchJSON(`${PDOK}/free?rows=1&q=${encodeURIComponent(addr)}`);
    return pdokPoint(data.response?.docs?.[0]);
  }
  async function geocode(addr) {
    const key = norm(addr);
    if (geoCache[key]) return geoCache[key];
    const place = placeByAddress(addr);
    if (place?.lat) return (geoCache[key] = { lat: place.lat, lon: place.lon });
    let pt = null;
    if (pdokLabels.has(key) || NL_POSTCODE.test(addr)) pt = await pdokGeocode(addr);
    else {
      // Vrije tekst: eerst kijken in welk land het ligt. PDOK geeft voor buitenlandse adressen
      // soms een Nederlandse plek met een lijkende naam, dus alleen PDOK gebruiken voor Nederland.
      const hit = (await photonSearch(addr, 1).catch(() => []))[0];
      if (hit && hit.cc !== 'NL') pt = { lat: hit.lat, lon: hit.lon };
      else pt = (await pdokGeocode(addr).catch(() => null)) || (hit && { lat: hit.lat, lon: hit.lon });
    }
    if (!pt) throw new Error(tr('Adres niet gevonden: {a}', { a: addr }));
    return (geoCache[key] = pt);
  }
  async function routeDistance(from, to) {
    const [a, b] = await Promise.all([geocode(from), geocode(to)]);
    const data = await fetchJSON(`${OSRM}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
    const r = data.routes?.[0];
    if (!r) throw new Error(tr('Geen route gevonden'));
    return { km: Math.round(r.distance / 10) / 100, min: Math.round(r.duration / 60) };
  }
  const tidyAddress = (s) => String(s || '').replace(/,?\s*\d{4}\s?[A-Z]{2}\b/, ',').replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/,\s*/g, ', ').trim();

  // Suggesties: Nederlandse adressen uit PDOK (huisnummer-precies), de rest van de wereld uit Photon
  async function suggestAddresses(q) {
    const [nl, world] = await Promise.all([
      fetchJSON(`${PDOK}/suggest?rows=5&fq=type:(adres OR weg OR woonplaats OR postcode)&q=${encodeURIComponent(q)}`, {}, 6000)
        .then((d) => (d.response?.docs || []).map((x) => tidyAddress(x.weergavenaam))).catch(() => []),
      NL_POSTCODE.test(q) ? [] : photonSearch(q, 6).catch(() => []),
    ]);
    nl.forEach((a) => pdokLabels.add(norm(a)));
    const abroad = world.filter((h) => h.cc !== 'NL');
    abroad.forEach((h) => { geoCache[norm(h.label)] = { lat: h.lat, lon: h.lon }; });
    // Wijst de beste wereldwijde treffer naar het buitenland, dan die eerst
    const abroadFirst = world[0] && world[0].cc !== 'NL';
    const a = abroad.map((h) => h.label), n = nl;
    const merged = abroadFirst ? [...a.slice(0, 4), ...n.slice(0, 3)] : [...n.slice(0, 4), ...a.slice(0, 3)];
    return [...new Set(merged)];
  }
  async function reverseGeocode(lat, lon) {
    const near = state.places.find((p) => p.lat && haversine(lat, lon, p.lat, p.lon) < 0.15);
    if (near) return near.address;
    const data = await fetchJSON(`${PDOK}/reverse?type=adres&rows=1&lat=${lat}&lon=${lon}`).catch(() => null);
    const doc = data?.response?.docs?.[0];
    // Buiten Nederland (of ver van het dichtstbijzijnde NL-adres): Photon
    if (doc && !(doc.afstand > 250)) { const a = tidyAddress(doc.weergavenaam); pdokLabels.add(norm(a)); return a; }
    const w = await fetchJSON(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=${I18N.lang === 'en' ? 'en' : 'default'}`).catch(() => null);
    const f = w?.features?.[0];
    if (!f) throw new Error(tr('Geen adres gevonden'));
    const label = photonLabel(f.properties);
    geoCache[norm(label)] = { lat, lon };
    return label;
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
  let descDirty = false, odoEndDirty = false, tripNoDirty = false, editingId = null, distanceReq = 0;

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
  /* Rit-nummer: per dag 1, 2, 3 … (1 = meestal huis → werk, 2 = werk → huis) */
  const ridesOn = (date, exceptId) => liveTrips().filter((x) => x.date === date && x.id !== exceptId)
    .sort((a, b) => (a.tripNo || 0) - (b.tripNo || 0));
  const nextTripNo = (date, exceptId) => ridesOn(date, exceptId).reduce((m, x) => Math.max(m, x.tripNo || 0), 0) + 1;
  function setTripNo(n) {
    F('tripNo').value = Math.max(1, Math.min(20, n || 1));
    renderDayRides();
  }
  function autoTripNo() { if (!tripNoDirty) setTripNo(nextTripNo(F('date').value, editingId)); else renderDayRides(); }
  function renderDayRides() {
    const box = $('#day-rides');
    const date = F('date').value;
    if (!date) { box.innerHTML = ''; return; }
    const rides = ridesOn(date, editingId);
    const cur = parseInt0(F('tripNo').value);
    if (!rides.length) { box.innerHTML = esc(tr('Nog geen ritten op deze dag — dit wordt rit 1.')); return; }
    const used = new Set(rides.map((r) => r.tripNo).filter(Boolean));
    const max = Math.max(0, ...used);
    const gaps = [];
    for (let n = 1; n < max; n++) if (!used.has(n)) gaps.push(n);
    box.innerHTML = `<div class="rides"><span>${esc(tr('Al op deze dag:'))}</span>${rides.map((r) =>
      `<span class="ride-chip"><b>${r.tripNo || '?'}</b>${esc(placeName(r.from))} → ${esc(placeName(r.to))}</span>`).join('')}</div>`
      + (cur && used.has(cur) ? `<div class="warn">${esc(tr('Rit {n} bestaat al op deze dag', { n: cur }))}</div>` : '')
      + (gaps.length ? `<div class="rides">${gaps.map((n) => `<button type="button" class="use-gap" data-use="${n}">${esc(tr('Rit {n} ontbreekt — gebruiken', { n }))}</button>`).join('')}</div>` : '');
  }
  $('#day-rides').addEventListener('click', (e) => {
    const b = e.target.closest('[data-use]');
    if (b) { tripNoDirty = true; setTripNo(+b.dataset.use); }
  });
  $$('[data-step]').forEach((b) => b.addEventListener('click', () => {
    tripNoDirty = true; setTripNo((parseInt0(F('tripNo').value) || 0) + Number(b.dataset.step));
  }));
  F('tripNo').addEventListener('input', () => { tripNoDirty = true; renderDayRides(); });
  F('date').addEventListener('change', autoTripNo);

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
      hint.textContent = tr('Berekend via snelste route — pas aan indien nodig');
      updateOdoEnd(); updateFee();
    } catch (err) {
      if (req !== distanceReq) return;
      hint.textContent = navigator.onLine ? tr('Kon afstand niet berekenen: {e}', { e: err.message }) : tr('Offline — vul de afstand zelf in');
      hint.classList.add('warn');
    }
  }

  function resetForm(prefill = {}) {
    editingId = null; descDirty = false; odoEndDirty = false; tripNoDirty = false;
    form.reset();
    F('id').value = '';
    const s = state.settings;
    F('date').value = todayISO();
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
    if (quickList.length) markQuick();
    autoTripNo();
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
      ['date', 'odoStart', 'odoEnd'].forEach((k) => { F(k).value = vals[k] ?? ''; });
      odoEndDirty = true;
      tripNoDirty = true;
      setTripNo(t.tripNo || nextTripNo(t.date, t.id));
      $('#save-btn').textContent = tr('Wijziging opslaan');
      $('#delete-btn').classList.remove('hidden');
      $('#cancel-edit-btn').classList.remove('hidden');
      $('#repeat-btn').classList.remove('hidden');
    } else {
      autoTripNo();
      updateOdoEnd();
    }
    updateFee();
    go('new');
  }

  // Vergoeding = afstand × tarief; privéritten krijgen geen vergoeding
  const calcFee = (km, type) => (km && type !== 'Privé' ? Math.round(km * state.settings.rate * 100) / 100 : 0);
  // Privé-saldo: zoveel privé-km per kalenderjaar (standaard 500)
  const privAllowance = () => state.settings.privAllowance ?? 500;
  function readForm() {
    const v = (k) => F(k).value.trim();
    const km = parseDec(v('km'));
    return {
      desc: v('desc'), date: v('date'), tripNo: parseInt0(v('tripNo')) || nextTripNo(v('date'), editingId), km,
      detourBiz: parseDec(v('detourBiz')), detourPriv: parseDec(v('detourPriv')),
      odoStart: parseInt0(v('odoStart')), odoEnd: parseInt0(v('odoEnd')),
      fee: calcFee(km, F('type').value || state.settings.defaultType),
      from: v('from'), to: v('to'), type: F('type').value || state.settings.defaultType,
      car: v('car'), plate: v('plate'), driver: v('driver'),
    };
  }

  form.addEventListener('input', (e) => { if (e.target.name === 'from' || e.target.name === 'to') markQuick(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = readForm();
    const missing = [];
    if (!data.from) missing.push(tr('vertrekadres'));
    if (!data.to) missing.push(tr('aankomstadres'));
    if (!data.date) missing.push(tr('datum'));
    if (!data.km) missing.push(tr('afstand'));
    if (missing.length) return toast(tr('Vul nog in: {f}', { f: missing.join(', ') }));

    learnRoute(data.from, data.to, data.km, null);
    const stamp = new Date().toISOString();

    if (editingId) {
      const t = state.trips.find((x) => x.id === editingId);
      if (t) {
        Object.assign(t, data, { modified: stamp, cloudDirty: true });
        if (t.sync === 'synced' || t.sync === 'error-update') t.sync = 'update';
        else if (t.sync === 'local' && !t.demo && state.settings.scriptUrl) t.sync = 'add';
      }
      toast(tr('Rit bijgewerkt'));
    } else {
      state.trips.push({ id: uid(), ...data, created: stamp, modified: stamp, cloudDirty: true, sync: state.settings.scriptUrl ? 'add' : 'local' });
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
      (state.cloudDeletes ||= []).push(t.id);
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
    const seen = new Set(placeHits.map((p) => norm(p.address)));
    const history = [];
    sortTrips(liveTrips()).forEach((t) => [t.to, t.from].forEach((a) => {
      if (a && !seen.has(norm(a)) && (!qn || norm(a).includes(qn))) { seen.add(norm(a)); history.push(a); }
    }));
    const render = (extra = []) => {
      const items = placeHits.map((p) => ({ label: p.name, sub: p.address, value: p.address }))
        .concat(history.slice(0, 4).map((a) => ({ label: a, value: a })))
        .concat(extra.filter((a) => !seen.has(norm(a))).map((a) => ({ label: a, value: a })));
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
    btn.classList.add('busy');
    try {
      const pos = await currentPosition();
      F(field).value = await reverseGeocode(pos.lat, pos.lon);
      updateDistance();
    } catch (err) { toast(err.message); }
    btn.classList.remove('busy');
  }));

  /* ---------- quick routes ---------- */
  function quickRoutes() {
    const home = placeByRole('home'), work = placeByRole('work');
    const list = [];
    const add = (from, to, label, tag) => {
      if (!from || !to || norm(from) === norm(to) || list.some((r) => norm(r.from) === norm(from) && norm(r.to) === norm(to))) return;
      const k = knownRoute(from, to) || knownRoute(to, from);
      list.push({ from, to, label, tag, km: k?.km });
    };
    // Rit 1 van de dag = meestal huis → werk; na een rit naar werk volgt werk → huis
    const lastToday = ridesOn(todayISO()).pop();
    const atWork = lastToday ? placeByAddress(lastToday.to)?.role === 'work' : false;
    if (home && work) {
      if (atWork) { add(work.address, home.address, tr('Werk → Huis')); add(home.address, work.address, tr('Huis → Werk')); }
      else { add(home.address, work.address, tr('Huis → Werk')); add(work.address, home.address, tr('Werk → Huis')); }
    }
    // Ergens anders geëindigd → terug naar huis als tweede voorstel
    if (lastToday && home && !atWork && norm(lastToday.to) !== norm(home.address)) {
      const back = { from: lastToday.to, to: home.address };
      if (!list.some((r) => norm(r.from) === norm(back.from) && norm(r.to) === norm(back.to))) {
        const k = knownRoute(back.from, back.to) || knownRoute(back.to, back.from);
        list.splice(1, 0, { ...back, label: placeName(back.from) + ' → ' + tr('Huis'), tag: tr('Terug'), km: k?.km });
      }
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
  let quickList = [];
  // Tegel die bij het huidige formulier hoort krijgt een geselecteerde staat
  function markQuick() {
    const from = norm(F('from').value), to = norm(F('to').value);
    $$('#quick-routes [data-q]').forEach((b) => {
      const r = quickList[+b.dataset.q];
      const on = !!r && !editingId && !!from && norm(r.from) === from && norm(r.to || '') === to;
      b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on);
    });
  }
  function renderQuick() {
    const routes = quickRoutes();
    quickList = routes;
    const next = nextTripNo(todayISO());
    $('#quick-routes').innerHTML = routes.map((r, i) => `
      <button type="button" class="quick-btn${i === 0 ? ' hero' : ''}" data-q="${i}">
        <span class="q-ico">${{ home: ICON.home, work: ICON.work }[placeByAddress(r.to)?.role] || ICON.pin}</span><span class="q-check">${ICON.check}</span>
        ${i === 0 ? `<span class="tag">${tr('Voorstel · rit {n}', { n: next })}</span>` : r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ''}
        <strong>${esc(r.label)}</strong>
        <small>${r.km ? fmtKm(r.km) + ' km' : tr('afstand berekenen')}</small>
      </button>`).join('');
    markQuick();
    $('#quick-routes').onclick = (e) => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      const r = routes[+b.dataset.q];
      resetForm({ from: r.from, to: r.to });
      markQuick();
      $('#save-btn').focus({ preventScroll: true });
      $('.save-bar').scrollIntoView({ behavior: 'smooth', block: 'end' });
      toast(tr('Controleer en tik op “Rit opslaan”'));
    };
  }

  /* ---------- sync with Google Sheet ---------- */
  let flushing = false;
  async function api(payload) {
    const { scriptUrl, token } = state.settings;
    if (!scriptUrl) throw new Error(tr('Geen Sheet gekoppeld'));
    // text/plain = "simple request" zonder CORS-preflight; Apps Script leest de body.
    const sheet = state.settings.sheetTab;
    const res = await fetchJSON(scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...(token ? { token } : {}), ...(sheet ? { sheet } : {}), ...payload }) }, 25000);
    if (Array.isArray(res.tabs)) state.sheetTabs = res.tabs;
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
        if (op === 'add') { const r = await api({ action: 'add', trip: tripPayload(t) }); t.orig = r.row?.orig; t.sync = 'synced'; t.cloudDirty = true; }
        else if (op === 'update') { const r = await api({ action: 'update', orig: t.orig, trip: tripPayload(t) }); t.orig = r.row?.orig || t.orig; t.sync = 'synced'; t.cloudDirty = true; }
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
      desc: r.desc || '', date: parseSheetDate(r.date), tripNo: parseInt0(r.tripNo),
      km: parseDec(r.km), detourBiz: parseDec(r.detourBiz), detourPriv: parseDec(r.detourPriv),
      odoStart: parseInt0(r.odoStart), odoEnd: parseInt0(r.odoEnd), fee: parseDec(r.fee),
      from: (r.from || '').trim(), to: (r.to || '').trim(), type: /priv/i.test(r.type || '') ? 'Privé' : (r.type ? 'Zakelijk' : ''), car: r.car || '', plate: r.plate || '', driver: r.driver || '',
      orig: r.orig, sync: 'synced',
    };
    if (t.fee == null) t.fee = calcFee(t.km, t.type);
    t.id = 'sheet:' + (r.orig.ts || [r.orig.date, r.orig.start, r.orig.tripNo, r.orig.from].join('|'));
    return t;
  }

  async function pull(silent = false) {
    if (!state.settings.scriptUrl || !navigator.onLine) return;
    try {
      const res = await api({ action: 'list', limit: 5000 });
      if (Array.isArray(res.headers) && res.headers.length) state.sheetHeaders = res.headers;
      if (res.sheet) state.activeTab = res.sheet;
      const feeHead = (res.headers || []).find((h) => /^vergoeding/i.test(h));
      const rateM = feeHead && feeHead.match(/€\s*([\d.,]+)\s*\/\s*km/i);
      if (rateM && parseDec(rateM[1])) state.settings.rate = parseDec(rateM[1]);
      // Ritten uit de cloud die nog niet in deze Sheet staan, gaan er alsnog heen
      state.trips.forEach((t) => { if (t.sync === 'synced' && !t.orig) t.sync = 'add'; });
      const pending = state.trips.filter((t) => t.sync !== 'synced' && t.sync !== 'local');
      const pendingIds = new Set(pending.map((t) => t.id));
      const fromSheet = res.rows.map(rowToTrip).filter((t) => t.date && !pendingIds.has(t.id));
      const locals = state.trips.filter((t) => t.sync === 'local');
      // Wat in de Sheet nieuw of anders is gaat ook naar je account; wat eruit is gehaald, ook uit je account
      const before = new Map(state.trips.filter((t) => t.sync === 'synced').map((t) => [t.id, t]));
      fromSheet.forEach((t) => { const old = before.get(t.id); if (!old || rideSig(old) !== rideSig(t)) t.cloudDirty = true; else t.cloudDirty = !!old.cloudDirty; before.delete(t.id); });
      before.forEach((t) => { if (t.orig) (state.cloudDeletes ||= []).push(t.id); });
      state.trips = [...fromSheet, ...pending, ...locals];
      // Afstanden leren van oudste naar nieuwste
      [...fromSheet].reverse().forEach((t) => learnRoute(t.from, t.to, t.km, null));
      state.lastPull = new Date().toISOString();
      const learned = inferSetup(fromSheet);
      save();
      if (learned) { resetForm(); toast(tr('Thuis, werk en auto overgenomen uit je Sheet ✓'), 3500); silent = true; }
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
    pill.className = 'round-btn sync-pill' + (refreshing ? ' spinning' : '');
    // Alleen tonen als er iets te synchroniseren valt: een account of een gekoppelde Sheet
    const syncs = hasAccount() || !!state.settings.scriptUrl;
    pill.classList.toggle('hidden', !syncs);
    let text, cls = '';
    if (!syncs) text = local ? tr('{n} lokaal', { n: local }) : tr('Niet gekoppeld');
    else if (flushing) { text = tr('Versturen…'); cls = 'pending'; }
    else if (pending) { text = tr('{n} in wachtrij', { n: pending }) + (errors ? ' !' : ''); cls = 'pending'; }
    else { text = navigator.onLine ? tr('Bijgewerkt') : 'Offline'; cls = 'ok'; }
    if (errors) cls = 'error';
    if (cls) pill.classList.add(cls);
    // Rond ververs-icoon met een statusstipje (groen = bijgewerkt, oranje = wachtrij, rood = fout)
    pill.innerHTML = ICON_REFRESH + `<span class="sync-dot">${pending ? pending : ''}</span>`;
    pill.title = text;
    pill.setAttribute('aria-label', tr('Nu synchroniseren') + ' — ' + text);
    renderConnectCard();
  }
  // Account (Supabase) bestaat pas verderop in dit bestand; tot die tijd: geen account
  const hasAccount = () => { try { return !!session; } catch { return false; } };
  // Eén knop voor alles: account en Google Sheet bijwerken
  async function refreshFromSheet() {
    if (refreshing) return;
    if (!navigator.onLine) return toast(tr('Offline — vernieuwen lukt zodra je weer internet hebt'), 3500);
    refreshing = true; renderSyncPill();
    try {
      if (state.settings.scriptUrl) { await flush(); await pull(true); }
      if (hasAccount()) await cloudSync();
      const err = state.trips.find((t) => t.error) || (state.cloud?.error ? { error: state.cloud.error } : null);
      toast(err ? tr('Laatste fout: {e}', { e: err.error }) : tr('Alles is bijgewerkt ✓'), err ? 4000 : 2200);
    } finally {
      refreshing = false; renderSyncPill();
    }
  }
  $('#sync-pill').addEventListener('click', refreshFromSheet);
  window.addEventListener('online', () => flush().then(() => pull(true)));
  window.addEventListener('offline', renderSyncPill);
  // App weer geopend → wijzigingen uit de Sheet meteen ophalen
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderQuick(); flush().then(() => pull(true)); } });

  /* ---------- trips list ---------- */
  const TRIPS_PAGE = 100; // ritten per keer in de lijst, de rest via "Meer ritten laden"
  let tripsShown = TRIPS_PAGE;
  const tripKm = (t) => (t.km || 0) + (t.detourBiz || 0) + (t.detourPriv || 0);
  const monthName = (year, mm) => new Date(`${year}-${mm}-15T12:00`).toLocaleDateString(I18N.locale(), { month: 'long' });

  // Jaar staat bij het opstarten op dit jaar, maand op leeg (= alle maanden).
  // Geeft de gekozen periode terug: "2026" of "2026-10".
  function renderTripFilters() {
    const yearSel = $('#trips-year'), monthSel = $('#trips-month');
    const trips = liveTrips();
    const thisYear = todayISO().slice(0, 4);
    const years = [...new Set([thisYear, ...trips.map((t) => t.date.slice(0, 4))])].sort().reverse();
    const year = years.includes(yearSel.value) ? yearSel.value : thisYear;
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
    yearSel.value = year;
    const months = [...new Set(trips.filter((t) => t.date.startsWith(year)).map((t) => t.date.slice(5, 7)))].sort().reverse();
    const month = months.includes(monthSel.value) ? monthSel.value : '';
    monthSel.innerHTML = `<option value="">${esc(tr('Alle maanden'))}</option>`
      + months.map((m) => `<option value="${m}">${esc(monthName(year, m))}</option>`).join('');
    monthSel.value = month;
    yearSel.setAttribute('aria-label', tr('Jaar'));
    monthSel.setAttribute('aria-label', tr('Maand'));
    return month ? `${year}-${month}` : year;
  }
  function statusClass(t) {
    if (t.sync === 'synced') return '';
    if (t.sync === 'local') return 'local';
    return /^error/.test(t.sync) ? 'error' : 'pending';
  }
  function renderTrips() {
    const period = renderTripFilters();
    const trips = sortTrips(liveTrips().filter((t) => t.date.startsWith(period)));
    const count = $('#trips-count');
    if (!trips.length) {
      count.textContent = '';
      // Lege staat: illustratie + duwtje naar de (eerste) rit
      const first = !liveTrips().length;
      const when = period.length > 4 ? monthLabel(period) : period;
      $('#trip-list').innerHTML = `<div class="empty-state">
        <svg class="empty-art" viewBox="0 0 160 110" aria-hidden="true">
          <ellipse cx="80" cy="98" rx="58" ry="7" class="ea-shadow"/>
          <path d="M18 92 C 50 70, 70 96, 100 72 S 140 50, 146 36" class="ea-road"/>
          <path d="M18 92 C 50 70, 70 96, 100 72 S 140 50, 146 36" class="ea-dash"/>
          <circle cx="18" cy="92" r="5" class="ea-start"/>
          <g class="ea-pin"><path d="M146 6c-9 0-16 7-16 16 0 12 16 26 16 26s16-14 16-26c0-9-7-16-16-16z"/><circle cx="146" cy="22" r="6" class="ea-pin-dot"/></g>
        </svg>
        <h3>${esc(first ? tr('Nog geen ritten') : tr('Geen ritten in {m}', { m: when }))}</h3>
        <p>${esc(first ? tr('Je eerste rit staat in een paar tikken klaar. Daarna vult deze lijst zich vanzelf.') : tr('Kies een andere periode, of log een rit voor deze periode.'))}</p>
        <button type="button" class="btn primary" data-go="new"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>${esc(tr(first ? 'Eerste rit loggen' : 'Rit toevoegen'))}</span></button>
      </div>`;
      return;
    }
    count.textContent = tr(trips.length === 1 ? '{n} rit · {km} km' : '{n} ritten · {km} km', { n: trips.length, km: fmtKm(trips.reduce((a, t) => a + tripKm(t), 0)) });
    const shown = trips.slice(0, tripsShown);
    let html = '', day = '';
    shown.forEach((t) => {
      if (t.date !== day) { day = t.date; html += `<div class="day-head">${dayLabel(day)}</div>`; }
      const route = `${placeName(t.from)} → ${placeName(t.to)}`;
      const desc = (t.desc || '').trim();
      const ride = tr('Rit {n}', { n: t.tripNo || '?' });
      html += `<button type="button" class="trip" data-id="${esc(t.id)}">
        <span class="status ${statusClass(t)}" title="${esc(t.error || t.sync)}"></span>
        <span class="t-main">
          <div class="t-title">${esc(desc || route)}</div>
          <div class="t-sub">${t.demo ? `<span class="demo-tag">${esc(tr('voorbeeld'))}</span> ` : ''}${esc(desc ? `${ride} · ${route}` : ride)}</div>
        </span>
        <span class="t-km">${fmtKm(t.km)} km<small>${fmtEur(t.fee)}</small></span>
      </button>`;
    });
    if (shown.length < trips.length) {
      html += `<button type="button" class="btn ghost load-more" id="load-more">${esc(tr('Meer ritten laden'))}
        <small>${esc(tr('{a} van {b}', { a: shown.length, b: trips.length }))}</small></button>`;
    }
    $('#trip-list').innerHTML = html;
  }
  ['#trips-year', '#trips-month'].forEach((id) => $(id).addEventListener('change', () => { tripsShown = TRIPS_PAGE; renderTrips(); }));
  $('#trip-list').addEventListener('click', (e) => {
    if (e.target.closest('#load-more')) { tripsShown += TRIPS_PAGE; renderTrips(); return; }
    const b = e.target.closest('.trip'); if (!b) return;
    const t = state.trips.find((x) => x.id === b.dataset.id); if (!t) return;
    tripActions(t);
  });
  function tripActions(t) { fillFromTrip(t, true); }

  /* ---------- summary + export ---------- */
  /* Periodekeuze: een hele maand of een heel jaar ("2026-10" of "2026") */
  function periodOptions(select) {
    const thisMonth = monthKey(todayISO());
    const months = [...new Set([thisMonth, ...liveTrips().map((t) => monthKey(t.date))])].sort().reverse();
    const years = [...new Set(months.map((m) => m.slice(0, 4)))];
    const cur = select.value || thisMonth.slice(0, 4); // standaard het hele jaar
    select.innerHTML = years.map((y) => `<optgroup label="${y}"><option value="${y}">${esc(tr('Heel {y}', { y }))}</option>${
      months.filter((m) => m.startsWith(y)).map((m) => `<option value="${m}">${esc(monthLabel(m))}</option>`).join('')}</optgroup>`).join('');
    select.value = months.includes(cur) || years.includes(cur) ? cur : thisMonth.slice(0, 4);
  }

  const shortDate = (iso) => new Date(iso + 'T12:00').toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'short' });
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoDate(d); };
  const dayIndex = (iso) => (new Date(iso + 'T12:00').getDay() + 6) % 7; // maandag = 0
  const mondayOf = (iso) => addDays(iso, -dayIndex(iso));
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
  function isoWeek(iso) {
    const thursday = addDays(mondayOf(iso), 3);
    return Math.floor(daysBetween(thursday.slice(0, 4) + '-01-01', thursday) / 7) + 1;
  }
  const fmtInt = (n) => nf0.format(Math.round(n));
  const fmtDec1 = (n) => new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

  // Alle inzichten voor één periode, puur berekend uit de ritten
  function rideStats(trips, period) {
    const totalKm = trips.reduce((a, t) => a + tripKm(t), 0);
    const byDay = {};
    trips.forEach((t) => { const d = (byDay[t.date] ||= { km: 0, n: 0 }); d.km += tripKm(t); d.n++; });
    const dates = Object.keys(byDay).sort();
    const busiest = dates.reduce((best, d) => (!best || byDay[d].km > byDay[best].km ? d : best), null);

    // Langste reeks werkdagen (ma–vr) met minstens één rit
    let streak = 0, run = 0, prev = null;
    dates.filter((d) => dayIndex(d) < 5).forEach((d) => {
      run = prev && addDays(prev, dayIndex(prev) === 4 ? 3 : 1) === d ? run + 1 : 1;
      streak = Math.max(streak, run); prev = d;
    });

    // Verdeling: samen precies het totaal
    const parts = { commute: 0, other: 0, private: 0, detour: 0 };
    trips.forEach((t) => {
      const roles = [placeByAddress(t.from)?.role, placeByAddress(t.to)?.role];
      const kind = t.type === 'Privé' ? 'private' : (roles.includes('home') && roles.includes('work') ? 'commute' : 'other');
      parts[kind] += t.km || 0;
      parts.detour += (t.detourBiz || 0) + (t.detourPriv || 0);
    });
    const detourRides = trips.filter((t) => t.detourBiz || t.detourPriv).length;

    // Bestemmingen buiten huis en werk
    const dest = {};
    const seen = new Set();
    trips.forEach((t) => {
      [t.from, t.to].forEach((a) => { if (a && !placeByAddress(a)?.role) seen.add(norm(a)); });
      if (t.to && !placeByAddress(t.to)?.role) (dest[norm(t.to)] ||= { addr: t.to, n: 0 }).n++;
    });
    const destinations = Object.values(dest).sort((a, b) => b.n - a.n).slice(0, 5);

    // Km-teller tegen geregistreerde kilometers
    const withOdo = trips.filter((t) => t.odoStart && t.odoEnd).sort((a, b) => a.odoStart - b.odoStart);
    let odo = null;
    if (withOdo.length) {
      const gaps = [];
      withOdo.forEach((t, i) => { const next = withOdo[i + 1]; if (next && next.odoStart !== t.odoEnd) gaps.push(next.odoStart - t.odoEnd); });
      const driven = Math.max(...withOdo.map((t) => t.odoEnd)) - withOdo[0].odoStart;
      const logged = withOdo.reduce((a, t) => a + tripKm(t), 0);
      odo = { driven, logged, diff: driven - logged, gaps: gaps.length, gapKm: gaps.reduce((a, g) => a + Math.abs(g), 0) };
    }

    // Grafieken: per week binnen een maand, per maand binnen een jaar
    let timeline;
    if (period.length > 4) {
      timeline = [];
      const end = isoDate(new Date(+period.slice(0, 4), +period.slice(5, 7), 0)); // laatste dag van de maand
      for (let w = mondayOf(`${period}-01`); w <= end; w = addDays(w, 7)) {
        const weekEnd = addDays(w, 6);
        const km = trips.filter((t) => t.date >= w && t.date <= weekEnd).reduce((a, t) => a + tripKm(t), 0);
        timeline.push({ label: `${tr('wk')} ${isoWeek(w)}`, value: km });
      }
    } else {
      timeline = Array.from({ length: 12 }, (_, i) => {
        const key = `${period}-${pad(i + 1)}`;
        const label = new Date(key + '-15T12:00').toLocaleDateString(I18N.locale(), { month: 'short' }).replace('.', '');
        return { label, value: trips.filter((t) => t.date.startsWith(key)).reduce((a, t) => a + tripKm(t), 0) };
      });
    }
    const weekdays = Array.from({ length: 7 }, (_, i) => ({
      label: new Date(addDays('2024-01-01', i) + 'T12:00').toLocaleDateString(I18N.locale(), { weekday: 'short' }).replace('.', ''),
      value: trips.filter((t) => dayIndex(t.date) === i).reduce((a, t) => a + tripKm(t), 0),
    }));

    // Verwachting tot het eind van dit jaar, op het tempo sinds de eerste rit
    let forecast = null;
    const today = todayISO();
    if (period === today.slice(0, 4) && dates.length && daysBetween(dates[0], today) >= 13) {
      const factor = (daysBetween(dates[0], `${period}-12-31`) + 1) / (daysBetween(dates[0], today) + 1);
      const business = trips.reduce((a, t) => a + (t.type === 'Privé' ? 0 : t.km || 0), 0);
      forecast = { km: totalKm * factor, fee: business * state.settings.rate * factor };
    }
    return { totalKm, days: dates.length, byDay, busiest, streak, parts, detourRides, destinations, places: seen.size, odo, timeline, weekdays, forecast };
  }

  // Kolomgrafiek met één reeks: de hoogste kolom krijgt een label, tikken toont de rest
  function columnChart(title, items, icon) {
    const max = Math.max(...items.map((i) => i.value));
    const read = (i) => `${fmtKm(i.value)} km · ${i.label}`;
    const peak = items.find((i) => i.value === max);
    return `<div class="card viz">
      <div class="chart-head">${h2i(icon || ICON.bars, title)}<span class="chart-read">${esc(max ? read(peak) : '')}</span></div>
      <div class="cols">${items.map((i) => `<button type="button" class="col" data-read="${esc(read(i))}" aria-label="${esc(read(i))}">
        ${i === peak && max ? `<em>${fmtInt(i.value)}</em>` : ''}<i style="height:${max ? Math.max(i.value ? 2 : 0, (i.value / max) * 100) : 0}px"></i>
      </button>`).join('')}</div>
      <div class="col-labels">${items.map((i) => `<span>${esc(i.label)}</span>`).join('')}</div>
      <details class="chart-table"><summary>${esc(tr('Tabel'))}</summary><table>${items.map((i) =>
        `<tr><td>${esc(i.label)}</td><td>${fmtKm(i.value)} km</td></tr>`).join('')}</table></details>
    </div>`;
  }
  function splitChart(parts, total) {
    const rows = [['commute', 'Woon-werk'], ['other', 'Overig zakelijk'], ['private', 'Privé'], ['detour', 'Omrijden']];
    const pct = (v) => (total ? fmtDec1((v / total) * 100) : fmtDec1(0)) + '%';
    return `<div class="card viz">${h2i(ICON.pie, tr('Waar gaan de kilometers heen?'))}
      <div class="split">${rows.filter(([k]) => parts[k] > 0).map(([k]) => `<span class="seg-${k}" style="flex:${parts[k]} 1 0"></span>`).join('')}</div>
      <div class="legend">${rows.map(([k, label]) => `<div><span class="swatch seg-${k}"></span><span class="grow">${esc(tr(label))}</span><span class="muted">${pct(parts[k])}</span><b>${fmtKm(parts[k])} km</b></div>`).join('')}</div>
    </div>`;
  }
  /* ---------- Overzicht als aanpasbare widgets ---------- */
  // kind: 'tile' = halve breedte (naast elkaar), 'card' = volle breedte, 'line' = regel tekst
  // edit: tik opent de instelling. Zolang de standaardwaarden niet gecontroleerd zijn: oranje "Controleer"-label
  const tile = (icon, value, label, sub, cls = '', edit = '') => {
    const check = edit && !state.settings.moneyOk;
    const badge = !edit ? '' : check ? `<span class="stat-check">${esc(tr('Controleer'))}</span>`
      : `<span class="stat-edit" aria-hidden="true"><svg class="ico" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></span>`;
    return `<div class="stat ${cls}${edit ? ' editable' : ''}${check ? ' unconfirmed' : ''}"${edit ? ` role="button" tabindex="0" data-edit="${edit}" aria-label="${esc(label)}: ${esc(tr(check ? 'standaardwaarde, tik om te controleren' : 'aanpassen'))}"` : ''}><span class="s-ico">${icon}</span>${badge}<b>${value}</b><span>${esc(label)}${sub ? `<small class="stat-sub">${esc(sub)}</small>` : ''}</span></div>`;
  };
  const fmtBig = (n) => (Math.abs(n) >= 1000 ? fmtInt(n) : fmtKm(n));
  const h2i = (icon, text) => `<h2 class="h-ico"><span class="s-ico">${icon}</span>${esc(text)}</h2>`;
  const WIDGETS = [
    { id: 'car', kind: 'card', name: 'Mijn auto', render: (c) => carCardHtml(c) },
    { id: 'total', kind: 'tile', name: 'Totaal km', render: (c) => tile(ICON.road, `${fmtBig(c.km)} km`, tr('totaal'), tr('incl. omrijkilometers')) },
    { id: 'fee', kind: 'tile', name: 'Vergoeding', render: (c) => tile(ICON.euro, fmtEur(c.fee), tr('vergoeding'), tr('{r} per km', { r: fmtEur(state.settings.rate) }), '', 'rate') },
    { id: 'private', kind: 'tile', name: 'Privé-saldo', render: (c) => tile(ICON.wallet, `${fmtBig(c.privLeft)} km`, tr('privé-saldo {y}', { y: c.year }), tr('{u} van {a} km gebruikt', { u: fmtKm(c.privUsed), a: privAllowance() }), c.privLeft < 0 ? 'over' : '', 'priv') },
    { id: 'odometer', kind: 'tile', name: 'Huidige km-stand', render: (c) => tile(ICON.gauge, c.odoNow ? fmtOdo(c.odoNow) : '–', tr('huidige km-stand')) },
    { id: 'line', kind: 'line', name: 'Ritten en langste rit', render: (c) => (c.n ? `<p class="hint summary-line">${tr(c.days === 1 ? 'ritten op {d} dag' : 'ritten op {d} dagen', { d: c.days }).replace(/^/, c.n + ' ')}${c.longest ? ` · ${tr('langste rit')}: ${fmtKm(c.longest.km)} km (${esc(placeName(c.longest.from))} → ${esc(placeName(c.longest.to))})` : ''}</p>` : '') },
    { id: 'avgRide', kind: 'tile', name: 'Gemiddeld per rit', render: (c) => (c.st ? tile(ICON.ruler, `${fmtKm(c.st.totalKm / c.n)} km`, tr('gem. per rit')) : '') },
    { id: 'avgDay', kind: 'tile', name: 'Gemiddeld per rijdag', render: (c) => (c.st ? tile(ICON.calendar, `${fmtKm(c.st.totalKm / c.st.days)} km`, tr('gem. per rijdag')) : '') },
    { id: 'perDay', kind: 'tile', name: 'Ritten per rijdag', render: (c) => (c.st ? tile(ICON.repeat, fmtDec1(c.n / c.st.days), tr('ritten per rijdag')) : '') },
    { id: 'busiest', kind: 'tile', name: 'Drukste dag', render: (c) => { if (!c.st) return ''; const b = c.st.byDay[c.st.busiest]; return tile(ICON.flame, `${fmtKm(b.km)} km`, tr('drukste dag'), tr(b.n === 1 ? '{d} · {n} rit' : '{d} · {n} ritten', { d: shortDate(c.st.busiest), n: b.n })); } },
    { id: 'streak', kind: 'tile', name: 'Langste reeks', render: (c) => (c.st ? tile(ICON.zap, tr(c.st.streak === 1 ? '{n} dag' : '{n} dagen', { n: c.st.streak }), tr('langste reeks'), tr('werkdagen op rij')) : '') },
    { id: 'detours', kind: 'tile', name: 'Omrijden', render: (c) => { if (!c.st) return ''; const d = c.st.parts.detour; return tile(ICON.detour, `${c.st.totalKm ? fmtDec1((d / c.st.totalKm) * 100) : fmtDec1(0)}%`, tr('omrijden'), tr(c.st.detourRides === 1 ? '{n} rit · {km} km' : '{n} ritten · {km} km', { n: c.st.detourRides, km: fmtKm(d) })); } },
    { id: 'forecast', kind: 'card', name: 'Verwachting eind van het jaar', render: (c) => (c.st?.forecast ? `<div class="card">${h2i(ICON.trend, tr('Verwachting eind {y}', { y: c.year }))}
        <p class="forecast"><b>${fmtInt(c.st.forecast.km)} km</b><b>${fmtEur(c.st.forecast.fee)}</b></p>
        <p class="hint">${esc(tr('Als hij zo doorrijdt als sinds de eerste rit van dit jaar. Vakanties zijn niet meegerekend.'))}</p></div>` : '') },
    { id: 'timeline', kind: 'card', name: 'Km per week of maand', render: (c) => (c.st ? columnChart(tr(c.st.timeline.length === 12 ? 'Km per maand' : 'Km per week'), c.st.timeline) : '') },
    { id: 'weekday', kind: 'card', name: 'Km per weekdag', render: (c) => (c.st ? columnChart(tr('Km per weekdag'), c.st.weekdays, ICON.calendar) : '') },
    { id: 'split', kind: 'card', name: 'Waar gaan de kilometers heen?', render: (c) => (c.st ? splitChart(c.st.parts, c.st.totalKm) : '') },
    { id: 'places', kind: 'card', name: 'Meest bezocht', render: (c) => (c.st?.destinations.length ? `<div class="card">${h2i(ICON.pin, tr('Meest bezocht'))}<p class="hint">${esc(tr('{n} verschillende adressen, naast thuis en werk', { n: c.st.places }))}</p>
        <div class="routes-list">${c.st.destinations.map((d) => `<div><span>${esc(placeName(d.addr))}</span><b>×${d.n}</b></div>`).join('')}</div></div>` : '') },
    { id: 'odoCheck', kind: 'card', name: 'Controle km-teller', render: (c) => (c.st?.odo ? `<div class="card">${h2i(ICON.gauge, tr('Controle km-teller'))}<div class="routes-list">
        <div><span>${esc(tr('Gereden volgens km-teller'))}</span><b>${fmtOdo(c.st.odo.driven)} km</b></div>
        <div><span>${esc(tr('Geregistreerd in ritten'))}</span><b>${fmtKm(c.st.odo.logged)} km</b></div>
        <div><span>${esc(tr('Verschil'))}</span><b>${fmtKm(c.st.odo.diff)} km</b></div>
        <div><span>${esc(tr('Gaten tussen ritten'))}</span><b>${c.st.odo.gaps ? `${c.st.odo.gaps} · ${fmtOdo(c.st.odo.gapKm)} km` : esc(tr('geen'))}</b></div>
      </div></div>` : '') },
    { id: 'routes', kind: 'card', name: 'Routes', render: (c) => (c.n ? `<div class="card">${h2i(ICON.route, tr('Routes'))}<div class="routes-list">${Object.entries(c.routes).sort((x, y) => y[1].n - x[1].n).slice(0, 8)
        .map(([k, r]) => `<div><span>${esc(k)} <small class="hint">×${r.n}</small></span><b>${fmtKm(r.km)} km</b></div>`).join('')}</div></div>` : '') },
  ];
  const WIDGET = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));
  // Opgeslagen volgorde + verborgen widgets; nieuwe widgets uit latere versies komen er vanzelf bij
  function dashOrder() {
    const saved = state.settings.dash;
    if (!saved) return { on: WIDGETS.map((w) => w.id), off: [] };
    const known = new Set([...saved.on, ...saved.off]);
    return {
      on: [...saved.on.filter((id) => WIDGET[id]), ...WIDGETS.map((w) => w.id).filter((id) => !known.has(id))],
      off: saved.off.filter((id) => WIDGET[id]),
    };
  }
  function setDash(on, off) { state.settings.dash = { on, off }; save(); }

  function renderSummary() {
    const sel = $('#summary-month');
    periodOptions(sel);
    const period = sel.value;
    const trips = liveTrips().filter((t) => t.date.startsWith(period));
    const sum = (list, f) => list.reduce((a, t) => a + (f(t) || 0), 0);
    const year = period.slice(0, 4);
    const yearTrips = liveTrips().filter((t) => t.date.startsWith(year));
    const privUsed = sum(yearTrips, (t) => (t.type === 'Privé' ? t.km || 0 : 0) + (t.detourPriv || 0));
    const routes = {};
    trips.forEach((t) => { const k = placeName(t.from) + ' → ' + placeName(t.to); (routes[k] ||= { n: 0, km: 0 }); routes[k].n++; routes[k].km += t.km || 0; });
    const ctx = {
      period, year, trips, n: trips.length, routes, privUsed,
      // Totaal = afstand + zakelijke + privé omrijkilometers
      km: sum(trips, tripKm),
      // Zoals de Sheet: zakelijke afstand × tarief, pas aan het eind afronden
      fee: Math.round(sum(trips, (t) => (t.type === 'Privé' ? 0 : t.km || 0)) * state.settings.rate * 100) / 100,
      // Privé-saldo per kalenderjaar: jaartegoed − privéritten − privé omrijkilometers
      privLeft: privAllowance() - privUsed,
      odoNow: latestOdo(),
      days: new Set(trips.map((t) => t.date)).size,
      longest: trips.reduce((best, t) => ((t.km || 0) > (best?.km || 0) ? t : best), null),
      st: trips.length ? rideStats(trips, period) : null,
    };
    let html = '', tiles = [];
    const flushTiles = () => { if (tiles.length) { html += `<div class="stats">${tiles.join('')}</div>`; tiles = []; } };
    dashOrder().on.forEach((id) => {
      const w = WIDGET[id];
      const out = w.render(ctx);
      if (!out) return;
      if (w.kind === 'tile') tiles.push(out); else { flushTiles(); html += out; }
    });
    flushTiles();
    $('#summary').innerHTML = html || `<div class="empty">${esc(tr('Je overzicht is leeg. Tik op het aanpas-icoon om onderdelen toe te voegen.'))}</div>`;
    placeCarStage();
  }

  /* ---------- Overzicht aanpassen ---------- */
  const kindLabel = (w) => tr(w.kind === 'tile' ? 'Tegel' : w.kind === 'line' ? 'Regel' : 'Kaart');
  function renderDashEditor() {
    const { on, off } = dashOrder();
    const item = (id, active) => {
      const w = WIDGET[id], name = tr(w.name);
      return `<li class="dash-item" data-id="${id}">
        ${active ? `<button type="button" class="handle" aria-label="${esc(tr('Verplaats {x}', { x: name }))}">${ICON.grip}</button>` : ''}
        <span class="grow">${esc(name)}<span class="d-kind"> · ${esc(kindLabel(w))}</span></span>
        <button type="button" class="d-btn${active ? '' : ' add'}" data-act="${active ? 'off' : 'on'}" aria-label="${esc(tr(active ? 'Verwijder {x}' : 'Voeg {x} toe', { x: name }))}">${active ? ICON.minus : ICON.plus}</button>
      </li>`;
    };
    $('#dash-on').innerHTML = on.map((id) => item(id, true)).join('') || `<p class="hint">${esc(tr('Nog niets zichtbaar.'))}</p>`;
    $('#dash-off').innerHTML = off.map((id) => item(id, false)).join('') || `<p class="hint">${esc(tr('Alles staat al op je overzicht.'))}</p>`;
  }
  $('#dash-edit').addEventListener('click', () => { renderDashEditor(); $('#dash-dialog').showModal(); });
  $('#dash-done').addEventListener('click', () => $('#dash-dialog').close());
  $('#dash-reset').addEventListener('click', () => { delete state.settings.dash; save(); renderDashEditor(); renderSummary(); });
  $('#dash-dialog').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    let { on, off } = dashOrder();
    if (btn.dataset.act === 'off') { on = on.filter((x) => x !== id); off = [id, ...off]; }
    else { off = off.filter((x) => x !== id); on = [...on, id]; }
    setDash(on, off); renderDashEditor(); renderSummary();
  });
  // Slepen aan het grip-icoon; pijltjestoetsen werken ook
  let drag = null;
  $('#dash-on').addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.handle'); if (!h) return;
    e.preventDefault();
    const li = h.closest('.dash-item');
    const items = [...$('#dash-on').querySelectorAll('.dash-item')];
    const rects = items.map((i) => i.getBoundingClientRect());
    const from = items.indexOf(li);
    drag = { li, items, rects, from, to: from, y0: e.clientY, step: rects[from].height + 8 };
    try { h.setPointerCapture(e.pointerId); } catch { /* pointer al losgelaten */ }
    li.classList.add('dragging');
    items.forEach((i) => { if (i !== li) i.classList.add('shift'); });
  });
  $('#dash-on').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { li, items, rects, from, step } = drag;
    const dy = e.clientY - drag.y0;
    li.style.transform = `translateY(${dy}px)`;
    const mid = rects[from].top + rects[from].height / 2 + dy;
    let to = from;
    rects.forEach((r, i) => {
      const m = r.top + r.height / 2;
      if (i < from && mid < m) to = Math.min(to, i);
      if (i > from && mid > m) to = Math.max(to, i);
    });
    drag.to = to;
    items.forEach((it, i) => {
      if (it === li) return;
      const shift = from < to && i > from && i <= to ? -step : to < from && i >= to && i < from ? step : 0;
      it.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  });
  const endDrag = () => {
    if (!drag) return;
    const { from, to, li } = drag;
    drag = null;
    const { on, off } = dashOrder();
    if (to !== from) { const [id] = on.splice(from, 1); on.splice(to, 0, id); setDash(on, off); }
    li.classList.remove('dragging');
    renderDashEditor(); renderSummary();
  };
  $('#dash-on').addEventListener('pointerup', endDrag);
  $('#dash-on').addEventListener('pointercancel', endDrag);
  $('#dash-on').addEventListener('keydown', (e) => {
    if (!e.target.closest('.handle') || !/^Arrow(Up|Down)$/.test(e.key)) return;
    e.preventDefault();
    const id = e.target.closest('[data-id]').dataset.id;
    const { on, off } = dashOrder();
    const i = on.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= on.length) return;
    [on[i], on[j]] = [on[j], on[i]];
    setDash(on, off); renderDashEditor(); renderSummary();
    $(`#dash-on [data-id="${id}"] .handle`).focus();
  });

  /* ---------- Mijn auto ---------- */
  const CAR_COLORS = ['#3b7ddd', '#e5484d', '#f08c3a', '#f2c94c', '#3f9b6b', '#9fd8c4', '#8e6cd8', '#f2a7c3', '#f4f4f2', '#b9bcc2', '#6b7078', '#2a2b2e'];
  const BODY_TYPES = [['hatch', 'Hatchback'], ['sedan', 'Sedan'], ['fastback', 'Liftback'], ['wagon', 'Stationwagen'], ['crossover', 'Crossover'],
    ['suv', 'SUV'], ['mpv', 'MPV / bestelauto'], ['van', 'Busje'], ['sport', 'Sportwagen'], ['pickup', 'Pick-up']];
  // Model herkennen (cars.js: echte vorm en maten); onbekend → hatchback met standaardmaten
  const carSpec = (model) => window.RitlogCars?.lookup(model) || null;
  const guessBody = (model) => carSpec(model)?.body || 'hatch';
  function carOpts(s = state.settings) {
    const spec = carSpec(s.car);
    const body = s.carBody && s.carBody !== 'auto' ? s.carBody : (spec?.body || 'hatch');
    // Echte maten alleen als de gekozen vorm bij het herkende model past
    return { color: s.carColor || CAR_COLORS[0], body, dims: spec?.dims && spec.body === body ? spec.dims : null };
  }
  let carModule = null;
  let silhouetteFn = null;
  const loadCarModule = () => (carModule ||= import('./car3d.js').then((m) => { silhouetteFn = m.silhouette; return m; }));
  // Eén vaste 3D-weergave voor het overzicht, die bij elke herteken-beurt mee verhuist
  const carStage = document.createElement('div');
  carStage.className = 'car-stage';
  carStage.setAttribute('aria-label', 'Mijn auto');
  let carView = null, carViewKey = '';
  async function ensureCarView() {
    const key = JSON.stringify(carOpts());
    if (carView && key === carViewKey) return;
    try {
      const { mountCar } = await loadCarModule();
      if (carView) carView.update(carOpts()); else carView = mountCar(carStage, carOpts());
      carViewKey = key;
    } catch (err) {
      console.warn(err);
      carStage.innerHTML = `<div class="car-fallback">${esc(tr('3D niet beschikbaar op dit toestel'))}</div>`;
    }
  }
  function placeCarStage() {
    const slot = $('#summary [data-car-slot]');
    if (!slot) return;
    slot.replaceWith(carStage);
    ensureCarView();
  }
  function carCardHtml(c) {
    const s = state.settings;
    const meta = [s.car, s.plate ? `<span class="plate">${esc(s.plate)}</span>` : ''].filter(Boolean);
    const total = liveTrips().length;
    return `<div class="card car-card"><div data-car-slot></div>
      <button type="button" class="list-row car-info" id="car-open">
        <span class="grow">
          <span class="car-name${s.carName ? '' : ' placeholder'}">${esc(s.carName || tr('Geef je auto een naam'))}</span>
          <span class="car-meta">${meta.length ? meta.map((x) => (x.startsWith('<') ? x : esc(x))).join(' · ') : esc(tr('Tik om je auto toe te voegen'))}</span>
        </span>
        <span class="car-odo"><b>${fmtOdo(total)}</b><span>${esc(tr(total === 1 ? 'rit samen' : 'ritten samen'))}</span></span>
      </button></div>`;
  }
  function renderCarRow() {
    const s = state.settings;
    $('#car-row-title').textContent = s.carName || tr('Geef je auto een naam');
    $('#car-row-sub').textContent = [s.car, s.plate].filter(Boolean).join(' · ') || tr('Merk, model, kleur en kenteken');
  }

  // Dialoog: naam, model, kenteken, kleur en vorm, met live 3D-voorbeeld
  let previewView = null;
  const draft = {};
  // Vorm-keuze (gedeeld door Mijn auto en de onboarding): "Automatisch" volgt het herkende model
  function bodyChipsHtml(model, selected) {
    const spec = carSpec(model);
    const guess = BODY_TYPES.find(([k]) => k === (spec?.body || 'hatch'))[1];
    const sil = (k) => {
      const p = silhouetteFn?.(k);
      return p ? `<svg class="sil" viewBox="0 0 48 22" aria-hidden="true"><path d="${p.d}"/>${p.wheels.map((x) => `<circle cx="${x}" cy="${p.cy}" r="${p.r}"/>`).join('')}</svg>` : '';
    };
    return [['auto', tr('Automatisch'), spec?.body || 'hatch'], ...BODY_TYPES.map(([k, l]) => [k, tr(l), k])]
      .map(([k, l, shape]) => `<button type="button" role="radio" aria-checked="${k === selected}" data-body="${k}" class="chip${k === selected ? ' on' : ''}">${
        k === 'auto' ? `<span class="chip-ico">${ICON.sparkle}</span>` : sil(shape)}<span>${esc(l)}${k === 'auto' ? `<small> · ${esc(tr(guess))}</small>` : ''}</span></button>`).join('');
  }
  function recogText(model) {
    const spec = carSpec(model);
    return spec?.name
      ? tr('Herkend: {m} — vorm en maten kloppen met de echte auto', { m: spec.name })
      : (String(model || '').trim() ? tr('Model niet herkend — kies hieronder de vorm die het meest lijkt') : '');
  }
  function renderCarPickers() {
    $('#c-colors').innerHTML = CAR_COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" class="${c === draft.carColor ? 'on' : ''}" aria-label="${c}"></button>`).join('');
    $('#c-body').innerHTML = bodyChipsHtml($('#c-model').value, draft.carBody);
    $('#c-recog').textContent = recogText($('#c-model').value);
  }
  const draftOpts = () => carOpts({ ...draft, car: $('#c-model').value });
  function updatePreview() { previewView?.update(draftOpts()); }
  async function openCarDialog() {
    const s = state.settings;
    Object.assign(draft, { carColor: s.carColor || CAR_COLORS[0], carBody: s.carBody || 'auto' });
    $('#c-name').value = s.carName || ''; $('#c-model').value = s.car || ''; $('#c-plate').value = s.plate || '';
    renderCarPickers();
    $('#car-dialog').showModal();
    try {
      const { mountCar } = await loadCarModule();
      previewView?.destroy();
      previewView = mountCar($('#car-preview'), draftOpts());
      renderCarPickers();
    } catch { $('#car-preview').innerHTML = `<div class="car-fallback">${esc(tr('3D niet beschikbaar op dit toestel'))}</div>`; }
  }
  $('#car-row').addEventListener('click', openCarDialog);
  $('#summary').addEventListener('click', (e) => {
    if (e.target.closest('#car-open')) openCarDialog();
    if (e.target.closest('[data-edit="priv"]')) editSetting('s-priv');
    if (e.target.closest('[data-edit="rate"]')) editSetting('s-rate');
  });
  $('#summary').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-edit]')) { e.preventDefault(); e.target.click(); } });
  // Spring naar een instelling en zet de cursor erin
  function editSetting(id) {
    go('settings');
    const el = document.getElementById(id); if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setTimeout(() => { el.focus({ preventScroll: true }); el.select?.(); }, 250);
    el.closest('div')?.classList.add('flash');
    setTimeout(() => el.closest('div')?.classList.remove('flash'), 1600);
  }
  $('#c-colors').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (!b) return; draft.carColor = b.dataset.color; renderCarPickers(); updatePreview(); });
  $('#c-body').addEventListener('click', (e) => { const b = e.target.closest('[data-body]'); if (!b) return; draft.carBody = b.dataset.body; renderCarPickers(); updatePreview(); });
  $('#c-model').addEventListener('input', () => { renderCarPickers(); updatePreview(); });
  $('#c-cancel').addEventListener('click', () => $('#car-dialog').close());
  $('#car-dialog').addEventListener('close', () => { previewView?.destroy(); previewView = null; });
  $('#car-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = state.settings;
    s.carName = $('#c-name').value.trim();
    s.car = $('#c-model').value.trim();
    s.plate = $('#c-plate').value.trim().toUpperCase();
    s.carColor = draft.carColor; s.carBody = draft.carBody;
    save();
    $('#car-dialog').close();
    if (!editingId) { F('car').value = s.car; F('plate').value = s.plate; }
    renderCarRow(); renderSummary();
    toast(s.carName ? tr('{x} staat klaar ✓', { x: s.carName }) : tr('Opgeslagen'));
  });

  // Tik of wijs een kolom aan: de waarde verschijnt rechtsboven in de grafiek
  function showColumn(e) {
    const col = e.target.closest('.col'); if (!col) return;
    const viz = col.closest('.viz');
    viz.querySelector('.chart-read').textContent = col.dataset.read;
    viz.querySelector('.cols').classList.add('has-active');
    viz.querySelectorAll('.col.active').forEach((c) => c.classList.remove('active'));
    col.classList.add('active');
  }
  ['click', 'pointerover', 'focusin'].forEach((ev) => $('#summary').addEventListener(ev, showColumn));
  $('#summary-month').addEventListener('change', renderSummary);

  function exportRows() {
    const key = $('#summary-month').value;
    return sortTrips(liveTrips().filter((t) => t.date.startsWith(key))).map((t) => ({
      ts: '', desc: t.desc, date: sheetDate(t.date), tripNo: t.tripNo || '',
      km: t.km != null ? fmtKm(t.km) + ' km' : '', detourBiz: t.detourBiz ? fmtKm(t.detourBiz) + ' km' : '',
      detourPriv: t.detourPriv ? fmtKm(t.detourPriv) + ' km' : '', odoStart: t.odoStart ? fmtOdo(t.odoStart) + ' km' : '',
      odoEnd: t.odoEnd ? fmtOdo(t.odoEnd) + ' km' : '', fee: fmtEur(t.fee), from: t.from, to: t.to, type: t.type, car: t.car, plate: t.plate, driver: t.driver,
    }));
  }
  // Zelfde kolommen als de Sheet nu heeft (na koppelen bekend), anders de standaardset
  function exportColumns() {
    if (!state.sheetHeaders?.length) return COLUMNS;
    const n = (x) => String(x).toLowerCase().trim();
    return state.sheetHeaders.map((h) => [(COLUMNS.find(([, name]) => n(name) === n(h))
      || COLUMNS.find(([, name]) => n(h).startsWith(n(name) + ' ') || n(h).startsWith(n(name) + '(')))?.[0] || '', h]);
  }
  async function download(name, content, type) {
    if (NATIVE && Plugins.Filesystem && Plugins.Share) {
      // In de app: bestand tijdelijk opslaan en het iOS-deelvenster openen (Bewaar in Bestanden, Mail, …)
      try {
        const res = await Plugins.Filesystem.writeFile({ path: name, data: content, directory: 'CACHE', encoding: 'utf8' });
        await Plugins.Share.share({ title: name, url: res.uri });
      } catch (err) { if (!/cancel/i.test(err?.message || '')) toast(err?.message || String(err)); }
      return;
    }
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#export-csv').addEventListener('click', () => {
    const rows = exportRows();
    if (!rows.length) return toast(tr('Geen ritten in deze periode'));
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = exportColumns();
    const csv = [cols.map(([, h]) => cell(h)).join(';'), ...rows.map((r) => cols.map(([k]) => cell(r[k])).join(';'))].join('\r\n');
    download(`ritten-${$('#summary-month').value}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  });
  $('#export-copy').addEventListener('click', async () => {
    const rows = exportRows();
    if (!rows.length) return toast(tr('Geen ritten in deze periode'));
    const cols = exportColumns();
    const tsv = rows.map((r) => cols.map(([k]) => String(r[k] ?? '').replace(/\t/g, ' ')).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); toast(tr('{n} ritten gekopieerd — plak in rij 2 van de Sheet', { n: rows.length })); }
    catch { toast(tr('Kopiëren lukte niet')); }
  });

  /* ---------- Rittenregistratie voor de Belastingdienst (printbaar / PDF) ---------- */
  function taxReportHtml() {
    const key = $('#summary-month').value;
    const trips = sortTrips(liveTrips().filter((t) => t.date.startsWith(key))).reverse();
    const s = state.settings, sum = (f) => trips.reduce((a, t) => a + (f(t) || 0), 0);
    const priv = (t) => t.type === 'Privé';
    const bizKm = sum((t) => (priv(t) ? 0 : t.km)), privKm = sum((t) => (priv(t) ? t.km : 0));
    const detB = sum((t) => t.detourBiz), detP = sum((t) => t.detourPriv);
    const odos = trips.flatMap((t) => [t.odoStart, t.odoEnd]).filter(Boolean);
    const period = key.length > 4 ? monthLabel(key) : tr('Heel {y}', { y: key });
    const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const yearPriv = key.length === 4 ? privKm + detP : null;
    return `<!doctype html><html lang="${I18N.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tr('Rittenregistratie'))} ${esc(period)}</title><style>
@page { size: A4 landscape; margin: 14mm; }
body { font: 11px/1.45 -apple-system, "Inter", Arial, sans-serif; color: #141413; margin: 24px; }
h1 { font-size: 22px; margin: 0 0 2px; } .muted { color: #6e6d68; }
.grid { display: flex; gap: 28px; flex-wrap: wrap; margin: 16px 0; }
.grid table th { text-align: left; color: #6e6d68; font-weight: 500; padding: 2px 14px 2px 0; }
.grid table td { font-weight: 650; }
table.rides { width: 100%; border-collapse: collapse; margin-top: 8px; }
.rides th { background: #eef6f1; text-align: left; padding: 6px; font-size: 10px; }
.rides td { padding: 5px 6px; border-bottom: 1px solid #ebe9e4; vertical-align: top; }
.rides td.n { text-align: right; white-space: nowrap; }
.note { margin-top: 14px; font-size: 10px; color: #6e6d68; max-width: 900px; }
.print { position: fixed; top: 16px; right: 16px; background: #0f9150; color: #fff; border: 0; border-radius: 999px; padding: 10px 18px; font-weight: 600; cursor: pointer; }
@media print { .print { display: none; } body { margin: 0; } }
</style></head><body>
<button class="print" onclick="print()">${esc(tr('Afdrukken / PDF'))}</button>
<h1>${esc(tr('Rittenregistratie'))} · ${esc(period)}</h1>
<div class="muted">${esc(tr('Gemaakt met Ritlog op {d}', { d: new Date().toLocaleDateString(I18N.locale()) }))}</div>
<div class="grid">
<table>${row(tr('Auto'), esc(s.car || '–'))}${row(tr('Kenteken'), esc(s.plate || '–'))}${row(tr('Rijder'), esc(s.driver || '–'))}${row(tr('Periode'), esc(period))}</table>
<table>${row(tr('Aantal ritten'), trips.length)}${row(tr('Zakelijke km'), fmtKm(bizKm) + ' km')}${row(tr('Privé km'), fmtKm(privKm) + ' km')}${row(tr('Omrijkilometers zakelijk / privé'), `${fmtKm(detB) || '0'} / ${fmtKm(detP) || '0'} km`)}</table>
<table>${row(tr('Km-stand begin'), odos.length ? fmtOdo(Math.min(...odos)) : '–')}${row(tr('Km-stand eind'), odos.length ? fmtOdo(Math.max(...odos)) : '–')}${yearPriv != null ? row(tr('Privé-km dit jaar (max. {a})', { a: privAllowance() }), `${fmtKm(yearPriv)} km ${yearPriv <= privAllowance() ? '✓' : '⚠'}`) : ''}${row(tr('Vergoeding'), fmtEur(Math.round(bizKm * s.rate * 100) / 100))}</table>
</div>
<table class="rides"><thead><tr><th>${esc(tr('Datum'))}</th><th>${esc(tr('Rit'))}</th><th>${esc(tr('Begin km'))}</th><th>${esc(tr('Eind km'))}</th><th>${esc(tr('Vertrekadres'))}</th><th>${esc(tr('Aankomstadres'))}</th><th>${esc(tr('Km'))}</th><th>${esc(tr('Omrijden'))}</th><th>${esc(tr('Type'))}</th><th>${esc(tr('Omschrijving'))}</th></tr></thead><tbody>
${trips.map((t) => `<tr><td>${esc(sheetDate(t.date))}</td><td class="n">${t.tripNo || ''}</td><td class="n">${fmtOdo(t.odoStart)}</td><td class="n">${fmtOdo(t.odoEnd)}</td><td>${esc(t.from || '')}</td><td>${esc(t.to || '')}</td><td class="n">${fmtKm(t.km)}</td><td class="n">${fmtKm((t.detourBiz || 0) + (t.detourPriv || 0) || null)}</td><td>${esc(tr(t.type || ''))}</td><td>${esc(t.desc || '')}</td></tr>`).join('\n')}
</tbody></table>
<p class="note">${esc(tr('Per rit staan datum, begin- en eindstand van de km-teller, vertrek- en aankomstadres, de omgereden kilometers en of de rit zakelijk of privé was, zoals de Belastingdienst vraagt voor een sluitende rittenregistratie. Rijd je niet meer dan 500 km privé per kalenderjaar, dan hoef je geen bijtelling te betalen. Dit overzicht is geen belastingadvies.'))}</p>
</body></html>`;
  }
  $('#export-tax').addEventListener('click', () => {
    const key = $('#summary-month').value;
    if (!liveTrips().some((t) => t.date.startsWith(key))) return toast(tr('Geen ritten in deze periode'));
    const html = taxReportHtml();
    if (NATIVE) return download(`rittenregistratie-${key}.html`, html, 'text/html'); // deelvenster → Afdrukken → PDF bewaren
    const w = window.open('', '_blank');
    if (!w) return download(`rittenregistratie-${key}.html`, html, 'text/html');
    w.document.open(); w.document.write(html); w.document.close();
  });

  /* ---------- Importeren: CSV (Excel/Google Sheets) of een Ritlog-back-up ---------- */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = ['\t', ';', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  function tripsFromCsv(text) {
    const rows = parseCsv(text);
    const n = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
    const alias = { desc: ['omschrijving', 'description', 'beschrijving'], date: ['date', 'datum'], km: ['km', 'afstand', 'distance', 'kilometers'],
      from: ['van', 'from', 'vertrek'], to: ['naar', 'to', 'aankomst', 'bestemming'], type: ['type', 'soort'], tripNo: ['rit', 'ritnummer', 'nr'] };
    const hi = rows.findIndex((r) => r.some((h) => /datum|date/i.test(h)));
    if (hi < 0) return [];
    const head = rows[hi].map(n);
    const col = {};
    head.forEach((h, i) => {
      const k = COLUMNS.find(([, name]) => h === n(name) || h.startsWith(n(name) + ' ') || h.startsWith(n(name) + '('))?.[0]
        || Object.entries(alias).find(([, names]) => names.some((a) => h === a || h.startsWith(a + ' ') || h.startsWith(a + '(')))?.[0];
      if (k && col[k] == null) col[k] = i;
    });
    const get = (r, k) => (col[k] != null ? (r[col[k]] || '').trim() : '');
    const stamp = new Date().toISOString();
    return rows.slice(hi + 1).map((r) => {
      const date = parseSheetDate(get(r, 'date')), km = parseDec(get(r, 'km'));
      if (!date || !km) return null;
      const type = /priv/i.test(get(r, 'type')) ? 'Privé' : 'Zakelijk';
      return { id: uid(), desc: get(r, 'desc'), date, tripNo: parseInt0(get(r, 'tripNo')), km, detourBiz: parseDec(get(r, 'detourBiz')), detourPriv: parseDec(get(r, 'detourPriv')),
        odoStart: parseInt0(get(r, 'odoStart')), odoEnd: parseInt0(get(r, 'odoEnd')), fee: calcFee(km, type), from: get(r, 'from'), to: get(r, 'to'), type,
        car: get(r, 'car') || state.settings.car, plate: get(r, 'plate') || state.settings.plate, driver: get(r, 'driver') || state.settings.driver,
        created: stamp, modified: stamp, cloudDirty: true, sync: 'local' };
    }).filter(Boolean);
  }
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const text = await file.text();
    let found = [];
    try {
      if (/^\s*[{[]/.test(text)) {
        const data = JSON.parse(text);
        found = (Array.isArray(data) ? data : data.trips || []).filter((t) => t && t.date && t.km && t.sync !== 'delete')
          .map((t) => ({ ...t, id: t.id || uid(), demo: false, cloudDirty: true, sync: 'local' }));
      } else found = tripsFromCsv(text);
    } catch { found = []; }
    if (!found.length) return toast(tr('Geen ritten gevonden in dit bestand'), 3500);
    const key = (t) => `${t.date}|${Math.round((t.km || 0) * 10)}|${norm(t.from || '')}|${norm(t.to || '')}`;
    const have = new Set(liveTrips().map(key)), ids = new Set(state.trips.map((t) => t.id));
    const fresh = found.filter((t) => !have.has(key(t)) && !ids.has(t.id));
    const dup = found.length - fresh.length;
    if (!fresh.length) return toast(tr('Alle {n} ritten staan er al in', { n: found.length }), 3500);
    if (!confirm(tr('{n} ritten toevoegen?', { n: fresh.length }) + (dup ? ' ' + tr('({d} dubbele overgeslagen)', { d: dup }) : ''))) return;
    const toSheet = state.settings.scriptUrl && confirm(tr('Ook naar je Google Sheet sturen?'));
    fresh.forEach((t) => { if (!t.tripNo) t.tripNo = nextTripNo(t.date); if (toSheet) t.sync = 'add'; else if (state.settings.scriptUrl) t.sync = 'synced'; });
    state.trips.push(...fresh);
    const maxOdo = Math.max(0, ...fresh.map((t) => t.odoEnd || 0));
    if (maxOdo > (state.lastOdo || 0)) state.lastOdo = maxOdo;
    save(); resetForm(); renderQuick(); renderSummary(); flush();
    toast(tr('{n} ritten geïmporteerd', { n: fresh.length }), 3000);
  });

  /* ---------- settings ---------- */
  function renderSettings() {
    const s = state.settings;
    $('#s-url').value = s.scriptUrl; $('#s-token').value = s.token;
    $('#s-rate').value = String(s.rate).replace('.', ',');
    $('#s-type').value = s.defaultType; $('#s-driver').value = s.driver;
    renderCarRow(); renderAccount(); renderDemoBtn(); renderHelp();
    $('#app-version').textContent = tr('Ritlog') + ' ' + APP_VERSION;
    $('#s-odo').value = fmtOdo(latestOdo());
    $('#s-priv').value = privAllowance();
    const tabs = state.sheetTabs || [];
    $('#tab-row').classList.toggle('hidden', !s.scriptUrl || tabs.length < 2);
    $('#s-tab').innerHTML = tabs.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    $('#s-tab').value = s.sheetTab && tabs.includes(s.sheetTab) ? s.sheetTab : (state.activeTab || tabs[0] || '');
    $('#place-list').innerHTML = state.places.map((p) => `
      <button type="button" class="place-item" data-pid="${p.id}">
        <span>${esc(p.name)}<small>${esc(p.address)}</small></span>
        ${p.role ? `<span class="badge">${p.role === 'home' ? tr('Thuis') : tr('Werk')}</span>` : ''}
      </button>`).join('') || `<p class="hint">${tr('Nog geen plekken.')}</p>`;
  }
  $('#s-test').addEventListener('click', async () => {
    const out = $('#s-test-result');
    const raw = $('#s-url').value.trim();
    if (!raw) {
      state.settings.scriptUrl = ''; state.settings.token = '';
      save(); renderSyncPill(); out.textContent = tr('Ontkoppeld'); return;
    }
    const parsed = parseConnect(raw) || { url: raw, token: '' };
    out.textContent = tr('Testen…');
    const r = await connectSheet(parsed.url, $('#s-token').value.trim() || parsed.token);
    out.textContent = r.ok ? tr('✓ Verbonden met tabblad “{s}”', { s: r.sheet }) : '✗ ' + r.error;
    if (r.ok) renderSettings();
  });
  $('#s-save-defaults').addEventListener('click', () => {
    const s = state.settings;
    s.rate = parseDec($('#s-rate').value) ?? s.rate;
    s.defaultType = $('#s-type').value;
    s.driver = $('#s-driver').value.trim();
    const odo = parseInt0($('#s-odo').value);
    if (odo) state.lastOdo = odo;
    const priv = parseInt0($('#s-priv').value);
    if (priv != null) s.privAllowance = priv;
    s.moneyOk = true;
    save(); if (!editingId) resetForm(); toast(tr('Opgeslagen'));
  });
  $('#s-tab').addEventListener('change', async () => {
    state.settings.sheetTab = $('#s-tab').value;
    save();
    await pull(false);
    renderSettings();
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

  /* ---------- Google Sheet koppelen ---------- */
  // Accepteert de koppel-link (…/ritlog/#connect=…), of direct de Apps Script-URL.
  function parseConnect(text) {
    text = String(text || '').trim();
    let m = text.match(/[#&?]connect=([^&\s]+)/);
    if (m) {
      const tok = text.match(/[#&?]token=([^&\s]+)/);
      return { url: decodeURIComponent(m[1]), token: tok ? decodeURIComponent(tok[1]) : '' };
    }
    m = text.match(/https:\/\/script\.google(?:usercontent)?\.com\/[^\s"'<>]+/);
    if (m) return { url: m[0].replace(/\/(dev|edit)(\?.*)?$/, '/exec'), token: '' };
    return null;
  }
  async function connectSheet(url, token = '') {
    const prev = { scriptUrl: state.settings.scriptUrl, token: state.settings.token };
    state.settings.scriptUrl = url; state.settings.token = token || '';
    try {
      const r = await api({ action: 'ping' });
      state.trips.forEach((t) => { if (t.sync === 'local' && !t.demo) t.sync = 'add'; });
      save(); renderSyncPill();
      toast(tr('Gekoppeld met Google Sheet ✓'));
      await flush(); await pull(true);
      return { ok: true, sheet: r.sheet };
    } catch (err) {
      Object.assign(state.settings, prev); save(); renderSyncPill();
      const msg = /Failed to fetch|NetworkError|Load failed|HTTP 4/.test(err.message)
        ? tr('Kon de Sheet niet bereiken. Staat "Wie heeft toegang" op "Iedereen"?') : err.message;
      toast(msg, 5000);
      return { ok: false, error: msg };
    }
  }

  // Na het koppelen: thuis, werk en auto afleiden uit de bestaande ritten.
  function inferSetup(rows) {
    // Alleen bij de eerste koppeling; daarna beheert hij zijn plekken zelf
    if (!rows.length || (placeByRole('home') && placeByRole('work'))) return false;
    let changed = false;
    const votes = { home: {}, work: {} };
    const vote = (role, addr) => { if (addr) votes[role][addr] = (votes[role][addr] || 0) + 1; };
    rows.forEach((r) => {
      const d = (r.desc || '').toLowerCase();
      if (/\b(van|vanuit|vanaf) (huis|thuis)\b/.test(d)) vote('home', r.from);
      if (/\bnaar (huis|thuis)\b/.test(d)) vote('home', r.to);
      if (/\bnaar (het )?(werk|kantoor)\b/.test(d)) vote('work', r.to);
      if (/\b(van|vanuit|vanaf) (het )?(werk|kantoor)\b/.test(d)) vote('work', r.from);
    });
    const best = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0];
    const defs = {
      home: { name: 'Thuis', aliases: ['huis', 'thuis', 'home'] },
      work: { name: 'Werk', aliases: ['werk', 'kantoor', 'office', 'work'] },
    };
    ['home', 'work'].forEach((role) => {
      if (placeByRole(role)) return;
      const addr = best(votes[role]);
      if (!addr) return;
      const existing = placeByAddress(addr);
      if (existing) existing.role = role;
      else state.places.push({ id: uid(), name: defs[role].name, address: addr, aliases: defs[role].aliases, role });
      changed = true;
    });
    // Andere adressen die vaker voorkomen als vaste plek toevoegen
    const counts = {};
    rows.forEach((r) => [r.from, r.to].forEach((a) => { if (a) counts[norm(a)] = { addr: a, n: (counts[norm(a)]?.n || 0) + 1 }; }));
    Object.values(counts).filter((c) => c.n >= 2 && !placeByAddress(c.addr)).sort((a, b) => b.n - a.n).slice(0, 6)
      .forEach((c) => { state.places.push({ id: uid(), name: c.addr.split(',')[0], address: c.addr, aliases: [], role: '' }); changed = true; });
    const st = state.settings;
    const latest = rows.find((r) => r.car || r.plate || r.driver);
    if (latest) ['car', 'plate', 'driver'].forEach((k) => { if (!st[k] && latest[k]) { st[k] = latest[k]; changed = true; } });
    return changed;
  }

  let scriptText = null;
  async function loadScriptText() {
    if (scriptText) return scriptText;
    const res = await fetch('apps-script/Code.gs', { cache: 'no-cache' });
    scriptText = await res.text();
    return scriptText;
  }
  function renderConnectCard() {
    const card = $('#connect-card');
    if (state.settings.scriptUrl || state.settings.connectHidden) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    card.innerHTML = `
      <button type="button" class="card-close" id="connect-close" aria-label="${esc(tr('Niet nu'))}">${ICON.close}</button>
      <h2>${tr('Koppel je Google Sheet')}</h2>
      <p class="hint">${tr(NATIVE ? 'Plak hier de koppel-link uit je Google Sheet.' : 'Scan de QR-code die je Sheet laat zien, of plak de koppel-link hier.')}</p>
      <div class="stack">
        <input id="connect-input" placeholder="${esc(tr('Plak koppel-link…'))}" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button type="button" class="btn primary" id="connect-btn">${tr('Koppelen')}</button>
      </div>
      <details${state.places.length ? '' : ' open'}>
        <summary>${tr('Eerste keer? 3 stappen op de computer')}</summary>
        <ol>
          <li>${tr('Open je Google Sheet → <b>Extensies → Apps Script</b>. Wis alles, plak het script en klik op <b>Opslaan</b>.')}<br>
            <button type="button" class="btn small" id="copy-script">${tr('Kopieer script')}</button></li>
          <li>${tr('Klik <b>Implementeren → Nieuwe implementatie</b> → type <b>Web-app</b>. Zet <b>Wie heeft toegang</b> op <b>Iedereen</b> → <b>Implementeren</b> → geef toestemming.')}</li>
          <li>${tr(NATIVE ? 'Klik op de <b>Web-app-link</b>, tik op <b>Kopieer koppel-link</b> en plak hem hierboven. Klaar!' : 'Klik op de <b>Web-app-link</b> en scan de QR-code met je iPhone. Klaar!')}</li>
        </ol>
        <p class="hint">${tr('Zegt Google “app niet geverifieerd”? Kies <b>Geavanceerd → Ga naar … (onveilig)</b>. Dat is normaal voor je eigen script.')}</p>
      </details>`;
    loadScriptText().catch(() => {});
  }
  $('#connect-card').addEventListener('click', async (e) => {
    if (e.target.closest('#connect-close')) {
      state.settings.connectHidden = true; save(); renderConnectCard();
      return toast(tr('Later koppelen kan via Instellingen → Koppeling'), 3500);
    }
    if (e.target.id === 'connect-btn') {
      const parsed = parseConnect($('#connect-input').value);
      if (!parsed) return toast(tr('Dat lijkt geen koppel-link. Kopieer hem van de pagina met de QR-code.'), 4000);
      e.target.disabled = true; e.target.textContent = tr('Koppelen…');
      const r = await connectSheet(parsed.url, parsed.token);
      if (!r.ok) renderConnectCard();
    }
    if (e.target.id === 'copy-script') {
      try {
        await navigator.clipboard.writeText(scriptText || await loadScriptText());
        e.target.textContent = tr('✓ Gekopieerd — plak in Apps Script');
      } catch { window.open('apps-script/Code.gs', '_blank'); }
    }
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
    if (st.scriptUrl) state.trips.forEach((t) => { if (t.sync === 'local' && !t.demo) t.sync = 'add'; });
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
  $('#setup-load').addEventListener('click', async () => {
    const v = $('#setup-input').value;
    const parsed = !/setup=/.test(v) && parseConnect(v);
    if (parsed) { const r = await connectSheet(parsed.url, parsed.token); if (r.ok) { $('#setup-input').value = ''; renderSettings(); } return; }
    if (importSetup(v)) { $('#setup-input').value = ''; renderSettings(); }
    else if (!/setup=/.test(v)) toast(tr('Plak de volledige link (met #setup=…)'));
  });
  $('#setup-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(setupLink()); toast(tr('Link gekopieerd — bewaar of stuur hem privé')); }
    catch { prompt(tr('Kopieer deze link:'), setupLink()); }
  });

  /* ---------- taal / language ---------- */
  function applyLang() {
    I18N.setLang(state.settings.uiLang);
    I18N.apply();
    document.title = tr('Ritlog'); // Engelse naam: Tootle
    const en = I18N.lang === 'en';
    $('#lang-btn').textContent = en ? 'EN' : 'NL';
    $$('#lang-seg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === I18N.lang));
    applyTheme();
    const active = $('.screen.active');
    $('#screen-title').textContent = tr(active.dataset.title);
    $('#save-btn').textContent = tr(editingId ? 'Wijziging opslaan' : 'Rit opslaan');
    renderQuick(); renderSyncPill(); updateFee();
    if (active.id === 'screen-trips') renderTrips();
    if (active.id === 'screen-summary') renderSummary();
    if (active.id === 'screen-settings') renderSettings();
  }
  $('#lang-btn').addEventListener('click', () => {
    state.settings.uiLang = I18N.lang === 'en' ? 'nl' : 'en';
    save(); applyLang();
  });
  $('#lang-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]'); if (!b) return;
    state.settings.uiLang = b.dataset.lang; save(); applyLang();
  });

  /* ---------- licht / donker ---------- */
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => {
    const t = state.settings.theme || 'system';
    return t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t;
  };
  function applyTheme() {
    const t = state.settings.theme || 'system';
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try { localStorage.setItem('ritlog.theme', t); } catch { /* privémodus */ }
    const dark = effectiveTheme() === 'dark';
    const btn = $('#theme-btn');
    btn.innerHTML = dark ? ICON.sun : ICON.moon;
    btn.setAttribute('aria-label', tr(dark ? 'Licht thema' : 'Donker thema'));
    $$('#theme-seg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === t));
    // Kleur van de iPhone-statusbalk (vaste waarden: de achtergrond animeert nog bij het wisselen)
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0e0e0d' : '#f2f1ee');
    if (NATIVE) Plugins.StatusBar?.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
  }
  $('#theme-btn').addEventListener('click', () => {
    state.settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark';
    save(); applyTheme();
  });
  $('#theme-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]'); if (!b) return;
    state.settings.theme = b.dataset.theme; save(); applyTheme();
  });
  darkQuery.addEventListener?.('change', applyTheme);

  /* ---------- Account en cloud-synchronisatie (Supabase) ---------- */
  // Lokaal blijft de bron voor de app (werkt offline). Gewijzigde ritten krijgen cloudDirty en worden
  // kort na opslaan geüpload; daarna halen we op wat andere apparaten hebben veranderd.
  const SB = window.supabase && CFG.supabaseUrl
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, flowType: 'pkce', detectSessionInUrl: !NATIVE, storageKey: 'ritlog.auth' } })
    : null;
  // Alleen voor Google in de app: impliciete flow (sessie komt direct terug in de link). PKCE ging mis als het
  // inlogvenster twee keer laadde ("invalid flow state"). Bewaart zelf niets; de sessie gaat naar SB.
  const SB_OAUTH = window.supabase && CFG.supabaseUrl && NATIVE
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit', detectSessionInUrl: false, storageKey: 'ritlog.oauth' } })
    : null;
  let session = null, cloudBusy = false, cloudTimer = 0, applyingCloud = false;
  state.cloud ||= {};
  const num = (v) => (v == null || v === '' ? null : Number(v));
  function rideSig(t) {
    return JSON.stringify([t.desc, t.date, t.tripNo, t.km, t.detourBiz, t.detourPriv, t.odoStart, t.odoEnd, t.fee, t.from, t.to, t.type]);
  }
  const rideRow = (t) => ({
    client_id: t.id, date: t.date || null, trip_no: t.tripNo ?? null, description: t.desc || '', km: t.km ?? null,
    detour_biz: t.detourBiz ?? null, detour_priv: t.detourPriv ?? null, odo_start: t.odoStart ?? null, odo_end: t.odoEnd ?? null,
    fee: t.fee ?? null, from_addr: t.from || '', to_addr: t.to || '', type: t.type || '', car: t.car || '', plate: t.plate || '',
    driver: t.driver || '', sheet_orig: t.orig || null, deleted: false,
  });
  function mergeRide(r) {
    const i = state.trips.findIndex((t) => t.id === r.client_id);
    const local = i >= 0 ? state.trips[i] : null;
    if (local?.cloudDirty) return; // eigen wijziging wint; die gaat de volgende keer omhoog
    if (r.deleted) { if (local) state.trips.splice(i, 1); return; }
    const t = {
      ...(local || {}), id: r.client_id, date: r.date, tripNo: r.trip_no, desc: r.description || '', km: num(r.km),
      detourBiz: num(r.detour_biz), detourPriv: num(r.detour_priv), odoStart: num(r.odo_start), odoEnd: num(r.odo_end), fee: num(r.fee),
      from: r.from_addr || '', to: r.to_addr || '', type: r.type || '', car: r.car || '', plate: r.plate || '', driver: r.driver || '',
      orig: r.sheet_orig || local?.orig, cloudDirty: false,
    };
    // Nieuw op dit apparaat: staat hij al in de Sheet, dan 'synced'; anders sturen we hem erheen als die gekoppeld is
    if (!local) t.sync = r.sheet_orig ? 'synced' : (state.settings.scriptUrl ? 'add' : 'local');
    if (i >= 0) state.trips[i] = t; else state.trips.push(t);
  }
  // Instellingen die met je account meegaan (thema en taal blijven per apparaat)
  const SYNC_KEYS = ['rate', 'car', 'plate', 'driver', 'defaultType', 'privAllowance', 'moneyOk', 'carName', 'carColor', 'carBody', 'dash', 'onboarded', 'scriptUrl', 'token', 'sheetTab'];
  const cloudSettings = () => ({
    settings: Object.fromEntries(SYNC_KEYS.filter((k) => state.settings[k] !== undefined).map((k) => [k, state.settings[k]])),
    places: state.places.map(({ id, name, address, aliases, role }) => ({ id, name, address, aliases, role })),
    lastOdo: state.lastOdo ?? null,
  });
  function applyCloudSettings(s) {
    SYNC_KEYS.forEach((k) => { if (s.settings && k in s.settings) state.settings[k] = s.settings[k]; });
    if (Array.isArray(s.places)) state.places = s.places.map((p) => ({ aliases: [], role: '', ...p, id: p.id || uid() }));
    if (s.lastOdo) state.lastOdo = Math.max(s.lastOdo, state.lastOdo || 0);
  }
  // Eerste sync na inloggen: wat al in het account staat wint. Plekken van dit apparaat die het account
  // nog niet kent (zelfde adres of zelfde rol thuis/werk) komen erbij, zodat niets verloren gaat.
  function adoptAccountSettings(cloud) {
    const localPlaces = state.places;
    applyCloudSettings(cloud);
    const have = new Set(state.places.map((p) => norm(p.address)));
    const roles = new Set(state.places.map((p) => p.role).filter(Boolean));
    localPlaces.forEach((p) => {
      if (have.has(norm(p.address))) return;
      state.places.push(roles.has(p.role) ? { ...p, role: '' } : p);
      have.add(norm(p.address));
    });
  }
  async function cloudSync() {
    if (!SB || !session || cloudBusy || !navigator.onLine) return;
    cloudBusy = true; renderAccount();
    const uidNow = session.user.id;
    try {
      // 1. Instellingen: nieuwere versie van een ander apparaat overnemen, eigen wijziging uploaden
      const { data: prof, error: pe } = await SB.from('profiles').select('settings, updated_at').eq('id', uidNow).maybeSingle();
      if (pe) throw pe;
      if (state.cloud.adopt) {
        // Net ingelogd: bestaat het account al, dan nemen we die instellingen over (plus nieuwe plekken)
        if (prof?.settings?.settings) {
          applyingCloud = true; adoptAccountSettings(prof.settings); applyingCloud = false;
          state.cloud.settingsAt = prof.updated_at;
          // Kwamen er plekken bij, dan gaat de samengevoegde versie hieronder omhoog
          state.cloud.settingsHash = JSON.stringify({ ...cloudSettings(), places: prof.settings.places || [] });
        }
        delete state.cloud.adopt;
        applyingCloud = true; save(); applyingCloud = false;
        resetForm(); renderQuick(); applyLang();
      }
      const mine = JSON.stringify(cloudSettings());
      const localChanged = mine !== state.cloud.settingsHash;
      if (prof && prof.updated_at !== state.cloud.settingsAt && !localChanged && prof.settings?.settings) {
        applyingCloud = true;
        applyCloudSettings(prof.settings);
        state.cloud.settingsHash = JSON.stringify(cloudSettings());
        state.cloud.settingsAt = prof.updated_at;
        applyingCloud = false;
      } else if (localChanged || !prof) {
        const { data: up, error } = await SB.from('profiles').upsert({ id: uidNow, settings: cloudSettings() }).select('updated_at').single();
        if (error) throw error;
        state.cloud.settingsHash = mine; state.cloud.settingsAt = up.updated_at;
      }
      // 2. Gewijzigde ritten uploaden (ritten die nog naar de Sheet moeten, wachten daarop)
      const dirty = state.trips.filter((t) => t.cloudDirty && !t.demo && t.sync !== 'delete' && !(state.settings.scriptUrl && t.sync === 'add'));
      for (let i = 0; i < dirty.length; i += 500) {
        const chunk = dirty.slice(i, i + 500);
        const { error } = await SB.from('rides').upsert(chunk.map(rideRow), { onConflict: 'user_id,client_id' });
        if (error) throw error;
        chunk.forEach((t) => { t.cloudDirty = false; });
      }
      // 3. Verwijderde ritten als verwijderd markeren, zodat andere apparaten ze ook weghalen
      const dels = [...new Set([...(state.cloudDeletes || []), ...state.trips.filter((t) => t.sync === 'delete').map((t) => t.id)])];
      if (dels.length) {
        const { error } = await SB.from('rides').upsert(dels.map((id) => ({ client_id: id, deleted: true })), { onConflict: 'user_id,client_id' });
        if (error) throw error;
        state.cloudDeletes = [];
      }
      // 4. Ophalen wat sinds de vorige keer is veranderd
      let from = 0, newest = state.cloud.lastPull || null, got = 0;
      for (;;) {
        let q = SB.from('rides').select('*').order('updated_at', { ascending: true }).range(from, from + 999);
        if (state.cloud.lastPull) q = q.gt('updated_at', state.cloud.lastPull);
        const { data, error } = await q;
        if (error) throw error;
        applyingCloud = true;
        data.forEach((r) => { mergeRide(r); newest = r.updated_at; });
        applyingCloud = false;
        got += data.length;
        if (data.length < 1000) break;
        from += 1000;
      }
      state.cloud.lastPull = newest;
      state.cloud.lastSync = new Date().toISOString();
      delete state.cloud.error;
      applyingCloud = true; save(); applyingCloud = false;
      if (got) { renderQuick(); const a = $('.screen.active').id; if (a === 'screen-trips') renderTrips(); if (a === 'screen-summary') renderSummary(); }
      flush();
    } catch (err) {
      console.warn('cloud sync', err);
      state.cloud.error = err.message || String(err);
    } finally {
      applyingCloud = false; cloudBusy = false; renderAccount();
    }
  }
  const scheduleCloud = (ms = 1500) => { clearTimeout(cloudTimer); cloudTimer = setTimeout(cloudSync, ms); };
  window.addEventListener('ritlog:saved', () => { if (session && !applyingCloud) scheduleCloud(); });
  window.addEventListener('online', () => scheduleCloud(500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCloud(800); });

  // Bij inloggen: wisselt de gebruiker, dan beginnen we schoon; anders gaat alles lokaals mee naar het account
  async function onSignedIn(s) {
    session = s;
    if (state.cloud.userId && state.cloud.userId !== s.user.id) {
      const keep = { theme: state.settings.theme, uiLang: state.settings.uiLang };
      Object.assign(state, defaultState());
      Object.assign(state.settings, keep);
      state.cloud = {};
    }
    if (state.cloud.userId !== s.user.id) {
      // Nieuw op dit apparaat: ritten van dit apparaat gaan erbij (bestaande ritten in het account blijven),
      // instellingen van het account winnen. Dat regelt de eerste cloudSync (adopt), ook als het netwerk
      // nu even wegvalt; zo kunnen lege lokale instellingen het account nooit overschrijven.
      state.cloud = { userId: s.user.id, adopt: true };
      state.trips.forEach((t) => { if (t.sync !== 'delete' && !t.demo) t.cloudDirty = true; });
      applyingCloud = true; save(); applyingCloud = false;
    }
    // Eerst het account binnenhalen, dan pas het inlogscherm sluiten (anders zou een bestaand account
    // op een nieuw toestel de onboarding te zien krijgen)
    const fresh = !!state.cloud.adopt;
    if (fresh) await cloudSync();
    hideAuth();
    resetForm(); applyLang(); renderSyncPill();
    if (!fresh) cloudSync();
  }

  /* ---------- Inlogscherm: Apple en Google (geen e-mail nodig) ---------- */
  // App: Apple via het native venster, Google via een veilig browservenster dat terugkeert via
  // io.github.chenxi981211.ritlog://login-callback. Website: doorsturen naar Apple/Google en terug.
  const APP_RETURN = `${CFG.appleClientId}://login-callback`;
  const WEB_RETURN = location.origin + location.pathname;
  const authEl = $('#auth-screen');
  function showAuth() {
    authEl.classList.remove('hidden');
    document.body.classList.add('auth-open');
    $('#auth-error').textContent = '';
  }
  function hideAuth() { authEl.classList.add('hidden'); document.body.classList.remove('auth-open'); setTimeout(() => maybeOnboard(), 0); }
  function friendlyAuthError(err) {
    const m = String(err?.message || err || '');
    if (/cancel|1001|closed/i.test(m)) return '';
    if (/not enabled|unsupported provider/i.test(m)) return 'Deze manier van inloggen is nog niet ingesteld.';
    if (/fetch|network/i.test(m)) return 'Geen verbinding. Controleer je internet.';
    return m;
  }
  const authError = (err) => { $('#auth-error').textContent = tr(friendlyAuthError(err)); };
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function signInWith(provider) {
    if (NATIVE && provider === 'apple' && Plugins.SignInWithApple) {
      const raw = crypto.randomUUID() + crypto.randomUUID();
      const res = await Plugins.SignInWithApple.authorize({
        clientId: CFG.appleClientId, redirectURI: `${CFG.supabaseUrl}/auth/v1/callback`, scopes: 'email name', state: uid(), nonce: await sha256Hex(raw),
      });
      const { error } = await SB.auth.signInWithIdToken({ provider: 'apple', token: res.response.identityToken, nonce: raw });
      if (error) throw error;
      return;
    }
    if (NATIVE) {
      // Google in de app: inlogpagina in een veilig browservenster, daarna terug naar de app.
      // Niet twee vensters tegelijk openen (dubbel tikken).
      if (Date.now() - oauthOpenedAt < 4000) return;
      oauthOpenedAt = Date.now();
      const { data, error } = await (SB_OAUTH || SB).auth.signInWithOAuth({ provider, options: { redirectTo: APP_RETURN, skipBrowserRedirect: true } });
      if (error) throw error;
      await Plugins.Browser.open({ url: data.url, presentationStyle: 'popover' });
      return;
    }
    const { error } = await SB.auth.signInWithOAuth({ provider, options: { redirectTo: WEB_RETURN } });
    if (error) throw error;
  }
  // Terugkeer in de app na Google: sessie uit de link overnemen (of, voor oudere links, code inwisselen)
  let oauthOpenedAt = 0;
  const handledReturns = new Set();
  Plugins.App?.addListener?.('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith(APP_RETURN) || handledReturns.has(url)) return;
    handledReturns.add(url);
    oauthOpenedAt = 0;
    Plugins.Browser?.close().catch(() => {});
    const q = new URL(url.replace('#', '?')).searchParams;
    let error = null;
    if (q.get('access_token') && q.get('refresh_token')) {
      ({ error } = await SB.auth.setSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token') }));
    } else if (q.get('code')) {
      ({ error } = await SB.auth.exchangeCodeForSession(q.get('code')));
    } else if (q.get('error_description')) error = new Error(q.get('error_description'));
    // Al ingelogd (bijv. een tweede terugkeer)? Dan is er niets mis.
    if (error && !(await SB.auth.getSession()).data.session) authError(error);
  });
  authEl.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'auth-skip') { state.settings.skipAccount = true; save(); hideAuth(); return; }
    const provider = b.dataset.provider; if (!provider) return;
    $('#auth-error').textContent = '';
    b.disabled = true;
    try { await signInWith(provider); } catch (err) { authError(err); } finally { b.disabled = false; }
  });

  /* ---------- Account in Instellingen ---------- */
  function renderAccount() {
    const card = $('#account-card');
    if (!card) return;
    if (!SB) { card.closest('.account-wrap').classList.add('hidden'); return; }
    if (!session) {
      card.innerHTML = `<button type="button" class="list-row" id="acc-login">
        <span class="l-ico">${ICON.user}</span>
        <span class="grow"><strong>${esc(tr('Inloggen of account maken'))}</strong><small>${esc(tr('Je ritten veilig bewaard en op al je apparaten'))}</small></span>
        ${ICON.chev}</button>`;
      return;
    }
    const u = session.user;
    const via = { apple: 'Apple', google: 'Google' }[u.app_metadata?.provider] || '';
    const who = u.email ? (/privaterelay\.appleid\.com$/i.test(u.email) ? tr('Apple ID (verborgen e-mail)') : u.email) : tr('Apple ID');
    const status = cloudBusy ? tr('Synchroniseren…') : state.cloud.error ? tr('Synchronisatie mislukt — tik om opnieuw te proberen')
      : state.cloud.lastSync ? tr('Gesynchroniseerd {t}', { t: new Date(state.cloud.lastSync).toLocaleTimeString(I18N.locale(), { hour: '2-digit', minute: '2-digit' }) }) : '';
    card.innerHTML = `<button type="button" class="list-row" id="acc-sync">
        <span class="l-ico">${ICON.user}</span>
        <span class="grow"><strong>${esc(who)}</strong><small>${esc([via && tr('via {p}', { p: via }), status].filter(Boolean).join(' · '))}</small></span>
        ${ICON_REFRESH}</button>
      <button type="button" class="list-row" id="acc-logout"><span class="l-ico">${ICON.logout}</span><span class="grow"><strong>${esc(tr('Uitloggen'))}</strong></span></button>
      <button type="button" class="list-row danger-row" id="acc-delete"><span class="l-ico">${ICON.trash}</span><span class="grow"><strong>${esc(tr('Account verwijderen'))}</strong><small>${esc(tr('Wist je account en alle ritten in de cloud'))}</small></span></button>`;
  }
  function wipeLocal() {
    const keep = { theme: state.settings.theme, uiLang: state.settings.uiLang, skipAccount: true };
    Object.assign(state, defaultState(), { cloud: {} });
    Object.assign(state.settings, keep);
    save(); resetForm(); applyLang(); renderSettings();
  }
  $('#account-card').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'acc-login') { state.settings.skipAccount = false; showAuth(); }
    if (b.id === 'acc-sync') cloudSync();
    if (b.id === 'acc-logout') {
      if (!confirm(tr('Uitloggen? Je ritten blijven in je account en verdwijnen van dit apparaat.'))) return;
      await cloudSync();
      await SB.auth.signOut();
      session = null; wipeLocal(); toast(tr('Uitgelogd'));
    }
    if (b.id === 'acc-delete') {
      if (!confirm(tr('Je account en al je ritten in de cloud definitief verwijderen? Dit kan niet ongedaan worden gemaakt. Je Google Sheet blijft bestaan.'))) return;
      const { error } = await SB.rpc('delete_my_account');
      if (error) return toast(tr('Verwijderen mislukt: {e}', { e: error.message }), 4000);
      await SB.auth.signOut().catch(() => {});
      session = null; wipeLocal(); toast(tr('Je account is verwijderd'));
    }
  });

  async function startAccounts() {
    if (!SB) { maybeOnboard(); return; }
    const { data } = await SB.auth.getSession();
    SB.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' && s && s.user.id !== session?.user.id) onSignedIn(s);
      else if (event === 'TOKEN_REFRESHED' && s) session = s;
      else if (event === 'SIGNED_OUT') { session = null; renderAccount(); renderSyncPill(); }
    });
    if (data.session) await onSignedIn(data.session);
    else if (!state.settings.skipAccount) showAuth();
    else maybeOnboard();
    renderAccount();
  }

  /* ---------- Onboarding: eerste keer instellen + rondleiding ---------- */
  // Stappen: welkom → auto → vaste plekken → vergoeding → koppeling → rondleiding.
  // Bestaande gebruikers (met ritten of plekken) krijgen hem niet vanzelf te zien.
  const onbEl = $('#onboarding');
  const ONB_STEPS = ['welcome', 'car', 'places', 'money', 'connect', 'tour'];
  const TOUR = ['quick', 'summary', 'export'];
  let onb = { step: 0, tour: 0, only: null, car: null, home: '', work: '', route: null, store: 'app' };
  let onbCarView = null;
  const ico = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

  function maybeOnboard() {
    if (state.settings.onboarded || !authEl.classList.contains('hidden')) return;
    if (state.trips.length || state.places.length) { state.settings.onboarded = true; save(); return; }
    openOnboarding();
  }
  function openOnboarding(startAt = 'welcome', only = null) {
    const s = state.settings;
    onb = {
      step: ONB_STEPS.indexOf(startAt), tour: 0, only,
      car: { carName: s.carName || '', car: s.car || '', carColor: s.carColor || CAR_COLORS[0], carBody: s.carBody || 'auto' },
      home: placeByRole('home')?.address || '', work: placeByRole('work')?.address || '', route: null,
      store: s.scriptUrl ? 'sheet' : 'app',
    };
    onbEl.classList.remove('hidden');
    document.body.classList.add('onb-open');
    renderOnb();
  }
  function closeOnboarding() {
    onbCarView?.destroy(); onbCarView = null;
    state.settings.onboarded = true; save();
    onbEl.classList.add('hidden');
    document.body.classList.remove('onb-open');
    resetForm(); renderQuick(); applyLang(); go('new');
  }
  const stepName = () => ONB_STEPS[onb.step];

  function renderOnb() {
    const name = stepName();
    const steps = onb.only === 'tour' ? TOUR.length : ONB_STEPS.length - 1 + TOUR.length;
    const at = onb.only === 'tour' ? onb.tour : (name === 'tour' ? ONB_STEPS.length - 1 + onb.tour : onb.step);
    $('#onb-dots').innerHTML = Array.from({ length: steps }, (_, i) => `<span class="${i === at ? 'on' : ''}"></span>`).join('');
    $('#onb-back').style.visibility = at === 0 ? 'hidden' : 'visible';
    $('#onb-skip').style.visibility = name === 'tour' && onb.tour === TOUR.length - 1 ? 'hidden' : 'visible';
    if (name !== 'car') { onbCarView?.destroy(); onbCarView = null; }
    const body = $('#onb-body');
    const next = $('#onb-next');
    next.disabled = false;
    if (name === 'welcome') {
      body.innerHTML = `<div class="onb-step">
        <div class="onb-hero"><img src="icons/icon-512.png" alt=""></div>
        <h2>${esc(tr('Welkom bij Ritlog'))}</h2>
        <p class="lead">${esc(tr('Houd je zakelijke ritten bij in een paar tikken. In 1 minuut is alles ingesteld.'))}</p>
        <div class="onb-points">
          <div class="onb-point"><span class="l-ico">${ICON.work}</span><span><b>${esc(tr('Rit loggen in één tik'))}</b><small>${esc(tr('Vaste ritten zoals huis → werk staan klaar.'))}</small></span></div>
          <div class="onb-point"><span class="l-ico">${ICON_REFRESH}</span><span><b>${esc(tr('Altijd bewaard'))}</b><small>${esc(tr('In je account, en als je wilt ook in je Google Sheet.'))}</small></span></div>
          <div class="onb-point"><span class="l-ico">${ico('<path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/>')}</span><span><b>${esc(tr('Inzicht in je kilometers'))}</b><small>${esc(tr('Vergoeding, privé-saldo en statistieken.'))}</small></span></div>
        </div></div>`;
      next.textContent = tr('Aan de slag');
    }
    if (name === 'car') {
      const c = onb.car;
      body.innerHTML = `<div class="onb-step">
        <h2>${esc(tr('Wat voor auto rijd je?'))}</h2>
        <p class="lead">${esc(tr('We bouwen hem na. Typ merk en model en geef hem een naam.'))}</p>
        <div class="car-stage" id="onb-car"></div>
        <div class="card">
          <label for="onb-model">${esc(tr('Merk en model'))}</label>
          <input id="onb-model" value="${esc(c.car)}" placeholder="${esc(tr('Bijv. Toyota Aygo'))}" autocomplete="off">
          <p class="hint" id="onb-recog">${esc(recogText(c.car))}</p>
          <label for="onb-name">${esc(tr('Naam'))}</label>
          <input id="onb-name" value="${esc(c.carName)}" placeholder="${esc(tr('Bijv. Bolletje'))}" maxlength="24">
          <label>${esc(tr('Kleur'))}</label>
          <div class="swatches" id="onb-colors">${CAR_COLORS.map((col) => `<button type="button" data-color="${col}" style="background:${col}" class="${col === c.carColor ? 'on' : ''}" aria-label="${col}"></button>`).join('')}</div>
          <label>${esc(tr('Vorm'))}</label>
          <div class="chips body-chips" id="onb-shape" role="radiogroup" aria-label="${esc(tr('Vorm'))}">${bodyChipsHtml(c.car, c.carBody)}</div>
        </div></div>`;
      next.textContent = tr('Volgende');
      const opts = () => carOpts({ car: onb.car.car, carColor: onb.car.carColor, carBody: onb.car.carBody });
      const renderBody = () => { $('#onb-shape').innerHTML = bodyChipsHtml(onb.car.car, onb.car.carBody); };
      // Silhouetten komen uit car3d.js: na het laden de chips opnieuw tekenen
      loadCarModule().then(({ mountCar }) => { if (stepName() === 'car' && $('#onb-car')) { onbCarView = mountCar($('#onb-car'), opts()); renderBody(); } }).catch(() => {});
      $('#onb-model').addEventListener('input', (e) => {
        onb.car.car = e.target.value;
        $('#onb-recog').textContent = recogText(e.target.value);
        renderBody();
        onbCarView?.update(opts());
      });
      $('#onb-shape').addEventListener('click', (e) => {
        const b = e.target.closest('[data-body]'); if (!b) return;
        onb.car.carBody = b.dataset.body;
        renderBody();
        onbCarView?.update(opts());
      });
      $('#onb-name').addEventListener('input', (e) => { onb.car.carName = e.target.value; });
      $('#onb-colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]'); if (!b) return;
        onb.car.carColor = b.dataset.color;
        $$('#onb-colors button').forEach((x) => x.classList.toggle('on', x === b));
        onbCarView?.update(opts());
      });
    }
    if (name === 'places') {
      body.innerHTML = `<div class="onb-step">
        <h2>${esc(tr('Waar rijd je meestal heen?'))}</h2>
        <p class="lead">${esc(tr('Dan staat je vaste rit straks met één tik klaar.'))}</p>
        <div class="card">
          ${['home', 'work'].map((role) => `<div class="place-field" style="margin-bottom:12px">
            <label for="onb-${role}">${esc(tr(role === 'home' ? 'Thuis' : 'Werk'))}</label>
            <div class="input-wrap">
              <input id="onb-${role}" value="${esc(onb[role])}" placeholder="${esc(tr('Straat 1, Plaats'))}" autocomplete="off">
              <button type="button" class="icon-btn" data-onb-locate="${role}" aria-label="${esc(tr('Huidige locatie'))}">${ico('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')}</button>
            </div>
            <div class="suggest hidden" data-onb-suggest="${role}"></div>
          </div>`).join('')}
          <div id="onb-route"></div>
        </div></div>`;
      next.textContent = tr('Volgende');
      const showRoute = async () => {
        const box = $('#onb-route'); if (!box) return;
        if (!onb.home || !onb.work) { box.innerHTML = ''; return; }
        const k = knownRoute(onb.home, onb.work);
        if (k) onb.route = { km: k.km, min: k.min };
        else {
          box.innerHTML = `<p class="hint">${esc(tr('Route berekenen…'))}</p>`;
          try { onb.route = await routeDistance(onb.home, onb.work); } catch { onb.route = null; }
        }
        if (stepName() !== 'places') return;
        box.innerHTML = onb.route ? `<div class="onb-route">${ICON.work}<span>${esc(tr('Thuis → Werk: {km} km', { km: fmtKm(onb.route.km) }))}${onb.route.min ? ` · ~${onb.route.min} min` : ''}</span></div>` : '';
      };
      let t;
      ['home', 'work'].forEach((role) => {
        const input = $(`#onb-${role}`), box = $(`[data-onb-suggest="${role}"]`);
        const pick = (v) => { input.value = v; onb[role] = v; box.classList.add('hidden'); showRoute(); };
        input.addEventListener('input', () => {
          onb[role] = input.value.trim(); clearTimeout(t);
          const q = input.value.trim();
          if (q.length < 3) { box.classList.add('hidden'); return; }
          t = setTimeout(async () => {
            try {
              const hits = await suggestAddresses(q);
              if (input.value.trim() !== q) return;
              box.innerHTML = hits.map((h) => `<button type="button" data-v="${esc(h)}">${esc(h)}</button>`).join('');
              box.classList.toggle('hidden', !hits.length);
            } catch { /* offline */ }
          }, 250);
        });
        input.addEventListener('change', showRoute);
        input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 180));
        box.addEventListener('pointerdown', (e) => e.preventDefault());
        box.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) pick(b.dataset.v); });
      });
      $$('[data-onb-locate]').forEach((b) => b.addEventListener('click', async () => {
        b.classList.add('busy');
        try { const pos = await currentPosition(); const addr = await reverseGeocode(pos.lat, pos.lon); $(`#onb-${b.dataset.onbLocate}`).value = addr; onb[b.dataset.onbLocate] = addr; showRoute(); }
        catch (err) { toast(err.message); }
        b.classList.remove('busy');
      }));
      showRoute();
    }
    if (name === 'money') {
      const s = state.settings;
      body.innerHTML = `<div class="onb-step">
        <h2>${esc(tr('Vergoeding en privé-kilometers'))}</h2>
        <p class="lead">${esc(tr('Hiermee rekent Ritlog je vergoeding en privé-saldo uit. Je kunt dit later altijd aanpassen.'))}</p>
        <div class="card">
          <label for="onb-rate">${esc(tr('Vergoeding per km (€)'))}</label>
          <input id="onb-rate" inputmode="decimal" value="${esc(String(s.rate ?? 0.25).replace('.', ','))}">
          <p class="hint">${esc(tr('Wat je werkgever per zakelijke km betaalt. Dit verschilt per werkgever en land: kijk in je contract of reiskostenregeling.'))}</p>
          <label for="onb-priv">${esc(tr('Privé-km per jaar'))}</label>
          <input id="onb-priv" inputmode="numeric" value="${esc(String(privAllowance()))}">
          <p class="hint">${esc(tr('In Nederland mag je met een auto van de zaak max. 500 privé-km per jaar rijden zonder bijtelling. Geldt er voor jou iets anders? Pas het aan.'))}</p>
          <label>${esc(tr('Meestal rijd ik'))}</label>
          <div class="segmented" id="onb-type">${['Zakelijk', 'Privé'].map((v) => `<button type="button" data-v="${v}" class="${(s.defaultType || 'Zakelijk') === v ? 'on' : ''}">${esc(tr(v))}</button>`).join('')}</div>
        </div></div>`;
      next.textContent = tr('Klopt zo');
      $('#onb-type').addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        state.settings.defaultType = b.dataset.v;
        $$('#onb-type button').forEach((x) => x.classList.toggle('on', x === b));
      });
    }
    if (name === 'connect') {
      const signedIn = !!session;
      body.innerHTML = `<div class="onb-step">
        <h2>${esc(tr('Waar bewaar je je ritten?'))}</h2>
        <p class="lead">${esc(tr('Je ritten staan altijd in Ritlog. Gebruik je al een Google Sheet, dan kun je die erbij koppelen.'))}</p>
        <button type="button" class="onb-option ${onb.store === 'app' ? 'on' : ''}" data-store="app">
          <span class="l-ico">${ICON.user}</span>
          <span><b>${esc(tr('Alleen in Ritlog'))}</b><small>${esc(tr(signedIn ? 'Veilig in je account en op al je apparaten.' : 'Op dit apparaat. Log later in om te synchroniseren.'))}</small></span>
        </button>
        <button type="button" class="onb-option ${onb.store === 'sheet' ? 'on' : ''}" data-store="sheet">
          <span class="l-ico">${ico('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>')}</span>
          <span><b>${esc(tr('Ook in mijn Google Sheet'))}</b><small>${esc(tr('Elke rit komt er automatisch bij, in je eigen kolommen.'))}</small></span>
        </button>
        <div class="card onb-sheet ${onb.store === 'sheet' ? '' : 'hidden'}" id="onb-sheet">
          ${state.settings.scriptUrl ? `<p class="hint">✓ ${esc(tr('Je Google Sheet is al gekoppeld.'))}</p>` : `
          <input id="onb-connect" placeholder="${esc(tr('Plak koppel-link…'))}" autocapitalize="off" autocorrect="off" spellcheck="false">
          <ol>
            <li>${tr('Open je Google Sheet → <b>Extensies → Apps Script</b>. Wis alles, plak het script en klik op <b>Opslaan</b>.')}
              <br><button type="button" class="btn small" id="onb-copy-script" style="margin-top:6px">${esc(tr('Kopieer script'))}</button></li>
            <li>${tr('Klik <b>Implementeren → Nieuwe implementatie</b> → type <b>Web-app</b>. Zet <b>Wie heeft toegang</b> op <b>Iedereen</b> → <b>Implementeren</b> → geef toestemming.')}</li>
            <li>${tr(NATIVE ? 'Klik op de <b>Web-app-link</b>, tik op <b>Kopieer koppel-link</b> en plak hem hierboven. Klaar!' : 'Klik op de <b>Web-app-link</b> en scan de QR-code met je iPhone. Klaar!')}</li>
          </ol>`}
        </div></div>`;
      next.textContent = tr('Volgende');
      body.querySelectorAll('[data-store]').forEach((b) => b.addEventListener('click', () => {
        onb.store = b.dataset.store;
        body.querySelectorAll('[data-store]').forEach((x) => x.classList.toggle('on', x === b));
        $('#onb-sheet').classList.toggle('hidden', onb.store !== 'sheet');
      }));
      $('#onb-copy-script')?.addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(await loadScriptText()); e.target.textContent = tr('✓ Gekopieerd — plak in Apps Script'); } catch { /* geen klembord */ }
      });
    }
    if (name === 'tour') {
      const page = TOUR[onb.tour];
      const mocks = {
        quick: `<div class="mock-tiles"><div class="mock-tile hero"><span>${esc(tr('Voorstel · rit {n}', { n: 1 }))}</span><b>${esc(tr('Huis → Werk'))}</b>${onb.route ? `${fmtKm(onb.route.km)} km` : '22,60 km'}</div><div class="mock-tile"><span>&nbsp;</span><b>${esc(tr('Werk → Huis'))}</b>${onb.route ? `${fmtKm(onb.route.km)} km` : '22,60 km'}</div></div>`,
        // Dezelfde grafieken als op Overzicht, met een voorbeeldweek
        summary: (() => {
          const km = [38, 52, 46, 70, 31, 12, 6];
          const week = km.map((value, i) => ({ label: new Date(addDays('2024-01-01', i) + 'T12:00').toLocaleDateString(I18N.locale(), { weekday: 'short' }).replace('.', ''), value }));
          // Twee kerncijfers als dezelfde tegels als op Overzicht: geld en de privé-grens
          const tiles = `<div class="stats">${tile(ICON.euro, fmtEur(1284.5), tr('vergoeding'), tr('{r} per km', { r: fmtEur(0.25) }))}${
            tile(ICON.wallet, '312 km', tr('privé-saldo {y}', { y: new Date().getFullYear() }), tr('{u} van {a} km gebruikt', { u: fmtInt(188), a: 500 }))}</div>`;
          return `<div class="tour-charts">${tiles}${columnChart(tr('Km per weekdag'), week, ICON.calendar)}</div>`;
        })(),
        // De echte export-kaart van Overzicht (PDF en Excel), zonder ids en zonder import
        export: (() => {
          const card = $('#export-tax')?.closest('.card')?.cloneNode(true);
          if (!card) return '';
          card.querySelectorAll('#export-copy, #import-btn, input[type=file]').forEach((el) => el.remove());
          card.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
          return `<div class="tour-charts">${card.outerHTML}</div>`;
        })(),
      };
      const texts = {
        quick: ['Eén tik, rit gelogd', 'Bovenaan staan je vaste ritten. Tik erop, controleer en sla op. Afstand, datum en km-stand vult Ritlog zelf in.'],
        summary: ['Jouw overzicht', 'Je vergoeding, je privé-saldo en wanneer je het meest rijdt, in één oogopslag. Kies zelf wat je wilt zien.'],
        export: ['Exporteren wanneer je wilt', 'Onderaan Overzicht maak je een PDF voor de Belastingdienst of een Excel-bestand, voor elke periode die je kiest.'],
      };
      body.innerHTML = `<div class="onb-step">
        <div class="tour-mock">${mocks[page]}</div>
        <h2>${esc(tr(texts[page][0]))}</h2>
        <p class="lead">${esc(tr(texts[page][1]))}</p></div>`;
      next.textContent = onb.tour === TOUR.length - 1 ? tr('Eerste rit loggen') : tr('Volgende');
    }
  }

  // Gegevens van de huidige stap bewaren
  async function saveOnbStep(confirm = true) {
    const name = stepName();
    const s = state.settings;
    if (name === 'car') {
      const c = onb.car;
      Object.assign(s, { carName: c.carName.trim(), car: c.car.trim(), carColor: c.carColor, carBody: c.carBody || 'auto' });
      if (!editingId) F('car').value = s.car;
    }
    if (name === 'places') {
      [['home', 'Thuis', ['huis', 'thuis', 'home']], ['work', 'Werk', ['werk', 'kantoor', 'office', 'work']]].forEach(([role, label, aliases]) => {
        const addr = onb[role].trim(); if (!addr) return;
        const existing = placeByRole(role);
        if (existing) { existing.address = addr; delete existing.lat; delete existing.lon; }
        else state.places.push({ id: uid(), name: label, address: addr, aliases, role });
      });
      if (onb.home && onb.work && onb.route) {
        learnRoute(onb.home, onb.work, onb.route.km, onb.route.min);
        learnRoute(onb.work, onb.home, onb.route.km, onb.route.min);
      }
    }
    if (name === 'money') {
      if (confirm) s.moneyOk = true; // alleen bij "Klopt", niet bij Overslaan
      s.rate = parseDec($('#onb-rate').value) ?? s.rate;
      const p = parseInt0($('#onb-priv').value); if (p != null) s.privAllowance = p;
    }
    if (name === 'connect' && onb.store === 'sheet' && !s.scriptUrl) {
      const parsed = parseConnect($('#onb-connect')?.value);
      if (parsed) { const r = await connectSheet(parsed.url, parsed.token); if (!r.ok) return false; }
    }
    save();
    return true;
  }
  $('#onb-next').addEventListener('click', async () => {
    const btn = $('#onb-next');
    btn.disabled = true;
    const ok = await saveOnbStep();
    btn.disabled = false;
    if (!ok) return;
    if (stepName() === 'tour') {
      if (onb.tour < TOUR.length - 1) { onb.tour++; renderOnb(); } else closeOnboarding();
      return;
    }
    onb.step++; renderOnb();
  });
  $('#onb-back').addEventListener('click', () => {
    if (stepName() === 'tour' && onb.tour > 0) onb.tour--;
    else if (onb.step > 0 && onb.only !== 'tour') onb.step--;
    renderOnb();
  });
  $('#onb-skip').addEventListener('click', async () => {
    if (stepName() === 'tour' || onb.only === 'tour') { closeOnboarding(); return; }
    await saveOnbStep(false);
    onb.step = ONB_STEPS.indexOf('tour'); onb.tour = 0; renderOnb();
  });
  $('#onb-redo').addEventListener('click', () => openOnboarding('car'));
  $('#onb-tour').addEventListener('click', () => openOnboarding('tour', 'tour'));

  /* ---------- Voorbeeldritten (alleen lokaal, nooit naar account of Sheet) ---------- */
  const DEMO_PLACES = [
    { name: 'Thuis', address: 'Oude Delft 50, Delft', role: 'home', aliases: ['huis', 'thuis', 'home'] },
    { name: 'Werk', address: 'Weena 70, Rotterdam', role: 'work', aliases: ['werk', 'kantoor', 'office', 'work'] },
    { name: 'Klant Utrecht', address: 'Stationsplein 1, Utrecht', role: '', aliases: ['utrecht'] },
    { name: 'Klant Den Haag', address: 'Spui 70, Den Haag', role: '', aliases: ['den haag'] },
    { name: 'Groothandel', address: 'Fokkerstraat 20, Schiedam', role: '', aliases: ['groothandel'] },
    { name: 'Collega', address: 'Markt 1, Gouda', role: '', aliases: ['collega'] },
  ];
  // Afstanden tussen de voorbeeldplekken (km, ~min)
  const DEMO_KM = { 'Thuis|Werk': [16.8, 25], 'Werk|Klant Utrecht': [57.4, 45], 'Werk|Klant Den Haag': [24.6, 28], 'Werk|Groothandel': [9.2, 15],
    'Werk|Collega': [27.3, 28], 'Thuis|Klant Den Haag': [12.1, 20], 'Klant Utrecht|Thuis': [67.9, 55], 'Klant Den Haag|Thuis': [12.1, 20],
    'Groothandel|Thuis': [11.5, 17], 'Collega|Thuis': [33.0, 32], 'Klant Den Haag|Werk': [24.6, 28] };
  const hasDemo = () => state.trips.some((t) => t.demo);
  function loadDemo() {
    // Eenvoudige vaste willekeur, zodat het voorbeeld er elke keer hetzelfde uitziet
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const placeOf = {};
    DEMO_PLACES.forEach((p) => {
      let pl = p.role ? placeByRole(p.role) : state.places.find((x) => x.name === p.name);
      if (!pl) { pl = { id: uid(), ...p, name: tr(p.name), demo: true }; state.places.push(pl); }
      placeOf[p.name] = pl.address;
    });
    const dist = (a, b) => DEMO_KM[`${a}|${b}`] || DEMO_KM[`${b}|${a}`] || [15, 20];
    let odo = 98120;
    const trips = [];
    const ride = (date, no, from, to, desc, type = 'Zakelijk') => {
      const [km0] = dist(from, to);
      const km = Math.round((km0 + (rnd() - 0.5) * 0.6) * 100) / 100;
      const detour = rnd() < 0.08 ? Math.round((1 + rnd() * 3) * 10) / 10 : null;
      const priv = type === 'Privé';
      const t = {
        id: 'demo-' + uid(), demo: true, date, tripNo: no, desc: tr(desc), km, fee: calcFee(km, type), type,
        detourBiz: !priv && detour ? detour : null, detourPriv: priv && detour ? detour : null,
        from: placeOf[from], to: placeOf[to], car: state.settings.car || 'Toyota Aygo', plate: '', driver: '',
        odoStart: odo, odoEnd: (odo += Math.round(km + (detour || 0))), sync: 'local', cloudDirty: false,
      };
      trips.push(t);
    };
    const today = new Date();
    for (let back = 92; back >= 1; back--) {
      const d = new Date(today); d.setDate(d.getDate() - back);
      const day = d.getDay(), date = isoDate(d);
      if (day === 0 || day === 6) {
        if (rnd() < 0.18) { ride(date, 1, 'Thuis', 'Klant Den Haag', 'Privé: boodschappen', 'Privé'); ride(date, 2, 'Klant Den Haag', 'Thuis', 'Privé: terug naar huis', 'Privé'); }
        continue;
      }
      if (rnd() < 0.12) continue; // vrije dag
      let no = 1;
      ride(date, no++, 'Thuis', 'Werk', 'Van huis naar werk');
      const r = rnd();
      if (r < 0.18) {
        const c = pick(['Klant Utrecht', 'Klant Den Haag', 'Groothandel']);
        ride(date, no++, 'Werk', c, pick(['Overleg met klant', 'Montage bij klant', 'Onderdelen ophalen', 'Klacht afhandelen bij klant']));
        ride(date, no++, c, 'Thuis', 'Naar huis');
      } else if (r < 0.26) {
        ride(date, no++, 'Werk', 'Collega', 'Collega thuis afzetten');
        ride(date, no++, 'Collega', 'Thuis', 'Naar huis');
      } else {
        ride(date, no++, 'Werk', 'Thuis', 'Van werk naar huis');
      }
    }
    state.trips.push(...trips);
    if (!state.settings.car) Object.assign(state.settings, { car: 'Toyota Aygo', carName: state.settings.carName || 'Bolletje', carColor: state.settings.carColor || '#e5484d' });
    Object.entries(DEMO_KM).forEach(([k, [km, min]]) => { const [a, b] = k.split('|'); learnRoute(placeOf[a], placeOf[b], km, min); learnRoute(placeOf[b], placeOf[a], km, min); });
    save();
    return trips.length;
  }
  function removeDemo() {
    state.trips = state.trips.filter((t) => !t.demo);
    const used = new Set(state.trips.flatMap((t) => [norm(t.from), norm(t.to)]));
    state.places = state.places.filter((p) => !p.demo || used.has(norm(p.address)));
    save();
  }
  function renderDemoBtn() {
    $('#demo-btn').textContent = tr(hasDemo() ? 'Voorbeeldritten verwijderen' : 'Voorbeeldritten laden');
  }
  $('#demo-btn').addEventListener('click', () => {
    if (hasDemo()) {
      if (!confirm(tr('Alle voorbeeldritten verwijderen? Je eigen ritten blijven staan.'))) return;
      removeDemo(); toast(tr('Voorbeeldritten verwijderd'));
    } else {
      const n = loadDemo();
      toast(tr('{n} voorbeeldritten geladen', { n }));
    }
    renderDemoBtn(); resetForm(); renderQuick(); renderSettings();
  });
  renderDemoBtn();

  /* ---------- Hulp & support ---------- */
  const openUrl = (url) => (NATIVE && Plugins.Browser ? Plugins.Browser.open({ url }) : window.open(url, '_blank', 'noopener'));
  function renderHelp() {
    const mail = CFG.supportEmail || '';
    const a = $('#help-mail');
    a.hidden = !mail;
    $('#help-web').hidden = !NATIVE || !CFG.webUrl; // alleen nuttig in de iPhone-app
    a.href = `mailto:${mail}?subject=${encodeURIComponent(tr('{app}: vraag of feedback', { app: tr('Ritlog') }) + ' (' + APP_VERSION + ')')}`;
    $('#help-mail-sub').textContent = tr('Loop je ergens tegenaan of heb je een idee? Mail ons, we lezen alles.');
  }
  $('#help-faq').addEventListener('click', () => openUrl(CFG.supportUrl + (I18N.lang === 'en' ? '#en' : '')));
  $('#help-about').addEventListener('click', () => {
    const text = (CFG.about || {})[I18N.lang === 'en' ? 'en' : 'nl'] || '';
    $('#about-text').innerHTML = text.split(/\n\n+/).map((p) => `<p>${esc(p)}</p>`).join('');
    $('#about-sub').textContent = tr('Ritlog') + ' · ' + APP_VERSION;
    const coffee = $('#about-coffee');
    coffee.classList.toggle('hidden', !CFG.coffeeUrl);
    if (CFG.coffeeUrl) coffee.href = CFG.coffeeUrl;
    $('#about-dialog').showModal();
  });
  $('#help-web').addEventListener('click', () => openUrl(CFG.webUrl));
  // In de app: in een browservenster openen (anders opent de link niets)
  $('#about-coffee').addEventListener('click', (e) => { if (NATIVE && CFG.coffeeUrl) { e.preventDefault(); openUrl(CFG.coffeeUrl); } });
  $('#about-close').addEventListener('click', () => $('#about-dialog').close());

  /* ---------- Openingsanimatie (één keer per keer openen; tik om over te slaan) ---------- */
  function playOpening() {
    const el = $('#intro');
    let seen = false;
    try { seen = sessionStorage.getItem('ritlog.intro') === '1'; sessionStorage.setItem('ritlog.intro', '1'); } catch {}
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const force = /[?&]intro\b/.test(location.search);
    if (!force && (seen || reduce || window.__ritlogNoIntro)) { el.remove(); return; }
    const end = (cleanup) => { el.classList.add('show', 'out'); setTimeout(() => { cleanup?.(); el.remove(); }, 480); };
    const failsafe = setTimeout(() => end(), 6000);
    loadCarModule()
      .then(({ playIntro }) => playIntro($('#intro-stage'), carOpts(), { onTitle: () => el.classList.add('show') }))
      .then((cleanup) => { clearTimeout(failsafe); setTimeout(() => end(cleanup), 150); })
      .catch(() => { clearTimeout(failsafe); end(); });
  }

  /* ---------- start ---------- */
  if (/setup=|connect=/.test(location.hash)) {
    const h = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => {
      const parsed = /connect=/.test(h) && parseConnect(h);
      if (parsed) connectSheet(parsed.url, parsed.token); else importSetup(h);
    }, 0);
  }
  if (!state.settings.uiLang) state.settings.uiLang = /^nl/i.test(navigator.language || '') ? 'nl' : 'en';
  I18N.setLang(state.settings.uiLang);
  resetForm();
  applyLang();
  playOpening();
  // Apple-login werkt alleen in de iPhone-app (native); op de website alleen Google
  if (!NATIVE) $$('[data-provider="apple"]').forEach((b) => { b.hidden = true; });
  // ?demo[&tab=summary&scroll=600]: open straight into the app with sample rides (handy for a quick look and screenshots)
  {
    const q = new URLSearchParams(location.search);
    if (q.has('demo')) {
      if (!hasDemo() && !state.trips.length) { loadDemo(); resetForm(); renderQuick(); }
      if (q.has('shots')) document.body.classList.add('shots');
      if (q.get('tab')) go(q.get('tab'));
      if (q.get('car')) setTimeout(openCarDialog, 300);
      if (q.get('scroll')) setTimeout(() => scrollTo(0, +q.get('scroll')), 600);
      if (q.get('to')) setTimeout(() => document.getElementById(q.get('to'))?.scrollIntoView({ block: 'center' }), 700);
    }
  }
  flush().then(() => pull(true));
  startAccounts();

  if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    // Nieuwe versie gepubliceerd → automatisch één keer herladen
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
  // Voor tests in de browser
  window.__ritlog = { state: () => state };
})();
