// Workspace shell: two panes, each holding any view — a chart from
// CHART_DEFS or a table relocated out of #table-staging. Owns the pane
// skeleton (view picker, per-view controls, pager, export, maximize),
// the draggable divider, the split/focused display modes, CSV export,
// and URL-hash + localStorage persistence. A classic script sharing the
// earlier files' top-level bindings ($, esc, LAUNCHES, ENTITIES, STATS,
// FILTER_BUILDERS, attachPager, freshFilters, applyScopeFilters,
// rowTotal); load order is JS_FILES in pipeline/config.py.

// Table views join CHART_DEFS in one registry — the picker's 'Tables'
// group and each pane's controls come from these defs. `table` names
// the staged .table-wrap element that mountPane relocates into the
// pane body; 'q' is the text-search filter wired below. A table's
// markup exists exactly once, so a table view open in one pane is
// disabled in the other pane's picker (refreshPickers).
const TABLE_VIEWS = {
  upcoming: {label: 'Upcoming launches', kind: 'Table', table: 'tab-upcoming', filters: ['q']},
  past:     {label: 'Previous launches', kind: 'Table', table: 'tab-past',     filters: ['q']},
  rockets:  {label: 'Rockets',           kind: 'Table', table: 'tab-rockets',  filters: ['q']},
};
const VIEW_DEFS = {...CHART_DEFS, ...TABLE_VIEWS};
const isChart = id => id in CHART_DEFS;
const DEFAULT_VIEWS = ['by-rocket', 'upcoming'];

// The 'q' filter: a search box plus live match count for table panes.
// The apply routine is stored on the pane so mountPane can re-run it
// after relocating a table or restoring a saved query.
FILTER_BUILDERS.q = (pane, onChange) => {
  const wrap = document.createElement('div');
  wrap.className = 'pane-filter';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Filter…';
  input.value = pane.filters.q || '';
  const count = document.createElement('span');
  count.className = 'pane-filter-count';
  const hint = document.createElement('span');
  hint.className = 'pane-hint';
  hint.textContent = 'Select a row for details';
  pane.applyFilter = () => {
    pane.filters.q = input.value;
    const q = input.value.trim().toLowerCase();
    const rows = [...pane.body.querySelectorAll('tbody tr')];
    rows.forEach(tr => {
      tr.hidden = q !== '' && !tr.textContent.toLowerCase().includes(q);
    });
    count.textContent = q ? `${rows.filter(tr => !tr.hidden).length} matches` : '';
  };
  input.addEventListener('input', () => { pane.applyFilter(); onChange(); });
  wrap.append(input, count, hint);
  return wrap;
};

const workspaceEl = $('workspace');
const stagingEl = $('table-staging');
const divider = document.createElement('div');
divider.className = 'divider';
divider.title = 'Drag to resize · double-click to reset';

// Narrow layout (stacked panes, fixed even split, no drag) is the same
// breakpoint the stylesheet's mobile block uses.
const mqNarrow = matchMedia('(max-width: 800px)');

let panes = [];
let focus = 'split';   // 'split' shows both panes; 0 or 1 maximizes one
let ratio = 0.5;       // pane A's share of the desktop split

// Donut stacking tracks the pane's real width: under ~600px the
// figure+table row can't fit, so 'narrow' flips it to a column. A
// ResizeObserver covers every cause — divider drag, maximize, window
// resize, mobile stacking — no matter how the width got narrow.
const paneSizer = new ResizeObserver(entries => entries.forEach(en =>
  en.target.classList.toggle('narrow', en.contentRect.width < 600)));

// Rebuild a pane's view picker, one optgroup per view kind. A table
// already open in the other pane is disabled and marked — its markup
// can't be in two places at once (charts can repeat freely).
function refreshPickers() {
  for (const p of panes) {
    const kinds = [...new Set(Object.values(VIEW_DEFS).map(d => d.kind))];
    p.select.innerHTML = kinds.map(kind =>
      `<optgroup label="${esc(kind === 'Table' ? 'Tables' : kind)}">${Object.entries(VIEW_DEFS)
        .filter(([, d]) => d.kind === kind)
        .map(([id, d]) => `<option value="${id}">${esc(d.label)}</option>`)
        .join('')}</optgroup>`).join('');
    p.select.value = p.defId;
    const other = panes.find(q => q !== p);
    for (const o of p.select.options) {
      const taken = !!TABLE_VIEWS[o.value] && other?.defId === o.value;
      o.disabled = taken;
      if (taken) o.textContent += ' (open)';
    }
  }
}

