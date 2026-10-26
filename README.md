# Rocket Analytics

A vibe coded rocket launch analytics dashboard. Python fetches launch data from the
[Launch Library 2](https://thespacedevs.com/llapi) API and normalizes it into one dataset; everything you see —
charts, tables, modals — is rendered in JavaScript from that data, while Jinja is only a small page shell. Hosted
on GitHub Pages and automatically updated via GitHub Actions every 6 hours.

[See it here](https://krocketcoding.github.io/rocket-analytics/)

## Usage

```bash
pip install -r requirements.txt
python main.py                    # builds into site/
python main.py --refresh          # ignore the API response cache
python main.py --max-cache-age 5  # refetch if the cache is over 5 hours old
python -m unittest discover tests # run the Python unit tests
node --test                       # JS tests: stats invariants + script bundle check (needs a prior build)
```

Fetched launch data is cached in `launch-cache.json` (git ignored) and reused regardless of age unless `--refresh` or
`--max-cache-age` says otherwise, so repeated builds during development don't re-hit the rate-limited API. If a fetch
fails, the script falls back to the stale cache rather than failing the build. The number of pages fetched per endpoint
is set by `PAST_LAUNCH_PAGES` and `UPCOMING_LAUNCH_PAGES` at the top of `pipeline/config.py` (100 launches per page).

Open `site/index.html` in a browser to preview. Launch update text ships separately as `site/launch-updates.js`:
it's roughly half the gzipped dataset but is only read when a launch's Updates tab opens, so the page loads it
lazily after the first render (or on demand when a modal opens).

Each build also produces `site/rocket-analytics-offline.html`, a portable single-file version of the site with the
stylesheet and all JavaScript inlined — it can be opened in any browser without an internet connection. Mission
patches and rocket images are downloaded, downscaled to display size, and embedded as WebP data URIs in the
dataset's `images` table (the slots for every other image read `null`; `PATCH_IMAGE_PX`, `ROCKET_IMAGE_PX`, and
`IMAGE_QUALITY` in `pipeline/config.py` control the size/quality tradeoff); all remote URLs and external links are
stripped out. Processed images are cached in `image-cache/` (gitignored) so repeat builds don't re-download them.
The Chart.js library is vendored as `static/chart-library.min.js` and used by both versions of the site; the
offline build is skipped if a static file is missing.

## How it works

- `main.py` drives the `pipeline` package, which fetches upcoming and previous launches, normalizes them into one
  dataset, and renders `templates/index.html` into `site/` — once as `index.html` and once as
  `rocket-analytics-offline.html`, a self-contained single-file build with all resources inlined to work offline.
- `static/` is copied to `site/static/`. In `index.html` the CSS and JS URLs carry a `?v=<content hash>` query, so a
  deploy can't pair new HTML with a stale cached script (GitHub Pages caches assets for 10 minutes).
- The GitHub Actions workflow in `.github/workflows/deploy.yml` rebuilds and deploys the site in a single job on every
  push to `master`, every 6 hours on a schedule, and on manual dispatch.
- The workflow runs `main.py --max-cache-age 5` and persists `launch-cache.json` and `image-cache/` between runs via
  `actions/cache` (one `data-cache-` entry), so push-triggered rebuilds within 5 hours of the last fetch skip the API
  entirely while the 6-hourly schedule always refreshes.
- After the build, CI runs both test suites (`python -m unittest discover tests` and `node --test`); a failure stops
  the deploy before the artifact uploads.
- Workflow runs share a `pages` concurrency group: pushes cancel any in-progress run so the newest commit deploys
  promptly, while scheduled and manual runs queue instead.

## Project layout

The pipeline is one module per step; data flows roughly like this:

```
LL2 API ──fetch──> launch dicts ──normalize──> one dataset
                      │                             │
                      └──> launch-cache.json        └──> Jinja page shell
                                                              │
                                            templates/index.html + static/
                                                              │
                            site/index.html (`data` JSON; update text
                            split out into launch-updates.js, loaded
                            lazily) + offline bundle (updates inline)
                                                              │
                            stats.js/tables.js/charts.js derive everything
                            in the browser from that one `data` block
```

The dataset is the key idea: launch records reference shared entity tables (`agencies`, `rockets`, `pads`,
`locations`, `statuses`, `programs`, `authors`) by id and image URLs by index into a deduplicated `images` list, so
no provider, location string, or avatar URL ships twice. All aggregation and rendering — stats, tables, modals,
charts — happens in JavaScript from that single block; Jinja only renders the page shell around it.

- `main.py` — command-line entry point. Decides between cached data and a fresh fetch, then hands everything to the
  builder.
- `pipeline/config.py` — all tunables and file locations in one place (page counts, API base URL, directory paths).
  Start here to change how much data is fetched or where things live.
- `pipeline/api.py` — paginated requests to the Launch Library 2 API with retries. The API returns 100 launches per
  page plus a `next` link.
- `pipeline/launch_cache.py` — reads/writes `launch-cache.json` so development builds don't re-hit the rate-limited
  API.
- `pipeline/details.py` — selects which API fields the site actually uses. The API returns very large launch objects;
  the `*_FIELDS` specs and `pick`/`pull` helpers copy just the needed fields into flat dicts.
- `pipeline/dataset.py` — normalizes the launches into the single dataset the site ships: launch records referencing
  entity tables by id and interned image URLs by index, with null/empty fields dropped.
- `pipeline/build.py` — renders `templates/index.html` into `site/` with the dataset as the one `data` JSON block,
  writes the lazily loaded `site/launch-updates.js` companion script, versions the CSS/JS URLs with content hashes,
  and hands off to the offline build.
- `pipeline/offline_bundle.py` — the offline single-file build: downloads and downscales mission patch / rocket images
  into data URIs inside the dataset's `images` table, strips remote URLs, and re-renders the template with
  everything inlined.
- `templates/index.html` — the site's markup as one minimal Jinja shell: head, header, `#workspace`, footer, the
  `data` JSON block, and the script tags. All view markup is built in JavaScript.
- `static/` — front-end code and assets, copied into `site/` verbatim and inlined for the offline build:
  - `style.css` — the whole stylesheet.
  - `app.js` — parses the dataset, builds and drives the detail modals (update text loads lazily from
    `launch-updates.js` online), and holds the shared formatting helpers.
  - `stats.js` — computes the chart aggregations in the browser: per-year launch counts by rocket, rocket family,
    manufacturer, country, and launch site, split into orbital, suborbital, and failed segments, with site and
    family rows keeping a nested per-rocket tally so the rocket filter and variant stacking can re-slice them.
  - `chart-factories.js` — the Chart.js factories and the chart view contract (page, pageCount, setPage, setData).
  - `chart-defs.js` — the CHART_DEFS registry and its data-slicing helpers.
  - `charts.js` — the per-pane filter controls (year scope, country/rocket/entity popovers, toggles) and pager.
  - `tables.js` — the table views and their CSV export (one column spec drives both).
  - `workspace.js` — the two-pane workspace: view pickers, divider drag, maximize, PNG/CSV export, and
    URL/localStorage persistence.
  - `chart-library.min.js` — vendored Chart.js.
- `tests/` — the test suites:
  - `test_dataset.py` — dataset invariants against the real launch cache (references, orphans, offline scrub,
    update splitting).
  - `test_helpers.py` — unit tests for the small helpers: `drop_empty`, `pick`/`pull`, `link_details`, cache
    load/save, and API retry behavior.
  - `stats.test.js` — Node test asserting the chart-stat invariants on the built `site/index.html`.
  - `scripts.test.js` — Node test concatenating the classic scripts to catch top-level name collisions.
- `api-examples/` — sample API responses. Open these to see the raw shape of a launch record before `dataset.py`
  normalizes it.

**Reading the code:** follow the data. Start at `main.main()`, then `api.fetch_launches()` for input,
`dataset.build_dataset()` for normalization, and `build.build_site()` / `offline_bundle.build_offline_bundle()` for
output. On the front end, start at `app.js`'s `DATA` parse, then `stats.js`'s `computeStats()` for the aggregations
the charts read.

## Useful Links
- Launch Library 2 API
  - [Documentation](https://ll.thespacedevs.com/docs/)
  - [FAQ](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_LL2.md)
- Chart.js (v4.5.1)
  - [Documentation](https://www.chartjs.org/docs/4.5.1/)
  - [Sample charts](https://www.chartjs.org/docs/4.5.1/samples/)
