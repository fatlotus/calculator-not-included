/**
 * Main application controller for ONI Resource Calculator.
 * Wires together the entity catalog, calculation engine, URL state sync, and UI rendering.
 */

import { buildEntityCatalog } from "./data_loader.js";
import {
  resolveTableTemperatures,
  calculateSystemNet,
  calculateRowMatchTargets,
  isSolidResource,
} from "./calculator.js";
import { PRESETS, getPresetById } from "./presets.js";
import { syncStateToUrl, loadStateFromUrl } from "./url_state.js";
import {
  renderTableRowHtml,
  renderLoopStartRowHtml,
  renderLoopEndRowHtml,
} from "./components/table_row.js";
import { renderNetSummaryRowHtml } from "./components/net_summary.js";
import { AutocompleteComponent } from "./components/autocomplete.js";

class OniApp {
  constructor() {
    this.catalog = buildEntityCatalog();
    this.state = {
      rateMode: "s",
      rows: [],
      netInputTemps: {},
      loops: [],
    };
    this.autocomplete = null;
    this.theme = localStorage.getItem("onimath_theme") || "auto";
  }

  init() {
    this.initTheme();
    this.initState();
    this.setupAutocomplete();
    this.bindHeaderControls();
    this.bindTableEvents();
    this.render();
  }

