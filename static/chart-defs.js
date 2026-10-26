// Chart registry: CHART_DEFS declares every chart the UI can show (the
// comment above it spells out the def contract), plus the data-slicing
// helpers the defs' data() functions share. A classic script — uses
// STATS from stats.js and the factories/views from chart-factories.js;
// load order is JS_FILES in pipeline/config.py.
// Scope lookup shared by chart defs: a year reads that year's bucket
// (missing keys -> empty chart).
const yearRows = (key, year) => STATS.yearly[year]?.[key] ?? {};

// Entity pickers list everything chartable in the fetched window — the
// union of yearly bucket keys, with a per-name launch total so a def's
// defaultEntity can pick the most-launched entry.
const topWindowed = key =>
  Object.entries(windowTotals(key)).sort((a, b) => b[1] - a[1])[0]?.[0];

const windowTotals = key => {
  const totals = {};
  for (const bucket of Object.values(STATS.yearly))
    for (const [name, row] of Object.entries(bucket[key]))
      totals[name] = (totals[name] || 0) + rowTotal(row);
  return totals;
};

// Label -> country code maps from the stats build, one per grouping;
// the right map is whichever resolves the chart's own labels.
const ROCKET_COUNTRIES = STATS.rocketCountries;
const MFR_COUNTRIES = STATS.manufacturerCountries;

// Restrict a {name: counts} dataset to labels whose country is (or, when
// negated, is not) among the selected codes. An empty selection filters
// nothing. map resolves each label to a code — rockets by name,
// manufacturers by abbrev, sites by short name.
const applyCountryFilter = (data, sel, map = ROCKET_COUNTRIES) => {
  if (!sel || !sel.codes.size) return data;
  return Object.fromEntries(Object.entries(data)
    .filter(([name]) => sel.codes.has(map[name]) !== sel.negate));
};

// Donut defs share the bar charts' categorized rows but need flat
// {label: count} slices: total each row, dropping 'failed' when the
// Successes-only filter is on.
const donutSlices = (rows, successOnly) => Object.fromEntries(
  Object.entries(rows).map(([k, row]) =>
    [k, successOnly ? rowTotal(row) - (row.failed || 0) : rowTotal(row)]));

// Trend defs chart one series per selected entity (a rocket name,
// manufacturer abbrev, or country code) as {entity: {year: count}},
// re-sliced from that group's yearly buckets chronologically — JS
// orders the integer-like year keys ascending, so .sort() walks them
// oldest to newest. `successOnly` drops the failed segment;
// `cumulative` turns each series into a running total.
const trendData = groupKey => s => {
  const out = {};
  for (const entity of s.entities) {
    let acc = 0;
    out[entity] = {};
    for (const year of Object.keys(STATS.yearly).sort()) {
      const row = STATS.yearly[year][groupKey][entity];
      const total = rowTotal(row) || 0;
      const count = s.successOnly ? total - (row?.failed || 0) : total;
      acc += count;
      out[entity][year] = s.cumulative ? acc : count;
    }
  }
  return out;
};

// Entity pickers sort alphabetically by display label — a 100+ entry
// list ordered by launch count can't be scanned for a name.
const entityOptions = pairs =>
  pairs.sort((a, b) => a[1].localeCompare(b[1]));

// Chartable rockets, alphabetized — the rocket trend's entity popover
// and the site charts' 'rocket' filter share one pick list.
const rocketEntities = () =>
  entityOptions(Object.keys(windowTotals('rockets')).map(k => [k, k]));

// Site rows are nested {site: {rocket: cats}} so a rocket selection can
// subset which rockets feed each site; an empty selection keeps every
// rocket. Sites left with no launches drop out so they don't draw
// zero-height bars — inner keys only exist for rockets with ≥1 launch,
// so non-empty inner means a positive total.
const siteNested = (rows, sel) => Object.fromEntries(
  Object.entries(rows).map(([site, perRocket]) => [site, sel.size
    ? Object.fromEntries(Object.entries(perRocket)
        .filter(([name]) => sel.has(name)))
    : perRocket])
    .filter(([, perRocket]) => Object.keys(perRocket).length));

