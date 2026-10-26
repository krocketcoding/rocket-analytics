// Chart registry: CHART_DEFS declares every chart the UI can show (the
// comment above it spells out the def contract), plus the data-slicing
// helpers the defs' data() functions share. A classic script — uses
// STATS from app.js and the factories/views from chart-factories.js;
// load order is JS_FILES in pipeline/config.py.
// Scope lookup shared by chart defs: 'all' reads the lifetime stats key,
// a year reads that year's bucket (missing keys -> empty chart; site
// charts have no 'all' dataset at all).
const scopedData = (allKey, yearKey) => year =>
  year === 'all' ? STATS[allKey] ?? {} : STATS.yearly[year]?.[yearKey] ?? {};

// Label -> country code maps from the stats build, one per grouping;
// the right map is whichever resolves the chart's own labels.
const ROCKET_COUNTRIES = STATS.rocket_countries || {};
const MFR_COUNTRIES = STATS.manufacturer_countries || {};

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
// re-sliced from that group's yearly buckets chronologically — yearly
// keys arrive newest-first. `successOnly` drops the failed segment;
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
  entityOptions(Object.keys(STATS.by_rocket).map(k => [k, k]));

// The API's lifetime site counts are flat numbers — wrap each as a
// single 'total' segment so the stacked-bar machinery accepts them;
// the donut slices them flat.
const siteTotalRows = () => Object.fromEntries(
  Object.entries(STATS.site_totals || {})
    .map(([site, n]) => [site, {total: n}]));

// Site rows are nested {site: {rocket: cats}} so a rocket selection can
// re-aggregate them; an empty selection sums every rocket. Sites left
// with no launches drop out so they don't draw zero-height bars.
const siteRows = (rows, sel) => Object.fromEntries(
  Object.entries(rows).map(([site, perRocket]) => {
    const cats = {};
    for (const name of sel.size ? sel : Object.keys(perRocket)) {
      for (const [cat, n] of Object.entries(perRocket[name] || {}))
        cats[cat] = (cats[cat] || 0) + n;
    }
    return [site, cats];
  }).filter(([, cats]) => rowTotal(cats) > 0));

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

