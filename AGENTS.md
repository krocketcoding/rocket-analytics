# Agent notes

## Comments

- Add explanatory comments to all non-trivial sections — the goal is for a
  reader new to the codebase to follow the data flow without guesswork.
- Explain the *why*, not the *what*: non-obvious data shapes (e.g. what
  `perYear` holds in `static/stats.js`), spec/format conventions (with a
  concrete example), edge cases (e.g. a malformed cache timestamp counts
  as stale), and API quirks (e.g. why upcoming and previous use different
  orderings).
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

- View markup (tables, modals, charts) is built in JS from the single
  `data` JSON block; `templates/index.html` is only the page shell. Don't
  add data-driven templating there.
- `static/*.js` are classic scripts, not modules, loaded in `JS_FILES`
  order from `pipeline/config.py`. A new file must be added there. They
  share one global scope, so two files declaring the same top-level
  `const` crash the page at load — `node --check` per file won't catch
  it, so `tests/scripts.test.js` compiles the concatenated bundle.
- Online scripts load with `defer` in `<head>`: they download while the
  large data block streams and still run after parsing. The offline
  build's inline scripts must stay at the END of `<body>` — defer has
  no effect on inline scripts, and they must run after the `data` block
  they read.
- Image fields are indices into `DATA.images`; resolve them with
  `imgSrc(i)`. Offline, unembedded slots are `null`, so skip nulls
  wherever an image is consumed — and since index 0 is a real image,
  test the resolved value, never the index.
- Launch update text loads lazily online via `site/launch-updates.js`
  (URL in `DATA.meta.updates_src`); `renderUpdates` in app.js must
  handle the not-yet-loaded state (loading → filled/error). The offline
  build has no `updates_src` and keeps updates inline.

## Verifying changes

- Install deps with `pip install -r requirements.txt`, then run
  `python main.py` to smoke-test the build. A plain run reuses
  `launch-cache.json` and never hits the API, so it's safe to run
  repeatedly; `--refresh` forces a fresh fetch.
- `site/` is generated output and gitignored — never commit it.
- `node --check` each edited `static/*.js` file. Run
  `python -m unittest discover tests` and `node --test` (the latter
  needs a prior build for `site/index.html`) — CI runs both suites
  after the build, so a failure stops the deploy.
- After touching the offline build, check the `images` list in the
  `data` block of `site/rocket-analytics-offline.html`: embedded entries
  are `data:` URIs and the rest are `null`.
- Delete `image-cache/` to force processed images to be refetched.
