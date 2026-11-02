// Chart registry: CHART_DEFS declares every chart the UI can show (the
// comment above it spells out the def contract), plus the data-slicing
// helpers the defs' data() functions share. A classic script — uses
// STATS from stats.js and the factories/views from chart-factories.js;
// load order is JS_FILES in pipeline/config.py.
// The year picker's all-time option: a scope value no year can
// collide with, resolved by yearRows into the sum of every yearly
// bucket.
const ALL_TIME = 'all';

// Recursively adds one bucket tree into another — cat rows sit one
// level deep in the flat buckets (rockets/manufacturers/countries)
// and two in the nested ones (sites/families).
const addRows = (dst, src) => {
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'object') addRows(dst[k] ??= {}, v);
    else dst[k] = (dst[k] || 0) + v;
  }
  return dst;
};

// A bucket summed across every fetched year, re-sorted by total like
// the stats build's per-year buckets. Sites/families merge into the
// nested shape ({outer: {rocket: cats}}) that topNested orders.
const allRows = key => {
  const merged = Object.values(STATS.yearly)
    .reduce((acc, b) => addRows(acc, b[key]), {});
  const nested = Object.values(merged)
    .some(row => typeof Object.values(row)[0] === 'object');
  return (nested ? topNested : topCat)(merged);
};

// Scope lookup shared by chart defs: a year reads that year's bucket
// (missing keys -> empty chart); ALL_TIME sums the whole window.
const yearRows = (key, year) =>
  year === ALL_TIME ? allRows(key) : STATS.yearly[year]?.[key] ?? {};

// Entity pickers list everything chartable in the fetched window — the
// union of yearly bucket keys, which only exist for names that flew.
const windowedNames = key =>
  [...new Set(Object.values(STATS.yearly)
    .flatMap(bucket => Object.keys(bucket[key])))];

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

// Restrict {name: counts} rows to rockets that can reach orbit —
// STATS.orbitCapable decides (a positive LEO capacity or an orbital
// launch on record). Capability is a rocket property, so the check
// ignores the year scope.
const applyOrbitFilter = (rows, on) => !on ? rows
  : Object.fromEntries(Object.entries(rows)
      .filter(([name]) => STATS.orbitCapable.has(name)));

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
  entityOptions(windowedNames('rockets').map(k => [k, k]));

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
// `label`/`column` its UI names, `plural` the trend entity popover's
// heading, `names` the optional tooltip map, `countryMap` the
// label->code map a country filter offers, `entities` the
// [value, label] pairs feeding the 'entity' popover (trends) or
// 'rocket' filter (site charts), and `rows` the filter-state ->
// {name: counts} mapping shared by its bar and donut views.
const GROUPS = {
  // The 'orbital' toggle drops non-orbit-capable rockets; it rides in
  // this group's filters so both its bar and donut views offer it —
  // trendDef builds its own filter list and is unaffected.
  rocket:       {key: 'rockets', label: 'Rocket', plural: 'Rockets', column: 'Rocket', filters: ['country', 'orbital'], countryMap: ROCKET_COUNTRIES,
                 rows: s => applyOrbitFilter(applyCountryFilter(yearRows('rockets', s.year), s.country, ROCKET_COUNTRIES),
                   s.orbitCapable)},
  manufacturer: {key: 'manufacturers', label: 'Manufacturer', plural: 'Manufacturers', column: 'Manufacturer', names: STATS.manufacturerNames,
                 filters: ['country'], countryMap: MFR_COUNTRIES, rows: s => applyCountryFilter(yearRows('manufacturers', s.year), s.country, MFR_COUNTRIES)},
  country:      {key: 'countries', label: 'Country', plural: 'Countries', column: 'Country', names: STATS.countryNames, filters: [],
                 rows: s => yearRows('countries', s.year)},
  // The 'rocket' filter re-aggregates a site's rows by which rockets
  // flew from it.
  site:         {key: 'sites', label: 'Launch site', column: 'Site', names: STATS.siteNames, filters: ['rocket'],
                 entities: rocketEntities, rows: s => siteRows(yearRows('sites', s.year), s.rockets)},
};

// The three chart views a grouping supports share one def contract
// (the comment on CHART_DEFS): Bars pages a stacked category chart,
// Donut flattens rows to {label: count} slices, Trend charts one
// series per entity pick.
const barDef = g => ({label: g.label, kind: 'Bars', filters: ['year', ...g.filters, 'pageSize'], countryMap: g.countryMap,
                      entities: g.entities, unit: 'launches', data: g.rows,
                      mount: pane => stackedBarChart(pane.querySelector('canvas'), g.names)});
const donutDef = g => ({label: g.label, kind: 'Donuts', filters: ['year', ...g.filters, 'success'], countryMap: g.countryMap,
                        entities: g.entities, data: s => donutSlices(g.rows(s), s.successOnly),
                        mount: pane => donutChart(pane, g.names, g.column)});
const trendDef = g => ({label: g.label, kind: 'Trends', plural: g.plural, filters: ['entity', 'success', 'cumulative'], unit: 'launches',
                        // {entity: {year: count}} rows bound the shared axis on the largest
                        // single point, not a row total.
                        rowMax: series => Math.max(0, ...Object.values(series)),
                        entities: () => entityOptions(windowedNames(g.key).map(k => [k, g.names?.[k] || k])),
                        data: trendData(g.key),
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
// entities, rockets, orbitCapable} to its dataset ('pageSize' lives there too but
// configures the paged view, not the data), and mounts a chart object
// inside
// a .chart-pane — the pager shows only when the instance's pageCount()
// exceeds 1. Optional def fields: `countryMap` picks the label->code
// map the country filter lists, and `rowMax` overrides rowTotal when a
// def's data rows need a different syncAxes bound. Defs can also
// provide `entities` — [value, label] pairs feeding the 'entity'
// popover (trends) or the 'rocket' filter (site charts).
const CHART_DEFS = {
  'by-rocket': barDef(GROUPS.rocket),
  'by-rocket-family': variantBarDef('Rocket family',
    s => yearRows('families', s.year)),
  // Manufacturer bars regroup the flat rockets bucket into
  // {mfr: {rocket: cats}} via the stats map — no nested yearly bucket
  // needed.
  'by-manufacturer': variantBarDef('Manufacturer',
    s => rocketsByMfr(yearRows('rockets', s.year)),
    {filters: ['country'], countryMap: MFR_COUNTRIES,
     names: STATS.manufacturerNames}),
  'by-country': barDef(GROUPS.country),
  // Sites get the variant stack too — the bucket is already nested
  // {site: {rocket: cats}}, and the rocket filter subsets which
  // rockets feed each site in either stack mode.
  'by-site': variantBarDef('Launch site',
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
