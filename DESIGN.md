# ONI Resource Calculator (`onimath`) — Web Application Design

## 1. System Overview & User Experience
The web application models an *Oxygen Not Included* resource network like a double-entry accounting ledger. Users assemble a list of machines, plants, critters, duplicants, and geysers; configure each row's quantity, active recipe/diet, and modifiers; and immediately see both row-level inputs/outputs and the system-wide **NET** resource balance.

### 1.1 Visual Language (GitHub-Inspired Monochrome)
- **Color Palette**:
  - **Light Mode**: Crisp white canvas (`#ffffff`), subtle header/footer fills (`#f6f8fa`), 1px structural borders (`#d0d7de`), primary ink (`#1f2328`), muted metadata (`#59636e`).
  - **Dark Mode**: Deep slate-black canvas (`#0d1117`), elevated surface (`#161b22`), 1px borders (`#30363d`), primary text (`#e6edf3`), muted metadata (`#8b949e`).
  - **Theme Control**: Respects system `prefers-color-scheme` automatically with a header pill selector (`Auto | Light | Dark`).
- **Information Density**:
  - Compact table padding (`8px 12px`), `13px` UI text, and tabular monospace numerals (`font-variant-numeric: tabular-nums`) so numbers and units align cleanly.
  - Wiki icons (`18px × 18px` for inline resources, `28px × 28px` for entities) rendered alongside every machine, plant, critter, and element using the verified `oxygennotincluded.wiki.gg/images/...?<hash>` URLs.
- **Mobile Responsiveness**:
  - Below `768px`, table rows stack cleanly with labeled `Inputs` and `Outputs` columns side-by-side beneath the entity header so nothing is clipped on phones.

---

## 2. Accounting & Calculation Model (`src/calculator.js`)

### 2.1 Row Evaluation
For each row $i$ with quantity $q_i \ge 0$, entity definition $E_i$, selected recipe $R_i$ (optional), and active modifier IDs $M_i$:
1. **Base Rates**:
   - Start with recipe $R_i$'s `inputs`, `outputs`, `power` (Watts), and `heat` (kDTU/s) if a recipe is selected; otherwise use $E_i$'s default `inputs`, `outputs`, `power`, and `heat`.
2. **Modifier Application**:
   - Each active modifier $m \in M_i$ can apply:
     - `input_multiplier` (global multiplier to all resource inputs, e.g. `Wild` = `0.0` for plants or `0.25` for critters).
     - `output_multiplier` (global multiplier to all resource outputs, e.g. `Farmer's Touch` = `2.0`).
     - `input_multipliers[resource]` / `output_multipliers[resource]` (resource-specific multipliers, e.g. `Diver's Lungs` = `0.75` for `Oxygen`).
     - `power_multiplier` (e.g. `Engie's Tune-Up` = `1.5` for generator power output).
     - `extra_inputs` / `extra_outputs` (additive streams such as Duplicant `Lavatory Use`, `Include Food`, `Include Exhaled CO2`, `Bottomless Stomach`, `Flatulent`).
3. **Quantity Scaling**:
   - Multiply every resulting input rate, output rate, power, and heat by $q_i$.
   - Negative power (`power < 0`) is listed under **Inputs** as `Power: -X W`.
   - Positive power (`power > 0`) is listed under **Outputs** as `Power: +X W`.
   - Non-zero heat is listed under **Outputs** as `Heat: +X kDTU/s` (or negative cooling).

### 2.2 NET Row Aggregation & State Cancellation
The Hydra SPOM example models the complete physical loop:
1. `1x Water Pump` (recipe `water`) consumes `Water: -1000 g/s (free)` and outputs `Water: +1000 g/s (in a pipe)` at `Power: -120 W`.
2. `1x Electrolyzer` consumes `Water: -1000 g/s (in a pipe)` and outputs `Oxygen: +888 g/s @ 70 °C+ (free)` and `Hydrogen: +112 g/s @ 70 °C+ (free)` at `Power: -120 W`, `Heat: +1.25 kDTU/s`.
3. `1x Gas Pump` (recipe `hydrogen_100`) consumes `Hydrogen: -100 g/s (free)` and outputs `Hydrogen: +100 g/s (in a pipe)` at `Power: -240 W`, `Heat: 0.0`.
4. `1x Hydrogen Generator` consumes `Hydrogen: -100 g/s (in a pipe)` and outputs `Power: +800 W`, `Heat: +4.0 kDTU/s`.
5. `8x Duplicant` consumes `Oxygen: -800 g/s (free)`.

