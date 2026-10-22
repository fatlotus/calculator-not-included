"""
Automated tests for dataset validation and wiki entity statistics.
Verifies data files, JSON validity, entity stats, wiki.gg icon URLs, and absence of fandom.com links.
"""

import glob
import json
import os
import unittest
from pathlib import Path

DATA_DIR = Path("/home/khakimaroon/onimath/data")


class TestDatasetIntegrity(unittest.TestCase):
    """Verifies that all dataset JSON files exist, are non-empty, and contain valid JSON."""

    EXPECTED_FILES = [
        "buildings.json",
        "plants.json",
        "critters.json",
        "duplicants.json",
        "geysers.json",
        "elements.json",
        "dataset.json",
    ]

    def test_all_expected_json_files_exist_and_non_empty(self):
        """Verify each required JSON file exists and has size > 0."""
        for filename in self.EXPECTED_FILES:
            filepath = DATA_DIR / filename
            self.assertTrue(
                filepath.exists(), f"Expected data file does not exist: {filepath}"
            )
            self.assertGreater(
                filepath.stat().st_size,
                0,
                f"Data file is empty (0 bytes): {filepath}",
            )

    def test_json_files_are_valid_and_parseable(self):
        """Verify all JSON files can be parsed without syntax errors."""
        for filename in self.EXPECTED_FILES:
            filepath = DATA_DIR / filename
            with open(filepath, "r", encoding="utf-8") as f:
                try:
                    data = json.load(f)
                except Exception as e:
                    self.fail(f"Failed to parse JSON in {filepath}: {e}")

                self.assertTrue(
                    isinstance(data, (list, dict)),
                    f"{filename} root must be a list or dict, got {type(data)}",
                )
                self.assertGreater(
                    len(data), 0, f"{filename} contains 0 top-level items"
                )

    def test_dataset_json_aggregates_all_categories(self):
        """Verify dataset.json aggregates buildings, plants, critters, duplicants, geysers, elements."""
        filepath = DATA_DIR / "dataset.json"
        with open(filepath, "r", encoding="utf-8") as f:
            dataset = json.load(f)

        expected_categories = [
            "buildings",
            "plants",
            "critters",
            "duplicants",
            "geysers",
            "elements",
        ]
        for cat in expected_categories:
            self.assertIn(cat, dataset, f"Missing category '{cat}' in dataset.json")
            self.assertIsInstance(
                dataset[cat],
                (list, dict),
                f"Category '{cat}' must be a list or dict",
            )
            self.assertGreater(
                len(dataset[cat]), 0, f"Category '{cat}' is empty in dataset.json"
            )


