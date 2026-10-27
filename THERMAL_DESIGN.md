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
Machines in ONI determine the temperature $T_{\text{out}}$ of their output streams according to six distinct rules (verified against `oxygennotincluded.wiki.gg`):

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
     - `Metal Refinery`: Outputs Refined Metal at fixed $40\text{ °C}$ (while transferring the smelting heat into the piped liquid coolant).
     - `Geysers / Vents`: Erupt resources at their fixed eruption temperature (e.g., Water Geyser `@ 95 °C`, Cool Steam Vent `@ 110 °C`).

4. **Constant Temperature Shift (`delta_temp`, denoted `-14 °C`)**:
   $$T_{\text{out}} = T_{\text{in}} + \Delta T$$
   - **Examples**:
     - `Thermo Aquatuner` / `Thermo Regulator`: Lowers piped fluid temperature by $\Delta T = -14\text{ °C}$ and moves that exact thermal energy ($\dot{Q} = \dot{m} \cdot c \cdot 14 / 1000\text{ kDTU/s}$) onto the building body.

5. **Resource Consumption / Mass Deletion (`total_consumer`)**:
   - **Examples**:
     - `Hydrogen Generator`, `Natural Gas Generator`, `Duplicants`, `Plants`: Consume input mass without a corresponding thermal mass output.

