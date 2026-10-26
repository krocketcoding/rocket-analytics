// Chart filter controls and shared pane machinery: the per-pane filter
// widgets (FILTER_BUILDERS keyed by the names in each def's `filters`
// list), the chart pager, and the freshFilters state factory. The
// workspace shell — panes, divider, persistence — lives in
// workspace.js. A classic script, not a module, so file:// previews
// and the offline build work — it shares app.js's top-level bindings
// ($, esc, STATS) plus the factories and defs from the other chart
// files; load order is JS_FILES in pipeline/config.py.
// Segmented scope control over a `scopes` value list — 'all' labels as
// 'All time', anything else is a year. Reports the choice via onChange;
// hides itself when there's only one scope to pick.
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
    b.textContent = v === 'all' ? 'All time' : v;
    b.addEventListener('click', () => { activate(v); onChange(v); });
    btns.push(b);
    el.append(b);
  });
  activate(scope);
  el.hidden = scopes.length <= 1;
  return el;
}

// Scopes every def offers: 'all' first, then years oldest-to-newest
// (yearly keys arrive newest-first from the stats build).
const ALL_SCOPES = ['all', ...Object.keys(STATS.yearly).reverse()];

// Search box at the top of a .country-pop: typing narrows the option
// rows by label text. The country picker's negate row is a mode
// toggle, not an option, so it's exempt from the filter.
function addPopSearch(pop) {
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'pop-search';
  input.placeholder = 'Filter…';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    pop.querySelectorAll('.country-row:not(.country-negate)')
      .forEach(row => {
        row.hidden = q !== '' && !row.textContent.toLowerCase().includes(q);
      });
  });
  pop.append(input);
  return input;
}

