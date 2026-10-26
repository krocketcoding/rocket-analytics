// Guards against top-level name collisions across the classic scripts.
// They share one global scope — the offline build literally
// concatenates them — so a duplicate top-level const/let in two files is
// a SyntaxError that `node --check` on each file alone never sees.
// Compiling the concatenation with vm.Script surfaces it without running
// any code. Redeclaration errors don't depend on file order, but the
// list comes from the built page's <script defer src> tags anyway so
// the check covers exactly what the browser loads (and a file missing
// from JS_FILES isn't flagged). Requires a prior `python main.py`.
// Run from the repo root with: node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'site', 'index.html');

test('concatenated scripts compile', t => {
  if (!fs.existsSync(HTML)) return t.skip('requires site/index.html — run python main.py first');
  // Srcs are relative to site/ ("static/app.js?v=…"); the repo's static/
  // has the same layout, so read the current sources, not the build copy.
  const srcs = [...fs.readFileSync(HTML, 'utf8').matchAll(/<script defer src="([^"?]+)/g)].map(m => m[1]);
  assert.ok(srcs.length, 'no <script defer src> tags found in site/index.html');
  const bundle = srcs.map(src => fs.readFileSync(path.join(ROOT, src), 'utf8')).join('\n');
  assert.doesNotThrow(() => new vm.Script(bundle, {filename: 'bundle.js'}));
});