function buildControls(pane, reload) {
  pane.controlsEl.replaceChildren(
    ...VIEW_DEFS[pane.defId].filters.map(f => {
      const ctrl = FILTER_BUILDERS[f](pane, reload);
      ctrl.dataset.filter = f;
      return ctrl;
    }));
}

// Re-read a chart pane's dataset from its current def + filters, then
// persist — every filter change is workspace state.
function reloadPane(pane) {
  pane.inst.setData(CHART_DEFS[pane.defId].data(pane.filters));
  pane.refreshPager();
  syncAxes();
  saveState();
}

// Force both chart panes onto the same y-axis when they chart the same
// unit, so bar heights compare honestly. The bound comes from each
// pane's full dataset, not just the visible page. It's a suggestedMax,
// not max: Chart.js still rounds the axis top up to a nice number (a
// hard max produced ugly ticks) while never dropping below it.
function syncAxes() {
  const charts = panes.filter(p => isChart(p.defId) && p.inst);
  const units = charts.map(p => CHART_DEFS[p.defId].unit);
  const shared = charts.length === 2 && units[0] && units[0] === units[1];
  // Defs whose data rows aren't {label: count} (multi-series trends)
  // provide rowMax to say what one row contributes to the bound.
  const max = shared
    ? Math.max(0, ...charts.flatMap(p => {
        const def = CHART_DEFS[p.defId];
        const bound = def.rowMax ?? rowTotal;
        return Object.values(def.data(p.filters)).map(bound);
      }))
    : 0;
  charts.forEach(p => {
    // Non-cartesian charts (the donuts) have no scales.y to sync.
    const y = p.inst.chart.options.scales?.y;
    if (y) y.suggestedMax = max || undefined;
    p.inst.chart.update();
  });
}

// (Re)build a pane for its current view. Chart views get a fresh
// .chart-pane (defs like the donut replace the pane's contents with
// their own layout, so a leftover canvas would linger) plus that def's
// filter controls; table views relocate the staged .table-wrap and get
// the 'q' search box. Controls are built before chart data() runs so
// they can seed filter defaults (the entity picker's default pick).
function mountPane(pane) {
  const def = VIEW_DEFS[pane.defId];
  pane.inst?.chart?.destroy();
  pane.inst = null;
  pane.applyFilter = null;
  // A table leaving a pane returns to staging so the other pane can
  // take it.
  pane.body.querySelectorAll('.table-wrap')
    .forEach(w => stagingEl.append(w));
  pane.body.replaceChildren();
  pane.pagerEl.hidden = true;
  pane.kindTag.textContent = def.kind;

  if (isChart(pane.defId)) {
    const chartEl = document.createElement('div');
    chartEl.className = 'chart-pane';
    chartEl.innerHTML = '<canvas></canvas>';
    pane.body.append(chartEl);
    pane.inst = def.mount(chartEl);
    buildControls(pane, () => reloadPane(pane));
    applyScopeFilters(pane);
    pane.inst.setData(def.data(pane.filters));
    pane.refreshPager();
  } else {
    pane.body.append($(def.table));
    buildControls(pane, saveState);
    pane.applyFilter?.();
    // The rockets table's sort is remembered in the view's filter state.
    if (pane.defId === 'rockets' && pane.filters.sort)
      sortRockets(pane.filters.sort, pane.filters.dir || 'desc');
  }
  const expLabel = isChart(pane.defId)
    ? 'Download chart as PNG' : 'Download table as CSV';
  pane.exportBtn.title = expLabel;
  pane.exportBtn.setAttribute('aria-label', expLabel);
  syncAxes();
}

