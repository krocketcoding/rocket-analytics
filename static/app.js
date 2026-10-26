// Rocket Analytics front end: detail modals and shared helpers.
// Chart code lives in chart-factories.js, chart-defs.js, and
// charts.js, and the two-pane workspace shell in workspace.js — all
// load after this file (JS_FILES in pipeline/config.py) and share its
// top-level bindings.
// All data is baked into the page by the build as JSON inside
// <script type="application/json"> tags; parse it once up front.

const $ = id => document.getElementById(id);
const readJson = id => JSON.parse($(id).textContent);

const LAUNCHES = {upcoming: readJson('data-upcoming'), past: readJson('data-previous')};
const ENTITIES = readJson('data-entities');
const STATS = readJson('data-stats');
// url -> data URI for images embedded in the offline bundle; empty online,
// where imgSrc passes the original URL straight through.
const IMAGES = readJson('data-images');
const imgSrc = url => IMAGES[url] || url;

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

$('data-updated').textContent = fmtLocal($('data-updated').dataset.ts);
// The server-side date is ISO text; reformat each table cell locally.
document.querySelectorAll('td[data-net]').forEach(td => {
  const d = new Date(td.dataset.net);
  if (isNaN(d)) return;
  td.innerHTML = esc(d.toLocaleDateString(undefined, {dateStyle: 'medium'}))
    + '<br>' + esc(d.toLocaleTimeString(undefined, {timeStyle: 'short'}));
});

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
  ['Status', d => d.status],
  ['Launch window', d => d.window_start && `${fmtLocal(d.window_start)} – ${fmtLocal(d.window_end)}`],
  ['Mission', d => d.mission_name],
  ['Type', d => d.mission_type],
  ['Orbit', d => d.orbit],
  ['Program', d => (d.program || []).filter(Boolean).join(' · ')],
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
  ['Location', p => p.location],
  ['Coordinates', p => p.latitude && `${p.latitude}, ${p.longitude}`],
  ['Launches', p => p.launches],
];

// Extra launch stats comparing against the pad's own history
const statRows = d => {
  const total = d.attempts_location;
  const location = ENTITIES.pads[d.pad_id]?.location;
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
  return (e.image ? `<img class="modal-image" src="${esc(imgSrc(e.image))}" alt="">` : '')
    + `<dl class="modal-details">${fieldRows(e, fieldDefs)}</dl>`
    + (e.description ? `<p class="entity-desc">${esc(e.description)}</p>` : '')
    + (linkHtml ? `<p class="entity-links">${linkHtml}</p>` : '');
}

function entitySection(title, e, fieldDefs, links) {
  const body = entityBody(e, fieldDefs, links);
  return body ? `<h3>${esc(title)}: ${esc(e.name)}</h3>${body}` : '';
}

// The provider logo is often the same asset as the rocket image — show it once.
const dedupeProviderImage = (provider, rocket) =>
  provider && rocket && provider.image === rocket.image
    ? {...provider, image: null} : provider;

