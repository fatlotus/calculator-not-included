/**
 * Main application controller for ONI Resource Calculator.
 * Wires together the entity catalog, calculation engine, URL state sync, and UI rendering.
 */

import { buildEntityCatalog } from "./data_loader.js";
import {
  resolveTableTemperatures,
  calculateSystemNet,
  calculateRowMatchTargets,
} from "./calculator.js";
import { PRESETS, getPresetById } from "./presets.js";
import { syncStateToUrl, loadStateFromUrl } from "./url_state.js";
import { renderTableRowHtml } from "./components/table_row.js";
import { renderNetSummaryRowHtml } from "./components/net_summary.js";
import { AutocompleteComponent } from "./components/autocomplete.js";

class OniApp {
  constructor() {
    this.catalog = buildEntityCatalog();
    this.state = {
      rateMode: "s",
      strictPipeMatching: true,
      rows: [],
      netInputTemps: {},
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
    const urlState = loadStateFromUrl();
    if (urlState && urlState.rows && urlState.rows.length > 0) {
      this.state = {
        rateMode: urlState.rateMode || "s",
        rows: urlState.rows,
        netInputTemps: urlState.netInputTemps || {},
      };
    } else {
      const def = PRESETS[0];
      this.state = {
        rateMode: def.rateMode || "s",
        rows: JSON.parse(JSON.stringify(def.rows)),
        netInputTemps: def.netInputTemps ? JSON.parse(JSON.stringify(def.netInputTemps)) : {},
      };
    }
  }

  setupAutocomplete() {
    this.autocomplete = new AutocompleteComponent({
      entities: this.catalog.entities,
      elementMap: this.catalog.elementMap,
      onSelect: (entity) => {
        const recipeId = entity.recipes && entity.recipes.length > 0 ? entity.recipes[0].id : null;
        const newRow = { entityId: entity.id, qty: 1, recipeId, modifiers: [] };
        if (entity.id === "duplicant") {
          newRow.bathroom = "plumbed";
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
        } else if (e.target.classList.contains("bathroom-select")) {
          row.bathroom = e.target.value;
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
        }
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
      }
    );

    const net = calculateSystemNet(evaluatedRows, {
      elementMap: this.catalog.elementMap,
      netInputTemps: this.state.netInputTemps,
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
      }
    );

    const net = calculateSystemNet(evaluatedRows, {
      elementMap: this.catalog.elementMap,
      netInputTemps: this.state.netInputTemps,
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

document.addEventListener("DOMContentLoaded", () => {
  const app = new OniApp();
  app.init();
});
