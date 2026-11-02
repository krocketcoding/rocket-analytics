"""Build the rocket-analytics static site.

Subcommands:
  build            render the site from launch-archive/ + launch-cache.json
                   (the default; add --fetch to pull the latest LL2 changes first)
  update-archive   fetch LL2 changes into launch-archive/ — no site build.
                   With no archive it performs the paced full-history crawl;
                   delete launch-archive/ first to force one (reconciles
                   upstream deletions alongside the count-probe sweep).
  verify           check entity counters in launch-archive/ against the
                   stored launch records
"""

import argparse
import itertools
import sys
from datetime import datetime, timedelta, timezone

from pipeline.api import fetch_launches, iter_previous_before, iter_previous_since, paced_pages, probe_count
from pipeline.archive import (clear_sweep, load_archive, load_sweep, max_last_updated,
                              merge_launches, merged_previous, new_entities, new_meta, oldest_net, prune,
                              save_archive, save_sweep, verify_archive)
from pipeline.build import build_site
from pipeline.config import UPCOMING_LAUNCH_PAGES
from pipeline.launch_cache import load_cache, merge_delta, save_cache

# Incremental fetches overlap the watermark by a day — the dedupe merge
# absorbs the re-fetched records, so clock skew can't drop changes.
WATERMARK_OVERLAP = timedelta(days=1)


def _cache_fresh(cached, max_age):
    """Cache counts as fresh only when --max-cache-age says so."""
    if cached is None or max_age is None:
        return False
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(cached[2]) <= max_age
    except (TypeError, ValueError):
        # A missing or malformed timestamp counts as stale.
        return False


def _watermark(*record_lists):
    return max_last_updated(itertools.chain.from_iterable(record_lists))


def _report_mismatches(problems):
    if not problems:
        print("Entity counters reconcile with the launch records.")
        return
    print(f"{len(problems)} counter mismatches vs LL2 totals "
          "(agency counts are known to differ; rocket/pad diffs suggest a bug):")
    for table, eid, name, field, claimed, actual in problems:
        print(f"  {table}/{eid} {name}: {field} claims {claimed}, archive has {actual}")


def cmd_build(args):
    """Offline build, or incremental fetch + build with --fetch."""
    max_age = timedelta(hours=args.max_cache_age) if args.max_cache_age is not None else None
    loaded = load_archive()
    entities, store, meta = loaded if loaded else (new_entities(), {}, {})
    cached = load_cache()
    if loaded is None and cached is None:
        sys.exit("No launch data — run `python main.py update-archive` first.")

    upcoming, delta = (cached[0], cached[1]) if cached else ([], [])
    if args.fetch and not _cache_fresh(cached, max_age):
        try:
            print(f"Fetching upcoming launches ({args.upcoming_pages} pages)...")
            upcoming = fetch_launches("upcoming", args.upcoming_pages)
            watermark = _watermark(store.values(), delta)
            since = (datetime.fromisoformat(watermark) - WATERMARK_OVERLAP).isoformat() if watermark else None
            print(f"Fetching previous launches changed since {since or 'the beginning'}...")
            delta = merge_delta(delta, [rec for page in paced_pages(iter_previous_since(since)) for rec in page])
            save_cache(upcoming, delta)
        except Exception as e:
            # A failed build is worse than stale data: fall back to
            # whatever the archive and cache hold, no matter their age.
            print(f"Fetch failed ({e}); building from stored data")

    previous = merged_previous(store, delta, entities)
    data_updated = _watermark(previous, upcoming) or (cached[2] if cached else None)
    # No archive means incomplete history by definition — flag it so the
    # front end doesn't trust the oldest year.
    build_site(upcoming, previous, data_updated, complete=bool(loaded and meta.get("complete")))


