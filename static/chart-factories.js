// Chart.js chart factories — each builds a Chart plus a view object
// with a uniform {chart, page, pageCount, setPage, setData} contract,
// used by the defs in chart-defs.js. A classic script, not a module,
// so file:// previews and the offline build work — it shares app.js's
// esc() and the global Chart from chart-library.min.js; load order is
// JS_FILES in pipeline/config.py.
Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#1f2937';

// Default rows per chart page; the 'pageSize' filter offers every
// PAGE_SIZES value — controls persist it, so the default stays the
// restore fallback rather than the only choice.
const PAGE_SIZE = 10;
const PAGE_SIZES = [5, 10, 20, 30, 50];

// Paging wrapper shared by the chart factories: slices a {label: row}
// dataset pageSize rows at a time and lets `fill` load the visible rows
// into the chart's datasets. The caller hides the pager when
// pageCount() is 1.
function pagedView(chart, fill) {
  let full = {}, page = 0, pageSize = PAGE_SIZE;
  const pageCount = () =>
    Math.max(1, Math.ceil(Object.keys(full).length / pageSize));
  const setPage = p => {
    page = Math.max(0, Math.min(p, pageCount() - 1));
    const entries = Object.entries(full)
      .slice(page * pageSize, (page + 1) * pageSize);
    chart.data.labels = entries.map(([k]) => k);
    fill(entries);
    chart.update();
  };
  // A size change keeps the current page (clamped to the new count);
  // the next setData resets to page 0 anyway.
  const setPageSize = n => { pageSize = n; setPage(page); };
  const setData = d => { full = d; setPage(0); };
  return {chart, get page() { return page; }, pageCount, setPage,
    setPageSize, setData};
}

// Non-paged charts share the same one-page contract so slot code treats
// every instance alike (pager hides when pageCount() is 1); fill loads
// the rows into the chart's datasets.
function singleView(chart, fill) {
  const setData = d => {
    const entries = Object.entries(d);
    chart.data.labels = entries.map(([k]) => k);
    fill(entries);
    chart.update();
  };
  return {chart, setData, get page() { return 0; },
    pageCount: () => 1, setPage() {}, setPageSize() {}};
}

// Chart labels are abbreviations; tooltips show the full name.
const tooltipNames = fullNames => fullNames ? {callbacks: {
  title: items => fullNames[items[0].label] || items[0].label,
}} : {};

// A dataset row is either a plain count or a {category: count} dict.
const rowTotal = v => (v && typeof v === 'object')
  ? Object.values(v).reduce((a, b) => a + b, 0) : v;

// Segment keys a stacked row may carry, in stack order (failures always
// on top). All yearly rows stack orbital/suborbital/failed; 'success'
// and 'total' are fallbacks for flat single-segment series.
const SEGMENTS = {
  success:    {label: 'Success',    color: '#4ade80'},
  orbital:    {label: 'Orbital',    color: '#6ea8fe'},
  suborbital: {label: 'Suborbital', color: '#fbbf24'},
  failed:     {label: 'Failed',     color: '#f87171'},
  total:      {label: 'Total',      color: '#6ea8fe'},
};
const SEGMENT_ORDER = ['success', 'orbital', 'suborbital', 'failed',
                       'total'];