// Pane skeleton: head row (kind tag, view picker, per-view controls,
// export, maximize) over a body holding the view, plus a pager shown
// only by multi-page charts.
function makePane() {
  const el = document.createElement('div');
  el.className = 'pane';
  el.innerHTML = `
    <div class="pane-head">
      <span class="pane-kind"></span>
      <select class="chart-pick" aria-label="View"></select>
      <div class="pane-controls"></div>
      <button class="pane-export" type="button" aria-label="Download" title="Download">↓</button>
      <button class="pane-focus" type="button" aria-label="Maximize" title="Maximize">⛶</button>
    </div>
    <div class="pane-body"></div>
    <div class="seg pager" hidden>
      <button class="seg-btn" type="button" aria-label="Previous page">‹</button>
      <select class="pager-select" aria-label="Page"></select>
      <span class="pager-total"></span>
      <button class="seg-btn" type="button" aria-label="Next page">›</button>
    </div>`;
  const pagerEl = el.querySelector('.pager');
  const pane = {
    el,
    kindTag: el.querySelector('.pane-kind'),
    select: el.querySelector('.chart-pick'),
    controlsEl: el.querySelector('.pane-controls'),
    exportBtn: el.querySelector('.pane-export'),
    focusBtn: el.querySelector('.pane-focus'),
    body: el.querySelector('.pane-body'),
    pagerEl,
    defId: null,
    filters: null,
    inst: null,
    applyFilter: null,
  };
  // attachPager assumes a mounted chart; table panes keep it hidden.
  const refresh = attachPager({
    wrap: pagerEl,
    prev: pagerEl.querySelectorAll('.seg-btn')[0],
    next: pagerEl.querySelectorAll('.seg-btn')[1],
    select: pagerEl.querySelector('.pager-select'),
    total: pagerEl.querySelector('.pager-total'),
  }, () => pane.inst);
  pane.refreshPager = () =>
    pane.inst ? refresh() : (pagerEl.hidden = true);

  pane.select.addEventListener('change', () => {
    pane.defId = pane.select.value;
    // Keep the year scope when swapping between charts — comparing the
    // same year across views is the common case. Table panes get a
    // fresh {q} filter shape instead.
    const keepYear = pane.filters && 'year' in pane.filters
      ? pane.filters.year : 'all';
    pane.filters = isChart(pane.defId) ? freshFilters(keepYear) : {q: ''};
    mountPane(pane);
    refreshPickers();
    saveState();
  });
  pane.exportBtn.addEventListener('click', () =>
    isChart(pane.defId) ? exportPng(pane) : exportCsv(pane));
  pane.focusBtn.addEventListener('click', () => {
    const i = panes.indexOf(pane);
    setFocus(focus === i ? 'split' : i);
    saveState();
  });
  paneSizer.observe(el);
  return pane;
}

// Split/focused display modes. 'split' shows both panes with the
// divider; 0 or 1 maximizes that pane — the same button, now showing
// the split-panes icon, restores the split.
function setFocus(f) {
  focus = f;
  panes.forEach((p, i) => {
    const focused = f === i;
    p.el.hidden = f !== 'split' && !focused;
    p.focusBtn.textContent = focused ? '◫' : '⛶';
    const label = focused ? 'Back to split view' : 'Maximize';
    p.focusBtn.title = label;
    p.focusBtn.setAttribute('aria-label', label);
  });
  divider.hidden = f !== 'split';
  workspaceEl.classList.toggle('focused', f !== 'split');
  applyRatio();
  // A pane revealed or resized by the mode change needs its chart to
  // reflow — mounted-while-hidden charts stay at 0×0 otherwise.
  panes.forEach(p => { if (!p.el.hidden) p.inst?.chart.resize(); });
}

// Export

