# ONI Resource Calculator (`onimath`) — Web Application Design

## 1. System Overview & User Experience
The web application models an *Oxygen Not Included* resource network as a **sequential top-to-bottom flow table** with explicit feedback loops (`Loop Start` and `Loop End`). Users assemble an ordered pipeline of machines, plants, critters, duplicants, and geysers; configure each row's quantity, active recipe/diet/bathroom mode, and modifiers; optionally loop output streams back to the top at a locked rate and temperature; and immediately see both row-level inputs/outputs and the system-wide **NET** resource balance.

The application features **157 total entities** (comprising **54 buildings/machines**, plants, critters, duplicants, and geysers), **212 elements**, and **10 built-in presets**.

### 1.1 Visual Language (GitHub-Inspired Monochrome)
- **Color Palette**:
  - **Light Mode**: Crisp white canvas (`#ffffff`), subtle header/footer fills (`#f6f8fa`), 1px structural borders (`#d0d7de`), primary ink (`#1f2328`), muted metadata (`#59636e`).
  - **Dark Mode**: Deep slate-black canvas (`#0d1117`), elevated surface (`#161b22`), 1px borders (`#30363d`), primary text (`#e6edf3`), muted metadata (`#8b949e`).
  - **Theme Control**: Respects system `prefers-color-scheme` automatically with a header pill selector (`Auto | Light | Dark`).
- **Information Density**:
  - Compact table padding (`8px 12px`), `13px` UI text, and tabular monospace numerals (`font-variant-numeric: tabular-nums`) so numbers and units align cleanly.
  - Wiki icons (`18px × 18px` for inline resources, `28px × 28px` for entities) rendered alongside every machine, plant, critter, and element using verified `oxygennotincluded.wiki.gg/images/...` URLs.
- **Mobile Responsiveness**:
  - Below `768px`, table rows stack cleanly with labeled `Inputs` and `Outputs` columns side-by-side beneath the entity header so nothing is clipped on phones.

---

## 2. Sequential Top-to-Bottom Accounting & Loop Model (`src/calculator.js`)

### 2.1 Row Evaluation (`evaluateRow`)
For each row $i$ with quantity $q_i \ge 0$, entity definition $E_i$, selected recipe $R_i$ (optional), and active modifier IDs $M_i$:
1. **Base Rates**:
   - Start with recipe $R_i$'s `inputs`, `outputs`, `power` (Watts), and `heat` (kDTU/s) if a recipe is selected; otherwise use $E_i$'s default `inputs`, `outputs`, `power`, and `heat`.
2. **Modifier Application**:
   - Each active modifier $m \in M_i$ can apply:
     - `input_multiplier` (global multiplier to all resource inputs, e.g. `Wild` = `0.0` for plants or `0.25` for critters).
     - `output_multiplier` (global multiplier to all resource outputs, e.g. `Farmer's Touch` = `2.0`).
     - `input_multipliers[resource]` / `output_multipliers[resource]` (resource-specific multipliers, e.g. `Diver's Lungs` = `0.75` for `Oxygen`).
     - `power_multiplier` (e.g. `Engie's Tune-Up` = `1.5` for generator power output).
     - `extra_inputs` / `extra_outputs` (additive streams such as Duplicant bathroom modes, diets, `Bottomless Stomach`, `Flatulent`, or Geotuner geyser inputs).
3. **Quantity Scaling**:
   - Multiply every resulting input rate, output rate, power, and heat by $q_i$.
   - Negative power (`power < 0`) is listed under **Inputs** as `Power: -X W`.
   - Positive power (`power > 0`) is listed under **Outputs** as `Power: +X W`.
   - Non-zero heat is listed under **Outputs** as `Heat: +X kDTU/s` (or negative cooling).

### 2.2 Top-to-Bottom Resource Flow & Feedback Loops (`Loop Start` / `Loop End`)
Resources—including materials, `Power`, and `Duplicant Labor`—flow strictly **from the top of the table to the bottom**:
1. **`Loop Start` (Top of Table)**:
   - When `state.loops` is non-empty, `Loop Start` is rendered as a pinned row at the very top of the table (above the first machine row).
   - It injects each looped stream `(resource, state, rate, tempC)` into the available upstream pool before Row 0 executes.
2. **Sequential Row Execution (`rows[0 .. N-1]`)**:
   - Each row $i$ can only consume resources (`(resource, state)` or `Power`) that are currently available in the upstream pool produced by `Loop Start` and rows $0 \dots i-1$.
   - Any input demand on row $i$ that exceeds the currently available upstream pool is drawn from external **NET Inputs** at its configured NET feed temperature (`netInputTemps`).
   - Row $i$'s outputs are then blended into the available pool (using mass-weighted average temperature for thermal streams) for downstream rows $i+1 \dots N-1$.
   - Users can reorder machine rows via drag-and-drop (`⋮⋮`) or the `▲` / `▼` buttons; no machine row can be placed before `Loop Start` or after `Loop End`.
