// Chart filter controls and shared pane machinery: the per-pane filter
// widgets (FILTER_BUILDERS keyed by the names in each def's `filters`
// list), the chart pager, and the freshFilters state factory. The
// workspace shell — panes, divider, persistence — lives in
// workspace.js. A classic script, not a module, so file:// previews
// and the offline build work — it shares app.js's top-level bindings
// ($, esc, STATS from stats.js) plus the factories and defs from the other chart
// files; load order is JS_FILES in pipeline/config.py.
// Segmented scope control over a `scopes` value list — a button per
// year. Reports the choice via onChange; hides itself when there's only
// one scope to pick.
function makeScopeSeg(scope, onChange, scopes) {
  const el = document.createElement('div');
  el.className = 'seg';
  const btns = [];
  const activate = v =>
    btns.forEach(b => b.classList.toggle('active', b.dataset.scope === v));
  scopes.forEach(v => {
    const b = document.createElement('button');
    b.className = 'seg-btn';
    b.dataset.scope = v;
    b.textContent = v;
    b.addEventListener('click', () => { activate(v); onChange(v); });
    btns.push(b);
    el.append(b);
  });
  activate(scope);
  el.hidden = scopes.length <= 1;
  return el;
}

// Scopes every chart offers: the fetched years, newest first — JS
// orders the integer-like year keys of STATS.yearly ascending, so a
// reverse puts the newest year at the front where the seg leads.
const ALL_SCOPES = Object.keys(STATS.yearly).reverse();
// The default and fallback scope is the newest year.
const DEFAULT_SCOPE = ALL_SCOPES[0];

// Search box at the top of a .pick-pop: typing narrows the option rows
// by label text. Extra rows (the country picker's negate toggle) are
// mode controls, not options, so they're exempt from the filter.
function addPopSearch(pop) {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'pop-search';
  input.placeholder = 'Filter…';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    pop.querySelectorAll('.pick-row:not(.pick-negate)')
      .forEach(row => {
        row.hidden = q !== '' && !row.textContent.toLowerCase().includes(q);
      });
  });
  pop.append(input);
  return input;
}

// Checkbox-popover factory shared by the country, rocket, and entity
// pickers: a button that summarizes live state and opens a searchable
// checkbox list, plus a reset button. opts:
//   title      popover heading
//   resetLabel reset button text ('Clear' by default)
//   options    [value, label] pairs, one checkbox row each
//   sel        Set the checkboxes mutate in place
//   summary()  -> {text, title?} for the button
//   active()   -> bool, whether the button shows the has-sel accent
//   onChange   fired after any state change
//   reset()    mutates state, returns whether anything changed — the
//              checkboxes re-sync to sel and emit fires only then
//   keepOne    the last checked box refuses to uncheck (trend charts
//              would render blank with no series)
//   extraRows  rows inserted between the search box and the options —
//              an array, or a function of emit() for rows that fire
//              changes themselves (the country picker's negate toggle)
function makeCheckPopover(opts) {
  const {title, resetLabel = 'Clear', options, sel, summary, active,
         onChange, reset, keepOne = false, extraRows = []} = opts;
  const wrap = document.createElement('div');
  wrap.className = 'pick-filter';
  const btn = document.createElement('button');
  btn.className = 'chart-pick';
  btn.type = 'button';
  const pop = document.createElement('div');
  pop.className = 'pick-pop';
  pop.hidden = true;
  const label = () => {
    const s = summary();
    btn.textContent = s.text;
    btn.title = s.title ?? s.text;
    wrap.classList.toggle('has-sel', active());
  };
  const emit = () => { label(); onChange(); };
  const head = document.createElement('div');
  head.className = 'pick-pop-head';
  const clear = document.createElement('button');
  clear.className = 'pick-reset';
  clear.type = 'button';
  clear.textContent = resetLabel;
  head.append(title, clear);
  pop.append(head);
  const search = addPopSearch(pop);
  pop.append(...(typeof extraRows === 'function' ? extraRows(emit) : extraRows));
  const cbs = [];
  for (const [v, name] of options) {
    const row = document.createElement('label');
    row.className = 'pick-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sel.has(v);
    cb.addEventListener('change', () => {
      if (keepOne && !cb.checked && sel.size === 1) {
        cb.checked = true;
        return;
      }
      cb.checked ? sel.add(v) : sel.delete(v);
      emit();
    });
    row.append(cb, name);
    pop.append(row);
    cbs.push([v, cb]);
  }
  // Reset mutates via the caller's closure; on a real change every
  // option checkbox re-syncs to sel. Extra-row checkboxes (the negate
  // toggle) sync inside their own reset closure instead — a blanket
  // .pick-row query would desync them.
  clear.addEventListener('click', () => {
    if (!reset()) return;
    cbs.forEach(([v, cb]) => { cb.checked = sel.has(v); });
    emit();
  });
  btn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) search.focus();
  });
  label();
  wrap.append(btn, pop);
  return wrap;
}