// Flat site rows are the nested ones summed through familyRows' flat
// mode — the variantStack=false branch does exactly this aggregation.
const siteRows = (rows, sel) => familyRows(siteNested(rows, sel), false);

// {mfr: {rocket: cats}} — re-slices the flat rockets rows through the
// rocket->manufacturer map into the nested shape familyRows reads, so
// the manufacturer chart gets the same category/variant stack swap
// without its own nested yearly bucket. Rockets with no resolvable
// manufacturer drop out, as they always have in that grouping.
const rocketsByMfr = rows => {
  const out = {};
  for (const [name, cats] of Object.entries(rows)) {
    const mfr = STATS.rocketManufacturers[name];
    if (mfr) (out[mfr] ??= {})[name] = cats;
  }
  return out;
};

// Family rows are nested {family: {rocket: cats}} like site rows so the
// 'variant' toggle can swap the stack: off, each family's rockets sum
// into the usual orbital/suborbital/failed split; on, each rocket
// becomes its own stack segment — the full config name stands in for
// the variant since the API's bare variant token isn't unique.
const familyRows = (rows, byVariant) => Object.fromEntries(
  Object.entries(rows).map(([fam, perRocket]) => {
    const out = {};
    for (const [variant, cats] of Object.entries(perRocket)) {
      if (byVariant) out[variant] = (out[variant] || 0) + rowTotal(cats);
      else for (const [cat, n] of Object.entries(cats))
        out[cat] = (out[cat] || 0) + n;
    }
    return [fam, out];
  }));

// Every charted grouping declared once: `key` is its yearly bucket,
// `label`/`column` its UI names, `names` the optional tooltip map,
// `countryMap` the label->code map a country filter offers, `entities`
// the [value, label] pairs feeding the 'entity' popover (trends) or
// 'rocket' filter (site charts), and `rows` the filter-state ->
// {name: counts} mapping shared by its bar and donut views.
const GROUPS = {
  rocket:       {key: 'rockets', label: 'By rocket', column: 'Rocket', filters: ['country'], countryMap: ROCKET_COUNTRIES,
                 rows: s => applyCountryFilter(yearRows('rockets', s.year), s.country, ROCKET_COUNTRIES)},
  manufacturer: {key: 'manufacturers', label: 'By manufacturer', column: 'Manufacturer', names: STATS.manufacturerNames,
                 filters: ['country'], countryMap: MFR_COUNTRIES, rows: s => applyCountryFilter(yearRows('manufacturers', s.year), s.country, MFR_COUNTRIES)},
  country:      {key: 'countries', label: 'By country', column: 'Country', names: STATS.countryNames, filters: [],
                 rows: s => yearRows('countries', s.year)},
  // The 'rocket' filter re-aggregates a site's rows by which rockets
  // flew from it.
  site:         {key: 'sites', label: 'By launch site', column: 'Site', names: STATS.siteNames, filters: ['rocket'],
                 entities: rocketEntities, rows: s => siteRows(yearRows('sites', s.year), s.rockets)},
};

// The three chart views a grouping supports share one def contract
// (the comment on CHART_DEFS): Bars pages a stacked category chart,
// Donut flattens rows to {label: count} slices, Trend charts one
// series per entity pick.
const barDef = g => ({label: g.label, kind: 'Bars', filters: ['year', ...g.filters, 'pageSize'], countryMap: g.countryMap,
                      entities: g.entities, unit: 'launches', data: g.rows,
                      mount: pane => stackedBarChart(pane.querySelector('canvas'), g.names)});
const donutDef = g => ({label: g.label, kind: 'Donut', filters: ['year', ...g.filters, 'success'], countryMap: g.countryMap,
                        entities: g.entities, data: s => donutSlices(g.rows(s), s.successOnly),
                        mount: pane => donutChart(pane, g.names, g.column)});
