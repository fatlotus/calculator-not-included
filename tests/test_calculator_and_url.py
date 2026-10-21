"""
Automated unit tests for ONI Math calculator accounting engine and URL state serialization.
Tests row evaluation, modifier multipliers, per-cycle (600s) conversions,
two-stage NET resource aggregation, Hydra SPOM PDF example balance, and URL round-trips.
"""

import base64
import json
import unittest
from pathlib import Path

from src.calculator import (
    SECONDS_PER_CYCLE,
    format_number,
    format_stream_line,
    evaluate_row,
    calculate_system_net,
)
from src.url_state import (
    encode_row,
    decode_row,
    serialize_state,
    deserialize_state,
    encode_state_to_url_param,
    decode_state_from_url,
)

DATA_DIR = Path("/home/khakimaroon/onimath/data")


class TestCalculatorAccountingEngine(unittest.TestCase):
    """Verifies row evaluation, modifier scaling, recipe selection, and two-stage NET balance."""

    @classmethod
    def setUpClass(cls):
        with open(DATA_DIR / "dataset.json", "r", encoding="utf-8") as f:
            cls.dataset = json.load(f)

        cls.entity_map = {}
        for category, items in cls.dataset.items():
            if isinstance(items, list):
                for item in items:
                    cls.entity_map[item["id"]] = item

    def test_hydra_spom_pdf_example_exact_balance(self):
        """
        Specifically verify the fractional Hydra SPOM example:
        1x Electrolyzer, 1.12x Hydrogen Generator, 0.1x Water Pump, 0.224x Gas Pump, 8x Duplicant.
        Expected NET Inputs:
          - Water: -1000 g/s (free)
        Expected NET Outputs:
          - Oxygen: +88 g/s @ 70 °C+ (free)
          - Power: +698.24 W (+896 - 120 - 24 - 53.76 W)
        """
        rows = [
            evaluate_row({"entityId": "electrolyzer", "qty": 1}, self.entity_map),
            evaluate_row({"entityId": "hydrogen_generator", "qty": 1.12}, self.entity_map),
            evaluate_row({"entityId": "water_pump", "qty": 0.1, "recipeId": "water"}, self.entity_map),
            evaluate_row({"entityId": "gas_pump", "qty": 0.224, "recipeId": "hydrogen"}, self.entity_map),
            evaluate_row({"entityId": "duplicant", "qty": 8}, self.entity_map),
        ]

        net = calculate_system_net(rows, strict_pipe_matching=True)

        # 1. NET Power (+896 - 120 - 24 - 53.76 = +698.24 W)
        self.assertAlmostEqual(net["net_power"], 698.24, places=2)

        # 2. NET Building Heat (+1.25 + 4.48 + 0.2 + 0.448 = +6.38 kDTU/s)
        self.assertAlmostEqual(net["net_building_heat"], 6.38, places=2)

        # 3. NET Inputs (Water: -1000 g/s free)
        self.assertEqual(len(net["net_inputs"]), 1)
        water_in = net["net_inputs"][0]
        self.assertEqual(water_in["resource"], "Water")
        self.assertAlmostEqual(water_in["rate"], 1000.0, places=2)
        self.assertEqual(water_in["unit"], "g/s")
        self.assertEqual(water_in["state"], "free")

        # 4. NET Outputs (Oxygen: +88 g/s @ 70 °C+ free)
        self.assertEqual(len(net["net_outputs"]), 1)
        o2 = net["net_outputs"][0]
        self.assertEqual(o2["resource"], "Oxygen")
        self.assertAlmostEqual(o2["rate"], 88.0, places=2)
        self.assertEqual(o2["unit"], "g/s")
        self.assertEqual(o2["state"], "free")
        self.assertIn("70 °C", o2.get("temp", ""))

    def test_hydra_spom_with_divers_lungs_on_8_duplicants(self):
        """
        Verify that enabling Diver's Lungs on 8x Duplicant reduces Oxygen consumption
        from -800 g/s to -600 g/s, increasing NET Oxygen output from +88 g/s to +288 g/s.
        """
        base_dupe_row = evaluate_row({"entityId": "duplicant", "qty": 8}, self.entity_map)
        self.assertEqual(len(base_dupe_row["inputs"]), 1)
        self.assertAlmostEqual(base_dupe_row["inputs"][0]["rate"], 800.0, places=2)

        mod_dupe_row = evaluate_row(
            {"entityId": "duplicant", "qty": 8, "modifiers": ["divers_lungs"]},
            self.entity_map,
        )
        self.assertEqual(len(mod_dupe_row["inputs"]), 1)
        self.assertAlmostEqual(mod_dupe_row["inputs"][0]["rate"], 600.0, places=2)

        # Full system with diver's lungs on duplicants
        rows = [
            evaluate_row({"entityId": "electrolyzer", "qty": 1}, self.entity_map),
            evaluate_row({"entityId": "hydrogen_generator", "qty": 1.12}, self.entity_map),
            evaluate_row({"entityId": "water_pump", "qty": 0.1, "recipeId": "water"}, self.entity_map),
            evaluate_row({"entityId": "gas_pump", "qty": 0.224, "recipeId": "hydrogen"}, self.entity_map),
            mod_dupe_row,
        ]

        net = calculate_system_net(rows, strict_pipe_matching=True)

        # NET Oxygen output must now be exactly 888 - 600 = +288 g/s
        by_res = {o["resource"]: o for o in net["net_outputs"]}
        self.assertIn("Oxygen", by_res)
        self.assertAlmostEqual(by_res["Oxygen"]["rate"], 288.0, places=2)
        self.assertEqual(by_res["Oxygen"]["state"], "free")
        self.assertIn("70 °C", by_res["Oxygen"].get("temp", ""))

        # Power remains +698.24 W
        self.assertAlmostEqual(net["net_power"], 698.24, places=2)
        self.assertAlmostEqual(net["net_building_heat"], 6.38, places=2)

        self.assertEqual(len(net["net_inputs"]), 1)
        self.assertAlmostEqual(net["net_inputs"][0]["rate"], 1000.0, places=2)
        self.assertEqual(net["net_inputs"][0]["state"], "free")

    def test_duplicant_other_modifiers(self):
        """Test deep diver's lungs (-50%), mouth breather (+100%), calories, and lavatory."""
        # Deep diver's lungs (50 g/s each -> 400 g/s for 8 dupes)
        ddl_row = evaluate_row(
            {"entityId": "duplicant", "qty": 8, "modifiers": ["deep_divers_lungs"]},
            self.entity_map,
        )
        self.assertAlmostEqual(ddl_row["inputs"][0]["rate"], 400.0, places=2)

        # Mouth breather (200 g/s each -> 1600 g/s for 8 dupes)
        mb_row = evaluate_row(
            {"entityId": "duplicant", "qty": 8, "modifiers": ["mouth_breather"]},
            self.entity_map,
        )
        self.assertAlmostEqual(mb_row["inputs"][0]["rate"], 1600.0, places=2)

        # Calories & Lavatory extra inputs/outputs
        full_dupe_row = evaluate_row(
            {"entityId": "duplicant", "qty": 1, "modifiers": ["calories", "lavatory"]},
            self.entity_map,
        )
        input_res = {s["resource"]: s for s in full_dupe_row["inputs"]}
        output_res = {s["resource"]: s for s in full_dupe_row["outputs"]}

        self.assertIn("Oxygen", input_res)
        self.assertIn("Calories", input_res)
        self.assertIn("Water", input_res)
        self.assertAlmostEqual(input_res["Calories"]["rate"], 1.6667, places=2)
        self.assertAlmostEqual(input_res["Water"]["rate"], 8.3333, places=2)

        self.assertIn("Polluted Water", output_res)
        self.assertAlmostEqual(output_res["Polluted Water"]["rate"], 19.5, places=2)

    def test_hydrogen_generator_tuneup_modifier(self):
        """Test Engie's Tune-Up on Hydrogen Generator (+50% power -> 1200 W)."""
        tuned_hgen = evaluate_row(
            {"entityId": "hydrogen_generator", "qty": 1, "modifiers": ["engie_tuneup"]},
            self.entity_map,
        )
        self.assertAlmostEqual(tuned_hgen["power"], 1200.0, places=2)
        self.assertAlmostEqual(tuned_hgen["heat"], 4.0, places=2)

    def test_water_pump_recipes(self):
        """Test Water Pump full capacity pumping (10 kg/s, -240 W, 2 kDTU/s)."""
        pump_spom = evaluate_row(
            {"entityId": "water_pump", "qty": 1, "recipeId": "water"},
            self.entity_map,
        )
        self.assertAlmostEqual(pump_spom["power"], -240.0, places=2)
        self.assertAlmostEqual(pump_spom["heat"], 2.0, places=2)
        self.assertAlmostEqual(pump_spom["inputs"][0]["rate"], 10000.0, places=2)

        # Full pump recipe (water_full: 10000 g/s, -240 W, 2 kDTU/s)
        pump_full = evaluate_row(
            {"entityId": "water_pump", "qty": 1, "recipeId": "water_full"},
            self.entity_map,
        )
        self.assertAlmostEqual(pump_full["power"], -240.0, places=2)
        self.assertAlmostEqual(pump_full["heat"], 2.0, places=2)
        self.assertAlmostEqual(pump_full["inputs"][0]["rate"], 10000.0, places=2)

    def test_two_stage_cancellation_and_strict_pipe_matching(self):
        """
        Verify two-stage cancellation behavior:
        - Free vs Pipe combines when no state-transfer pump is present (smart netting).
        - State-transfer pump preserves free vs pipe distinction.
        - Strict pipe matching option disables cross-state combination.
        """
        # Without pump: Free Hydrogen +112 and Pipe Hydrogen -100 combine to +12 free
        free_h2_row = {
            "entity": None,
            "qty": 1,
            "power": 0,
            "heat": 0,
            "inputs": [],
            "outputs": [{"resource": "Hydrogen", "rate": 112.0, "unit": "g/s", "state": "free", "temp": "@ 70 °C+"}],
            "is_state_transfer_for": set(),
        }
        pipe_h2_row = {
            "entity": None,
            "qty": 1,
            "power": 0,
            "heat": 0,
            "inputs": [{"resource": "Hydrogen", "rate": 100.0, "unit": "g/s", "state": "in a pipe"}],
            "outputs": [],
            "is_state_transfer_for": set(),
        }

        # Smart netting enabled
        net_smart = calculate_system_net([free_h2_row, pipe_h2_row], strict_pipe_matching=False)
        self.assertEqual(len(net_smart["net_outputs"]), 1)
        self.assertEqual(len(net_smart["net_inputs"]), 0)
        self.assertAlmostEqual(net_smart["net_outputs"][0]["rate"], 12.0, places=2)
        self.assertEqual(net_smart["net_outputs"][0]["state"], "free")

        # Strict pipe matching enabled
        net_strict = calculate_system_net([free_h2_row, pipe_h2_row], strict_pipe_matching=True)
        self.assertEqual(len(net_strict["net_outputs"]), 1)
        self.assertEqual(len(net_strict["net_inputs"]), 1)
        self.assertAlmostEqual(net_strict["net_outputs"][0]["rate"], 112.0, places=2)
        self.assertEqual(net_strict["net_outputs"][0]["state"], "free")
        self.assertAlmostEqual(net_strict["net_inputs"][0]["rate"], 100.0, places=2)
        self.assertEqual(net_strict["net_inputs"][0]["state"], "in a pipe")


