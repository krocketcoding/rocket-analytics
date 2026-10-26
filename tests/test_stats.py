"""Sanity checks for pipeline.stats, run against the real launch cache.

These pin the chart data-shape invariants (category keys, per-grouping
totals, the launched-rockets gate, the oldest-year drop rule) so a
regression in the transform layer fails loudly instead of shipping
wrong chart data. Run from the repo root with: python -m unittest
"""

import json
import unittest
from pathlib import Path

from pipeline.config import PAGE_SIZE, PAST_LAUNCH_PAGES
from pipeline.details import collect_entities
from pipeline.stats import compute_stats

CACHE = Path(__file__).resolve().parents[1] / "launch-cache.json"


@unittest.skipUnless(CACHE.exists(), "requires launch-cache.json")
class ComputeStatsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cache = json.loads(CACHE.read_text(encoding="utf-8"))
        cls.previous = cache["previous"]
        rockets = collect_entities(cache["upcoming"] + cls.previous)["rockets"]
        cls.stats = compute_stats(rockets, cls.previous)

    def test_yearly_rows_are_orbital_suborbital_failed(self):
        # 'sites' and 'families' are nested {label: {rocket: cats}};
        # the rest are flat.
        for bucket in self.stats["yearly"].values():
            for group, rows in bucket.items():
                leaves = (cats for row in rows.values()
                          for cats in (row.values() if group in ("sites", "families")
                                       else (row,)))
                for cats in leaves:
                    self.assertLessEqual(
                        set(cats), {"orbital", "suborbital", "failed"})

    def test_groupings_tally_the_same_launches(self):
        # Every fetched launch lands in exactly one category of each
        # grouping, so a year's totals must agree across groupings.
        def leaf_total(rows):
            return sum(
                sum(inner.values()) if isinstance(inner, dict) else inner
                for cats in rows.values()
                for inner in cats.values())
        for year, bucket in self.stats["yearly"].items():
            totals = {g: leaf_total(rows) for g, rows in bucket.items()}
            self.assertEqual(len(set(totals.values())), 1,
                             f"{year} grouping totals differ: {totals}")

    def test_site_rockets_are_chart_rows(self):
        # Every rocket keyed under a site exists in the lifetime rocket
        # rows — a rocket filter pick can never hit a phantom name.
        charted = {r for b in self.stats["yearly"].values()
                   for r in b["rockets"]}
        for bucket in self.stats["yearly"].values():
            for per_rocket in bucket["sites"].values():
                self.assertLessEqual(set(per_rocket), charted)

    def test_family_variants_are_chart_rows(self):
        # The family tally gates on the same rocket name as the sites
        # grouping, so every variant segment is a charted rocket.
        charted = {r for b in self.stats["yearly"].values()
                   for r in b["rockets"]}
        for bucket in self.stats["yearly"].values():
            for per_rocket in bucket["families"].values():
                self.assertLessEqual(set(per_rocket), charted)

    def test_country_filter_keys_can_chart(self):
        # Guards the '???' regression: every filterable rocket or
        # manufacturer must exist in its chart's rows — a dead entry
        # could only ever produce an empty chart.
        charted = {r for b in self.stats["yearly"].values()
                   for r in b["rockets"]}
        charted_mfrs = {m for b in self.stats["yearly"].values()
                        for m in b["manufacturers"]}
        self.assertLessEqual(set(self.stats["rocket_countries"]), charted)
        self.assertLessEqual(set(self.stats["manufacturer_countries"]),
                             charted_mfrs)

    def test_oldest_year_dropped_at_page_cap(self):
        # Newest-first fetches can truncate the oldest year mid-way, so
        # it's kept only when the API ran out before the page cap.
        years = sorted({l["net"][:4] for l in self.previous if l.get("net")},
                       reverse=True)
        if len(self.previous) >= PAST_LAUNCH_PAGES * PAGE_SIZE:
            years = years[:-1]
        self.assertEqual(sorted(self.stats["yearly"], reverse=True), years)

    def test_site_maps_cover_chart_labels(self):
        # Every launch site a chart can label resolves to a full name
        # and a country code ('???' counts — it's the air/sea code).
        sites = {s for bucket in self.stats["yearly"].values()
                 for s in bucket["sites"]}
        self.assertLessEqual(sites, set(self.stats["site_names"]))
        self.assertLessEqual(sites, set(self.stats["site_countries"]))
