/**
 * Typeahead autocomplete search component for adding new machines / entities.
 */

import { searchEntities } from "../data_loader.js";
import { renderIcon } from "./table_row.js";

export class AutocompleteComponent {
  /**
   * @param {Object} options
   * @param {Array} options.entities - Catalog of all entities
   * @param {Map<string, Object>} options.elementMap - Resource lookup map
   * @param {Function} options.onSelect - Callback when an entity is picked: onSelect(entity)
   */
  constructor({ entities, elementMap, onSelect }) {
    this.entities = entities;
    this.elementMap = elementMap;
    this.onSelect = onSelect;

    this.isOpen = false;
    this.query = "";
    this.categoryFilter = "All";
    this.selectedIndex = 0;
    this.currentResults = [];

    this.container = null;
  }

  /**
   * Render initial DOM structure.
   */
  render() {
    const tr = document.createElement("tr");
    tr.className = "add-row-container";
    this.container = tr;
    this.update();
    return tr;
  }

  /**
   * Open the search panel and focus input.
   */
  open() {
    this.isOpen = true;
    this.query = "";
    this.categoryFilter = "All";
    this.selectedIndex = 0;
    this.update();

    requestAnimationFrame(() => {
      const input = this.container.querySelector(".autocomplete-input");
      if (input) input.focus();
    });
  }

  /**
   * Close the search panel.
   */
  close() {
    this.isOpen = false;
    this.update();
  }

  /**
   * Update the DOM representation.
   */
  update() {
    if (!this.container) return;

    if (!this.isOpen) {
      this.container.innerHTML = `
        <td colspan="3" class="col-add-trigger">
          <button type="button" class="btn-add-row" aria-label="Add a new machine or entity">
            <span class="add-icon">+</span>
            <span class="add-text">(click here to add a new one)</span>
          </button>
        </td>
      `;

      const btn = this.container.querySelector(".btn-add-row");
      btn?.addEventListener("click", () => this.open());
      return;
    }

    // Active autocomplete state
    this.currentResults = searchEntities(this.entities, this.query, this.categoryFilter).slice(0, 30);
    if (this.selectedIndex >= this.currentResults.length) {
      this.selectedIndex = Math.max(0, this.currentResults.length - 1);
    }

    const categories = ["All", "Machine", "Plant", "Critter", "Duplicant", "Geyser"];
    const pillsHtml = categories
      .map(
        (cat) => `
        <button
          type="button"
          class="cat-filter-btn ${this.categoryFilter === cat ? 'active' : ''}"
          data-category="${cat}"
        >${cat}</button>
      `
      )
      .join("");

    let resultsHtml = "";
    if (this.currentResults.length === 0) {
      resultsHtml = `<div class="autocomplete-empty">No entities found matching "${this.query}".</div>`;
    } else {
      resultsHtml = this.currentResults
        .map((ent, idx) => {
          const isSelected = idx === this.selectedIndex;
          const inputsPreview = (ent.inputs || [])
            .map((i) => i.resource)
            .slice(0, 2)
            .join(", ");
          const outputsPreview = (ent.outputs || [])
            .map((o) => o.resource)
            .slice(0, 2)
            .join(", ");

          let preview = "";
          if (inputsPreview && outputsPreview) {
            preview = `${inputsPreview} → ${outputsPreview}`;
          } else if (outputsPreview) {
            preview = `Produces: ${outputsPreview}`;
          } else if (inputsPreview) {
            preview = `Consumes: ${inputsPreview}`;
          }

          return `
            <div
              class="autocomplete-item ${isSelected ? 'selected' : ''}"
              data-index="${idx}"
              role="option"
              aria-selected="${isSelected}"
            >
              <div class="item-icon-wrapper">
                ${renderIcon(ent.icon, ent.name, "autocomplete-icon")}
              </div>
              <div class="item-info">
                <div class="item-title-row">
                  <span class="item-name">${ent.name}</span>
                  <span class="cat-pill cat-${(ent.category || 'machine').toLowerCase()}">${ent.category}</span>
                </div>
                ${preview ? `<div class="item-preview">${preview}</div>` : ""}
              </div>
            </div>
          `;
        })
        .join("");
    }

    this.container.innerHTML = `
      <td colspan="3" class="col-add-active">
        <div class="autocomplete-card">
          <div class="autocomplete-header">
            <div class="search-input-wrapper">
              <span class="search-icon" aria-hidden="true">🔍</span>
              <input
                type="text"
                class="autocomplete-input"
                placeholder="Type to search machines, plants, critters, duplicants, or resources..."
                value="${this.escapeHtml(this.query)}"
                autocomplete="off"
                spellcheck="false"
              />
              <button type="button" class="btn-close-autocomplete" title="Close (Esc)">✕</button>
            </div>
            <div class="cat-pills-bar">${pillsHtml}</div>
          </div>
          <div class="autocomplete-dropdown" role="listbox">
            ${resultsHtml}
          </div>
        </div>
      </td>
    `;

    this.bindEvents();
  }

  escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  bindEvents() {
    const input = this.container.querySelector(".autocomplete-input");
    const closeBtn = this.container.querySelector(".btn-close-autocomplete");
    const dropdown = this.container.querySelector(".autocomplete-dropdown");

    input?.addEventListener("input", (e) => {
      this.query = e.target.value;
      this.selectedIndex = 0;
      this.update();
      requestAnimationFrame(() => {
        const inp = this.container.querySelector(".autocomplete-input");
        if (inp) {
          inp.focus();
          inp.setSelectionRange(inp.value.length, inp.value.length);
        }
      });
    });

    input?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (this.currentResults.length > 0) {
          this.selectedIndex = (this.selectedIndex + 1) % this.currentResults.length;
          this.updateSelection();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this.currentResults.length > 0) {
          this.selectedIndex = (this.selectedIndex - 1 + this.currentResults.length) % this.currentResults.length;
          this.updateSelection();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (this.currentResults[this.selectedIndex]) {
          this.selectEntity(this.currentResults[this.selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    closeBtn?.addEventListener("click", () => this.close());

    // Category buttons
    this.container.querySelectorAll(".cat-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.categoryFilter = btn.dataset.category;
        this.selectedIndex = 0;
        this.update();
        const inp = this.container.querySelector(".autocomplete-input");
        inp?.focus();
      });
    });

    // Item click
    dropdown?.querySelectorAll(".autocomplete-item").forEach((itemEl) => {
      itemEl.addEventListener("click", () => {
        const idx = parseInt(itemEl.dataset.index, 10);
        if (this.currentResults[idx]) {
          this.selectEntity(this.currentResults[idx]);
        }
      });
    });
  }

  updateSelection() {
    const items = this.container.querySelectorAll(".autocomplete-item");
    items.forEach((el, idx) => {
      if (idx === this.selectedIndex) {
        el.classList.add("selected");
        el.setAttribute("aria-selected", "true");
        el.scrollIntoView({ block: "nearest" });
      } else {
        el.classList.remove("selected");
        el.setAttribute("aria-selected", "false");
      }
    });
  }

  selectEntity(entity) {
    if (this.onSelect) {
      this.onSelect(entity);
    }
    this.close();
  }
}
