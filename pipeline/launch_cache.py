"""Read and write the local launch data cache.

The cache is the ephemeral delta store next to the committed
launch-archive/: it holds `upcoming` plus `previous_delta` — previous
launches fetched since the archive was last updated. The full previous
set is always reconstructable as archive ∪ delta, so the file stays a
few MB instead of duplicating the archive's whole history."""

import json
from datetime import datetime, timezone

from .config import LAUNCH_CACHE_FILE


def load_cache(max_age=None):
    """Return cached (upcoming, previous_delta, last_updated), or None. If `max_age` (a timedelta) is given,
    reject caches older than that."""
    try:
        data = json.loads(LAUNCH_CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("Warning: Could not load cache file.")
        return None

    # Legacy caches named the delta list "previous"; read either key.
    upcoming, delta = data.get("upcoming", []), data.get("previous_delta") or data.get("previous", [])
    if not upcoming:
        print("Warning: Cache file is missing data.")
        return None

    last_updated = data.get("last_updated")
    if max_age is not None:
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(last_updated)
        except (TypeError, ValueError):
            # A missing or malformed timestamp counts as stale.
            age = None
        if age is None or age > max_age:
            print(f"Cache is stale ({last_updated}); refreshing.")
            return None
    return upcoming, delta, last_updated


def merge_delta(old, new):
    """Merge two raw previous-launch lists by id; newer last_updated wins."""
    by_id = {r["id"]: r for r in old if r.get("id") is not None}
    for r in new:
        lid = r.get("id")
        if lid is not None and (lid not in by_id or (r.get("last_updated") or "") > (by_id[lid].get("last_updated") or "")):
            by_id[lid] = r
    return list(by_id.values())


def save_cache(upcoming, delta):
    """Save the fetched launches to the cache file; return last_updated."""
    last_updated = datetime.now(timezone.utc).isoformat()
    try:
        # Compact separators — this file is rewritten every fetch and
        # never read by humans.
        LAUNCH_CACHE_FILE.write_text(
            json.dumps({"upcoming": upcoming, "previous_delta": delta, "last_updated": last_updated},
                       separators=(",", ":")),
            encoding="utf-8")
        print("Cache saved successfully.")
    except OSError:
        print("Warning: Could not save cache file.")
    return last_updated
