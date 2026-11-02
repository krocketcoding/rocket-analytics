"""Fetch launch data from the Launch Library 2 API."""

import os
import time

import requests

from .config import (API_BASE, API_KEY_ENV, CRAWL_PAGE_DELAY, MAX_ATTEMPTS, PAGE_SIZE, RETRY_DELAY)


def get_json(endpoint, params):
    """GET an LL2 launch endpoint with retries; return the decoded JSON.

    Only transient failures are retried — connection errors, timeouts,
    and 5xx. A 4xx (notably 429 rate limiting) raises immediately:
    retrying just burns more of LL2's small hourly quota."""
    # LL2 authenticates with a "Token"-scheme header; without a key the
    # request counts against the anonymous per-IP rate limit.
    api_key = os.environ.get(API_KEY_ENV)
    headers = {"Authorization": f"Token {api_key}"} if api_key else {}
    error = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = requests.get(f"{API_BASE}/launch/{endpoint}/", params=params, headers=headers, timeout=60)
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


def iter_launch_pages(endpoint, params):
    """Yield each page of results from an endpoint, following `next` to the end.

    One HTTP request per yielded page, so callers can checkpoint between
    pages and pace themselves against LL2's hourly quota."""
    params = {"limit": PAGE_SIZE, **params}
    offset = 0
    while True:
        data = get_json(endpoint, {**params, "offset": offset})
        print(f"Fetched {len(data['results'])} {endpoint} launches "
              f"(offset {offset} of {data.get('count', '?')})")
        yield data["results"]
        if not data.get("next"):
            break
        offset += PAGE_SIZE


def iter_previous_since(last_updated, mode="detailed"):
    """Yield previous-launch pages modified since `last_updated`, oldest change first.

    Ascending last_updated order means each page's records all postdate
    the previous page's — a caller can advance its watermark after every
    page and safely resume if interrupted."""
    params = {"ordering": "last_updated", "mode": mode}
    if last_updated:
        params["last_updated__gte"] = last_updated
    return iter_launch_pages("previous", params)


def iter_previous_before(net=None, mode="detailed"):
    """Yield previous-launch pages newest-first, optionally before `net`.

    A `net` cursor (instead of offset) stays stable when launches are
    added or moved mid-crawl: paginating by offset could skip or repeat
    records as the result set shifts underneath."""
    params = {"ordering": "-net", "mode": mode}
    if net:
        params["net__lt"] = net
    return iter_launch_pages("previous", params)


def probe_count():
    """Total previous-launch count from the API (one request, one record)."""
    return get_json("previous", {"limit": 1})["count"]


def throttle_status():
    """The caller's LL2 rate-limit state, as reported by the api-throttle endpoint.

    LL2 documents this endpoint as free — it reports the quota without
    counting a request against it. Shape: {"your_request_limit": N,
    "limit_frequency_secs": S, "current_use": N, "next_use_secs": N}."""
    api_key = os.environ.get(API_KEY_ENV)
    headers = {"Authorization": f"Token {api_key}"} if api_key else {}
    return requests.get(f"{API_BASE}/api-throttle/", headers=headers, timeout=60).json()


# Requests to keep in reserve so a crawl doesn't brick other API users
# sharing the quota (e.g. a scheduled build overlapping a manual run).
QUOTA_MARGIN = 1
# Wait before re-probing when the endpoint reports exhaustion without a
# reset hint — avoids busy-looping a free endpoint.
QUOTA_RETRY_SECS = 60


def paced_pages(page_iter):
    """Yield launch pages, pausing only when the LL2 quota is actually empty.

    The throttle endpoint reports the real remaining budget — keyed or
    anonymous, shared or solo — so we consume it immediately and only
    sleep when it reports exhaustion. The budget check runs before each
    fetch (including the first): pulling a page first would die on a 429
    whenever the quota was already empty. Falls back to the static crawl
    delay if the probe fails."""
    remaining = 0
    pages = iter(page_iter)
    while True:
        while remaining <= 0:
            try:
                status = throttle_status()
            except requests.RequestException:
                # Can't read the quota; assume a conservative fixed pace.
                remaining = 1
                time.sleep(CRAWL_PAGE_DELAY)
                break
            remaining = max(status["your_request_limit"] - status["current_use"] - QUOTA_MARGIN, 0)
            if remaining == 0:
                wait = max(status.get("next_use_secs") or 0, QUOTA_RETRY_SECS)
                print(f"API quota exhausted; waiting {wait}s for it to refill...")
                time.sleep(wait)
        try:
            page = next(pages)  # triggers the HTTP request for this page
        except StopIteration:
            return
        yield page
        remaining -= 1
