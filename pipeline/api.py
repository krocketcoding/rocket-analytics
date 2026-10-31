"""Fetch launch data from the Launch Library 2 API."""

import time

import requests

from .config import API_BASE, MAX_ATTEMPTS, PAGE_SIZE, RETRY_DELAY


def get_json(endpoint, params):
    """GET an LL2 launch endpoint with retries; return the decoded JSON.

    Only transient failures are retried — connection errors, timeouts,
    and 5xx. A 4xx (notably 429 rate limiting) raises immediately:
    retrying just burns more of LL2's small hourly quota."""
    error = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = requests.get(f"{API_BASE}/launch/{endpoint}/", params=params, timeout=60)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            status = getattr(e.response, "status_code", None)
            if status is not None and 400 <= status < 500:
                print(f"HTTP {status} from the API; not retrying")
                raise RuntimeError(f"Failed to fetch {endpoint} launches") from e
            error = e
            print(f"Attempt {attempt + 1} failed: {e}")
            if attempt + 1 < MAX_ATTEMPTS:
                time.sleep(RETRY_DELAY)
    # Every attempt failed; keep the last error attached for debugging.
    raise RuntimeError(f"Failed to fetch {endpoint} launches") from error


def fetch_launches(endpoint, pages):
    """Fetch up to `pages` pages of launches from an endpoint."""
    params = {"limit": PAGE_SIZE, "mode": "detailed"}
    if endpoint == "upcoming":
        # Soonest first, and skip anything that has already launched.
        params.update(ordering="net", hide_recent_previous="true")
    else:
        # Newest first so the most recent launches are fetched first.
        params["ordering"] = "-net"

    results = []
    for i in range(pages):
        data = get_json(endpoint, {**params, "offset": i * PAGE_SIZE})
        print(f"Got page {i + 1}")
        results.extend(data["results"])
        # The API links to the next page (or null at the end of the list).
        if not data.get("next"):
            print("No more pages to fetch.")
            break
    return results
