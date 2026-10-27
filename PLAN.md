# ONI Resource Calculator (`onimath`) — Project Plan & Architecture

## 1. Project Overview & Goals
An information-dense, fast, responsive static web application (HTML + CSS + Vanilla JS ES Modules) and CLI tool that acts as a sequential resource flow and thermal accounting calculator for *Oxygen Not Included* (ONI). Users add machines, plants, critters, geysers, and duplicants to an ordered table, adjust quantities, recipes, and modifiers, loop output streams back to the top of the table (`Loop Start` / `Loop End`), and view individual row inputs/outputs alongside a real-time **NET** resource balance summary.

Key constraints & principles:
- **Authoritative Data Only**: Sourced strictly from `oxygennotincluded.wiki.gg` (MediaWiki API / Cargo tables / wikitext templates).
- **Sequential Top-to-Bottom Resource Flow**: Resources (materials, `Power`, and `Duplicant Labor`) flow strictly from the top of the table to the bottom (`Loop Start` $\rightarrow$ rows $0 \dots N-1$ $\rightarrow$ `Loop End`). Row order matters!
- **Explicit Feedback Loops (`Loop Start` & `Loop End`)**: Users can click `[loop]` next to any output stream to feed that resource back to the top of the table at a fixed rate and fixed temperature, rendered via pinned `Loop Start` and `Loop End` rows.
- **10 Curated Presets**: Demonstrating industrial networks, power plants, ranches, dynamic steam turbines, and counterflow boilers.
- **Static Hosting Ready**: Pure HTML, CSS, and modular ES6 JavaScript (`src/`), requiring zero build step to run in a browser.
- **Ultra-Compact Protocol Buffer URL State**: All calculator state (`rateMode`, `rows`, `netInputTemps`, and `loops`) is serialized into a zero-string Protocol Buffer binary payload encoded as URL-safe Base64 (`?s=...`).

---

## 2. Dataset & Entities (`src/oni_data.js`, `src/dataset.js`, `data/`)
The catalog encompasses **157 total entities**, **54 buildings/machines**, and **212 elements**:

1. **Buildings / Machines** (`data/buildings.json`):
   - **54 buildings/machines** covering power generators, oxygen producers, liquid/gas pumps, refineries, cooking stations, farming/ranching utilities, and heat management (`Thermo Aquatuner`, `Thermo Regulator`, `Steam Turbine`, `Ice Maker`, `Metal Refinery`, `Glass Forge`, `Sludge Press`, etc.).
   - Virtual **Meta-Machines** (`absorb_heat` and `counterflow_heat_exchanger`) for fluid heat transfer, thermal recovery, and boiling simulations.
   - Dynamic simulation rules: dynamic Steam Turbine power and heat scaling based on steam temperature $T \ge 125\text{ °C}$, Engie's Tune-Up generator boosts, and counterflow thermodynamic clamping.
2. **Duplicants** (`data/duplicants.json`):
   - Base consumption/production rates (Oxygen `-100 g/s`, Carbon Dioxide `+2 g/s`, Duplicant Labor `+0.75 s/s` on standard schedule, food diets, bathroom usage).
   - Modifiers & Traits: *Diver's Lungs*, *Deep Diver's Lungs*, *Mouth Breather*, *Bottomless Stomach*, *Flatulent*, plus Bionic Duplicant augmentations and schedules.
   - Bathroom modes: `Plumbed` (Lavatory), `Outhouse`, `Peeing on the floor`, or `None`.
3. **Critters / Animals** (`data/critters.json`):
   - Hatch (Regular, Sage, Stone, Smooth), Drecko (Regular, Glossy), Pacu, Puft, Slickster, Shove Vole, Pip, Pokeshell, Grubgrub, Sweetle, Plug Slug, Bammoth, Flox, etc.
   - Diet recipes, excretions, Meat/Pacu Fillet yields, reed fiber / plastic shearing, and `Wild` / `Glum` modifiers.
4. **Plants / Crops** (`data/plants.json`):
   - Mealwood, Bristle Blossom, Dusk Cap, Thimble Reed, Pincha Pepperplant, Sleet Wheat, Nosh Bean, Waterweed, Balm Lily, Oxyfern, Arbor Tree, Wheezewort, etc.
   - Harvest and `Growth` recipes (for Drecko grazing), irrigation/fertilization inputs, and `Wild` / `Farmer's Touch` / `Grubgrub Rub` modifiers.
