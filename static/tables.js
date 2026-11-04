// Table views: one column spec per table, shared by the rendered pane
// table and its CSV export so the two can't drift, plus the per-pane
// rocket sort wiring. A classic script sharing DATA/esc/fmtLocal/num
// from app.js; load order is JS_FILES in pipeline/config.py.
//
// A column spec is {head, headHtml?, sort?, net?, opt?, text(rec),
// html?(rec)}: `text` is the cell's plain value — it feeds the CSV
// directly and is HTML-escaped for the <td>; `html` overrides the cell
// markup when the value needs markup (the two-line date, the status
// badge); `sort` names the record key a header click can order by
// (rockets only); `headHtml` overrides the header text when it needs
// markup; `net` marks the date column so it keeps the data-net
// attribute the stylesheet's nowrap rule hooks. `opt`/`hide` mark
// toggleable columns: `opt` starts hidden, `hide` starts shown — and
// filters.cols holds the keys flipped away from that default.

const launchCols = withStatus => [
  {head: 'Date', net: true,
   text: d => fmtLocal(d.net) || '',
   // Local date over local time on two lines; falls back to the raw
   // net string when it can't be parsed.
   html: d => {
     const t = new Date(d.net);
     return isNaN(t) ? esc(d.net || '')
       : esc(t.toLocaleDateString(undefined, {dateStyle: 'medium'})) + '<br>'
       + esc(t.toLocaleTimeString(undefined, {timeStyle: 'short'}));
   }},
  {head: 'Mission', text: d => d.name || ''},
  {hide: 'provider', head: 'Provider',
   text: d => DATA.agencies[d.provider_id]?.name ?? '—'},
  {hide: 'pad', head: 'Pad',
   text: d => DATA.pads[d.pad_id]?.name ?? '—'},
  ...(withStatus ? [{
    head: 'Status',
    text: d => DATA.statuses[d.status_id]?.name || 'Unknown',
    html: d => {
      const s = DATA.statuses[d.status_id];
      const cls = (s?.abbrev || 'tbd').toLowerCase().replaceAll(' ', '-');
      return `<span class="status status-${esc(cls)}">${esc(s?.name || 'Unknown')}</span>`;
    },
  }] : []),
  {opt: 'orbit', head: 'Orbit', text: d => d.orbit || '—'},
  {opt: 'program', head: 'Program',
   text: d => (d.program_ids || [])
     .map(id => DATA.programs[id]?.name).filter(Boolean).join(' · ') || '—'},
];

const rocketCols = [
  {head: 'Name', text: r => r.name || '—'},
  // The manufacturer is a row in the merged agencies table.
  {hide: 'provider', head: 'Provider',
   text: r => DATA.agencies[r.manufacturer_id]?.name || '—'},
  {hide: 'leo', head: 'LEO capacity', sort: 'leo_capacity',
   text: r => r.leo_capacity != null ? num(r.leo_capacity, 'kg') : '—'},
  {hide: 'launches', head: 'Successful / attempted',
   headHtml: 'Successful /<br>attempted', sort: 'launches',
   text: r => r.launches != null ? `${r.successful || 0} / ${r.launches}` : '—'},
  {opt: 'status', head: 'Status',
   text: r => r.active == null ? '—' : (r.active ? 'Active' : 'Retired')},
  {opt: 'thrust', head: 'Thrust', sort: 'thrust',
   text: r => r.thrust != null ? num(r.thrust, 'kN') : '—'},
  {opt: 'maiden', head: 'Maiden flight', sort: 'maiden_flight',
   text: r => r.maiden_flight || '—'},
  {opt: 'streak', head: 'Success streak', headHtml: 'Success<br>streak',
   sort: 'streak', text: r => r.streak != null ? String(r.streak) : '—'},
];

// The columns a pane actually renders. filters.cols holds toggle keys
// flipped away from their default: an `opt` column shows when its key
// is present, a `hide` column when it's absent (a missing set means no
// flips, i.e. the default layout).
const visCols = (spec, pane) => spec.cols.filter(c => {
  if (c.opt) return pane.filters.cols?.has(c.opt);
  if (c.hide) return !pane.filters.cols?.has(c.hide);
  return true;
});

// Default rocket order: launch count, then LEO capacity, then name
// (byName from stats.js — code point, so it's locale-independent).
const defaultRocketRows = () =>
  Object.entries(DATA.rockets)
    .sort(([, a], [, b]) => (b.launches || 0) - (a.launches || 0)
      || (b.leo_capacity || 0) - (a.leo_capacity || 0)
      || byName(a.name || '', b.name || ''))
    .map(([id, rec]) => ({rec, set: 'rockets', key: id}));

// Re-sort from the default order so a stored sort replays
// deterministically; unknowns stay at the bottom in either direction.
function rocketRows(pane) {
  // The 'Active only' toggle keeps just rockets known to be active —
  // a null active flag (no status on record) can't confirm it is.
  const rows = defaultRocketRows()
    .filter(r => !pane.filters.activeOnly || r.rec.active === true);
  const key = pane.filters.sort;
  if (!key) return rows;
  const mul = (pane.filters.dir || 'desc') === 'desc' ? 1 : -1;
  return rows.sort((a, b) => {
    const va = a.rec[key], vb = b.rec[key];
    if (va == null) return vb == null ? 0 : 1;
    if (vb == null) return -1;
    // Numeric keys compare by value; string keys (maiden_flight's ISO
    // date) fall back to locale order.
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? vb - va : String(vb).localeCompare(String(va));
    return mul * cmp;
  });
}