def cmd_update_archive(_args):
    """Fetch LL2 changes into launch-archive/; crawl from scratch when absent.

    Persists after every page, so an interrupted run resumes where it
    stopped instead of starting over. Writes only the archive — the cache
    and site are build's business."""
    loaded = load_archive()
    if loaded:
        entities, store, meta = loaded
    else:
        entities, store, meta = new_entities(), {}, new_meta()
        cached = load_cache()
        if cached and cached[1]:
            # Seed from the existing cache
            print(f"Seeding archive with {len(cached[1])} cached launches...")
            merge_launches(store, entities, cached[1])

    api_count = None

    def stats():
        return {"launch_count": len(store), "api_count": api_count,
                "max_last_updated": max_last_updated(store.values())}

    # save_archive persists after every page, so by the final call only
    # meta.json is still dirty — count distinct paths across the whole
    # run or the summary always reports ~1 file.
    written = set()

    def persist():
        written.update(save_archive(entities, store, meta))

    try:
        if not meta.get("complete"):
            # Crawl newest->oldest; resume_net tracks the frontier so a
            # restart continues instead of repeating finished pages.
            resume_net = meta.get("resume_net") or oldest_net(store)
            print("Crawling full launch history...")
            for page in paced_pages(iter_previous_before(resume_net)):
                merge_launches(store, entities, page)
                meta.update(complete=False, resume_net=oldest_net(store), **stats())
                persist()
            meta.update(complete=True)
            meta.pop("resume_net", None)
            print(f"Crawl complete: {len(store)} launches")

        if store:
            # Incremental: only records changed since the archive watermark.
            since = (datetime.fromisoformat(stats()["max_last_updated"]) - WATERMARK_OVERLAP).isoformat()
            print(f"Fetching records changed since {since}...")
            for page in paced_pages(iter_previous_since(since)):
                merge_launches(store, entities, page)
                meta.update(**stats())
                persist()
                print(f"{len(store)} launches; watermark {meta['max_last_updated']}")

        # Deletion sweep: LL2 never reports removals, so when the API's
        # count is smaller than ours we diff full id lists — checkpointed in
        # sweep.json so it can span runs at crawl pacing. The probe runs
        # AFTER the merges so new records can't masquerade as deletions.
        sweep = load_sweep()
        if sweep is not None:
            api_count = None
        else:
            try:
                api_count = probe_count()
            except Exception as e:
                print(f"Count probe failed ({e}); skipping the sweep check")
        if sweep is not None or (api_count is not None and api_count < len(store)):
            sweep = sweep or {"started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                              "resume_net": None, "seen": []}
            print("API count is below archive count — sweeping for deleted launches...")
            for page in paced_pages(iter_previous_before(sweep["resume_net"], mode="list")):
                for rec in page:
                    if rec.get("id") is not None:
                        sweep["seen"].append(rec["id"])
                    sweep["resume_net"] = rec.get("net") or sweep["resume_net"]
                save_sweep(sweep)
                print(f"Sweep progress: {len(sweep['seen'])} ids")
            removed = prune(store, entities, set(sweep["seen"]), sweep["started_at"])
            print(f"Sweep complete: pruned {removed} deleted launches")
            clear_sweep()
    except RuntimeError as e:
        # get_json gave up — a 429 racing the quota probe, or retries
        # exhausted. Pages checkpoint into the archive as they land (and
        # sweeps into sweep.json), so stop cleanly; a rerun resumes here.
        sys.exit(f"Fetch failed: {e} — progress saved; rerun update-archive to resume")

    meta.update(**stats(), generated_at=datetime.now(timezone.utc).isoformat(), complete=True)
    persist()
    print(f"Archive updated ({len(store)} launches, {len(written)} files written)")
    if meta.get("complete"):
        # A truncated archive can't reconcile — only worth checking whole.
        _report_mismatches(verify_archive(entities, store))


def cmd_verify(_args):
    """Check entity counters in launch-archive/ against the stored records."""
    loaded = load_archive()
    if not loaded:
        sys.exit("No launch archive — run `python main.py update-archive` first.")
    entities, store, meta = loaded
    if not meta.get("complete"):
        print("Archive is incomplete — totals won't reconcile until the crawl finishes.")
    _report_mismatches(verify_archive(entities, store))


def main():
    """Entry point for the script."""
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command")
    b = sub.add_parser("build", help="render the site (offline unless --fetch)")
    b.add_argument("--fetch", action="store_true", help="fetch the latest changes from the API first")
    b.add_argument("--max-cache-age", type=float, metavar="HOURS",
                   help="with --fetch: skip the fetch when the cache is younger than this many hours")
    b.add_argument("--upcoming-pages", type=int, default=UPCOMING_LAUNCH_PAGES, metavar="N",
                   help=f"pages of upcoming launches to fetch (default: {UPCOMING_LAUNCH_PAGES})")
    sub.add_parser("update-archive",
                   help="fetch LL2 changes into launch-archive/ (full crawl when absent)")
    sub.add_parser("verify", help="check entity counters against the stored launch records")
    # Bare `python main.py` (or flags alone) means `build`.
    argv = sys.argv[1:]
    if not argv or argv[0] not in ("build", "update-archive", "verify", "-h", "--help"):
        argv = ["build"] + argv
    args = parser.parse_args(argv)
    if args.command == "update-archive":
        cmd_update_archive(args)
    elif args.command == "verify":
        cmd_verify(args)
    else:
        if args.upcoming_pages < 1:
            parser.error("--upcoming-pages must be at least 1")
        if args.max_cache_age is not None and not args.fetch:
            print("Warning: --max-cache-age has no effect without --fetch")
        cmd_build(args)


if __name__ == "__main__":
    main()
