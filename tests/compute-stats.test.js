// Unit tests for stats.js's computeStats — the single pass over
// DATA.previous that derives every chart grouping's per-year tallies.
// Loaded in a vm sandbox since stats.js is a classic script that reads
// the DATA global. Run from the repo root with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {makeData, launch} = require('./fixtures');

const SRC = path.join(__dirname, '..', 'static', 'stats.js');

function loadStats(data) {
  const sandbox = {DATA: data};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8') +
    '\nthis.__x = {STATS, topCat, byName, countryName};', sandbox);
  return sandbox.__x;
}

// Values from the sandbox carry sandbox-realm prototypes — normalize.
const norm = v => JSON.parse(JSON.stringify(v));

const {STATS, topCat, countryName} = loadStats(makeData());

test('a failure status counts in the failed category', () => {
  assert.equal(STATS.yearly['2025'].rockets['Falcon 9'].failed, 1);
});

test("orbit 'Sub' counts as suborbital, everything else orbital", () => {
  const y24 = STATS.yearly['2024'].rockets;
  assert.equal(y24['Sounder'].suborbital, 1);
  assert.equal(y24['OldOrb'].orbital, 1);
  assert.equal(y24['Falcon 9'].orbital, 1);
});

test('manufacturer charts label by abbrev, tooltip keeps full name', () => {
  const mfrs = STATS.yearly['2024'].manufacturers;
  assert.equal(mfrs['SpaceX'].orbital, 2);       // Falcon 9 + OldOrb
  assert.equal(mfrs['SubOrb'].suborbital, 1);
  assert.equal(STATS.manufacturerNames['SpaceX'], 'Space Exploration');
});

test('a rocket with no resolvable manufacturer is uncharted there', () => {
  const mfrs = STATS.yearly['2024'].manufacturers;
  assert.equal(mfrs['NoMfr'], undefined);
  assert.equal(STATS.rocketManufacturers['NoMfr'], undefined);
});

test('countries group by the manufacturer country', () => {
  const c = STATS.yearly['2024'].countries;
  assert.equal(c['USA'].orbital, 2);             // SpaceX rockets
  assert.equal(c['FRA'].suborbital, 1);          // SubOrb rocket
});

test('sites group by the part of the location name before the comma', () => {
  const sites = STATS.yearly['2024'].sites;
  const site = sites['Cape Canaveral SFS'];
  assert.ok(site);
  assert.equal(site['Falcon 9'].orbital, 1);
  assert.equal(site['Sounder'].suborbital, 1);
  assert.equal(STATS.siteNames['Cape Canaveral SFS'],
               'Cape Canaveral SFS, FL, USA');
});

test('families nest per-rocket rows; configs with no family use their name', () => {
  const fams = STATS.yearly['2024'].families;
  assert.equal(fams['Falcon']['Falcon 9'].orbital, 1);
  assert.equal(fams['Heritage']['OldOrb'].orbital, 1);
  assert.equal(fams['Sounder']['Sounder'].suborbital, 1);
});

test('orbitCapable: positive LEO capacity or an orbital launch record', () => {
  assert.ok(STATS.orbitCapable.has('Falcon 9'));   // leo_capacity > 0
  assert.ok(STATS.orbitCapable.has('OldOrb'));     // orbital record, leo 0
  assert.ok(STATS.orbitCapable.has('NeverFlew'));  // leo > 0, no launches
  assert.ok(!STATS.orbitCapable.has('Sounder'));   // suborbital only, leo 0
});

test('rocketCountries covers charted rockets only', () => {
  assert.equal(STATS.rocketCountries['Falcon 9'], 'USA');
  assert.equal(STATS.rocketCountries['Sounder'], 'FRA');
  assert.equal(STATS.rocketCountries['NeverFlew'], undefined);
});

test('meta.truncated drops the oldest year from yearly buckets', () => {
  const data = makeData({meta: {truncated: true}, previous: [
    ...makeData().previous,
    launch({name: 'OT-1', net: '2023-01-01T00:00:00Z', rocket_id: 7}),
  ]});
  data.rockets[7] = {name: 'OldTimer', manufacturer_id: 10,
                     leo_capacity: 100, launches: 1, successful: 1};
  const {STATS: s} = loadStats(data);
  assert.equal(s.yearly['2023'], undefined);
  // The dropped year's rocket is neither charted nor country-filterable…
  assert.equal(s.rocketCountries['OldTimer'], undefined);
  // …but capability checks still count its record.
  assert.ok(s.orbitCapable.has('OldTimer'));
  // With truncation off the same year stays.
  const {STATS: s2} = loadStats(makeData({previous: data.previous}));
  assert.ok(s2.yearly['2023']);
});

test('topCat orders by descending total, ties by name code point', () => {
  const out = topCat({b: {orbital: 1}, a: {orbital: 3}, c: {orbital: 1}});
  assert.deepEqual(norm(Object.keys(out)), ['a', 'b', 'c']);
});

test('countryName expands codes, comma lists, and the ??? placeholder', () => {
  assert.equal(countryName('USA'), 'United States');
  assert.equal(countryName('AUS,SGP'), 'Australia, Singapore');
  assert.equal(countryName('???'), 'Unknown');
});

test('an empty launch list yields empty yearly buckets', () => {
  const {STATS: s} = loadStats(makeData({previous: []}));
  assert.deepEqual(norm(s.yearly), {});
});
