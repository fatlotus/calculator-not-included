# ONI Resource Calculator (`onimath`) — Project Plan & Architecture

## 1. Project Overview & Goals
An information-dense, fast, responsive static web application (HTML + CSS + Vanilla JS ES Modules) and CLI tool that acts as a sequential resource flow and thermal accounting calculator for *Oxygen Not Included* (ONI). Users add machines, plants, critters, geysers, and duplicants to an ordered table, adjust quantities, recipes, and modifiers, loop output streams back to the top of the table (`Loop Start` / `Loop End`), and view individual row inputs/outputs alongside a real-time **NET** resource balance summary.

Key constraints & principles:
- **Authoritative Data Only**: Sourced strictly from `oxygennotincluded.wiki.gg` (MediaWiki API / Cargo tables / wikitext templates).
- **Sequential Top-to-Bottom Resource Flow**: Resources (materials, `Power`, and `Duplicant Labor`) flow strictly from the top of the table to the bottom (`Loop Start` $\rightarrow$ rows $0 \dots N-1$ $\rightarrow$ `Loop End`). Row order matters!
- **Explicit Feedback Loops (`Loop Start` & `Loop End`)**: Users can click `[loop]` next to any output stream to feed that resource back to the top of the table at a fixed rate and fixed temperature, rendered via pinned `Loop Start` and `Loop End` rows.
- **Static Hosting Ready**: Pure HTML, CSS, and modular ES6 JavaScript (`src/`), requiring zero build step to run in a browser.
- **Ultra-Compact Protocol Buffer URL State**: All calculator state (`rateMode`, `rows`, `netInputTemps`, and `loops`) is serialized into a zero-string Protocol Buffer binary payload encoded as URL-safe Base64 (`?s=...`).

---

## 2. Dataset & Entities (`src/oni_data.js`, `data/`)
1. **Buildings / Machines** (`data/buildings.json`):
   - Power generators, oxygen producers, liquid/gas pumps, refineries, cooking stations, farming/ranching stations, utilities, and heat management (`Thermo Aquatuner`, `Thermo Regulator`, `Steam Turbine`, `Ice Maker`, `Metal Refinery`, etc.).
   - Inputs & Outputs: element/resource name, rate (`g/s`, `Kg/s`, `W`, `kDTU/s`, `s/s`), delivery state (`in a pipe`, `solid`, `free`, `labor`), output temperature rules (`min_temp`, `pass_through`, `fixed_temp`, `delta_temp`), and multi-recipe options.
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
   - Element states (`Gas`, `Liquid`, `Solid`), specific heat capacity (SHC in `DTU/(g·°C)`), default temperatures, and canonical icon URLs from `oxygennotincluded.wiki.gg`.
6. **Geysers / Vents / Volcanoes** (`data/geysers.json`):
   - Average eruption rates, fixed eruption temperatures, and `1x–5x Geotuned` modifiers with type-specific geotuning material inputs (Bleach Stone, Salt, Refined Phosphorus, Abyssalite).

---

## 3. Web Application & CLI Architecture

### 3.1 Table Structure & Controls
- **Pinned `Loop Start` Row (Top)**:
  - Shown whenever `state.loops` has one or more looped streams; hidden when nothing is looped.
  - Displays each looped stream in the **Outputs** column with its fixed rate, fixed temperature, and an `[unloop]` button.
- **Machine / Entity Rows (`0 .. N-1`)**:
  - **Column 1 (Machine)**: Drag handle (`⋮⋮`), `▲` / `▼` reorder buttons, quantity input, entity icon + wiki link + category pill, Mode/Recipe selector, Bathroom/Food selectors (for Duplicants), modifier pills, feed temperature override (when applicable), and row duplicate/remove buttons.
  - **Column 2 (Inputs)**: Negative resource and power consumption streams (`Power: -120 W`, `Water: -1 Kg/s (in a pipe)`), with `[match: X×]` links based on upstream available supply.
  - **Column 3 (Outputs)**: Building heat (`Heat: +1.25 kDTU/s`), positive resource and power production streams (`Oxygen: +888 g/s @ 70 °C (free)`), `[match: X×]` links based on downstream cumulative demand, and `[loop]` / `[unloop]` links.
- **Pinned `Loop End` Row (Bottom, before `NET`)**:
  - Shown whenever `state.loops` is non-empty; hidden when nothing is looped.
  - Displays each looped stream in the **Inputs** column with its negative rate, actual arriving temperature from the upstream pool, and an `[unloop]` button.
- **`NET` Summary Row**:
  - Displays cumulative **NET Inputs** (unmet deficits across the table and `Loop End`, with editable feed temperature inputs for thermal resources) and **NET Outputs** (unconsumed surpluses remaining after `Loop End`, plus net `Heat` and net `Power`).

### 3.2 Built-in Presets (`src/presets.js`)
All 8 presets are ordered top-to-bottom and use `loops` for closed-loop resources and self-powered generator loops:
1. `hydra_spom` — **Hydra SPOM** (loops `Power: 896 W`)
2. `coal_skimmer_loop` — **Coal Generator + Carbon Skimmer Loop** (loops `Water (in a pipe): 1000 g/s @ 20 °C`)
3. `stone_hatch_coal` — **Stone Hatch Ranch (8x) + Coal Power**
4. `arbor_ethanol_loop` — **Arbor Tree Ethanol Power Loop** (loops `Polluted Water (in a pipe): 3500 g/s @ 75 °C`)
5. `natural_gas_geyser_power` — **Natural Gas Geyser Power Plant** (loops `Power: 800 W`)
6. `oil_refinery_petroleum_loop` — **Oil Refinery + Petroleum Power Plant** (loops `Power: 5000 W`)
7. `glossy_drecko_plastic` — **Glossy Drecko Plastic via Bristle Berry** (loops `Power: 800 W`)
8. `drecko_reed_fiber_balm_lily` — **Drecko Ranch (Reed Fiber) via Balm Lily**

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
│   ├── oni_data.js                # Bundled ONI dataset module
│   ├── presets.js                 # 8 built-in presets with top-to-bottom ordering & loops
│   ├── state.proto                # Protocol Buffer schema (RowState, NetTemperature, LoopedStream)
│   ├── proto_catalog.js           # Deterministic enum mappings for entities, recipes, modifiers, elements
│   ├── url_state.js               # Zero-string Protocol Buffer URL state encoder/decoder
│   ├── text_renderer.js           # Plain-text ASCII table and JSON state renderer
│   └── components/
│       ├── table_row.js           # Machine row, Loop Start row, and Loop End row HTML rendering
│       ├── autocomplete.js        # Typeahead search dropdown with icons & keyboard navigation
│       └── net_summary.js         # NET summary row rendering & feed temperature controls
└── tests/
    ├── test_js_modules.js         # Unit & integration tests for calculator, loops, UI, and dataset
    ├── test_url_state_protobuf.js # Protocol Buffer schema, wire size, round-trip, and fuzzing tests
    ├── test_cli_snapshots.js      # End-to-end CLI snapshot test runner
    └── snapshots/*.txt            # Golden ASCII table snapshots for all 8 presets
```