function renderEntities(d) {
  const rocket = ENTITIES.rockets[d.rocket_id];
  const provider = dedupeProviderImage(ENTITIES.providers[d.provider_id], rocket);
  const pad = ENTITIES.pads[d.pad_id];
  const agencies = (d.agency_ids || [])
    .map(id => ENTITIES.agencies[id]).filter(Boolean);

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

const updateCard = u => `<div class="update">
  <div class="update-meta">${u.profile_image ? `<img class="update-avatar" src="${esc(u.profile_image)}" alt="">` : ''}${esc(fmtLocal(u.created_on) || '')}${u.created_by ? ' · ' + esc(u.created_by) : ''}</div>
  <p>${esc(u.comment)}</p>
  ${u.info_url ? extLink('Source', u.info_url) : ''}
</div>`;

function renderUpdates(d) {
  const updates = d.updates || [];
  $('mtab-updates').innerHTML = updates.length
    ? updates.map(updateCard).join('')
    : '<p class="muted">No updates for this launch.</p>';
}

const linkList = links => '<ul class="link-list">' + links.map(l =>
  `<li>${extLink(l.label || l.url, l.url)}</li>`
).join('') + '</ul>';

function renderLinks(d) {
  const launch = d.links || [];
  const mission = d.mission_links || [];
  $('mtab-links').innerHTML =
    (launch.length ? `<h3>Launch</h3>${linkList(launch)}` : '')
    + (mission.length ? `<h3>Mission</h3>${linkList(mission)}` : '')
    || '<p class="muted">No links for this launch.</p>';
}

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

// Sortable rocket columns: data-sort names a rocket entity key.
// A new column starts descending; re-clicking flips direction. The
// current sort is recorded on the wrap's dataset so the workspace can
// serialize and restore it; sortRockets is called from workspace.js
// when a saved layout lands the table in a pane.
const rocketTbody = document.querySelector('#tab-rockets tbody');
const rocketSortThs = document.querySelectorAll('#tab-rockets th.sortable');
let rocketSortKey = 'launches';

function sortRockets(key, dir) {
  const th = [...rocketSortThs].find(t => t.dataset.sort === key);
  if (!th) return;
  rocketSortKey = key;
  rocketSortThs.forEach(t => delete t.dataset.dir);
  th.dataset.dir = dir;
  const mul = dir === 'desc' ? 1 : -1;
  const val = tr => ENTITIES.rockets[tr.dataset.id]?.[key];
  [...rocketTbody.querySelectorAll('tr')]
    .sort((a, b) => {
      const va = val(a), vb = val(b);
      // Unknowns stay at the bottom in either direction.
      if (va == null) return vb == null ? 0 : 1;
      if (vb == null) return -1;
      return mul * (vb - va);
    })
    .forEach(r => rocketTbody.appendChild(r));
  const wrap = $('tab-rockets');
  wrap.dataset.sort = key;
  wrap.dataset.dir = dir;
}

rocketSortThs.forEach(th => th.addEventListener('click', () => {
  const key = th.dataset.sort;
  const dir = key === rocketSortKey && th.dataset.dir === 'desc'
    ? 'asc' : 'desc';
  sortRockets(key, dir);
}));

const modal = $('modal');
const rocketModal = $('rocket-modal');
const setImg = (img, url) => { img.hidden = !url; if (url) img.src = url; };
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
}

function openModal(d) {
  $('modal-name').textContent = d.name;
  setImg($('modal-image'), d.image);
  setImg($('modal-infographic'), d.infographic);
  $('modal-live').hidden = !d.webcast_live;
  $('modal-details').innerHTML = fieldRows(d, LAUNCH_FIELDS);
  $('modal-desc').textContent = d.mission_description || '';
  $('modal-patches').innerHTML = (d.mission_patches || [])
    .map(u => `<img class="patch" src="${esc(imgSrc(u))}" alt="Mission patch">`).join('');

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
  const rocket = ENTITIES.rockets[id];
  if (!rocket) return;
  $('rocket-modal-name').textContent = rocket.name || 'Rocket';
  $('rtab-rocket').innerHTML =
    entityBody(rocket, ROCKET_FIELDS, entityLinks(rocket))
    || '<p class="muted">No details available.</p>';

  // The manufacturer may be stored as a provider or an agency entity.
  const provider = dedupeProviderImage(
    ENTITIES.providers[rocket.manufacturer_id]
      || ENTITIES.agencies[rocket.manufacturer_id], rocket);
  $('rtab-provider').innerHTML = provider
    ? entityBody(provider, AGENCY_FIELDS, entityLinks(provider))
    : (rocket.manufacturer
        ? `<p class="entity-desc">${esc(rocket.manufacturer)}</p>`
        : '<p class="muted">No details available.</p>');

  resetRocketTabs();
  showModal(rocketModal);
}

// Row clicks open the matching modal; Esc, backdrop, and × close them.
document.querySelector('main').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-set]');
  if (!tr) return;
  if (tr.dataset.set === 'rockets') openRocketModal(tr.dataset.id);
  else openModal(LAUNCHES[tr.dataset.set][+tr.dataset.idx]);
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
