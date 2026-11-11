// Unit tests for tables.js's table specs — the per-pane notes, row
// scoping, rocket sorting, and CSV export. stats.js loads first for
// byName; the DATA global is the shared fixture.
// Run from the repo root with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {makeData, launch} = require('./fixtures');

const DIR = path.join(__dirname, '..', 'static');
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

function loadTables(data) {
  const sandbox = {
    DATA: data,
    // chart-defs.js's all-time scope value and app.js's shared date
    // formatters — neither file is loaded here (they need the chart
    // factories), so the test supplies them.
    ALL_TIME: 'all',
    DATE_FMT: new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}),
    TIME_FMT: new Intl.DateTimeFormat(undefined, {timeStyle: 'short'}),
    esc: s => String(s),
    fmtLocal: s => s ? new Date(s)
      .toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})
      : null,
    num: (v, u) => v != null ? Number(v).toLocaleString() + (u ? ' ' + u : '') : null,
    yesNo: v => v == null ? null : (v ? 'Yes' : 'No'),
    document: {createElement: () => ({})},
    saveState() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(['stats.js', 'tables.js'].map(read).join('\n') +
    '\nthis.__x = {TABLE_SPECS, tableCsv, rocketRows, scopedLaunches};',
    sandbox);
  return sandbox.__x;
}

const pane = (defId, filters = {}) => ({defId, filters});

test('rockets note cites the dataset\'s first launch date', () => {
  const x = loadTables(makeData());
  const note = x.TABLE_SPECS.rockets.note(pane('rockets'), 5);
  // The fixture's oldest launch is 2024-09-09.
  const want = new Date('2024-09-09T00:00:00Z')
    .toLocaleDateString(undefined, {dateStyle: 'medium'});
  assert.equal(note, `Showing 5 rockets observed in launches since ${want}`);
});

test('rockets note falls back cleanly with no launches', () => {
  const x = loadTables(makeData({previous: []}));
  assert.equal(x.TABLE_SPECS.rockets.note(pane('rockets'), 0),
               'Showing 0 rockets observed in launches');
});

test('past note flags the truncated oldest year', () => {
  const data = makeData({meta: {truncated: true}, previous: [
    ...makeData().previous,
    launch({name: 'Old', net: '2023-01-01T00:00:00Z', rocket_id: 7}),
  ]});
  const x = loadTables(data);
  const y23 = x.TABLE_SPECS.past.note(pane('past', {year: '2023'}), 4);
  assert.match(y23, /partial/);
  const y24 = x.TABLE_SPECS.past.note(pane('past', {year: '2024'}), 4);
  assert.equal(y24, 'Showing 4 launches in 2024');
  // All time covers the partial year too, so it keeps the caveat.
  const all = x.TABLE_SPECS.past.note(pane('past', {year: 'all'}), 7);
  assert.equal(all, "Showing all 7 launches (oldest year partial —" +
                    " older launches weren't fetched)");
});

test('past all-time note has no caveat without truncation', () => {
  const x = loadTables(makeData());
  assert.equal(x.TABLE_SPECS.past.note(pane('past', {year: 'all'}), 6),
               'Showing all 6 launches');
});

test('scopedLaunches keeps only the picked year', () => {
  const x = loadTables(makeData());
  const rows = x.scopedLaunches(makeData().previous, 'past', '2024');
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.rec.net.startsWith('2024')));
  // The all-time scope keeps every launch in the window.
  assert.equal(
    x.scopedLaunches(makeData().previous, 'past', 'all').length, 6);
});

test('rocketRows default order: launches, LEO capacity, then name', () => {
  const x = loadTables(makeData());
  const names = x.rocketRows(pane('rockets')).map(r => r.rec.name);
  // Falcon 9 (3 launches) first, then the 1-launch rockets by capacity.
  assert.equal(names[0], 'Falcon 9');
  assert.equal(names[names.length - 1], 'NeverFlew');  // 0 launches
});

