"""Unit tests for pipeline.archive — synthetic fixtures, no network or launch cache required.

Run from the repo root with: python -m unittest discover tests
"""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline.api import paced_pages
from pipeline.archive import (load_archive, merge_launches, merged_previous, new_entities, new_meta,
                              prune, rehydrate, save_archive, slim, verify_archive)
from pipeline.dataset import build_dataset


def agency(i):
    return {"id": i, "url": f"https://api/agency/{i}/", "slug": f"a{i}", "name": f"Agency {i}", "abbrev": f"A{i}"}


def config(i):
    return {"id": i, "url": f"https://api/config/{i}/", "full_name": f"Rocket {i}", "manufacturer": agency(3)}


def pad(i):
    return {"id": i, "url": f"https://api/pad/{i}/", "name": f"Pad {i}",
            "location": {"id": 40, "name": "Loc", "country_code": "US", "url": "https://api/loc/40/"}}


def program(i):
    return {"id": i, "url": f"https://api/prog/{i}/", "name": f"Prog {i}"}


def raw_launch(lid="uuid-1", net="2020-06-01T00:00:00Z", last_updated="2020-06-02T00:00:00Z",
               provider_id=1):
    """Minimal LL2-shaped launch covering every field the archive touches."""
    return {
        "id": lid, "url": f"https://api/launch/{lid}/", "slug": "x",
        "name": "Rocket | Test", "net": net, "last_updated": last_updated,
        "status": {"id": 3, "name": "Success", "abbrev": "Success"},
        "launch_service_provider": agency(provider_id),
        "rocket": {"id": 99, "configuration": config(10), "launcher_stage": [], "spacecraft_stage": []},
        "mission": {"id": 5, "name": "M", "type": "Communications", "orbit": {"abbrev": "LEO"},
                    "description": "d", "agencies": [agency(2)], "info_urls": [], "vid_urls": []},
        "pad": pad(20), "program": [program(30)],
        "infoURLs": [{"url": "https://example.com/a"}],
        "vidURLs": [{"url": "https://v.example/v"}],
        "updates": [{"id": 7, "url": "https://api/update/7/", "comment": "c", "info_url": "https://u",
                     "created_on": "2020-06-01T01:00:00Z", "created_by": "bob", "profile_image": "https://img"}],
        "mission_patches": [], "image": None, "infographic": None, "webcast_live": False,
    }


def archive_of(raws):
    """Slim a raw launch list into (entities, store)."""
    entities, store = new_entities(), {}
    merge_launches(store, entities, raws)
    return entities, store


class ScrubTest(unittest.TestCase):
    def test_self_urls_dropped_but_links_kept(self):
        s = slim(raw_launch())
        self.assertNotIn("url", s)
        self.assertNotIn("slug", s)
        # Link lists have no `id` key — their url fields are real links.
        self.assertEqual(s["vidURLs"][0]["url"], "https://v.example/v")
        self.assertEqual(s["infoURLs"][0]["url"], "https://example.com/a")
        self.assertEqual(s["updates"][0]["info_url"], "https://u")
        # An update IS an id-bearing object: its self-url goes.
        self.assertNotIn("url", s["updates"][0])

    def test_entities_become_id_refs(self):
        s = slim(raw_launch())
        self.assertEqual(s["launch_service_provider"], {"id": 1})
        self.assertEqual(s["rocket"]["configuration"], {"id": 10})
        self.assertEqual(s["pad"], {"id": 20})
        self.assertEqual(s["mission"]["agencies"], [{"id": 2}])
        self.assertEqual(s["program"], [{"id": 30}])


class RoundTripTest(unittest.TestCase):
    def test_dataset_identical_after_slim_rehydrate(self):
        raw = raw_launch()
        entities, store = archive_of([raw])
        restored = rehydrate(store["uuid-1"], entities)
        self.assertEqual(build_dataset([raw], [], None), build_dataset([restored], [], None))

    def test_unresolvable_ref_degrades_cleanly(self):
        entities, store = archive_of([raw_launch()])
        entities["agencies"] = {}
        restored = rehydrate(store["uuid-1"], entities)
        self.assertIsNone(restored["launch_service_provider"])
        self.assertEqual(restored["mission"]["agencies"], [])


class MergeTest(unittest.TestCase):
    def test_newer_last_updated_wins(self):
        entities, store = archive_of([raw_launch(last_updated="2020-06-02T00:00:00Z")])
        merge_launches(store, entities, [raw_launch(last_updated="2020-06-01T00:00:00Z")])
        self.assertEqual(store["uuid-1"]["last_updated"], "2020-06-02T00:00:00Z")
        merge_launches(store, entities, [raw_launch(last_updated="2020-06-03T00:00:00Z")])
        self.assertEqual(store["uuid-1"]["last_updated"], "2020-06-03T00:00:00Z")

    def test_archive_beats_stale_delta_but_not_fresh(self):
        entities, store = archive_of([raw_launch(last_updated="2020-06-02T00:00:00Z")])
        stale = raw_launch(last_updated="2020-06-01T00:00:00Z")
        fresh = raw_launch(lid="uuid-2", net="2021-01-01T00:00:00Z", last_updated="2020-07-01T00:00:00Z")
        prev = merged_previous(store, [stale, fresh], entities)
        # Stale delta loses to the archive record; new delta launch wins.
        self.assertEqual([l["id"] for l in prev], ["uuid-2", "uuid-1"])
        self.assertIs(prev[0], fresh)
        self.assertEqual(prev[1]["launch_service_provider"]["name"], "Agency 1")


class SaveLoadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_round_trip_and_idempotent_write(self):
        raws = [raw_launch("a", net="2020-01-01T00:00:00Z"), raw_launch("b", net="2019-01-01T00:00:00Z")]
        entities, store = archive_of(raws)
        meta = new_meta()
        written = save_archive(entities, store, meta, self.dir)
        self.assertTrue(written)
        # Second save is a no-op — shards only rewrite on content change.
        self.assertEqual(save_archive(entities, store, meta, self.dir), [])
        self.assertTrue((self.dir / "launches" / "2020.jsonl").exists())
        self.assertTrue((self.dir / "launches" / "2019.jsonl").exists())

        entities2, store2, meta2 = load_archive(self.dir)
        self.assertEqual(store2, store)
        self.assertEqual(entities2, entities)
        self.assertEqual(meta2, meta)

    def test_save_writes_only_changed_shard(self):
        entities, store = archive_of([raw_launch("a", net="2020-01-01T00:00:00Z")])
        save_archive(entities, store, new_meta(), self.dir)
        merge_launches(store, entities, [raw_launch("b", net="2019-01-01T00:00:00Z")])
        written = save_archive(entities, store, new_meta(), self.dir)
        names = {p.name for p in written}
        self.assertIn("2019.jsonl", names)
        self.assertNotIn("2020.jsonl", names)

    def test_unicode_line_separator_in_record(self):
        # ensure_ascii=False leaves U+2028 raw inside strings; a naive
        # splitlines() on load would cut the record mid-string.
        raw = raw_launch("a")
        raw["mission"]["description"] = "line one\u2028line two"
        entities, store = archive_of([raw])
        save_archive(entities, store, new_meta(), self.dir)
        _, store2, _ = load_archive(self.dir)
        self.assertEqual(store2["a"]["mission"]["description"], "line one\u2028line two")

    def test_empty_year_shard_removed(self):
        entities, store = archive_of([raw_launch("a", net="2020-01-01T00:00:00Z")])
        save_archive(entities, store, new_meta(), self.dir)
        del store["a"]
        save_archive(entities, store, new_meta(), self.dir)
        self.assertFalse((self.dir / "launches" / "2020.jsonl").exists())


class PruneTest(unittest.TestCase):
    def test_sweep_prune(self):
        entities, store = archive_of([
            raw_launch("keep", last_updated="2020-01-01T00:00:00Z"),
            # "gone" has a unique provider — its agency should be GC'd with it.
            raw_launch("gone", last_updated="2020-01-01T00:00:00Z", provider_id=50),
            # Inserted mid-sweep: not in api_ids but too fresh to be a deletion.
            raw_launch("new", last_updated="2026-01-01T00:00:00Z"),
        ])
        removed = prune(store, entities, {"keep"}, "2020-06-01T00:00:00Z")
        self.assertEqual(removed, 1)
        self.assertEqual(set(store), {"keep", "new"})
        # The shared agencies survive; the deleted launch's unique one is gone.
        self.assertEqual(set(entities["agencies"]), {1, 2})

    def test_entity_gc(self):
        entities, store = archive_of([raw_launch("a")])
        entities["agencies"][999] = agency(999)   # unreferenced orphan
        entities["pads"][999] = pad(999)
        removed = prune(store, entities, {"a"}, "2020-06-01T00:00:00Z")
        self.assertEqual(removed, 0)
        self.assertNotIn(999, entities["agencies"])
        self.assertNotIn(999, entities["pads"])
        self.assertIn(1, entities["agencies"])


class VerifyTest(unittest.TestCase):
    def test_counter_reconciliation(self):
        entities, store = archive_of([raw_launch("a"), raw_launch("b")])
        entities["rockets"][10].update(successful_launches=2, failed_launches=0, total_launch_count=2)
        entities["pads"][20]["total_launch_count"] = 2
        # Deliberately wrong — agencies keep upstream-deleted launches in
        # their totals, so a mismatch is reported rather than an error.
        entities["agencies"][1].update(successful_launches=5, failed_launches=0, total_launch_count=2)
        self.assertEqual(verify_archive(entities, store),
                         [("agencies", 1, "Agency 1", "successful_launches", 5, 2)])


class PacedPagesTest(unittest.TestCase):
    """Quota-aware pacing: mock the throttle endpoint, count sleeps."""

    def _status(self, limit, used, wait=0):
        return {"your_request_limit": limit, "current_use": used, "next_use_secs": wait,
                "limit_frequency_secs": 3600}

    def _run(self, statuses, page_count=4):
        patcher = mock.patch("pipeline.api.throttle_status", side_effect=statuses)
        throttle = patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch("pipeline.api.time.sleep")
        sleep = patcher.start()
        self.addCleanup(patcher.stop)
        return throttle, sleep, list(paced_pages(iter([["p"] for _ in range(page_count)])))

    def test_ample_quota_never_sleeps(self):
        throttle, sleep, pages = self._run([self._status(15, 0)])
        self.assertEqual(len(pages), 4)
        sleep.assert_not_called()
        # Probe once; the reported budget carries the rest of the run.
        self.assertEqual(throttle.call_count, 1)

    def test_exhausted_quota_waits_then_reprobes(self):
        # First probe: empty with a 90s refill hint; second probe: refilled.
        throttle, sleep, pages = self._run([self._status(15, 15, 90), self._status(15, 0)], page_count=1)
        self.assertEqual(len(pages), 1)
        sleep.assert_called_once_with(90)
        self.assertEqual(throttle.call_count, 2)


if __name__ == "__main__":
    unittest.main()
