# ONI Thermal Energy, Specific Heat Capacity (SHC), & Sequential Loop Temperature Design

## 1. Fundamental Thermal Math in *Oxygen Not Included*
Every element in *Oxygen Not Included* has a **Specific Heat Capacity ($c$ or $\text{SHC}$)** measured in $\text{DTU}/(\text{g}\cdot\text{°C})$.

For any resource stream with mass flow rate $\dot{m}$ (in $\text{g/s}$), specific heat capacity $c$, and temperature $T$ (in $\text{°C}$):
- **Thermal Capacity Rate ($\dot{C}$)**:
  $$\dot{C} = \dot{m} \cdot c \quad [\text{DTU}/(\text{s}\cdot\text{°C})]$$
- **Thermal Power / Enthalpy Flow ($\dot{Q}$) relative to reference temperature $T_{\text{ref}}$**:
  $$\dot{Q}(T) = \frac{\dot{m} \cdot c \cdot (T - T_{\text{ref}})}{1000} \quad [\text{kDTU/s}]$$

---

## 2. ONI Building Output Temperature Rules
Machines in ONI determine the temperature $T_{\text{out}}$ of their output streams according to five distinct rules (verified against `oxygennotincluded.wiki.gg`):

1. **Clamped Minimum Temperature (`min_temp`, denoted `@ X °C+`)**:
   $$T_{\text{out}} = \max(T_{\text{in}}, T_{\text{min}})$$
   If the input resource is colder than $T_{\text{min}}$, the output is heated/clamped up to $T_{\text{min}}$. If the input is hotter than $T_{\text{min}}$, the output inherits the hotter input temperature $T_{\text{in}}$.
   - **Examples**:
     - `Electrolyzer`: Water in at $T_{\text{in}}$ $\to$ Oxygen ($888\text{ g/s}$, $c=1.005$) and Hydrogen ($112\text{ g/s}$, $c=2.400$) exit at $\max(T_{\text{in}}, 70\text{ °C})$.
     - `Rust Deoxidizer`: Outputs exit at $\max(T_{\text{in}}, 75\text{ °C})$.
     - `Ethanol Distiller`: Ethanol exits at $\max(T_{\text{in}}, 73.4\text{ °C})$; Polluted Dirt & CO2 exit at $\max(T_{\text{in}}, 93.4\text{ °C})$.
     - `Polymer Press`: Plastic exits at $\max(T_{\text{in}}, 75\text{ °C})$; CO2 at $\max(T_{\text{in}}, 150\text{ °C})$; Steam at $\max(T_{\text{in}}, 200\text{ °C})$.
     - `Oil Refinery`: Petroleum & Natural Gas exit at $\max(T_{\text{in}}, 75\text{ °C})$.
     - `Algae Terrarium` / `Oxygen Diffuser`: Oxygen exits at $\max(T_{\text{in}}, 30\text{ °C})$.
     - `Coal Generator` / `Petroleum Generator`: Exhaust gases/liquids exit at $\max(T_{\text{in}}, 110\text{ °C})$ / $\max(T_{\text{in}}, 40\text{ °C})$.

2. **Pass-Through Temperature (`pass_through`)**:
   $$T_{\text{out}} = T_{\text{in}}$$
   The output resource inherits the exact temperature of the primary input resource.
   - **Examples**:
     - `Liquid Pump`, `Gas Pump`, `Mini Liquid Pump`, `Mini Gas Pump`.
     - `Water Sieve` & `Desalinator`: Output clean Water exits at the exact input Polluted Water / Salt Water / Brine temperature.
     - `Carbon Skimmer`: Output Polluted Water inherits the incoming piped `Water` temperature (ignoring the `Carbon Dioxide` temperature).

