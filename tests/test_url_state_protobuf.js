/**
 * Comprehensive Unit and Adversarial Test Suite for Protocol Buffer URL State Serialization.
 * Tests edge cases, corrupt payloads, fuzzing, backward compatibility, and roundtripping.
 * Run with: node tests/test_url_state_protobuf.js
 */

import assert from "node:assert";
import { PRESETS } from "../src/presets.js";
import { buildEntityCatalog } from "../src/data_loader.js";
import {
  encodeStateToParam,
  decodeStateFromParam,
  encodeStateToProtobuf,
  decodeStateFromProtobuf,
  uint8ArrayToUrlSafeBase64,
  urlSafeBase64ToUint8Array,
  decodeLegacyString,
  encodeRow,
  decodeRow,
  PROTO_SCHEMA,
} from "../src/url_state.js";

console.log("=== Running Protocol Buffer URL State Tests ===");

// 1. Schema and Type Initialization
{
  assert.ok(PROTO_SCHEMA.includes("message CalculatorState"), "Schema must define CalculatorState");
  assert.ok(PROTO_SCHEMA.includes("message RowState"), "Schema must define RowState");
  assert.ok(PROTO_SCHEMA.includes("enum RateMode"), "Schema must define RateMode");
  console.log("✓ Proto schema definitions verified");
}

// 2. Base64 URL-safe conversion resilience
{
  const testBytes = new Uint8Array([0, 1, 2, 255, 254, 253, 127, 128, 63, 64]);
  const safeB64 = uint8ArrayToUrlSafeBase64(testBytes);
  assert.strictEqual(/^[A-Za-z0-9_-]+$/.test(safeB64), true, "Must only contain URL-safe characters");
  assert.strictEqual(safeB64.includes("+"), false, "Must not contain +");
  assert.strictEqual(safeB64.includes("/"), false, "Must not contain /");
  assert.strictEqual(safeB64.includes("="), false, "Must not contain padding =");

  const restoredBytes = urlSafeBase64ToUint8Array(safeB64);
  assert.deepStrictEqual(Array.from(restoredBytes), Array.from(testBytes));

  // Empty or null
  assert.strictEqual(uint8ArrayToUrlSafeBase64(null), "");
  assert.strictEqual(uint8ArrayToUrlSafeBase64(new Uint8Array(0)), "");
  assert.strictEqual(urlSafeBase64ToUint8Array(null), null);
  assert.strictEqual(urlSafeBase64ToUint8Array(""), null);

  // URL-safe with standard base64 input (containing + and / and =)
  const stdB64 = "AP/+/f+A/w==";
  const decodedStd = urlSafeBase64ToUint8Array(stdB64);
  assert.ok(decodedStd && decodedStd.length > 0);

  // Unencoded space replacing '+'
  const spaceB64 = "AP/ /f A/w==";
  const decodedSpace = urlSafeBase64ToUint8Array(spaceB64);
  assert.deepStrictEqual(decodedSpace, decodedStd);

  // URL-encoded '%2B' and '%2F'
  const uriEncodedB64 = "AP%2F%2B%2Ff%2BA%2Fw%3D%3D";
  const decodedUri = urlSafeBase64ToUint8Array(uriEncodedB64);
  assert.deepStrictEqual(decodedUri, decodedStd);

  console.log("✓ Base64 URL-safe conversion tests passed");
}

// 3. Preset Round-Trip Fidelity
{
  const { elementMap } = buildEntityCatalog();

  for (const preset of PRESETS) {
    const originalState = {
      rateMode: preset.rateMode || "s",
      strictPipeMatching: true,
      rows: JSON.parse(JSON.stringify(preset.rows)),
      netInputTemps: preset.netInputTemps ? JSON.parse(JSON.stringify(preset.netInputTemps)) : {},
    };

    const encodedParam = encodeStateToParam(originalState, elementMap);
    assert.ok(typeof encodedParam === "string" && encodedParam.length > 0, `Preset ${preset.id} failed to encode`);

    const decodedState = decodeStateFromParam(encodedParam);
    assert.strictEqual(decodedState.rateMode, originalState.rateMode, `RateMode mismatch in preset ${preset.id}`);
    assert.strictEqual(decodedState.strictPipeMatching, true);
    assert.strictEqual(decodedState.rows.length, originalState.rows.length, `Row count mismatch in preset ${preset.id}`);

    for (let i = 0; i < originalState.rows.length; i++) {
      const origRow = originalState.rows[i];
      const decRow = decodedState.rows[i];
      assert.strictEqual(decRow.entityId, origRow.entityId, `EntityId mismatch in preset ${preset.id} row ${i}`);
      assert.strictEqual(decRow.qty, origRow.qty, `Qty mismatch in preset ${preset.id} row ${i}`);
      assert.strictEqual(decRow.recipeId, origRow.recipeId || null, `RecipeId mismatch in preset ${preset.id} row ${i}`);
      assert.deepStrictEqual(decRow.modifiers, origRow.modifiers || [], `Modifiers mismatch in preset ${preset.id} row ${i}`);
      if (origRow.entityId === "duplicant") {
        assert.strictEqual(decRow.bathroom, origRow.bathroom || "plumbed", `Bathroom mismatch in preset ${preset.id} row ${i}`);
      }
    }
  }
  console.log(`✓ All ${PRESETS.length} presets round-tripped with 100% fidelity`);
}

