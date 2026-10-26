"""Compute summary analytics from the launch and entity data."""

from collections import defaultdict

from .config import PAGE_SIZE, PAST_LAUNCH_PAGES
from .details import pick

# The API reports agency country as an alpha-3 code ('USA') with no name
# field, so chart tooltips resolve codes through this table. Covers every
# code seen in the data, including each member of ESA's compound code.
COUNTRY_NAMES = {
    "USA": "United States", "CHN": "China", "RUS": "Russia", "IND": "India", "JPN": "Japan",
    "KOR": "South Korea", "PRK": "North Korea", "IRN": "Iran", "ISR": "Israel",
    "FRA": "France", "DEU": "Germany", "ITA": "Italy", "ESP": "Spain", "GBR": "United Kingdom",
    "IRL": "Ireland", "PRT": "Portugal", "NLD": "Netherlands", "BEL": "Belgium", "LUX": "Luxembourg",
    "CHE": "Switzerland", "AUT": "Austria", "POL": "Poland", "CZE": "Czechia", "HUN": "Hungary",
    "ROU": "Romania", "GRC": "Greece", "DNK": "Denmark", "SWE": "Sweden", "NOR": "Norway",
    "FIN": "Finland", "EST": "Estonia", "SVN": "Slovenia", "UKR": "Ukraine", "AUS": "Australia",
    "NZL": "New Zealand", "SGP": "Singapore", "KAZ": "Kazakhstan", "BRA": "Brazil",
    "GUF": "French Guiana", "OMN": "Oman",
}


def country_name(code):
    """Expand a country code to a name for the chart tooltip.

    A few agencies report comma-separated member states ('AUS,SGP'), so each part resolves
    individually; unlisted codes — and the API's own '???' placeholder — read 'Unknown'."""
    return ", ".join(COUNTRY_NAMES.get(part.strip(), "Unknown") for part in code.split(","))


# Stacked-chart categories: failures are their own segment, and the rest
# split by whether the mission targeted orbit — 'Sub' is the only
# suborbital orbit the API reports (and exactly the launches where
# orbital_launch_attempt_count is null).
FAILED_ABBREVS = ("Failure", "Partial Failure")


def launch_category(launch):
    """Classify a fetched launch as 'orbital', 'suborbital', or 'failed'."""
    if (launch.get("status") or {}).get("abbrev") in FAILED_ABBREVS:
        return "failed"
    orbit = pick(pick(launch.get("mission"), "orbit"), "abbrev")
    return "suborbital" if orbit == "Sub" else "orbital"


def new_cat():
    """Empty {'orbital', 'suborbital', 'failed'} counter dict."""
    return {"orbital": 0, "suborbital": 0, "failed": 0}


# Rows sort by descending total; ties break alphabetically by name —
# the rocket table's final tiebreak (its middle key, LEO capacity,
# isn't part of the cat rows).
def top_cat(cats):
    """{name: cat dict} -> same shape ordered by descending total."""
    return dict(sorted(cats.items(),
                       key=lambda kv: (-sum(kv[1].values()), kv[0])))


def top_nested(cats):
    """{name: {inner: cat dict}} -> same shape ordered by grand total."""
    return dict(sorted(cats.items(), key=lambda kv:
        (-sum(sum(inner.values()) for inner in kv[1].values()), kv[0])))


