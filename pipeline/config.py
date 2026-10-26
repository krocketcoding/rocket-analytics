"""Shared configuration for the rocket-analytics site build."""

from pathlib import Path

PAST_LAUNCH_PAGES = 12
UPCOMING_LAUNCH_PAGES = 2
PAGE_SIZE = 100
MAX_ATTEMPTS = 2

API_BASE = "https://ll.thespacedevs.com/2.2.0"
SITE_DIR = Path("site")
TEMPLATES_DIR = Path("templates")
STATIC_DIR = Path("static")
LAUNCH_CACHE_FILE = Path("launch-cache.json")

# Alternate output: a portable offline single-file build with all
# resources inlined.
OFFLINE_FILE = SITE_DIR / "rocket-analytics-offline.html"
CHARTJS_FILE = STATIC_DIR / "chart-library.min.js"
APPJS_FILE = STATIC_DIR / "app.js"
CHART_FACTORIES_FILE = STATIC_DIR / "chart-factories.js"
CHART_DEFS_FILE = STATIC_DIR / "chart-defs.js"
CHARTS_FILE = STATIC_DIR / "charts.js"
WORKSPACE_FILE = STATIC_DIR / "workspace.js"
CSS_FILE = STATIC_DIR / "style.css"
# Script files in load order: everything shares top-level bindings, so
# the vendored library and app.js come first and each chart file gets
# the globals its predecessors defined. workspace.js does the wiring, so
# it loads last.
JS_FILES = [CHARTJS_FILE, APPJS_FILE, CHART_FACTORIES_FILE,
            CHART_DEFS_FILE, CHARTS_FILE, WORKSPACE_FILE]

# Images embedded in the offline build are downscaled to display size.
PATCH_IMAGE_PX = 128   # mission patches render at 72px
ROCKET_IMAGE_PX = 640  # rocket photos render full-width in the modal
IMAGE_QUALITY = 65     # WebP quality for embedded images
IMAGE_CACHE_DIR = Path("image-cache")