// Multi-select country picker with an Exclude toggle. Mutates sel
// ({codes, negate}) in place, then fires onChange. `map` (label ->
// code, from the def's countryMap) decides which codes are worth
// listing — only ones that can appear among this grouping.
function makeCountryFilter(sel, onChange, map) {
  // The Exclude row is a mode toggle, not an option, so it rides in
  // extraRows — as a function, since its checkbox needs the emit the
  // popover creates.
  const negRow = document.createElement('label');
  negRow.className = 'pick-row pick-negate';
  const negCb = document.createElement('input');
  negCb.type = 'checkbox';
  negCb.checked = sel.negate;
  negRow.append(negCb, ' Exclude selected');
  // Only codes that actually appear among this grouping are worth
  // listing; names come from the stats build's country names map.
  const codes = [...new Set(Object.values(map))]
    .sort((a, b) => (STATS.countryNames[a] || a)
      .localeCompare(STATS.countryNames[b] || b));
  return makeCheckPopover({
    title: 'Countries',
    options: codes.map(code => [code, STATS.countryNames[code] || code]),
    sel: sel.codes,
    summary: () => {
      const picked = [...sel.codes].sort();
      const n = picked.length;
      const text = !n ? 'Country: all'
        : n <= 3 ? `Country: ${sel.negate ? 'not ' : ''}${picked.join(', ')}`
        : `Country: ${sel.negate ? 'all but ' : ''}${n}`;
      return {text};
    },
    active: () => sel.codes.size > 0,
    onChange,
    reset: () => {
      // Selections and exclude mode clear together; nothing to do when
      // already clear.
      if (!sel.codes.size && !sel.negate) return false;
      sel.codes.clear();
      sel.negate = false;
      negCb.checked = false;
      return true;
    },
    extraRows: emit => {
      negCb.addEventListener('change', () => {
        sel.negate = negCb.checked;
        emit();
      });
      return [negRow];
    },
  });
}

// Checkbox popover of the def's `entities` used as a row filter — e.g.
// restrict a launch-site chart to selected rockets. Unlike the entity
// picker an empty selection is legal and filters nothing ("Rocket:
// all"). Mutates sel (a Set) in place, then fires onChange.
function makeRocketFilter(sel, onChange, def) {
  const list = def.entities();
  const nameOf = new Map(list);
  // Prune picks that aren't in this def's list (stale from another def).
  const valid = new Set(list.map(([v]) => v));
  [...sel].forEach(v => { if (!valid.has(v)) sel.delete(v); });
  return makeCheckPopover({
    title: 'Rockets',
    options: list,
    sel,
    summary: () => {
      const names = [...sel].map(v => nameOf.get(v));
      return {text: !names.length ? 'Rocket: all'
        : names.length <= 3 ? `Rocket: ${names.join(', ')}`
        : `Rocket: ${names.length}`};
    },
    active: () => sel.size > 0,
    onChange,
    reset: () => {
      if (!sel.size) return false;
      sel.clear();
      return true;
    },
  });
}

// A click anywhere outside an open picker popover closes it.
document.addEventListener('click', e => {
  document.querySelectorAll('.pick-pop:not([hidden])').forEach(p => {
    if (!p.parentElement.contains(e.target)) p.hidden = true;
  });
});

// Boolean filter toggles share one builder; `key` is the filters-state
// property the checkbox flips.
const makeToggle = (text, key) => (slot, reload) => {
  const label = document.createElement('label');
  label.className = 'success-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = slot.filters[key];
  cb.addEventListener('change', () => {
    slot.filters[key] = cb.checked;
    reload();
  });
  label.append(cb, ` ${text}`);
  return label;
};

