// Boots nearly the whole front end in a vm sandbox — app.js, stats.js,
// chart-factories.js, chart-defs.js, charts.js, workspace.js
// concatenated in real load order over a stub DOM — then exercises the
// pure helpers and the URL-hash persistence (serialize/parseState). The
// boot itself is the smoke test: any top-level ReferenceError or
// signature mismatch across files surfaces as a load failure.
// Run from the repo root with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {makeData, launch} = require('./fixtures');

const DIR = path.join(__dirname, '..', 'static');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

// Generic DOM element stub — enough surface for every load-time touch:
// property bags (dataset/style/classList), child lists, listeners, and
// on-demand child queries. querySelectorAll returns two stubs for
// '.seg-btn' (the pager's prev/next pair) and nothing otherwise.
function makeEl() {
  const el = {
    id: '', className: '', innerHTML: '', textContent: '', title: '',
    value: '', checked: false, hidden: false, disabled: false,
    type: '', src: '', placeholder: '', offsetHeight: 0, options: [],
    dataset: {}, style: {}, children: [],
    classList: {add() {}, remove() {}, toggle() {}},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    prepend(...cs) { this.children.unshift(...cs); },
    replaceChildren(...cs) { this.children = [...cs]; },
    querySelector() { return makeEl(); },
    querySelectorAll(sel) {
      return sel === '.seg-btn' ? [makeEl(), makeEl()] : [];
    },
    listeners: {},
    addEventListener(event, fn) {
      (this.listeners[event] ??= []).push(fn);
    },
    removeEventListener(event, fn) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
      }
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event.type;
      (this.listeners[type] || []).forEach(fn => fn.call(this, {type, target: this}));
    },
    setAttribute() {}, getAttribute() { return null; },
    remove() {}, focus() {}, close() {}, showModal() {},
    contains() { return false; },
    getBoundingClientRect() { return {left: 0, width: 100, bottom: 0}; },
    setPointerCapture() {},
    get parentElement() { return makeEl(); },
  };
  return el;
}

function loadApp(data) {
  function Chart(canvas, config) {
    this.canvas = canvas;
    this.data = config.data;
    this.options = config.options;
  }
  Chart.defaults = {};
  Chart.prototype.update = function () {};
  Chart.prototype.resize = function () {};
  Chart.prototype.destroy = function () {};

  const els = {};
  const sandbox = {
    Chart,
    DATA_RAW: JSON.stringify(data),
    console, setTimeout,
    document: {
      // app.js reads the dataset out of the <script id="data"> tag.
      getElementById: id => id === 'data'
        ? {textContent: sandbox.DATA_RAW} : (els[id] ??= makeEl()),
      querySelectorAll: () => [],
      querySelector: () => makeEl(),
      createElement: () => makeEl(),
      addEventListener() {},
      body: {append() {}, style: {}},
    },
    matchMedia: () => ({matches: false, addEventListener() {}}),
    ResizeObserver: class {observe() {} unobserve() {}},
    localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
    history: {replaceState(...a) { this.last = a[2]; }},
    location: {hash: '', pathname: '/x', search: ''},
    addEventListener() {},
    window: {},
  };
  vm.createContext(sandbox);
  const src = ['app.js', 'stats.js', 'chart-factories.js',
               'chart-defs.js', 'charts.js', 'tables.js', 'workspace.js']
    .map(read).join('\n');
  vm.runInContext(src + `
this.__x = {
  get panes() { return panes; },
  parseState, serialize, applyState, setFocus, loadState, defaultState,
  makeScopeSelect,
  esc, fmtDuration, isWebUrl, imgSrc, num, yesNo,
  DATA, STATS, CHART_DEFS, VIEW_DEFS, LAUNCH_SCOPES, freshFilters,
};`, sandbox);
  return sandbox.__x;
}

const norm = v => JSON.parse(JSON.stringify(v));

// --- helpers -----------------------------------------------------------

