"""Read and write the local launch data cache."""

import json
from datetime import datetime, timezone

from .config import LAUNCH_CACHE_FILE


def load_cache(max_age=None):
    """Return cached (upcoming, previous, last_updated), or None. If `max_age` (a timedelta) is given,
    reject caches older than that."""
    try:
        data = json.loads(LAUNCH_CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("Warning: Could not load cache file.")
        return None

    upcoming, previous = data.get("upcoming", []), data.get("previous", [])
    if not upcoming or not previous:
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
    return upcoming, previous, last_updated


def save_cache(upcoming, previous):
    """Save the fetched launches to the cache file; return last_updated."""
    last_updated = datetime.now(timezone.utc).isoformat()
    try:
        # Compact separators — CI restores and rewrites this file every
        # run, and api-examples/ already shows the raw launch shape to
        # anyone curious about the contents.
        LAUNCH_CACHE_FILE.write_text(
            json.dumps({"upcoming": upcoming, "previous": previous, "last_updated": last_updated},
                       separators=(",", ":")),
            encoding="utf-8")
        print("Cache saved successfully.")
    except OSError:
        print("Warning: Could not save cache file.")
    return last_updated
