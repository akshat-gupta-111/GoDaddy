/**
 * BLUE.Items — Manages the Lost & Found Chatbot Assistants, live report feeds,
 * search/filters, match explorer modal, and image compression helper.
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  const assistants = {};

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function colourToCss(colourText) {
    const c = String(colourText || "").toLowerCase();
    if (c.includes("black")) return "#111827";
    if (c.includes("navy")) return "#1e3a8a";
    if (c.includes("blue")) return "#2563eb";
    if (c.includes("white")) return "#f8fafc";
    if (c.includes("silver") || c.includes("grey") || c.includes("gray")) return "#94a3b8";
    if (c.includes("red")) return "#dc2626";
    if (c.includes("green")) return "#16a34a";
    if (c.includes("yellow") || c.includes("gold")) return "#eab308";
    if (c.includes("brown")) return "#92400e";
    return "#3b82f6";
  }

  function formatTimeWindow(report) {
    if (!report || !report.from) return report?.date || "N/A";
    const fmt = (iso) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };
    const fromTxt = fmt(report.from);
    if (report.to) {
      return `${report.date} (${fromTxt} – ${fmt(report.to)})`;
    }
    return `${report.date} (${fromTxt} • exact)`;
  }

  function readAndCompressImage(file, maxDim = 720) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Please upload a valid image file (PNG, JPG, WEBP)."));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error("Image must be 5 MB or smaller."));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Invalid image data."));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderMatchPanel(type, submittedReport, matches) {
    const panel = document.getElementById(`${type}-match-results-panel`);
    const title = document.getElementById(`${type}-match-title`);
    const list = document.getElementById(`${type}-match-list`);

    const oppositeLabel = type === "lost" ? "Found" : "Lost";
    title.textContent =
      matches.length > 0
        ? `${matches.length} Time-Eligible ${oppositeLabel} Match${matches.length > 1 ? "es" : ""} for "${submittedReport.item}" (${submittedReport.reportId})`
        : `No time-eligible ${oppositeLabel} matches yet for "${submittedReport.item}" (${submittedReport.reportId})`;

    list.innerHTML = "";
    if (matches.length === 0) {
      list.innerHTML = `<div class="muted-text">Your report is saved. Any future ${oppositeLabel.toLowerCase()} reports satisfying <code>Found.from &gt; Lost.to</code> will appear here automatically.</div>`;
    } else {
      matches.slice(0, 6).forEach(({ report, percentage, matchedAttributes }) => {
        const badgeClass = percentage >= 65 ? "high" : "medium";
        const card = document.createElement("div");
        card.className = "match-card";
        card.innerHTML = `
          <div class="match-card-top">
            <div style="display:flex;gap:0.65rem;align-items:center;">
              ${
                report.image
                  ? `<img src="${report.image}" alt="${escapeHtml(report.item)}" class="chat-match-thumb" />`
                  : `<div class="chat-match-thumb placeholder">${escapeHtml(report.item.slice(0, 2).toUpperCase())}</div>`
              }
              <div>
                <strong>${escapeHtml(report.item)} <small class="muted-text">(${report.reportId})</small></strong>
                <div class="muted-text" style="font-size:0.8rem">${escapeHtml(report.brand)} &bull; ${escapeHtml(report.colour)}</div>
              </div>
            </div>
            <span class="match-percent-badge ${badgeClass}">${percentage}% Match</span>
          </div>
          <div class="muted-text" style="font-size:0.81rem">
            📍 ${escapeHtml(report.location)} &bull; 🕒 ${escapeHtml(formatTimeWindow(report))}
          </div>
          <div class="match-reasons">
            ${matchedAttributes.map((r) => `<span class="reason-chip">${escapeHtml(r)}</span>`).join("")}
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-xs btn-primary start-chat-btn">Start Chat</button>
            <button type="button" class="btn btn-xs btn-secondary view-match-btn">Inspect</button>
          </div>
        `;
        card.querySelector(".start-chat-btn").addEventListener("click", () => {
          BLUE.ChatWindow.openWithMatch(report, submittedReport);
        });
        card.querySelector(".view-match-btn").addEventListener("click", () => {
          openReportModal(report);
        });
        list.appendChild(card);
      });
    }

    panel.hidden = false;
  }

  function openReportModal(report) {
    const modal = document.getElementById("item-modal");
    const typePill = document.getElementById("item-modal-type");
    const titleEl = document.getElementById("item-modal-title");
    const bodyEl = document.getElementById("item-modal-body");

    typePill.textContent = `${report.type.toUpperCase()} • ${report.reportId}`;
    typePill.className = `item-type-pill ${report.type}`;
    titleEl.textContent = report.item;

    const allReports = BLUE.Api.getReports();
    const matches = BLUE.Matching.findMatches(report, allReports, 40);
    const oppositeType = report.type === "lost" ? "found" : "lost";

    bodyEl.innerHTML = `
      <div class="item-modal-hero">
        <div>
          ${
            report.image
              ? `<img src="${report.image}" alt="${escapeHtml(report.item)}" />`
              : `<div class="item-card-media" style="border-radius:14px;height:210px;"><div class="item-no-photo">No Photo Provided</div></div>`
          }
        </div>
        <div class="item-modal-details">
          <div><strong>Report ID:</strong> ${escapeHtml(report.reportId)}</div>
          <div><strong>Category:</strong> ${escapeHtml(report.category || "Other")}</div>
          <div><strong>Brand:</strong> ${escapeHtml(report.brand)}</div>
          <div><strong>Colour:</strong> <span class="colour-dot" style="display:inline-block;background:${colourToCss(report.colour)}"></span> ${escapeHtml(report.colour)}</div>
          <div><strong>Location:</strong> ${escapeHtml(report.location)}</div>
          <div><strong>Time Window:</strong> ${escapeHtml(formatTimeWindow(report))}</div>
          <div><strong>Reported By:</strong> @${escapeHtml(report.username)}</div>
          <div><strong>Status:</strong> ${report.status === "reunited" ? "Reunited ✓" : "Active"}</div>
          <p style="margin-top:0.35rem;color:var(--text-secondary)">${escapeHtml(report.description)}</p>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.65rem;">
            <button type="button" class="btn btn-sm btn-primary" id="modal-start-chat-btn">Start Chat with @${escapeHtml(report.username)}</button>
            <button type="button" class="btn btn-sm btn-secondary" id="modal-toggle-status-btn">
              ${report.status === "active" ? "Mark as Reunited" : "Reopen Report"}
            </button>
          </div>
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:1rem;">
        <h4 style="margin-bottom:0.65rem;">Time-Eligible ${oppositeType.toUpperCase()} Matches (Found.from &gt; Lost.to)</h4>
        <div class="match-cards-grid" id="modal-matches-container"></div>
      </div>
    `;

    const matchesContainer = document.getElementById("modal-matches-container");
    if (matches.length === 0) {
      matchesContainer.innerHTML = `<p class="muted-text">No time-eligible ${oppositeType} items matched above threshold.</p>`;
    } else {
      matches.slice(0, 6).forEach(({ report: mRep, percentage, matchedAttributes }) => {
        const badgeClass = percentage >= 65 ? "high" : "medium";
        const mCard = document.createElement("div");
        mCard.className = "match-card";
        mCard.innerHTML = `
          <div class="match-card-top">
            <strong>${escapeHtml(mRep.item)} (${mRep.reportId})</strong>
            <span class="match-percent-badge ${badgeClass}">${percentage}% Match</span>
          </div>
          <div class="muted-text" style="font-size:0.8rem">${escapeHtml(mRep.brand)} &bull; ${escapeHtml(mRep.colour)} &bull; 📍 ${escapeHtml(mRep.location)}</div>
          <div class="match-reasons">
            ${matchedAttributes.map((r) => `<span class="reason-chip">${escapeHtml(r)}</span>`).join("")}
          </div>
          <button type="button" class="btn btn-xs btn-primary modal-match-chat-btn">Start Chat</button>
        `;
        mCard.querySelector(".modal-match-chat-btn").addEventListener("click", () => {
          modal.hidden = true;
          BLUE.ChatWindow.openWithMatch(mRep, report);
        });
        matchesContainer.appendChild(mCard);
      });
    }

    document.getElementById("modal-start-chat-btn").addEventListener("click", () => {
      modal.hidden = true;
      BLUE.ChatWindow.openWithMatch(report, null);
    });

    document.getElementById("modal-toggle-status-btn").addEventListener("click", () => {
      BLUE.Api.toggleReportStatus(report.reportId);
      modal.hidden = true;
      refreshAll();
      BLUE.Profile.render();
      BLUE.Dashboard.render();
      BLUE.Toast.success("Report status updated.");
    });

    modal.hidden = false;
  }

  function renderFeed(type) {
    const grid = document.getElementById(`${type}-items-grid`);
    if (!grid) return;

    const searchVal = (document.getElementById(`${type}-search-input`)?.value || "").trim().toLowerCase();
    const colourVal = (document.getElementById(`${type}-colour-filter`)?.value || "").toLowerCase();
    const statusVal = document.getElementById(`${type}-status-filter`)?.value || "all";

    const allTypeReports = BLUE.Api.getReports(type);
    const activeCount = allTypeReports.filter((r) => r.status === "active").length;
    document.getElementById(`${type}-total-badge`).textContent = String(activeCount);
    document.getElementById(`nav-${type}-count`).textContent = String(allTypeReports.length);

    const filtered = allTypeReports.filter((r) => {
      if (statusVal !== "all" && r.status !== statusVal) return false;
      if (colourVal && !String(r.colour || "").toLowerCase().includes(colourVal)) return false;
      if (searchVal) {
        const hay = `${r.reportId} ${r.item} ${r.category} ${r.brand} ${r.colour} ${r.location} ${r.description} ${r.username}`.toLowerCase();
        if (!hay.includes(searchVal)) return false;
      }
      return true;
    });

    const visible = filtered.slice(0, 24);
    grid.innerHTML = "";
    if (visible.length === 0) {
      grid.innerHTML = `<div class="empty-feed-card">
        <strong>No ${type} reports match your current filters.</strong>
        <p class="muted-text" style="margin-top:0.3rem;">Try adjusting the filters or chat with the ${type === "lost" ? "Lost" : "Found"} Assistant on the left.</p>
      </div>`;
      return;
    }

    const allReports = BLUE.Api.getReports();

    visible.forEach((report) => {
      const topMatch =
        report.status === "active" ? BLUE.Matching.findMatches(report, allReports, 45)[0] : null;
      const statusText = report.status === "reunited" ? "Reunited ✓" : "Active";

      const card = document.createElement("article");
      card.className = "item-card";
      card.innerHTML = `
        <div class="item-card-media">
          ${
            report.image
              ? `<img src="${report.image}" alt="${escapeHtml(report.item)}" loading="lazy" />`
              : `<div class="item-no-photo">
                   <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                     <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                     <circle cx="8.5" cy="8.5" r="1.5"/>
                     <polyline points="21 15 16 10 5 21"/>
                   </svg>
                   <span>${escapeHtml(report.category || report.item)}</span>
                 </div>`
          }
          <span class="item-type-pill ${type}">${report.reportId}</span>
          <span class="item-status-badge ${report.status}">${statusText}</span>
        </div>

        <div class="item-card-body">
          <h3 class="item-card-title">${escapeHtml(report.item)}</h3>
          <div class="item-meta-chips">
            <span class="meta-chip">${escapeHtml(report.brand)}</span>
            <span class="meta-chip">
              <span class="colour-dot" style="background:${colourToCss(report.colour)}"></span>
              ${escapeHtml(report.colour)}
            </span>
            ${
              topMatch
                ? `<span class="meta-chip" style="background:var(--success-bg);color:#047857;">${topMatch.percentage}% Match</span>`
                : ""
            }
          </div>
          <p class="item-desc">${escapeHtml(report.description)}</p>
          <div class="item-info-rows">
            <div class="item-info-row">📍 ${escapeHtml(report.location)}</div>
            <div class="item-info-row">🕒 ${escapeHtml(formatTimeWindow(report))}</div>
            <div class="item-info-row">👤 @${escapeHtml(report.username)}</div>
          </div>
        </div>

        <div class="item-card-footer">
          <button type="button" class="btn btn-xs btn-secondary inspect-btn">Matches &amp; Details</button>
          <button type="button" class="btn btn-xs btn-primary chat-btn">Start Chat</button>
        </div>
      `;

      card.querySelector(".inspect-btn").addEventListener("click", () => openReportModal(report));
      card.querySelector(".chat-btn").addEventListener("click", () => {
        BLUE.ChatWindow.openWithMatch(report, null);
      });

      grid.appendChild(card);
    });
  }

  const COLOUR_CHART = [
    { value: "", label: "All Colours", hex: "rainbow" },
    { value: "black", label: "Black", hex: "#111827" },
    { value: "matte black", label: "Matte Black", hex: "#1f2937" },
    { value: "blue", label: "Blue", hex: "#2563eb" },
    { value: "navy blue", label: "Navy Blue", hex: "#1e3a8a" },
    { value: "white", label: "White", hex: "#f8fafc" },
    { value: "silver", label: "Silver", hex: "#94a3b8" },
    { value: "grey", label: "Grey", hex: "#6b7280" },
    { value: "red", label: "Red", hex: "#dc2626" },
    { value: "green", label: "Green", hex: "#16a34a" },
    { value: "brown", label: "Brown", hex: "#92400e" },
    { value: "yellow", label: "Yellow", hex: "#eab308" },
  ];

  function setupColourChart(type) {
    const wrap = document.getElementById(`${type}-colour-chart`);
    const hiddenInput = document.getElementById(`${type}-colour-filter`);
    if (!wrap || !hiddenInput) return;

    const trigger = wrap.querySelector(".colour-chart-trigger");
    const triggerDot = wrap.querySelector(".colour-swatch-dot");
    const triggerLabel = wrap.querySelector(".colour-trigger-label");
    const popover = wrap.querySelector(".colour-chart-popover");

    popover.innerHTML = `
      <div class="colour-chart-title">Select Colour</div>
      <div class="colour-chart-grid">
        ${COLOUR_CHART.map(
          (c, idx) => `
          <button type="button" class="colour-chart-option ${idx === 0 ? "active" : ""}" data-value="${c.value}" data-label="${c.label}" data-hex="${c.hex}">
            <span class="colour-swatch-dot ${c.hex === "rainbow" ? "rainbow" : ""}" style="${c.hex === "rainbow" ? "" : `background:${c.hex}`}"></span>
            <span>${c.label}</span>
          </button>
        `
        ).join("")}
      </div>
    `;

    function closePopover() {
      popover.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = popover.hidden;
      document.querySelectorAll(".colour-chart-popover").forEach((p) => {
        p.hidden = true;
      });
      document.querySelectorAll(".colour-chart-trigger").forEach((t) => {
        t.setAttribute("aria-expanded", "false");
      });
      popover.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(willOpen));
    });

    popover.querySelectorAll(".colour-chart-option").forEach((optBtn) => {
      optBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const val = optBtn.dataset.value || "";
        const label = optBtn.dataset.label || "All Colours";
        const hex = optBtn.dataset.hex || "rainbow";

        hiddenInput.value = val;
        triggerLabel.textContent = label;
        if (hex === "rainbow") {
          triggerDot.className = "colour-swatch-dot rainbow";
          triggerDot.style.background = "";
        } else {
          triggerDot.className = "colour-swatch-dot";
          triggerDot.style.background = hex;
        }

        popover.querySelectorAll(".colour-chart-option").forEach((b) => {
          b.classList.toggle("active", b === optBtn);
        });
        closePopover();
        renderFeed(type);
      });
    });

    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) closePopover();
    });
  }

  function setupSection(type) {
    assistants[type] = BLUE.Chatbot.createAssistant({
      type,
      containerId: `${type}-chatbot-container`,
      onReportCreated: (report, matches) => {
        refreshAll();
        BLUE.Profile.render();
        BLUE.Dashboard.render();
        renderMatchPanel(type, report, matches);
      },
    });

    setupColourChart(type);

    document.getElementById(`${type}-close-matches-btn`).addEventListener("click", () => {
      document.getElementById(`${type}-match-results-panel`).hidden = true;
    });

    document.getElementById(`${type}-search-input`).addEventListener("input", () => renderFeed(type));
    document.getElementById(`${type}-status-filter`).addEventListener("change", () => renderFeed(type));
  }

  function refreshAll() {
    renderFeed("lost");
    renderFeed("found");
  }

  function init() {
    setupSection("lost");
    setupSection("found");
    refreshAll();
  }

  BLUE.Items = {
    init,
    refreshAll,
    openItemModal: openReportModal,
    readAndCompressImage,
    formatTimeWindow,
  };
})(window);