// 4. Detailed Corner Cases for Rows and State
{
  // Fractional quantities and zero
  const fractionalState = {
    rateMode: "c",
    strictPipeMatching: false,
    rows: [
      { entityId: "liquid_pump", qty: 0.0001, recipeId: "water", modifiers: [] },
      { entityId: "gas_pump", qty: 0.224, recipeId: "hydrogen", modifiers: ["mod_a", "mod_b"] },
      { entityId: "microbe_musher", qty: 0, recipeId: null, modifiers: [] },
      { entityId: "duplicant", qty: 12.5, modifiers: ["bionic_booster"], bathroom: "outhouse", inputTemp: 37.5 },
    ],
    netInputTemps: {
      "Water||in a pipe": 15.5,
      "Hydrogen||free": -10.25,
      "Oxygen|free": 0,
    },
  };

  const param = encodeStateToParam(fractionalState);
  const decoded = decodeStateFromParam(param);

  assert.strictEqual(decoded.rateMode, "c");
  assert.strictEqual(decoded.strictPipeMatching, false);
  assert.strictEqual(decoded.rows.length, 4);

  assert.strictEqual(decoded.rows[0].qty, 0.0001);
  assert.strictEqual(decoded.rows[1].qty, 0.224);
  assert.deepStrictEqual(decoded.rows[1].modifiers, ["mod_a", "mod_b"]);
  assert.strictEqual(decoded.rows[2].qty, 0);

  assert.strictEqual(decoded.rows[3].entityId, "duplicant");
  assert.strictEqual(decoded.rows[3].qty, 12.5);
  assert.strictEqual(decoded.rows[3].bathroom, "outhouse");
  assert.strictEqual(decoded.rows[3].inputTemp, 37.5);

  assert.strictEqual(decoded.netInputTemps["Water||in a pipe"], 15.5);
  assert.strictEqual(decoded.netInputTemps["Water|in a pipe"], 15.5);
  assert.strictEqual(decoded.netInputTemps["Hydrogen||free"], -10.25);
  assert.strictEqual(decoded.netInputTemps["Hydrogen|free"], -10.25);
  assert.strictEqual(decoded.netInputTemps["Oxygen|free"], 0);
  assert.strictEqual(decoded.netInputTemps["Oxygen||free"], 0);

  // Empty rows with strictPipeMatching: false must preserve false flag
  const emptyDisabledPipe = {
    rateMode: "s",
    strictPipeMatching: false,
    rows: [],
  };
  const emptyParam = encodeStateToParam(emptyDisabledPipe);
  const decodedEmptyPipe = decodeStateFromParam(emptyParam);
  assert.strictEqual(decodedEmptyPipe.strictPipeMatching, false);

  console.log("✓ Detailed state, fractional quantities, and bathroom corner cases passed");
}

// 5. URL Prefix, Full URLs, and Formatting Variants
{
  const state = {
    rateMode: "s",
    rows: [{ entityId: "electrolyzer", qty: 1 }],
  };
  const rawParam = encodeStateToParam(state);

  // Leading '?s='
  const decodedWithQuery = decodeStateFromParam(`?s=${rawParam}`);
  assert.strictEqual(decodedWithQuery.rows.length, 1);
  assert.strictEqual(decodedWithQuery.rows[0].entityId, "electrolyzer");

  // Leading 's='
  const decodedWithParamKey = decodeStateFromParam(`s=${rawParam}`);
  assert.strictEqual(decodedWithParamKey.rows.length, 1);

  // Full URL: https://calculatornotincluded.com/?s=...
  const decodedFullUrl = decodeStateFromParam(`https://calculatornotincluded.com/?s=${rawParam}`);
  assert.strictEqual(decodedFullUrl.rows.length, 1);
  assert.strictEqual(decodedFullUrl.rows[0].entityId, "electrolyzer");

  // Full URL with trailing query parameters and fragment: ?s=...&theme=dark#calculator
  const decodedMultiParamUrl = decodeStateFromParam(`https://calculatornotincluded.com/?s=${rawParam}&theme=dark#calc`);
  assert.strictEqual(decodedMultiParamUrl.rows.length, 1);
  assert.strictEqual(decodedMultiParamUrl.rows[0].entityId, "electrolyzer");

  // Optional 'pb:' prefix
  const decodedWithPbPrefix = decodeStateFromParam(`pb:${rawParam}`);
  assert.strictEqual(decodedWithPbPrefix.rows.length, 1);

  // Leading & trailing whitespace
  const decodedWithWhitespace = decodeStateFromParam(`   ?s=${rawParam}   \n`);
  assert.strictEqual(decodedWithWhitespace.rows.length, 1);

  console.log("✓ URL prefix, full URL parsing, and whitespace stripping variants passed");
}

