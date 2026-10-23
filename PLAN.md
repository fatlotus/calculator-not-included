# ONI Resource Calculator (`onimath`) — Project Plan & Architecture

## 1. Project Overview & Goals
Build an information-dense, fast, responsive static web application (HTML + CSS + Vanilla JS ES Modules) that acts as an accounting-style resource calculator for *Oxygen Not Included* (ONI). Users add machines, plants, critters, geysers, and duplicants to a table, adjust quantities, recipes, and modifiers, and view individual row inputs/outputs alongside a real-time **NET** resource balance summary.

Key constraints & principles:
- **Authoritative Data Only**: Sourced strictly from `oxygennotincluded.wiki.gg` (MediaWiki API / Cargo tables / wikitext templates). Do **not** use the outdated Fandom wiki.
- **Static Hosting Ready**: Pure HTML, CSS, and modular ES6 JavaScript (`src/`), requiring zero build step to run in a browser, while keeping files small, clean, and well-tested.
- **Compact URL State Sharing**: All calculator state (selected rows, quantities, active recipes/configurations, modifiers, rate unit preferences) is serialized into a compact URL parameter (`?s=...`) so designs can be bookmarked and shared via link.
- **Resource & Memory Efficiency**: Designed to run and test smoothly on a resource-constrained VM (~964 MB RAM, ~790 MB free disk), using Python's `unittest` and lightweight Node/Python test harnesses without launching heavy browser processes that could cause OOM.

---

## 2. Phase 1: Wiki Research & Scraper (`scraper/`)
Deputize `flash` subagents to research the `oxygennotincluded.wiki.gg` API structure, templates, Cargo tables, and icon URL patterns, then build a Python 3 scraper using standard library modules (`urllib.request`, `json`, `re`, `html.parser`, `sqlite3`/` pathlib`) to populate local structured data files in `data/`.

### 2.1 Entities to Scrape & Collect
1. **Buildings / Machines** (`data/buildings.json`):
   - Power generators, oxygen producers, water/liquid/gas pumps, refineries, farming/ranching stations, utilities, heat management (Aquatuner, Thermo Regulator, Steam Turbine, Ice Maker, etc.).
   - Inputs & Outputs: element/resource ID, rate (`g/s`, `kg/s`, `W`, `kDTU/s`), delivery state (`in a pipe`, `in a conveyor`, `free`, `bottled`), minimum/fixed output temperatures (`@ 70 °C+`, etc.), and multi-recipe options (e.g., Rock Crusher, Kiln, Metal Refinery, Polymer Press, Ethanol Distiller, Desalinator).
2. **Duplicants** (`data/duplicants.json`):
   - Base consumption/production rates (Oxygen `-100 g/s`, Carbon Dioxide `+2 g/s`, Calories `-1000 kcal/cycle`, Lavatory/Outhouse usage, Polluted Water/Dirt output).
   - Modifiers/Traits (checkboxes & selectors):
     - Oxygen traits: *Diver's Lungs* (`-25%` O2), *Deep Diver's Lungs* (`-50%` O2), *Mouth Breather* (`+100%` O2), *Bottomless Stomach* (`+500 kcal/cycle`).
     - Bionic Duplicant variants (Gear Balm / Lubricating Oil, Oxygen tank consumption, Bionic wattage/power bank consumption, Gunk output).
     - Bathroom modes: Lavatory (`-5 kg/use` Water -> `+11.7 kg/use` Polluted Water), Outhouse (`-13 kg/use` Dirt -> `+19.7 kg/use` Polluted Dirt), or None.