class TestWikiEntityStats(unittest.TestCase):
    """Verifies key entities exist with accurate stats from oxygennotincluded.wiki.gg."""

    @classmethod
    def setUpClass(cls):
        with open(DATA_DIR / "dataset.json", "r", encoding="utf-8") as f:
            cls.dataset = json.load(f)

        cls.entity_map = {}
        for category, items in cls.dataset.items():
            if isinstance(items, list):
                for item in items:
                    cls.entity_map[item["id"]] = item

    def test_electrolyzer_stats(self):
        """
        Verify electrolyzer:
        Power -120 W, Heat +1.25 kDTU/s,
        Input: Water 1000 g/s (in a pipe),
        Outputs: Oxygen 888 g/s @ 70 °C+ (free), Hydrogen 112 g/s @ 70 °C+ (free).
        """
        self.assertIn("electrolyzer", self.entity_map)
        elec = self.entity_map["electrolyzer"]

        self.assertEqual(elec.get("name"), "Electrolyzer")
        self.assertAlmostEqual(elec.get("power"), -120.0, places=2)
        self.assertAlmostEqual(elec.get("heat"), 1.25, places=2)

        # Check Inputs
        inputs = elec.get("inputs", [])
        self.assertEqual(len(inputs), 1)
        water_in = inputs[0]
        self.assertEqual(water_in.get("resource"), "Water")
        self.assertAlmostEqual(water_in.get("rate"), 1000.0, places=2)
        self.assertEqual(water_in.get("unit"), "g/s")
        self.assertEqual(water_in.get("state"), "in a pipe")

        # Check Outputs
        outputs = elec.get("outputs", [])
        self.assertEqual(len(outputs), 2)
        by_res = {o["resource"]: o for o in outputs}
        self.assertIn("Oxygen", by_res)
        self.assertIn("Hydrogen", by_res)

        o2 = by_res["Oxygen"]
        self.assertAlmostEqual(o2.get("rate"), 888.0, places=2)
        self.assertEqual(o2.get("unit"), "g/s")
        self.assertEqual(o2.get("state"), "free")
        self.assertIn("70 °C", o2.get("temp", ""))

        h2 = by_res["Hydrogen"]
        self.assertAlmostEqual(h2.get("rate"), 112.0, places=2)
        self.assertEqual(h2.get("unit"), "g/s")
        self.assertEqual(h2.get("state"), "free")
        self.assertIn("70 °C", h2.get("temp", ""))

    def test_hydrogen_generator_stats(self):
        """
        Verify hydrogen_generator:
        Power +800 W, Heat +4 kDTU/s,
        Input: Hydrogen 100 g/s (in a pipe).
        """
        self.assertIn("hydrogen_generator", self.entity_map)
        hgen = self.entity_map["hydrogen_generator"]

        self.assertEqual(hgen.get("name"), "Hydrogen Generator")
        self.assertAlmostEqual(hgen.get("power"), 800.0, places=2)
        self.assertAlmostEqual(hgen.get("heat"), 4.0, places=2)

        # Check Inputs
        inputs = hgen.get("inputs", [])
        self.assertEqual(len(inputs), 1)
        h2_in = inputs[0]
        self.assertEqual(h2_in.get("resource"), "Hydrogen")
        self.assertAlmostEqual(h2_in.get("rate"), 100.0, places=2)
        self.assertEqual(h2_in.get("unit"), "g/s")
        self.assertEqual(h2_in.get("state"), "in a pipe")

    def test_liquid_pump_stats(self):
        """
        Verify liquid_pump (in-game name 'Liquid Pump'):
        Power -240 W,
        Input: Water 10000 g/s (free),
        Output: Water 10000 g/s (in a pipe).
        Aliases: ['Water Pump'].
        """
        self.assertIn("liquid_pump", self.entity_map)
        pump = self.entity_map["liquid_pump"]

        self.assertEqual(pump.get("name"), "Liquid Pump")
        self.assertIn("Water Pump", pump.get("aliases", []))
        self.assertAlmostEqual(pump.get("power"), -240.0, places=2)

        # Check Inputs
        inputs = pump.get("inputs", [])
        self.assertEqual(len(inputs), 1)
        water_in = inputs[0]
        self.assertEqual(water_in.get("resource"), "Water")
        self.assertAlmostEqual(water_in.get("rate"), 10000.0, places=2)
        self.assertEqual(water_in.get("unit"), "g/s")
        self.assertEqual(water_in.get("state"), "free")

        # Check Outputs
        outputs = pump.get("outputs", [])
        self.assertEqual(len(outputs), 1)
        water_out = outputs[0]
        self.assertEqual(water_out.get("resource"), "Water")
        self.assertAlmostEqual(water_out.get("rate"), 10000.0, places=2)
        self.assertEqual(water_out.get("unit"), "g/s")
        self.assertEqual(water_out.get("state"), "in a pipe")

    def test_no_duplicate_entities_or_names(self):
        """Verify there are no duplicate entity IDs or names in the dataset."""
        for cat in ["buildings", "plants", "critters", "duplicants", "geysers"]:
            items = self.dataset.get(cat, [])
            ids = [x["id"] for x in items]
            names = [x["name"] for x in items]
            self.assertEqual(len(ids), len(set(ids)), f"Duplicate IDs found in {cat}")
            self.assertEqual(len(names), len(set(names)), f"Duplicate names found in {cat}")

        # Ensure legacy clone IDs are removed from raw dataset
        self.assertNotIn("water_pump", self.entity_map)
        self.assertNotIn("geyser_water", self.entity_map)
        self.assertNotIn("geyser_natural_gas", self.entity_map)
        # Ensure canonical IDs are present
        self.assertIn("liquid_pump", self.entity_map)
        self.assertIn("geyser_water_geyser", self.entity_map)
        self.assertIn("geyser_natural_gas_geyser", self.entity_map)

    def test_gas_pump_stats(self):
        """
        Verify gas_pump:
        Power -240 W,
        Has hydrogen recipe (Hydrogen 500 g/s free -> in a pipe) for full-capacity pumping.
        """
        self.assertIn("gas_pump", self.entity_map)
        gp = self.entity_map["gas_pump"]

        self.assertEqual(gp.get("name"), "Gas Pump")
        self.assertAlmostEqual(gp.get("power"), -240.0, places=2)

        recipes = {r["id"]: r for r in gp.get("recipes", [])}
        self.assertIn("hydrogen", recipes)
        h500 = recipes["hydrogen"]
        self.assertEqual(h500["inputs"][0]["resource"], "Hydrogen")
        self.assertAlmostEqual(h500["inputs"][0]["rate"], 500.0, places=2)
        self.assertEqual(h500["inputs"][0]["state"], "free")
        self.assertEqual(h500["outputs"][0]["resource"], "Hydrogen")
        self.assertAlmostEqual(h500["outputs"][0]["rate"], 500.0, places=2)
        self.assertEqual(h500["outputs"][0]["state"], "in a pipe")

    def test_duplicant_stats_and_modifiers(self):
        """
        Verify duplicant:
        Input: Oxygen 100 g/s (free),
        Modifiers: divers_lungs (-25% O2), deep_divers_lungs (-50% O2),
        mouth_breather (+100% O2), calories, lavatory, outhouse, etc.
        """
        self.assertIn("duplicant", self.entity_map)
        dupe = self.entity_map["duplicant"]

        self.assertEqual(dupe.get("name"), "Duplicant")

        # Base Input
        inputs = dupe.get("inputs", [])
        self.assertEqual(len(inputs), 1)
        o2_in = inputs[0]
        self.assertEqual(o2_in.get("resource"), "Oxygen")
        self.assertAlmostEqual(o2_in.get("rate"), 100.0, places=2)
        self.assertEqual(o2_in.get("unit"), "g/s")
        self.assertEqual(o2_in.get("state"), "free")

        # Modifiers map
        modifiers = {m["id"]: m for m in dupe.get("modifiers", [])}

        # diver's lungs (-25% O2 -> multiplier 0.75)
        self.assertIn("divers_lungs", modifiers)
        dl = modifiers["divers_lungs"]
        self.assertAlmostEqual(dl.get("input_multipliers", {}).get("Oxygen"), 0.75, places=2)

        # deep diver's lungs (-50% O2 -> multiplier 0.50)
        self.assertIn("deep_divers_lungs", modifiers)
        ddl = modifiers["deep_divers_lungs"]
        self.assertAlmostEqual(ddl.get("input_multipliers", {}).get("Oxygen"), 0.50, places=2)

        # mouth breather (+100% O2 -> multiplier 2.0)
        self.assertIn("mouth_breather", modifiers)
        mb = modifiers["mouth_breather"]
        self.assertAlmostEqual(mb.get("input_multipliers", {}).get("Oxygen"), 2.0, places=2)

        # calories
        self.assertIn("calories", modifiers)
        cal = modifiers["calories"]
        self.assertTrue(len(cal.get("extra_inputs", [])) > 0)
        cal_input = cal["extra_inputs"][0]
        self.assertEqual(cal_input.get("resource"), "Calories")
        self.assertAlmostEqual(cal_input.get("rate"), 1.6667, places=2)

        # lavatory
        self.assertIn("lavatory", modifiers)
        lav = modifiers["lavatory"]
        self.assertTrue(len(lav.get("extra_inputs", [])) > 0)
        self.assertTrue(len(lav.get("extra_outputs", [])) > 0)
        lav_in = next(s for s in lav["extra_inputs"] if s["resource"] == "Water")
        lav_out = next(s for s in lav["extra_outputs"] if s["resource"] == "Polluted Water")
        self.assertAlmostEqual(lav_in["rate"], 8.3333, places=2)
        self.assertAlmostEqual(lav_out["rate"], 19.5, places=2)

        # outhouse
        self.assertIn("outhouse", modifiers)
        out = modifiers["outhouse"]
        self.assertTrue(len(out.get("extra_inputs", [])) > 0)
        self.assertTrue(len(out.get("extra_outputs", [])) > 0)
        out_in = next(s for s in out["extra_inputs"] if s["resource"] == "Dirt")
        out_out = next(s for s in out["extra_outputs"] if s["resource"] == "Polluted Dirt")
        self.assertAlmostEqual(out_in["rate"], 21.6667, places=2)
        self.assertAlmostEqual(out_out["rate"], 32.8333, places=2)

    def test_water_geyser_stats(self):
        """Verify Water Geyser outputs canonical element Water / free at 95 °C."""
        wg = self.entity_map.get("geyser_water_geyser") or self.entity_map.get("geyser_water")
        self.assertIsNotNone(wg, "Water Geyser not found in entity_map")
        self.assertEqual(wg.get("name"), "Water Geyser")
        self.assertEqual(wg.get("category"), "Geyser")

        outputs = wg.get("outputs", [])
        self.assertTrue(len(outputs) > 0, "Water Geyser has no outputs")
        out0 = outputs[0]
        self.assertEqual(out0.get("resource"), "Water")
        self.assertEqual(out0.get("state"), "free")
        self.assertEqual(out0.get("unit"), "g/s")
        self.assertGreater(out0.get("rate", 0), 0)
        self.assertIn("95 °C", str(out0.get("temp", "")))

    def test_complete_element_catalog(self):
        """Verify element catalog contains gases, liquids, and solids with in-phase default_temp."""
        elem_list = self.dataset.get("elements", [])
        if isinstance(elem_list, dict):
            elem_list = list(elem_list.values())

        self.assertGreaterEqual(len(elem_list), 200, f"Expected >=200 elements, got {len(elem_list)}")

        states = set()
        for e in elem_list:
            states.add(e.get("state"))
            self.assertIn("name", e)
            self.assertIn("element_id", e)
            self.assertIn("state", e)
            self.assertIn(e.get("state"), ["Gas", "Liquid", "Solid"])
            self.assertIn("default_temp", e)
            def_t = e.get("default_temp")
            self.assertIsNotNone(def_t)

            low = e.get("low_temp")
            high = e.get("high_temp")
            if low is not None:
                self.assertGreaterEqual(def_t, low - 0.01)
            if high is not None:
                self.assertLessEqual(def_t, high + 0.01)

        self.assertIn("Gas", states)
        self.assertIn("Liquid", states)
        self.assertIn("Solid", states)


