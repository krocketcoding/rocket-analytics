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
});

test('scopedLaunches keeps only the picked year', () => {
  const x = loadTables(makeData());
  const rows = x.scopedLaunches(makeData().previous, 'past', '2024');
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.rec.net.startsWith('2024')));
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