3. **Fixed Output Temperature (`fixed_temp`, denoted `@ X °C`)**:
   $$T_{\text{out}} = T_{\text{fixed}}$$
   Regardless of input temperature, the output is produced at a fixed temperature.
   - **Examples**:
     - `Steam Turbine`: Takes Steam at $T_{\text{in}} \ge 125\text{ °C}$ and outputs Water at fixed $95\text{ °C}$.
     - `Metal Refinery`: Outputs Refined Metal at fixed $40\text{ °C}$ (while transferring the smelting heat into the piped liquid coolant).
     - `Geysers / Vents`: Erupt resources at their fixed eruption temperature (e.g., Water Geyser `@ 95 °C`, Cool Steam Vent `@ 110 °C`).

4. **Constant Temperature Shift (`delta_temp`, denoted `-14 °C`)**:
   $$T_{\text{out}} = T_{\text{in}} + \Delta T$$
   - **Examples**:
     - `Thermo Aquatuner` / `Thermo Regulator`: Lowers piped fluid temperature by $\Delta T = -14\text{ °C}$ and moves that exact thermal energy ($\dot{Q} = \dot{m} \cdot c \cdot 14 / 1000\text{ kDTU/s}$) onto the building body.

5. **Resource Consumption / Mass Deletion (`total_consumer`)**:
   - **Examples**:
     - `Hydrogen Generator`, `Natural Gas Generator`, `Duplicants`, `Plants`: Consume input mass without a corresponding thermal mass output.

---

## 3. Sequential Top-to-Bottom Temperature Resolution & Loop Thermal Tracking (`src/calculator.js`)

In `resolveTableTemperatures` and `calculateSystemNet`, stream temperatures propagate sequentially from the top of the table to the bottom in a single deterministic pass:

1. **`Loop Start` Seeding**:
   - Any thermal stream configured in `state.loops` enters the top of the table (`Loop Start`) at its locked-in rate $\dot{m}_{\text{loop}}$ and locked-in temperature $T_{\text{loop}}$.
   - This seeds the available upstream pool for `(resource, state)` with `availRate` $= \dot{m}_{\text{loop}}$ and `availTempC` $= T_{\text{loop}}$.

2. **Row Consumption & Blending (`rows[0 .. N-1]`)**:
   - When row $i$ consumes rate $\dot{m}_{\text{req}}$ of `(resource, state)`:
     - $\dot{m}_{\text{pool}} = \min(\dot{m}_{\text{req}}, \text{availRate})$ is drawn from the upstream pool at temperature $T_{\text{pool}} = \text{availTempC}$.
     - Any unmet shortfall $\dot{m}_{\text{ext}} = \max(0, \dot{m}_{\text{req}} - \text{availRate})$ is drawn from **NET Inputs** at the user-configurable NET feed temperature $T_{\text{net}}$.
     - The effective incoming temperature for that stream at row $i$ is the mass-weighted blend:
       $$T_{\text{in}} = \frac{\dot{m}_{\text{pool}} \cdot T_{\text{pool}} + \dot{m}_{\text{ext}} \cdot T_{\text{net}}}{\dot{m}_{\text{req}}}$$
   - Row $i$ is evaluated with these resolved input temperatures, and its thermal outputs $( \dot{m}_{\text{out}}, T_{\text{out}} )$ are blended into the available pool for downstream rows:
     $$\text{availTempC}' = \frac{\text{availRate} \cdot \text{availTempC} + \dot{m}_{\text{out}} \cdot T_{\text{out}}}{\text{availRate} + \dot{m}_{\text{out}}}$$

3. **`Loop End` Arriving Temperature**:
   - After the final machine row executes, `Loop End` consumes $\dot{m}_{\text{loop}}$ from the available pool.
   - `Loop End` displays the actual arriving temperature $T_{\text{arrive}}$ of the resource reaching the bottom of the table (e.g., `Water: -1 Kg/s @ 20 °C (in a pipe)` or `Polluted Water: -3.5 Kg/s @ 75 °C (in a pipe)`), allowing users to compare the `Loop End` arriving temperature against the `Loop Start` feed temperature without altering the building operational `Heat` (`kDTU/s`) total.
