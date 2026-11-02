# Rocket Analytics

A vibe coded rocket launch analytics dashboard. The Python build pipeline fetches launch data from the
[Launch Library 2](https://thespacedevs.com/llapi) API and normalizes it into one dataset; everything you see —
charts, tables, modals — is rendered in JavaScript from that data. Hosted on GitHub Pages, rebuilt every 4 hours.

[See it here](https://rocketanalytics.fyi/)

## Usage

```bash
pip install -r requirements.txt       # install dependencies
python main.py                        # build the site into site/, fully offline
python main.py build --fetch          # fetch the latest API changes first, then build
python main.py update-archive         # refresh launch-archive/ from the API (no site build)
python main.py [command] --help       # show all options for a command
```

Open `site/index.html` in a browser to preview. Each build also produces `site/rocket-analytics-offline.html`, a
self-contained single-file version of the site. Set `LL2_API_KEY` to authenticate with a TheSpaceDevs API key —
the anonymous rate limit is small.

Launch data lives in two places: `launch-archive/`, a committed archive of every previous launch so clones can
build without the API, and `launch-cache.json` (git ignored), the delta of records fetched since the archive last
updated. Builds merge them per record — newest `last_updated` wins — so a stale cache can't roll back a fresher
archive. `update-archive` is the archive's only writer: fetches pull just what changed (a few requests, not
dozens), every page is checkpointed so interrupted crawls resume, and a weekly CI job runs it and commits the
result. To rebuild from scratch, delete `launch-archive/` and run it again.

## Project layout

The pipeline is one module per step; data flows like this:

```
                 ┌─> launch-archive/ (committed)  ─────────┐
LL2 API ──fetch──┤                                         ├─ merge by id,
                 └─> launch-cache.json (upcoming + delta) ─┘   newest wins
                                                                 │
                                           normalize ─> shipped dataset
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

The dataset is the key idea: launch records reference shared entity tables by id and image URLs by index, so
nothing is duplicated. Aggregation and rendering all happen in JavaScript off that one block.

- `main.py`: `build` and `update-archive` commands.
- `pipeline/config.py`: All tunables and file locations in one place. Start here to change what or where things are.
- `pipeline/api.py`: LL2 requests with retries; page iterators pace themselves against the reported API quota.
- `pipeline/archive.py`: The `launch-archive/` store: JSONL shards with entities deduplicated into id-keyed tables.
- `pipeline/launch_cache.py`: The git ignored delta file.
- `pipeline/details.py`: Which API fields the site keeps.
- `pipeline/dataset.py`: Normalize launches into the shipped dataset.
- `pipeline/build.py` + `pipeline/offline_bundle.py`: Render `index.html` and the inlined offline build.
- `templates/index.html`: Jinja page shell; all view markup is built in JavaScript.
- `static/`: Front-end JavaScript (load order in `config.py`'s `JS_FILES`) and `style.css`:
  `app.js` (dataset parsing, modals), `stats.js` (chart aggregations), `chart-defs.js`/`chart-factories.js`/
  `charts.js` (chart registry, factories, controls), `tables.js` (tables + CSV export), `workspace.js` (two-pane
  layout + persistence), `chart-library.min.js` (vendored Chart.js).
- `tests/`: Python unit tests (`test_*.py`: helpers, archive store, dataset invariants) and Node tests
  (`*.test.js`: stats, charts, UI helpers, plus `fixtures.js`).

**Reading the code:** follow the data — `main.py` → `api.py` → `archive.py`/`launch_cache.py` → `dataset.py` →
`build.py`; on the front end, `app.js` → `stats.js` → the chart and table files.

## GitHub Actions

Two automated workflows: 
- `deploy.yml` rebuilds the site on every push to `master`, every 4 hours on a schedule, and on dispatch; 
- `archive.yml` runs `update-archive` weekly and commits the result. Both run the test suites before deploying.

## Useful Links

- Launch Library 2 API: [Documentation](https://ll.thespacedevs.com/docs/) ·
  [FAQ](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_LL2.md)
- Chart.js (v4.5.1): [Documentation](https://www.chartjs.org/docs/4.5.1/) ·
  [Samples](https://www.chartjs.org/docs/4.5.1/samples/)

## License

This project's code is MIT licensed. Launch data — including the committed `launch-archive/` — comes from
[The Space Devs' Launch Library 2](https://thespacedevs.com/llapi) and is used under
[their terms of use](https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md); it is not covered by the
MIT license.