6. **Dynamic Steam Turbine Physics**:
   - See [Section 5: Dynamic Steam Turbine Simulation](#5-dynamic-steam-turbine-simulation).

---

## 3. Element Phase Change Transitions (`applyHeatAndPhaseChange`)

The simulation engine models thermodynamic phase transitions across all **212 elements** using `high_temp_transition` (boiling, melting, sublimation) and `low_temp_transition` (condensation, freezing).

### 3.1 Sensible Enthalpy Partitioning
When a stream of mass rate $\dot{m}$ at temperature $T_{\text{in}}$ absorbs thermal heat $\dot{Q}$ (kDTU/s):
1. **Pre-Transition Heating**: The sensible heat required to bring the stream from $T_{\text{in}}$ to the transition threshold $T_{\text{trans}}$ is:
   $$\Delta H_{\text{pre}} = \frac{\dot{m} \cdot c_{\text{in}} \cdot (T_{\text{trans}} - T_{\text{in}})}{1000} \quad [\text{kDTU/s}]$$
2. **Transition Threshold Check**:
   - If $\dot{Q} \le \Delta H_{\text{pre}}$, no phase change occurs; the stream undergoes simple sensible heating to:
     $$T_{\text{out}} = T_{\text{in}} + \frac{\dot{Q} \cdot 1000}{\dot{m} \cdot c_{\text{in}}}$$
   - If $\dot{Q} > \Delta H_{\text{pre}}$, the phase transition is triggered at temperature $T_{\text{trans}}$.
3. **Post-Transition Heating**:
   The remaining enthalpy $\Delta H_{\text{post}} = \dot{Q} - \Delta H_{\text{pre}}$ sensibly heats the transition product(s):
   $$T_{\text{out}} = T_{\text{trans}} + \frac{\Delta H_{\text{post}} \cdot 1000}{\sum_k (\dot{m}_k \cdot c_k)}$$
4. **Cascading / Multi-Stage Transitions**:
   If $\Delta H_{\text{post}}$ is large enough to exceed the next phase boundary of the product element (e.g. Polluted Dirt heating past $1712.85\text{ °C}$ to Molten Glass, and further past $2356.85\text{ °C}$ to Rock Gas), `applyHeatAndPhaseChange` recursively partitions enthalpy across successive transitions until the final element state is reached.

### 3.2 Mass Ratio Conservation
When an element transitions into multiple product elements (e.g., Polluted Water boiling at $119.35\text{ °C}$ into 99% Steam and 1% Dirt; or Sour Gas condensation), total mass flow is strictly conserved:
$$\dot{m}_k = \dot{m}_{\text{in}} \cdot r_k, \quad \sum_k r_k = 1.0 \implies \sum_k \dot{m}_k = \dot{m}_{\text{in}}$$

### 3.3 Delivery State Reset on Phase Change
In *Oxygen Not Included*, when a fluid changes phase inside a pipe (such as Water flashing into Steam or freezing into Ice), the pipe ruptures and the contents spill into the surrounding environment as free matter. The calculator reflects this game mechanic:
- If a phase change occurs (e.g. `Crude Oil (in a pipe)` $\to$ `Petroleum`), the resulting output delivery state is automatically updated to `"free"`.

---

## 4. Meta-Machine Thermal Physics

To enable modeling boilers, heat recovery systems, and industrial loops, two virtual meta-machines are supported:

### 4.1 Absorb Heat (`absorb_heat`)
- **Dynamic Phase Label**: The entity label dynamically resolves to `"Absorb heat into liquid"`, `"Absorb heat into gas"`, or `"Absorb heat into solid"` based on the state of the selected input material.
- **Heat Absorption**: For each $1\times$ quantity, transfers $10\text{ kDTU/s}$ of thermal energy directly into the flowing stream. The building operational heat is reported as negative cooling:
  $$\text{Heat}_{\text{building}} = -10 \times q \quad [\text{kDTU/s}]$$
- **Upstream Pool Flow-Rate Matching**: Automatically matches the flow rate and temperature of the selected `(material, material_state)` available in the upstream pool. If insufficient upstream supply exists, the remaining flow is drawn from NET Inputs.

### 4.2 Counterflow Heat Exchanger (`counterflow_heat_exchanger`)
- **Operational Heat & Power**: Performs pure thermal exchange between two independent streams:
  $$\text{Heat}_{\text{building}} = 0\text{ kDTU/s}, \quad \text{Power} = 0\text{ W}$$
- **Nominal Transfer**: Transfers $10\text{ kDTU/s}$ per $1\times$ unit from the hot stream to the cold stream:
  $$\dot{Q}_{\text{nom}} = 10 \times q \quad [\text{kDTU/s}]$$
- **Thermodynamic Clamping (Second Law of Thermodynamics)**:
  Unlike co-current (parallel) heat exchangers where streams cannot cross each other ($T_{\text{hot, out}} \ge T_{\text{cold, out}}$), true counterflow exchangers allow outlet temperature crossover ($T_{\text{cold, out}} > T_{\text{hot, out}}$). However, the Second Law dictates that the outlet temperature of either stream cannot violate the opposite stream's inlet temperature:
  $$T_{\text{cold, out}} \le T_{\text{hot, in}} \quad \text{and} \quad T_{\text{hot, out}} \ge T_{\text{cold, in}}$$
  When the requested heat transfer $\dot{Q}_{\text{nom}}$ would cause a temperature crossover pinch violation, the calculator uses a bisection search to clamp the heat transfer at the maximum thermodynamically allowed rate $\dot{Q}_{\max}$:
  $$\dot{Q} = \min(\dot{Q}_{\text{nom}}, \dot{Q}_{\max})$$

---

## 5. Dynamic Steam Turbine Simulation

The Steam Turbine (`steam_turbine`) dynamically models power generation, heat removal, and building heat dissipation as a function of incoming steam temperature $T_{\text{steam}}$:

1. **Operating Threshold ($T_{\text{steam}} < 125\text{ °C}$)**:
   - Below $125\text{ °C}$, the turbine is inactive:
     $$\text{Power} = 0\text{ W}, \quad \text{Heat} = 0\text{ kDTU/s}$$
2. **Water Output Temperature**:
   - For $T_{\text{steam}} \ge 125\text{ °C}$, the turbine condenses steam into clean Water at a fixed $95\text{ °C}$ output:
     $$T_{\text{out, water}} = 95\text{ °C}$$
3. **Power Output Scaling**:
   - Power scales linearly from $125\text{ °C}$ to $200\text{ °C}$, capping at $850\text{ W}$ (or $1275\text{ W}$ with Engie's Tune-Up $+50\%$ boost):
     $$\text{Power} = 850\text{ W} \times \min\left(1, \frac{T_{\text{steam}} - 95}{105}\right) \times \text{multiplier}_{\text{tuneup}}$$
     - At $125\text{ °C}$: $\text{Power} = 850 \times \frac{30}{105} = 242.86\text{ W}$
     - At $200\text{ °C}$: $\text{Power} = 850 \times \frac{105}{105} = 850.00\text{ W}$ ($1275\text{ W}$ with tune-up)
     - At $500\text{ °C}$: $\text{Power} = 850.00\text{ W}$ (power is capped, but heat destruction continues to rise)
4. **Thermal Heat Removal & Building Heat Dissipation**:
   - Total thermal energy extracted from steam:
     $$\dot{Q}_{\text{removed}} = \frac{\dot{m}_{\text{steam}} \cdot c_{\text{steam}} \cdot (T_{\text{steam}} - 95)}{1000} \quad [\text{kDTU/s}]$$
   - Building operational heat emitted onto the turbine body:
     $$\text{Heat}_{\text{building}} = 4.0 + 0.10 \times \dot{Q}_{\text{removed}} \quad [\text{kDTU/s}]$$
   - The remaining $90\%$ of extracted thermal energy (less the base $4\text{ kDTU/s}$) represents net heat deletion from the environment.

---

## 6. Sequential Top-to-Bottom Temperature Resolution & Loop Thermal Tracking (`src/calculator.js`)

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
