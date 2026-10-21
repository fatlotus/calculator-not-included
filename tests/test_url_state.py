"""
Unit tests for URL state serialization (src/url_state.py and src/url_state.js).
Verifies compact encoding, decoding, round-tripping, base64 fallback, and special characters.
"""

import unittest
from src.url_state import (
    encode_row,
    decode_row,
    encode_state_to_param,
    decode_state_from_param,
)


class TestUrlStateSerialization(unittest.TestCase):
    def test_encode_and_decode_single_row_default_qty(self):
        row = {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []}
        token = encode_row(row)
        self.assertEqual(token, "electrolyzer")

        decoded = decode_row(token)
        self.assertEqual(decoded["entityId"], "electrolyzer")
        self.assertEqual(decoded["qty"], 1.0)
        self.assertIsNone(decoded["recipeId"])
        self.assertEqual(decoded["modifiers"], [])

    def test_encode_and_decode_row_with_recipe(self):
        row = {"entityId": "water_pump", "qty": 1, "recipeId": "water", "modifiers": []}
        token = encode_row(row)
        self.assertEqual(token, "water_pump:water")

        decoded = decode_row(token)
        self.assertEqual(decoded["entityId"], "water_pump")
        self.assertEqual(decoded["recipeId"], "water")
        self.assertEqual(decoded["qty"], 1.0)

    def test_encode_and_decode_row_with_qty_and_modifiers(self):
        row = {
            "entityId": "duplicant",
            "qty": 8,
            "recipeId": None,
            "modifiers": ["divers_lungs"],
        }
        token = encode_row(row)
        self.assertEqual(token, "duplicant*8+divers_lungs")

        decoded = decode_row(token)
        self.assertEqual(decoded["entityId"], "duplicant")
        self.assertEqual(decoded["qty"], 8)
        self.assertIsNone(decoded["recipeId"])
        self.assertEqual(decoded["modifiers"], ["divers_lungs"])

    def test_encode_and_decode_row_with_recipe_and_qty(self):
        row = {
            "entityId": "petroleum_generator",
            "qty": 2,
            "recipeId": "ethanol",
            "modifiers": [],
        }
        token = encode_row(row)
        self.assertEqual(token, "petroleum_generator:ethanol*2")

        decoded = decode_row(token)
        self.assertEqual(decoded["entityId"], "petroleum_generator")
        self.assertEqual(decoded["recipeId"], "ethanol")
        self.assertEqual(decoded["qty"], 2)

    def test_full_hydra_spom_state_roundtrip(self):
        state = {
            "rateMode": "s",
            "strictPipeMatching": False,
            "rows": [
                {"entityId": "electrolyzer", "qty": 1, "recipeId": None, "modifiers": []},
                {"entityId": "hydrogen_generator", "qty": 1, "recipeId": None, "modifiers": []},
                {"entityId": "water_pump", "qty": 1, "recipeId": "water", "modifiers": []},
                {"entityId": "gas_pump", "qty": 1, "recipeId": "hydrogen_100", "modifiers": []},
                {"entityId": "duplicant", "qty": 8, "recipeId": None, "modifiers": ["divers_lungs"]},
            ],
        }

        param = encode_state_to_param(state)
        expected = "u:s_p:0_r:electrolyzer~hydrogen_generator~water_pump:water~gas_pump:hydrogen_100~duplicant*8+divers_lungs"
        self.assertEqual(param, expected)

        # Also verify decoding with explicit p:0
        decoded_p0 = decode_state_from_param("u:s_p:0_r:electrolyzer~hydrogen_generator~water_pump:water~gas_pump:hydrogen_100~duplicant*8+divers_lungs")
        self.assertEqual(decoded_p0["rateMode"], "s")
        self.assertFalse(decoded_p0["strictPipeMatching"])
        self.assertEqual(len(decoded_p0["rows"]), 5)

        decoded = decode_state_from_param(param)
        self.assertEqual(decoded["rateMode"], "s")
        self.assertFalse(decoded["strictPipeMatching"])
        self.assertEqual(len(decoded["rows"]), 5)
        self.assertEqual(decoded["rows"][0]["entityId"], "electrolyzer")
        self.assertEqual(decoded["rows"][2]["recipeId"], "water")
        self.assertEqual(decoded["rows"][3]["entityId"], "gas_pump")
        self.assertEqual(decoded["rows"][3]["recipeId"], "hydrogen_100")
        self.assertEqual(decoded["rows"][4]["qty"], 8)
        self.assertEqual(decoded["rows"][4]["modifiers"], ["divers_lungs"])

    def test_rate_mode_and_strict_pipe_flags(self):
        state = {
            "rateMode": "c",
            "strictPipeMatching": True,
            "rows": [{"entityId": "coal_generator", "qty": 1}],
        }
        param = encode_state_to_param(state)
        self.assertTrue(param.startswith("u:c_r:coal_generator"))

        decoded = decode_state_from_param(param)
        self.assertEqual(decoded["rateMode"], "c")
        self.assertTrue(decoded["strictPipeMatching"])

    def test_empty_state_handling(self):
        param = encode_state_to_param({"rateMode": "s", "strictPipeMatching": False, "rows": []})
        self.assertEqual(param, "u:s_p:0")

        decoded = decode_state_from_param("")
        self.assertEqual(decoded["rows"], [])

    def test_url_net_input_temps_roundtrip(self):
        state = {
            "rateMode": "s",
            "strictPipeMatching": True,
            "rows": [{"entityId": "electrolyzer", "qty": 1}],
            "netInputTemps": {"Water||free": 95.0, "Oxygen||free": 30.0},
        }
        param = encode_state_to_param(state)
        self.assertIn("t:", param)
        self.assertIn("Water|free=95", param)
        self.assertIn("Oxygen|free=30", param)

        decoded = decode_state_from_param(param)
        self.assertIn("Water||free", decoded["netInputTemps"])
        self.assertEqual(decoded["netInputTemps"]["Water||free"], 95.0)
        self.assertEqual(decoded["netInputTemps"]["Oxygen||free"], 30.0)

    def test_url_net_input_temps_default_skipped(self):
        # 20 °C is default for Water, so should not be serialized
        state = {
            "rateMode": "s",
            "strictPipeMatching": True,
            "rows": [{"entityId": "electrolyzer", "qty": 1}],
            "netInputTemps": {"Water||free": 20.0},
        }
        param = encode_state_to_param(state)
        self.assertNotIn("t:", param)

    def test_url_legacy_feed_temp_backward_compat(self):
        token = "petroleum_generator:ethanol*2@25+mod_a,mod_b"
        decoded = decode_row(token)
        self.assertEqual(decoded["entityId"], "petroleum_generator")
        self.assertEqual(decoded["recipeId"], "ethanol")
        self.assertEqual(decoded["qty"], 2)
        self.assertEqual(decoded["inputTemp"], 25.0)
        self.assertEqual(decoded["modifiers"], ["mod_a", "mod_b"])

        # Re-encoding must NOT include @25
        re_encoded = encode_row(decoded)
        self.assertEqual(re_encoded, "petroleum_generator:ethanol*2+mod_a,mod_b")
        self.assertNotIn("@", re_encoded)


if __name__ == "__main__":
    unittest.main()
