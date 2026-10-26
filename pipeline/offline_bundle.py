"""Produce the portable single-file offline build."""

import base64
import hashlib
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO

import requests
from PIL import Image

from .config import CSS_FILE, IMAGE_CACHE_DIR, IMAGE_QUALITY, JS_FILES, OFFLINE_FILE, PATCH_IMAGE_PX, ROCKET_IMAGE_PX


def inline_safe(code):
    """Escape closing tags so inlined code can't terminate its own element."""
    return re.sub(r"</(script|style)", r"<\\/\1", code, flags=re.IGNORECASE)


# Remote URL fields stripped from the offline dataset — nothing it
# references should need a network connection. Image fields are indices
# into the images table and stay; the table itself swaps URLs for data
# URIs or None.
EXTERNAL_FIELDS = {"info_url", "wiki_url", "map_url", "links", "mission_links"}


def scrub_external(value):
    """Recursively remove remote link URLs from dataset records."""
    if isinstance(value, dict):
        return {k: scrub_external(v) for k, v in value.items() if k not in EXTERNAL_FIELDS}
    if isinstance(value, list):
        return [scrub_external(v) for v in value]
    return value


def fetch_data_uri(url, max_px):
    """Download an image, downscale it, and return a data URI — or None."""
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content))
        img.thumbnail((max_px, max_px), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, "WEBP", quality=IMAGE_QUALITY)
    except Exception as e:
        print(f"Warning: Failed to fetch image from {url}: {e}")
        return None
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def image_cache_path(url, max_px):
    """Cache file for a processed image. The key covers every input that affects the output,
    so new size/quality settings invalidate old files."""
    key = hashlib.sha1(f"{url}|{max_px}|{IMAGE_QUALITY}".encode()).hexdigest()
    return IMAGE_CACHE_DIR / f"{key}.txt"


def embed_images(urls_px):
    """Return {url: data_uri}. Results are cached on disk, so repeat builds only download
    and compress images that are new."""
    images = {}
    misses = {}
    for url, px in urls_px.items():
        try:
            images[url] = image_cache_path(url, px).read_text(encoding="utf-8")
        except OSError:
            misses[url] = px

    if misses:
        print(f"Fetching {len(misses)} images ({len(images)} already cached)...")
        IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(fetch_data_uri, url, px): url for url, px in misses.items()}
            for fut in as_completed(futures):
                uri = fut.result()
                if not uri:
                    # Failures stay uncached and retry on the next build.
                    continue
                url = futures[fut]
                images[url] = uri
                try:
                    image_cache_path(url, misses[url]).write_text(uri, encoding="utf-8")
                except OSError:
                    pass

    # Drop cache files no longer referenced — launches churn off the feed
    # and size/quality changes mint new keys — so the dir can't grow
    # unbounded. Best-effort: a locked file just survives to next build.
    live = {image_cache_path(url, px) for url, px in urls_px.items()}
    pruned = 0
    for f in IMAGE_CACHE_DIR.glob("*.txt"):
        if f not in live:
            try:
                f.unlink()
                pruned += 1
            except OSError:
                pass
    if pruned:
        print(f"Pruned {pruned} stale image cache files")
    return images


def offline_dataset(dataset):
    """Offline variant of the dataset: remote link URLs are stripped and the
    images table swaps wanted URLs for embedded data URIs, leaving None
    elsewhere — indices stay stable so records need no changes."""
    # Mission patches and rocket photos are the images worth their bytes.
    # Rocket size wins if an image serves both roles.
    wanted = {}
    for d in dataset["upcoming"] + dataset["previous"]:
        for i in d.get("mission_patches") or []:
            wanted[i] = PATCH_IMAGE_PX
    for rocket in dataset["rockets"].values():
        if rocket.get("image") is not None:
            wanted[rocket["image"]] = ROCKET_IMAGE_PX

    embedded = embed_images({dataset["images"][i]: px for i, px in wanted.items()})
    print(f"Collected {len(embedded)}/{len(wanted)} images "
          f"({sum(len(u) for u in embedded.values()) // 1024} KB after compression)")

    images = [None] * len(dataset["images"])
    for i in wanted:
        uri = embedded.get(dataset["images"][i])
        if uri:
            images[i] = uri

    offline = {k: scrub_external(v) for k, v in dataset.items() if k != "images"}
    offline["images"] = images
    offline["meta"] = {**offline["meta"], "offline": True}
    return offline


def build_offline_bundle(template, dataset):
    """Render the site again as one offline HTML file with CSS, JS, and key images inlined."""
    try:
        js = "\n".join(f.read_text(encoding="utf-8") for f in JS_FILES)
        css = CSS_FILE.read_text(encoding="utf-8")
    except OSError:
        print(f"Warning: Skipping {OFFLINE_FILE}.")
        return
    offline = offline_dataset(dataset)
    html = template.render(data=offline, offline=True, inline_css=inline_safe(css), inline_js=inline_safe(js))
    OFFLINE_FILE.write_text(html, encoding="utf-8")
    print(f"Offline single-file build written to {OFFLINE_FILE}")