class TestRateConversionsAndFormatting(unittest.TestCase):
    """Verifies per-second (/s) to per-cycle (600s) conversions and line formatting."""

    def test_seconds_per_cycle_constant(self):
        """Verify SECONDS_PER_CYCLE is 600 seconds."""
        self.assertEqual(SECONDS_PER_CYCLE, 600)

    def test_per_cycle_rate_conversion_values(self):
        """
        Verify exact conversion math for per-cycle rates:
        - 1000 g/s -> 600 kg/cycle
        - 88 g/s -> 52.8 kg/cycle
        - 12 g/s -> 7.2 kg/cycle
        - 288 g/s -> 172.8 kg/cycle
        - 1.6667 kcal/s -> 1000 kcal/cycle
        """
        # Water
        water_cycle = (1000.0 * SECONDS_PER_CYCLE) / 1000.0
        self.assertAlmostEqual(water_cycle, 600.0, places=2)

        # Oxygen (Hydra SPOM base net)
        o2_base_cycle = (88.0 * SECONDS_PER_CYCLE) / 1000.0
        self.assertAlmostEqual(o2_base_cycle, 52.8, places=2)

        # Hydrogen (Hydra SPOM net)
        h2_cycle = (12.0 * SECONDS_PER_CYCLE) / 1000.0
        self.assertAlmostEqual(h2_cycle, 7.2, places=2)

        # Oxygen (Hydra SPOM with Diver's Lungs)
        o2_dl_cycle = (288.0 * SECONDS_PER_CYCLE) / 1000.0
        self.assertAlmostEqual(o2_dl_cycle, 172.8, places=2)

        # Calories
        cal_cycle = 1.6667 * SECONDS_PER_CYCLE
        self.assertAlmostEqual(cal_cycle, 1000.0, places=0)

    def test_format_number_utility(self):
        """Verify format_number strips trailing zeros up to 2 decimal places."""
        self.assertEqual(format_number(560.0), "560")
        self.assertEqual(format_number(5.25), "5.25")
        self.assertEqual(format_number(1000.0), "1000")
        self.assertEqual(format_number(0.0), "0")
        self.assertEqual(format_number(88.0), "88")
        self.assertEqual(format_number(52.8), "52.8")

    def test_format_stream_line_per_second_and_per_cycle(self):
        """Verify format_stream_line produces clean human-readable strings."""
        # Water Input
        water_stream = {"resource": "Water", "rate": 1000.0, "unit": "g/s", "state": "free"}
        self.assertEqual(
            format_stream_line(water_stream, is_output=False, rate_mode="s"),
            "Water: -1000 g/s (free)",
        )
        self.assertEqual(
            format_stream_line(water_stream, is_output=False, rate_mode="c"),
            "Water: -600 kg/cycle (free)",
        )

        # Oxygen Output with Temperature
        o2_stream = {"resource": "Oxygen", "rate": 88.0, "unit": "g/s", "state": "free", "temp": "@ 70 °C+"}
        self.assertEqual(
            format_stream_line(o2_stream, is_output=True, rate_mode="s"),
            "Oxygen: +88 g/s @ 70 °C+ (free)",
        )
        self.assertEqual(
            format_stream_line(o2_stream, is_output=True, rate_mode="c"),
            "Oxygen: +52.8 kg/cycle @ 70 °C+ (free)",
        )