3. **Critters / Animals** (`data/critters.json`):
   - Hatch (Regular, Sage, Stone, Smooth), Drecko (Regular, Glossy), Pacu (Regular, Tropical, Gulp), Puft (Regular, Prince, Dense, Squeaky), Shine Bug, Pip (Regular, Cuddle), Poke Shell (Regular, Oakshell, Sanishell), Slickster (Regular, Molten, Longhair), Shove Vole, Grubgrub, Sweetle, Plug Slug, Divergent, Flox, Bammoth, Moo, Morb, etc.
   - Diet options (multiple food choices per critter with conversion ratios and mass rates per cycle/second), excretions, egg production rates, meat/resource yield per lifecycle, and modifiers:
     - *Tame vs. Wild* (`100%` vs. `25%` metabolism)
     - *Happy / Fed vs. Glum / Starving* (`-80%` metabolism when glum)
     - *Lullabied / Incubator* modifiers where relevant
4. **Plants / Crops** (`data/plants.json`):
   - Mealwood, Bristle Blossom, Dusk Cap, Thimble Reed, Pincha Pepperplant, Sleet Wheat, Nosh Bean, Waterweed, Balm Lily, Oxyfern, Arbor Tree, Saltvine, Dasha Saltvine, Bog Bucket, Grubfruit, Wheezewort, Bonbon Tree, Pikeapple, Plume Squash, etc.
   - Irrigation (liquid in pipe), fertilization (solid delivery), atmosphere consumption (e.g., Oxyfern CO2 -> O2, Saltvine Chlorine -> Salt), harvest yield (kcal or kg per harvest cycle), and modifiers:
     - *Domesticated vs. Wild* (`100%` vs. `25%` growth rate, `0` fertilizer/irrigation when wild!)
     - *Farmer's Touch / Micronutrient Fertilizer* (`+100%` growth speed; fertilizer consumption happens only during base growth or doubles yield per time)
     - *Grubgrub Rub* (`+50%` growth speed)
     - *Plant Mutations* (Spindly, Juicyfruits, Superspecialized, etc. optional modifier presets)
5. **Elements & Icons** (`data/elements.json`, `data/icons.json`):
   - Element states (Gas, Liquid, Solid), specific heat capacity (SHC in `DTU/(g·°C)`), thermal conductivity, molar mass, phase transition temperatures, and canonical icon URLs from `oxygennotincluded.wiki.gg`.
6. **Geysers / Vents / Volcanoes (Bonus / Source inputs)** (`data/geysers.json`):
   - Average output rates (Cool Steam Vent, Water Geyser, Natural Gas Geyser, Minor/Regular Volcano, etc.) to allow users to model source inputs directly.

---

## 3. Phase 2: Web Application Architecture & Design