def compute_stats(rockets, previous):
    """Compute summary analytics from the deduplicated rocket set.

    Yearly stats are tallied from the fetched launches, since the API has no per-rocket yearly counts."""
    # Chart labels use the manufacturer abbreviation; keep the full name
    # around so the frontend can show it too.
    manufacturer_names = {}
    # Rocket name and manufacturer abbrev -> manufacturer country code,
    # for the charts' country filters.
    rocket_countries = {}
    manufacturer_countries = {}
    # Launch-site short name -> its country code, full location name, and
    # the API's lifetime launch count. Air/sea "locations" ('Air launch
    # to orbit', 'Sea Launch') carry the API's '???' code — legitimate
    # here since they record real launches.
    site_countries = {}
    site_names = {}
    # Tally fetched launches per calendar year. Each year gets a
    # name -> category dict per chart grouping: rockets, manufacturers,
    # countries, launch sites, and rocket families. Sites and families
    # nest one level deeper — {site: {rocket: cats}} so the front end
    # can filter a site's launches by which rocket flew them, and
    # {family: {rocket: cats}} so the family chart can stack by
    # variant instead of by category.
    per_year = defaultdict(lambda: [defaultdict(new_cat), defaultdict(new_cat), defaultdict(new_cat),
                                    defaultdict(lambda: defaultdict(new_cat)),
                                    defaultdict(lambda: defaultdict(new_cat))])
    for launch in previous:
        launch_year = (launch.get("net") or "")[:4]
        if not launch_year:
            continue
        cat = launch_category(launch)
        rocket_counts, mfr_counts, country_counts, site_counts, fam_counts = per_year[launch_year]
        config = pick(launch.get("rocket"), "configuration") or {}
        name = config.get("full_name") or config.get("name")
        if name:
            rocket_counts[name][cat] += 1
            # Configs with no family group under their own name; the
            # segment key is the full config name because the API's bare
            # variant token merges distinct rockets ('A' spans several
            # Long Marches). Gated on name like sites, so family totals
            # can't out-count the rocket grouping.
            fam_counts[config.get("family") or name][name][cat] += 1
        manufacturer = config.get("manufacturer") or {}
        if manufacturer.get("name"):
            label = manufacturer.get("abbrev") or manufacturer["name"]
            mfr_counts[label][cat] += 1
            manufacturer_names[label] = manufacturer["name"]
        if country := manufacturer.get("country_code"):
            country_counts[country][cat] += 1
        # Site charts group by pad location ("Cape Canaveral SFS, FL, USA"
        # -> "Cape Canaveral SFS"), not individual pads. Short names are
        # unique in the data today; a future collision would merge two
        # sites' counts under one label. The tally is gated on `name` so
        # the site grouping can't out-count the rocket grouping.
        location = pick(launch.get("pad"), "location") or {}
        if location.get("name"):
            site = location["name"].split(",")[0].strip()
            site_names[site] = location["name"]
            if location.get("country_code"):
                site_countries[site] = location["country_code"]
            if name:
                site_counts[site][name][cat] += 1

    years = sorted(per_year, reverse=True)
    # Results are fetched newest-first and may be cut off mid-year at the
    # page cap, so the oldest year is complete only when the API ran out
    # of launches before the cap was hit.
    if len(previous) >= PAST_LAUNCH_PAGES * PAGE_SIZE:
        years = years[:-1]

    # Tooltip names for every code the chart can show, resolved once here
    # so the axis labels can stay as the short codes. rocket_countries is
    # included so the country filter can name codes like '???' (Unknown)
    # that belong to rockets with no recorded launches.
    country_codes = (set(rocket_countries.values()) |
                     set(manufacturer_countries.values()) |
                     {c for _, _, counts, _, _ in per_year.values() for c in counts})

    yearly = {}
    for year in years:
        rocket_c, mfr_c, country_c, site_c, fam_c = per_year[year]
        yearly[year] = {"rockets": top_cat(rocket_c),
                        "manufacturers": top_cat(mfr_c),
                        "countries": top_cat(country_c),
                        "sites": top_nested(site_c),
                        "families": top_nested(fam_c)}

    # Country-filter maps gate on rockets/manufacturers that appear in
    # the kept yearly buckets — otherwise dead codes like the API's
    # '???' (on never-launched "Unknown Launch Vehicle") end up as
    # filter options that can only produce an empty chart. The gate
    # uses `yearly`, not `per_year`, so rockets whose only launches fell
    # in the page-capped dropped year stay unlisted too.
    charted_rockets = {n for b in yearly.values() for n in b["rockets"]}
    charted_mfrs = {n for b in yearly.values() for n in b["manufacturers"]}
    for r in rockets.values():
        name = r.get("name")
        if name not in charted_rockets:
            continue
        if r.get("manufacturer_country"):
            rocket_countries[name] = r["manufacturer_country"]
        # Country groups by the rocket manufacturer's country, not the
        # launch pad's: one rocket can fly from pads in several countries.
        if r.get("manufacturer"):
            label = r.get("manufacturer_abbrev") or r["manufacturer"]
            if label in charted_mfrs:
                manufacturer_names[label] = r["manufacturer"]
                if r.get("manufacturer_country"):
                    manufacturer_countries[label] = r["manufacturer_country"]

    return {
        "yearly": yearly,
        "manufacturer_names": manufacturer_names,
        "country_names": {code: country_name(code) for code in country_codes},
        "rocket_countries": rocket_countries,
        "manufacturer_countries": manufacturer_countries,
        "site_countries": site_countries,
        "site_names": site_names,
    }
