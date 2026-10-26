// Rocket Analytics front end: detail modals and shared helpers.
// Stats are computed by stats.js, the chart code lives in
// chart-factories.js, chart-defs.js, and charts.js, table rendering in
// tables.js, and the two-pane workspace shell in workspace.js — all
// load after this file (JS_FILES in pipeline/config.py) and share its
// top-level bindings.
// All data is baked into the page as one normalized JSON blob inside a
// <script type="application/json" id="data"> tag; parse it once up
// front. Launch records carry ids into the entity tables
// (agencies/rockets/pads/locations/statuses/programs/authors) and
// indices into the images list — nothing is embedded twice.

const $ = id => document.getElementById(id);

const DATA = JSON.parse($('data').textContent);
// Image references are indices into the interned URL table; the offline
// build swaps wanted slots for data URIs and leaves null elsewhere, so
// a null result means "no image to show". Index 0 is a real image —
// always test the resolved value, never the index's truthiness.
const imgSrc = i => DATA.images[i] ?? null;

// Formatting and markup helpers
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmtLocal = s => s ? new Date(s)
  .toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : null;
const num = (v, unit) => v != null ? Number(v).toLocaleString() + (unit ? ' ' + unit : '') : null;
const yesNo = v => v == null ? null : (v ? 'Yes' : 'No');
const extLink = (label, url) => url
  ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';

// ISO 8601 durations ("P3DT12H" as stored by the API) -> "3d 12h"
const fmtDuration = s => {
  const m = s && s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/);
  if (!m) return s;
  return [[m[1], 'd'], [m[2], 'h'], [m[3], 'm']]
    .filter(([v]) => v).map(([v, u]) => v + u).join(' ') || null;
};

$('data-updated').textContent = fmtLocal(DATA.meta.updated) || '';

// Render [label, value] pairs as <dt>/<dd>, skipping empty values
const dlRows = pairs => pairs
  .filter(([, v]) => v != null && v !== '')
  .map(([l, v]) => `<dt>${esc(l)}</dt><dd>${esc(v)}</dd>`)
  .join('');

// Evaluate [label, getter] field definitions against an object
const fieldRows = (obj, defs) => dlRows(defs.map(([l, get]) => [l, get(obj)]));

// Field definitions for the details modals: [label, getter] pairs, in
// display order. Getters return null/'' for fields to skip.
const LAUNCH_FIELDS = [
  ['Date', d => fmtLocal(d.net)],
  ['Status', d => DATA.statuses[d.status_id]?.name],
  ['Launch window', d => d.window_start && `${fmtLocal(d.window_start)} – ${fmtLocal(d.window_end)}`],
  ['Mission', d => d.mission_name],
  ['Type', d => d.mission_type],
  ['Orbit', d => d.orbit],
  ['Program', d => (d.program_ids || []).map(id => DATA.programs[id]?.name).filter(Boolean).join(' · ')],
  ['Success probability', d => d.probability != null && d.probability >= 0 ? `${d.probability}%` : null],
  ['Hold reason', d => d.holdreason],
  ['Failure reason', d => d.failreason],
  ['Weather concerns', d => d.weather_concerns],
];

// Launch-record rows shared by provider, agency, and rocket sections
const RECORD_FIELDS = [
  ['Launches', e => e.launches],
  ['Successful', e => e.successful],
  ['Failed', e => e.failed],
  ['Pending', e => e.pending],
  ['Success streak', e => e.streak],
  ['Landings', e => e.landings_attempted != null
    ? `${e.landings_successful}/${e.landings_attempted}` : null],
  ['Failed landings', e => e.landings_failed],
  ['Landing streak', e => e.landing_streak],
];

const ROCKET_FIELDS = [
  ['Family', r => r.family],
  ['Variant', r => r.variant],
  ['Status', r => r.active == null ? null : (r.active ? 'Active' : 'Retired')],
  ['Reusable', r => yesNo(r.reusable)],
  ['Length', r => num(r.length, 'm')],
  ['Diameter', r => num(r.diameter, 'm')],
  ['Launch mass', r => num(r.launch_mass, 't')],
  ['LEO capacity', r => num(r.leo_capacity, 'kg')],
  ['GTO capacity', r => num(r.gto_capacity, 'kg')],
  ['Thrust', r => num(r.thrust, 'kN')],
  ['Maiden flight', r => r.maiden_flight],
  ['Launch cost', r => r.launch_cost != null ? `$${num(r.launch_cost)}` : null],
  ['Alias', r => r.alias],
  ['Stages', r => r.min_stage != null ? `${r.min_stage}–${r.max_stage}` : null],
  ['Apogee', r => num(r.apogee, 'km')],
  ['Range', r => num(r.vehicle_range, 'km')],
  ...RECORD_FIELDS,
];

