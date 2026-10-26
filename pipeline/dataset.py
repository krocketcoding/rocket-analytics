"""Assemble the single normalized dataset handed to the front end.

The build renders ONE JSON blob: launch records reference shared entity
tables by id and image URLs by index into a deduplicated `images` list,
so nothing is shipped twice — no agency copy per launch, no repeated
pad location strings, no avatar URL per update. Aggregation (stats) and
rendering (tables, modals, charts) all happen in JavaScript off this
one structure; Jinja is only the page shell around it.
"""

from .config import PAGE_SIZE, PAST_LAUNCH_PAGES
from .details import AGENCY_FIELDS, LAUNCH_FIELDS, PAD_FIELDS, ROCKET_FIELDS, UPDATE_FIELDS, link_details, pick, pull


def drop_empty(value):
    """Recursively drop keys whose value is None, "" or [].

    False and 0 are kept — e.g. rocket active:false means Retired and a
    0 leo_capacity is real data, while an empty updates list adds
    nothing the frontend can't default."""
    if isinstance(value, dict):
        return {k: drop_empty(v) for k, v in value.items()
                if v is not None and v != "" and v != []}
    if isinstance(value, list):
        return [drop_empty(v) for v in value]
    return value


def build_dataset(upcoming, previous, data_updated):
    """Normalize the fetched launches into the dataset the site ships."""
    # Every unique image URL is interned once into `images`; records
    # carry the integer index instead of repeating the URL.
    images = []
    image_index = {}

    def img(url):
        if not url:
            return None
        if url not in image_index:
            image_index[url] = len(images)
            images.append(url)
        return image_index[url]

    # Raw entity objects collected by id. Agencies gather every sighting
    # (provider, mission agency, manufacturer) so the merge below can
    # pick the first non-null value per field across sources; the other
    # tables only need the first sighting.
    agency_sources = {}
    rocket_sources = {}
    pad_sources = {}
    statuses = {}
    programs = {}
    authors = {}

    def remember(table, obj):
        if obj and obj.get("id") is not None:
            table.setdefault(obj["id"], []).append(obj)

    def launch_record(launch):
        mission = launch.get("mission") or {}
        status = launch.get("status") or {}
        provider = launch.get("launch_service_provider") or {}
        config = pick(launch.get("rocket"), "configuration") or {}
        pad = launch.get("pad") or {}

        # Entities are collected only when the referencing id resolves —
        # an id-less provider dict can't be looked up, so it leaves no
        # orphan row in the agencies table.
        remember(agency_sources, provider)
        remember(rocket_sources, config)
        remember(agency_sources, config.get("manufacturer"))
        remember(pad_sources, pad)
        for agency in mission.get("agencies") or []:
            remember(agency_sources, agency)
        if status.get("id") is not None:
            statuses.setdefault(status["id"], {"name": status.get("name"), "abbrev": status.get("abbrev")})
        for prog in launch.get("program") or []:
            if prog.get("id") is not None:
                programs.setdefault(prog["id"], {"name": pick(prog, "name")})
        updates = [pull(u, UPDATE_FIELDS) for u in launch.get("updates") or []]
        for u in launch.get("updates") or []:
            if u.get("created_by") and u.get("profile_image"):
                authors.setdefault(u["created_by"], {"image": img(u["profile_image"])})

        return {
            **pull(launch, LAUNCH_FIELDS),
            "status_id": status.get("id"),
            "mission_name": mission.get("name"),
            "mission_type": mission.get("type"),
            "orbit": pick(mission.get("orbit"), "abbrev"),
            "mission_description": mission.get("description"),
            "mission_patches": [img(url) for p in launch.get("mission_patches") or []
                                if (url := pick(p, "image_url"))],
            "program_ids": [p["id"] for p in launch.get("program") or [] if p.get("id") is not None],
            "image": img(pick(launch.get("image"), "image_url")),
            "infographic": img(pick(launch.get("infographic"), "image_url")),
            # IDs into the entity tables, so the frontend looks details
            # up instead of embedding copies.
            "provider_id": provider.get("id"),
            "rocket_id": config.get("id"),
            "pad_id": pad.get("id"),
            "agency_ids": [a["id"] for a in mission.get("agencies") or [] if a.get("id") is not None],
            "updates": updates,
            "links": link_details(launch.get("infoURLs"), launch.get("vidURLs")),
            "mission_links": link_details(mission.get("info_urls"), mission.get("vid_urls")),
        }

    launches = {"upcoming": [launch_record(launch) for launch in upcoming],
                "previous": [launch_record(launch) for launch in previous]}

    def merged_agency(sources):
        """One agency row from several source sightings, first non-empty value per field."""
        detail = {}
        for src in sources:
            d = pull(src, AGENCY_FIELDS)
            d["image"] = pick(src.get("image_url") or src.get("image"), "image_url")
            for k, v in d.items():
                if detail.get(k) in (None, "") and v is not None:
                    detail[k] = v
        detail["image"] = img(detail.get("image"))
        return detail

    agencies = {aid: merged_agency(srcs) for aid, srcs in agency_sources.items()}

    rockets = {}
    for rid, srcs in rocket_sources.items():
        config = srcs[0]
        rocket = {
            "name": config.get("full_name") or config.get("name"),
            # Manufacturer details resolve through the agencies table
            # (the id is shared with providers and mission agencies).
            "manufacturer_id": (config.get("manufacturer") or {}).get("id"),
            **pull(config, ROCKET_FIELDS),
        }
        rocket["image"] = img(rocket["image"])
        rockets[rid] = rocket

    pads = {}
    locations = {}
    for pid, srcs in pad_sources.items():
        pad_obj = srcs[0]
        pad = pull(pad_obj, PAD_FIELDS)
        # Pads no longer repeat their location string — they point into
        # the locations table, which holds just name and country.
        loc = pad_obj.get("location") or {}
        if loc.get("id") is not None:
            pad["location_id"] = loc["id"]
            locations.setdefault(loc["id"], {"name": loc.get("name"), "country": loc.get("country_code")})
        pads[pid] = pad

    meta = {}
    if data_updated:
        meta["updated"] = data_updated
    # Results are fetched newest-first and may be cut off mid-year at the
    # page cap; the front end drops the oldest year when this is set.
    meta["truncated"] = len(previous) >= PAST_LAUNCH_PAGES * PAGE_SIZE

    return drop_empty({
        "meta": meta,
        "images": images,
        "upcoming": launches["upcoming"],
        "previous": launches["previous"],
        "agencies": agencies,
        "rockets": rockets,
        "pads": pads,
        "locations": locations,
        "statuses": statuses,
        "programs": programs,
        "authors": authors,
    })
