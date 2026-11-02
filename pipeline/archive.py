"""The committed launch archive: deduplicated raw LL2 records as JSONL.

launch-archive/ is the durable half of the launch store (launch-cache.json
is the ephemeral delta). Slim records keep the full raw API shape minus
three things: shared nested entities are hoisted into per-table files
keyed by id, and self-referencing `url`/`slug` fields are dropped — the
API URL of any LL2 object is derivable from its id. ~60% of a raw record
is repeated entities, so this cuts the committed size by more than half
without losing any field a future feature might want.

Layout under launch-archive/:
  meta.json            generation state, watermarks, attribution
  entities/*.jsonl     one raw entity object per line, sorted by id
  launches/YYYY.jsonl  one slim launch per line, sorted by net
  sweep.json           transient deletion-sweep state (deleted on finish)

Builds rehydrate slim records back into the raw shapes dataset.py
expects, so nothing downstream of load_archive() knows the archive
format exists.
"""

import json
from datetime import datetime, timezone

from .config import ARCHIVE_DIR

# Shared nested objects hoisted out of launches into these tables. Pads
# embed their location and rockets embed their manufacturer, so those
# never need their own table.
ENTITY_TABLES = ("agencies", "rockets", "pads", "programs")

META_FILE = "meta.json"
SWEEP_FILE = "sweep.json"
# Merged into meta so readers can tell a finished archive from a
# half-crawled one; the dataset marks itself truncated when incomplete.
LL2_VERSION = "2.2.0"


def _scrub(value):
    """Drop self-referencing url/slug keys from LL2 objects.

    Only dicts carrying an `id` are touched: link lists (infoURLs,
    vidURLs, update info_url) use `url` for real links and have no id —
    scrubbing them would destroy the data."""
    if isinstance(value, dict):
        drop = ("url", "slug") if "id" in value else ()
        return {k: _scrub(v) for k, v in value.items() if k not in drop}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def _ref(value, table, entities):
    """Return {"id": N} for an id-bearing object, registering it in `entities` (last sighting wins)."""
    if not (isinstance(value, dict) and value.get("id") is not None):
        return value
    if entities is not None:
        entities[table][value["id"]] = _scrub(value)
    return {"id": value["id"]}


def slim(launch, entities=None):
    """Size-reduced copy of a raw launch for the archive.

    Shared nested entities become {"id": N} refs; everything else —
    launcher_stage, spacecraft_stage, mission, timeline, vidURLs,
    updates, last_updated — is kept verbatim."""
    l = _scrub(launch)
    l["launch_service_provider"] = _ref(l.get("launch_service_provider"), "agencies", entities)
    rocket = dict(l.get("rocket") or {})
    if "configuration" in rocket:
        rocket["configuration"] = _ref(rocket["configuration"], "rockets", entities)
    l["rocket"] = rocket or None
    l["pad"] = _ref(l.get("pad"), "pads", entities)
    mission = dict(l.get("mission") or {})
    if "agencies" in mission:
        mission["agencies"] = [_ref(a, "agencies", entities) for a in mission["agencies"] or []]
    l["mission"] = mission or None
    if "program" in l:
        l["program"] = [_ref(p, "programs", entities) for p in l["program"] or []]
    return l


def rehydrate(launch, entities):
    """Expand a slim launch back into the raw shape dataset.py expects.

    Refs are exactly {"id": N}; anything else (full objects, None) passes
    through. Unresolvable refs become None or are dropped from lists —
    better a missing field than a stub {"id"} row in the entity tables."""
    l = dict(launch)

    def resolve(value, table):
        if isinstance(value, dict) and set(value) == {"id"}:
            return entities[table].get(value["id"])
        return value

    l["launch_service_provider"] = resolve(l.get("launch_service_provider"), "agencies")
    rocket = dict(l.get("rocket") or {})
    if "configuration" in rocket:
        rocket["configuration"] = resolve(rocket["configuration"], "rockets")
    l["rocket"] = rocket or None
    l["pad"] = resolve(l.get("pad"), "pads")
    mission = dict(l.get("mission") or {})
    if "agencies" in mission:
        mission["agencies"] = [a for x in mission["agencies"] if (a := resolve(x, "agencies"))]
    l["mission"] = mission or None
    if "program" in l:
        l["program"] = [p for x in l["program"] if (p := resolve(x, "programs"))]
    return l


def _refs(rec):
    """Entity refs held by a slim record -> {table: set(ids)}."""
    out = {t: set() for t in ENTITY_TABLES}

    def add(table, value):
        if isinstance(value, dict) and set(value) == {"id"}:
            out[table].add(value["id"])

    add("agencies", rec.get("launch_service_provider"))
    add("rockets", (rec.get("rocket") or {}).get("configuration"))
    add("pads", rec.get("pad"))
    for a in (rec.get("mission") or {}).get("agencies") or []:
        add("agencies", a)
    for p in rec.get("program") or []:
        add("programs", p)
    return out


def new_entities():
    return {t: {} for t in ENTITY_TABLES}


def new_meta():
    """Fresh meta.json for a new (incomplete) archive, with attribution."""
    return {
        "format_version": 1,
        "ll2_version": LL2_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "launch_count": 0,
        "complete": False,
        "source": {
            "name": "Launch Library 2 (The Space Devs)",
            "url": "https://thespacedevs.com/llapi/",
            "terms": "https://github.com/TheSpaceDevs/Tutorials/blob/main/faqs/faq_TSD.md",
        },
    }


