"""Shared configuration for the rocket-analytics site build."""

from pathlib import Path

UPCOMING_LAUNCH_PAGES = 2
PAGE_SIZE = 100
MAX_ATTEMPTS = 2
RETRY_DELAY = 10  # seconds between retries of a transient API failure

API_BASE = "https://ll.thespacedevs.com/2.2.0"
# Optional TheSpaceDevs API key, read from this environment variable.
# Anonymous requests share a small per-IP rate limit; a key raises it.
API_KEY_ENV = "LL2_API_KEY"
# Paths anchor to the repo root so the build and tests work from any
# working directory, not just the repo root.
ROOT = Path(__file__).resolve().parent.parent
SITE_DIR = ROOT / "site"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
LAUNCH_CACHE_FILE = ROOT / "launch-cache.json"
# Committed archive of deduplicated raw LL2 records; launch-archive/ is
# generated data but tracked so clones have a complete initial dataset.
ARCHIVE_DIR = ROOT / "launch-archive"
# Fallback seconds-between-requests for crawls when the api-throttle
# probe fails — the real pacing adapts to the quota it reports, so this
# just needs to be safely conservative (15/hr is the anonymous limit).
CRAWL_PAGE_DELAY = 3600 / 13

# Alternate output: a portable offline single-file build with all
# resources inlined.
OFFLINE_FILE = SITE_DIR / "rocket-analytics-offline.html"
CSS_FILE = STATIC_DIR / "style.css"
# Script files in load order: everything shares top-level bindings, so
# the vendored library and app.js come first and each chart file gets
# the globals its predecessors defined. stats.js computes STATS from the
# dataset before the chart code reads it, and workspace.js does the
# wiring, so it loads last.
JS_FILES = [STATIC_DIR / name for name in (
    "chart-library.min.js", "app.js", "stats.js", "chart-factories.js",
    "chart-defs.js", "charts.js", "tables.js", "workspace.js")]

# Images embedded in the offline build are downscaled to display size.
PATCH_IMAGE_PX = 128   # mission patches render at 72px
ROCKET_IMAGE_PX = 640  # rocket photos render full-width in the modal
IMAGE_QUALITY = 65     # WebP quality for embedded images
IMAGE_CACHE_DIR = ROOT / "image-cache"