test('esc escapes all five HTML-significant characters', () => {
  const {esc} = loadApp(makeData());
  assert.equal(esc(`<a href="x">&'</a>`),
               '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('isWebUrl only accepts http(s)', () => {
  const {isWebUrl} = loadApp(makeData());
  assert.equal(isWebUrl('https://x'), true);
  assert.equal(isWebUrl('http://x'), true);
  assert.equal(isWebUrl('javascript:alert(1)'), false);
  assert.equal(isWebUrl('data:text/html,x'), false);
  assert.equal(isWebUrl(''), false);
  assert.equal(isWebUrl(null), false);
});

test('fmtDuration parses ISO 8601 durations', () => {
  const {fmtDuration} = loadApp(makeData());
  assert.equal(fmtDuration('P3DT12H'), '3d 12h');
  assert.equal(fmtDuration('PT30M'), '30m');
  assert.equal(fmtDuration('P1D'), '1d');
  assert.equal(fmtDuration('bogus'), 'bogus');
  assert.equal(fmtDuration(null), null);
});

test('imgSrc resolves indices against the interned image table', () => {
  const {imgSrc} = loadApp(makeData());
  assert.equal(imgSrc(0), 'https://img/0.png');  // index 0 is real
  assert.equal(imgSrc(1), null);                // null slot
  assert.equal(imgSrc(5), null);                // out of range
});

// --- year pagination control -------------------------------------------

test('makeScopeSelect builds a segmented pagination control and hides arrows at bounds', () => {
  const {makeScopeSelect} = loadApp(makeData());
  const scopes = ['2025', '2024', '2023'];
  const changes = [];
  const el = makeScopeSelect('2025', v => changes.push(v), scopes);

  // el has prev button, select, and next button
  const [prev, sel, next] = el.children;
  assert.equal(el.className, 'seg year-pager');
  assert.equal(el.hidden, false);
  assert.equal(prev.textContent, '‹');
  assert.equal(next.textContent, '›');
  assert.equal(sel.value, '2025');

  // At index 0 (newest year), prev (‹) should be hidden, next (›) visible
  assert.equal(prev.hidden, true);
  assert.equal(next.hidden, false);

  // Click next (›) -> moves to index 1 ('2024')
  next.dispatchEvent('click');
  assert.equal(sel.value, '2024');
  assert.deepEqual(changes, ['2024']);
  assert.equal(prev.hidden, false);
  assert.equal(next.hidden, false);

  // Click next (›) again -> moves to index 2 ('2023')
  next.dispatchEvent('click');
  assert.equal(sel.value, '2023');
  assert.deepEqual(changes, ['2024', '2023']);
  assert.equal(prev.hidden, false);
  assert.equal(next.hidden, true);

  // Click prev (‹) -> moves back to index 1 ('2024')
  prev.dispatchEvent('click');
  assert.equal(sel.value, '2024');
  assert.deepEqual(changes, ['2024', '2023', '2024']);
  assert.equal(prev.hidden, false);
  assert.equal(next.hidden, false);

  // Direct select change -> moves to index 0 ('2025')
  sel.value = '2025';
  sel.dispatchEvent('change');
  assert.deepEqual(changes, ['2024', '2023', '2024', '2025']);
  assert.equal(prev.hidden, true);
  assert.equal(next.hidden, false);

  // Single scope hides the control
  const single = makeScopeSelect('2025', () => {}, ['2025']);
  assert.equal(single.hidden, true);
});

test('the all-time pick heads the year drop-down outside the year stepping', () => {
  const {makeScopeSelect, CHART_DEFS, freshFilters, panes,
         serialize, parseState} = loadApp(makeData());
  const changes = [];
  const el = makeScopeSelect('all', v => changes.push(v),
    ['2025', '2024', '2023'], [['all', 'All time']]);
  const [prev, sel, next] = el.children;
  assert.equal(sel.children[0].textContent, 'All time');
  // 'all' isn't a year index — both arrows hide while it shows.
  assert.equal(prev.hidden, true);
  assert.equal(next.hidden, true);
  // Stepping still works once a real year is picked.
  sel.value = '2024';
  sel.dispatchEvent('change');
  assert.deepEqual(changes, ['2024']);
  assert.equal(prev.hidden, false);
  assert.equal(next.hidden, false);

  // An all-time dataset sums every yearly bucket, sorted by total.
  assert.deepEqual(norm(CHART_DEFS['by-rocket'].data(freshFilters('all'))), {
    'Falcon 9': {orbital: 2, suborbital: 0, failed: 1},
    NoMfr: {orbital: 1, suborbital: 0, failed: 0},
    OldOrb: {orbital: 1, suborbital: 0, failed: 0},
    Sounder: {orbital: 0, suborbital: 1, failed: 0},
  });
  // The nested buckets (sites/families) merge the same way.
  assert.deepEqual(norm(CHART_DEFS['by-site'].data(freshFilters('all'))),
    {'Cape Canaveral SFS': {orbital: 4, suborbital: 1, failed: 1}});

  // 'all' serializes as 'yall' and parses back into the year filter.
  panes[0].filters.year = 'all';
  assert.equal(serialize(), 'by-rocket;yall|upcoming');
  assert.equal(parseState('by-rocket;yall|upcoming').views[0].f.year, 'all');
});

// --- boot + persistence -------------------------------------------------

test('the workspace boots into the default split layout', () => {
  const x = loadApp(makeData());
  assert.equal(x.panes.length, 2);
  assert.equal(x.panes[0].defId, 'by-rocket');
  assert.equal(x.panes[1].defId, 'upcoming');
  assert.equal(x.serialize(), 'by-rocket|upcoming');
});

test('serialize writes every non-default filter token', () => {
  const x = loadApp(makeData());
  const f = x.panes[0].filters;
  f.year = '2024';
  f.country.codes.add('USA');
  f.country.codes.add('FRA');
  f.country.negate = true;
  f.successOnly = true;
  f.cumulative = true;
  f.variantStack = true;
  f.orbitCapable = true;
  f.entities.add('Falcon 9');
  f.rockets.add('Falcon 9');
  f.pageSize = 50;
  assert.equal(x.serialize(),
    'by-rocket;y2024;c!FRA,USA;so;cm;vs;oc;eFalcon%209;rFalcon%209;ps50' +
    '|upcoming');
});

test('parseState round-trips a full filter token set', () => {
  const x = loadApp(makeData());
  const s = x.parseState(
    'by-rocket-trend;y2024;c!FRA;so;cm;vs;oc;eFalcon%209;ps50' +
    '|past;qfalcon@60^1');
  assert.equal(s.views[0].v, 'by-rocket-trend');
  const f = s.views[0].f;
  assert.equal(f.year, '2024');
  assert.deepEqual(norm([...f.country.codes]), ['FRA']);
  assert.equal(f.country.negate, true);
  assert.ok(f.successOnly && f.cumulative && f.variantStack &&
            f.orbitCapable);
  assert.deepEqual(norm([...f.entities]), ['Falcon 9']);
  assert.equal(f.pageSize, 50);
  assert.equal(s.views[1].v, 'past');
  assert.equal(s.views[1].f.q, 'falcon');
  assert.equal(s.ratio, 0.6);
  assert.equal(s.focus, 1);
});

test('the column pick serializes and parses back', () => {
  const x = loadApp(makeData());
  x.panes[1].filters.cols.add('orbit');
  x.panes[1].filters.cols.add('provider');
  assert.equal(x.serialize(), 'by-rocket|upcoming;korbit,provider');
  const s = x.parseState('by-rocket|upcoming;korbit,provider');
  assert.deepEqual(norm([...s.views[1].f.cols].sort()),
                   ['orbit', 'provider']);
});

test('the rockets active-only toggle serializes and parses back', () => {
  const x = loadApp(makeData());
  x.applyState({ratio: 0.5, focus: 'split', views: [
    {v: 'by-rocket', f: {}},
    {v: 'rockets', f: {activeOnly: true}},
  ]});
  assert.equal(x.serialize(), 'by-rocket|rockets;ao');
  const s = x.parseState('by-rocket|rockets;ao');
  assert.equal(s.views[1].f.activeOnly, true);
});

test('parseState tolerates malformed input', () => {
  const x = loadApp(makeData());
  assert.equal(x.parseState(null), null);
  assert.equal(x.parseState(''), null);
  assert.equal(x.parseState('only-one-pane'), null);
  assert.equal(x.parseState('a|b|c'), null);
  assert.equal(x.parseState('x|y@abc'), null);   // @ must be digits
  assert.equal(x.parseState('x|y^2'), null);     // ^ accepts only 0 or 1
  // Unknown view falls back to that pane's default.
  const s = x.parseState('nope|upcoming');
  assert.equal(s.views[0].v, 'by-rocket');
  // Unknown tokens are ignored, out-of-range sizes dropped.
  const t = x.parseState('by-rocket;zz;ps7|upcoming');
  assert.equal(t.views[0].f.pageSize, undefined);
  // Ratio clamps into [0.3, 0.7].
  assert.equal(x.parseState('by-rocket|upcoming@5').ratio, 0.3);
  assert.equal(x.parseState('by-rocket|upcoming@95').ratio, 0.7);
});

test('LAUNCH_SCOPES lists the past table years newest-first', () => {
  const x = loadApp(makeData());
  assert.deepEqual(norm(x.LAUNCH_SCOPES.past), ['2025', '2024']);
});

test('maximizing a pane disables both axis syncs', () => {
  // Four launch years so the two trend panes get genuinely different
  // trimmed domains: LateComer flew 2025-2026, SubOrb only 2024.
  const data = makeData({previous: [
    ...makeData().previous,
    launch({name: 'LC-1', net: '2025-11-01T00:00:00Z', rocket_id: 8}),
    launch({name: 'LC-2', net: '2026-01-15T00:00:00Z', rocket_id: 8}),
    launch({name: 'OO-2', net: '2023-02-02T00:00:00Z', rocket_id: 3}),
  ]});
  data.rockets[8] = {name: 'LateComer', manufacturer_id: 10,
                     family: 'Late', leo_capacity: 5, launches: 2,
                     successful: 2};
  const x = loadApp(data);
  x.applyState({ratio: 0.5, focus: 'split', views: [
    {v: 'by-rocket-trend', f: {entities: new Set(['LateComer'])}},
    {v: 'by-manufacturer-trend', f: {entities: new Set(['SubOrb'])}},
  ]});
  const y0 = x.panes[0].inst.chart.options.scales.y;
  // Split: both trends share the union of their trimmed domains and a
  // shared y bound.
  assert.deepEqual(norm(x.panes[0].inst.chart.data.labels),
                   ['2023', '2024', '2025', '2026']);
  assert.deepEqual(norm(x.panes[1].inst.chart.data.labels),
                   ['2023', '2024', '2025', '2026']);
  assert.ok(y0.suggestedMax > 0);
  // Maximized: each trend falls back to its own domain and a free y.
  x.setFocus(0);
  assert.deepEqual(norm(x.panes[0].inst.chart.data.labels),
                   ['2024', '2025', '2026']);
  assert.deepEqual(norm(x.panes[1].inst.chart.data.labels),
                   ['2023', '2024', '2025']);
  assert.equal(y0.suggestedMax, undefined);
  // Back to split: both syncs re-apply.
  x.setFocus('split');
  assert.deepEqual(norm(x.panes[0].inst.chart.data.labels),
                   ['2023', '2024', '2025', '2026']);
  assert.ok(y0.suggestedMax > 0);
});
