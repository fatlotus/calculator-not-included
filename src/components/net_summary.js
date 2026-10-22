/**
 * Component for rendering the bottom NET resource summary row.
 */

import { formatNumber, formatStreamLine, getDefaultElementTemp, getNetInputTemp } from "../calculator.js";
import { renderIcon } from "./table_row.js";

/**
 * Render the NET summary row HTML.
 *
 * @param {Object} net - Net calculation result { netPower, netHeat, netBuildingHeat, netShcHeat, netInputs, netOutputs }
 * @param {Map<string, Object>} elementMap - Map of elements and synthetic resources
 * @param {string} rateMode - "s" or "c"
 * @param {Object} netInputTemps - User configured net input temperatures
 * @param {boolean} strictPipeMatching - Whether strict pipe state matching is active
 * @returns {string} HTML string for <tr class="net-summary-row">
 */
const NON_THERMAL_RESOURCES = new Set(["Duplicant Labor", "Microchip", "Power", "Heat", "Calories", "Gear Balm", "Tallow Gear Balm"]);
const NON_THERMAL_UNITS = new Set(["chips/s", "chips/cycle", "s/s", "s/cycle", "kcal/s", "kcal/cycle", "balm/s", "balm/cycle"]);

export function renderNetSummaryRowHtml(net, elementMap, rateMode, netInputTemps = {}) {
  const powerIcon = elementMap?.get("Power")?.icon;
  const heatIcon = elementMap?.get("Heat")?.icon;

  // NET Inputs list
  const inputLines = [];
  if (net.netPower < 0) {
    inputLines.push(`
      <div class="stream-line net-stream net-power-neg">
        ${renderIcon(powerIcon, "Power", "stream-icon")}
        <span class="stream-text">Power: -${formatNumber(Math.abs(net.netPower))} W</span>
      </div>
    `);
  }
  for (const stream of net.netInputs) {
    const elem = elementMap?.get(stream.resource);
    const key = `${stream.resource}||${stream.state || "free"}`;
    const defaultT = getDefaultElementTemp(stream.resource, elementMap);
    const currentTemp = stream.tempC !== undefined
      ? stream.tempC
      : getNetInputTemp(stream.resource, stream.state, netInputTemps, defaultT);
    const isThermal = !NON_THERMAL_RESOURCES.has(stream.resource) && !NON_THERMAL_UNITS.has(stream.unit);

    inputLines.push(`
      <div class="stream-line net-stream">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, false, rateMode)}</span>
        ${isThermal ? `
        <span class="net-temp-wrapper">
          <span class="net-temp-at">@</span>
          <input
            type="number"
            class="net-temp-input"
            data-resource="${stream.resource}"
            data-state="${stream.state || 'free'}"
            data-key="${key}"
            value="${formatNumber(currentTemp)}"
            step="any"
            aria-label="Input temperature for ${stream.resource}"
          />
          <span class="net-temp-unit">°C</span>
        </span>` : ""}
      </div>
    `);
  }

  const inputsHtml = inputLines.length > 0
    ? inputLines.join("")
    : `<div class="net-empty-state">None (0 net input required)</div>`;

  // NET Outputs list
  const outputLines = [];
  if (Math.abs(net.netHeat) > 1e-4) {
    outputLines.push(`
      <div class="stream-line net-stream net-heat">
        ${renderIcon(heatIcon, "Heat", "stream-icon")}
        <span class="stream-text">Heat: ${net.netHeat > 0 ? "+" : ""}${formatNumber(net.netHeat)} kDTU/s</span>
      </div>
    `);
  }
  for (const stream of net.netOutputs) {
    const elem = elementMap?.get(stream.resource);
    outputLines.push(`
      <div class="stream-line net-stream">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, true, rateMode)}</span>
      </div>
    `);
  }
  if (net.netPower > 0) {
    outputLines.push(`
      <div class="stream-line net-stream net-power-pos">
        ${renderIcon(powerIcon, "Power", "stream-icon")}
        <span class="stream-text">Power: +${formatNumber(net.netPower)} W</span>
      </div>
    `);
  }

  const outputsHtml = outputLines.length > 0
    ? outputLines.join("")
    : `<div class="net-empty-state">None (0 net surplus)</div>`;

  return `
    <tr class="net-row">
      <td class="col-machine" data-label="Machine">
        <div class="net-badge-wrapper">
          <span class="net-badge">NET</span>
          <span class="net-subtext">System Balance</span>
        </div>
      </td>
      <td class="col-inputs" data-label="Net Inputs">${inputsHtml}</td>
      <td class="col-outputs" data-label="Net Outputs">${outputsHtml}</td>
    </tr>
  `;
}
