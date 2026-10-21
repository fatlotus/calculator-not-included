/**
 * Main application controller for ONI Resource Calculator.
 * Wires together the entity catalog, calculation engine, URL state sync, and UI rendering.
 */

import { buildEntityCatalog } from "./data_loader.js";
import { evaluateRow, calculateSystemNet, calculateRowMatchTargets } from "./calculator.js";
import { PRESETS, getPresetById } from "./presets.js";
import { syncStateToUrl, loadStateFromUrl } from "./url_state.js";
import { renderTableRowHtml } from "./components/table_row.js";
import { renderNetSummaryRowHtml } from "./components/net_summary.js";
import { AutocompleteComponent } from "./components/autocomplete.js";

class OniApp {
  constructor() {
    this.catalog = buildEntityCatalog();
    this.state = { rateMode: "s", strictPipeMatching: true, rows: [] };
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
    const urlState = loadStateFromUrl();
    if (urlState && urlState.rows && urlState.rows.length > 0) {
      this.state = {
        rateMode: urlState.rateMode || "s",
        strictPipeMatching: urlState.strictPipeMatching !== false,
        rows: urlState.rows,
      };
    } else {
      const def = PRESETS[0];
      this.state = {
        rateMode: def.rateMode || "s",
        strictPipeMatching: def.strictPipeMatching !== false,
        rows: JSON.parse(JSON.stringify(def.rows)),
      };
    }
  }

  setupAutocomplete() {
    this.autocomplete = new AutocompleteComponent({
      entities: this.catalog.entities,
      elementMap: this.catalog.elementMap,
      onSelect: (entity) => {
        const recipeId = entity.recipes && entity.recipes.length > 0 ? entity.recipes[0].id : null;
        this.state.rows.push({ entityId: entity.id, qty: 1, recipeId, modifiers: [], inputTemp: 20 });
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
          this.state.strictPipeMatching = preset.strictPipeMatching !== false;
          this.state.rows = JSON.parse(JSON.stringify(preset.rows));
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

    const strictCheckbox = document.getElementById("strict-pipe-toggle");
    strictCheckbox?.addEventListener("change", (e) => {
      this.state.strictPipeMatching = e.target.checked;
      this.onStateChange();
    });

    document.getElementById("copy-share-btn")?.addEventListener("click", (e) => {
      this.copyShareLink(e.currentTarget);
    });

    document.querySelectorAll(".theme-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.applyTheme(btn.dataset.theme));
    });
  }

  async copyShareLink(btn) {
    syncStateToUrl(this.state);
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const temp = document.createElement("input");
        temp.value = url;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
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
    if (!tbody) return;

    tbody.addEventListener("input", (e) => {
      if (e.target.classList.contains("qty-input")) {
        const idx = parseInt(e.target.dataset.rowIndex, 10);
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && this.state.rows[idx]) {
          this.state.rows[idx].qty = Math.max(0, val);
          this.onStateChange(false);
        }
      } else if (e.target.classList.contains("input-temp-field")) {
        const idx = parseInt(e.target.dataset.rowIndex, 10);
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && this.state.rows[idx]) {
          this.state.rows[idx].inputTemp = val;
          this.onStateChange(false);
        }
      }
    });

    tbody.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.rowIndex, 10);
      const row = this.state.rows[idx];
      if (!row) return;

      if (e.target.classList.contains("qty-input")) {
        const val = parseFloat(e.target.value);
        row.qty = isNaN(val) ? 1 : Math.max(0, val);
        this.onStateChange(true);
      } else if (e.target.classList.contains("recipe-select")) {
        row.recipeId = e.target.value;
        this.onStateChange();
      } else if (e.target.classList.contains("mod-checkbox")) {
        const mods = new Set(row.modifiers || []);
        if (e.target.checked) mods.add(e.target.dataset.modId);
        else mods.delete(e.target.dataset.modId);
        row.modifiers = Array.from(mods);
        this.onStateChange();
      }
    });

    tbody.addEventListener("click", (e) => {
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

      const delBtn = e.target.closest(".btn-delete-row");
      if (delBtn) {
        const idx = parseInt(delBtn.dataset.rowIndex, 10);
        if (!isNaN(idx) && idx >= 0 && idx < this.state.rows.length) {
          this.state.rows.splice(idx, 1);
          this.onStateChange();
        }
        return;
      }

      const dupBtn = e.target.closest(".btn-duplicate-row");
      if (dupBtn) {
        const idx = parseInt(dupBtn.dataset.rowIndex, 10);
        if (!isNaN(idx) && idx >= 0 && idx < this.state.rows.length) {
          const rowToClone = this.state.rows[idx];
          const cloned = {
            entityId: rowToClone.entityId,
            qty: rowToClone.qty,
            recipeId: rowToClone.recipeId,
            inputTemp: rowToClone.inputTemp,
            modifiers: [...(rowToClone.modifiers || [])],
          };
          this.state.rows.splice(idx + 1, 0, cloned);
          this.onStateChange();
        }
      }
    });
  }

  onStateChange(fullReRender = true) {
    syncStateToUrl(this.state);
    if (fullReRender) this.render();
    else this.renderQuickUpdate();
  }

  render() {
    document.querySelectorAll(".rate-mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === this.state.rateMode);
    });

    const strictToggle = document.getElementById("strict-pipe-toggle");
    if (strictToggle) strictToggle.checked = this.state.strictPipeMatching;

    const tbody = document.getElementById("calc-table-body");
    if (!tbody) return;

    const evaluatedRows = this.state.rows.map((r) =>
      evaluateRow(r, this.catalog.entityMap, this.catalog.elementMap)
    );
    const net = calculateSystemNet(evaluatedRows, {
      strictPipeMatching: this.state.strictPipeMatching,
    });

    tbody.innerHTML = evaluatedRows
      .map((ev, i) => {
        const matches = calculateRowMatchTargets(i, this.state.rows, this.catalog.entityMap);
        return renderTableRowHtml(this.state.rows[i], ev, this.catalog.elementMap, this.state.rateMode, i, matches);
      })
      .join("");

    if (this.autocomplete) tbody.appendChild(this.autocomplete.render());

    const tfoot = document.getElementById("calc-table-foot");
    if (tfoot) {
      tfoot.innerHTML = renderNetSummaryRowHtml(net, this.catalog.elementMap, this.state.rateMode);
    }
  }

  renderQuickUpdate() {
    const evaluatedRows = this.state.rows.map((r) =>
      evaluateRow(r, this.catalog.entityMap, this.catalog.elementMap)
    );
    const net = calculateSystemNet(evaluatedRows, {
      strictPipeMatching: this.state.strictPipeMatching,
    });

    const rows = document.querySelectorAll(".calc-row");
    rows.forEach((tr, i) => {
      const ev = evaluatedRows[i];
      if (!ev) return;
      const matches = calculateRowMatchTargets(i, this.state.rows, this.catalog.entityMap);
      const dummy = document.createElement("tbody");
      dummy.innerHTML = renderTableRowHtml(this.state.rows[i], ev, this.catalog.elementMap, this.state.rateMode, i, matches);
      const newTr = dummy.firstElementChild;
      if (newTr) {
        tr.querySelector(".col-inputs").innerHTML = newTr.querySelector(".col-inputs").innerHTML;
        tr.querySelector(".col-outputs").innerHTML = newTr.querySelector(".col-outputs").innerHTML;
      }
    });

    const tfoot = document.getElementById("calc-table-foot");
    if (tfoot) {
      tfoot.innerHTML = renderNetSummaryRowHtml(net, this.catalog.elementMap, this.state.rateMode);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new OniApp();
  app.init();
});