class TestIconAndUrlIntegrity(unittest.TestCase):
    """Verifies local icon paths, file existence on disk, and absence of fandom.com links."""

    def test_no_fandom_links_in_any_data_files(self):
        """Verify that zero links or text anywhere in data/ point to fandom.com."""
        json_files = glob.glob(str(DATA_DIR / "*.json"))
        self.assertGreater(len(json_files), 0, "No JSON files found in data directory")

        fandom_matches = []
        for jf in json_files:
            with open(jf, "r", encoding="utf-8") as f:
                content = f.read()
                if "fandom.com" in content:
                    fandom_matches.append(jf)

        self.assertEqual(
            fandom_matches,
            [],
            f"Found forbidden fandom.com references in: {fandom_matches}",
        )

    def test_icon_paths_are_local_files_that_exist_and_non_empty(self):
        """
        Verify every icon path is a local 'images/icons/...' path,
        and that the corresponding file actually exists on disk and is non-empty.
        """
        json_files = glob.glob(str(DATA_DIR / "*.json"))
        tested_icons = 0
        root_dir = DATA_DIR.parent

        for jf in json_files:
            with open(jf, "r", encoding="utf-8") as f:
                data = json.load(f)

            items = []
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                for v in data.values():
                    if isinstance(v, list):
                        items.extend(v)
                    elif isinstance(v, dict):
                        items.append(v)

            for item in items:
                if isinstance(item, dict) and item.get("icon"):
                    icon_path = item["icon"]
                    self.assertTrue(
                        icon_path.startswith("images/icons/"),
                        f"Icon path is not a local images/icons/... path in {jf}: {icon_path}",
                    )
                    self.assertTrue(
                        icon_path.endswith(".png"),
                        f"Icon path does not end with .png in {jf}: {icon_path}",
                    )
                    file_on_disk = root_dir / icon_path
                    self.assertTrue(
                        file_on_disk.exists(),
                        f"Referenced icon file does not exist on disk: {file_on_disk} (referenced in {jf})",
                    )
                    self.assertGreater(
                        file_on_disk.stat().st_size,
                        0,
                        f"Referenced icon file is empty (0 bytes): {file_on_disk}",
                    )
                    # Verify provenance if present
                    if item.get("original_icon_url"):
                        self.assertTrue(
                            item["original_icon_url"].startswith("https://oxygennotincluded.wiki.gg/images/"),
                            f"Original icon URL does not start with wiki.gg in {jf}: {item['original_icon_url']}",
                        )
                    tested_icons += 1

        self.assertGreater(tested_icons, 100, f"Expected >100 icons tested, got {tested_icons}")


if __name__ == "__main__":
    unittest.main()
