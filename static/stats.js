// Summary analytics computed in the browser from DATA. The dataset
// ships only per-launch facts — the per-year tallies every chart reads
// (by rocket, family, manufacturer, country, and launch site) are
// derived here once at load into the STATS object the chart defs
// consume. A classic script: loads right after app.js (JS_FILES in
// pipeline/config.py) so DATA exists, and before the chart files that
// read STATS.

// The API reports agency country as an alpha-3 code ('USA') with no name
// field, so chart tooltips resolve codes through this table. Covers every
// code seen in the data, including each member of ESA's compound code.
const COUNTRY_NAMES = {
  USA: 'United States', CHN: 'China', RUS: 'Russia', IND: 'India',
  JPN: 'Japan', KOR: 'South Korea', PRK: 'North Korea', IRN: 'Iran',
  ISR: 'Israel', FRA: 'France', DEU: 'Germany', ITA: 'Italy',
  ESP: 'Spain', GBR: 'United Kingdom', IRL: 'Ireland', PRT: 'Portugal',
  NLD: 'Netherlands', BEL: 'Belgium', LUX: 'Luxembourg',
  CHE: 'Switzerland', AUT: 'Austria', POL: 'Poland', CZE: 'Czechia',
  HUN: 'Hungary', ROU: 'Romania', GRC: 'Greece', DNK: 'Denmark',
  SWE: 'Sweden', NOR: 'Norway', FIN: 'Finland', EST: 'Estonia',
  SVN: 'Slovenia', UKR: 'Ukraine', AUS: 'Australia', NZL: 'New Zealand',
  SGP: 'Singapore', KAZ: 'Kazakhstan', BRA: 'Brazil',
  GUF: 'French Guiana', OMN: 'Oman',
};

// Expand a country code to a name for the chart tooltip.
// A few agencies report comma-separated member states ('AUS,SGP'), so
// each part resolves individually; unlisted codes — and the API's own
// '???' placeholder — read 'Unknown'.
const countryName = code =>
  code.split(',').map(part => COUNTRY_NAMES[part.trim()] || 'Unknown')
    .join(', ');

// Stacked-chart categories: failures are their own segment, and the rest
// split by whether the mission targeted orbit — 'Sub' is the only
// suborbital orbit the API reports (and exactly the launches where
// orbital_launch_attempt_count is null).
const FAILED_ABBREVS = ['Failure', 'Partial Failure'];

const newCat = () => ({orbital: 0, suborbital: 0, failed: 0});

const rowSum = row => Object.values(row).reduce((a, b) => a + b, 0);

// Rows sort by descending total; ties break alphabetically by name —
// the rocket table's final tiebreak (its middle key, LEO capacity,
// isn't part of the cat rows). Name comparison is by code point, not
// locale, so every viewer gets the same order regardless of browser
// language. tables.js reuses this for the rocket table's name tiebreak.
const byName = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// {name: cat dict} -> same shape ordered by descending total.
const topCat = cats => Object.fromEntries(Object.entries(cats)
  .sort(([na, ra], [nb, rb]) => rowSum(rb) - rowSum(ra) || byName(na, nb)));

// {name: {inner: cat dict}} -> same shape ordered by grand total. Only
// the outer keys sort — inner rocket keys keep first-seen order.
const topNested = cats => Object.fromEntries(Object.entries(cats)
  .sort(([na, ra], [nb, rb]) =>
    Object.values(rb).reduce((s, r) => s + rowSum(r), 0)
    - Object.values(ra).reduce((s, r) => s + rowSum(r), 0)
    || byName(na, nb)));

