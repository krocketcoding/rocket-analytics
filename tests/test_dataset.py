"""Sanity checks for pipeline.dataset and the offline variant, run against the real launch cache.

These pin the normalized-dataset invariants (every id reference resolves, no orphan
entities or unreferenced images, no empty values, the truncation flag) so a regression
in the transform layer fails loudly instead of shipping a dataset the front end can't
render. Run from the repo root with: python -m unittest discover tests
"""

import copy
import json
import unittest
from pathlib import Path
from unittest import mock

from pipeline.config import PAGE_SIZE, PAST_LAUNCH_PAGES
from pipeline.dataset import build_dataset, split_updates
from pipeline.offline_bundle import offline_dataset

CACHE = Path(__file__).resolve().parents[1] / "launch-cache.json"

# Remote link fields the offline variant scrubs out of every record.
URL_FIELDS = {"info_url", "wiki_url", "map_url", "links", "mission_links"}


def walk(value):
    """Yield every dict nested anywhere in a structure."""
    if isinstance(value, dict):
        yield value
        for v in value.values():
            yield from walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from walk(v)


def image_indices(data):
    """Every image-table index referenced by any record."""
    idx = set()
    for launch in data["upcoming"] + data["previous"]:
        for key in ("image", "infographic"):
            if key in launch:
                idx.add(launch[key])
        idx.update(launch.get("mission_patches", []))
    for table in ("agencies", "rockets"):
        for rec in data[table].values():
            if "image" in rec:
                idx.add(rec["image"])
    for author in data["authors"].values():
        if "image" in author:
            idx.add(author["image"])
    return idx


@unittest.skipUnless(CACHE.exists(), "requires launch-cache.json")
class DatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
        cls.raw = cache["upcoming"] + cache["previous"]
        cls.previous = cache["previous"]
        cls.data = build_dataset(cache["upcoming"], cls.previous, cache["last_updated"])
        cls.launches = cls.data["upcoming"] + cls.data["previous"]

    def test_every_reference_resolves(self):
        d = self.data
        for launch in self.launches:
            if "provider_id" in launch:
                self.assertIn(launch["provider_id"], d["agencies"])
            for aid in launch.get("agency_ids", []):
                self.assertIn(aid, d["agencies"])
            if "rocket_id" in launch:
                self.assertIn(launch["rocket_id"], d["rockets"])
            if "pad_id" in launch:
                self.assertIn(launch["pad_id"], d["pads"])
            if "status_id" in launch:
                self.assertIn(launch["status_id"], d["statuses"])
            for pid in launch.get("program_ids", []):
                self.assertIn(pid, d["programs"])
        for rid, rocket in d["rockets"].items():
            if "manufacturer_id" in rocket:
                self.assertIn(rocket["manufacturer_id"], d["agencies"], f"rocket {rid}")
        for pid, pad in d["pads"].items():
            if "location_id" in pad:
                self.assertIn(pad["location_id"], d["locations"], f"pad {pid}")
        # Authors hold only the avatar index; any update author the API
        # gave a profile image must have an authors entry.
        for launch in self.raw:
            for u in launch.get("updates") or []:
                if u.get("created_by") and u.get("profile_image"):
                    self.assertIn(u["created_by"], d["authors"])
                    self.assertIn("image", d["authors"][u["created_by"]])

    def test_no_orphan_entities_or_images(self):
        d = self.data
        agency_refs = {l["provider_id"] for l in self.launches if "provider_id" in l}
        agency_refs |= {a for l in self.launches for a in l.get("agency_ids", [])}
        agency_refs |= {r["manufacturer_id"] for r in d["rockets"].values()
                        if "manufacturer_id" in r}
        self.assertEqual(set(d["agencies"]), agency_refs)
        self.assertEqual(set(d["rockets"]),
                         {l["rocket_id"] for l in self.launches if "rocket_id" in l})
        self.assertEqual(set(d["pads"]),
                         {l["pad_id"] for l in self.launches if "pad_id" in l})
        self.assertEqual(set(d["locations"]),
                         {p["location_id"] for p in d["pads"].values()
                          if "location_id" in p})
        self.assertEqual(set(d["statuses"]),
                         {l["status_id"] for l in self.launches if "status_id" in l})
        self.assertEqual(set(d["programs"]),
                         {p for l in self.launches for p in l.get("program_ids", [])})
        self.assertLessEqual(set(d["authors"]),
                             {u["created_by"] for l in self.launches
                              for u in l.get("updates", []) if "created_by" in u})
        self.assertEqual(image_indices(d), set(range(len(d["images"]))))

    def test_images_are_unique_and_in_range(self):
        images = self.data["images"]
        self.assertEqual(len(images), len(set(images)))
        for i in image_indices(self.data):
            self.assertIsInstance(i, int)
            self.assertGreaterEqual(i, 0)
            self.assertLess(i, len(images))

    def test_no_empty_values(self):
        # None/""/[] are dropped recursively; False and 0 must survive.
        for rec in walk(self.data):
            for v in rec.values():
                self.assertIsNotNone(v)
                self.assertNotEqual(v, "")
                self.assertNotEqual(v, [])

    def test_truncated_flag_follows_page_cap(self):
        self.assertEqual(self.data["meta"]["truncated"],
                         len(self.previous) >= PAST_LAUNCH_PAGES * PAGE_SIZE)

    def test_split_updates(self):
        # The input must survive intact — the offline build renders it
        # with updates still inline.
        snapshot = copy.deepcopy(self.data)
        core, updates = split_updates(self.data)
        self.assertEqual(self.data, snapshot)
        for group in ("upcoming", "previous"):
            self.assertEqual(len(updates[group]), len(core[group]))
            self.assertTrue(all(isinstance(u, list) for u in updates[group]))
            for launch in core[group]:
                self.assertNotIn("updates", launch)
        # Re-attaching the payload by index reproduces build_dataset's
        # output exactly (empty lists were dropped by drop_empty).
        for group in ("upcoming", "previous"):
            for launch, u in zip(core[group], updates[group]):
                if u:
                    launch["updates"] = u
        self.assertEqual(core, self.data)


@unittest.skipUnless(CACHE.exists(), "requires launch-cache.json")
class OfflineDatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
        cls.data = build_dataset(cache["upcoming"], cache["previous"], cache["last_updated"])

    def test_offline_dataset(self):
        # Stand in for fetch+cache: every wanted image "embeds" as a fake data URI.
        fake = {url: f"data:image/webp;base64,FAKE{i}" for i, url in enumerate(self.data["images"])}
        with mock.patch("pipeline.offline_bundle.embed_images", return_value=fake):
            offline = offline_dataset(self.data)
        self.assertIs(offline["meta"]["offline"], True)
        for entry in offline["images"]:
            self.assertTrue(entry is None or entry.startswith("data:"),
                            f"unexpected images entry: {entry!r:.80}")
        for rec in walk(offline):
            for key in rec:
                self.assertNotIn(key, URL_FIELDS, f"{key} survived the offline scrub")
        # The online dataset is untouched: its images table still holds URLs.
        self.assertTrue(all(u.startswith("http") for u in self.data["images"]))