const AGENCY_FIELDS = [
  ['Type', a => a.type],
  ['Country', a => a.country],
  ['Administrator', a => a.administrator],
  ['Founded', a => a.founded],
  ['Launchers', a => a.launchers],
  ['Spacecraft', a => a.spacecraft],
  ...RECORD_FIELDS,
];

const PAD_FIELDS = [
  ['Location', p => DATA.locations[p.location_id]?.name],
  ['Coordinates', p => p.latitude && `${p.latitude}, ${p.longitude}`],
  ['Launches', p => p.launches],
];

// Extra launch stats comparing against the pad's own history
const statRows = d => {
  const total = d.attempts_location;
  const location = DATA.locations[DATA.pads[d.pad_id]?.location_id]?.name;
  const year = d.attempts_location_year;
  return [
    ...(location && total != null
      ? [[`Launches from ${location}`, `${total}${year != null ? ` (${year} this year)` : ''}`]]
      : []),
    ['Since last pad launch', fmtDuration(d.pad_turnaround)],
  ];
};

// Entity (rocket/provider/agency/pad) sections inside the modals
const entityLinks = e => [['Info', e && e.info_url], ['Wiki', e && e.wiki_url]];

function entityBody(e, fieldDefs, links) {
  if (!e || !e.name) return '';
  const linkHtml = links.filter(([, u]) => u)
    .map(([l, u]) => extLink(l, u)).join(' ');
  const src = imgSrc(e.image);
  return (src ? `<img class="modal-image" src="${esc(src)}" alt="">` : '')
    + `<dl class="modal-details">${fieldRows(e, fieldDefs)}</dl>`
    + (e.description ? `<p class="entity-desc">${esc(e.description)}</p>` : '')
    + (linkHtml ? `<p class="entity-links">${linkHtml}</p>` : '');
}

function entitySection(title, e, fieldDefs, links) {
  const body = entityBody(e, fieldDefs, links);
  return body ? `<h3>${esc(title)}: ${esc(e.name)}</h3>${body}` : '';
}

// The provider logo is often the same asset as the rocket image — the
// interned indices compare equal, so show it once.
const dedupeProviderImage = (provider, rocket) =>
  provider && rocket && provider.image === rocket.image
    ? {...provider, image: null} : provider;

function renderEntities(d) {
  const rocket = DATA.rockets[d.rocket_id];
  const provider = dedupeProviderImage(DATA.agencies[d.provider_id], rocket);
  const pad = DATA.pads[d.pad_id];
  const agencies = (d.agency_ids || [])
    .map(id => DATA.agencies[id]).filter(Boolean);

  let html = entitySection('Rocket', rocket, ROCKET_FIELDS, entityLinks(rocket))
    + entitySection('Provider', provider, AGENCY_FIELDS, entityLinks(provider))
    + entitySection('Pad', pad, PAD_FIELDS,
      [['Map', pad && pad.map_url], ...entityLinks(pad)]);

  if (agencies.length) {
    html += '<h3>Agencies</h3><ul class="entity-list">'
      + agencies.map(a =>
        `<li>${esc(a.name)}${a.abbrev ? ` (${esc(a.abbrev)})` : ''}</li>`).join('')
      + '</ul>';
  }
  $('mtab-entities').innerHTML = html || '<p class="muted">No details available.</p>';
}

const updateCard = u => {
  const avatar = imgSrc(DATA.authors[u.created_by]?.image);
  return `<div class="update">
  <div class="update-meta">${avatar ? `<img class="update-avatar" src="${esc(avatar)}" alt="">` : ''}${esc(fmtLocal(u.created_on) || '')}${u.created_by ? ' · ' + esc(u.created_by) : ''}</div>
  <p>${esc(u.comment)}</p>
  ${u.info_url ? extLink('Source', u.info_url) : ''}
</div>`;
};