5. **Elements & Icons** (`data/elements.json`):
   - **212 elements** with element states (`Gas`, `Liquid`, `Solid`), specific heat capacity (SHC in `DTU/(g·°C)`), default temperatures, `high_temp_transition`, `low_temp_transition`, and canonical icon URLs from `oxygennotincluded.wiki.gg`.
6. **Geysers / Vents / Volcanoes** (`data/geysers.json`):
   - Average eruption rates, fixed eruption temperatures, and `1x–5x Geotuned` modifiers with type-specific geotuning material inputs (Bleach Stone, Salt, Refined Phosphorus, Abyssalite).

---

## 3. Web Application & CLI Architecture

### 3.1 Table Structure & Controls
- **Pinned `Loop Start` Row (Top)**:
  - Shown whenever `state.loops` has one or more looped streams; hidden when nothing is looped.
  - Displays each looped stream in the **Outputs** column with its fixed rate, fixed temperature, and an `[unloop]` button.
- **Machine / Entity Rows (`0 .. N-1`)**:
  - **Column 1 (Machine)**: Drag handle (`⋮⋮`), `▲` / `▼` reorder buttons, quantity input, entity icon + wiki link + category pill, Mode/Recipe selector, material / delivery-state selectors (for Meta-Machines), Bathroom/Food selectors (for Duplicants), modifier pills, feed temperature override (when applicable), and row duplicate/remove buttons.
  - **Column 2 (Inputs)**: Negative resource and power consumption streams (`Power: -120 W`, `Water: -1 Kg/s (in a pipe)`), with `[match: X×]` links based on upstream available supply.
  - **Column 3 (Outputs)**: Building heat (`Heat: +1.25 kDTU/s`), positive resource and power production streams (`Oxygen: +888 g/s @ 70 °C (free)`), `[match: X×]` links based on downstream cumulative demand, and `[loop]` / `[unloop]` links.
- **Pinned `Loop End` Row (Bottom, before `NET`)**:
  - Shown whenever `state.loops` is non-empty; hidden when nothing is looped.
  - Displays each looped stream in the **Inputs** column with its negative rate, actual arriving temperature from the upstream pool, and an `[unloop]` button.
- **`NET` Summary Row**:
  - Displays cumulative **NET Inputs** (unmet deficits across the table and `Loop End`, with editable feed temperature inputs for thermal resources) and **NET Outputs** (unconsumed surpluses remaining after `Loop End`, plus net `Heat` and net `Power`).

### 3.2 Built-in Presets (`src/presets.js`)
All **10 presets** are ordered top-to-bottom and use `loops` for closed-loop resources and self-powered generator loops:
1. `hydra_spom` — **Hydra SPOM** (loops `Power: 896 W`)
2. `coal_skimmer_loop` — **Coal Generator + Carbon Skimmer Loop** (loops `Water (in a pipe): 1000 g/s @ 20 °C`)
3. `stone_hatch_coal` — **Stone Hatch Ranch (8x) + Coal Power**
4. `arbor_ethanol_loop` — **Arbor Tree Ethanol Power Loop** (loops `Polluted Water (in a pipe): 3500 g/s @ 75 °C`)
5. `natural_gas_geyser_power` — **Natural Gas Geyser Power Plant** (loops `Power: 800 W`)
6. `oil_refinery_petroleum_loop` — **Oil Refinery + Petroleum Power Plant** (loops `Power: 5000 W`)
7. `glossy_drecko_plastic` — **Glossy Drecko Plastic via Bristle Berry**
8. `drecko_reed_fiber_balm_lily` — **Drecko Ranch (Reed Fiber) via Balm Lily**
9. `industrial_sauna` — **Industrial Sauna** (loops `Power: 2400 W`, `Polluted Water (in a pipe): 10000 g/s @ 20 °C`, `Water (in a pipe): 4000 g/s @ 95 °C`)
10. `petroleum_boiler` — **Petroleum Boiler** (loops `Petroleum (free): 10000 g/s @ 405 °C`)

---

