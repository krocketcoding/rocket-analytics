// Sanity checks for static/stats.js, run against the built site: the
// per-year tallies the charts read must keep their category shape,
// agree across groupings, and only reference chartable rows — a
// regression there would silently ship wrong chart data. Requires a
// prior `python main.py` run so site/index.html exists; skipped
// otherwise. Run from the repo root with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'site', 'index.html');

// Extract the id="data" JSON block and evaluate stats.js against it in
// a bare vm context (no DOM — stats.js only needs DATA).
function loadStats() {
  if (!fs.existsSync(HTML)) return null;
  const m = fs.readFileSync(HTML, 'utf8')
    .match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'id="data" block not found in site/index.html');
  const DATA = JSON.parse(m[1]);
  const src = fs.readFileSync(path.join(ROOT, 'static', 'stats.js'), 'utf8');
  const STATS = vm.runInContext(`${src}\n;STATS`, vm.createContext({DATA}));
  return {DATA, STATS};
}

const loaded = loadStats();
const needSite = t => { if (!loaded) t.skip('requires site/index.html — run python main.py first'); };

const rowTotal = row => Object.values(row).reduce((a, b) => a + b, 0);
// Leaf tally of a grouping's rows: nested groupings (sites, families)
// hold {label: {rocket: cats}}, the rest {label: cats}.
const leafTotal = (rows, nested) => Object.values(rows).reduce((sum, row) =>
  sum + (nested
    ? Object.values(row).reduce((s, cats) => s + rowTotal(cats), 0)
    : rowTotal(row)), 0);

const CATS = ['orbital', 'suborbital', 'failed'];
const NESTED = new Set(['sites', 'families']);

test('yearly rows are orbital/suborbital/failed', t => {
  needSite(t);
  const {STATS} = loaded;
  for (const bucket of Object.values(STATS.yearly))
    for (const [group, rows] of Object.entries(bucket))
      for (const row of Object.values(rows))
        for (const cats of NESTED.has(group) ? Object.values(row) : [row])
          assert.ok(Object.keys(cats).every(k => CATS.includes(k)),
            `unexpected category in ${group}: ${Object.keys(cats)}`);
});

test('groupings tally the same launches', t => {
  needSite(t);
  // Every fetched launch lands in exactly one category of each
  // grouping, so a year's totals must agree across groupings.
  const {STATS} = loaded;
  for (const [year, bucket] of Object.entries(STATS.yearly)) {
    const totals = Object.entries(bucket)
      .map(([g, rows]) => leafTotal(rows, NESTED.has(g)));
    assert.equal(new Set(totals).size, 1,
      `${year} grouping totals differ: ${totals}`);
  }
});

test('site rockets are chart rows', t => {
  needSite(t);
  // Every rocket keyed under a site exists in the lifetime rocket
  // rows — a rocket filter pick can never hit a phantom name.
  const {STATS} = loaded;
  const charted = new Set(Object.values(STATS.yearly)
    .flatMap(b => Object.keys(b.rockets)));
  for (const bucket of Object.values(STATS.yearly))
    for (const perRocket of Object.values(bucket.sites))
      for (const name of Object.keys(perRocket))
        assert.ok(charted.has(name), `${name} under a site but never charted`);
});

test('family variants are chart rows', t => {
  needSite(t);
  // The family tally gates on the same rocket name as the sites
  // grouping, so every variant segment is a charted rocket.
  const {STATS} = loaded;
  const charted = new Set(Object.values(STATS.yearly)
    .flatMap(b => Object.keys(b.rockets)));
  for (const bucket of Object.values(STATS.yearly))
    for (const perRocket of Object.values(bucket.families))
      for (const name of Object.keys(perRocket))
        assert.ok(charted.has(name), `${name} under a family but never charted`);
});

test('manufacturer map covers chart rows', t => {
  needSite(t);
  // The manufacturer bars regroup the flat rockets bucket through
  // rocketManufacturers — a missing entry would silently drop that
  // rocket's launches from the chart.
  const {STATS} = loaded;
  const charted = new Set(Object.values(STATS.yearly)
    .flatMap(b => Object.keys(b.rockets)));
  for (const name of charted)
    assert.ok(STATS.rocketManufacturers[name],
      `${name} missing from rocketManufacturers`);
});

test('country filter keys can chart', t => {
  needSite(t);
  // Guards the '???' regression: every filterable rocket or
  // manufacturer must exist in its chart's rows — a dead entry
  // could only ever produce an empty chart.
  const {STATS} = loaded;
  const charted = new Set(Object.values(STATS.yearly)
    .flatMap(b => Object.keys(b.rockets)));
  const chartedMfrs = new Set(Object.values(STATS.yearly)
    .flatMap(b => Object.keys(b.manufacturers)));
  for (const name of Object.keys(STATS.rocketCountries))
    assert.ok(charted.has(name), `rocketCountries has uncharted ${name}`);
  for (const name of Object.keys(STATS.manufacturerCountries))
    assert.ok(chartedMfrs.has(name), `manufacturerCountries has uncharted ${name}`);
});

test('oldest year dropped at page cap', t => {
  needSite(t);
  // Newest-first fetches can truncate the oldest year mid-way, so it's
  // kept only when the API ran out before the page cap — meta.truncated
  // records which case this dataset is.
  const {DATA, STATS} = loaded;
  let years = [...new Set(DATA.previous
    .filter(l => l.net).map(l => l.net.slice(0, 4)))].sort().reverse();
  if (DATA.meta.truncated) years = years.slice(0, -1);
  assert.deepEqual(Object.keys(STATS.yearly).sort().reverse(), years);
});

test('site maps cover chart labels', t => {
  needSite(t);
  // Every launch site a chart can label resolves to a full name.
  const {STATS} = loaded;
  const sites = new Set(Object.values(STATS.yearly)
    .flatMap(b => Object.keys(b.sites)));
  for (const site of sites)
    assert.ok(site in STATS.siteNames, `${site} missing from siteNames`);
});