// Draws each bar's segment counts above its top segment (Chart.js has
// no built-in data labels), comma-separated and colored to match the
// legend. Bars too narrow for the text are skipped so dense pages stay
// legible; layout.padding.top leaves room for the label.
const stackTotals = {
  id: 'stackTotals',
  afterDatasetsDraw(chart) {
    const n = chart.data.datasets.length;
    const meta = n && chart.getDatasetMeta(n - 1);
    if (!meta?.data?.length) return;
    const {ctx} = chart;
    ctx.save();
    ctx.font = `11px ${Chart.defaults.font.family}`;
    ctx.textAlign = 'left';
    const sepW = ctx.measureText(', ').width;
    meta.data.forEach((bar, i) => {
      // Empty segments are skipped — in the family chart's variant
      // stacking a bar uses only a few of the datasets, so printing
      // zeros would produce a long unreadable list.
      const parts = chart.data.datasets.map(ds =>
        ({v: ds.data[i] || 0, color: ds.backgroundColor}))
        .filter(p => p.v > 0);
      if (!parts.length) return;
      const widths = parts.map(p => ctx.measureText(String(p.v)).width);
      const totalW = widths.reduce((a, b) => a + b, sepW * (parts.length - 1));
      if (bar.width + 8 < totalW) return;
      const y = Math.min(bar.y, bar.base) - 4;
      let x = bar.x - totalW / 2;
      parts.forEach((p, j) => {
        ctx.fillStyle = p.color;
        ctx.fillText(p.v, x, y);
        x += widths[j] + sepW;
      });
    });
    ctx.restore();
  },
};

function stackedBarChart(canvas, fullNames) {
  const names = tooltipNames(fullNames);
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {labels: [], datasets: []},
    options: {
      maintainAspectRatio: false,
      layout: {padding: {top: 18}},
      // index mode + intersect:false makes the whole bar column a hover
      // target, so even a 1-count failure segment shows its tooltip.
      interaction: {mode: 'index', intersect: false},
      scales: {
        x: {stacked: true},
        y: {stacked: true, ticks: {precision: 0}},
      },
      plugins: {
        legend: {position: 'bottom'},
        tooltip: {
          ...names,
          // A bar only uses a few of the variant datasets; dropping
          // zero-value items keeps the tooltip to its real segments.
          filter: item => item.parsed.y > 0,
          callbacks: {
            ...names.callbacks,
            footer: items => 'Total: ' + items.reduce((s, i) => s + i.parsed.y, 0),
          },
        },
      },
    },
    plugins: [stackTotals],
  });
  let keys = [], dynamic = false;
  const view = pagedView(chart, entries => {
    chart.data.datasets.forEach((ds, i) => {
      ds.data = entries.map(([, v]) => v[keys[i]] || 0);
    });
  });
  const setData = view.setData;
  // Rebuild the dataset list from whichever keys the rows carry, so
  // the legend only names what's actually shown. Rows keyed by
  // SEGMENT_ORDER (launch categories) get their fixed labels and
  // colors; any other key set — the family chart's variant stacking —
  // gets one palette-colored dataset each, ordered by total so the
  // biggest variants anchor the stack.
  view.setData = d => {
    const present = new Set(Object.values(d).flatMap(Object.keys));
    keys = SEGMENT_ORDER.filter(k => present.has(k));
    dynamic = !keys.length && present.size > 0;
    // Variant stacking has a dataset per variant (100+) — too many for
    // a useful legend, so it hides; filtered tooltips and the colored
    // segment counts name what each bar actually contains.
    chart.options.plugins.legend.display = !dynamic;
    if (dynamic) {
      const totals = {};
      for (const row of Object.values(d))
        for (const [k, n] of Object.entries(row))
          totals[k] = (totals[k] || 0) + n;
      keys = Object.keys(totals)
        .sort((a, b) => totals[b] - totals[a] || a.localeCompare(b));
    }
    chart.data.datasets = keys.map((k, i) => ({
      label: SEGMENTS[k]?.label || k,
      data: [],
      backgroundColor: SEGMENTS[k]?.color ||
        LINE_COLORS[i % LINE_COLORS.length],
    }));
    setData(d);
  };
  return view;
}

// Donut: top slices get wedges, the tail collapses into 'Other' — with
// 100+ rockets a slice per row is unreadable. The color list is one
// longer than the wedge count so 'Other' always lands on neutral gray.
const DONUT_TOP = 10;
const DONUT_COLORS = ['#6ea8fe', '#4ade80', '#a78bfa', '#fbbf24',
  '#f87171', '#38bdf8', '#fb923c', '#34d399', '#e879f9', '#a3a3a3',
  '#6b7280'];

