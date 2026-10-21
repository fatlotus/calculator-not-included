/**
 * Component for rendering an individual machine / entity table row.
 * Includes interactive match links to balance surpluses or deficits,
 * feed temperature tuning, and thermal tracking.
 */

import { formatNumber, formatStreamLine } from "../calculator.js";

/**
 * Render an element/resource icon or placeholder.
 */
export function renderIcon(iconUrl, alt = "", className = "stream-icon") {
  if (!iconUrl) {
    return `<span class="${className} icon-fallback" aria-hidden="true"></span>`;
  }
  return `<img class="${className}" src="${iconUrl}" alt="${alt}" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

/**
 * Render a single row of the resource calculator.
 */
export function renderTableRowHtml(row, evaluated, elementMap, rateMode, rowIndex, matches = {}) {
  const entity = evaluated.entity;
  if (!entity) return "";

  const activeMods = new Set(row.modifiers || []);
  const powerIcon = elementMap?.get("Power")?.icon;
  const heatIcon = elementMap?.get("Heat")?.icon;

  // Machine Column HTML
  let machineHtml = `
    <div class="machine-col-content">
      <div class="row-qty-wrapper">
        <input
          type="number"
          class="qty-input"
          data-row-index="${rowIndex}"
          value="${formatNumber(row.qty)}"
          min="0"
          step="any"
          aria-label="Quantity for ${entity.name}"
        />
        <span class="qty-unit">×</span>
      </div>
      <div class="entity-avatar">
        ${renderIcon(entity.icon, entity.name, "entity-icon")}
      </div>
      <div class="entity-details">
        <div class="entity-heading">
          <a href="${entity.wiki_url || '#'}" target="_blank" rel="noopener noreferrer" class="entity-name-link" title="Open Wiki article">
            ${entity.name}
          </a>
          <span class="cat-pill cat-${(entity.category || 'machine').toLowerCase()}">${entity.category}</span>
        </div>
        <div class="row-subcontrols">
  `;

  // Recipe selector
  if (entity.recipes && entity.recipes.length > 0) {
    machineHtml += `
      <div class="recipe-wrapper">
        <label class="field-label" for="recipe-${rowIndex}">Mode:</label>
        <select id="recipe-${rowIndex}" class="recipe-select" data-row-index="${rowIndex}">
    `;
    for (const r of entity.recipes) {
      const isSelected = (row.recipeId === r.id) || (!row.recipeId && r === entity.recipes[0]);
      machineHtml += `<option value="${r.id}" ${isSelected ? "selected" : ""}>${r.name}</option>`;
    }
    machineHtml += `</select></div>`;
  }

  // Feed temperature control for thermal modeling
  const currentTemp = row.inputTemp !== undefined && row.inputTemp !== null ? row.inputTemp : evaluated.inputTemp;
  machineHtml += `
      <div class="temp-wrapper" title="Input resource feed temperature in °C">
        <label class="field-label" for="temp-${rowIndex}">Feed:</label>
        <input
          type="number"
          id="temp-${rowIndex}"
          class="input-temp-field"
          data-row-index="${rowIndex}"
          value="${currentTemp}"
          step="any"
        />
        <span class="temp-unit">°C</span>
      </div>
    </div>
  `;

  // Modifiers list
  if (entity.modifiers && entity.modifiers.length > 0) {
    machineHtml += `<div class="modifier-checkbox-group">`;
    for (const mod of entity.modifiers) {
      const checked = activeMods.has(mod.id);
      machineHtml += `
        <label class="mod-label ${checked ? 'mod-checked' : ''}" title="${mod.description || mod.name}">
          <input
            type="checkbox"
            class="mod-checkbox"
            data-row-index="${rowIndex}"
            data-mod-id="${mod.id}"
            ${checked ? "checked" : ""}
          />
          <span class="mod-text">${mod.name}</span>
        </label>
      `;
    }
    machineHtml += `</div>`;
  }

  machineHtml += `
      </div>
      <div class="row-actions">
        <button
          type="button"
          class="btn-delete-row"
          data-row-index="${rowIndex}"
          title="Remove row"
          aria-label="Remove ${entity.name}"
        >×</button>
      </div>
    </div>
  `;

  // Helper for match button HTML
  const getMatchBtn = (matchKey, desc) => {
    const m = matches[matchKey];
    if (!m) return "";
    const formattedTarget = formatNumber(m.targetQty);
    if (m.isMatched) {
      return `<span class="badge-matched" title="Quantity exactly matches available rate">[✓ matched]</span>`;
    }
    return `<button type="button" class="btn-match-stream" data-row-index="${rowIndex}" data-target-qty="${formattedTarget}" title="Tune row quantity to ${formattedTarget}× to match ${desc}">[match: ${formattedTarget}×]</button>`;
  };

  // Inputs Column HTML
  const inputLines = [];
  if (evaluated.power < 0) {
    const powerMatch = getMatchBtn("in:Power", "power surplus");
    inputLines.push(`
      <div class="stream-line">
        ${renderIcon(powerIcon, "Power", "stream-icon")}
        <span class="stream-text">Power: -${formatNumber(Math.abs(evaluated.power))} W</span>
        ${powerMatch}
      </div>
    `);
  }
  for (const stream of evaluated.inputs) {
    const elem = elementMap?.get(stream.resource);
    const key = `in:${stream.resource}||${stream.state || "free"}`;
    const matchBtn = getMatchBtn(key, `${stream.resource} (${stream.state || "free"})`);
    inputLines.push(`
      <div class="stream-line">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, false, rateMode)}</span>
        ${matchBtn}
      </div>
    `);
  }
  const inputsHtml = inputLines.length > 0
    ? inputLines.join("")
    : `<span class="empty-stream">—</span>`;

  // Outputs Column HTML
  const outputLines = [];
  const dispHeat = evaluated.totalHeat !== undefined ? evaluated.totalHeat : evaluated.heat;
  if (Math.abs(dispHeat) > 1e-4) {
    let heatAnnotation = "";
    if (evaluated.shcHeat && Math.abs(evaluated.shcHeat) > 1e-4) {
      heatAnnotation = `<span class="stream-subtext" title="Building: ${formatNumber(evaluated.buildingHeat)} kDTU/s, SHC: ${formatNumber(evaluated.shcHeat)} kDTU/s">(${formatNumber(evaluated.buildingHeat)} bld ${evaluated.shcHeat > 0 ? "+" : ""}${formatNumber(evaluated.shcHeat)} shc)</span>`;
    }
    outputLines.push(`
      <div class="stream-line">
        ${renderIcon(heatIcon, "Heat", "stream-icon")}
        <span class="stream-text">Heat: ${dispHeat > 0 ? "+" : ""}${formatNumber(dispHeat)} kDTU/s ${heatAnnotation}</span>
      </div>
    `);
  }
  for (const stream of evaluated.outputs) {
    const elem = elementMap?.get(stream.resource);
    const key = `out:${stream.resource}||${stream.state || "free"}`;
    const matchBtn = getMatchBtn(key, `${stream.resource} (${stream.state || "free"})`);
    outputLines.push(`
      <div class="stream-line">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, true, rateMode)}</span>
        ${matchBtn}
      </div>
    `);
  }
  if (evaluated.power > 0) {
    const powerMatch = getMatchBtn("out:Power", "power deficit");
    outputLines.push(`
      <div class="stream-line">
        ${renderIcon(powerIcon, "Power", "stream-icon")}
        <span class="stream-text">Power: +${formatNumber(evaluated.power)} W</span>
        ${powerMatch}
      </div>
    `);
  }
  const outputsHtml = outputLines.length > 0
    ? outputLines.join("")
    : `<span class="empty-stream">—</span>`;

  return `
    <tr class="calc-row" data-row-index="${rowIndex}">
      <td class="col-machine" data-label="Machine">${machineHtml}</td>
      <td class="col-inputs" data-label="Inputs">${inputsHtml}</td>
      <td class="col-outputs" data-label="Outputs">${outputsHtml}</td>
    </tr>
  `;
}
