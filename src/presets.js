/**
 * Built-in system presets for ONI Resource Calculator.
 * Features fractional machine utilization (e.g. 0.1x Water Pump, 0.224x Gas Pump).
 */

export const PRESETS = [
  {
    id: "hydra_spom",
    name: "Hydra SPOM (PDF Example)",
    description: "Self-Powered Oxygen Machine supporting 8 duplicants with net surplus hydrogen and power.",
    rateMode: "s",
    rows: [
      { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "liquid_pump", qty: 0.1, recipeId: "water", modifiers: [] },
      { entityId: "gas_pump", qty: 0.224, recipeId: "hydrogen", modifiers: [] },
      { entityId: "hydrogen_generator", qty: 1.12, recipeId: null, modifiers: [] },
      { entityId: "duplicant", qty: 8, recipeId: null, modifiers: [], bathroom: "plumbed" },
    ],
  },
  {
    id: "coal_skimmer_loop",
    name: "Coal Generator + Carbon Skimmer Loop",
    description: "Continuous 600 W power generation with closed-loop CO2 scrubbing and water filtration.",
    rateMode: "s",
    rows: [
      { entityId: "coal_generator", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "carbon_skimmer", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "water_sieve", qty: 1, recipeId: "sand", modifiers: [] },
    ],
  },
  {
    id: "stone_hatch_coal",
    name: "Stone Hatch Ranch (8x) + Coal Power",
    description: "Sustainable ranch of 8 stone hatches consuming igneous rock to feed a coal generator and 8 duplicants.",
    rateMode: "s",
    rows: [
      { entityId: "critter_stone_hatch", qty: 8, recipeId: "igneous_rock", modifiers: [] },
      { entityId: "coal_generator", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "duplicant", qty: 8, recipeId: null, modifiers: [], bathroom: "plumbed" },
    ],
  },
  {
    id: "arbor_ethanol_loop",
    name: "Arbor Tree Ethanol Power Loop",
    description: "Closed-loop wood and ethanol cycle producing massive net power, polluted water, and dirt.",
    rateMode: "s",
    rows: [
      { entityId: "plant_arbor_tree", qty: 8, recipeId: null, modifiers: [] },
      { entityId: "ethanol_distiller", qty: 4, recipeId: null, modifiers: [] },
      { entityId: "petroleum_generator", qty: 1, recipeId: "ethanol", modifiers: [] },
      { entityId: "carbon_skimmer", qty: 1, recipeId: null, modifiers: [] },
    ],
  },
  {
    id: "natural_gas_geyser_power",
    name: "Natural Gas Geyser Power Plant",
    description: "Harvesting a natural gas geyser (105 g/s) with fractional gas pump (0.21x) and generator (1.1667x) for 100% fuel efficiency and clean power generation.",
    rateMode: "s",
    rows: [
      { entityId: "geyser_natural_gas_geyser", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "gas_pump", qty: 0.21, recipeId: "natural_gas", modifiers: [] },
      { entityId: "natural_gas_generator", qty: 1.1667, recipeId: null, modifiers: [] },
    ],
  },
  {
    id: "oil_refinery_petroleum_loop",
    name: "Oil Refinery + Petroleum Power Plant",
    description: "Refines 10 kg/s Crude Oil into Petroleum and Natural Gas, supporting 5 kW continuous power generation.",
    rateMode: "s",
    rows: [
      { entityId: "oil_refinery", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "liquid_pump", qty: 1, recipeId: "crude_oil", modifiers: [] },
      { entityId: "gas_pump", qty: 0.18, recipeId: "natural_gas", modifiers: [] },
      { entityId: "natural_gas_generator", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "petroleum_generator", qty: 2.5, recipeId: "petroleum", modifiers: [] },
      { entityId: "duplicant", qty: 1.3333, recipeId: "schedule_default", modifiers: [], bathroom: "plumbed" },
    ],
  },
  {
    id: "glossy_drecko_plastic",
    name: "Glossy Drecko Plastic via Bristle Berry",
    description: "Renewable plastic ranch utilizing Glossy Dreckos fed by live Bristle Blossom plants to produce plastic and phosphorite.",
    rateMode: "s",
    rows: [
      { entityId: "critter_glossy_drecko", qty: 3, recipeId: "bristle_blossom_plastic", modifiers: [] },
      { entityId: "plant_bristle_blossom", qty: 3, recipeId: "growth", modifiers: [] },
    ],
  },
];

/**
 * Retrieve a preset by its identifier, defaulting to the Hydra SPOM preset.
 *
 * @param {string} id
 * @returns {Object}
 */
export function getPresetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}