### 3.1 Visual & UX Design (GitHub-inspired, Monochrome, High Density)
- **Aesthetic**: Information-dense, crisp typography (system sans-serif + monospace for numbers/rates), 1px borders, subtle row hover states, high-contrast black/white/grey palette.
- **System Light/Dark Mode**: Automatic `prefers-color-scheme: dark` support plus a manual theme toggle (`Auto / Light / Dark`).
- **Mobile Friendly**: Responsive table layout that gracefully adapts on narrow viewports (compact stacked cards or sticky horizontal scroll with clear input/output columns).
- **Table Structure**:
  - **Column 1: Entity (`Machine / Plant / Critter / Duplicant`)**:
    - Quantity input (`number`, supports decimals like `0.5` or `1.5` and integers like `8x`).
    - Entity Icon (from `oxygennotincluded.wiki.gg`) + Name + Category badge.
    - Recipe / Diet selector dropdown (when an entity has multiple modes/diets, e.g., Hatch eating Sedimentary Rock vs. Sandstone, or Electrolyzer vs. Rust Deoxidizer).
    - Inline modifier checkboxes/pills (e.g., `[x] Diver's Lungs`, `[x] Wild`, `[x] Farmer's Touch`, `[x] Glum`, or `[x] Continuous / Duty Cycle %`).
    - Row actions: Duplicate row, Remove row (`×`).
  - **Column 2: Inputs**:
    - Each resource input listed on its own compact line with icon, name, negative rate, and delivery state annotation:
      - `Power: -120 W`
      - `Water: -1000 g/s (in a pipe)`
  - **Column 3: Outputs**:
    - Each resource output listed with icon, name, positive rate, temperature note, and delivery state annotation:
      - `Heat: +1.25 kDTU/s`
      - `Oxygen: +888 g/s @ 70 °C+ (free)`
      - `Hydrogen: +112 g/s @ 70 °C+ (free)`
  - **Add Row Control**:
    - Interactive `(click here to add a new one)` row that opens an instant keyboard-navigable typeahead autocomplete search box with entity icons, category filters (`All`, `Machines`, `Plants`, `Critters`, `Duplicants`, `Geysers`), and fuzzy/substring matching (by entity name or by input/output resource name!).
  - **NET Summary Row**:
    - Aggregates all inputs and outputs across active rows.
    - Smart Cancellation Options:
      - Complete Physical Model (Hydra SPOM example):
        - `1x Water Pump` (recipe `water`): consumes `Water: -1000 g/s (free)` and outputs `Water: +1000 g/s (in a pipe)` at `Power: -120 W`.
        - `1x Electrolyzer`: consumes `Water: -1000 g/s (in a pipe)` and outputs `Oxygen: +888 g/s @ 70 °C+ (free)` and `Hydrogen: +112 g/s @ 70 °C+ (free)` at `Power: -120 W`, `Heat: +1.25 kDTU/s`.
        - `1x Gas Pump` (recipe `hydrogen_100`): consumes `Hydrogen: -100 g/s (free)` and outputs `Hydrogen: +100 g/s (in a pipe)` at `Power: -240 W` (or 20% duty-cycle option).
        - `1x Hydrogen Generator`: consumes `Hydrogen: -100 g/s (in a pipe)` and outputs `Power: +800 W`, `Heat: +4 kDTU/s`.
        - `8x Duplicant`: consumes `Oxygen: -800 g/s (free)`.
      - **Resulting NET Row**:
        - Piped water cancels (`+1000 - 1000 = 0`), leaving `Water: -1000 g/s (free)` in NET Inputs.
        - Piped hydrogen cancels (`+100 - 100 = 0`), and free hydrogen nets (`+112 - 100 = +12 g/s @ 70 °C+ (free)`) in NET Outputs.
        - Free oxygen nets (`+888 - 800 = +88 g/s @ 70 °C+ (free)`) in NET Outputs.
        - Power nets to `+320 W` (`+800 - 120 - 120 - 240`) (or `+512 W` with 20% duty cycle).
        - Heat nets to `+5.25 kDTU/s` (`+1.25 + 4.0`).
      - Because both Water and Hydrogen have dedicated state-transfer pump rows, strict `(resource, state)` matching produces the exact balance naturally, and both `Strict pipe state matching: ON` and `OFF` yield the identical correct output!

### 3.2 Rate Units & Presets
- **Global Rate Toggle**:
  - `Per Second (/s)` vs. `Per Cycle (/cycle, 600s)` (or `Auto / Game Default` where gasses/liquids are `g/s` or `kg/s` and calories/fertilizer can be viewed in `/s` or `/cycle`).
- **Built-in Example Presets**:
  - **Hydra SPOM**: 1x Electrolyzer, 1x Hydrogen Generator, 1x Water Pump, 1x Gas Pump, 8x Duplicant.
  - **Coal Power Plant + Carbon Skimmer Loop**
  - **Hatch Ranch & Barbecue Sustainability Loop**
  - **Petroleum Boiler / Industrial Brick**

### 3.3 Compact URL State Serialization (`src/url_state.js`)
- State structure:
  - Compact dictionary/array encoded into a URI-safe base64url string (with optional Deflate/LZ compression or ultra-short schema keys like `eId:qty:recipeIdx:modMask`) under `?s=...`.
  - Example readable compact format: `?s=v1.elec:1~hgen:1~lpump:1.water~dupe:8.m1` (human-readable, tiny, URL-safe, with fallback to base64url when complex).
  - Real-time `history.replaceState` on edits + "Copy Share Link" button with visual feedback.

