"""Render the site template and copy static assets into site/."""

import hashlib
import json
import shutil

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .config import CSS_FILE, JS_FILES, OFFLINE_FILE, SITE_DIR, STATIC_DIR, TEMPLATES_DIR
from .dataset import build_dataset, split_updates
from .offline_bundle import build_offline_bundle

OFFLINE_HREF = OFFLINE_FILE.name


def versioned(url, content):
    """Append a content hash to a URL (`static/app.js?v=3f2a9c01de`).

    GitHub Pages serves everything with max-age=600, and a normal reload
    revalidates index.html but can reuse cached subresources — a deploy
    that changes the data format could pair new HTML with stale JS. The
    query makes every deploy's assets effectively immutable."""
    return f"{url}?v={hashlib.sha1(content).hexdigest()[:10]}"


def asset_url(path):
    """Versioned URL of a static asset as index.html sees it (relative to site/)."""
    return versioned(f"{STATIC_DIR.name}/{path.name}", path.read_bytes())


def build_site(upcoming, previous, data_updated):
    """Render the page shell around the normalized dataset into site/."""
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR),
                      autoescape=select_autoescape(("html",)))
    # Preserve dict order (sorted by count) instead of tojson's sorted keys.
    env.policies["json.dumps_kwargs"]["sort_keys"] = False
    # Compact separators — the dataset block is the page's bulk.
    env.policies["json.dumps_kwargs"]["separators"] = (",", ":")

    try:
        shutil.rmtree(SITE_DIR)
    except OSError:
        # Directory may be in use (e.g. a local dev server)
        print("Warning: Unable to remove site directory; overwriting in place.")
    SITE_DIR.mkdir(parents=True, exist_ok=True)

    if STATIC_DIR.exists():
        shutil.copytree(STATIC_DIR, SITE_DIR / STATIC_DIR.name, dirs_exist_ok=True)

    # Tell GitHub Pages not to run the site through Jekyll.
    (SITE_DIR / ".nojekyll").touch()

    dataset = build_dataset(upcoming, previous, data_updated)
    # Update text is ~half the gzipped dataset but only the modal's
    # Updates tab reads it — online it ships as launch-updates.js and
    # loads lazily. The offline build keeps the full dataset inline, so
    # it renders the untouched `dataset` below.
    core, updates = split_updates(dataset)
    updates_js = "receiveLaunchUpdates(" + json.dumps(updates, separators=(",", ":"), ensure_ascii=False) + ");"
    updates_file = SITE_DIR / "launch-updates.js"
    updates_file.write_text(updates_js, encoding="utf-8")
    core["meta"]["updates_src"] = versioned(updates_file.name, updates_js.encode("utf-8"))

    template = env.get_template("index.html")
    (SITE_DIR / "index.html").write_text(
        template.render(data=core, css_href=asset_url(CSS_FILE),
                        js_srcs=[asset_url(f) for f in JS_FILES],
                        offline_href=OFFLINE_HREF),
        encoding="utf-8")
    print(f"Site built in {SITE_DIR}/")

    build_offline_bundle(template, dataset)