// Update text is ~half the gzipped dataset but only the Updates tab
// reads it, so the online build splits it into a companion script
// (meta.updates_src) that loads lazily; the offline build ships updates
// inline and has no updates_src. receiveLaunchUpdates attaches each
// update list to its launch by index — safe because both files come
// from the same build and are hash-versioned together. A script tag
// (not fetch) keeps file:// previews working.
let updatesPromise = null;
function loadUpdates() {
  if (updatesPromise) return updatesPromise;
  updatesPromise = new Promise((resolve, reject) => {
    if (!DATA.meta.updates_src) return resolve();
    window.receiveLaunchUpdates = payload => {
      for (const group in payload)
        payload[group].forEach((updates, i) => {
          DATA[group][i].updates = updates;
        });
      resolve();
    };
    const s = document.createElement('script');
    s.src = DATA.meta.updates_src;
    s.onerror = () => reject(new Error(`Failed to load ${s.src}`));
    document.body.append(s);
  });
  return updatesPromise;
}
// Fetch after the load event so it never competes with first paint; a
// modal opened earlier starts it on demand via renderUpdates.
addEventListener('load', () => loadUpdates());

// The launch the details modal is currently showing (null when closed).
let openLaunch = null;

function renderUpdates(d) {
  const pane = $('mtab-updates');
  if (d.updates || !DATA.meta.updates_src) {
    const updates = d.updates || [];
    pane.innerHTML = updates.length
      ? updates.map(updateCard).join('')
      : '<p class="muted">No updates for this launch.</p>';
    return;
  }
  // Not loaded yet — the promise re-renders only if the modal is still
  // open on this same launch by then.
  pane.innerHTML = '<p class="muted">Loading updates…</p>';
  loadUpdates().then(() => {
    if (openLaunch === d) renderUpdates(d);
  }, () => {
    pane.innerHTML = "<p class=\"muted\">Updates couldn't be loaded.</p>";
  });
}

const linkList = links => '<ul class="link-list">' + links.map(l =>
  `<li>${extLink(l.label || l.url, l.url)}</li>`
).join('') + '</ul>';

function renderLinks(d) {
  // The offline build strips all remote URLs and omits the Links tab
  // entirely — there is no pane to fill.
  if (DATA.meta.offline) return;
  const launch = d.links || [];
  const mission = d.mission_links || [];
  $('mtab-links').innerHTML =
    (launch.length ? `<h3>Launch</h3>${linkList(launch)}` : '')
    + (mission.length ? `<h3>Mission</h3>${linkList(mission)}` : '')
    || '<p class="muted">No links for this launch.</p>';
}

// Modal shells used to be Jinja macros; makeModal reproduces the same
// markup — same ids and classes — so style.css and the tab wiring keep
// working. `tabs` is [pane id, label, innerHtml] triples: one button
// plus one .modal-pane per triple, the first active and visible, the
// rest hidden.
function makeModal(id, tabs) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'modal';
  el.hidden = true;
  el.innerHTML = `
  <div class="modal-card">
    <button class="modal-close" aria-label="Close">&times;</button>
    <h2 id="${id}-name"></h2>
    <div class="modal-tabs">
      ${tabs.map(([pane, label], i) =>
        `<button class="tab${i === 0 ? ' active' : ''}" data-pane="${pane}">${label}</button>`).join('')}
    </div>
    ${tabs.map(([pane, , html = ''], i) =>
      `<div class="modal-pane" id="${pane}"${i ? ' hidden' : ''}>${html}</div>`).join('')}
  </div>`;
  document.body.append(el);
  return el;
}