// Rows for the past-launches table, scoped to the pane's year pick —
// the all-time scope (chart-defs.js's ALL_TIME) keeps the whole
// fetched window. Keys stay indices into the source list: the
// row-click modal looks launches up by original index, so filter
// after indexing.
const scopedLaunches = (list, set, year) =>
  list.map((d, i) => ({rec: d, set, key: i}))
      .filter(r => year === ALL_TIME || r.rec.net?.startsWith(year));

// The oldest year in the fetched window is partial when the page cap
// truncated the fetch (meta.truncated — the same year stats.js drops
// from the charts). The table keeps its real launches but flags the
// year in the note; the previous list is newest-first, so its last
// launch sits in the partial year.
const PARTIAL_YEAR = DATA.meta.truncated
  ? DATA.previous.at(-1)?.net?.slice(0, 4) : null;

// The dataset's first launch — the previous list is newest-first, so
// it sits at the tail. The rockets note cites its date so "observed"
// reads as a concrete window rather than an open-ended claim. Formatted
// once: date-only, since a note doesn't need the time.
const FIRST_LAUNCH_DATE = (() => {
  const net = DATA.previous.at(-1)?.net;
  return net
    ? new Date(net).toLocaleDateString(undefined, {dateStyle: 'medium'})
    : null;
})();

// Each spec produces {rec, set, key} rows: set/key become the
// data-set/data-idx (launches) or data-id (rockets) attributes the
// row-click modal lookup in app.js keys off.
const TABLE_SPECS = {
  upcoming: {
    cols: launchCols(false),
    rows: () => DATA.upcoming.map((d, i) => ({rec: d, set: 'upcoming', key: i})),
    note: (pane, n) => `Showing the next ${n} launches`,
  },
  past: {
    cols: launchCols(true),
    rows: pane => scopedLaunches(DATA.previous, 'past', pane.filters.year),
    note: (pane, n) => pane.filters.year === ALL_TIME
      ? `Showing all ${n} launches` +
        (PARTIAL_YEAR ? " (oldest year partial — older launches weren't fetched)" : '')
      : `Showing ${n} launches in ${pane.filters.year}` +
        (pane.filters.year === PARTIAL_YEAR
          ? " (partial — older launches weren't fetched)" : ''),
  },
  rockets: {
    cols: rocketCols,
    rows: rocketRows,
    note: (pane, n) => `Showing ${n} ${pane.filters.activeOnly ? 'active ' : ''}` +
      `rockets observed in launches` +
      (FIRST_LAUNCH_DATE ? ` since ${FIRST_LAUNCH_DATE}` : ''),
  },
};

// Build a table view's .table-wrap for a pane: thead from the column
// spec, one tr per row. The rockets sort indicators and header clicks
// read/write that pane's own filter state, so the same table can show
// different sorts in the two panes.
function renderTable(pane) {
  const spec = TABLE_SPECS[pane.defId];
  const sortKey = pane.filters.sort || 'launches';
  const sortDir = pane.filters.dir || 'desc';
  const rows = spec.rows(pane);
  const cols = visCols(spec, pane);
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `<table><thead><tr>${cols.map(c => {
      const sortable = c.sort ? ` class="sortable" data-sort="${c.sort}"` : '';
      const dir = c.sort && c.sort === sortKey ? ` data-dir="${sortDir}"` : '';
      return `<th${sortable}${dir}>${c.headHtml || esc(c.head)}</th>`;
    }).join('')}</tr></thead><tbody>${rows.map(r => {
      const attrs = r.set === 'rockets'
        ? `data-set="rockets" data-id="${esc(String(r.key))}" tabindex="0"`
        : `data-set="${r.set}" data-idx="${r.key}" tabindex="0"`;
      return `<tr ${attrs}>${cols.map(c =>
        `<td${c.net ? ` data-net="${esc(r.rec.net || '')}"` : ''}>${c.html ? c.html(r.rec) : esc(c.text(r.rec))}</td>`
      ).join('')}</tr>`;
    }).join('')}</tbody></table><p class="table-note">${esc(spec.note(pane, rows.length))}</p>`;
  if (pane.defId === 'rockets')
    wrap.querySelectorAll('th.sortable').forEach(th =>
      th.addEventListener('click', () => sortPaneTable(pane, th.dataset.sort)));
  return wrap;
}

// Replace a table pane's rendered table with a fresh one, then re-run
// the search filter — shared by the sort header clicks and the year
// scope control, which both rebuild the rows.
function refreshTable(pane) {
  pane.body.querySelector('.table-wrap').replaceWith(renderTable(pane));
  pane.applyFilter?.();
}

// Header click on a sortable rockets column: a new column sorts
// descending, re-clicking flips. The choice is per-pane filter state
// ({sort, dir}) so it serializes into the workspace hash and replays
// on restore; the 'q' filter re-applies over the rebuilt rows.
function sortPaneTable(pane, key) {
  const curKey = pane.filters.sort || 'launches';
  const curDir = pane.filters.dir || 'desc';
  pane.filters.sort = key;
  pane.filters.dir = key === curKey && curDir === 'desc' ? 'asc' : 'desc';
  refreshTable(pane);
  saveState();
}

const csvCell = v => `"${String(v).replaceAll('"', '""')}"`;

// CSV mirrors the table exactly: same column spec, same row order the
// pane currently displays (the rockets export follows its sort).
function tableCsv(pane) {
  const spec = TABLE_SPECS[pane.defId];
  const cols = visCols(spec, pane);
  const rows = [cols.map(c => c.head),
    ...spec.rows(pane).map(r => cols.map(c => c.text(r.rec)))];
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
