"""Field curation specs for the normalized dataset.

The API returns very large launch objects; the `*_FIELDS` specs and the
`pick`/`pull` helpers copy just the fields the site uses into flat
dicts. `pipeline/dataset.py` drives these specs to build the single
JSON blob the front end ships with.
"""


def pick(value, key):
    """Return value[key] if value is a dict, else the value itself."""
    return value.get(key) if isinstance(value, dict) else value


def pull(source, spec):
    """Copy fields from a dict. Spec items are 'key' for same-named copies or (dest, 'key' | 'key.subkey')
    to rename/unwrap — e.g. the spec ['name', ('orbit', 'orbit.abbrev')] maps source['name'] to
    out['name'] and source['orbit']['abbrev'] to out['orbit']."""
    out = {}
    for item in spec:
        if isinstance(item, str):
            out[item] = source.get(item)
        else:
            dest, path = item
            key, _, sub = path.partition(".")
            out[dest] = pick(source.get(key), sub) if sub else source.get(key)
    return out


# Launch-record stats shared by agency and rocket detail payloads.
RECORD_FIELDS = [
    ("launches", "total_launch_count"), ("successful", "successful_launches"), ("failed", "failed_launches"),
    ("pending", "pending_launches"), ("streak", "consecutive_successful_launches"),
    ("landings_attempted", "attempted_landings"), ("landings_successful", "successful_landings"),
    ("landings_failed", "failed_landings"), ("landing_streak", "consecutive_successful_landings"),
]

# Providers, mission agencies, and rocket manufacturers are the same
# shape — the dataset merges all three into one agencies table keyed by id.
AGENCY_FIELDS = [
    "name", "abbrev", ("type", "type.name"), ("country", "country_code"), "description", "administrator",
    ("founded", "founding_year"), "launchers", "spacecraft", "info_url", "wiki_url", *RECORD_FIELDS,
]

ROCKET_FIELDS = [
    "family", "variant", "active", "reusable", "description", "length", "diameter", "launch_mass",
    "leo_capacity", "gto_capacity", ("thrust", "to_thrust"), "maiden_flight", "launch_cost", "alias",
    "min_stage", "max_stage", "apogee", "vehicle_range", ("image", "image_url"), "info_url", "wiki_url",
    *RECORD_FIELDS,
]

PAD_FIELDS = [
    "name", "description", "latitude", "longitude", "map_url", "info_url", "wiki_url",
    ("launches", "total_launch_count"),
]

# Launch fields copied verbatim. status/image/infographic are absent:
# the status becomes an id into the statuses table, and image URLs
# become indices into the shared images table — dataset.py fills those in.
LAUNCH_FIELDS = [
    "name", "net", "window_start", "window_end", "probability", "webcast_live", "failreason", "holdreason",
    "weather_concerns", ("attempts_location", "location_launch_attempt_count"),
    ("attempts_location_year", "location_launch_attempt_count_year"), "pad_turnaround",
]

# profile_image is absent: the author avatar URL is interned into the
# images table once per author and resolved via authors[created_by] —
# repeating it per update was ~1.4 MB of the old payload.
UPDATE_FIELDS = ["comment", "info_url", "created_on", "created_by"]


def link_details(*url_lists):
    """Normalize info/vid URL entries, which may be dicts or bare strings."""
    links = []
    for entries in url_lists:
        for entry in entries or []:
            url = pick(entry, "url")
            if not url:
                continue
            link = {"url": url}
            if isinstance(entry, dict):
                link["label"] = pick(entry.get("type"), "name")
            links.append(link)
    return links