// Multi-select country picker with an Exclude toggle: a button opens a
// checkbox list so a dozen-plus options don't crowd the pane header.
// The button summarizes the live selection ("Country: not USA, CHN" /
// "Country: all but 5") and carries an accent while a filter is
// applied. Mutates sel ({codes, negate}) in place, then fires onChange.
// `map` (label -> code, from the def's countryMap) decides which codes
// are worth listing — only ones that can appear among this grouping.
function makeCountryFilter(sel, onChange, map) {
  const wrap = document.createElement('div');
  wrap.className = 'country-filter';
  const btn = document.createElement('button');
  btn.className = 'chart-pick';
  btn.type = 'button';
  const pop = document.createElement('div');
  pop.className = 'country-pop';
  pop.hidden = true;
  const label = () => {
    const picked = [...sel.codes].sort();
    const n = picked.length;
    btn.textContent = !n ? 'Country: all'
      : n <= 3 ? `Country: ${sel.negate ? 'not ' : ''}${picked.join(', ')}`
      : `Country: ${sel.negate ? 'all but ' : ''}${n}`;
    btn.title = btn.textContent;
    wrap.classList.toggle('has-sel', n > 0);
  };
  const emit = () => { label(); onChange(); };
  const head = document.createElement('div');
  head.className = 'country-pop-head';
  const clear = document.createElement('button');
  clear.className = 'country-clear';
  clear.type = 'button';
  clear.textContent = 'Clear';
  head.append('Countries', clear);
  pop.append(head);
  const search = addPopSearch(pop);
  const negRow = document.createElement('label');
  negRow.className = 'country-row country-negate';
  const negCb = document.createElement('input');
  negCb.type = 'checkbox';
  negCb.checked = sel.negate;
  negCb.addEventListener('change', () => {
    sel.negate = negCb.checked;
    emit();
  });
  negRow.append(negCb, ' Exclude selected');
  pop.append(negRow);
  // Only codes that actually appear among this grouping are worth
  // listing; names come from the stats build's country_names map.
  const codes = [...new Set(Object.values(map))]
    .sort((a, b) => (STATS.country_names[a] || a)
      .localeCompare(STATS.country_names[b] || b));
  const countryCbs = [];
  for (const code of codes) {
    const row = document.createElement('label');
    row.className = 'country-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sel.codes.has(code);
    cb.addEventListener('change', () => {
      cb.checked ? sel.codes.add(code) : sel.codes.delete(code);
      emit();
    });
    row.append(cb, STATS.country_names[code] || code);
    pop.append(row);
    countryCbs.push(cb);
  }
  // Clear resets the whole filter — selections and exclude mode. It
  // drives the checkboxes by reference: querying .country-row inputs
  // would also hit the negate box and leave it desynced from sel.negate.
  clear.addEventListener('click', () => {
    if (!sel.codes.size && !sel.negate) return;
    sel.codes.clear();
    sel.negate = false;
    negCb.checked = false;
    countryCbs.forEach(cb => { cb.checked = false; });
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

// Checkbox popover of the def's `entities` used as a row filter — e.g.
// restrict a launch-site chart to selected rockets. Unlike the entity
// picker an empty selection is legal and filters nothing ("Rocket:
// all"). Mutates sel (a Set) in place, then fires onChange. Reuses the
// country picker's popover styles.
function makeRocketFilter(sel, onChange, def) {
  const list = def.entities();
  const nameOf = new Map(list);
  // Prune picks that aren't in this def's list (stale from another def).
  const valid = new Set(list.map(([v]) => v));
  [...sel].forEach(v => { if (!valid.has(v)) sel.delete(v); });
  const wrap = document.createElement('div');
  wrap.className = 'country-filter';
  const btn = document.createElement('button');
  btn.className = 'chart-pick';
  btn.type = 'button';
  const pop = document.createElement('div');
  pop.className = 'country-pop';
  pop.hidden = true;
  const label = () => {
    const names = [...sel].map(v => nameOf.get(v));
    btn.textContent = !names.length ? 'Rocket: all'
      : names.length <= 3 ? `Rocket: ${names.join(', ')}`
      : `Rocket: ${names.length}`;
    btn.title = btn.textContent;
    wrap.classList.toggle('has-sel', names.length > 0);
  };
  const emit = () => { label(); onChange(); };
  const head = document.createElement('div');
  head.className = 'country-pop-head';
  const clear = document.createElement('button');
  clear.className = 'country-clear';
  clear.type = 'button';
  clear.textContent = 'Clear';
  head.append('Rockets', clear);
  pop.append(head);
  const search = addPopSearch(pop);
  const cbs = [];
  for (const [v, name] of list) {
    const row = document.createElement('label');
    row.className = 'country-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = sel.has(v);
    cb.addEventListener('change', () => {
      cb.checked ? sel.add(v) : sel.delete(v);
      emit();
    });
    row.append(cb, name);
    pop.append(row);
    cbs.push(cb);
  }
  clear.addEventListener('click', () => {
    if (!sel.size) return;
    sel.clear();
    cbs.forEach(cb => { cb.checked = false; });
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

// A click anywhere outside an open country picker closes it.
document.addEventListener('click', e => {
  document.querySelectorAll('.country-pop:not([hidden])').forEach(p => {
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
    // yearsOnly defs offer no 'all' scope (no lifetime dataset). A
    // stale scope — a year that isn't in the data or 'all' on a
    // yearsOnly def — resets to the first offered scope.
    const scopes = CHART_DEFS[slot.defId].yearsOnly
      ? ALL_SCOPES.slice(1) : ALL_SCOPES;
    if (!scopes.includes(slot.filters.year))
      slot.filters.year = scopes[0];
    return makeScopeSeg(slot.filters.year, year => {
      slot.filters.year = year;
      applyScopeFilters(slot);
      reload();
    }, scopes);
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
  // Multi-select entity picker for trend charts: a button opens a
  // checkbox popover (reuses the country picker's styles), one line
  // per entity. filters.entities is a Set that can never empty — the
  // last checked box refuses to uncheck — since a trend with no series
  // would render blank. Stale picks from a previous def in this pane
  // are pruned, falling back to the def's defaultEntity.
  entity: (slot, reload) => {
    const def = CHART_DEFS[slot.defId];
    const list = def.entities();
    const valid = new Set(list.map(([v]) => v));
    const nameOf = new Map(list);
    const sel = slot.filters.entities = new Set(
      [...slot.filters.entities].filter(v => valid.has(v)));
    const fallback = () => def.defaultEntity ?? list[0][0];
    if (!sel.size) sel.add(fallback());
    const wrap = document.createElement('div');
    wrap.className = 'country-filter has-sel';
    const btn = document.createElement('button');
    btn.className = 'chart-pick';
    btn.type = 'button';
    const pop = document.createElement('div');
    pop.className = 'country-pop';
    pop.hidden = true;
    const label = () => {
      const names = [...sel].map(v => nameOf.get(v));
      btn.textContent = names.length <= 2 ? names.join(', ')
        : `${names[0]} +${names.length - 1}`;
      btn.title = names.join(', ');
    };
    const emit = () => { label(); reload(); };
    const head = document.createElement('div');
    head.className = 'country-pop-head';
    const reset = document.createElement('button');
    reset.className = 'country-clear';
    reset.type = 'button';
    reset.textContent = 'Reset';
    head.append('Entities', reset);
    pop.append(head);
    const search = addPopSearch(pop);
    const cbs = new Map();
    for (const [v, name] of list) {
      const row = document.createElement('label');
      row.className = 'country-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = sel.has(v);
      cb.addEventListener('change', () => {
        // The chart must keep at least one series.
        if (!cb.checked && sel.size === 1) {
          cb.checked = true;
          return;
        }
        cb.checked ? sel.add(v) : sel.delete(v);
        emit();
      });
      row.append(cb, name);
      pop.append(row);
      cbs.set(v, cb);
    }
    // Reset returns to just the def's default entity — the selection
    // can't be empty, so 'Clear'-all semantics don't apply here.
    reset.addEventListener('click', () => {
      sel.clear();
      sel.add(fallback());
      cbs.forEach((cb, v) => { cb.checked = sel.has(v); });
      emit();
    });
    btn.addEventListener('click', () => {
      pop.hidden = !pop.hidden;
      if (!pop.hidden) search.focus();
    });
    label();
    wrap.append(btn, pop);
    return wrap;
  },
};

// Some filters can't apply to the 'all' scope — e.g. a site's lifetime
// totals have no rocket attribution — so defs list which non-year
// filters remain via allScopeFilters; the rest hide while 'all' is
// active. mountPane tags each control with data-filter so this knows
// which is which; the year seg itself always stays.
function applyScopeFilters(slot) {
  const def = CHART_DEFS[slot.defId];
  [...slot.controlsEl.children].forEach(el => {
    el.hidden = slot.filters.year === 'all' &&
      !!def.allScopeFilters &&
      el.dataset.filter !== 'year' &&
      !def.allScopeFilters.includes(el.dataset.filter);
  });
}

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
