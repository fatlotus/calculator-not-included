/**
 * Comprehensive Unit and Adversarial Test Suite for Structured Protocol Buffer URL State.
 * Tests ultra-compact enum/oneof wire format, preset roundtripping, numerical safety,
 * URL parsing variants, and fuzzing resilience.
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
} from "../src/url_state.js";
import {
  PROTO_SCHEMA,
  CalculatorStateType,
  RowStateType,
  NetTemperatureType,
  LoopedStreamType,
  ENTITY_TO_ENUM,
  ENUM_TO_ENTITY,
  RECIPE_TO_ENUM,
  ENUM_TO_RECIPE,
  MODIFIER_TO_ENUM,
  ENUM_TO_MODIFIER,
  ELEMENT_TO_ENUM,
  ENUM_TO_ELEMENT,
} from "../src/proto_catalog.js";

console.log("=== Running Protocol Buffer URL State Tests ===");

// 1. Schema and Type Verification (Zero String Fields)
{
  assert.ok(PROTO_SCHEMA.includes("message CalculatorState"), "Schema must define CalculatorState");
  assert.ok(PROTO_SCHEMA.includes("message RowState"), "Schema must define RowState");
  assert.ok(PROTO_SCHEMA.includes("message NetTemperature"), "Schema must define NetTemperature");
  assert.ok(PROTO_SCHEMA.includes("oneof count"), "RowState must use oneof count for compactness");
  assert.ok(PROTO_SCHEMA.includes("Recipe recipe = 4;"), "RowState must use Recipe enum");
  assert.ok(PROTO_SCHEMA.includes("Bathroom bathroom = 5;"), "RowState must use Bathroom enum");

  // Verify that RowState, NetTemperature, and CalculatorState have NO string fields
  const rowFields = Object.values(RowStateType.fields);
  for (const f of rowFields) {
    assert.notStrictEqual(f.type, "string", `RowState field ${f.name} must not be string`);
  }

  const netTempFields = Object.values(NetTemperatureType.fields);
  for (const f of netTempFields) {
    assert.notStrictEqual(f.type, "string", `NetTemperature field ${f.name} must not be string`);
  }

  const loopFields = Object.values(LoopedStreamType.fields);
  for (const f of loopFields) {
    assert.notStrictEqual(f.type, "string", `LoopedStream field ${f.name} must not be string`);
  }

  const calcFields = Object.values(CalculatorStateType.fields);
  for (const f of calcFields) {
    assert.notStrictEqual(f.type, "string", `CalculatorState field ${f.name} must not be string`);
  }

  console.log("✓ Proto schema verified: zero string fields in wire representation");
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

  console.log("✓ Base64 URL-safe conversion tests passed");
}

// 3. Preset Round-Trip Fidelity & Ultra-Compact Wire Size
{
  const { elementMap } = buildEntityCatalog();

  for (const preset of PRESETS) {
    const originalState = {
      rateMode: preset.rateMode || "s",
      rows: JSON.parse(JSON.stringify(preset.rows)),
      loops: preset.loops ? JSON.parse(JSON.stringify(preset.loops)) : [],
      netInputTemps: preset.netInputTemps ? JSON.parse(JSON.stringify(preset.netInputTemps)) : {},
    };

    const encodedParam = encodeStateToParam(originalState, elementMap);
    assert.ok(typeof encodedParam === "string" && encodedParam.length > 0, `Preset ${preset.id} failed to encode`);

    // Wire length check: even the largest preset should be under 100 bytes of wire
    const rawBytes = encodeStateToProtobuf(originalState, elementMap);
    assert.ok(
      rawBytes.length < 100,
      `Preset ${preset.id} wire size (${rawBytes.length} bytes) should be < 100 bytes`
    );

    const decodedState = decodeStateFromParam(encodedParam);
    assert.strictEqual(decodedState.rateMode, originalState.rateMode, `RateMode mismatch in preset ${preset.id}`);
    assert.strictEqual(decodedState.rows.length, originalState.rows.length, `Row count mismatch in preset ${preset.id}`);
    assert.strictEqual((decodedState.loops || []).length, originalState.loops.length, `Loop count mismatch in preset ${preset.id}`);
    for (let j = 0; j < originalState.loops.length; j++) {
      assert.strictEqual(decodedState.loops[j].resource, originalState.loops[j].resource);
      assert.strictEqual(decodedState.loops[j].state, originalState.loops[j].state);
      assert.strictEqual(decodedState.loops[j].rate, originalState.loops[j].rate);
      if (originalState.loops[j].tempC !== undefined) {
        assert.strictEqual(decodedState.loops[j].tempC, originalState.loops[j].tempC);
      }
    }

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
  console.log(`✓ All ${PRESETS.length} presets round-tripped with 100% fidelity and wire size < 100 bytes`);
}

// 4. Oneof and Structured Types Verification
{
  // Test integer count_int vs double count_double
  const mixedState = {
    rateMode: "c",
    rows: [
      { entityId: "electrolyzer", qty: 2 }, // Integer count -> uses count_int (2 bytes)
      { entityId: "liquid_pump", qty: 0.125, recipeId: "water" }, // Fractional -> uses count_double
      { entityId: "microbe_musher", qty: 0 }, // Zero quantity
      { entityId: "duplicant", qty: 8, bathroom: "outhouse", food: "barbecue", modifiers: ["divers_lungs"], inputTemp: -15.5 },
      { entityId: "duplicant", qty: 4, bathroom: "none", food: "none" },
    ],
    netInputTemps: {
      "Water||free": 95,
      "Hydrogen||in a pipe": -20.5,
    },
  };

  const bytes = encodeStateToProtobuf(mixedState);
  const rawDecoded = CalculatorStateType.decode(bytes);

  // Check oneof count on raw proto message
  assert.strictEqual(rawDecoded.rows[0].count, "countInt");
  assert.strictEqual(rawDecoded.rows[0].countInt, 2);

  assert.strictEqual(rawDecoded.rows[1].count, "countDouble");
  assert.strictEqual(rawDecoded.rows[1].countDouble, 0.125);

  assert.strictEqual(rawDecoded.rows[3].count, "countInt");
  assert.strictEqual(rawDecoded.rows[3].countInt, 8);
  assert.strictEqual(rawDecoded.rows[3].bathroom, 1); // BATHROOM_OUTHOUSE = 1

  assert.strictEqual(rawDecoded.rows[4].count, "countInt");
  assert.strictEqual(rawDecoded.rows[4].countInt, 4);
  assert.strictEqual(rawDecoded.rows[4].bathroom, 3); // BATHROOM_NONE = 3

  const restored = decodeStateFromProtobuf(bytes);
  assert.strictEqual(restored.rateMode, "c");
  assert.strictEqual(restored.rows.length, 5);
  assert.strictEqual(restored.rows[0].qty, 2);
  assert.strictEqual(restored.rows[1].qty, 0.125);
  assert.strictEqual(restored.rows[1].recipeId, "water");
  assert.strictEqual(restored.rows[2].qty, 0);
  assert.strictEqual(restored.rows[3].bathroom, "outhouse");
  assert.strictEqual(restored.rows[3].food, "barbecue");
  assert.strictEqual(restored.rows[3].inputTemp, -15.5);
  assert.strictEqual(restored.rows[4].bathroom, "none");
  assert.strictEqual(restored.rows[4].food, "none");
  assert.strictEqual(restored.netInputTemps["Water||free"], 95);
  assert.strictEqual(restored.netInputTemps["Hydrogen||in a pipe"], -20.5);

  console.log("✓ Oneof count, recipe, and bathroom enum fields verified on wire");
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

// 6. Adversarial Review & Fuzzing / Malformed Inputs
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
    "AAAA", // empty/invalid proto fields
    "//////",
    "------------------------",
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

// 7. Numerical Safety: NaN, Infinity, -Infinity
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

  // Non-finite temperatures must be excluded
  assert.strictEqual(decoded.netInputTemps["Water|free"], undefined);
  assert.strictEqual(decoded.netInputTemps["Oxygen|free"], undefined);
  assert.strictEqual(decoded.netInputTemps["Hydrogen|free"], 25);

  console.log("✓ Numerical safety and non-finite number filtering verified");
}

// 8. 100-Machine Design Scalability & Wire Size
{
  const largeState = {
    rateMode: "s",
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
      qty: (i % 5) + 1, // Integer quantities 1-5 (uses count_int)
      recipeId: i % 2 === 0 ? "water" : null,
      modifiers: i % 3 === 0 ? ["mod1", "mod2"] : [],
      bathroom: i % 5 === 0 ? "outhouse" : "plumbed",
    });
  }

  const encodedLarge = encodeStateToParam(largeState);
  assert.ok(encodedLarge.length > 0);
  assert.ok(
    encodedLarge.length < 1200,
    `100 machines state should easily fit in ~1KB URL with enums, was ${encodedLarge.length} chars`
  );

  const decodedLarge = decodeStateFromParam(encodedLarge);
  assert.strictEqual(decodedLarge.rows.length, 100);
  assert.strictEqual(decodedLarge.rows[99].qty, largeState.rows[99].qty);

  console.log(`✓ 100-machine complex design serialized into only ${encodedLarge.length} chars (~1KB!)`);
}

// 9. Meta-Machines Protocol Buffer Round-Trip
{
  const catalog = buildEntityCatalog();
  const metaState = {
    rateMode: "s",
    rows: [
      {
        entityId: "absorb_heat",
        qty: 45.5,
        material: "Polluted Water",
        materialState: "in a pipe",
      },
      {
        entityId: "counterflow_heat_exchanger",
        qty: 12.25,
        material: "Petroleum",
        materialState: "free",
        coldMaterial: "Crude Oil",
        coldMaterialState: "in a pipe",
      },
      {
        entityId: "absorb_heat",
        qty: 10,
        material: "Oxygen",
        materialState: "free",
      },
    ],
    netInputTemps: {},
    loops: [],
  };

  const encoded = encodeStateToParam(metaState, catalog.elementMap);
  assert.ok(encoded.length > 0, "Meta-machine state must serialize to non-empty param");
  const decoded = decodeStateFromParam(encoded);

  assert.strictEqual(decoded.rows.length, 3);
  assert.strictEqual(decoded.rows[0].entityId, "absorb_heat");
  assert.strictEqual(decoded.rows[0].qty, 45.5);
  assert.strictEqual(decoded.rows[0].material, "Polluted Water");
  assert.strictEqual(decoded.rows[0].materialState, "in a pipe");

  assert.strictEqual(decoded.rows[1].entityId, "counterflow_heat_exchanger");
  assert.strictEqual(decoded.rows[1].qty, 12.25);
  assert.strictEqual(decoded.rows[1].material, "Petroleum");
  assert.strictEqual(decoded.rows[1].materialState, "free");
  assert.strictEqual(decoded.rows[1].coldMaterial, "Crude Oil");
  assert.strictEqual(decoded.rows[1].coldMaterialState, "in a pipe");

  assert.strictEqual(decoded.rows[2].entityId, "absorb_heat");
  assert.strictEqual(decoded.rows[2].qty, 10);
  assert.strictEqual(decoded.rows[2].material, "Oxygen");
  assert.strictEqual(decoded.rows[2].materialState, "free");

  console.log("✓ Meta-machines Protocol Buffer roundtrip verified with custom materials and states");
}

console.log("\n ALL PROTOCOL BUFFER URL STATE TESTS PASSED SUCCESSFULLY! \n");