class TestUrlStateSerialization(unittest.TestCase):
    """Verifies compact URL state encoding, decoding, round-trips, and fallback support."""

    def test_row_encoding_and_decoding(self):
        """Verify encode_row and decode_row handle various token formats."""
        cases = [
            {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []},
            {"entityId": "hydrogen_generator", "qty": 1, "recipeId": None, "modifiers": []},
            {"entityId": "water_pump", "qty": 1, "recipeId": None, "modifiers": []},
            {"entityId": "duplicant", "qty": 8, "recipeId": None, "modifiers": []},
            {"entityId": "duplicant", "qty": 8, "recipeId": None, "modifiers": ["divers_lungs"]},
            {"entityId": "water_pump", "qty": 2, "recipeId": "water_full", "modifiers": []},
            {
                "entityId": "duplicant",
                "qty": 4,
                "recipeId": "std",
                "modifiers": ["divers_lungs", "calories"],
            },
        ]

        for original in cases:
            token = encode_row(original)
            self.assertIsInstance(token, str)
            decoded = decode_row(token)
            self.assertEqual(decoded["entityId"], original["entityId"])
            self.assertEqual(decoded["qty"], original["qty"])
            self.assertEqual(decoded["recipeId"], original["recipeId"])
            self.assertEqual(decoded["modifiers"], original["modifiers"])

    def test_serialize_and_deserialize_hydra_spom(self):
        """Verify full Hydra SPOM state serialize / deserialize roundtrip."""
        state = {
            "unit": "s",
            "strictPipeMatching": False,
            "rows": [
                {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []},
                {"entityId": "hydrogen_generator", "qty": 1, "recipeId": None, "modifiers": []},
                {"entityId": "water_pump", "qty": 1, "recipeId": "water", "modifiers": []},
                {"entityId": "gas_pump", "qty": 1, "recipeId": "hydrogen_100", "modifiers": []},
                {"entityId": "duplicant", "qty": 8, "recipeId": None, "modifiers": ["divers_lungs"]},
            ],
        }

        serialized = serialize_state(state)
        expected = "u:s_p:0_r:electrolyzer~hydrogen_generator~water_pump:water~gas_pump:hydrogen_100~duplicant*8+divers_lungs"
        self.assertEqual(serialized, expected)

        deserialized = deserialize_state(serialized)
        self.assertEqual(deserialized["unit"], "s")
        self.assertFalse(deserialized["strictPipeMatching"])
        self.assertEqual(len(deserialized["rows"]), 5)
        self.assertEqual(deserialized["rows"][0]["entityId"], "electrolyzer")
        self.assertEqual(deserialized["rows"][1]["entityId"], "hydrogen_generator")
        self.assertEqual(deserialized["rows"][2]["entityId"], "water_pump")
        self.assertEqual(deserialized["rows"][2]["recipeId"], "water")
        self.assertEqual(deserialized["rows"][3]["entityId"], "gas_pump")
        self.assertEqual(deserialized["rows"][3]["recipeId"], "hydrogen_100")
        self.assertEqual(deserialized["rows"][4]["entityId"], "duplicant")
        self.assertEqual(deserialized["rows"][4]["qty"], 8)
        self.assertEqual(deserialized["rows"][4]["modifiers"], ["divers_lungs"])

    def test_url_param_encoding_and_query_string_extraction(self):
        """Verify encode_state_to_url_param and decode_state_from_url with full URLs."""
        state = {
            "unit": "c",
            "strictPipeMatching": True,
            "rows": [
                {"entityId": "electrolyzer", "qty": 2, "recipeId": None, "modifiers": []},
                {"entityId": "water_pump", "qty": 1, "recipeId": "water_full", "modifiers": []},
            ],
        }

        url_param = encode_state_to_url_param(state)
        self.assertTrue(url_param.startswith("?s="))

        full_url = f"https://example.com/oni/index.html{url_param}"
        decoded_state = decode_state_from_url(full_url)

        self.assertIsNotNone(decoded_state)
        self.assertEqual(decoded_state["unit"], "c")
        self.assertTrue(decoded_state["strictPipeMatching"])
        self.assertEqual(len(decoded_state["rows"]), 2)
        self.assertEqual(decoded_state["rows"][0]["entityId"], "electrolyzer")
        self.assertEqual(decoded_state["rows"][0]["qty"], 2)
        self.assertEqual(decoded_state["rows"][1]["entityId"], "water_pump")
        self.assertEqual(decoded_state["rows"][1]["recipeId"], "water_full")

    def test_base64_url_fallback(self):
        """Verify fallback decoding of base64url-encoded JSON payloads."""
        arbitrary_data = {
            "unit": "s",
            "strictPipeMatching": False,
            "rows": [
                {"entityId": "petroleum_generator", "qty": 3, "recipeId": None, "modifiers": []}
            ],
        }
        json_str = json.dumps(arbitrary_data)
        b64 = base64.urlsafe_b64encode(json_str.encode("utf-8")).decode("utf-8").rstrip("=")
        b64_token = f"b64:{b64}"

        decoded = deserialize_state(b64_token)
        self.assertEqual(decoded["unit"], "s")
        self.assertFalse(decoded["strictPipeMatching"])
        self.assertEqual(len(decoded["rows"]), 1)
        self.assertEqual(decoded["rows"][0]["entityId"], "petroleum_generator")
        self.assertEqual(decoded["rows"][0]["qty"], 3)

    def test_resilience_to_malformed_inputs(self):
        """Verify decoder gracefully handles empty or invalid inputs without crashing."""
        self.assertEqual(decode_row(""), None)
        self.assertEqual(decode_row(None), None)

        empty_state = deserialize_state("")
        self.assertEqual(empty_state["unit"], "s")
        self.assertTrue(empty_state["strictPipeMatching"])
        self.assertEqual(empty_state["rows"], [])

        none_state = deserialize_state(None)
        self.assertEqual(none_state["unit"], "s")
        self.assertTrue(none_state["strictPipeMatching"])
        self.assertEqual(none_state["rows"], [])

        invalid_b64 = deserialize_state("b64:!!!not_base64!!!")
        self.assertEqual(invalid_b64["unit"], "s")
        self.assertTrue(invalid_b64["strictPipeMatching"])
        self.assertEqual(invalid_b64["rows"], [])

        no_query = decode_state_from_url("https://example.com/index.html")
        self.assertIsNone(no_query)


if __name__ == "__main__":
    unittest.main()
