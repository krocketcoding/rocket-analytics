"""Render the site template and copy static assets into site/."""

import shutil

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .config import CSS_FILE, JS_FILES, OFFLINE_FILE, SITE_DIR, STATIC_DIR, TEMPLATES_DIR
from .details import collect_entities, launch_detail
from .offline_bundle import build_offline_bundle
from .stats import compute_stats

# Asset URLs as index.html will see them — relative to site/, matching
# where the static directory is copied below.
CSS_HREF = f"{STATIC_DIR.name}/{CSS_FILE.name}"
JS_SRCS = [f"{STATIC_DIR.name}/{f.name}" for f in JS_FILES]
OFFLINE_HREF = OFFLINE_FILE.name


def build_context(upcoming, previous, entities, data_updated):
    """Assemble the Jinja template context from launches and entities."""
    return dict(
        upcoming=upcoming,
        previous=previous,
        upcoming_detail=[launch_detail(launch) for launch in upcoming],
        previous_detail=[launch_detail(launch) for launch in previous],
        entities=entities,
        # Rocket table rows ordered by launch count, then LEO capacity,
        # then name.
        rocket_rows=sorted(entities["rockets"].items(),
                           key=lambda kv: (-(kv[1].get("launches") or 0),
                                           -(kv[1].get("leo_capacity") or 0),
                                           kv[1].get("name") or "")),
        stats=compute_stats(entities["rockets"], previous),
        data_updated=data_updated,
    )


def build_site(upcoming, previous, data_updated):
    """Render templates and copy static assets into the site directory."""
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR),
                      autoescape=select_autoescape(("html",)))
    # Preserve dict order (sorted by count) instead of tojson's sorted keys.
    env.policies["json.dumps_kwargs"]["sort_keys"] = False

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

    entities = collect_entities(upcoming + previous)
    template = env.get_template("index.html")
    context = build_context(upcoming, previous, entities, data_updated)
    (SITE_DIR / "index.html").write_text(
        template.render(context, css_href=CSS_HREF, js_srcs=JS_SRCS, offline_href=OFFLINE_HREF),
        encoding="utf-8")
    print(f"Site built in {SITE_DIR}/")

    build_offline_bundle(template, context)

