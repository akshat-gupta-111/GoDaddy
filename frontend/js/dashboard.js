/**
 * BLUE.Dashboard — Status Dashboard & Real-Time Dataset Analytics
 * Computes Top 3 Most-Lost Items, Top 3 Campus Hotspots, Potential Matches,
 * Reunited Items, and full 150+ Reports Explorer directly from stored reports.
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function rankCounts(items, keyFn) {
    const map = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  function renderBarList(containerId, ranked, totalBase, barClass = "blue") {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (ranked.length === 0) {
      el.innerHTML = `<p class="muted-text">No data available.</p>`;
      return;
    }

    const maxCount = ranked[0].count || 1;
    el.innerHTML = ranked
      .map((entry, idx) => {
        const widthPct = Math.round((entry.count / maxCount) * 100);
        const sharePct = totalBase ? Math.round((entry.count / totalBase) * 100) : 0;
        return `
          <div class="analytics-bar-row">
            <div class="analytics-bar-top">
              <span class="rank-pill">#${idx + 1}</span>
              <strong class="analytics-label">${escapeHtml(entry.label)}</strong>
              <span class="analytics-val">${entry.count} reports (${sharePct}%)</span>
            </div>
            <div class="analytics-track">
              <div class="analytics-fill ${barClass}" style="width:${widthPct}%"></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderReportsTable(allReports) {
    const tbody = document.getElementById("dashboard-reports-tbody");
    const search = (document.getElementById("dash-search-input")?.value || "").trim().toLowerCase();
    const typeFilter = document.getElementById("dash-type-filter")?.value || "all";
    const statusFilter = document.getElementById("dash-status-filter")?.value || "all";
    const countLabel = document.getElementById("dash-table-count");

    const filtered = allReports.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const hay = `${r.reportId} ${r.item} ${r.category} ${r.brand} ${r.colour} ${r.location} ${r.username}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (countLabel) {
      countLabel.textContent = `Showing ${filtered.length} of ${allReports.length} reports`;
    }

    if (!tbody) return;
    tbody.innerHTML = "";
    filtered.slice(0, 60).forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(r.reportId)}</strong></td>
        <td><span class="item-type-pill ${r.type}">${r.type}</span></td>
        <td>${escapeHtml(r.item)}</td>
        <td>${escapeHtml(r.brand)}</td>
        <td>${escapeHtml(r.colour)}</td>
        <td>${escapeHtml(r.location)}</td>
        <td>${escapeHtml(BLUE.Items.formatTimeWindow(r))}</td>
        <td><span class="thread-status ${r.status === "reunited" ? "reunited" : "open"}">${r.status}</span></td>
      `;
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => BLUE.Items.openItemModal(r));
      tbody.appendChild(tr);
    });
  }

  function computeAnalytics(allReports) {
    const lost = allReports.filter((r) => r.type === "lost");
    const found = allReports.filter((r) => r.type === "found");
    const reunited = allReports.filter((r) => r.status === "reunited");

    const top3LostItems = rankCounts(lost, (r) => r.item).slice(0, 3);
    const top3LostLocations = rankCounts(lost, (r) => r.location).slice(0, 3);
    const topFoundItems = rankCounts(found, (r) => r.item).slice(0, 3);
    const topActiveLocations = rankCounts(allReports, (r) => r.location).slice(0, 3);
    const topCategories = rankCounts(allReports, (r) => r.category).slice(0, 5);
    const potentialMatches = BLUE.Matching.countDatasetPotentialMatches(allReports, 60);

    return {
      totalReports: allReports.length,
      totalLost: lost.length,
      totalFound: found.length,
      totalReunited: reunited.length,
      potentialMatches,
      top3LostItems,
      top3LostLocations,
      topFoundItems,
      topActiveLocations,
      topCategories,
    };
  }

  function render() {
    const allReports = BLUE.Api.getReports();
    const stats = computeAnalytics(allReports);

    document.getElementById("dash-total-reports").textContent = String(stats.totalReports);
    document.getElementById("dash-total-lost").textContent = String(stats.totalLost);
    document.getElementById("dash-total-found").textContent = String(stats.totalFound);
    document.getElementById("dash-potential-matches").textContent = String(stats.potentialMatches);
    document.getElementById("dash-reunited-count").textContent = String(stats.totalReunited);

    const topFoundText = stats.topFoundItems[0]
      ? `${stats.topFoundItems[0].label} (${stats.topFoundItems[0].count})`
      : "—";
    const topLocText = stats.topActiveLocations[0]
      ? `${stats.topActiveLocations[0].label} (${stats.topActiveLocations[0].count})`
      : "—";
    document.getElementById("dash-top-found-item").textContent = topFoundText;
    document.getElementById("dash-top-active-loc").textContent = topLocText;

    renderBarList("dash-top3-lost-items", stats.top3LostItems, stats.totalLost, "blue");
    renderBarList("dash-top3-hotspots", stats.top3LostLocations, stats.totalLost, "sky");
    renderBarList("dash-top-found-list", stats.topFoundItems, stats.totalFound, "emerald");
    renderBarList("dash-top-locations-list", stats.topActiveLocations, stats.totalReports, "indigo");
    renderBarList("dash-categories-list", stats.topCategories, stats.totalReports, "blue");

    renderReportsTable(allReports);
  }

  function init() {
    ["dash-search-input", "dash-type-filter", "dash-status-filter"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener(id === "dash-search-input" ? "input" : "change", render);
      }
    });
    render();
  }

  BLUE.Dashboard = {
    init,
    render,
    computeAnalytics,
  };
})(window);