3. **`Loop End` (Bottom of Table, before `NET`)**:
   - Consumes the looped rates from the available pool after the last machine row.
   - Displays the actual arriving temperature on thermal streams (e.g., `Water: -1 Kg/s @ 20 °C (in a pipe)`).
   - If the available pool at the bottom of the table is insufficient to satisfy a `Loop End` stream, the shortfall is added to **NET Inputs**.
   - Both `Loop Start` and `Loop End` are hidden when `state.loops` is empty.
4. **`[loop]` and `[unloop]` Stream Actions**:
   - Every output stream (including `Power`) on a machine row renders a `[loop]` link (or `[unloop]` if that `(resource, state)` is already looped).
   - Clicking `[loop]` locks in that output stream's current rate and temperature into `state.loops`. Clicking `[unloop]` (on the machine output, `Loop Start`, or `Loop End`) removes it from `state.loops`.
5. **Upstream / Downstream `[match: X×]` Buttons (`calculateRowMatchTargets`)**:
   - For a row's **inputs**, `[match: X×]` computes the target machine quantity required to consume the currently available **upstream** pool (including `Loop Start`).
   - For a row's **outputs**, `[match: X×]` computes the target machine quantity required to satisfy the cumulative **downstream** deficit (including `Loop End`).

### 2.3 Meta-Machines Simulation (`absorb_heat` & `counterflow_heat_exchanger`)
To support complex thermal networks (such as industrial saunas and counterflow boilers), the calculator provides two specialized virtual meta-machines:
1. **Absorb Heat (`absorb_heat`)**:
   - **Dynamic Phase Label**: The entity label dynamically displays `"Absorb heat into liquid"`, `"Absorb heat into gas"`, or `"Absorb heat into solid"` matching the thermodynamic phase (`Liquid`, `Gas`, or `Solid`) of the selected material.
   - **UI Selectors**: Allows selecting the primary material (`material`) and delivery state (`material_state`: `free`, `in a pipe`, `solid`).
   - **Heat Absorption**: Transfers $10\text{ kDTU/s}$ of thermal energy per $1\times$ quantity from system ambient heat into the stream ($\text{Heat} = -10\text{ kDTU/s}$).
   - **Upstream Pool Flow-Rate Matching**: In `resolveTableTemperatures`, the meta-machine automatically inspects the upstream pool for the specified `(material, material_state)`. If available, it automatically consumes the full upstream flow rate at its current incoming temperature, avoiding manual rate configuration. If no upstream pool exists, it draws from external NET inputs at the configured NET feed temperature.
2. **Counterflow Heat Exchanger (`counterflow_heat_exchanger`)**:
   - **Label**: `"Counterflow heat exchanger"`.
   - **UI Selectors**: Dual stream selectors for the hot stream (`material`, `material_state`) and the cold stream (`cold_material`, `cold_material_state`).
   - **Heat Exchange**: Transfers $10\text{ kDTU/s}$ per $1\times$ quantity directly from the hot stream to the cold stream with zero net building heat dissipation ($\text{Heat} = 0\text{ kDTU/s}$) and zero power consumption ($\text{Power} = 0\text{ W}$).
   - **Thermodynamic Clamping**: Stream outlet temperatures are clamped by the Second Law of Thermodynamics for counterflow heat exchangers ($T_{\text{cold, out}} \le T_{\text{hot, in}}$ and $T_{\text{hot, out}} \ge T_{\text{cold, in}}$), preventing temperature crossover pinch violations.
   - **Upstream Pool Flow-Rate Matching**: Automatically adopts flow rates and arriving temperatures for both the hot and cold streams directly from their respective upstream pools.