---

## 4. Phase 3: Modular Code Structure & Testing

### 4.1 Directory Layout
```text
/home/khakimaroon/onimath/
├── PLAN.md                  # This plan and architectural blueprint
├── DESIGN.md                # Detailed data schema, UI specification, and math model
├── index.html               # Main static entry point
├── styles/
│   └── main.css             # Responsive GitHub-inspired light/dark styles
├── data/
│   ├── buildings.json       # Scraped ONI wiki.gg buildings data
│   ├── critters.json        # Scraped ONI wiki.gg critters & diets
│   ├── plants.json          # Scraped ONI wiki.gg plants & growth data
│   ├── duplicants.json      # Duplicant base rates & trait modifiers
│   ├── elements.json        # Elements, states, SHC, and icons
│   └── geysers.json         # Geyser/vent average output data
├── src/
│   ├── app.js               # Main UI controller & DOM event binding
│   ├── calculator.js        # Pure accounting engine (row math, modifiers, NET aggregation)
│   ├── data_loader.js       # Data normalization & search/autocomplete index
│   ├── url_state.js         # Compact URL parameter encoder/decoder
│   ├── presets.js           # Built-in system presets (including Hydra SPOM)
│   └── components/
│       ├── table_row.js     # Row rendering (inputs, outputs, modifiers, quantity)
│       ├── autocomplete.js  # Typeahead search dropdown with icons & keyboard nav
│       └── net_summary.js   # NET row rendering & balance diagnostics
├── scraper/
│   ├── wiki_client.py       # MediaWiki / Cargo API client for oxygennotincluded.wiki.gg
│   ├── parse_buildings.py   # Extracts building inputs, outputs, power, heat, icons
│   ├── parse_critters.py    # Extracts critter diets, excretions, modifiers, icons
│   ├── parse_plants.py      # Extracts plant irrigation, fertilization, yields, icons
│   ├── parse_elements.py    # Extracts elements, SHC, phases, icons
│   └── build_dataset.py     # Orchestrates scraping, validation, and JSON export
└── tests/
    ├── test_scraper.py      # Unit tests for wiki parsers & data integrity
    ├── test_calculator.py   # Comprehensive tests for row math, modifiers & NET balance
    └── test_url_state.py    # Tests for compact URL serialization & round-tripping
```

### 4.2 Subagent Delegation Strategy (Using `flash`)
1. **Subagent 1 (`flash` - Wiki API & Buildings Researcher)**:
   - Inspect `https://oxygennotincluded.wiki.gg/api.php` (Cargo tables, templates, categories for Buildings, Generators, Oxygen, Refinement, Plumbing, HVAC).
   - Determine exact Cargo query parameters or page parse endpoints to retrieve all building inputs, outputs, wattages, heat (kDTU/s), temperatures, pipe states, and icon URLs.
2. **Subagent 2 (`flash` - Critters, Plants & Duplicants Researcher)**:
   - Inspect `https://oxygennotincluded.wiki.gg/api.php` for Critters, Plants, Duplicant traits/modifiers, and Geysers.
   - Document exact Cargo tables/fields or infobox structures and verify per-cycle (600s) vs. per-second numbers and modifier percentages.
3. **Subagent 3 (`flash` - Elements & Icons Researcher)**:
   - Query `oxygennotincluded.wiki.gg` for Element tables, resource icons (`File:*.png` imageinfo URLs), and verify hotlinking/caching rules so icons load reliably in the static web app.
4. **Subagent 4 (`flash` - Code & Math Self-Review)**:
   - Audit the scraped dataset, calculator math, URL serialization, and UI rendering against every requirement in the prompt PDF.
$]
