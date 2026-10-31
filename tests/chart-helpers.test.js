// Unit tests for chart-defs.js's data-slicing helpers and
// chart-factories.js's paging/segment logic — the pieces that turn
// STATS into chart datasets. Loaded in a vm sandbox in real load order
// (factories -> stats -> defs) with Chart/document stubs.
// Run from the repo root with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {makeData} = require('./fixtures');

const DIR = path.join(__dirname, '..', 'static');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

function makeEl() {
  return {className: '', textContent: '', hidden: false,
          children: [], appendChild(el) { this.children.push(el); }};
}

function loadSrcs(files, data) {
  function Chart(canvas, config) {
    this.canvas = canvas;
    this.data = config.data;
    this.options = config.options;
  }
  Chart.defaults = {};
  Chart.prototype.update = function () {};
  const sandbox = {
    Chart, DATA: data, esc: s => s,
    document: {createElement: () => makeEl()},
  };
  vm.createContext(sandbox);
  const src = files.map(read).join('\n');
  vm.runInContext(src + `
this.__x = {
  CHART_DEFS, GROUPS, applyCountryFilter, applyOrbitFilter, donutSlices,
  siteNested, siteRows, familyRows, rocketsByMfr, windowedNames,
  yearRows, rocketEntities, trendData, rowTotal, stackedBarChart,
};`, sandbox);
  return sandbox.__x;
}

const norm = v => JSON.parse(JSON.stringify(v));
const x = loadSrcs(['chart-factories.js', 'stats.js', 'chart-defs.js'],
                   makeData());

// A filter-state object matching freshFilters()'s shape.
const fs_ = (year, extra = {}) => ({
  year, country: {codes: new Set(), negate: false}, successOnly: false,
  cumulative: false, variantStack: false, orbitCapable: false,
  pageSize: 10, entities: new Set(), rockets: new Set(), ...extra});

test('rowTotal: plain count, cat dict, and nullish', () => {
  assert.equal(x.rowTotal(5), 5);
  assert.equal(x.rowTotal({a: 1, b: 2}), 3);
  assert.equal(x.rowTotal(null), null);
  assert.equal(x.rowTotal(undefined), undefined);
});

test('bar data maps a year scope to its rocket rows', () => {
  const rows = x.CHART_DEFS['by-rocket'].data(fs_('2025'));
  assert.deepEqual(norm(rows), {
    'Falcon 9': {orbital: 1, suborbital: 0, failed: 1}});
  assert.deepEqual(norm(x.CHART_DEFS['by-rocket'].data(fs_('1999'))), {});
});

test('country filter includes, excludes, and passes through when empty', () => {
  const y24 = fs_('2024');
  const inc = x.CHART_DEFS['by-rocket'].data(
    fs_('2024', {country: {codes: new Set(['FRA']), negate: false}}));
  assert.deepEqual(norm(Object.keys(inc)), ['Sounder']);
  const exc = x.CHART_DEFS['by-rocket'].data(
    fs_('2024', {country: {codes: new Set(['FRA']), negate: true}}));
  assert.deepEqual(norm(Object.keys(exc)),
                   ['Falcon 9', 'NoMfr', 'OldOrb']);
  assert.deepEqual(norm(Object.keys(
    x.CHART_DEFS['by-rocket'].data(y24))),
    ['Falcon 9', 'NoMfr', 'OldOrb', 'Sounder']);
});

test('orbit-capable filter drops suborbital-only rockets', () => {
  const rows = x.CHART_DEFS['by-rocket'].data(
    fs_('2024', {orbitCapable: true}));
  assert.deepEqual(norm(Object.keys(rows)),
                   ['Falcon 9', 'NoMfr', 'OldOrb']);
});

test('donut success-only drops the failed segment', () => {
  const def = x.CHART_DEFS['by-rocket-donut'];
  assert.equal(def.data(fs_('2025'))['Falcon 9'], 2);
  assert.equal(def.data(fs_('2025', {successOnly: true}))['Falcon 9'], 1);
});

test('trend data: per-year counts, cumulative, success-only', () => {
  const def = x.CHART_DEFS['by-rocket-trend'];
  const pick = fs_('2025', {entities: new Set(['Falcon 9'])});
  assert.deepEqual(norm(def.data(pick)),
    {'Falcon 9': {'2024': 1, '2025': 2}});
  assert.deepEqual(
    norm(def.data({...pick, cumulative: true})),
    {'Falcon 9': {'2024': 1, '2025': 3}});
  assert.deepEqual(
    norm(def.data({...pick, successOnly: true})),
    {'Falcon 9': {'2024': 1, '2025': 1}});
});

test('trend data covers every year even for a late-starting entity', () => {
  const def = x.CHART_DEFS['by-rocket-trend'];
  const rows = def.data(fs_('2024', {entities: new Set(['Sounder'])}));
  assert.deepEqual(norm(rows['Sounder']), {'2024': 1, '2025': 0});
});

