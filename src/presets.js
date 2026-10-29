/**
 * Built-in system presets for ONI Resource Calculator.
 * Features fractional machine utilization (e.g. 0.1x Water Pump, 0.224x Gas Pump)
 * and top-to-bottom resource flow with explicit loop start/end streams.
 */

export const PRESET_CATEGORIES = [
  "Power",
  "Manufacturing",
  "Materials",
  "Water Purification",
  "Life Support",
  "Food & Ranching",
];

export const PRESETS = [
  {
    id: "hydra_spom",
    name: "Hydra SPOM",
    category: "Life Support",
    description: "Self-Powered Oxygen Machine supporting 8 duplicants with net surplus hydrogen and power.",
    rateMode: "s",
    loops: [],
    rows: [
      { entityId: "liquid_pump", qty: 0.1, recipeId: "water", modifiers: [] },
      { entityId: "electrolyzer", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "gas_pump", qty: 0.224, recipeId: "hydrogen", modifiers: [] },
      { entityId: "hydrogen_generator", qty: 1.12, recipeId: null, modifiers: [] },
      { entityId: "duplicant", qty: 8, recipeId: null, modifiers: [], bathroom: "plumbed", food: "none" },
    ],
  },
  {
    id: "coal_skimmer_loop",
    name: "Coal Generator + Carbon Skimmer Loop",
    category: "Power",
    description: "Continuous 9 kW power generation with closed-loop CO2 scrubbing and water filtration.",
    rateMode: "s",
    loops: [],
    netInputTemps: {
      "Water||in a pipe": 20,
    },
    rows: [
      { entityId: "coal_generator", qty: 15, recipeId: null, modifiers: [] },
      { entityId: "gas_pump", qty: 0.6, recipeId: "carbon_dioxide", modifiers: [] },
      { entityId: "carbon_skimmer", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "water_sieve", qty: 0.2, recipeId: "sand", modifiers: [] },
    ],
  },
  {
    id: "stone_hatch_coal",
    name: "Stone Hatch Ranch (8x) + Coal Power",
    category: "Food & Ranching",
    description: "Sustainable ranch of 8 stone hatches consuming igneous rock to feed a coal generator and 8 duplicants.",
    rateMode: "s",
    loops: [],
    rows: [
      { entityId: "critter_stone_hatch", qty: 8, recipeId: "igneous_rock", modifiers: [] },
      { entityId: "coal_generator", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "electric_grill", qty: 0.1667, recipeId: "barbecue", modifiers: [] },
      { entityId: "duplicant", qty: 8, recipeId: null, modifiers: [], bathroom: "plumbed", food: "barbecue" },
    ],
  },
  {
    id: "arbor_ethanol_loop",
    name: "Arbor Tree Ethanol Power Loop",
    category: "Materials",
    description: "Closed-loop wood and ethanol cycle producing massive net power, polluted water, and dirt.",
    rateMode: "s",
    loops: [],
    netInputTemps: {
      "Polluted Water||in a pipe": 20,
    },
    rows: [
      { entityId: "plant_arbor_tree", qty: 8, recipeId: null, modifiers: [] },
      { entityId: "ethanol_distiller", qty: 4, recipeId: null, modifiers: [] },
      { entityId: "petroleum_generator", qty: 1, recipeId: "ethanol", modifiers: [] },
      { entityId: "gas_pump", qty: 0.6, recipeId: "carbon_dioxide", modifiers: [] },
      { entityId: "carbon_skimmer", qty: 1, recipeId: null, modifiers: [] },
    ],
  },
  {
    id: "natural_gas_geyser_power",
    name: "Natural Gas Geyser Power Plant",
    category: "Power",
    description: "Harvesting a natural gas geyser (105 g/s) with fractional gas pump (0.21x) and generator (1.1667x) for 100% fuel efficiency and clean power generation.",
    rateMode: "s",
    loops: [],
    rows: [
      { entityId: "geyser_natural_gas_geyser", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "gas_pump", qty: 0.21, recipeId: "natural_gas", modifiers: [] },
      { entityId: "natural_gas_generator", qty: 1.1667, recipeId: null, modifiers: [] },
    ],
  },
  {
    id: "oil_refinery_petroleum_loop",
    name: "Oil Refinery + Petroleum Power Plant",
    category: "Power",
    description: "Refines 10 kg/s Crude Oil into Petroleum and Natural Gas, supporting 5 kW continuous power generation.",
    rateMode: "s",
    loops: [],
    rows: [
      { entityId: "duplicant", qty: 1.3333, recipeId: "schedule_default", modifiers: [], bathroom: "plumbed", food: "none" },
      { entityId: "liquid_pump", qty: 1, recipeId: "crude_oil", modifiers: [] },
      { entityId: "oil_refinery", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "gas_pump", qty: 0.18, recipeId: "natural_gas", modifiers: [] },
      { entityId: "natural_gas_generator", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "petroleum_generator", qty: 2.5, recipeId: "petroleum", modifiers: [] },
    ],
  },
  {
    id: "glossy_drecko_plastic",
    name: "Glossy Drecko Plastic via Bristle Berry",
    category: "Materials",
    description: "Renewable plastic ranch utilizing Glossy Dreckos fed by live Bristle Blossom plants to produce plastic and phosphorite.",
    rateMode: "s",
    loops: [],
    rows: [
      { entityId: "plant_bristle_blossom", qty: 1, recipeId: "growth", modifiers: [] },
      { entityId: "critter_glossy_drecko", qty: 1, recipeId: "bristle_blossom_plastic", modifiers: [] },
    ],
  },
  {
    id: "drecko_reed_fiber_balm_lily",
    name: "Drecko Ranch (Reed Fiber) via Balm Lily",
    category: "Materials",
    description: "Zero-resource sustainable ranch utilizing regular Dreckos fed by live Balm Lily plants to produce Reed Fiber and Phosphorite in a Chlorine atmosphere.",
    rateMode: "s",
    loops: [],
    rows: [
      { entityId: "plant_balm_lily", qty: 1, recipeId: "growth", modifiers: [] },
      { entityId: "critter_drecko", qty: 1, recipeId: "balm_lily", modifiers: [] },
    ],
  },
  {
    id: "industrial_sauna",
    name: "Industrial Sauna",
    category: "Manufacturing",
    description: "Industrial sauna recycling heat from a glass forge and thermo aquatuner coolant loop into steam turbines, producing net positive power.",
    rateMode: "s",
    loops: [],
    netInputTemps: {
      "Polluted Water||in a pipe": 20,
      "Water||in a pipe": 95,
    },
    rows: [
      { entityId: "glass_forge", qty: 1, recipeId: "molten_glass", modifiers: [] },
      { entityId: "counterflow_heat_exchanger", qty: 0.05, material: "Molten Glass", materialState: "in a pipe", coldMaterial: "Water", coldMaterialState: "in a pipe", modifiers: [] },
      { entityId: "absorb_heat", qty: 10, material: "Polluted Water", materialState: "in a pipe", tempDelta: 14, modifiers: [] },
      { entityId: "thermo_aquatuner", qty: 1, recipeId: "polluted_water", modifiers: [] },
      { entityId: "absorb_heat", qty: 4, material: "Water", materialState: "in a pipe", tempDelta: 40.63, modifiers: [] },
      { entityId: "steam_turbine", qty: 2, recipeId: null, modifiers: ["engie_tuneup"] },
    ],
  },
  {
    id: "petroleum_boiler",
    name: "Petroleum Boiler",
    category: "Materials",
    description: "Counterflow petroleum boiler using outgoing hot petroleum to preheat incoming crude oil, requiring only a small volcano magma heat injection to flash 10 kg/s of crude oil into petroleum.",
    rateMode: "s",
    loops: [],
    netInputTemps: {
      "Petroleum||free": 405,
      "Crude Oil||free": 20,
    },
    rows: [
      { entityId: "liquid_pump", qty: 1, recipeId: "crude_oil", modifiers: [] },
      { entityId: "counterflow_heat_exchanger", qty: 16.9, material: "Petroleum", materialState: "free", coldMaterial: "Crude Oil", coldMaterialState: "in a pipe", modifiers: [] },
      { entityId: "liquid_pump", qty: 1, recipeId: "petroleum", modifiers: [] },
    ],
  },
  {
    id: "research_reactor_power",
    name: "Research Reactor Power Plant",
    category: "Power",
    description: "Nuclear power plant harnessing 5975 kDTU/s of heat from a Research Reactor to generate 10 kg/s of steam and 4.25 kW of continuous electrical power across 5 steam turbines.",
    rateMode: "s",
    loops: [],
    netInputTemps: {
      "Water||in a pipe": 95,
    },
    rows: [
      { entityId: "research_reactor", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "absorb_heat", qty: 10, material: "Water", materialState: "in a pipe", tempDelta: 142.98, modifiers: [] },
      { entityId: "steam_turbine", qty: 5, recipeId: null, modifiers: [] },
    ],
  },
  {
    id: "washroom_water_purification",
    name: "Washroom Water Purification Loop",
    category: "Water Purification",
    description: "Closed-loop washroom recycling polluted water from toilets, sinks, and a shower through a water sieve into clean surplus water.",
    rateMode: "s",
    loops: [],
    netInputTemps: {
      "Water||in a pipe": 37,
    },
    rows: [
      { entityId: "flush_toilet", qty: 4, recipeId: null, modifiers: [] },
      { entityId: "wash_sink", qty: 4, recipeId: null, modifiers: [] },
      { entityId: "shower", qty: 1, recipeId: null, modifiers: [] },
      { entityId: "water_sieve", qty: 0.02726664, recipeId: "sand", modifiers: [] },
    ],
  },
];

for (const preset of PRESETS) {
  Object.defineProperty(preset.rows, "_loops", {
    value: preset.loops || [],
    enumerable: false,
    writable: true,
  });
}

/**
 * Group presets by category.
 *
 * @returns {Record<string, Array<Object>>}
 */
export function getPresetsByCategory() {
  const groups = {};
  for (const cat of PRESET_CATEGORIES) {
    groups[cat] = [];
  }
  for (const preset of PRESETS) {
    const cat = preset.category || "Other";
    if (!groups[cat]) {
      groups[cat] = [];
    }
    groups[cat].push(preset);
  }
  return groups;
}

/**
 * Retrieve a preset by its identifier, defaulting to the Hydra SPOM preset.
 *
 * @param {string} id
 * @returns {Object}
 */
export function getPresetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}