function computeStats(data) {
  // Chart labels use the manufacturer abbreviation; keep the full name
  // around so the frontend can show it too.
  const manufacturerNames = {};
  // Rocket name and manufacturer abbrev -> manufacturer country code,
  // for the charts' country filters.
  const rocketCountries = {};
  const manufacturerCountries = {};
  // Rocket name -> manufacturer chart label, so the manufacturer bars
  // can group the flat rockets bucket into {mfr: {rocket: cats}} like
  // the families bucket for the variant stack toggle.
  const rocketManufacturers = {};
  // Launch-site short name -> full location name, for tooltips.
  const siteNames = {};
  // Tally fetched launches per calendar year. Each year gets a
  // name -> category dict per chart grouping: rockets, manufacturers,
  // countries, launch sites, and rocket families. Sites and families
  // nest one level deeper — {site: {rocket: cats}} so the front end
  // can filter a site's launches by which rocket flew them, and
  // {family: {rocket: cats}} so the family chart can stack by
  // variant instead of by category.
  const perYear = {};
  for (const launch of data.previous) {
    const launchYear = (launch.net || '').slice(0, 4);
    if (!launchYear) continue;
    const cat = FAILED_ABBREVS.includes(data.statuses[launch.status_id]?.abbrev)
      ? 'failed' : launch.orbit === 'Sub' ? 'suborbital' : 'orbital';
    const y = perYear[launchYear] ??= [{}, {}, {}, {}, {}];
    const [rocketCounts, mfrCounts, countryCounts, siteCounts, famCounts] = y;
    const bump = (row, key) => ((row[key] ??= newCat())[cat] += 1);
    const rocket = data.rockets[launch.rocket_id];
    const name = rocket?.name;
    if (name) {
      bump(rocketCounts, name);
      // Configs with no family group under their own name; the
      // segment key is the full config name because the API's bare
      // variant token merges distinct rockets ('A' spans several
      // Long Marches). Gated on name like sites, so family totals
      // can't out-count the rocket grouping.
      bump(famCounts[rocket.family || name] ??= {}, name);
    }
    // The manufacturer is an id into the merged agencies table.
    const manufacturer = data.agencies[rocket?.manufacturer_id];
    if (manufacturer?.name) {
      const label = manufacturer.abbrev || manufacturer.name;
      bump(mfrCounts, label);
      manufacturerNames[label] = manufacturer.name;
    }
    if (manufacturer?.country) bump(countryCounts, manufacturer.country);
    // Site charts group by pad location ("Cape Canaveral SFS, FL, USA"
    // -> "Cape Canaveral SFS"), not individual pads. Short names are
    // unique in the data today; a future collision would merge two
    // sites' counts under one label. The tally is gated on `name` so
    // the site grouping can't out-count the rocket grouping.
    const location = data.locations[data.pads[launch.pad_id]?.location_id];
    if (location?.name) {
      const site = location.name.split(',')[0].trim();
      siteNames[site] = location.name;
      if (name) bump(siteCounts[site] ??= {}, name);
    }
  }

  // Results are fetched newest-first and may be cut off mid-year at the
  // page cap, so the oldest year is complete only when the API ran out
  // of launches before the cap was hit — meta.truncated records that.
  let years = Object.keys(perYear).sort().reverse();
  if (data.meta.truncated) years = years.slice(0, -1);

  // Tooltip names for every code the chart can show, resolved once here
  // so the axis labels can stay as the short codes. Covers every code
  // counted in the per-year tallies — including the dropped oldest
  // year, whose codes may still appear as filter options.
  const countryCodes = new Set(
    Object.values(perYear).flatMap(y => Object.keys(y[2])));

  const yearly = {};
  for (const year of years) {
    const [rocketC, mfrC, countryC, siteC, famC] = perYear[year];
    yearly[year] = {
      rockets: topCat(rocketC),
      manufacturers: topCat(mfrC),
      countries: topCat(countryC),
      sites: topNested(siteC),
      families: topNested(famC),
    };
  }

  // Country-filter maps gate on rockets/manufacturers that appear in
  // the kept yearly buckets — otherwise dead codes like the API's
  // '???' (on never-launched "Unknown Launch Vehicle") end up as
  // filter options that can only produce an empty chart. The gate
  // uses `yearly`, not `perYear`, so rockets whose only launches fell
  // in the page-capped dropped year stay unlisted too.
  const chartedRockets = new Set(
    Object.values(yearly).flatMap(b => Object.keys(b.rockets)));
  const chartedMfrs = new Set(
    Object.values(yearly).flatMap(b => Object.keys(b.manufacturers)));
  for (const r of Object.values(data.rockets)) {
    const name = r.name;
    if (!chartedRockets.has(name)) continue;
    const manufacturer = data.agencies[r.manufacturer_id];
    if (manufacturer?.country) rocketCountries[name] = manufacturer.country;
    // Country groups by the rocket manufacturer's country, not the
    // launch pad's: one rocket can fly from pads in several countries.
    if (manufacturer?.name) {
      const label = manufacturer.abbrev || manufacturer.name;
      rocketManufacturers[name] = label;
      // manufacturerNames is already complete from the per-launch
      // loop; this pass only fills the country filter map.
      if (chartedMfrs.has(label) && manufacturer.country)
        manufacturerCountries[label] = manufacturer.country;
    }
  }

  return {
    yearly,
    manufacturerNames,
    countryNames: Object.fromEntries(
      [...countryCodes].map(code => [code, countryName(code)])),
    rocketCountries,
    manufacturerCountries,
    rocketManufacturers,
    siteNames,
  };
}

const STATS = computeStats(DATA);
