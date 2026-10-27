/**
 * Test Suite: UI Component HTML Rendering and DOM Markup.
 * Tests table row HTML, NET summary rows, loop start/end indicators,
 * action buttons, accessibility attributes, and branding.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ONI_DATASET } from "../src/dataset.js";
import { evaluateRow, calculateSystemNet } from "../src/calculator.js";
import { buildEntityCatalog } from "../src/data_loader.js";
import {
  renderTableRowHtml,
  renderLoopStartRowHtml,
  renderLoopEndRowHtml,
} from "../src/components/table_row.js";
import { renderNetSummaryRowHtml } from "../src/components/net_summary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { entityMap, elementMap } = buildEntityCatalog(ONI_DATASET);

describe("Table Row HTML Rendering", () => {
  it("renders table row HTML with entity name, stream rates, and drag controls", () => {
    const row = { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] };
    const evaluated = evaluateRow(row, entityMap, elementMap);

    const rowHtml = renderTableRowHtml(row, evaluated, elementMap, "s", 0, {}, 2);
    assert.ok(rowHtml.includes("Electrolyzer"));
    assert.ok(rowHtml.includes("Oxygen: +888 g/s"));
    assert.ok(rowHtml.includes("Hydrogen: +112 g/s"));
    assert.ok(rowHtml.includes("Water: -1 Kg/s"));
    assert.ok(rowHtml.includes("Power: -120 W"));

    // Drag handle & reorder buttons
    assert.ok(rowHtml.includes('class="row-reorder-tab"'));
    assert.ok(rowHtml.includes('class="row-drag-handle" draggable="true"'));
    assert.ok(rowHtml.includes('class="btn-reorder btn-move-up"'));
    assert.ok(rowHtml.includes('class="btn-reorder btn-move-down"'));
    assert.ok(rowHtml.includes('btn-move-up" data-row-index="0" title="Move row up" aria-label="Move row up" disabled'));

    // Bottom row has down arrow disabled
    const rowHtml2 = renderTableRowHtml(row, evaluated, elementMap, "s", 1, {}, 2);
    assert.ok(rowHtml2.includes('btn-move-down" data-row-index="1" title="Move row down" aria-label="Move row down" disabled'));
  });

  it("omits deprecated per-row feed temperature input field", () => {
    const row = { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] };
    const evaluated = evaluateRow(row, entityMap, elementMap);
    const rowHtml = renderTableRowHtml(row, evaluated, elementMap, "s", 0, {}, 2);

    assert.ok(!rowHtml.includes("input-temp-field"), "Row HTML should NOT contain per-row feed temp input");
    assert.ok(!rowHtml.includes("Feed:"), "Row HTML should NOT contain Feed: label");
  });

  it("embeds full unrounded float in match button data-target-qty attribute", () => {
    const targetFloat = 8.571183680466273;
    const mockMatches = {
      "out:Coal||free": { targetQty: targetFloat, isMatched: false },
    };
    const testRow = { entityId: "critter_stone_hatch", qty: 1, recipeId: "igneous_rock" };
    const evaluated = evaluateRow(testRow, entityMap, elementMap);
    const matchHtml = renderTableRowHtml(testRow, evaluated, elementMap, "s", 0, mockMatches);

    assert.ok(matchHtml.includes(`data-target-qty="${targetFloat}"`), "Must embed full unrounded float");
    assert.ok(matchHtml.includes("[match: 8.5712×]"), "Display text shows cleanly formatted 4-decimal quantity");
  });

  it("renders duplicant bathroom and food dropdown selectors", () => {
    const rowFloor = { entityId: "duplicant", qty: 2, bathroom: "floor" };
    const evalFloor = evaluateRow(rowFloor, entityMap, elementMap);
    const htmlFloor = renderTableRowHtml(rowFloor, evalFloor, elementMap, "s", 0, {});

    assert.ok(htmlFloor.includes('class="bathroom-select"'));
    assert.ok(htmlFloor.includes('value="floor" selected'));
    assert.ok(htmlFloor.includes('value="none"'));
    assert.ok(htmlFloor.includes('class="food-select"'));

    const rowNone = { entityId: "duplicant", qty: 3, bathroom: "none" };
    const evalNone = evaluateRow(rowNone, entityMap, elementMap);
    const htmlNone = renderTableRowHtml(rowNone, evalNone, elementMap, "s", 0, {});
    assert.ok(htmlNone.includes('value="none" selected'));
  });

  it("renders machine output stream [loop] and [unloop] toggle links", () => {
    const row = { entityId: "water_sieve", qty: 1, recipeId: "sand" };
    const evaluated = evaluateRow(row, entityMap, elementMap);
    const closedLoops = [{ resource: "Water", state: "in a pipe", rate: 5000, unit: "g/s" }];

    const sieveHtmlUnlooped = renderTableRowHtml(row, evaluated, elementMap, "s", 0, {}, 1, []);
    assert.ok(sieveHtmlUnlooped.includes("[loop]"), "Unlooped machine output must render [loop] link");

    const sieveHtmlLooped = renderTableRowHtml(row, evaluated, elementMap, "s", 0, {}, 1, closedLoops);
    assert.ok(sieveHtmlLooped.includes("[unloop]"), "Looped machine output must render [unloop] link");
  });
});

describe("NET Summary Row HTML Rendering", () => {
  it("renders NET summary row with net badge and net temperature input fields", () => {
    const row = { entityId: "electrolyzer", qty: 1 };
    const evaluated = evaluateRow(row, entityMap, elementMap);
    const net = calculateSystemNet([evaluated]);
    const netHtml = renderNetSummaryRowHtml(net, elementMap, "s", { "Water||in a pipe": 20 }, true);

    assert.ok(netHtml.includes("NET"));
    assert.ok(netHtml.includes("Oxygen: +888 g/s"));
    assert.ok(netHtml.includes("net-temp-input"));
    assert.ok(netHtml.includes('data-key="Water||in a pipe"'));
  });

  it("omits temperature inputs for non-thermal resources (Duplicant Labor, Calories, Microchips)", () => {
    const mgRow = { entityId: "manual_generator", qty: 1 };
    const mgEval = evaluateRow(mgRow, entityMap, elementMap);
    const mgNet = calculateSystemNet([mgEval]);
    const mgNetHtml = renderNetSummaryRowHtml(mgNet, elementMap, "s", {}, true);

    assert.ok(mgNetHtml.includes("Duplicant Labor: -1 s/s (labor)"));
    assert.ok(!mgNetHtml.includes('data-resource="Duplicant Labor"'));

    const tunedCg = evaluateRow({ entityId: "coal_generator", qty: 1, modifiers: ["engie_tuneup"] }, entityMap, elementMap);
    const cgNet = calculateSystemNet([tunedCg]);
    const cgNetHtml = renderNetSummaryRowHtml(cgNet, elementMap, "s", {}, true);
    assert.ok(cgNetHtml.includes("Microchip: -0.0006 chips/s (solid)"));
    assert.ok(!cgNetHtml.includes('data-resource="Microchip"'));
  });

  it("renders empty-state placeholders when all inputs or outputs are elided", () => {
    const emptyNet = calculateSystemNet([]);
    const emptyHtml = renderNetSummaryRowHtml(emptyNet, elementMap, "s");
    assert.ok(emptyHtml.includes("None (0 net input required)"));
    assert.ok(emptyHtml.includes("None (0 net surplus)"));
  });

  it("never renders negative zero (-0) in NET summary in second or cycle rate mode", () => {
    const dummyNet = {
      netPower: 0,
      netBuildingHeat: 0,
      netInputs: [],
      netOutputs: [],
    };
    const htmlS = renderNetSummaryRowHtml(dummyNet, elementMap, "s");
    assert.ok(!htmlS.includes("-0 "));
    assert.ok(!htmlS.includes("-0 s/s"));

    const htmlC = renderNetSummaryRowHtml(dummyNet, elementMap, "c");
    assert.ok(!htmlC.includes("-0 /cycle"));
  });
});

describe("Loop Start & Loop End Rows", () => {
  it("renders empty string when no loop streams exist", () => {
    assert.strictEqual(renderLoopStartRowHtml([], elementMap, "s"), "");
    assert.strictEqual(renderLoopEndRowHtml([], elementMap, "s"), "");
  });

  it("renders Loop Start and Loop End rows with arriving temperature on thermal streams", () => {
    const loopStreams = [
      { resource: "Water", state: "in a pipe", rate: 5000, unit: "g/s", tempC: 20.0, temp: "@ 20 °C" },
    ];
    const loopStartHtml = renderLoopStartRowHtml(loopStreams, elementMap, "s");
    const loopEndHtml = renderLoopEndRowHtml(loopStreams, elementMap, "s");

    assert.ok(loopStartHtml.includes("Loop Start"));
    assert.ok(loopStartHtml.includes("[unloop]"));
    assert.ok(loopEndHtml.includes("Loop End"));
    assert.ok(loopEndHtml.includes("[unloop]"));
    assert.ok(loopEndHtml.includes("@ 20 °C"));
  });
});

describe("Index HTML & UI Branding", () => {
  it("verifies branding and UI control specifications in index.html", () => {
    const indexHtml = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
    assert.ok(indexHtml.includes("Calculator Not Included"), "index.html must include Calculator Not Included branding");
    assert.ok(!indexHtml.includes("<code>calculatornotincluded.com</code>"), "Must not include old domain code tag");
    assert.ok(!indexHtml.includes("mass-unit-btn"), "Must NOT have deprecated mass-unit-btn selector");
  });
});
