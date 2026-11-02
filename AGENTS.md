# Agent notes

## Comments

- Explain the *why*, not the *what*: non-obvious data shapes, format
  conventions (with a concrete example), edge cases, and API quirks.
  A reader new to the codebase should follow the data flow without
  guesswork. Skip comments that restate the code.
- Jinja comments use `{# ... #}` so they don't reach the rendered HTML.

## Python style

- Lines run to ~120 characters; wrap only what genuinely exceeds it.

## README

- Novice-friendly and concise: a "Project layout" file tour, an ASCII
  data-flow diagram, and a suggested reading order. Don't duplicate
  in-file docstrings — describe purpose, not mechanism.
- Keep it accurate when refactoring: path references (e.g. constants in
  `pipeline/config.py`), module names, and usage examples must match the
  actual code.
- Wrap prose at 120 characters. Never split links, code spans, or
  hyphenated words across a line break.

## Naming

- The build produces two outputs; qualify "bundle" wording as the
  *offline* build (`pipeline/offline_bundle.py`, `OFFLINE_FILE`).
- Directories use kebab case (`launch-archive/`, `image-cache/`).

## Launch data

- `launch-archive/` is the committed full-history store;
  `launch-cache.json` (gitignored) is the ephemeral delta. `build` never
  writes the archive; `update-archive` never writes the cache. Merges
  are per-launch-id, newest `last_updated` wins.
- Archive shards are JSONL (one record per line, sorted keys) grouped by
  launch year; `*.jsonl` is pinned to `eol=lf` in `.gitattributes`.
  Slim records use `{"id": N}` entity refs — rehydrate before passing
  to `dataset.py`.
- Network access only happens via `build --fetch` and `update-archive`;
  plain `main.py`/`build` is always offline.
- Crawl/sweep state lives in `launch-archive/meta.json` (`complete`,
  `resume_net`) and `sweep.json` — respect these when touching fetch or
  save logic.

## Front end

- View markup (tables, modals, charts) is built in JS from the single
  `data` JSON block; `templates/index.html` is only the page shell.
- `static/*.js` are classic scripts sharing one global scope, loaded in
  `JS_FILES` order from `pipeline/config.py`. A new file must be added
  there; `tests/scripts.test.js` catches top-level name collisions.
- Online scripts load with `defer`; the offline build's inline scripts
  must stay at the END of `<body>` to run after the `data` block.
- Image fields are indices into `DATA.images`; resolve with `imgSrc(i)`
  and skip `null` slots (offline unembedded images) — never test the index.
- Update text loads lazily online via `launch-updates.js`
  (`DATA.meta.updates_src`); `renderUpdates` handles loading/error states.
  Offline keeps updates inline.

## Verifying changes

- `pip install -r requirements.txt`, then `python main.py` to smoke-test
  (offline — safe to run repeatedly). `python main.py build --fetch`
  exercises the API path; `update-archive` writes `launch-archive/`.
- `site/` is generated output and gitignored — never commit it.
- `node --check` each edited `static/*.js` file. Run
  `python -m unittest discover tests` and `node --test` (the latter
  needs a prior build for `site/index.html`) — CI runs both suites.
- After touching the offline build, check `site/rocket-analytics-offline.html`'s
  `images` list: embedded entries are `data:` URIs, the rest `null`.
- Delete `image-cache/` to force processed images to be refetched.
