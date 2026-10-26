// Workspace shell: two panes, each holding any view — a chart from
// CHART_DEFS or a table rendered by tables.js. Owns the pane skeleton
// (view picker, per-view controls, pager, export, maximize), the
// draggable divider, the split/focused display modes, CSV export, and
// URL-hash + localStorage persistence. A classic script sharing the
// earlier files' top-level bindings ($, esc, DATA, STATS,
// FILTER_BUILDERS, attachPager, freshFilters, rowTotal, renderTable,
// tableCsv); load order is JS_FILES in pipeline/config.py.

// Table views join CHART_DEFS in one registry — the picker's 'Tables'
// group and each pane's controls come from these defs. 'q' is the
// text-search filter wired below. Tables render per pane from
// TABLE_SPECS in tables.js, so the same table can be open in both
// panes (with independent sorts and searches).
const TABLE_VIEWS = {
  upcoming: {label: 'Upcoming launches', kind: 'Table', filters: ['q']},
  past:     {label: 'Previous launches', kind: 'Table', filters: ['launchYear', 'q']},
  rockets:  {label: 'Rockets',           kind: 'Table', filters: ['q']},
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

// Year scopes for the past-launches table: the distinct launch years
// in its rows, newest first like the chart scopes.
const netYear = d => d.net?.slice(0, 4);
const netYears = list =>
  [...new Set(list.map(netYear).filter(Boolean))].sort();
const LAUNCH_SCOPES = {past: netYears(DATA.previous).reverse()};

// The 'launchYear' filter: the same .seg control as the chart year
// picker, but scoped to the table's own launches. A stale scope — a
// year the table doesn't contain — resets to the newest. Changing it
// rebuilds the rows like a table sort does, so the search filter
// re-runs over the new list.
FILTER_BUILDERS.launchYear = (pane, onChange) => {
  const scopes = LAUNCH_SCOPES[pane.defId];
  const year = scopes.includes(pane.filters.year) ? pane.filters.year : scopes[0];
  if (year !== pane.filters.year) {
    pane.filters.year = year;
    refreshTable(pane);
  }
  return makeScopeSeg(year, v => {
    pane.filters.year = v;
    refreshTable(pane);
    onChange();
  }, scopes);
};

// Table filter state: the search text, plus the year scope for tables
// that offer one — seeded from a carried-over chart year when the
// table has it, else the newest. Unscoped tables get just {q}.
const freshTableFilters = (defId, year) => {
  const scopes = LAUNCH_SCOPES[defId];
  return {q: '', ...(scopes
    ? {year: scopes.includes(year) ? year : scopes[0]} : {})};
};

const workspaceEl = $('workspace');
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
const paneSizer = new ResizeObserver(entries => entries.forEach(en => {
  en.target.classList.toggle('narrow', en.contentRect.width < 600);
  const pane = panes.find(p => p.el === en.target);
  if (pane) retestCompact(pane);
}));

// Compact mode moves the controls row into a Filters popover when the
// head can't fit it on one line — measured on the real controls, not a
// fixed width, so a light filter set (a lone picker) stays inline as
// long as it fits. The signal is head height: one line is about the
// picker's height, and either wrap mode — the controls dropping to a
// second line, or wrapping internally — roughly doubles it. Controls
// are display:none while compacted, so the class comes off to measure.
// Re-runs on resize, view mount, and every saveState — a picker label
// change ('Rocket: a, b, c') can wrap the head after the fact.
function retestCompact(pane) {
  pane.el.classList.remove('compact');
  const wrapped = pane.select.parentElement.offsetHeight
    > pane.select.offsetHeight * 1.4;
  if (wrapped) pane.el.classList.add('compact');
  else pane.controlsEl.classList.remove('open');
}

// Rebuild a pane's view picker, one optgroup per view kind. Every view
// can repeat across panes — charts mount fresh and tables render fresh
// — so nothing is ever disabled.
function refreshPickers() {
  for (const p of panes) {
    const kinds = [...new Set(Object.values(VIEW_DEFS).map(d => d.kind))];
    p.select.innerHTML = kinds.map(kind =>
      `<optgroup label="${esc(kind === 'Table' ? 'Tables' : kind)}">${Object.entries(VIEW_DEFS)
        .filter(([, d]) => d.kind === kind)
        .map(([id, d]) => `<option value="${id}">${esc(d.label)}</option>`)
        .join('')}</optgroup>`).join('');
    p.select.value = p.defId;
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
// filter controls; table views render a fresh .table-wrap from
// TABLE_SPECS and get the 'q' search box. Controls are built before
// chart data() runs so they can seed filter defaults (the entity
// picker's default pick).
function mountPane(pane) {
  const def = VIEW_DEFS[pane.defId];
  pane.inst?.chart?.destroy();
  pane.inst = null;
  pane.applyFilter = null;
  pane.controlsEl.classList.remove('open');
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
    pane.inst.setData(def.data(pane.filters));
    pane.refreshPager();
  } else {
    // The table reads pane.filters.sort/dir itself, so a restored
    // rockets sort lands in one render.
    pane.body.append(renderTable(pane));
    buildControls(pane, saveState);
    pane.applyFilter?.();
  }
  const expLabel = isChart(pane.defId)
    ? 'Download chart as PNG' : 'Download table as CSV';
  pane.exportBtn.title = expLabel;
  pane.exportBtn.setAttribute('aria-label', expLabel);
  syncAxes();
  // The new def's controls may be wider or narrower than the last —
  // remeasure whether the head can still fit them inline.
  retestCompact(pane);
}

// Pane skeleton: head row (kind tag, view picker, per-view controls —
// collapsing into a Filters popover in compact mode — export,
// maximize) over a body holding the view, plus a pager shown only by
// multi-page charts.
function makePane() {
  const el = document.createElement('div');
  el.className = 'pane';
  el.innerHTML = `
    <div class="pane-head">
      <span class="pane-kind"></span>
      <select class="chart-pick" aria-label="View"></select>
      <div class="pane-controls"></div>
      <div class="pick-filter pane-filters">
        <button class="chart-pick" type="button">Filters</button>
      </div>
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
    filtersWrap: el.querySelector('.pane-filters'),
    filtersBtn: el.querySelector('.pane-filters .chart-pick'),
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
      ? pane.filters.year : DEFAULT_SCOPE;
    pane.filters = isChart(pane.defId) ? freshFilters(keepYear)
      : freshTableFilters(pane.defId, keepYear);
    mountPane(pane);
    refreshPickers();
    saveState();
  });
  // The compact-mode Filters button toggles the controls popover; a
  // click outside the panel or the button closes it. Nested pick-pops
  // live inside the panel, so they can't close it.
  pane.filtersBtn.addEventListener('click', () =>
    pane.controlsEl.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!pane.filtersWrap.contains(e.target) &&
        !pane.controlsEl.contains(e.target))
      pane.controlsEl.classList.remove('open');
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

// Table export mirrors the PNG button: tableCsv in tables.js builds the
// CSV from the same column spec and row order the table shows, so the
// export can never drift from the rendered columns.
function exportCsv(pane) {
  const url = URL.createObjectURL(
    new Blob([tableCsv(pane)], {type: 'text/csv'}));
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
// Token keys — y: year scope (charts and the past-launches table);
// c: country codes (! = exclude); e: entity picks; r: rocket picks;
// so/cm/vs: successes-only/cumulative/variant toggles; q: table search;
// t: rockets sort as <key>.<dir>. The same string is kept in
// localStorage so the layout survives between visits; the hash wins
// on load.
const STORAGE_KEY = 'ra-workspace';

const encList = set => [...set].map(encodeURIComponent).join(',');
const decList = s =>
  s.split(',').filter(Boolean).map(v => decodeURIComponent(v));

// The serialized filter tokens for one pane — shared by the hash
// serializer and the compact-mode Filters button's active count.
const paneTokens = p => {
  const f = p.filters, t = [];
  if (isChart(p.defId)) {
    const c = f.country ?? {codes: new Set(), negate: false};
    if (f.year && f.year !== DEFAULT_SCOPE) t.push('y' + f.year);
    if (c.codes.size || c.negate)
      t.push('c' + (c.negate ? '!' : '') + encList([...c.codes].sort()));
    if (f.successOnly) t.push('so');
    if (f.cumulative) t.push('cm');
    if (f.variantStack) t.push('vs');
    if (f.entities?.size) t.push('e' + encList(f.entities));
    if (f.rockets?.size) t.push('r' + encList(f.rockets));
  } else {
    if (f.q) t.push('q' + encodeURIComponent(f.q));
    // The past table carries a year scope too — a non-default pick
    // (default: newest year) serializes like the chart year.
    const scopes = LAUNCH_SCOPES[p.defId];
    if (scopes && f.year !== scopes[0]) t.push('y' + f.year);
    // The rockets table's sort is per-pane filter state — tables.js
    // writes {sort, dir} into it on each header click.
    if (p.defId === 'rockets' && f.sort)
      t.push('t' + f.sort + '.' + (f.dir || 'desc'));
  }
  return t;
};

// Compact-mode Filters button: badges the count of user-set filters.
// 'e' tokens are excluded — the entity picker always carries its
// mandatory default selection on trend charts, so it isn't a choice.
function updateFiltersBtn(pane) {
  const n = paneTokens(pane).filter(t => t[0] !== 'e').length;
  pane.filtersBtn.textContent = n ? `Filters · ${n}` : 'Filters';
  pane.filtersWrap.classList.toggle('has-sel', n > 0);
}

function serialize() {
  const spec = p => {
    const t = paneTokens(p);
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
  return {
    ratio: Math.min(0.7, Math.max(0.3, (m[2] ? +m[2] : 50) / 100)),
    focus: m[3] ? +m[3] : 'split',
    views,
  };
}

function saveState() {
  const s = serialize();
  // A filter change can change control widths (picker summaries), so
  // the head's fit gets remeasured and the badge count updated.
  panes.forEach(updateFiltersBtn);
  panes.forEach(retestCompact);
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

function applyState(s) {
  ratio = s.ratio;
  panes.forEach((p, i) => {
    p.defId = s.views[i].v;
    p.filters = isChart(p.defId)
      ? Object.assign(freshFilters(DEFAULT_SCOPE), s.views[i].f)
      : Object.assign(freshTableFilters(p.defId, DEFAULT_SCOPE), s.views[i].f);
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

// A pasted or hand-edited hash re-applies the workspace it describes.
addEventListener('hashchange', () => {
  const s = loadState();
  if (s) applyState(s);
});

// The header's info button toggles its popover — the outside-click
// close comes free from charts.js's pick-pop handler.
$('hdr-info-btn').addEventListener('click', () => {
  $('hdr-pop').hidden = !$('hdr-pop').hidden;
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
