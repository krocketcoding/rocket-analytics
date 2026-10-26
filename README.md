# Rocket Analytics

A vibe coded rocket launch analytics dashboard. Implemented in Python, it queries the
[Launch Library 2](https://thespacedevs.com/llapi) API and builds static HTML using Jinja2. Hosted on GitHub Pages and
automatically updated via GitHub Actions every 6 hours.

[See it here](https://krocketcoding.github.io/rocket-analytics/)

## Usage

```bash
pip install -r requirements.txt
python main.py                    # builds into site/
python main.py --refresh          # ignore the API response cache
python main.py --max-cache-age 5  # refetch if the cache is over 5 hours old
python -m unittest discover tests # run the unit tests
```

Fetched launch data is cached in `launch-cache.json` (git ignored) and reused regardless of age unless `--refresh` or
`--max-cache-age` says otherwise, so repeated builds during development don't re-hit the rate-limited API. If a fetch
fails, the script falls back to the stale cache rather than failing the build. The number of pages fetched per endpoint
is set by `PAST_LAUNCH_PAGES` and `UPCOMING_LAUNCH_PAGES` at the top of `pipeline/config.py` (100 launches per page).

Open `site/index.html` in a browser to preview.

Each build also produces `site/rocket-analytics-offline.html`, a portable single-file version of the site with the
stylesheet and all JavaScript inlined — it can be opened in any browser without an internet connection. Mission
patches and rocket images are downloaded, downscaled to display size, and embedded as WebP data URIs in a shared
`data-images` map (`PATCH_IMAGE_PX`, `ROCKET_IMAGE_PX`, and `IMAGE_QUALITY` in `pipeline/config.py` control the
size/quality tradeoff); all other remote URLs and external links are stripped out. Processed images are cached in
`image-cache/` (gitignored) so repeat builds don't re-download them. The Chart.js library is vendored
as `static/chart-library.min.js` and used by both versions of the site; the offline build is skipped if a static file is missing.

## How it works

- `main.py` drives the `pipeline` package, which fetches upcoming and previous launches, computes stats, and renders
  `templates/index.html` into `site/` — once as `index.html` and once as `rocket-analytics-offline.html`, a
  self-contained single-file build with all resources inlined to work offline.
- `static/` is copied to `site/static/`.
- The GitHub Actions workflow in `.github/workflows/deploy.yml` rebuilds and deploys the site in a single job on every
  push to `master`, every 6 hours on a schedule, and on manual dispatch.
- The workflow runs `main.py --max-cache-age 5` and persists `launch-cache.json` and `image-cache/` between runs via
  `actions/cache` (one `data-cache-` entry), so push-triggered rebuilds within 5 hours of the last fetch skip the API
  entirely while the 6-hourly schedule always refreshes.
- Workflow runs share a `pages` concurrency group: pushes cancel any in-progress run so the newest commit deploys
  promptly, while scheduled and manual runs queue instead.

## Project layout

The pipeline is one module per step; data flows roughly like this:

```
LL2 API ──fetch──> launch dicts ──curate──> details + entities + stats
                      │                              │
                      └──> launch-cache.json         └──> Jinja context
                                                              │
                                            templates/index.html + static/
                                                              │
                                        site/index.html + offline bundle
```

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
- `pipeline/stats.py` — aggregates launch counts per rocket, per rocket family, per manufacturer, per country, and
  per year for the charts. Yearly bars split into orbital, suborbital, and failed segments; the lifetime 'all time'
  bars split into success and failed only, since the API has no lifetime orbit breakdown. The site and family
  groupings also keep a nested per-rocket tally so the front end can re-slice them (rocket filter, variant stacking).
- `pipeline/build.py` — collects shared entities (rockets, providers, pads, agencies), renders `templates/index.html`
  into `site/`, and hands off to the offline build.
- `pipeline/offline_bundle.py` — the offline single-file build: downloads and downscales mission patch / rocket images
  into data URIs, strips other remote URLs, and re-renders the template with everything inlined.
- `templates/index.html` — the site's markup as one Jinja template; all charts and tables are driven by the context
  dict built in `build.py`. Reusable table and modal markup lives in `templates/macros.html`, imported at the top.
- `static/` — the stylesheet, the page's JavaScript (`app.js` for detail modals and table row clicks; the chart code
  split across `chart-factories.js` for Chart.js factories, `chart-defs.js` for the chart registry, `charts.js`
  for the per-pane filter controls, and `workspace.js` for the two-pane workspace — view pickers, divider drag,
  maximize, PNG/CSV export, and URL/localStorage persistence), and a vendored Chart.js — copied into
  `site/` verbatim and inlined for the offline build.
- `api-examples/` — sample API responses. Open these to see the raw shape of a launch record before it's curated by
  `details.py`.

**Reading the code:** follow the data. Start at `main.main()`, then `api.fetch_launches()` for input,
`details.launch_detail()` and `details.collect_entities()` for the field transformations, `stats.compute_stats()` for
aggregation, and `build.build_site()` / `offline_bundle.build_offline_bundle()` for output.

## Useful Links
- Launch Library 2 API
  - [Documentation](https://ll.thespacedevs.com/docs/)
  - [FAQ](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_LL2.md)
- Chart.js (v4.5.1)
  - [Documentation](https://www.chartjs.org/docs/4.5.1/)
  - [Sample charts](https://www.chartjs.org/docs/4.5.1/samples/)
