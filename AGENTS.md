# Agent notes

## Comments

- Add explanatory comments to all non-trivial sections — the goal is for a
  reader new to the codebase to follow the data flow without guesswork.
- Explain the *why*, not the *what*: non-obvious data shapes (e.g. what
  `per_year` holds), spec/format conventions (with a concrete example),
  edge cases (e.g. a malformed cache timestamp counts as stale), and
  API quirks (e.g. why upcoming and previous use different orderings).
- Skip comments that merely restate the code.
- Jinja comments use `{# ... #}` so they don't reach the rendered HTML.

## Python style

- Lines can run to ~120 characters. Prefer one long line over breaking a
  call or expression across continuation lines when it fits — wrap only
  what genuinely exceeds the limit.

## README

- Keep it friendly to a novice software engineer. It includes a
  "Project layout" section with a file-by-file tour, an ASCII data-flow
  diagram, and a suggested reading order through the pipeline.
- Keep it accurate when refactoring: path references (e.g. constants in
  `pipeline/config.py`), module names, and usage examples must match the
  actual code.
- Wrap prose at 120 characters. Never split links, code spans, or
  hyphenated words across a line break — textwrap's defaults do this;
  guard against it (e.g. `break_on_hyphens=False`) or fix manually.

## Naming

- The build produces two outputs; qualify "bundle" wording as the
  *offline* build wherever it would otherwise be ambiguous
  (`pipeline/offline_bundle.py`, `OFFLINE_FILE`, `offline_href`).
- Directories use kebab case (`image-cache/`).

## Front end

- The site is one workspace of two panes, each showing any view — a
  chart or a table — with a draggable divider (fixed even stack on
  mobile) and a per-pane maximize/restore button. Pane state (views,
  filters, split ratio, focus) serializes to the URL hash and
  localStorage.
- Page behavior is split across `static/app.js` (detail modals, table
  row clicks, rocket-table sorting) and the chart/workspace files:
  `static/chart-factories.js` (the Chart.js factories and view
  contracts), `static/chart-defs.js` (the CHART_DEFS registry and its
  data-slicing helpers), `static/charts.js` (the per-pane filter
  controls and pager), and `static/workspace.js` (pane skeleton, view
  pickers, tables-as-views, divider, maximize, CSV/PNG export, URL +
  localStorage persistence). All are classic scripts — not modules —
  sharing top-level bindings, loaded in `JS_FILES` order from
  `pipeline/config.py` with workspace.js last.
- Tables are server-rendered into hidden `#table-staging` and relocated
  into a pane on mount — a table view exists once, so it's disabled in
  the other pane's picker. Charts mount per pane from CHART_DEFS.
- `templates/index.html` is markup, and shared Jinja macros (e.g.
  `modal()`) live in `templates/macros.html`.
- Scripts must render at the END of `<body>`: app.js reads the `data-*`
  JSON blocks at parse time, so a `<script src>` in `<head>` crashes on
  a null element. This applies to both the linked and inlined variants.
- Offline images resolve through the `data-images` JSON map via
  `imgSrc()` — data keeps plain URLs and the map holds each unique
  image's data URI once, instead of duplicating it per launch.

## Verifying changes

- Install deps with `pip install -r requirements.txt`, then run
  `python main.py` to smoke-test the build. A plain run reuses
  `launch-cache.json` and never hits the API, so it's safe to run
  repeatedly; `--refresh` forces a fresh fetch.
- `site/` is generated output and gitignored — never commit it.
- `node --check` each edited `static/*.js` file after front-end edits
  (`workspace.js`, `charts.js`, `chart-defs.js`, `chart-factories.js`,
  `app.js`).
- After touching the offline build, sanity-check `data-images` in
  `site/rocket-analytics-offline.html` (it's `{}` in `index.html`).
- `image-cache/` caches processed images by content of
  url|size|quality and prunes entries the current build doesn't
  reference; delete it to force a refetch. It's gitignored locally and
  persisted between CI runs via `actions/cache` alongside
  `launch-cache.json`.