// Download a chart pane as a PNG. Chart.js draws on a transparent
// canvas, so the frame is composited over the pane's surface color —
// otherwise the image reads badly on light backgrounds.
function exportPng(pane) {
  const src = pane.inst.chart.canvas;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  const bg = getComputedStyle(pane.el).backgroundColor;
  ctx.fillStyle = bg === 'rgba(0, 0, 0, 0)'
    ? getComputedStyle(document.body).backgroundColor : bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  const a = document.createElement('a');
  a.download = `${pane.defId}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
}

// Table export mirrors the PNG button: same columns the table shows,
// rows built from the baked JSON — ids resolve to display names via the
// entity maps, matching what the Jinja table rendered.
const csvCell = v => `"${String(v).replaceAll('"', '""')}"`;
const csvRows = (head, rows) =>
  [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');

function launchCsv(rows, withStatus) {
  const head = ['Date', 'Mission', 'Provider', 'Pad',
    ...(withStatus ? ['Status'] : [])];
  return csvRows(head, rows.map(d => [
    fmtLocal(d.net) || '', d.name || '',
    ENTITIES.providers[d.provider_id]?.name || '—',
    ENTITIES.pads[d.pad_id]?.name || '—',
    ...(withStatus ? [d.status || 'Unknown'] : []),
  ]));
}

const CSV_BUILDERS = {
  upcoming: () => launchCsv(LAUNCHES.upcoming, false),
  past:     () => launchCsv(LAUNCHES.past, true),
  rockets:  () => csvRows(
    ['Name', 'Provider', 'LEO capacity', 'Successful / attempted'],
    // Same default order the Jinja table renders in.
    [...Object.values(ENTITIES.rockets)]
      .sort((a, b) => (b.launches || 0) - (a.launches || 0)
        || (b.leo_capacity || 0) - (a.leo_capacity || 0)
        || (a.name || '').localeCompare(b.name || ''))
      .map(r => [r.name || '—', r.manufacturer || '—',
        r.leo_capacity != null ? `${r.leo_capacity.toLocaleString()} kg` : '—',
        r.launches != null ? `${r.successful || 0} / ${r.launches}` : '—'])),
};

function exportCsv(pane) {
  const url = URL.createObjectURL(
    new Blob([CSV_BUILDERS[pane.defId]()], {type: 'text/csv'}));
  const a = document.createElement('a');
  a.download = `${pane.defId}.csv`;
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

// Persistence: the whole workspace state — view + filters per pane,
// divider ratio, focus mode — as one compact hash string:
//   #<viewA>[;<tok>;<tok>]|<viewB>[;<tok>...][@<paneA-%>][^<focused>]
// e.g. #by-rocket;y2025;so|upcoming;qfalcon@60^1
// Only non-default values are written, so the default layout hashes to
// just #by-rocket|upcoming. Multi-value filters are comma lists of
// percent-encoded names, which keeps ; | @ ^ and , safe as separators.
// Token keys — y: year; c: country codes (! = exclude); e: entity
// picks; r: rocket picks; so/cm/vs: successes-only/cumulative/variant
// toggles; q: table search; t: rockets sort as <key>.<dir>. The same
// string is kept in localStorage so the layout survives between visits;
// the hash wins on load.
const STORAGE_KEY = 'ra-workspace';

const encList = set => [...set].map(encodeURIComponent).join(',');
const decList = s =>
  s.split(',').filter(Boolean).map(v => decodeURIComponent(v));

function serialize() {
  const spec = p => {
    const f = p.filters, t = [];
    if (isChart(p.defId)) {
      const c = f.country ?? {codes: new Set(), negate: false};
      if (f.year && f.year !== 'all') t.push('y' + f.year);
      if (c.codes.size || c.negate)
        t.push('c' + (c.negate ? '!' : '') + encList([...c.codes].sort()));
      if (f.successOnly) t.push('so');
      if (f.cumulative) t.push('cm');
      if (f.variantStack) t.push('vs');
      if (f.entities?.size) t.push('e' + encList(f.entities));
      if (f.rockets?.size) t.push('r' + encList(f.rockets));
    } else {
      if (f.q) t.push('q' + encodeURIComponent(f.q));
      // The rockets table's sort lives on the wrap's dataset
      // (sortRockets writes it), so it's folded in here.
      if (p.defId === 'rockets') {
        const w = $('tab-rockets');
        if (w.dataset.sort)
          t.push('t' + w.dataset.sort + '.' + (w.dataset.dir || 'desc'));
      }
    }
    return p.defId + (t.length ? ';' + t.join(';') : '');
  };
  let s = panes.map(spec).join('|');
  if (Math.round(ratio * 100) !== 50)
    s += '@' + Math.round(ratio * 100);
  if (focus !== 'split') s += '^' + focus;
  return s;
}

// Parse a serialized layout, tolerating bad input: unknown views fall
// back to the defaults and unrecognized tokens are ignored so a hash
// from a newer build degrades gracefully.
function parseState(str) {
  const m = /^([^@^]+?)(?:@(\d+))?(?:\^([01]))?$/.exec(str || '');
  if (!m) return null;
  const specs = m[1].split('|');
  if (specs.length !== 2) return null;
  const views = specs.map((spec, i) => {
    const [id, ...toks] = spec.split(';');
    if (!VIEW_DEFS[id]) return {v: DEFAULT_VIEWS[i], f: {}};
    const f = {};
    for (const t of toks) {
      if (t === 'so') f.successOnly = true;
      else if (t === 'cm') f.cumulative = true;
      else if (t === 'vs') f.variantStack = true;
      else if (/^y\d{4}$/.test(t)) f.year = t.slice(1);
      else if (/^c/.test(t)) {
        const neg = t[1] === '!';
        f.country = {codes: new Set(decList(t.slice(neg ? 2 : 1))),
                     negate: neg};
      }
      else if (t[0] === 'e') f.entities = new Set(decList(t.slice(1)));
      else if (t[0] === 'r') f.rockets = new Set(decList(t.slice(1)));
      else if (t[0] === 'q') f.q = decodeURIComponent(t.slice(1));
      else if (/^t\w+\.(asc|desc)$/.test(t)) {
        const [k, d] = t.slice(1).split('.');
        f.sort = k;
        f.dir = d;
      }
    }
    return {v: id, f};
  });
  // The same table in both panes is impossible (one staged node) — the
  // second pane falls back to the default chart, which may repeat.
  if (views[0].v === views[1].v && TABLE_VIEWS[views[0].v])
    views[1].v = DEFAULT_VIEWS[0];
  return {
    ratio: Math.min(0.7, Math.max(0.3, (m[2] ? +m[2] : 50) / 100)),
    focus: m[3] ? +m[3] : 'split',
    views,
  };
}

function saveState() {
  const s = serialize();
  try { localStorage.setItem(STORAGE_KEY, s); } catch {}
  // replaceState can throw in sandboxed contexts; persistence is
  // best-effort either way.
  try { history.replaceState(null, '', '#' + s); } catch {}
}

// URL hash first, then localStorage — either may hold a stale or
// foreign hash, so both go through the tolerant parser.
function loadState() {
  if (location.hash.length > 1) {
    const s = parseState(location.hash.slice(1));
    if (s) return s;
  }
  let stored = '';
  try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch {}
  return parseState(stored);
}

function defaultState() {
  return {ratio: 0.5, focus: 'split', views: [
    {v: DEFAULT_VIEWS[0], f: {}},
    {v: DEFAULT_VIEWS[1], f: {}},
  ]};
}

// Mount order matters: a table moving between panes returns to staging
// from the pane that held it before the other pane claims it.
function applyState(s) {
  ratio = s.ratio;
  panes.forEach((p, i) => {
    p.defId = s.views[i].v;
    p.filters = isChart(p.defId)
      ? Object.assign(freshFilters('all'), s.views[i].f)
      : {q: '', ...s.views[i].f};
    mountPane(p);
  });
  refreshPickers();
  applyRatio();
  setFocus(s.focus);
  saveState();
}

// Divider drag (desktop only — narrow stacked panes are a fixed even
// split). Panes size by flex-grow ratio off a zero basis, so `ratio`
// is pane A's share of the space beside the divider.
function applyRatio() {
  if (mqNarrow.matches) {
    panes.forEach(p => p.el.style.flex = '');
    return;
  }
  panes.forEach((p, i) => {
    // Grow factors under 1 only claim that fraction of the free space —
    // a maximized pane must get grow 1 or it fills just `ratio` of the
    // workspace while its sibling hides.
    p.el.style.flex = focus === 'split'
      ? `${i === 0 ? ratio : 1 - ratio} 1 0`
      : i === focus ? '1 1 0' : '0 1 0';
  });
}

divider.addEventListener('pointerdown', e => {
  if (mqNarrow.matches) return;
  e.preventDefault();
  divider.setPointerCapture(e.pointerId);
  const rect = workspaceEl.getBoundingClientRect();
  const move = ev => {
    ratio = Math.min(0.7, Math.max(0.3, (ev.clientX - rect.left) / rect.width));
    applyRatio();
  };
  const up = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up);
    divider.removeEventListener('pointercancel', up);
    saveState();
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
  divider.addEventListener('pointercancel', up);
});

divider.addEventListener('dblclick', () => {
  if (mqNarrow.matches) return;
  ratio = 0.5;
  applyRatio();
  saveState();
});

// Leaving/entering the narrow breakpoint re-applies sizing — inline
// flex styles set while wide are cleared when the stacked layout is
// fixed at 50/50.
mqNarrow.addEventListener('change', applyRatio);

// Sorting the rockets table is workspace state too — the delegated
// listener runs after the th's own handler has applied the sort.
document.querySelector('main').addEventListener('click', e => {
  if (e.target.closest('th.sortable')) saveState();
});

// A pasted or hand-edited hash re-applies the workspace it describes.
addEventListener('hashchange', () => {
  const s = loadState();
  if (s) applyState(s);
});

$('reset-layout').addEventListener('click', () => {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  applyState(defaultState());
  // applyState's saveState writes the default layout to the hash —
  // strip it after so a reset leaves a clean URL.
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {}
});

// Boot: hash > remembered layout > default (rocket bars | upcoming).
panes = [makePane(), makePane()];
workspaceEl.append(panes[0].el, divider, panes[1].el);
applyState(loadState() || defaultState());
