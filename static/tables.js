// Table views: one column spec per table, shared by the rendered pane
// table and its CSV export so the two can't drift, plus the per-pane
// rocket sort wiring. A classic script sharing DATA/esc/fmtLocal/num
// from app.js; load order is JS_FILES in pipeline/config.py.
//
// A column spec is {head, headHtml?, sort?, net?, text(rec), html?(rec)}:
// `text` is the cell's plain value — it feeds the CSV directly and is
// HTML-escaped for the <td>; `html` overrides the cell markup when the
// value needs markup (the two-line date, the status badge); `sort`
// names the record key a header click can order by (rockets only);
// `headHtml` overrides the header text when it needs markup; `net`
// marks the date column so it keeps the data-net attribute the
// stylesheet's nowrap rule hooks.

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
  {head: 'Provider',
   text: d => DATA.agencies[d.provider_id]?.name ?? '—'},
  {head: 'Pad',
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
];

const rocketCols = [
  {head: 'Name', text: r => r.name || '—'},
  // The manufacturer is a row in the merged agencies table.
  {head: 'Provider',
   text: r => DATA.agencies[r.manufacturer_id]?.name || '—'},
  {head: 'LEO capacity', sort: 'leo_capacity',
   text: r => r.leo_capacity != null ? num(r.leo_capacity, 'kg') : '—'},
  {head: 'Successful / attempted', headHtml: 'Successful /<br>attempted',
   sort: 'launches',
   text: r => r.launches != null ? `${r.successful || 0} / ${r.launches}` : '—'},
];

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
  const rows = defaultRocketRows();
  const key = pane.filters.sort;
  if (!key) return rows;
  const mul = (pane.filters.dir || 'desc') === 'desc' ? 1 : -1;
  return rows.sort((a, b) => {
    const va = a.rec[key], vb = b.rec[key];
    if (va == null) return vb == null ? 0 : 1;
    if (vb == null) return -1;
    return mul * (vb - va);
  });
}

// Each spec produces {rec, set, key} rows: set/key become the
// data-set/data-idx (launches) or data-id (rockets) attributes the
// row-click modal lookup in app.js keys off.
const TABLE_SPECS = {
  upcoming: {
    cols: launchCols(false),
    rows: () => DATA.upcoming.map((d, i) => ({rec: d, set: 'upcoming', key: i})),
    note: () => `Showing the next ${DATA.upcoming.length} launches`,
  },
  past: {
    cols: launchCols(true),
    rows: () => DATA.previous.map((d, i) => ({rec: d, set: 'past', key: i})),
    note: () => `Showing the last ${DATA.previous.length} launches`,
  },
  rockets: {
    cols: rocketCols,
    rows: rocketRows,
    note: () => `Showing ${Object.keys(DATA.rockets).length} rockets observed in the listed launches`,
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
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `<table><thead><tr>${spec.cols.map(c => {
      const sortable = c.sort ? ` class="sortable" data-sort="${c.sort}"` : '';
      const dir = c.sort && c.sort === sortKey ? ` data-dir="${sortDir}"` : '';
      return `<th${sortable}${dir}>${c.headHtml || esc(c.head)}</th>`;
    }).join('')}</tr></thead><tbody>${spec.rows(pane).map(r => {
      const attrs = r.set === 'rockets'
        ? `data-set="rockets" data-id="${esc(String(r.key))}" tabindex="0"`
        : `data-set="${r.set}" data-idx="${r.key}" tabindex="0"`;
      return `<tr ${attrs}>${spec.cols.map(c =>
        `<td${c.net ? ` data-net="${esc(r.rec.net || '')}"` : ''}>${c.html ? c.html(r.rec) : esc(c.text(r.rec))}</td>`
      ).join('')}</tr>`;
    }).join('')}</tbody></table><p class="table-note">${esc(spec.note())}</p>`;
  if (pane.defId === 'rockets')
    wrap.querySelectorAll('th.sortable').forEach(th =>
      th.addEventListener('click', () => sortPaneTable(pane, th.dataset.sort)));
  return wrap;
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
  pane.body.querySelector('.table-wrap').replaceWith(renderTable(pane));
  pane.applyFilter?.();
  saveState();
}

const csvCell = v => `"${String(v).replaceAll('"', '""')}"`;

// CSV mirrors the table exactly: same column spec, same row order the
// pane currently displays (the rockets export follows its sort).
function tableCsv(pane) {
  const spec = TABLE_SPECS[pane.defId];
  const rows = [spec.cols.map(c => c.head),
    ...spec.rows(pane).map(r => spec.cols.map(c => c.text(r.rec)))];
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
