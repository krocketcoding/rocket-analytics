"""Unit tests for the small pipeline helpers — no launch cache required.

Run from the repo root with: python -m unittest discover tests
"""

import json
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest import mock

import requests

from pipeline.api import get_json
from pipeline.config import MAX_ATTEMPTS, RETRY_DELAY
from pipeline.dataset import drop_empty
from pipeline.details import link_details, pick, pull
from pipeline.launch_cache import load_cache, save_cache


class DropEmptyTest(unittest.TestCase):
    def test_drops_empty_values_recursively(self):
        value = {"a": None, "b": "", "c": [], "d": {"x": None, "y": 1},
                 "e": [{"f": None, "g": 2}, {"h": []}]}
        self.assertEqual(drop_empty(value),
                         {"d": {"y": 1}, "e": [{"g": 2}, {}]})

    def test_keeps_false_and_zero(self):
        self.assertEqual(drop_empty({"a": False, "b": 0, "c": [0, False]}),
                         {"a": False, "b": 0, "c": [0, False]})


class PickPullTest(unittest.TestCase):
    def test_pick_dict(self):
        self.assertEqual(pick({"a": 1}, "a"), 1)

    def test_pick_non_dict_returns_itself(self):
        self.assertEqual(pick("LEO", "abbrev"), "LEO")

    def test_pull_specs(self):
        src = {"name": "n", "kind": "x", "orbit": {"abbrev": "LEO"}}
        out = pull(src, ["name", ("k", "kind"), ("o", "orbit.abbrev")])
        self.assertEqual(out, {"name": "n", "k": "x", "o": "LEO"})

    def test_pull_missing_key_is_none(self):
        self.assertIsNone(pull({}, ["missing"])["missing"])

    def test_pull_non_dict_intermediate(self):
        # pick falls back to the value itself when the intermediate
        # isn't a dict — the spec's subkey is ignored.
        out = pull({"orbit": "LEO"}, [("orbit", "orbit.abbrev")])
        self.assertEqual(out["orbit"], "LEO")


class LinkDetailsTest(unittest.TestCase):
    def test_entry_shapes(self):
        links = link_details(
            [{"url": "https://a", "type": {"name": "Article"}}, "https://b"],
            [{"no_url": True}, None, {"url": "https://c"}],
            None,
        )
        # A dict entry with no type still gets a label key (None —
        # drop_empty strips it later in build_dataset).
        self.assertEqual(links, [{"url": "https://a", "label": "Article"},
                                 {"url": "https://b"},
                                 {"url": "https://c", "label": None}])


class CacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patcher = mock.patch("pipeline.launch_cache.LAUNCH_CACHE_FILE",
                             Path(self.tmp.name) / "launch-cache.json")
        self.cache_file = patcher.start()
        self.addCleanup(patcher.stop)

    def _write(self, obj):
        self.cache_file.write_text(json.dumps(obj), encoding="utf-8")

    def test_missing_file(self):
        self.assertIsNone(load_cache())

    def test_empty_upcoming(self):
        self._write({"upcoming": [], "previous": [{}],
                     "last_updated": "2026-01-01T00:00:00+00:00"})
        self.assertIsNone(load_cache())

    def test_malformed_timestamp_with_max_age(self):
        self._write({"upcoming": [{}], "previous": [{}],
                     "last_updated": "not-a-date"})
        self.assertIsNone(load_cache(timedelta(hours=1)))

    def test_fresh_timestamp_within_max_age(self):
        self._write({"upcoming": [1], "previous": [2],
                     "last_updated": "9999-01-01T00:00:00+00:00"})
        self.assertEqual(load_cache(timedelta(hours=1)),
                         ([1], [2], "9999-01-01T00:00:00+00:00"))

    def test_old_timestamp_is_stale(self):
        self._write({"upcoming": [1], "previous": [2],
                     "last_updated": "2000-01-01T00:00:00+00:00"})
        self.assertIsNone(load_cache(timedelta(hours=1)))

    def test_malformed_timestamp_without_max_age(self):
        # Age only matters when a max_age is given.
        self._write({"upcoming": [1], "previous": [2],
                     "last_updated": "not-a-date"})
        self.assertEqual(load_cache(), ([1], [2], "not-a-date"))

    def test_save_cache_round_trip_is_compact(self):
        last = save_cache([{"a": 1}], [{"b": 2}])
        self.assertEqual(load_cache(), ([{"a": 1}], [{"b": 2}], last))
        self.assertNotIn("\n", self.cache_file.read_text(encoding="utf-8"))


class GetJsonTest(unittest.TestCase):
    def _response(self, status, body=b"{}"):
        resp = requests.Response()
        resp.status_code = status
        resp._content = body
        resp.url = "https://example.com/launch/"
        return resp

    def setUp(self):
        # Guard: any call not covered by a test's own side_effect is a
        # real network call — fail loudly instead of hitting the API.
        patcher = mock.patch("pipeline.api.requests.get",
                             side_effect=AssertionError("real network call"))
        self._get = patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch("pipeline.api.time.sleep")
        self._sleep = patcher.start()
        self.addCleanup(patcher.stop)

    def _run(self, side_effects):
        self._get.side_effect = side_effects
        return self._get, self._sleep

    def test_429_fails_immediately(self):
        get, sleep = self._run([self._response(429)])
        with self.assertRaises(RuntimeError):
            get_json("previous", {})
        self.assertEqual(get.call_count, 1)
        sleep.assert_not_called()

    def test_404_fails_immediately(self):
        get, sleep = self._run([self._response(404)])
        with self.assertRaises(RuntimeError):
            get_json("previous", {})
        self.assertEqual(get.call_count, 1)
        sleep.assert_not_called()

    def test_500_retries_then_succeeds(self):
        get, sleep = self._run([self._response(500),
                                self._response(200, b'{"ok": 1}')])
        self.assertEqual(get_json("previous", {}), {"ok": 1})
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(RETRY_DELAY)

    def test_connection_error_exhausts_attempts(self):
        get, sleep = self._run(
            [requests.ConnectionError("down")] * MAX_ATTEMPTS)
        with self.assertRaises(RuntimeError):
            get_json("previous", {})
        self.assertEqual(get.call_count, MAX_ATTEMPTS)
        self.assertEqual(sleep.call_count, MAX_ATTEMPTS - 1)