// Registry of every chart a pane can show — workspace.js merges in the
// table views to build the pickers. `kind` groups the picker's options
// under an optgroup heading. Each def lists the filters it supports
// (each name renders a control in the pane header), maps a filter-state
// object {year, country, successOnly, cumulative, variantStack,
// entities, rockets} to its dataset, and mounts a chart object inside
// a .chart-pane — the pager shows only when the instance's pageCount()
// exceeds 1. Optional def fields: `allScopeFilters` lists which
// non-year filters stay visible in the 'all' scope (site lifetime
// totals can't be split by rocket or success, so site defs pass []),
// `yearsOnly` drops the 'all' scope entirely (defs without a lifetime
// dataset), `countryMap` picks the label->code map the country filter
// lists, and `rowMax` overrides rowTotal when a def's data rows need a
// different syncAxes bound. Defs can also provide `entities` —
// [value, label] pairs feeding the 'entity' popover (trends) or the
// 'rocket' filter (site charts) — and `defaultEntity`, the trend
// picker's most-launched fallback.
const CHART_DEFS = {
  'by-rocket': {
    label: 'By rocket',
    kind: 'Bars',
    filters: ['year', 'country'],
    countryMap: ROCKET_COUNTRIES,
    unit: 'launches',
    data: s => applyCountryFilter(
      scopedData('by_rocket', 'rockets')(s.year), s.country),
    mount: pane => stackedBarChart(pane.querySelector('canvas')),
  },
  'by-rocket-family': {
    label: 'By rocket family',
    kind: 'Bars',
    yearsOnly: true,
    filters: ['year', 'variant'],
    unit: 'launches',
    data: s => familyRows(
      scopedData('by_family', 'families')(s.year), s.variantStack),
    mount: pane => stackedBarChart(pane.querySelector('canvas')),
  },
  'by-manufacturer': {
    label: 'By manufacturer',
    kind: 'Bars',
    filters: ['year', 'country'],
    countryMap: MFR_COUNTRIES,
    unit: 'launches',
    data: s => applyCountryFilter(
      scopedData('by_manufacturer', 'manufacturers')(s.year), s.country,
      MFR_COUNTRIES),
    mount: pane => stackedBarChart(pane.querySelector('canvas'), STATS.manufacturer_names),
  },
  'by-country': {
    label: 'By country',
    kind: 'Bars',
    filters: ['year'],
    unit: 'launches',
    data: s => scopedData('by_country', 'countries')(s.year),
    mount: pane => stackedBarChart(pane.querySelector('canvas'), STATS.country_names),
  },
  // 'all' for sites is the API's true lifetime total per site — a flat
  // count with no category or rocket breakdown, so the rocket filter
  // hides in that scope. Year scopes keep the stacked split and the
  // 'rocket' filter ("which rockets fly from here").
  'by-site': {
    label: 'By launch site',
    kind: 'Bars',
    allScopeFilters: [],
    filters: ['year', 'rocket'],
    unit: 'launches',
    entities: rocketEntities,
    data: s => s.year === 'all' ? siteTotalRows()
      : siteRows(scopedData('by_site', 'sites')(s.year), s.rockets),
    mount: pane => stackedBarChart(pane.querySelector('canvas'), STATS.site_names),
  },
  'by-rocket-donut': {
    label: 'By rocket',
    kind: 'Donut',
    filters: ['year', 'country', 'success'],
    countryMap: ROCKET_COUNTRIES,
    data: s => applyCountryFilter(donutSlices(
      scopedData('by_rocket', 'rockets')(s.year), s.successOnly), s.country),
    mount: pane => donutChart(pane, null, 'Rocket'),
  },
  'by-manufacturer-donut': {
    label: 'By manufacturer',
    kind: 'Donut',
    filters: ['year', 'country', 'success'],
    countryMap: MFR_COUNTRIES,
    data: s => applyCountryFilter(donutSlices(
      scopedData('by_manufacturer', 'manufacturers')(s.year), s.successOnly),
      s.country, MFR_COUNTRIES),
    mount: pane => donutChart(pane, STATS.manufacturer_names, 'Manufacturer'),
  },
  'by-country-donut': {
    label: 'By country',
    kind: 'Donut',
    filters: ['year', 'success'],
    data: s => donutSlices(
      scopedData('by_country', 'countries')(s.year), s.successOnly),
    mount: pane => donutChart(pane, STATS.country_names, 'Country'),
  },
  'by-site-donut': {
    label: 'By launch site',
    kind: 'Donut',
    allScopeFilters: [],
    filters: ['year', 'rocket', 'success'],
    entities: rocketEntities,
    data: s => s.year === 'all' ? (STATS.site_totals || {})
      : donutSlices(
          siteRows(scopedData('by_site', 'sites')(s.year), s.rockets),
          s.successOnly),
    mount: pane => donutChart(pane, STATS.site_names, 'Site'),
  },
  'by-rocket-trend': {
    label: 'By rocket',
    kind: 'Trend',
    filters: ['entity', 'success', 'cumulative'],
    unit: 'launches',
    // {entity: {year: count}} rows bound the shared axis on the largest
    // single point, not a row total.
    rowMax: series => Math.max(0, ...Object.values(series)),
    entities: rocketEntities,
    defaultEntity: Object.keys(STATS.by_rocket)[0],
    data: trendData('rockets'),
    mount: pane => lineChart(pane.querySelector('canvas')),
  },
  'by-manufacturer-trend': {
    label: 'By manufacturer',
    kind: 'Trend',
    filters: ['entity', 'success', 'cumulative'],
    unit: 'launches',
    rowMax: series => Math.max(0, ...Object.values(series)),
    entities: () => entityOptions(Object.keys(STATS.by_manufacturer)
      .map(k => [k, STATS.manufacturer_names[k] || k])),
    defaultEntity: Object.keys(STATS.by_manufacturer)[0],
    data: trendData('manufacturers'),
    mount: pane =>
      lineChart(pane.querySelector('canvas'), STATS.manufacturer_names),
  },
  'by-country-trend': {
    label: 'By country',
    kind: 'Trend',
    filters: ['entity', 'success', 'cumulative'],
    unit: 'launches',
    rowMax: series => Math.max(0, ...Object.values(series)),
    entities: () => entityOptions(Object.keys(STATS.by_country)
      .map(k => [k, STATS.country_names[k] || k])),
    defaultEntity: Object.keys(STATS.by_country)[0],
    data: trendData('countries'),
    mount: pane =>
      lineChart(pane.querySelector('canvas'), STATS.country_names),
  },
};
