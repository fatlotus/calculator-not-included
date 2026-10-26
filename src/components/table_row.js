/**
 * Component for rendering an individual machine / entity table row.
 * Includes interactive match links to balance surpluses or deficits,
 * feed temperature tuning, and thermal tracking.
 */

import {
  DUPLICANT_DIETS,
  formatNumber,
  formatStreamLine,
  isNonThermalResource,
  isSolidResource,
} from "../calculator.js";

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
export function renderTableRowHtml(row, evaluated, elementMap, rateMode, rowIndex, matches = {}, totalRows = 0, loops = []) {
  const entity = evaluated.entity;
  if (!entity) return "";

  const activeMods = new Set(row.modifiers || []);
  const powerIcon = elementMap?.get("Power")?.icon;
  const heatIcon = elementMap?.get("Heat")?.icon;

  // Machine Column HTML
  let machineHtml = `
    <div class="machine-col-content">
      <div class="row-reorder-tab">
        <span class="row-drag-handle" draggable="true" data-row-index="${rowIndex}" title="Drag to reorder row" aria-label="Drag to reorder row">⋮⋮</span>
        <div class="row-reorder-buttons">
          <button type="button" class="btn-reorder btn-move-up" data-row-index="${rowIndex}" title="Move row up" aria-label="Move row up" ${rowIndex === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="btn-reorder btn-move-down" data-row-index="${rowIndex}" title="Move row down" aria-label="Move row down" ${totalRows > 0 && rowIndex >= totalRows - 1 ? "disabled" : ""}>▼</button>
        </div>
      </div>
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
  `;

  // Recipe, Bathroom, & Meta-Machine subcontrols
  const hasRecipes = entity.recipes && entity.recipes.length > 0;
  const isDuplicant = row.entityId === "duplicant";
  const isAbsorbHeat = row.entityId === "absorb_heat" || entity.id === "absorb_heat";
  const isCounterflow = row.entityId === "counterflow_heat_exchanger" || entity.id === "counterflow_heat_exchanger";

  if (hasRecipes || isDuplicant || isAbsorbHeat || isCounterflow) {
    machineHtml += `<div class="row-subcontrols">`;

    let elementOptionsHtml = null;
    if (isAbsorbHeat || isCounterflow) {
      const physicalElements = [];
      if (elementMap) {
        const src = elementMap instanceof Map ? elementMap.values() : Object.values(elementMap);
        for (const elem of src) {
          if (elem?.name && (elem.state === "Liquid" || elem.state === "Gas" || elem.state === "Solid")) {
            physicalElements.push(elem.name);
          }
        }
      }
      physicalElements.sort((a, b) => a.localeCompare(b));
      elementOptionsHtml = (selectedName) => physicalElements.map((name) =>
        `<option value="${name}" ${selectedName === name ? "selected" : ""}>${name}</option>`
      ).join("");
    }

    if (hasRecipes) {
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

    if (isDuplicant) {
      const selectedBathroom = row.bathroom || "plumbed";
      const selectedFood = row.food || "calories";
      machineHtml += `
        <div class="bathroom-wrapper">
          <label class="field-label" for="bathroom-${rowIndex}">Bathroom:</label>
          <select id="bathroom-${rowIndex}" class="bathroom-select" data-row-index="${rowIndex}">
            <option value="plumbed" ${selectedBathroom === "plumbed" ? "selected" : ""}>Plumbed</option>
            <option value="outhouse" ${selectedBathroom === "outhouse" ? "selected" : ""}>Outhouse</option>
            <option value="floor" ${selectedBathroom === "floor" ? "selected" : ""}>Peeing on the floor</option>
            <option value="none" ${selectedBathroom === "none" ? "selected" : ""}>None</option>
          </select>
        </div>
        <div class="food-wrapper">
          <label class="field-label" for="food-${rowIndex}">Food:</label>
          <select id="food-${rowIndex}" class="food-select" data-row-index="${rowIndex}">
      `;
      for (const [fId, fObj] of Object.entries(DUPLICANT_DIETS)) {
        machineHtml += `<option value="${fId}" ${selectedFood === fId ? "selected" : ""}>${fObj.name}</option>`;
      }
      machineHtml += `
            <option value="none" ${selectedFood === "none" ? "selected" : ""}>None (Fasting)</option>
          </select>
        </div>
      `;
    }

    if (isAbsorbHeat && elementOptionsHtml) {
      const selectedMat = row.material || "Water";
      const isSolid = isSolidResource(selectedMat, elementMap);
      const selectedState = isSolid ? "free" : (row.materialState || "free");
      machineHtml += `
        <div class="material-wrapper">
          <label class="field-label" for="material-${rowIndex}">Material:</label>
          <select id="material-${rowIndex}" class="material-select" data-row-index="${rowIndex}">
            ${elementOptionsHtml(selectedMat)}
          </select>
        </div>
      `;
      if (!isSolid) {
        machineHtml += `
          <div class="material-state-wrapper">
            <label class="field-label" for="material-state-${rowIndex}">State:</label>
            <select id="material-state-${rowIndex}" class="material-state-select" data-row-index="${rowIndex}">
              <option value="free" ${selectedState === "free" ? "selected" : ""}>Free</option>
              <option value="in a pipe" ${selectedState === "in a pipe" ? "selected" : ""}>In a pipe</option>
            </select>
          </div>
        `;
      }
    }

    if (isCounterflow && elementOptionsHtml) {
      const selectedHot = row.material || "Petroleum";
      const isHotSolid = isSolidResource(selectedHot, elementMap);
      const selectedHotState = isHotSolid ? "free" : (row.materialState || "free");

      const selectedCold = row.coldMaterial || "Crude Oil";
      const isColdSolid = isSolidResource(selectedCold, elementMap);
      const selectedColdState = isColdSolid ? "free" : (row.coldMaterialState || "in a pipe");

      machineHtml += `
        <div class="material-wrapper">
          <label class="field-label" for="material-${rowIndex}">Hot Stream:</label>
          <select id="material-${rowIndex}" class="material-select" data-row-index="${rowIndex}">
            ${elementOptionsHtml(selectedHot)}
          </select>
        </div>
      `;
      if (!isHotSolid) {
        machineHtml += `
          <div class="material-state-wrapper">
            <select id="material-state-${rowIndex}" class="material-state-select" data-row-index="${rowIndex}">
              <option value="free" ${selectedHotState === "free" ? "selected" : ""}>Free</option>
              <option value="in a pipe" ${selectedHotState === "in a pipe" ? "selected" : ""}>In a pipe</option>
            </select>
          </div>
        `;
      }
      machineHtml += `
        <div class="cold-material-wrapper">
          <label class="field-label" for="cold-material-${rowIndex}">Cold Stream:</label>
          <select id="cold-material-${rowIndex}" class="cold-material-select" data-row-index="${rowIndex}">
            ${elementOptionsHtml(selectedCold)}
          </select>
        </div>
      `;
      if (!isColdSolid) {
        machineHtml += `
          <div class="cold-material-state-wrapper">
            <select id="cold-material-state-${rowIndex}" class="cold-material-state-select" data-row-index="${rowIndex}">
              <option value="in a pipe" ${selectedColdState === "in a pipe" ? "selected" : ""}>In a pipe</option>
              <option value="free" ${selectedColdState === "free" ? "selected" : ""}>Free</option>
            </select>
          </div>
        `;
      }
    }

    machineHtml += `</div>`;
  }

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
    const cleanTarget = Math.abs(Math.round(m.targetQty) - m.targetQty) < 1e-9 ? Math.round(m.targetQty) : m.targetQty;
    return `<button type="button" class="btn-match-stream" data-row-index="${rowIndex}" data-target-qty="${cleanTarget}" title="Tune row quantity to ${formattedTarget}× to match ${desc}">[match: ${formattedTarget}×]</button>`;
  };

  // Helper for loop/unloop button HTML on output streams
  const getLoopBtn = (resource, state, rate, unit, tempC) => {
    const normState = state || "free";
    const existing = Array.isArray(loops)
      ? loops.find((l) => l && l.resource === resource && (l.state || "free") === normState)
      : null;
    const isThermal = !isNonThermalResource(resource, unit);
    const sameRate = existing && Math.abs(Number(existing.rate) - rate) < 1e-4;
    const sameTemp =
      !isThermal ||
      (existing &&
        Math.abs(
          Number(existing.tempC !== undefined ? existing.tempC : 20) -
            Number(tempC !== undefined ? tempC : 20)
        ) < 1e-4);

    if (existing && sameRate && sameTemp) {
      return `<button type="button" class="btn-loop-stream btn-unloop-stream" data-resource="${resource}" data-state="${normState}" title="Remove ${resource} from loop">[unloop]</button>`;
    }

    const tempAttr =
      isThermal && tempC !== undefined && tempC !== null && !isNaN(Number(tempC))
        ? ` data-temp="${Number(tempC)}"`
        : "";
    return `<button type="button" class="btn-loop-stream" data-resource="${resource}" data-state="${normState}" data-rate="${rate}" data-unit="${unit || ""}"${tempAttr} title="Loop ${resource} back to top of table">[loop]</button>`;
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
    const streamState = stream.state || "free";
    const descState = (streamState === "free" && isSolidResource(stream.resource, elementMap))
      ? ""
      : ` (${streamState})`;
    const matchBtn = getMatchBtn(key, `${stream.resource}${descState}`);
    inputLines.push(`
      <div class="stream-line">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, false, rateMode, elementMap)}</span>
        ${matchBtn}
      </div>
    `);
  }
  const inputsHtml = inputLines.length > 0
    ? inputLines.join("")
    : `<span class="empty-stream">—</span>`;

  // Outputs Column HTML
  const outputLines = [];
  const heatMatch = getMatchBtn("out:Heat", "heat balance");
  if (Math.abs(evaluated.heat) > 1e-4) {
    outputLines.push(`
      <div class="stream-line">
        ${renderIcon(heatIcon, "Heat", "stream-icon")}
        <span class="stream-text">Heat: ${evaluated.heat > 0 ? "+" : ""}${formatNumber(evaluated.heat)} kDTU/s</span>
        ${heatMatch}
      </div>
    `);
  } else if (isCounterflow && heatMatch) {
    outputLines.push(`
      <div class="stream-line">
        ${renderIcon(heatIcon, "Heat", "stream-icon")}
        <span class="stream-text">Heat: 0 kDTU/s</span>
        ${heatMatch}
      </div>
    `);
  }
  for (const stream of evaluated.outputs) {
    const elem = elementMap?.get(stream.resource);
    const key = `out:${stream.resource}||${stream.state || "free"}`;
    const streamState = stream.state || "free";
    const descState = (streamState === "free" && isSolidResource(stream.resource, elementMap))
      ? ""
      : ` (${streamState})`;
    const matchBtn = getMatchBtn(key, `${stream.resource}${descState}`);
    const phaseMatch = isAbsorbHeat ? getMatchBtn("out:phase_change", "phase transition") : "";
    const loopBtn = getLoopBtn(stream.resource, streamState, stream.rate, stream.unit, stream.tempC);
    outputLines.push(`
      <div class="stream-line">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, true, rateMode, elementMap)}</span>
        ${matchBtn}
        ${phaseMatch}
        ${loopBtn}
      </div>
    `);
  }
  if (evaluated.power > 0) {
    const powerMatch = getMatchBtn("out:Power", "power deficit");
    const powerLoop = getLoopBtn("Power", "free", evaluated.power, "W", undefined);
    outputLines.push(`
      <div class="stream-line">
        ${renderIcon(powerIcon, "Power", "stream-icon")}
        <span class="stream-text">Power: +${formatNumber(evaluated.power)} W</span>
        ${powerMatch}
        ${powerLoop}
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

/**
 * Render the "Loop Start" row at the very top of the table (hidden if no streams are looped).
 */
export function renderLoopStartRowHtml(loopStartStreams, elementMap, rateMode = "s") {
  if (!Array.isArray(loopStartStreams) || loopStartStreams.length === 0) return "";

  const outputLines = loopStartStreams.map((stream) => {
    const elem = elementMap?.get(stream.resource);
    const normState = stream.state || "free";
    return `
      <div class="stream-line">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, true, rateMode, elementMap)}</span>
        <button type="button" class="btn-loop-stream btn-unloop-stream" data-resource="${stream.resource}" data-state="${normState}" title="Remove ${stream.resource} from loop">[unloop]</button>
      </div>
    `;
  });

  return `
    <tr class="loop-row loop-start-row">
      <td class="col-machine" data-label="Machine">
        <div class="loop-badge-wrapper">
          <span class="loop-badge">Loop Start</span>
          <span class="loop-subtext">Fed from Loop End</span>
        </div>
      </td>
      <td class="col-inputs" data-label="Inputs"><span class="empty-stream">—</span></td>
      <td class="col-outputs" data-label="Outputs">${outputLines.join("")}</td>
    </tr>
  `;
}

/**
 * Render the "Loop End" row at the very bottom of the table (hidden if no streams are looped).
 */
export function renderLoopEndRowHtml(loopEndStreams, elementMap, rateMode = "s") {
  if (!Array.isArray(loopEndStreams) || loopEndStreams.length === 0) return "";

  const inputLines = loopEndStreams.map((stream) => {
    const elem = elementMap?.get(stream.resource);
    const normState = stream.state || "free";
    return `
      <div class="stream-line">
        ${renderIcon(elem?.icon, stream.resource, "stream-icon")}
        <span class="stream-text">${formatStreamLine(stream, false, rateMode, elementMap, { showTemp: true })}</span>
        <button type="button" class="btn-loop-stream btn-unloop-stream" data-resource="${stream.resource}" data-state="${normState}" title="Remove ${stream.resource} from loop">[unloop]</button>
      </div>
    `;
  });

  return `
    <tr class="loop-row loop-end-row">
      <td class="col-machine" data-label="Machine">
        <div class="loop-badge-wrapper">
          <span class="loop-badge">Loop End</span>
          <span class="loop-subtext">Sent to Loop Start</span>
        </div>
      </td>
      <td class="col-inputs" data-label="Inputs">${inputLines.join("")}</td>
      <td class="col-outputs" data-label="Outputs"><span class="empty-stream">—</span></td>
    </tr>
  `;
}
