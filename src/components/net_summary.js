/**
 * Component for rendering the bottom NET resource summary row.
 */

import { formatNumber, formatStreamLine, getDefaultElementTemp, getNetInputTemp, isNonThermalResource, NET_RATE_EPSILON } from "../calculator.js";
import { renderIcon } from "./table_row.js";

/**
 * Render the NET summary row HTML.
 *
 * @param {Object} net - Net calculation result { netPower, netHeat, netBuildingHeat, netShcHeat, netInputs, netOutputs }
 * @param {Map<string, Object>} elementMap - Map of elements and synthetic resources
 * @param {string} rateMode - "s" or "c"
 * @param {Object} netInputTemps - User configured net input temperatures
 * @returns {string} HTML string for <tr class="net-summary-row">
 */
export function renderNetSummaryRowHtml(net, elementMap, rateMode, netInputTemps = {}) {
  const powerIcon = elementMap?.get("Power")?.icon;
  const heatIcon = elementMap?.get("Heat")?.icon;

  // NET Inputs list
  const inputLines = [];
  const powerIn = net.netPowerIn !== undefined ? net.netPowerIn : (net.netPower < -1e-4 ? Math.abs(net.netPower) : 0);
  if (powerIn > 1e-4) {
    inputLines.push(`
      <div class="stream-line net-stream net-power-neg">
        ${renderIcon(powerIcon, "Power", "stream-icon")}
        <span class="stream-text">Power: -${formatNumber(powerIn)} W</span>
      </div>
    `);
  }
  for (const stream of net.netInputs || []) {
    if (Math.abs(stream.rate || 0) < NET_RATE_EPSILON) continue;
    const streamText = formatStreamLine(stream, false, rateMode, elementMap);
    if (streamText.includes(": 0 ") || streamText.endsWith(": 0") || streamText.includes(": -0 ") || streamText.endsWith(": -0")) {
      continue;
    }
    const elem = elementMap?.get(stream.resource);
    const key = `${stream.resource}||${stream.state || "free"}`;
    const defaultT = getDefaultElementTemp(stream.resource, elementMap);
    const currentTemp = stream.tempC !== undefined
      ? stream.tempC
      : getNetInputTemp(stream.resource, stream.state, netInputTemps, defaultT);
    const isThermal = !isNonThermalResource(stream.resource, stream.unit);
    const matchTempBtn = isThermal && stream.outputTempC !== undefined
      ? `<button type="button" class="btn-match-net-temp" data-key="${key}" data-resource="${stream.resource}" data-state="${stream.state || 'free'}" data-target-temp="${stream.outputTempC}" title="Set input temperature to output temperature (${formatNumber(stream.outputTempC)} °C) to form an automatic loop">[match output: ${formatNumber(stream.outputTempC)} °C]</button>`
      : "";

    inputLines.push(`
      <div class="stream-line net-stream">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${streamText}</span>
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
        ${matchTempBtn}
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
  for (const stream of net.netOutputs || []) {
    if (Math.abs(stream.rate || 0) < NET_RATE_EPSILON) continue;
    const streamText = formatStreamLine(stream, true, rateMode, elementMap);
    if (streamText.includes(": 0 ") || streamText.endsWith(": 0") || streamText.includes(": +0 ") || streamText.endsWith(": +0")) {
      continue;
    }
    const elem = elementMap?.get(stream.resource);
    outputLines.push(`
      <div class="stream-line net-stream">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${streamText}</span>
      </div>
    `);
  }
  const powerOut = net.netPowerOut !== undefined ? net.netPowerOut : (net.netPower > 1e-4 ? net.netPower : 0);
  if (powerOut > 1e-4) {
    outputLines.push(`
      <div class="stream-line net-stream net-power-pos">
        ${renderIcon(powerIcon, "Power", "stream-icon")}
        <span class="stream-text">Power: +${formatNumber(powerOut)} W</span>
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