test('an empty entity pick yields an empty trend dataset', () => {
  const def = x.CHART_DEFS['by-rocket-trend'];
  assert.deepEqual(norm(def.data(fs_('2025'))), {});
});

test('site chart re-aggregates rows by selected rockets', () => {
  const def = x.CHART_DEFS['by-site'];
  const all = def.data(fs_('2024'));
  assert.deepEqual(norm(all['Cape Canaveral SFS']),
                   {orbital: 3, suborbital: 1, failed: 0});
  const filtered = def.data(fs_('2024', {rockets: new Set(['Falcon 9'])}));
  assert.deepEqual(norm(filtered['Cape Canaveral SFS']),
                   {orbital: 1, suborbital: 0, failed: 0});
  // A rocket with no 2024 launches leaves the site empty -> dropped.
  const empty = def.data(fs_('2024', {rockets: new Set(['NeverFlew'])}));
  assert.deepEqual(norm(empty), {});
});

test('family chart stacks categories or per-variant segments', () => {
  const def = x.CHART_DEFS['by-rocket-family'];
  const cats = def.data(fs_('2025'));
  assert.deepEqual(norm(cats['Falcon']),
                   {orbital: 1, suborbital: 0, failed: 1});
  const variants = def.data(fs_('2025', {variantStack: true}));
  assert.deepEqual(norm(variants['Falcon']), {'Falcon 9': 2});
});

test('manufacturer bars regroup flat rocket rows via the rocket map', () => {
  const def = x.CHART_DEFS['by-manufacturer'];
  const cats = def.data(fs_('2024'));
  // NoMfr has no resolvable manufacturer -> dropped from this grouping.
  assert.deepEqual(norm(cats['SpaceX']), {orbital: 2, suborbital: 0, failed: 0});
  assert.deepEqual(norm(cats['SubOrb']), {orbital: 0, suborbital: 1, failed: 0});
  const variants = def.data(fs_('2024', {variantStack: true}));
  assert.deepEqual(norm(variants['SpaceX']), {'Falcon 9': 1, 'OldOrb': 1});
});

test('windowedNames unions the yearly bucket keys', () => {
  const names = x.windowedNames('countries').sort();
  assert.deepEqual(norm(names), ['FRA', 'USA']);
});

test('rocketEntities pairs are alphabetized by label', () => {
  const pairs = x.rocketEntities();
  const labels = norm(pairs.map(([, l]) => l));
  assert.deepEqual([...labels].sort((a, b) => a.localeCompare(b)), labels);
});

// --- pagedView via stackedBarChart -------------------------------------

test('stacked bar paging slices rows and clamps the page', () => {
  const c = x.stackedBarChart({}, null);
  const data = Object.fromEntries(
    Array.from({length: 25}, (_, i) => [`r${i}`, {orbital: i + 1}]));
  c.setData(data);
  assert.equal(c.pageCount(), 3);
  c.setPage(1);
  assert.deepEqual(norm(c.chart.data.labels).length, 10);
  assert.equal(norm(c.chart.data.labels)[0], 'r10');
  c.setPage(99);                                   // clamps to last
  assert.deepEqual(norm(c.chart.data.labels), ['r20', 'r21', 'r22', 'r23', 'r24']);
  c.setPage(-5);                                   // clamps to first
  assert.deepEqual(norm(c.chart.data.labels)[0], 'r0');
  c.setPageSize(30);
  assert.equal(c.pageCount(), 1);
});

test('stacked bar datasets follow SEGMENT_ORDER, missing segments -> 0', () => {
  const c = x.stackedBarChart({}, null);
  c.setData({
    a: {failed: 1, orbital: 2},
    b: {orbital: 5, suborbital: 1},
  });
  const labels = norm(c.chart.data.datasets.map(d => d.label));
  assert.deepEqual(labels, ['Orbital', 'Suborbital', 'Failed']);
  assert.deepEqual(norm(c.chart.data.datasets[0].data), [2, 5]);
  assert.deepEqual(norm(c.chart.data.datasets[1].data), [0, 1]);
  assert.deepEqual(norm(c.chart.data.datasets[2].data), [1, 0]);
});

test('non-segment keys switch to dynamic variant stacking', () => {
  const c = x.stackedBarChart({}, null);
  c.setData({
    famA: {vSmall: 2, vBig: 5},
    famB: {vSmall: 1, vBig: 3},
  });
  // Variants order by descending total: vBig (8) before vSmall (3).
  const labels = norm(c.chart.data.datasets.map(d => d.label));
  assert.deepEqual(labels, ['vBig', 'vSmall']);
  assert.equal(c.chart.options.plugins.legend.display, false);
});
