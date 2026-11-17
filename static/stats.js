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
  // Codes that only appear on the provider side or inside ESA's
  // compound consortium strings — missing entries here collapse to
  // 'Unknown', which made distinct countries look duplicated.
  CAN: 'Canada', IDN: 'Indonesia', TWN: 'Taiwan',
  MHL: 'Marshall Islands', TUR: 'Turkey', BGR: 'Bulgaria',
  SVK: 'Slovakia', HRV: 'Croatia', ISL: 'Iceland',
  LVA: 'Latvia', LTU: 'Lithuania',
};

// Expand a country code to a name for the chart tooltip.
// A few agencies report comma-separated member states ('AUS,SGP'), so
// each part resolves individually. Unlisted codes show as themselves:
// the table only needs pretty names for countries we've seen, and a
// new country's alpha-3 stays identifiable instead of collapsing
// into 'Unknown' — which is reserved for the API's own '???'
// placeholder (never-launched vehicles like "Unknown Launch
// Vehicle").
const countryName = code =>
  code.split(',').map(part => {
    const p = part.trim();
    return COUNTRY_NAMES[p] || (p === '???' ? 'Unknown' : p);
  }).join(', ');

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

// The 'Active only' test shared by the rockets table and the rocket
// bar chart: only a confirmed active flag counts — a null flag (no
// status on record) can't confirm the rocket is still flying.
const isActiveRocket = rec => rec.active === true;

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
  // Per-name orbital launch totals across every fetched year — the
  // orbit-capable test below treats a real orbital launch as proof of
  // capability even when the spec sheet's leo_capacity is missing. Any
  // non-'Sub' orbit counts, whatever the outcome: a failed orbital
  // attempt still marks an orbital-class vehicle.
  const orbitalTotals = {};
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
      if (launch.orbit !== 'Sub')
        orbitalTotals[name] = (orbitalTotals[name] || 0) + 1;
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

  // Names for every country code a picker or chart can show. The
  // pickers offer provider countries too — a wider set than the
  // tallies (launch-service providers like Sea Launch carry '???',
  // which never charts as a manufacturer) — so the names map covers
  // every agency country, not just the tally keys.
  const countryCodes = new Set(
    Object.values(data.agencies).map(a => a.country).filter(Boolean));

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

  // Rockets able to reach orbit: the spec sheet lists a positive LEO
  // capacity, or the launch log holds an orbital launch (non-'Sub'
  // orbit, counted above). A missing or zero leo_capacity plus a
  // purely suborbital record — sounding rockets, New Shepard — fails
  // both tests, so the rocket charts' 'Orbit-capable only' filter
  // drops it.
  // Counts cover the truncated oldest year too: capability doesn't
  // depend on which years chart.
  const orbitCapable = new Set(Object.values(data.rockets)
    .filter(r => r.name && (r.leo_capacity > 0 || orbitalTotals[r.name] > 0))
    .map(r => r.name));

  // Rocket names passing isActiveRocket — the rocket charts' 'Active
  // only' filter reads this set.
  const activeRockets = new Set(Object.values(data.rockets)
    .filter(r => r.name && isActiveRocket(r))
    .map(r => r.name));

  return {
    yearly,
    manufacturerNames,
    countryNames: Object.fromEntries(
      [...countryCodes].map(code => [code, countryName(code)])),
    rocketCountries,
    manufacturerCountries,
    rocketManufacturers,
    siteNames,
    orbitCapable,
    activeRockets,
  };
}

const STATS = computeStats(DATA);