def merge_launches(store, entities, fresh):
    """Merge raw launches into the slim store; newer last_updated wins per id."""
    for raw in fresh:
        lid = raw.get("id")
        if lid is None:
            continue
        cur = store.get(lid)
        if cur is None or (raw.get("last_updated") or "") > (cur.get("last_updated") or ""):
            store[lid] = slim(raw, entities)


def merged_previous(store, delta, entities):
    """Rehydrated previous launches: archive ∪ cache delta, newer last_updated wins per id.

    Archive records rehydrate; delta records are already raw API shape.
    A delta record only wins when the archive has nothing newer, so a
    stale cache can never roll back a freshly updated archive."""
    delta_by_id = {r["id"]: r for r in delta if r.get("id") is not None}
    result = []
    for lid, rec in store.items():
        fresh = delta_by_id.pop(lid, None)
        if fresh is not None and (fresh.get("last_updated") or "") > (rec.get("last_updated") or ""):
            result.append(fresh)
        else:
            result.append(rehydrate(rec, entities))
    result.extend(delta_by_id.values())
    result.sort(key=lambda l: l.get("net") or "", reverse=True)
    return result


def prune(store, entities, api_ids, sweep_started):
    """Drop archived launches absent from the API id set, then GC entities.

    Records whose last_updated postdates `sweep_started` are kept even
    when missing from api_ids — they were inserted mid-sweep, so their
    absence proves nothing. Entities are pruned by a full reference scan
    over surviving records (a deleted launch may share an entity with
    survivors)."""
    removed = [lid for lid, rec in store.items()
               if lid not in api_ids and (rec.get("last_updated") or "") < sweep_started]
    for lid in removed:
        del store[lid]
    for table in ENTITY_TABLES:
        live = {rid for rec in store.values() for rid in _refs(rec)[table]}
        entities[table] = {k: v for k, v in entities[table].items() if k in live}
    return len(removed)


def max_last_updated(records):
    """Newest last_updated across records, or None — the incremental-fetch watermark."""
    stamps = [r.get("last_updated") for r in records if r.get("last_updated")]
    return max(stamps) if stamps else None


def oldest_net(store):
    """Oldest net in the slim store — the crawl resume cursor."""
    nets = [rec.get("net") for rec in store.values() if rec.get("net")]
    return min(nets) if nets else None


def _line(obj):
    return json.dumps(obj, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def _year(rec):
    # net is ISO ("2026-10-31T04:04:34Z"); launches without one shard together.
    return (rec.get("net") or "")[:4] or "unknown"


def load_archive(archive_dir=ARCHIVE_DIR):
    """Read the archive -> (entities, store, meta), or None if absent."""
    meta_file = archive_dir / META_FILE
    if not meta_file.exists():
        return None
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    entities = new_entities()
    for table in ENTITY_TABLES:
        path = archive_dir / "entities" / f"{table}.jsonl"
        if not path.exists():
            continue
        # Split on \n only: ensure_ascii=False leaves U+2028/U+2029 raw in
        # strings, and splitlines() would cut records at those.
        for line in path.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                obj = json.loads(line)
                entities[table][obj["id"]] = obj
    store = {}
    launches_dir = archive_dir / "launches"
    if launches_dir.exists():
        for path in sorted(launches_dir.glob("*.jsonl")):
            for line in path.read_text(encoding="utf-8").split("\n"):
                if line.strip():
                    rec = json.loads(line)
                    store[rec["id"]] = rec
    return entities, store, meta


def save_archive(entities, store, meta, archive_dir=ARCHIVE_DIR):
    """Write only the shards whose content changed; return written paths."""
    written = []

    def write_if_changed(path, text):
        if not (path.exists() and path.read_text(encoding="utf-8") == text):
            path.parent.mkdir(parents=True, exist_ok=True)
            # newline="" stops text mode translating \n to os.linesep —
            # the shards are pinned to eol=lf in .gitattributes.
            path.write_text(text, encoding="utf-8", newline="")
            written.append(path)

    for table in ENTITY_TABLES:
        rows = (entities[table][k] for k in sorted(entities[table]))
        text = "".join(_line(o) + "\n" for o in rows)
        write_if_changed(archive_dir / "entities" / f"{table}.jsonl", text)

    # Group slim records by launch year; a shard only rewrites when one
    # of its records changed, so frozen years are never touched.
    by_year = {}
    for rec in store.values():
        by_year.setdefault(_year(rec), []).append(rec)
    launches_dir = archive_dir / "launches"
    expected = set()
    for year, recs in by_year.items():
        recs.sort(key=lambda r: (r.get("net") or "", r["id"]))
        expected.add(f"{year}.jsonl")
        write_if_changed(launches_dir / f"{year}.jsonl", "".join(_line(r) + "\n" for r in recs))
    if launches_dir.exists():
        for stale in launches_dir.glob("*.jsonl"):
            if stale.name not in expected:
                # A year emptied by the deletion sweep; its file goes away.
                stale.unlink()
                written.append(stale)

    # meta.json is human-inspected state (not a shard), so it gets the
    # readable multi-line format rather than the compact JSONL style.
    meta_text = json.dumps(meta, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    write_if_changed(archive_dir / META_FILE, meta_text)
    return written


def load_sweep(archive_dir=ARCHIVE_DIR):
    """In-progress sweep state, or None."""
    try:
        return json.loads((archive_dir / SWEEP_FILE).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_sweep(sweep, archive_dir=ARCHIVE_DIR):
    archive_dir.mkdir(parents=True, exist_ok=True)
    (archive_dir / SWEEP_FILE).write_text(_line(sweep) + "\n", encoding="utf-8", newline="")


def clear_sweep(archive_dir=ARCHIVE_DIR):
    try:
        (archive_dir / SWEEP_FILE).unlink()
    except OSError:
        pass