// Filter builders keyed by the names in each def's `filters` list; each
// returns a control that updates the pane's filter state on change.
// (workspace.js adds 'q', the table search box.) `slot` is the pane
// object — defId, filters, and refreshPager are the fields it reads.
const FILTER_BUILDERS = {
  year: (slot, reload) => {
    // A stale scope — a year that isn't in the data (e.g. an old saved
    // hash) — resets to the newest year.
    if (!ALL_SCOPES.includes(slot.filters.year))
      slot.filters.year = DEFAULT_SCOPE;
    return makeScopeSeg(slot.filters.year, year => {
      slot.filters.year = year;
      reload();
    }, ALL_SCOPES);
  },
  country: (slot, reload) => makeCountryFilter(slot.filters.country,
    reload, CHART_DEFS[slot.defId].countryMap ?? ROCKET_COUNTRIES),
  rocket: (slot, reload) => makeRocketFilter(slot.filters.rockets,
    reload, CHART_DEFS[slot.defId]),
  // 'Successes only' — donut defs can't show the failed segment, so
  // this toggle swaps their dataset to success counts instead. Trends
  // share it for the same reason.
  success: makeToggle('Successes only', 'successOnly'),
  // 'Cumulative' turns a trend's per-year counts into a running total.
  cumulative: makeToggle('Cumulative', 'cumulative'),
  // 'By variant' swaps the rocket-family chart's stacking: each segment
  // is a rocket variant instead of a launch category.
  variant: makeToggle('By variant', 'variantStack'),
  // Multi-select entity picker for trend charts: filters.entities is
  // a Set that can never empty — a trend with no series would render
  // blank — so keepOne refuses the last uncheck and Reset returns to
  // the def's defaultEntity instead of clearing. Stale picks from a
  // previous def in this pane are pruned first.
  entity: (slot, reload) => {
    const def = CHART_DEFS[slot.defId];
    const list = def.entities();
    const valid = new Set(list.map(([v]) => v));
    const nameOf = new Map(list);
    const sel = slot.filters.entities = new Set(
      [...slot.filters.entities].filter(v => valid.has(v)));
    const fallback = () => def.defaultEntity ?? list[0][0];
    if (!sel.size) sel.add(fallback());
    return makeCheckPopover({
      title: 'Entities', resetLabel: 'Reset', keepOne: true,
      options: list, sel,
      reset: () => { sel.clear(); sel.add(fallback()); return true; },
      summary: () => {
        const names = [...sel].map(v => nameOf.get(v));
        return {text: names.length <= 2 ? names.join(', ')
                  : `${names[0]} +${names.length - 1}`,
                title: names.join(', ')};
      },
      // The picker always carries the accent — it always has a
      // selection, since one is mandatory.
      active: () => true,
      onChange: reload,
    });
  },
};

// Wire ‹ [n] of N › controls to a chart; returns a refresh that also
// hides the pager when the data fits on one page. getChart is a function
// so the target can change (the pane's mounted chart instance).
function attachPager(els, getChart) {
  const refresh = () => {
    const c = getChart(), n = c.pageCount();
    els.wrap.hidden = n <= 1;
    els.prev.disabled = c.page <= 0;
    els.next.disabled = c.page >= n - 1;
    if (els.select.options.length !== n) {
      els.select.innerHTML = Array.from({length: n},
        (_, i) => `<option value="${i}">${i + 1}</option>`).join('');
    }
    els.select.value = c.page;
    els.total.textContent = `of ${n}`;
  };
  els.prev.addEventListener('click', () => {
    const c = getChart();
    c.setPage(c.page - 1);
    refresh();
  });
  els.next.addEventListener('click', () => {
    const c = getChart();
    c.setPage(c.page + 1);
    refresh();
  });
  els.select.addEventListener('change', () => {
    getChart().setPage(+els.select.value);
    refresh();
  });
  return refresh;
}

// A pane's chart filter state: year scope, the country picker's
// {codes, negate} selection, the boolean toggles, and two Sets — the
// trend entity multi-pick and the site charts' rocket filter.
const freshFilters = year => ({year,
  country: {codes: new Set(), negate: false}, successOnly: false,
  cumulative: false, variantStack: false, entities: new Set(),
  rockets: new Set()});