const trendDef = g => ({label: g.label, kind: 'Trend', filters: ['entity', 'success', 'cumulative'], unit: 'launches',
                        // {entity: {year: count}} rows bound the shared axis on the largest
                        // single point, not a row total.
                        rowMax: series => Math.max(0, ...Object.values(series)),
                        entities: () => entityOptions(Object.keys(windowTotals(g.key)).map(k => [k, g.names?.[k] || k])),
                        defaultEntity: topWindowed(g.key), data: trendData(g.key),
                        mount: pane => lineChart(pane.querySelector('canvas'), g.names)});

// Bars def for a grouping that can swap its stack between launch
// categories and per-variant segments. `nested` maps filter state to
// {group: {rocket: cats}} rows. The country filter applies only when
// the def opts in: a pane's country picks persist across defs, so an
// unconditional filter would wrongly prune charts that never offer it.
// topCat re-sorts regrouped rows by total like the stats build's
// bucket order.
const variantBarDef = (label, nested, {filters = [], countryMap, names, entities} = {}) => ({
  label, kind: 'Bars',
  filters: ['year', ...filters, 'variant', 'pageSize'],
  countryMap, entities, unit: 'launches',
  data: s => {
    let rows = nested(s);
    if (countryMap) rows = applyCountryFilter(rows, s.country, countryMap);
    return topCat(familyRows(rows, s.variantStack));
  },
  mount: pane => stackedBarChart(pane.querySelector('canvas'), names),
});

// Registry of every chart a pane can show — workspace.js merges in the
// table views to build the pickers. `kind` groups the picker's options
// under an optgroup heading. Each def lists the filters it supports
// (each name renders a control in the pane header), maps a filter-state
// object {year, country, successOnly, cumulative, variantStack,
// entities, rockets} to its dataset ('pageSize' lives there too but
// configures the paged view, not the data), and mounts a chart object
// inside
// a .chart-pane — the pager shows only when the instance's pageCount()
// exceeds 1. Optional def fields: `countryMap` picks the label->code
// map the country filter lists, and `rowMax` overrides rowTotal when a
// def's data rows need a different syncAxes bound. Defs can also
// provide `entities` — [value, label] pairs feeding the 'entity'
// popover (trends) or the 'rocket' filter (site charts) — and
// `defaultEntity`, the trend picker's most-launched fallback.
const CHART_DEFS = {
  'by-rocket': barDef(GROUPS.rocket),
  'by-rocket-family': variantBarDef('By rocket family',
    s => yearRows('families', s.year)),
  // Manufacturer bars regroup the flat rockets bucket into
  // {mfr: {rocket: cats}} via the stats map — no nested yearly bucket
  // needed.
  'by-manufacturer': variantBarDef('By manufacturer',
    s => rocketsByMfr(yearRows('rockets', s.year)),
    {filters: ['country'], countryMap: MFR_COUNTRIES,
     names: STATS.manufacturerNames}),
  'by-country': barDef(GROUPS.country),
  // Sites get the variant stack too — the bucket is already nested
  // {site: {rocket: cats}}, and the rocket filter subsets which
  // rockets feed each site in either stack mode.
  'by-site': variantBarDef('By launch site',
    s => siteNested(yearRows('sites', s.year), s.rockets),
    {filters: ['rocket'], names: STATS.siteNames, entities: rocketEntities}),
  'by-rocket-donut': donutDef(GROUPS.rocket),
  'by-manufacturer-donut': donutDef(GROUPS.manufacturer),
  'by-country-donut': donutDef(GROUPS.country),
  'by-site-donut': donutDef(GROUPS.site),
  'by-rocket-trend': trendDef(GROUPS.rocket),
  'by-manufacturer-trend': trendDef(GROUPS.manufacturer),
  'by-country-trend': trendDef(GROUPS.country),
};
