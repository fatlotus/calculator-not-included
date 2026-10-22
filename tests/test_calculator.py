"""
Unit tests for ONI Resource Calculator math engine (src/calculator.py / src/calculator.js).
Validates row math, recipe selection, modifiers, fractional scaling, thermal tracking, and two-stage NET state cancellation.
"""

import json
import unittest
from pathlib import Path
from src.calculator import (
    evaluate_row,
    resolve_table_temperatures,
    calculate_system_net,
    calculate_row_match_targets,
    format_number,
    format_stream_line,
    get_default_element_temp,
    get_net_input_temp,
    SECONDS_PER_CYCLE,
)

DATA_PATH = Path("/home/khakimaroon/onimath/data/dataset.json")


class TestCalculatorEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            cls.dataset = json.load(f)

        cls.entity_map = {}
        for category in ["buildings", "plants", "critters", "duplicants", "geysers"]:
            for item in cls.dataset.get(category, []):
                cls.entity_map[item["id"]] = item

    def test_format_number(self):
        self.assertEqual(format_number(0), "0")
        self.assertEqual(format_number(12.0), "12")
        self.assertEqual(format_number(1.25), "1.25")
        self.assertEqual(format_number(0.224), "0.224")
        self.assertEqual(format_number(888.8888), "888.8888")

    def test_format_stream_line_per_second(self):
        stream = {"resource": "Water", "rate": 1000.0, "unit": "g/s", "state": "in a pipe"}
        line = format_stream_line(stream, is_output=False, rate_mode="s")
        # 1000 g/s auto-scales to 1 Kg/s
        self.assertEqual(line, "Water: -1 Kg/s (in a pipe)")

        out_stream = {
            "resource": "Oxygen",
            "rate": 888.0,
            "unit": "g/s",
            "state": "free",
            "temp": "@ 70 °C+",
        }
        out_line = format_stream_line(out_stream, is_output=True, rate_mode="s")
        self.assertEqual(out_line, "Oxygen: +888 g/s @ 70 °C+ (free)")

    def test_format_stream_line_per_cycle(self):
        stream = {"resource": "Water", "rate": 1000.0, "unit": "g/s", "state": "in a pipe"}
        line = format_stream_line(stream, is_output=False, rate_mode="c")
        # 1000 g/s * 600s = 600,000 g/cycle -> 600 Kg/cycle
        self.assertEqual(line, "Water: -600 Kg/cycle (in a pipe)")

    def test_evaluate_single_electrolyzer(self):
        row = {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []}
        ev = evaluate_row(row, self.entity_map)
        self.assertEqual(ev["qty"], 1)
        self.assertEqual(ev["power"], -120.0)
        self.assertEqual(ev["heat"], 1.25)
        self.assertEqual(len(ev["inputs"]), 1)
        self.assertEqual(ev["inputs"][0]["resource"], "Water")
        self.assertEqual(ev["inputs"][0]["rate"], 1000.0)
        self.assertEqual(len(ev["outputs"]), 2)
        oxygen = next(o for o in ev["outputs"] if o["resource"] == "Oxygen")
        hydrogen = next(o for o in ev["outputs"] if o["resource"] == "Hydrogen")
        self.assertEqual(oxygen["rate"], 888.0)
        self.assertEqual(hydrogen["rate"], 112.0)

    def test_quantity_scaling(self):
        row = {"entityId": "electrolyzer", "qty": 3, "recipeId": None, "modifiers": []}
        ev = evaluate_row(row, self.entity_map)
        self.assertEqual(ev["qty"], 3)
        self.assertEqual(ev["power"], -360.0)
        self.assertEqual(ev["heat"], 3.75)
        self.assertEqual(ev["inputs"][0]["rate"], 3000.0)

    def test_duplicant_modifiers_divers_lungs(self):
        base_row = {"entityId": "duplicant", "qty": 1, "modifiers": []}
        ev_base = evaluate_row(base_row, self.entity_map)
        base_o2 = ev_base["inputs"][0]["rate"]  # 100 g/s

        mod_row = {"entityId": "duplicant", "qty": 1, "modifiers": ["divers_lungs"]}
        ev_mod = evaluate_row(mod_row, self.entity_map)
        mod_o2 = ev_mod["inputs"][0]["rate"]
        self.assertEqual(mod_o2, base_o2 * 0.75)  # -25% consumption

    def test_fractional_hydra_spom_net_exact_match(self):
        """
        Verify the fractional Hydra SPOM with strict pipe matching:
        1x Electrolyzer
        0.1x Water Pump (recipe: water @ 10,000 g/s)
        0.224x Gas Pump (recipe: hydrogen @ 500 g/s)
        1.12x Hydrogen Generator
        8x Duplicant

        Expected NET:
        Power: +698.24 W
        Building Heat: +6.38 kDTU/s
        NET Inputs: Water: -1000 g/s (free)
        NET Outputs:
          Oxygen: +88 g/s @ 70 °C+ (free)
        """
        rows = [
            {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []},
            {"entityId": "water_pump", "qty": 0.1, "recipeId": "water", "modifiers": []},
            {"entityId": "gas_pump", "qty": 0.224, "recipeId": "hydrogen", "modifiers": []},
            {"entityId": "hydrogen_generator", "qty": 1.12, "recipeId": None, "modifiers": []},
            {"entityId": "duplicant", "qty": 8, "recipeId": None, "modifiers": []},
        ]

        evaluated = [evaluate_row(r, self.entity_map) for r in rows]
        net = calculate_system_net(evaluated, {"strictPipeMatching": True})

        self.assertAlmostEqual(net["netPower"], 698.24, places=2)
        self.assertAlmostEqual(net["netBuildingHeat"], 6.38, places=2)

        # Net Inputs: exactly 1 Water stream of 1000 g/s free
        self.assertEqual(len(net["netInputs"]), 1)
        self.assertEqual(net["netInputs"][0]["resource"], "Water")
        self.assertEqual(net["netInputs"][0]["rate"], 1000.0)
        self.assertEqual(net["netInputs"][0]["state"], "free")

        # Net Outputs: Oxygen 88 g/s free
        self.assertEqual(len(net["netOutputs"]), 1)
        oxygen = net["netOutputs"][0]
        self.assertEqual(oxygen["resource"], "Oxygen")
        self.assertEqual(oxygen["rate"], 88.0)
        self.assertEqual(oxygen["state"], "free")

        # Test match link calculations for Gas Pump (index 2)
        matches = calculate_row_match_targets(2, rows, self.entity_map)
        self.assertTrue(matches["in:Hydrogen||free"]["isMatched"])
        self.assertAlmostEqual(matches["in:Hydrogen||free"]["targetQty"], 0.224, places=3)
        self.assertTrue(matches["out:Hydrogen||in a pipe"]["isMatched"])
        self.assertAlmostEqual(matches["out:Hydrogen||in a pipe"]["targetQty"], 0.224, places=3)

    def test_strict_pipe_matching_toggle(self):
        """
        When strictPipeMatching is True, cross-state streams for Hydrogen
        (Electrolyzer free vs Generator in-a-pipe) should NOT combine.
        """
        rows = [
            {"entityId": "electrolyzer", "qty": 1},
            {"entityId": "hydrogen_generator", "qty": 1},
        ]
        evaluated = [evaluate_row(r, self.entity_map) for r in rows]

        # Smart netting (when strictPipeMatching is explicitly False)
        net_smart = calculate_system_net(evaluated, {"strictPipeMatching": False})
        h_smart = [o for o in net_smart["netOutputs"] if o["resource"] == "Hydrogen"]
        self.assertEqual(len(h_smart), 1)
        self.assertEqual(h_smart[0]["rate"], 12.0)

        # Strict pipe matching (default True)
        net_strict = calculate_system_net(evaluated, {"strictPipeMatching": True})
        h_inp = [i for i in net_strict["netInputs"] if i["resource"] == "Hydrogen"]
        h_out = [o for o in net_strict["netOutputs"] if o["resource"] == "Hydrogen"]
        self.assertEqual(len(h_inp), 1)
        self.assertEqual(h_inp[0]["rate"], 100.0)
        self.assertEqual(h_inp[0]["state"], "in a pipe")
        self.assertEqual(len(h_out), 1)
        self.assertEqual(h_out[0]["rate"], 112.0)
        self.assertEqual(h_out[0]["state"], "free")

    def test_hydra_spom_default_temps_propagate(self):
        rows = [
            {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []},
            {"entityId": "water_pump", "qty": 0.1, "recipeId": "water", "modifiers": []},
            {"entityId": "gas_pump", "qty": 0.224, "recipeId": "hydrogen", "modifiers": []},
            {"entityId": "hydrogen_generator", "qty": 1.12, "recipeId": None, "modifiers": []},
            {"entityId": "duplicant", "qty": 8, "recipeId": None, "modifiers": []},
        ]
        evaluated = resolve_table_temperatures(rows, self.entity_map, self.dataset.get("elements", {}))

        # 1. Water Pump: input Water free @ 20 °C, output Water in pipe @ 20 °C
        wp = evaluated[1]
        self.assertAlmostEqual(wp["inputs"][0]["tempC"], 20.0, places=1)
        self.assertAlmostEqual(wp["outputs"][0]["tempC"], 20.0, places=1)
        self.assertEqual(wp["outputs"][0]["temp"], "@ 20 °C")

        # 2. Electrolyzer: input Water in pipe @ 20 °C, outputs Oxygen & Hydrogen @ 70 °C
        el = evaluated[0]
        self.assertAlmostEqual(el["inputs"][0]["tempC"], 20.0, places=1)
        o2_out = next(o for o in el["outputs"] if o["resource"] == "Oxygen")
        h2_out = next(o for o in el["outputs"] if o["resource"] == "Hydrogen")
        self.assertAlmostEqual(o2_out["tempC"], 70.0, places=1)
        self.assertAlmostEqual(h2_out["tempC"], 70.0, places=1)
        self.assertEqual(o2_out["temp"], "@ 70 °C")
        self.assertEqual(h2_out["temp"], "@ 70 °C")

        # 3. Gas Pump: input Hydrogen free @ 70 °C, output Hydrogen in pipe @ 70 °C
        gp = evaluated[2]
        self.assertAlmostEqual(gp["inputs"][0]["tempC"], 70.0, places=1)
        self.assertAlmostEqual(gp["outputs"][0]["tempC"], 70.0, places=1)
        self.assertEqual(gp["outputs"][0]["temp"], "@ 70 °C")

        # 4. Hydrogen Generator: input Hydrogen in pipe @ 70 °C
        hg = evaluated[3]
        self.assertAlmostEqual(hg["inputs"][0]["tempC"], 70.0, places=1)

        # 5. Duplicant: input Oxygen free @ 70 °C
        dup = evaluated[4]
        self.assertAlmostEqual(dup["inputs"][0]["tempC"], 70.0, places=1)

    def test_hydra_spom_95c_water_propagation(self):
        rows = [
            {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []},
            {"entityId": "water_pump", "qty": 0.1, "recipeId": "water", "modifiers": []},
            {"entityId": "gas_pump", "qty": 0.224, "recipeId": "hydrogen", "modifiers": []},
            {"entityId": "hydrogen_generator", "qty": 1.12, "recipeId": None, "modifiers": []},
            {"entityId": "duplicant", "qty": 8, "recipeId": None, "modifiers": []},
        ]
        # NET input Water set to 95 °C
        evaluated = resolve_table_temperatures(
            rows,
            self.entity_map,
            self.dataset.get("elements", {}),
            options={"netInputTemps": {"Water||free": 95.0}, "strictPipeMatching": True},
        )

        # Water Pump takes Water free @ 95 °C and outputs Water in pipe @ 95 °C
        wp = evaluated[1]
        self.assertAlmostEqual(wp["inputs"][0]["tempC"], 95.0, places=1)
        self.assertAlmostEqual(wp["outputs"][0]["tempC"], 95.0, places=1)
        self.assertEqual(wp["outputs"][0]["temp"], "@ 95 °C")

        # Electrolyzer takes Water in pipe @ 95 °C and outputs @ max(95, 70) = 95 °C
        el = evaluated[0]
        self.assertAlmostEqual(el["inputs"][0]["tempC"], 95.0, places=1)
        o2_out = next(o for o in el["outputs"] if o["resource"] == "Oxygen")
        h2_out = next(o for o in el["outputs"] if o["resource"] == "Hydrogen")
        self.assertAlmostEqual(o2_out["tempC"], 95.0, places=1)
        self.assertAlmostEqual(h2_out["tempC"], 95.0, places=1)
        self.assertEqual(o2_out["temp"], "@ 95 °C")
        self.assertEqual(h2_out["temp"], "@ 95 °C")

        # Gas Pump takes Hydrogen @ 95 °C and outputs @ 95 °C
        gp = evaluated[2]
        self.assertAlmostEqual(gp["inputs"][0]["tempC"], 95.0, places=1)
        self.assertAlmostEqual(gp["outputs"][0]["tempC"], 95.0, places=1)
        self.assertEqual(gp["outputs"][0]["temp"], "@ 95 °C")

    def test_two_producers_different_temperatures_averaging(self):
        custom_entity_map = {
            "prod1": {
                "id": "prod1", "name": "Producer 1", "category": "machine",
                "inputs": [], "outputs": [{"resource": "Water", "rate": 100.0, "unit": "g/s", "state": "in a pipe", "temp": "@ 20 °C"}],
            },
            "prod2": {
                "id": "prod2", "name": "Producer 2", "category": "machine",
                "inputs": [], "outputs": [{"resource": "Water", "rate": 300.0, "unit": "g/s", "state": "in a pipe", "temp": "@ 60 °C"}],
            },
            "cons": {
                "id": "cons", "name": "Consumer", "category": "machine",
                "inputs": [{"resource": "Water", "rate": 400.0, "unit": "g/s", "state": "in a pipe"}], "outputs": [],
            },
        }
        rows = [
            {"entityId": "prod1", "qty": 1},
            {"entityId": "prod2", "qty": 1},
            {"entityId": "cons", "qty": 1},
        ]
        evaluated = resolve_table_temperatures(rows, custom_entity_map)
        cons_ev = evaluated[2]
        # Weighted average: (100*20 + 300*60) / 400 = 50 °C
        self.assertAlmostEqual(cons_ev["inputs"][0]["tempC"], 50.0, places=2)

        # Deficit test: consumer needs 500 g/s, deficit 100 g/s at NET temp 100 °C
        rows_deficit = [
            {"entityId": "prod1", "qty": 1},
            {"entityId": "prod2", "qty": 1},
            {"entityId": "cons", "qty": 1.25},  # 500 g/s
        ]
        evaluated_def = resolve_table_temperatures(
            rows_deficit,
            custom_entity_map,
            options={"netInputTemps": {"Water||in a pipe": 100.0}},
        )
        # Blended: (100*20 + 300*60 + 100*100) / 500 = 60 °C
        self.assertAlmostEqual(evaluated_def[2]["inputs"][0]["tempC"], 60.0, places=2)

    def test_get_default_element_temp(self):
        element_map = {
            "Water": {"name": "Water", "low_temp": 272.5, "high_temp": 372.5},
            "Steam": {"name": "Steam", "low_temp": 372.5, "high_temp": None},
            "Ice": {"name": "Ice", "low_temp": None, "high_temp": 272.5},
            "HotIron": {"name": "HotIron", "default_temp": 80.0},
        }
        # Water is in phase at 20 °C
        self.assertEqual(get_default_element_temp("Water", element_map), 20.0)
        # Steam is too cold at 20 °C, so safely above low_temp (99.35 °C)
        steam_t = get_default_element_temp("Steam", element_map)
        self.assertGreater(steam_t, 99.35)
        # Ice is too hot at 20 °C, so safely below high_temp (-0.65 °C)
        ice_t = get_default_element_temp("Ice", element_map)
        self.assertLess(ice_t, -0.65)
        # Explicit default_temp
        self.assertEqual(get_default_element_temp("HotIron", element_map), 80.0)
        # Missing element defaults to 20
        self.assertEqual(get_default_element_temp("Unknown", element_map), 20.0)

    def test_automatic_unit_scaling(self):
        # In /s mode
        # < 1000 g/s -> g/s
        self.assertEqual(
            format_stream_line({"resource": "Natural Gas", "rate": 90.0, "unit": "g/s", "state": "free"}, True, "s"),
            "Natural Gas: +90 g/s (free)",
        )
        self.assertEqual(
            format_stream_line({"resource": "Hydrogen", "rate": 112.0, "unit": "g/s", "state": "free"}, True, "s"),
            "Hydrogen: +112 g/s (free)",
        )
        # 1000 g/s -> 1 Kg/s
        self.assertEqual(
            format_stream_line({"resource": "Coal", "rate": 1000.0, "unit": "g/s", "state": "free"}, False, "s"),
            "Coal: -1 Kg/s (free)",
        )
        # 10000 g/s -> 10 Kg/s
        self.assertEqual(
            format_stream_line({"resource": "Crude Oil", "rate": 10000.0, "unit": "g/s", "state": "in a pipe"}, False, "s"),
            "Crude Oil: -10 Kg/s (in a pipe)",
        )
        # 1,000,000 g/s -> 1 T/s
        self.assertEqual(
            format_stream_line({"resource": "Water", "rate": 1000000.0, "unit": "g/s", "state": "in a pipe"}, False, "s"),
            "Water: -1 T/s (in a pipe)",
        )

        # In /cycle mode
        # 90 g/s * 600 = 54,000 g/cycle -> 54 Kg/cycle
        self.assertEqual(
            format_stream_line({"resource": "Natural Gas", "rate": 90.0, "unit": "g/s", "state": "free"}, True, "c"),
            "Natural Gas: +54 Kg/cycle (free)",
        )
        # 10,000 g/s * 600 = 6,000,000 g/cycle -> 6 T/cycle
        self.assertEqual(
            format_stream_line({"resource": "Crude Oil", "rate": 10000.0, "unit": "g/s", "state": "in a pipe"}, False, "c"),
            "Crude Oil: -6 T/cycle (in a pipe)",
        )
        # 1 g/s * 600 = 600 g/cycle -> 600 g/cycle
        self.assertEqual(
            format_stream_line({"resource": "Gold", "rate": 1.0, "unit": "g/s", "state": "free"}, False, "c"),
            "Gold: -600 g/cycle (free)",
        )

        # Non-mass units
        self.assertEqual(
            format_stream_line({"resource": "Duplicant Labor", "rate": 1.0, "unit": "s/s", "state": "labor"}, False, "s"),
            "Duplicant Labor: -1 s/s (labor)",
        )
        self.assertEqual(
            format_stream_line({"resource": "Duplicant Labor", "rate": 1.0, "unit": "s/s", "state": "labor"}, False, "c"),
            "Duplicant Labor: -600 s/cycle (labor)",
        )


if __name__ == "__main__":
    unittest.main()
