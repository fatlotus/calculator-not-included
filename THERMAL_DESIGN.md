# ONI Thermal Energy, Specific Heat Capacity (SHC), & Loop Heat Tracking Design

## 1. Fundamental Thermal Math in *Oxygen Not Included*
Every element in *Oxygen Not Included* has a **Specific Heat Capacity ($c$ or $\text{SHC}$)** measured in $\text{DTU}/(\text{g}\cdot\text{°C})$.

For any resource stream with mass flow rate $\dot{m}$ (in $\text{g/s}$), specific heat capacity $c$, and temperature $T$ (in $\text{°C}$):
- **Thermal Capacity Rate ($\dot{C}$)**:
  $$\dot{C} = \dot{m} \cdot c \quad [\text{DTU}/(\text{s}\cdot\text{°C})]$$
- **Thermal Power / Enthalpy Flow ($\dot{Q}$) relative to reference temperature $T_{\text{ref}}$**:
  $$\dot{Q}(T) = \frac{\dot{m} \cdot c \cdot (T - T_{\text{ref}})}{1000} \quad [\text{kDTU/s}]$$
  *(Note: When comparing input vs. output streams at known temperatures $T_{\text{in}}$ and $T_{\text{out}}$ relative to $0\text{ °C}$, $\dot{Q} = \frac{\dot{m} \cdot c \cdot T}{1000}\text{ kDTU/s}$.)*

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
   The output resource inherits the exact temperature of the input resource.
   - **Examples**:
     - `Water Pump` (`Liquid Pump`), `Gas Pump`, `Mini Liquid Pump`, `Mini Gas Pump`.
     - `Water Sieve` & `Desalinator`: Output clean Water exits at the exact input Polluted Water / Salt Water / Brine temperature.

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
     - `Hydrogen Generator`, `Natural Gas Generator`, `Duplicants`, `Plants`: Any mass consumed without a corresponding mass output deletes the thermal enthalpy carried by that input stream.

---

## 3. Specific Heat Created or Destroyed in a Machine or Loop

For any row or closed loop with known input temperatures $T_{\text{in}}$ (defaulting to a user-configurable ambient/feed temperature, e.g., $20\text{ °C}$, or overridden per-row such as $95\text{ °C}$ geyser water):

1. **Stream Temperature Propagation**:
   - If a row produces resource $R$ at temperature $T_R$ (e.g., `Water Pump` with input temp $95\text{ °C}$ outputs `Water (in a pipe) @ 95 °C`), downstream consumers of `Water (in a pipe)` automatically know the incoming water is at $95\text{ °C}$ (unless overridden on that row).
2. **SHC / Process Heat Delta ($\Delta \dot{Q}_{\text{SHC}}$)**:
   When a machine transforms inputs $\{( \dot{m}_i, c_i, T_i )\}$ into outputs $\{( \dot{m}_j, c_j, T_j )\}$, the thermal energy created or destroyed strictly by the temperature change and Specific Heat Capacity (SHC) change (relative to $0\text{ °C}$) is:
   $$\Delta \dot{Q}_{\text{SHC}} = \sum_{j \in \text{Outputs}} \frac{\dot{m}_j \cdot c_j \cdot T_j}{1000} - \sum_{i \in \text{Inputs}} \frac{\dot{m}_i \cdot c_i \cdot T_i}{1000} \quad [\text{kDTU/s}]$$
3. **Total Net Heat Created/Destroyed ($\dot{Q}_{\text{total}}$)**:
   Adding the building's own operational heat $\dot{Q}_{\text{self}}$:
   $$\dot{Q}_{\text{total}} = \dot{Q}_{\text{self}} + \Delta \dot{Q}_{\text{SHC}}$$

### Worked Example: Electrolyzer with $20\text{ °C}$ vs. $95\text{ °C}$ Water
- **Water**: $\dot{m}_{\text{w}} = 1000\text{ g/s}$, $c_{\text{w}} = 4.179\text{ DTU}/(\text{g}\cdot\text{°C}) \implies \dot{C}_{\text{in}} = 4.179\text{ kDTU}/(\text{s}\cdot\text{°C})$.
- **Outputs**:
  - Oxygen: $888\text{ g/s} \times 1.005 = 892.44\text{ DTU}/(\text{s}\cdot\text{°C})$
  - Hydrogen: $112\text{ g/s} \times 2.400 = 268.80\text{ DTU}/(\text{s}\cdot\text{°C})$
  - Combined Output Thermal Capacity: $\dot{C}_{\text{out}} = 1.16124\text{ kDTU}/(\text{s}\cdot\text{°C})$.
- **At $T_{\text{in}} = 20\text{ °C}$**:
  - $T_{\text{out}} = \max(20, 70) = 70\text{ °C}$.
  - Input enthalpy: $4.179 \times 20 = 83.58\text{ kDTU/s}$.
  - Output gas enthalpy: $1.16124 \times 70 = 81.29\text{ kDTU/s}$.
  - $\Delta \dot{Q}_{\text{SHC}} = 81.29 - 83.58 = -2.29\text{ kDTU/s}$ (plus $+1.25\text{ kDTU/s}$ building heat $= -1.04\text{ kDTU/s}$ net thermal change!).
- **At $T_{\text{in}} = 95\text{ °C}$**:
  - $T_{\text{out}} = \max(95, 70) = 95\text{ °C}$.
  - Input enthalpy: $4.179 \times 95 = 397.01\text{ kDTU/s}$.
  - Output gas enthalpy: $1.16124 \times 95 = 110.32\text{ kDTU/s}$.
  - $\Delta \dot{Q}_{\text{SHC}} = 110.32 - 397.01 = -286.69\text{ kDTU/s}$ (plus $+1.25\text{ kDTU/s}$ building heat $= -285.44\text{ kDTU/s}$ net heat **destroyed** by SHC reduction!).