// 6. Backward Compatibility with Legacy Formats
{
  // 6a. Legacy compact human-readable format
  const legacyHuman = "u:c_r:electrolyzer*2~duplicant*8+divers_lungs!outhouse_t:Water|free=80";
  const decLegacyHuman = decodeStateFromParam(legacyHuman);
  assert.strictEqual(decLegacyHuman.rateMode, "c");
  assert.strictEqual(decLegacyHuman.rows.length, 2);
  assert.strictEqual(decLegacyHuman.rows[0].entityId, "electrolyzer");
  assert.strictEqual(decLegacyHuman.rows[0].qty, 2);
  assert.strictEqual(decLegacyHuman.rows[1].entityId, "duplicant");
  assert.strictEqual(decLegacyHuman.rows[1].qty, 8);
  assert.strictEqual(decLegacyHuman.rows[1].bathroom, "outhouse");
  assert.deepStrictEqual(decLegacyHuman.rows[1].modifiers, ["divers_lungs"]);
  assert.strictEqual(decLegacyHuman.netInputTemps["Water|free"], 80);
  assert.strictEqual(decLegacyHuman.netInputTemps["Water||free"], 80);

  // 6b. Legacy string starting with "r:" without "u:"
  const legacyROnly = "r:electrolyzer*2~carbon_skimmer";
  const decLegacyROnly = decodeStateFromParam(legacyROnly);
  assert.strictEqual(decLegacyROnly.rows.length, 2);
  assert.strictEqual(decLegacyROnly.rows[0].entityId, "electrolyzer");
  assert.strictEqual(decLegacyROnly.rows[0].qty, 2);

  // 6c. Legacy base64 JSON (b64:...)
  const jsonPayload = JSON.stringify({
    rateMode: "s",
    rows: [{ entityId: "algae_terrarium", qty: 5, recipeId: null, modifiers: [] }],
    netInputTemps: { "Water||free": 30 },
  });
  const b64Json = Buffer.from(jsonPayload, "utf8").toString("base64");
  const decB64Json = decodeStateFromParam(`b64:${b64Json}`);
  assert.strictEqual(decB64Json.rows.length, 1);
  assert.strictEqual(decB64Json.rows[0].entityId, "algae_terrarium");
  assert.strictEqual(decB64Json.rows[0].qty, 5);
  assert.strictEqual(decB64Json.netInputTemps["Water||free"], 30);

  // 6d. Raw JSON string
  const decRawJson = decodeStateFromParam(jsonPayload);
  assert.strictEqual(decRawJson.rows.length, 1);
  assert.strictEqual(decRawJson.rows[0].entityId, "algae_terrarium");

  console.log("✓ Backward compatibility with all legacy formats passed");
}

// 7. Adversarial Review & Fuzzing / Malformed Inputs
{
  const invalidInputs = [
    null,
    undefined,
    "",
    "   ",
    "\n\t",
    12345,
    true,
    false,
    {},
    [],
    () => {},
    "???",
    "!@#$%^&*()",
    "b64:invalid-json-content-here!!!",
    "pb:not-valid-base64-at-all",
    "==",
    "====",
    "A", // 1 char base64 (invalid length)
    "AAAA", // 3 bytes 0x00, 0x00, 0x00 - empty/invalid proto fields
    "//////",
    "------------------------",
    "u:invalid_format_without_proper_tokens",
    encodeURIComponent("??? invalid %%%"),
    "A".repeat(70000), // Exceeds MAX_PARAM_STRING_LENGTH (DoS protection)
  ];

  for (const input of invalidInputs) {
    try {
      const result = decodeStateFromParam(input);
      assert.ok(result && typeof result === "object", "Must return object on invalid input");
      assert.ok(Array.isArray(result.rows), "result.rows must be array");
      assert.strictEqual(typeof result.rateMode, "string", "rateMode must be string");
    } catch (err) {
      assert.fail(`decodeStateFromParam crashed on input '${input}': ${err.message}`);
    }
  }

  // Fuzz testing: random bytes encoded to base64
  for (let i = 0; i < 50; i++) {
    const len = Math.floor(Math.random() * 64) + 1;
    const randomBytes = new Uint8Array(len);
    for (let j = 0; j < len; j++) {
      randomBytes[j] = Math.floor(Math.random() * 256);
    }
    const fuzzB64 = uint8ArrayToUrlSafeBase64(randomBytes);
    try {
      const fuzzResult = decodeStateFromParam(fuzzB64);
      assert.ok(fuzzResult && typeof fuzzResult === "object");
      assert.ok(Array.isArray(fuzzResult.rows));
    } catch (err) {
      assert.fail(`decodeStateFromParam crashed on fuzz input: ${err.message}`);
    }
  }

  console.log("✓ Adversarial and fuzzing inputs handled gracefully without throwing");
}