### 2.4 NET Row Aggregation (Hydra SPOM Example)
In the **Hydra SPOM** preset (`hydra_spom`), `Power: +896 W` from the `1.12× Hydrogen Generator` is looped via `Loop Start` / `Loop End` so upstream pumps and the electrolyzer receive power from the top of the table:
1. **`Loop Start`**: Outputs `Power: +896 W`.
2. **`0.1× Liquid Pump`** (mode `water`): Consumes `Power: -24 W` and `Water: -1 Kg/s (free)`; outputs `Water: +1 Kg/s @ 20 °C (in a pipe)` and `Heat: +0.2 kDTU/s`.
3. **`1× Electrolyzer`**: Consumes `Power: -120 W` and `Water: -1 Kg/s (in a pipe)`; outputs `Oxygen: +888 g/s @ 70 °C (free)`, `Hydrogen: +112 g/s @ 70 °C (free)`, and `Heat: +1.25 kDTU/s`.
4. **`0.224× Gas Pump`** (mode `hydrogen`): Consumes `Power: -53.76 W` and `Hydrogen: -112 g/s (free)`; outputs `Hydrogen: +112 g/s @ 70 °C (in a pipe)` and `Heat: +0.448 kDTU/s`.
5. **`1.12× Hydrogen Generator`**: Consumes `Hydrogen: -112 g/s (in a pipe)`; outputs `Power: +896 W` and `Heat: +4.48 kDTU/s`.
6. **`8× Duplicant`** (Plumbed, Fasting): Consumes `Oxygen: -800 g/s (free)` and `Water: -66.6664 g/s (in a pipe)`; outputs `Duplicant Labor: +6 s/s (labor)`, `Carbon Dioxide: +16 g/s @ 37 °C (free)`, and `Polluted Water: +156 g/s @ 37 °C (in a pipe)`.
7. **`Loop End`**: Consumes `Power: -896 W` from the pool (leaving `896 - 24 - 120 - 53.76 = +698.24 W` net power surplus).

---

## 3. Protocol Buffer URL State Format (`src/state.proto`, `src/proto_catalog.js`, `src/url_state.js`)
Calculator state is serialized into a compact URL-safe Base64 Protocol Buffer payload (`?s=...`) with **zero string fields on the wire**:
- `CalculatorState`:
  - `RateMode rate_mode = 1` (`PER_SECOND = 0`, `PER_CYCLE = 1`)
  - `repeated RowState rows = 2`:
    - `Entity entity = 1` (**157 `Entity` enum values**)
    - `oneof count { uint32 count_int = 2; double count_double = 3; }`
    - `Recipe recipe = 4`
    - `Bathroom bathroom = 5`
    - `repeated Modifier modifiers = 6`
    - `optional double input_temp = 7`
    - `Food food = 8`
    - `Element material = 9` (Meta-machine primary material enum)
    - `StreamState material_state = 10` (Meta-machine primary stream state enum: `STREAM_STATE_FREE`, `STREAM_STATE_IN_A_PIPE`, `STREAM_STATE_SOLID`, `STREAM_STATE_LABOR`)
    - `Element cold_material = 11` (Meta-machine counterflow cold stream material enum)
    - `StreamState cold_material_state = 12` (Meta-machine counterflow cold stream state enum)
  - `repeated NetTemperature net_temperatures = 3` (`element`, `state`, `temperature`)
  - `repeated LoopedStream loops = 4`:
    - `Element element = 1`
    - `StreamState state = 2`
    - `oneof flow_rate { uint32 rate_int = 3; double rate_double = 5; }`
    - `oneof temp { sint32 temp_int = 4; double temp_double = 6; }`
- Even complex multi-machine closed-loop presets serialize into `< 100 bytes` on the wire.

---

## 4. Presets & Component Breakdown

### 4.1 Built-in Presets (`src/presets.js`)
The application includes **10 built-in presets**:
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

### 4.2 Component Breakdown
1. `index.html`: Semantic, accessible single-page layout with toolbar (Preset selector, Per-second / Per-cycle toggle, Interactive Table / Plain Text view toggle, Copy Share Link button, Theme switcher), main calculator table, and quick reference footer.
2. `styles/main.css`: GitHub-inspired monochrome CSS variables for light & dark themes, responsive grid/table rules, `.loop-row` styling for `Loop Start` and `Loop End`, `.btn-loop-stream` / `.btn-unloop-stream` controls, and autocomplete popover styles.
3. `src/calculator.js`: Pure calculation and formatting engine (row evaluation, meta-machines simulation, dynamic steam turbine scaling, phase-change transitions across 212 elements, counterflow heat exchanger clamping, sequential top-to-bottom thermal resolution, upstream/downstream match target calculation, and sequential NET balance with `Loop Start` / `Loop End`).
4. `src/state.proto`, `src/proto_catalog.js`, `src/url_state.js`: Zero-string Protocol Buffer schema, enum catalog, and URL-safe Base64 encoder/decoder.
5. `src/presets.js`: 10 curated presets ordered top-to-bottom with pre-configured `loops`.
6. `src/text_renderer.js` & `bin/calc.js`: Plain-text ASCII table and JSON renderer for both the web app's Plain Text view and the CLI tool (`node bin/calc.js`).
7. `src/app.js` & `src/components/`: Interactive table rendering (`table_row.js`, `net_summary.js`, `autocomplete.js`), row reordering, `[loop]` / `[unloop]` handlers, and instant URL state synchronization.