// The Links tab only exists in the online build; the offline bundle
// strips all remote URLs, so it gets no tab and no pane.
const modal = makeModal('modal', [
  ['mtab-overview', 'Launch', `
    <img id="modal-image" class="modal-image" hidden alt="">
    <img id="modal-infographic" class="modal-image" hidden alt="">
    <p id="modal-live" class="live-badge" hidden>Webcast live</p>
    <dl id="modal-details" class="modal-details"></dl>
    <p id="modal-desc"></p>
    <div id="modal-patches" class="patch-row"></div>
    <h3 id="modal-stat-head" hidden>Statistics</h3>
    <dl id="modal-stats" class="modal-details"></dl>`],
  ['mtab-entities', 'Hardware & Orgs'],
  ['mtab-updates', 'Updates'],
  ...(DATA.meta.offline ? [] : [['mtab-links', 'Links']]),
]);
const rocketModal = makeModal('rocket-modal',
  [['rtab-rocket', 'Rocket'], ['rtab-provider', 'Provider']]);

const setImg = (img, url) => { img.hidden = !url; if (url) img.src = url; };

// Generic tab wiring: buttons carry data-pane pointing at their pane's id.
// Returns a reset function that re-activates the first tab.
function wireTabs(btnSel, paneSel, onSwitch) {
  const btns = [...document.querySelectorAll(btnSel)];
  const panes = [...document.querySelectorAll(paneSel)];
  const activate = btn => {
    btns.forEach(b => b.classList.toggle('active', b === btn));
    panes.forEach(p => p.hidden = p.id !== btn.dataset.pane);
    if (onSwitch) onSwitch(btn);
  };
  btns.forEach(btn => btn.addEventListener('click', () => activate(btn)));
  return () => activate(btns[0]);
}

const resetModalTabs = wireTabs('#modal .modal-tabs .tab', '#modal .modal-pane');
const resetRocketTabs = wireTabs('#rocket-modal .modal-tabs .tab',
                                 '#rocket-modal .modal-pane');

function showModal(m) {
  m.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal(m) {
  m.hidden = true;
  document.body.style.overflow = '';
  if (m === modal) openLaunch = null;
}

function openModal(d) {
  openLaunch = d;
  $('modal-name').textContent = d.name;
  setImg($('modal-image'), imgSrc(d.image));
  setImg($('modal-infographic'), imgSrc(d.infographic));
  $('modal-live').hidden = !d.webcast_live;
  $('modal-details').innerHTML = fieldRows(d, LAUNCH_FIELDS);
  $('modal-desc').textContent = d.mission_description || '';
  // Patch indices resolve through the images table; offline builds
  // leave null in slots that weren't worth embedding — skip those.
  $('modal-patches').innerHTML = (d.mission_patches || [])
    .map(imgSrc).filter(Boolean)
    .map(u => `<img class="patch" src="${esc(u)}" alt="Mission patch">`).join('');

  const statsHtml = dlRows(statRows(d));
  $('modal-stats').innerHTML = statsHtml;
  $('modal-stat-head').hidden = !statsHtml;

  renderEntities(d);
  renderUpdates(d);
  renderLinks(d);
  resetModalTabs();
  showModal(modal);
}

function openRocketModal(id) {
  const rocket = DATA.rockets[id];
  if (!rocket) return;
  $('rocket-modal-name').textContent = rocket.name || 'Rocket';
  $('rtab-rocket').innerHTML =
    entityBody(rocket, ROCKET_FIELDS, entityLinks(rocket))
    || '<p class="muted">No details available.</p>';

  // Provider, mission agency, and manufacturer share one agencies
  // table — the rocket's manufacturer_id resolves straight to it.
  const provider = dedupeProviderImage(DATA.agencies[rocket.manufacturer_id], rocket);
  $('rtab-provider').innerHTML = provider
    ? entityBody(provider, AGENCY_FIELDS, entityLinks(provider))
      || '<p class="muted">No details available.</p>'
    : '<p class="muted">No details available.</p>';

  resetRocketTabs();
  showModal(rocketModal);
}

// The table views' data-set names map onto the launch lists they show.
const LAUNCH_SETS = {upcoming: DATA.upcoming, past: DATA.previous};

// Row clicks open the matching modal; Esc, backdrop, and × close them.
document.querySelector('main').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-set]');
  if (!tr) return;
  if (tr.dataset.set === 'rockets') openRocketModal(tr.dataset.id);
  else openModal(LAUNCH_SETS[tr.dataset.set][+tr.dataset.idx]);
});
[modal, rocketModal].forEach(m => {
  m.querySelector('.modal-close')
    .addEventListener('click', () => closeModal(m));
  m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  [modal, rocketModal].forEach(closeModal);
});