// Doughnut + percentage table mounted inside a chart pane. Returns no
// pageCount, so the slot pager hides itself; the scrollable table is
// the complete legend since the donut can't label every slice.
function donutChart(pane, fullNames, group) {
  pane.classList.add('donut-pane');
  pane.innerHTML =
    '<div class="donut-figure"><canvas></canvas></div>' +
    '<div class="donut-table-wrap"></div>';
  const tableWrap = pane.querySelector('.donut-table-wrap');
  let total = 0;
  const names = tooltipNames(fullNames);
  const chart = new Chart(pane.querySelector('canvas'), {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: DONUT_COLORS,
        borderWidth: 0,
      }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {display: false},  // the table is the legend
        tooltip: {
          ...names,
          callbacks: {
            ...names.callbacks,
            label: it => ` ${it.parsed.toLocaleString()} ` +
              `(${total ? (it.parsed / total * 100).toFixed(1) : '0.0'}%)`,
          },
        },
      },
    },
  });
  return singleView(chart, entries => {
    const positive = entries.filter(([, v]) => v > 0);
    total = positive.reduce((s, [, v]) => s + v, 0);
    const other = positive.slice(DONUT_TOP).reduce((s, [, v]) => s + v, 0);
    const slices = other
      ? [...positive.slice(0, DONUT_TOP), ['Other', other]]
      : positive.slice(0, DONUT_TOP);
    chart.data.labels = slices.map(([k]) => k);
    chart.data.datasets[0].data = slices.map(([, v]) => v);
    tableWrap.innerHTML = total
      ? `<table class="donut-table"><thead>
           <tr><th>${esc(group)}</th><th>#</th><th>%</th></tr>
         </thead><tbody>${positive.map(([k, v]) => `
           <tr><td>${esc(fullNames?.[k] || k)}</td>
               <td>${v.toLocaleString()}</td>
               <td>${(v / total * 100).toFixed(1)}</td></tr>`).join('')}
         </tbody><tfoot>
           <tr><td>Total</td><td>${total.toLocaleString()}</td>
               <td>100</td></tr>
         </tfoot></table>`
      : '<p class="donut-empty">No launches in this selection.</p>';
  });
}

// Series colors for multi-entity lines — the donut's chromatic palette
// minus its neutral 'Other' tail.
const LINE_COLORS = DONUT_COLORS.slice(0, -2);

// Line chart over {entity: {x: count}} series — currently launches per
// year for the entities picked in the slot's entity filter. A single
// series gets an area fill and no legend; multiple series split into
// colored lines with a bottom legend. fullNames resolves entity keys
// to display names like the other factories.
function lineChart(canvas, fullNames) {
  const chart = new Chart(canvas, {
    type: 'line',
    data: {labels: [], datasets: []},
    options: {
      maintainAspectRatio: false,
      interaction: {mode: 'index', intersect: false},
      scales: {
        y: {beginAtZero: true, ticks: {precision: 0}},
      },
      plugins: {legend: {display: false, position: 'bottom'}},
    },
  });
  return singleView(chart, entries => {
    // X labels are the union of every series' keys, sorted — entity
    // picks with no launches in a year still get a point at 0.
    const years = [...new Set(entries.flatMap(([, s]) => Object.keys(s)))]
      .sort();
    chart.data.labels = years;
    const multi = entries.length > 1;
    chart.data.datasets = entries.map(([key, series], i) => ({
      label: fullNames?.[key] || key,
      data: years.map(y => series[y] ?? 0),
      borderColor: LINE_COLORS[i % LINE_COLORS.length],
      backgroundColor: multi ? LINE_COLORS[i % LINE_COLORS.length]
                             : 'rgba(110, 168, 254, 0.15)',
      fill: !multi,
      pointRadius: 3,
      tension: 0.25,
    }));
    chart.options.plugins.legend.display = multi;
  });
}