**Unified Cancellation Math**:
- **Piped Water**: `+1000 g/s` from Water Pump cancels with `-1000 g/s` into Electrolyzer (`+1000 - 1000 = 0`).
- **Free Water**: `-1000 g/s` from Water Pump remains in **NET Inputs** as `Water: -1000 g/s (free)`.
- **Piped Hydrogen**: `+100 g/s` from Gas Pump cancels with `-100 g/s` into Hydrogen Generator (`+100 - 100 = 0`).
- **Free Hydrogen**: `+112 g/s @ 70 °C+` from Electrolyzer nets with `-100 g/s` into Gas Pump to yield `Hydrogen: +12 g/s @ 70 °C+ (free)` in **NET Outputs**.
- **Free Oxygen**: `+888 g/s @ 70 °C+` from Electrolyzer nets with `-800 g/s` consumed by Duplicants to yield `Oxygen: +88 g/s @ 70 °C+ (free)` in **NET Outputs**.
- **Power**: `+800 W` (Generator) `- 120 W` (Electrolyzer) `- 120 W` (Water Pump) `- 240 W` (Gas Pump) = `+320 W` (or `+512 W` if 20% duty-cycle option is chosen).
- **Heat**: `+1.25 kDTU/s` + `+4.0 kDTU/s` = `+5.25 kDTU/s`.

Because both Water and Hydrogen have dedicated state-transfer pump rows, strict `(resource, state)` matching produces the exact balance naturally, and both `Strict pipe state matching: ON` and `OFF` yield the identical correct output! For systems where a player omits a pump, smart cross-state netting can still combine unpumped streams when strict matching is turned off.

---

## 3. Compact URL State Format (`src/url_state.js`)
To make sharing designs effortless via URL (`?s=...`):
- State object:
  - `u`: Rate display unit (`"s"` for per-second `/s`, `"c"` for per-cycle `/cycle` = `600s`).
  - `p`: Pipe matching mode (`0` = smart auto-netting default, `1` = strict pipe state matching).
  - `r`: Array of rows, each encoded compactly as:
    `entityId` + `*qty` (if `qty != 1`) + `:recipeId` (if non-default) + `+mod1,mod2` (if modifiers active).
- Rows are joined by `~`.
- Example URL for the Hydra SPOM with Diver's Lungs on 8 Duplicants:
  `?s=u:s_r:electrolyzer~hydrogen_generator~water_pump:water~gas_pump:hydrogen_100~duplicant*8+divers_lungs`
- Also supports Base64URL-encoded JSON fallback (`b64:...`) so arbitrary future state extensions never break backward compatibility.

---

## 4. Component Breakdown
1. `index.html`: Semantic, accessible single-page layout with toolbar (Preset selector, Per-second / Per-cycle toggle, Strict pipe toggle, Copy Share Link button, Theme switcher), main calculator table, and quick reference footer.
2. `styles/main.css`: GitHub-inspired monochrome CSS variables for light & dark themes, responsive grid/table rules, autocomplete popover styles, and badge/modifier pill styles.
3. `src/calculator.js`: Pure, dependency-free calculation and formatting functions (unit conversion between `/s` and `/cycle`, row math, two-stage NET aggregation).
4. `src/url_state.js`: Compact URL encoder/decoder and browser `history.replaceState` synchronization.
5. `src/presets.js`: Curated presets including **Hydra SPOM (PDF Example)**, **Coal + Carbon Skimmer Loop**, **Stone Hatch Ranch + Coal Power**, and **Rodriguez SPOM**.
6. `src/app.js`: Interactive table rendering, typeahead autocomplete search with entity & element icons, keyboard navigation (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`), and instant state updates.