// 8. Numerical Safety: NaN, Infinity, -Infinity, Prototype Pollution
{
  const dangerousState = {
    rateMode: "s",
    rows: [
      { entityId: "electrolyzer", qty: Infinity },
      { entityId: "gas_pump", qty: -5 },
      { entityId: "liquid_pump", qty: NaN },
      { entityId: "duplicant", qty: 4, inputTemp: Infinity },
    ],
    netInputTemps: {
      "__proto__": 100,
      "prototype": 100,
      "constructor": 100,
      "Water|free": Infinity,
      "Oxygen|free": NaN,
      "Hydrogen|free": 25,
    },
  };

  const encoded = encodeStateToParam(dangerousState);
  const decoded = decodeStateFromParam(encoded);

  // Quantities must be sanitized to valid finite numbers >= 0
  assert.strictEqual(decoded.rows[0].qty, 1);
  assert.strictEqual(decoded.rows[1].qty, 1);
  assert.strictEqual(decoded.rows[2].qty, 1);
  assert.strictEqual(decoded.rows[3].inputTemp, undefined);

  // Prototype pollution keys and non-finite numbers must be excluded as own properties
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decoded.netInputTemps, "__proto__"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decoded.netInputTemps, "prototype"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(decoded.netInputTemps, "constructor"), false);
  assert.strictEqual(decoded.netInputTemps["Water|free"], undefined);
  assert.strictEqual(decoded.netInputTemps["Oxygen|free"], undefined);
  assert.strictEqual(decoded.netInputTemps["Hydrogen|free"], 25);
  assert.strictEqual(Object.prototype.polluted, undefined);

  console.log("✓ Numerical safety and prototype pollution defense verified");
}

// 9. Large System Design Scalability
{
  const largeState = {
    rateMode: "s",
    strictPipeMatching: true,
    rows: [],
    netInputTemps: {},
  };

  const sampleEntities = [
    "electrolyzer",
    "gas_pump",
    "liquid_pump",
    "hydrogen_generator",
    "coal_generator",
    "duplicant",
    "water_sieve",
    "oil_refinery",
  ];

  for (let i = 0; i < 100; i++) {
    largeState.rows.push({
      entityId: sampleEntities[i % sampleEntities.length],
      qty: 1.5 + (i * 0.1),
      recipeId: i % 2 === 0 ? "water" : null,
      modifiers: i % 3 === 0 ? ["mod1", "mod2"] : [],
      bathroom: i % 5 === 0 ? "outhouse" : "plumbed",
    });
  }

  const encodedLarge = encodeStateToParam(largeState);
  assert.ok(encodedLarge.length > 0);
  assert.ok(
    encodedLarge.length < 5000,
    `100 machines state should easily fit in under 5KB URL, was ${encodedLarge.length} chars`
  );

  const decodedLarge = decodeStateFromParam(encodedLarge);
  assert.strictEqual(decodedLarge.rows.length, 100);
  assert.strictEqual(decodedLarge.rows[99].qty, largeState.rows[99].qty);

  console.log(`✓ 100-machine complex design serialized into ${encodedLarge.length} chars and decoded identically`);
}

// 10. Mutation Safety
{
  const state = {
    rateMode: "s",
    rows: [{ entityId: "electrolyzer", qty: 1, modifiers: ["mod_a"] }],
    netInputTemps: { "Water||free": 95 },
  };

  const param = encodeStateToParam(state);
  const dec1 = decodeStateFromParam(param);
  const dec2 = decodeStateFromParam(param);

  // Mutate dec1
  dec1.rows[0].qty = 999;
  dec1.rows[0].modifiers.push("mod_b");
  dec1.netInputTemps["Water||free"] = 0;

  // Verify dec2 remains completely unaffected
  assert.strictEqual(dec2.rows[0].qty, 1);
  assert.deepStrictEqual(dec2.rows[0].modifiers, ["mod_a"]);
  assert.strictEqual(dec2.netInputTemps["Water||free"], 95);

  console.log("✓ Mutation safety verified");
}

console.log("\n ALL PROTOCOL BUFFER URL STATE TESTS PASSED SUCCESSFULLY! \n");