test('rocketRows honors an ascending stored sort', () => {
  const x = loadTables(makeData());
  const rows = x.rocketRows(
    pane('rockets', {sort: 'leo_capacity', dir: 'asc'}));
  // Ascending puts the smallest capacity first — OldOrb and Sounder
  // tie at leo 0, keeping OldOrb's earlier default order — and the
  // largest capacity last.
  assert.equal(rows[0].rec.name, 'OldOrb');
  assert.equal(rows.at(-1).rec.name, 'Falcon 9');
});

test('rocketRows activeOnly keeps only rockets flagged active', () => {
  const x = loadTables(makeData());
  const p = pane('rockets', {activeOnly: true});
  // Falcon 9 is the fixture's only active rocket — OldOrb is retired
  // and the rest carry no status flag at all.
  const names = x.rocketRows(p).map(r => r.rec.name);
  assert.equal(names.length, 1);
  assert.equal(names[0], 'Falcon 9');
  assert.match(x.TABLE_SPECS.rockets.note(p, 1), /1 active rockets/);
});

test('tableCsv quotes every cell and doubles inner quotes', () => {
  const x = loadTables(makeData());
  const csv = x.tableCsv(pane('upcoming'));
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);                  // header + 1 launch
  assert.ok(lines[0].startsWith('"Date","Mission"'));
});

test('tableCsv follows the pane sort for the rockets table', () => {
  const x = loadTables(makeData());
  const csv = x.tableCsv(
    pane('rockets', {sort: 'leo_capacity', dir: 'asc'}));
  const lines = csv.split('\r\n');
  assert.ok(lines[1].startsWith('"OldOrb"'));
});

test('optional columns stay out of the table until enabled', () => {
  const x = loadTables(makeData());
  assert.doesNotMatch(
    x.tableCsv(pane('upcoming', {cols: new Set()})), /Orbit|Program/);
  const head = x.tableCsv(pane('upcoming', {cols: new Set(['orbit'])}))
    .split('\r\n')[0];
  assert.match(head, /"Orbit"/);
  assert.doesNotMatch(head, /"Program"/);
});

test('hideable columns render by default and drop when toggled', () => {
  const x = loadTables(makeData());
  const plain = x.tableCsv(pane('upcoming', {cols: new Set()}))
    .split('\r\n')[0];
  assert.match(plain, /"Provider"/);
  assert.match(plain, /"Pad"/);
  const head = x.tableCsv(pane('upcoming', {cols: new Set(['provider'])}))
    .split('\r\n')[0];
  assert.doesNotMatch(head, /"Provider"/);
  assert.match(head, /"Pad"/);
});

test('rocketRows sorts by optional numeric and date keys', () => {
  const x = loadTables(makeData());
  const byThrust = x.rocketRows(pane('rockets', {sort: 'thrust', dir: 'desc'}));
  assert.equal(byThrust[0].rec.name, 'Falcon 9');   // 7607 kN beats 100
  const byMaiden = x.rocketRows(pane('rockets', {sort: 'maiden_flight', dir: 'asc'}));
  assert.equal(byMaiden[0].rec.name, 'OldOrb');      // 1961 before 2010
  // Records missing the key sort last in either direction.
  assert.equal(byMaiden.at(-1).rec.maiden_flight, undefined);
});

test('renderTable includes data-country on table rows', () => {
  const data = makeData();
  data.agencies[12] = {name: 'MultiAgency', country: 'FRA,RUS'};
  data.previous.push(launch({name: 'Multi', provider_id: 12}));
  const elements = [];
  const sandbox = {
    DATA: data,
    ALL_TIME: 'all',
    DATE_FMT: new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}),
    TIME_FMT: new Intl.DateTimeFormat(undefined, {timeStyle: 'short'}),
    esc: s => String(s),
    fmtLocal: s => s,
    num: (v, u) => v,
    yesNo: v => v,
    document: {
      createElement: tag => {
        const el = {tag, querySelectorAll: () => []};
        elements.push(el);
        return el;
      },
    },
    saveState() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(['stats.js', 'tables.js'].map(read).join('\n') +
    '\nthis.__x = {renderTable};', sandbox);
  const wrap = sandbox.__x.renderTable(pane('past', {year: 'all'}));
  assert.match(wrap.innerHTML, /data-country="USA"/);
  assert.match(wrap.innerHTML, /data-country="FRA,RUS"/);
});
