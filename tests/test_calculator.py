"""
Unit tests for ONI Resource Calculator math engine (src/calculator.py / src/calculator.js).
Validates row math, recipe selection, modifiers, fractional scaling, thermal tracking, and two-stage NET state cancellation.
"""

import json
import unittest
from pathlib import Path
from src.calculator import (
    evaluate_row,
    calculate_system_net,
    calculate_row_match_targets,
    format_number,
    format_stream_line,
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
        self.assertEqual(line, "Water: -1000 g/s (in a pipe)")

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
        # 1000 g/s * 600s / 1000 = 600 kg/cycle
        self.assertEqual(line, "Water: -600 kg/cycle (in a pipe)")

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


if __name__ == "__main__":
    unittest.main()
