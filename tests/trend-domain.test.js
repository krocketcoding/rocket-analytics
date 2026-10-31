// Unit tests for the trend chart's x-axis logic: trendDomain() trims the
// leading/trailing all-zero years (keeping one zero pad each side, no
// trim at all when everything is zero), and lineChart's ownLabels /
// setXLabels contract feeds the side-by-side superset sync in syncAxes().
// chart-factories.js is a classic script — it is loaded in a vm sandbox
// with a Chart stub so top-level bindings stay isolated per test.
// Run from the repo root with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'static', 'chart-factories.js');

// Minimal element stub — lineChart appends a .chart-hint div to the
// canvas's parent and toggles its hidden flag.
function makeEl() {
  return {className: '', textContent: '', hidden: false,
          children: [], appendChild(el) { this.children.push(el); }};
}

// Load chart-factories.js in a fresh sandbox with stubs for its globals
// (Chart, document, esc). Returns {lineChart, trendDomain}.
function loadFactory() {
  function Chart(canvas, config) {
    this.canvas = canvas;
    this.data = config.data;
    this.options = config.options;
  }
  Chart.defaults = {};
  Chart.prototype.update = function () {};
  const sandbox = {
    Chart,
    esc: s => s,
    document: {createElement: () => makeEl()},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8') +
    '\nthis.__x = {lineChart, trendDomain};', sandbox);
  return sandbox.__x;
}

const {lineChart, trendDomain} = loadFactory();
const E = Object.entries;   // shorthand for building entries lists

// Values returned by the vm sandbox carry sandbox-realm prototypes that
// assert/strict's deepEqual rejects — normalize via JSON round-trip.
const norm = v => JSON.parse(JSON.stringify(v));

test('trims leading zero years and keeps one zero pad', () => {
  assert.deepEqual(
    norm(trendDomain(E({A: {'1957': 0, '1958': 0, '2010': 2, '2020': 1}}))),
    ['1958', '2010', '2020']);
});

test('trims trailing zero years and keeps one zero pad', () => {
  assert.deepEqual(
    norm(trendDomain(E({A: {'2010': 2, '2020': 1, '2025': 0, '2026': 0}}))),
    ['2010', '2020', '2025']);
});

test('keeps zero years inside the data range', () => {
  assert.deepEqual(
    norm(trendDomain(E({A: {'2000': 1, '2001': 0, '2002': 0, '2003': 1}}))),
    ['2000', '2001', '2002', '2003']);
});

test('does not trim at all when every year is zero', () => {
  const years = {'2000': 0, '2001': 0, '2002': 0};
  assert.deepEqual(norm(trendDomain(E({A: years}))), Object.keys(years));
});

test('empty dataset yields an empty domain', () => {
  assert.deepEqual(norm(trendDomain([])), []);
});

test('a single nonzero year keeps one pad on each side', () => {
  assert.deepEqual(
    norm(trendDomain(E({A: {'1957': 0, '2010': 4, '2026': 0}}))),
    ['1957', '2010', '2026']);
});

test('trim is computed across all series combined', () => {
  // 2008 is zero for A but nonzero for B — the year must survive.
  const entries = E({
    A: {'2008': 0, '2010': 1},
    B: {'2008': 2, '2010': 0},
  });
  assert.deepEqual(norm(trendDomain(entries)), ['2008', '2010']);
});

test('lineChart aligns each series to the trimmed domain', () => {
  const parent = makeEl();
  const c = lineChart({parentElement: parent}, null);
  c.setData({
    New:  {'2010': 2, '2020': 5},
    Old:  {'1957': 1, '2000': 4, '2020': 3},
  });
  assert.deepEqual(norm(c.chart.data.labels), ['1957', '2000', '2010', '2020']);
  assert.deepEqual(norm(c.chart.data.datasets[0].data), [0, 0, 2, 5]);
  assert.deepEqual(norm(c.chart.data.datasets[1].data), [1, 4, 0, 3]);
  assert.equal(parent.children[0].hidden, true);   // hint hidden
});

test('empty dataset shows the hint overlay and no datasets', () => {
  const parent = makeEl();
  const c = lineChart({parentElement: parent}, null);
  c.setData({});
  assert.deepEqual(norm(c.chart.data.labels), []);
  assert.equal(c.chart.data.datasets.length, 0);
  assert.equal(parent.children[0].hidden, false);  // hint visible
});

test('setXLabels applies an override and ownLabels stays the own domain', () => {
  const c = lineChart({parentElement: makeEl()}, null);
  c.setData({A: {'2010': 2, '2020': 5}});
  assert.deepEqual(norm(c.ownLabels), ['2010', '2020']);
  // Shared domain wider than own: missing years get zero points.
  c.setXLabels(['1990', '2010', '2020']);
  assert.deepEqual(norm(c.chart.data.labels), ['1990', '2010', '2020']);
  assert.deepEqual(norm(c.chart.data.datasets[0].data), [0, 2, 5]);
  assert.deepEqual(norm(c.ownLabels), ['2010', '2020']);  // unchanged
  // Undefined restores the own domain.
  c.setXLabels(undefined);
  assert.deepEqual(norm(c.chart.data.labels), ['2010', '2020']);
});