## 4. Directory Layout
```text
├── PLAN.md                        # Project plan and architectural overview
├── DESIGN.md                      # Detailed UI, sequential flow, loop, and protobuf specification
├── THERMAL_DESIGN.md              # ONI thermal math, output temperature rules, and loop heat tracking
├── index.html                     # Main static web app entry point
├── bin/
│   └── calc.js                    # CLI entry point for ASCII/JSON table rendering
├── styles/
│   └── main.css                   # Responsive GitHub-inspired light/dark styles
├── data/                          # Scraped ONI wiki.gg JSON datasets
├── src/
│   ├── app.js                     # Main UI controller & DOM event binding
│   ├── calculator.js              # Sequential top-to-bottom flow & thermal accounting engine
│   ├── data_loader.js             # Data normalization & search/autocomplete index
│   ├── dataset.js                 # Unified dataset module with elements, buildings, and recipes
│   ├── oni_data.js                # Bundled ONI dataset module
│   ├── presets.js                 # 10 built-in presets with top-to-bottom ordering & loops
│   ├── state.proto                # Protocol Buffer schema (RowState, NetTemperature, LoopedStream)
│   ├── proto_catalog.js           # Deterministic enum mappings for entities, recipes, modifiers, elements
│   ├── url_state.js               # Zero-string Protocol Buffer URL state encoder/decoder
│   ├── text_renderer.js           # Plain-text ASCII table and JSON state renderer
│   └── components/
│       ├── table_row.js           # Machine row, Loop Start row, and Loop End row HTML rendering
│       ├── autocomplete.js        # Typeahead search dropdown with icons & keyboard navigation
│       └── net_summary.js         # NET summary row rendering & feed temperature controls
└── tests/
    ├── test_js_modules.js         # Comprehensive unit & integration test suites (Suites 1–27)
    ├── test_url_state_protobuf.js # Protocol Buffer schema, wire size, round-trip, and fuzzing tests
    ├── test_cli_snapshots.js      # End-to-end CLI snapshot test runner
    └── snapshots/*.txt            # Golden ASCII table snapshots for all 10 presets
```

---

## 5. Verification & Test Suite Summary (Suites 1–27)
The project maintains a 100% passing test suite across JavaScript modules, Protocol Buffer state serialization, and CLI snapshots:

- **Suite 1**: Dataset Integrity & JSON files (buildings, plants, critters, duplicants, geysers, elements).
- **Suite 2**: Data Loader & Entity Catalog (157 entities, 54 buildings/machines, element aliases).
- **Suite 3**: Calculator & Math Engine (base rates, modifiers, diets, bathroom modes).
- **Suite 4**: URL State Serialization (Protocol Buffer base64 encoding/decoding, non-finite handling).
- **Suite 5**: Presets & Strict Pipe Matching (all 10 presets valid, delivery states matched).
- **Suite 6**: Component HTML Rendering (table rows, modifier pills, selectors).
- **Suite 7**: Bionic Duplicants Augmentations & Schedules.
- **Suite 8**: Regular Duplicants: Bathroom Options and Exhaled CO2.
- **Suite 9**: Non-Thermal Resources: Duplicant Labor, Calories, and Plant Growth.
- **Suite 10**: Geotuner Connected Inputs by Geyser Type.
- **Suite 11**: Elision of Small Net Resource Inputs & Outputs (Roundoff Error Handling).
- **Suite 12**: Icon Integrity & Verified MediaWiki URLs.
- **Suite 13**: Sludge Press Recipes & Mud Extraction.
- **Suite 14**: Compost Heating & Dirt Production.
- **Suite 15**: Peat Burner Building & Tune-Up.
- **Suite 16**: Brackwax Gleaner Building & Recipes.
- **Suite 17**: Glass Forge Sand Smelting & Molten Glass.
- **Suite 18**: Bleach Stone Hopper Production.
- **Suite 19**: Molecular Forge Super Coolant & Thermium Synthesis.
- **Suite 20**: Plant Pulverizer Seed & Crop Crushing.
- **Suite 21**: Thermo Regulator Gas Cooling Loop.
- **Suite 22**: Rock Crusher Crushed Metal & Lime.
- **Suite 23**: Metal Refinery Liquid Coolant Thermal Exchange.
- **Suite 24**: Ice Maker Freezing & Ambient Heat Dissipation.
- **Suite 25**: Closed Loop Matching, Unrounded Match Precision, and Thermal Isolation.
- **Suite 26**: Meta-Machine: Absorb Heat into liquid / gas / solid and 212 Element Transitions.
- **Suite 27**: Meta-Machine: Counterflow Heat Exchanger and Thermal Clamping.
- **Suite 28 / Dynamic Steam Turbine**: Dynamic Steam Turbine Power & Heat Simulation.
- **Protocol Buffer URL State Tests**: Wire size < 100 bytes for all 10 presets, oneof fields, fuzzing resilience.
- **CLI Snapshot Tests**: Golden ASCII snapshots verified for all 10 presets across flags, base64 args, and piped stdin.