  initTheme() {
    this.applyTheme(this.theme);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (this.theme === "auto") this.applyTheme("auto");
    });
  }

  applyTheme(theme) {
    this.theme = theme;
    localStorage.setItem("onimath_theme", theme);
    const root = document.documentElement;
    if (theme === "dark" || theme === "light") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === theme);
    });
  }

  initState() {
    const hasUrlParam = typeof window !== "undefined" && window.location && new URLSearchParams(window.location.search).has("s");
    const urlState = loadStateFromUrl();
    if (urlState && (urlState.rows?.length > 0 || urlState.loops?.length > 0 || hasUrlParam)) {
      this.state = {
        rateMode: urlState.rateMode || "s",
        rows: urlState.rows || [],
        netInputTemps: urlState.netInputTemps || {},
        loops: urlState.loops || [],
      };
    } else {
      const def = PRESETS[0];
      this.state = {
        rateMode: def.rateMode || "s",
        rows: JSON.parse(JSON.stringify(def.rows)),
        netInputTemps: def.netInputTemps ? JSON.parse(JSON.stringify(def.netInputTemps)) : {},
        loops: def.loops ? JSON.parse(JSON.stringify(def.loops)) : [],
      };
    }
  }

  setupAutocomplete() {
    this.autocomplete = new AutocompleteComponent({
      entities: this.catalog.entities,
      elementMap: this.catalog.elementMap,
      onSelect: (entity) => {
        const recipeId = entity.recipes && entity.recipes.length > 0 ? entity.recipes[0].id : null;
        const defaultModifiers = entity.default_modifiers
          ? [...entity.default_modifiers]
          : [];
        const newRow = { entityId: entity.id, qty: 1, recipeId, modifiers: defaultModifiers };
        if (entity.id === "duplicant") {
          newRow.bathroom = "plumbed";
          newRow.food = "barbecue";
        } else if (entity.id === "absorb_heat") {
          newRow.material = "Water";
          newRow.materialState = "free";
        } else if (entity.id === "counterflow_heat_exchanger") {
          newRow.material = "Petroleum";
          newRow.materialState = "free";
          newRow.coldMaterial = "Crude Oil";
          newRow.coldMaterialState = "in a pipe";
        }
        this.state.rows.push(newRow);
        this.onStateChange();
      },
    });
  }

  bindHeaderControls() {
    const presetSelect = document.getElementById("preset-select");
    if (presetSelect) {
      presetSelect.innerHTML = `<option value="" disabled selected>Load a Preset...</option>` +
        PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
      presetSelect.addEventListener("change", (e) => {
        const preset = getPresetById(e.target.value);
        if (preset) {
          this.state.rateMode = preset.rateMode || "s";
          this.state.rows = JSON.parse(JSON.stringify(preset.rows));
          this.state.netInputTemps = preset.netInputTemps ? JSON.parse(JSON.stringify(preset.netInputTemps)) : {};
          this.state.loops = preset.loops ? JSON.parse(JSON.stringify(preset.loops)) : [];
          this.onStateChange();
          presetSelect.value = "";
        }
      });
    }

    document.querySelectorAll(".rate-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.state.rateMode = btn.dataset.mode;
        this.onStateChange();
      });
    });

    document.getElementById("copy-share-btn")?.addEventListener("click", (e) => {
      this.copyShareLink(e.currentTarget);
    });

    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.applyTheme(btn.dataset.theme));
    });
  }

  async copyShareLink(btn) {
    syncStateToUrl(this.state, this.catalog.elementMap);
    const url = window.location.href;
    const fallbackCopy = () => {
      const temp = document.createElement("input");
      temp.value = url;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
    };

    try {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          fallbackCopy();
        }
      } else {
        fallbackCopy();
      }
      this.showToast("Share link copied to clipboard!");
      btn.classList.add("btn-copied");
      const orig = btn.innerHTML;
      btn.innerHTML = `<span>✓ Copied!</span>`;
      setTimeout(() => {
        btn.classList.remove("btn-copied");
        btn.innerHTML = orig;
      }, 2000);
    } catch {
      this.showToast("Could not copy link to clipboard.");
    }
  }

  showToast(msg) {
    let toast = document.getElementById("app-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "app-toast";
      toast.className = "app-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 2500);
  }

  bindTableEvents() {
    const tbody = document.getElementById("calc-table-body");
    const tfoot = document.getElementById("calc-table-foot");

    if (tbody) {
      tbody.addEventListener("input", (e) => {
        if (e.target.classList.contains("qty-input")) {
          const idx = parseInt(e.target.dataset.rowIndex, 10);
          const val = parseFloat(e.target.value);
          if (!isNaN(val) && this.state.rows[idx]) {
            this.state.rows[idx].qty = Math.max(0, val);
            this.onStateChange(false);
          }
        }
        if (e.target.classList.contains("temp-delta-input")) {
          const idx = parseInt(e.target.dataset.rowIndex, 10);
          const val = parseFloat(e.target.value);
          if (!isNaN(val) && this.state.rows[idx]) {
            this.state.rows[idx].tempDelta = val;
            this.onStateChange(false);
          }
        }
        if (e.target.classList.contains("loop-temp-input")) {
          const key = e.target.dataset.key;
          const val = parseFloat(e.target.value);
          if (key && !isNaN(val)) {
            if (!this.state.netInputTemps) this.state.netInputTemps = {};
            this.state.netInputTemps[key] = val;
            this.onStateChange(false);
          }
        }
      });

      tbody.addEventListener("change", (e) => {
        if (e.target.classList.contains("loop-temp-input")) {
          const key = e.target.dataset.key;
          const val = parseFloat(e.target.value);
          if (key) {
            if (!this.state.netInputTemps) this.state.netInputTemps = {};
            if (isNaN(val)) {
              delete this.state.netInputTemps[key];
            } else {
              this.state.netInputTemps[key] = val;
            }
            this.onStateChange(true);
          }
          return;
        }

        const idx = parseInt(e.target.dataset.rowIndex, 10);
        const row = this.state.rows[idx];
        if (!row) return;

        if (e.target.classList.contains("qty-input")) {
          const val = parseFloat(e.target.value);
          row.qty = isNaN(val) ? 1 : Math.max(0, val);
          this.onStateChange(true);
        } else if (e.target.classList.contains("temp-delta-input")) {
          const val = parseFloat(e.target.value);
          row.tempDelta = isNaN(val) ? 10 : val;
          this.onStateChange(true);
        } else if (e.target.classList.contains("recipe-select")) {
          row.recipeId = e.target.value;
          this.onStateChange();
        } else if (e.target.classList.contains("bathroom-select")) {
          row.bathroom = e.target.value;
          this.onStateChange();
        } else if (e.target.classList.contains("food-select")) {
          row.food = e.target.value;
          this.onStateChange();
        } else if (e.target.classList.contains("mod-checkbox")) {
          const mods = new Set(row.modifiers || []);
          if (e.target.checked) mods.add(e.target.dataset.modId);
          else mods.delete(e.target.dataset.modId);
          row.modifiers = Array.from(mods);
          this.onStateChange();
        } else if (e.target.classList.contains("material-select")) {
          row.material = e.target.value;
          if (isSolidResource(row.material, this.catalog.elementMap)) {
            row.materialState = "free";
          }
          this.onStateChange();
        } else if (e.target.classList.contains("material-state-select")) {
          row.materialState = e.target.value;
          this.onStateChange();
        } else if (e.target.classList.contains("cold-material-select")) {
          row.coldMaterial = e.target.value;
          if (isSolidResource(row.coldMaterial, this.catalog.elementMap)) {
            row.coldMaterialState = "free";
          }
          this.onStateChange();
        } else if (e.target.classList.contains("cold-material-state-select")) {
          row.coldMaterialState = e.target.value;
          this.onStateChange();
        }
      });

      tbody.addEventListener("click", (e) => {
        const upBtn = e.target.closest(".btn-move-up");
        if (upBtn) {
          const idx = parseInt(upBtn.dataset.rowIndex, 10);
          if (!isNaN(idx) && idx > 0 && idx < this.state.rows.length) {
            const temp = this.state.rows[idx];
            this.state.rows[idx] = this.state.rows[idx - 1];
            this.state.rows[idx - 1] = temp;
            this.onStateChange(true);
          }
          return;
        }

        const downBtn = e.target.closest(".btn-move-down");
        if (downBtn) {
          const idx = parseInt(downBtn.dataset.rowIndex, 10);
          if (!isNaN(idx) && idx >= 0 && idx < this.state.rows.length - 1) {
            const temp = this.state.rows[idx];
            this.state.rows[idx] = this.state.rows[idx + 1];
            this.state.rows[idx + 1] = temp;
            this.onStateChange(true);
          }
          return;
        }

        const matchBtn = e.target.closest(".btn-match-stream");
        if (matchBtn) {
          const idx = parseInt(matchBtn.dataset.rowIndex, 10);
          const targetQty = parseFloat(matchBtn.dataset.targetQty);
          if (!isNaN(idx) && !isNaN(targetQty) && this.state.rows[idx]) {
            this.state.rows[idx].qty = targetQty;
            this.onStateChange();
          }
          return;
        }

        const matchHeatBtn = e.target.closest(".btn-match-heat");
        if (matchHeatBtn) {
          const idx = parseInt(matchHeatBtn.dataset.rowIndex, 10);
          const targetDelta = parseFloat(matchHeatBtn.dataset.targetDelta);
          if (!isNaN(idx) && !isNaN(targetDelta) && this.state.rows[idx]) {
            this.state.rows[idx].tempDelta = targetDelta;
            this.onStateChange();
          }
          return;
        }

        const delBtn = e.target.closest(".btn-delete-row");
        if (delBtn) {
          const idx = parseInt(delBtn.dataset.rowIndex, 10);
          if (!isNaN(idx) && idx >= 0 && idx < this.state.rows.length) {
            this.state.rows.splice(idx, 1);
            this.onStateChange();
          }
        }
      });

      // Drag and drop reordering
      let dragSrcIdx = null;

      tbody.addEventListener("dragstart", (e) => {
        const handle = e.target.closest(".row-drag-handle");
        if (!handle) return;
        const row = handle.closest(".calc-row");
        if (!row) return;
        dragSrcIdx = parseInt(row.dataset.rowIndex, 10);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragSrcIdx.toString());
        setTimeout(() => row.classList.add("dragging"), 0);
      });

      tbody.addEventListener("dragover", (e) => {
        const targetRow = e.target.closest(".calc-row");
        if (!targetRow || dragSrcIdx === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        const rect = targetRow.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          targetRow.classList.add("drag-over-above");
          targetRow.classList.remove("drag-over-below");
        } else {
          targetRow.classList.add("drag-over-below");
          targetRow.classList.remove("drag-over-above");
        }
      });

      tbody.addEventListener("dragleave", (e) => {
        const targetRow = e.target.closest(".calc-row");
        if (targetRow && (!e.relatedTarget || !targetRow.contains(e.relatedTarget))) {
          targetRow.classList.remove("drag-over-above", "drag-over-below");
        }
      });

      tbody.addEventListener("drop", (e) => {
        const targetRow = e.target.closest(".calc-row");
        if (!targetRow || dragSrcIdx === null) return;
        e.preventDefault();
        const targetIdx = parseInt(targetRow.dataset.rowIndex, 10);

        const rect = targetRow.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        let insertIdx = e.clientY < midY ? targetIdx : targetIdx + 1;
        if (dragSrcIdx < insertIdx) insertIdx--;

        if (insertIdx !== dragSrcIdx && insertIdx >= 0 && insertIdx <= this.state.rows.length) {
          const [moved] = this.state.rows.splice(dragSrcIdx, 1);
          this.state.rows.splice(insertIdx, 0, moved);
          this.onStateChange(true);
        }
      });

      tbody.addEventListener("dragend", () => {
        dragSrcIdx = null;
        tbody.querySelectorAll(".calc-row").forEach((r) => {
          r.classList.remove("dragging", "drag-over-above", "drag-over-below");
        });
      });
    }

    if (tfoot) {
      tfoot.addEventListener("input", (e) => {
        if (e.target.classList.contains("net-temp-input")) {
          const key = e.target.dataset.key;
          const val = parseFloat(e.target.value);
          if (!isNaN(val) && key) {
            if (!this.state.netInputTemps) this.state.netInputTemps = {};
            this.state.netInputTemps[key] = val;
            this.onStateChange(false);
          }
        }
      });

      tfoot.addEventListener("change", (e) => {
        if (e.target.classList.contains("net-temp-input")) {
          const key = e.target.dataset.key;
          const val = parseFloat(e.target.value);
          if (key) {
            if (!this.state.netInputTemps) this.state.netInputTemps = {};
            if (isNaN(val)) {
              delete this.state.netInputTemps[key];
            } else {
              this.state.netInputTemps[key] = val;
            }
            this.onStateChange(true);
          }
        }
      });

      tfoot.addEventListener("click", (e) => {
        const matchNetTempBtn = e.target.closest(".btn-match-net-temp");
        if (matchNetTempBtn) {
          const key = matchNetTempBtn.dataset.key;
          const targetTemp = parseFloat(matchNetTempBtn.dataset.targetTemp);
          if (key && !isNaN(targetTemp)) {
            if (!this.state.netInputTemps) this.state.netInputTemps = {};
            this.state.netInputTemps[key] = targetTemp;
            this.onStateChange(true);
          }
        }
      });
    }
  }

  onStateChange(fullReRender = true) {
    syncStateToUrl(this.state, this.catalog.elementMap);
    if (fullReRender) this.render();
    else this.renderQuickUpdate();
  }

  render() {
    document.querySelectorAll(".rate-mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === this.state.rateMode);
    });

    const tbody = document.getElementById("calc-table-body");
    if (!tbody) return;

    const evaluatedRows = resolveTableTemperatures(
      this.state.rows,
      this.catalog.entityMap,
      this.catalog.elementMap,
      {
        netInputTemps: this.state.netInputTemps,
        loops: this.state.loops,
      }
    );

    const net = calculateSystemNet(evaluatedRows, {
      elementMap: this.catalog.elementMap,
      netInputTemps: this.state.netInputTemps,
      loops: this.state.loops,
    });

    const loopStartHtml = renderLoopStartRowHtml(
      net.loopStartStreams,
      this.catalog.elementMap,
      this.state.rateMode
    );

    const machineRowsHtml = evaluatedRows
      .map((ev, i) => {
        const matches = calculateRowMatchTargets(i, this.state.rows, this.catalog.entityMap, {
          loops: this.state.loops,
          elementMap: this.catalog.elementMap,
          netInputTemps: this.state.netInputTemps,
          evaluatedRows,
        });
        return renderTableRowHtml(
          this.state.rows[i],
          ev,
          this.catalog.elementMap,
          this.state.rateMode,
          i,
          matches,
          evaluatedRows.length,
          this.state.loops
        );
      })
      .join("");

    const loopEndHtml = renderLoopEndRowHtml(
      net.loopEndStreams,
      this.catalog.elementMap,
      this.state.rateMode
    );

    tbody.innerHTML = loopStartHtml + machineRowsHtml;

    if (this.autocomplete) tbody.appendChild(this.autocomplete.render());

    if (loopEndHtml) {
      const dummy = document.createElement("tbody");
      dummy.innerHTML = loopEndHtml;
      if (dummy.firstElementChild) {
        tbody.appendChild(dummy.firstElementChild);
      }
    }

    const tfoot = document.getElementById("calc-table-foot");
    if (tfoot) {
      tfoot.innerHTML = renderNetSummaryRowHtml(
        net,
        this.catalog.elementMap,
        this.state.rateMode,
        this.state.netInputTemps
      );
    }
  }

  renderQuickUpdate() {
    const evaluatedRows = resolveTableTemperatures(
      this.state.rows,
      this.catalog.entityMap,
      this.catalog.elementMap,
      {
        netInputTemps: this.state.netInputTemps,
        loops: this.state.loops,
      }
    );

    const net = calculateSystemNet(evaluatedRows, {
      elementMap: this.catalog.elementMap,
      netInputTemps: this.state.netInputTemps,
      loops: this.state.loops,
    });

    const hasLoopStart = Boolean(document.querySelector(".loop-start-row"));
    const shouldHaveLoopStart = Boolean(net.loopStartStreams && net.loopStartStreams.length > 0);
    const hasLoopEnd = Boolean(document.querySelector(".loop-end-row"));
    const shouldHaveLoopEnd = Boolean(net.loopEndStreams && net.loopEndStreams.length > 0);
    if (hasLoopStart !== shouldHaveLoopStart || hasLoopEnd !== shouldHaveLoopEnd) {
      this.render();
      return;
    }

    const loopStartTr = document.querySelector(".loop-start-row");
    if (loopStartTr) {
      const activeEl = document.activeElement;
      const isLoopInput = activeEl?.classList?.contains("loop-temp-input");
      const focusedKey = isLoopInput ? activeEl.dataset.key : null;
      const selStart = isLoopInput ? activeEl.selectionStart : null;
      const selEnd = isLoopInput ? activeEl.selectionEnd : null;

      const dummy = document.createElement("tbody");
      dummy.innerHTML = renderLoopStartRowHtml(
        net.loopStartStreams,
        this.catalog.elementMap,
        this.state.rateMode
      );
      const newStartTr = dummy.firstElementChild;
      if (newStartTr) {
        loopStartTr.querySelector(".col-outputs").innerHTML = newStartTr.querySelector(".col-outputs").innerHTML;
        if (focusedKey) {
          const el = loopStartTr.querySelector(`.loop-temp-input[data-key="${CSS.escape(focusedKey)}"]`);
          if (el) {
            el.focus();
            if (selStart !== null && selEnd !== null) el.setSelectionRange(selStart, selEnd);
          }
        }
      }
    }

    const rows = document.querySelectorAll(".calc-row");
    rows.forEach((tr, i) => {
      const ev = evaluatedRows[i];
      if (!ev) return;
      const matches = calculateRowMatchTargets(i, this.state.rows, this.catalog.entityMap, {
        loops: this.state.loops,
        elementMap: this.catalog.elementMap,
        netInputTemps: this.state.netInputTemps,
        evaluatedRows,
      });
      const dummy = document.createElement("tbody");
      dummy.innerHTML = renderTableRowHtml(
        this.state.rows[i],
        ev,
        this.catalog.elementMap,
        this.state.rateMode,
        i,
        matches,
        evaluatedRows.length,
        this.state.loops
      );
      const newTr = dummy.firstElementChild;
      if (newTr) {
        tr.querySelector(".col-inputs").innerHTML = newTr.querySelector(".col-inputs").innerHTML;
        tr.querySelector(".col-outputs").innerHTML = newTr.querySelector(".col-outputs").innerHTML;
      }
    });

    const loopEndTr = document.querySelector(".loop-end-row");
    if (loopEndTr) {
      const dummy = document.createElement("tbody");
      dummy.innerHTML = renderLoopEndRowHtml(
        net.loopEndStreams,
        this.catalog.elementMap,
        this.state.rateMode
      );
      const newEndTr = dummy.firstElementChild;
      if (newEndTr) {
        loopEndTr.querySelector(".col-inputs").innerHTML = newEndTr.querySelector(".col-inputs").innerHTML;
      }
    }

    const tfoot = document.getElementById("calc-table-foot");
    if (tfoot) {
      const activeEl = document.activeElement;
      const isNetInput = activeEl?.classList?.contains("net-temp-input");
      const focusedKey = isNetInput ? activeEl.dataset.key : null;
      const selStart = isNetInput ? activeEl.selectionStart : null;
      const selEnd = isNetInput ? activeEl.selectionEnd : null;

      tfoot.innerHTML = renderNetSummaryRowHtml(
        net,
        this.catalog.elementMap,
        this.state.rateMode,
        this.state.netInputTemps
      );

      if (focusedKey) {
        const el = tfoot.querySelector(`.net-temp-input[data-key="${CSS.escape(focusedKey)}"]`);
        if (el) {
          el.focus();
          if (selStart !== null && selEnd !== null) el.setSelectionRange(selStart, selEnd);
        }
      }
    }
  }
}

function startApp() {
  const app = new OniApp();
  app.init();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
