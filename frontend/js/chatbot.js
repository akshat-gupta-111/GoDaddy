/**
 * BLUE.Chatbot — Conversational AI Reporting Assistants (Lost & Found)
 * Asks one question at a time, validates dates/times/errors conversationally,
 * supports editing any field, shows summary confirmation, saves report, and runs matching.
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function formatDisplayDate(isoDate) {
    if (!isoDate) return "";
    const parts = isoDate.split("-").map(Number);
    if (parts.length !== 3) return isoDate;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function formatDisplayTime(hhmm) {
    if (!hhmm) return "";
    const [hStr, mStr] = hhmm.split(":");
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr || "0", 10);
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${pad2(h)}:${pad2(m)} ${ampm}`;
  }

  function parseNaturalDate(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const lower = text.toLowerCase();

    const today = new Date("2026-11-25T12:00:00");
    if (lower === "today" || lower.startsWith("today (")) {
      return "2026-11-25";
    }
    if (lower === "yesterday") {
      const y = new Date(today.getTime() - 86400000);
      return `${y.getFullYear()}-${pad2(y.getMonth() + 1)}-${pad2(y.getDate())}`;
    }

    // YYYY-MM-DD
    let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
    }

    // DD/MM/YYYY or DD-MM-YYYY
    m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
    }

    // "25 Nov 2026" or "25 November 2026"
    m = lower.match(/^(\d{1,2})\s+([a-z]+)\s*,?\s*(\d{4})$/);
    if (m && MONTHS[m[2]]) {
      const d = Number(m[1]), mo = MONTHS[m[2]], y = Number(m[3]);
      if (d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
    }

    // "Nov 25 2026"
    m = lower.match(/^([a-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})$/);
    if (m && MONTHS[m[1]]) {
      const mo = MONTHS[m[1]], d = Number(m[2]), y = Number(m[3]);
      if (d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
    }

    return null;
  }

  function parseNaturalTime(raw, baseHHMM = null) {
    const text = String(raw || "").trim().toLowerCase();
    if (!text) return null;

    if (baseHHMM && (text === "+30 mins" || text === "+30 min")) {
      const [bh, bm] = baseHHMM.split(":").map(Number);
      const total = Math.min(23 * 60 + 59, bh * 60 + bm + 30);
      return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
    }
    if (baseHHMM && (text === "+1 hour" || text === "+1 hr")) {
      const [bh, bm] = baseHHMM.split(":").map(Number);
      const total = Math.min(23 * 60 + 59, bh * 60 + bm + 60);
      return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
    }
    if (baseHHMM && (text === "+2 hours" || text === "+2 hrs")) {
      const [bh, bm] = baseHHMM.split(":").map(Number);
      const total = Math.min(23 * 60 + 59, bh * 60 + bm + 120);
      return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
    }

    if (text === "noon") return "12:00";
    if (text === "midnight") return "00:00";

    const m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;

    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ampm = m[3] ? m[3].toLowerCase() : null;

    if (min < 0 || min > 59) return null;
    if (ampm) {
      if (h < 1 || h > 12) return null;
      if (ampm === "pm" && h !== 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    } else if (h < 0 || h > 23) {
      return null;
    }

    return `${pad2(h)}:${pad2(min)}`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function buildSteps(type) {
    const isLost = type === "lost";
    return [
      {
        key: "item",
        prompt: isLost ? "What item have you lost?" : "What item did you find?",
        quickReplies: [
          "Water Bottle", "Mobile Phone", "Laptop", "ID Card",
          "Wallet", "Bag", "Books", "Earphones", "Other",
        ],
      },
      {
        key: "brand",
        prompt: isLost ? "What is the brand of the item?" : "Do you know its brand?",
        quickReplies: ["I don't know", "Milton", "Apple", "Samsung", "Sony", "boAt", "Wildcraft", "Casio"],
      },
      {
        key: "colour",
        prompt: isLost ? "What colour is your item?" : "What is its colour?",
        quickReplies: ["Black", "Blue", "White", "Silver", "Navy Blue", "Red", "Green", "Brown"],
      },
      {
        key: "location",
        prompt: isLost ? "Where did you last see or use your item?" : "Where did you find it?",
        quickReplies: [
          "College Library", "Canteen", "Classroom", "Parking Area",
          "Playground", "Hostel", "Laboratory",
        ],
      },
      {
        key: "date",
        prompt: isLost ? "On which date did you last see your item?" : "On which date did you find it?",
        inputType: "date",
        quickReplies: ["Today (2026-11-25)", "Yesterday"],
      },
      {
        key: "from",
        prompt: isLost
          ? "Between what times could you have lost it?\nFrom: What is the earliest possible time?"
          : "At what time did you find it?\nFrom: Please share the discovery / start time (mandatory).",
        inputType: "time",
        quickReplies: ["09:00 AM", "10:00 AM", "12:00 PM", "02:00 PM", "04:00 PM", "06:00 PM"],
      },
      {
        key: "to",
        prompt: isLost
          ? "To: What is the latest possible time? (Must be later than From)"
          : "To: Optional end time if it was a time window, or select Exact Time to leave To empty (NULL).",
        inputType: "time",
        quickReplies: isLost
          ? ["+1 hour", "+2 hours", "06:00 PM", "09:00 PM"]
          : ["Exact time (Leave To NULL)", "+30 mins", "+1 hour"],
      },
      {
        key: "description",
        prompt: isLost
          ? "Can you describe your item in more detail? (e.g. stickers, scratches, cap colour, pouch)"
          : "Can you describe the item? (distinctive marks, condition, or where it's kept)",
        quickReplies: [],
      },
      {
        key: "image",
        prompt: isLost
          ? "Do you have an image of your lost item? (Optional)"
          : "Would you like to upload an image? (Optional)",
        inputType: "image",
        quickReplies: ["Upload Image", "Skip (No Image)"],
      },
    ];
  }

  function createAssistant(config) {
    const { type, containerId, onReportCreated } = config;
    const root = document.getElementById(containerId);
    if (!root) return null;

    const steps = buildSteps(type);
    const assistantTitle = type === "lost" ? "BLUE Lost Assistant" : "BLUE Found Assistant";
    const greeting =
      type === "lost"
        ? "Hi! Welcome to BLUE. I'm here to help you find your lost belongings. Let's start with a few quick questions."
        : "Great! You're helping someone recover their belongings. Let me collect some details about the item you found.";

    let state = {};

    root.innerHTML = `
      <div class="chatbot-card card">
        <div class="chatbot-header">
          <div class="chatbot-identity">
            <div class="bot-avatar" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a4 4 0 0 1 4 4v1h2a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a2 2 0 0 1 2-2h2V6a4 4 0 0 1 4-4Z"/>
                <circle cx="9.5" cy="13" r="1.2" fill="currentColor"/>
                <circle cx="14.5" cy="13" r="1.2" fill="currentColor"/>
              </svg>
            </div>
            <div class="bot-identity-text">
              <div class="bot-title-row">
                <h3>${assistantTitle}</h3>
                <span class="bot-status-pill"><span class="online-dot"></span> Online</span>
              </div>
              <p class="bot-subtitle">AI Reporter &bull; 1 question at a time</p>
            </div>
          </div>
          <div class="chatbot-controls">
            <button type="button" class="btn btn-xs bot-header-btn bot-back-btn" title="Go back to previous question">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 12H5"/>
                <path d="m12 19-7-7 7-7"/>
              </svg>
              <span>Back</span>
            </button>
            <button type="button" class="btn btn-xs bot-header-btn bot-restart-btn" title="Restart conversation">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              <span>Restart</span>
            </button>
          </div>
        </div>

        <div class="chatbot-progress-wrap">
          <div class="progress-meta">
            <span class="progress-label">Step 1 of ${steps.length}</span>
            <span class="progress-percent">0%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: 11%"></div>
          </div>
        </div>

        <div class="chat-messages" aria-live="polite"></div>

        <div class="chat-quick-replies"></div>

        <form class="chat-composer" novalidate>
          <input type="file" class="chat-file-input" accept="image/*" hidden />
          <input type="date" class="chat-date-helper" hidden aria-label="Date picker" />
          <input type="time" class="chat-time-helper" hidden aria-label="Time picker" />
          <button type="button" class="icon-btn chat-attach-btn" title="Upload optional image" hidden>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <input type="text" class="chat-text-input" placeholder="Type your answer here..." autocomplete="off" />
          <button type="submit" class="btn btn-primary btn-sm chat-send-btn">
            Send
          </button>
        </form>
      </div>
    `;

    const messagesEl = root.querySelector(".chat-messages");
    const quickRepliesEl = root.querySelector(".chat-quick-replies");
    const formEl = root.querySelector(".chat-composer");
    const textInput = root.querySelector(".chat-text-input");
    const fileInput = root.querySelector(".chat-file-input");
    const attachBtn = root.querySelector(".chat-attach-btn");
    const dateHelper = root.querySelector(".chat-date-helper");
    const timeHelper = root.querySelector(".chat-time-helper");
    const progressLabel = root.querySelector(".progress-label");
    const progressPercent = root.querySelector(".progress-percent");
    const progressFill = root.querySelector(".progress-fill");
    const backBtn = root.querySelector(".bot-back-btn");
    const restartBtn = root.querySelector(".bot-restart-btn");

    let typingTimer = null;

    function nowTime() {
      return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function scrollBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function updateProgress() {
      const total = steps.length;
      const doneCount =
        state.phase === "confirm" || state.phase === "done"
          ? total
          : Math.min(state.stepIndex, total);
      const pct = Math.round((doneCount / total) * 100);
      if (state.phase === "confirm") {
        progressLabel.textContent = "Review & Confirm";
      } else if (state.phase === "done") {
        progressLabel.textContent = "Report Submitted";
      } else {
        progressLabel.textContent = `Step ${state.stepIndex + 1} of ${total}`;
      }
      progressPercent.textContent = `${pct}%`;
      progressFill.style.width = `${Math.max(8, pct)}%`;
      backBtn.disabled = state.stepIndex === 0 && state.phase === "asking";
    }

    function addBubble(sender, text, extraHtml = "") {
      const row = document.createElement("div");
      row.className = `chat-bubble-row ${sender}`;
      const avatarHtml =
        sender === "bot"
          ? `<div class="msg-avatar">B</div>`
          : "";
      row.innerHTML = `
        ${avatarHtml}
        <div class="chat-bubble ${sender}">
          <div class="bubble-text">${escapeHtml(text).replace(/\n/g, "<br>")}</div>
          ${extraHtml}
          <span class="bubble-time">${nowTime()}</span>
        </div>
      `;
      messagesEl.appendChild(row);
      scrollBottom();
      return row;
    }

    function showTypingThen(fn, delay = 360) {
      clearTimeout(typingTimer);
      const typingRow = document.createElement("div");
      typingRow.className = "chat-bubble-row bot typing-row";
      typingRow.innerHTML = `
        <div class="msg-avatar">B</div>
        <div class="chat-bubble bot typing-bubble">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      `;
      messagesEl.appendChild(typingRow);
      scrollBottom();

      typingTimer = setTimeout(() => {
        typingRow.remove();
        fn();
      }, delay);
    }

    const COLOUR_CHIP_HEX = {
      black: "#111827",
      blue: "#2563eb",
      white: "#f8fafc",
      silver: "#94a3b8",
      "navy blue": "#1e3a8a",
      red: "#dc2626",
      green: "#16a34a",
      brown: "#92400e",
    };

    function renderQuickReplies(options = []) {
      quickRepliesEl.innerHTML = "";
      options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "quick-reply-chip";
        const chipHex = COLOUR_CHIP_HEX[String(opt).toLowerCase()];
        if (chipHex) {
          btn.innerHTML = `<span class="colour-swatch-dot" style="background:${chipHex}"></span><span>${escapeHtml(opt)}</span>`;
        } else {
          btn.textContent = opt;
        }
        btn.addEventListener("click", () => {
          if (opt === "Upload Image") {
            fileInput.click();
            return;
          }
          handleUserInput(opt);
        });
        quickRepliesEl.appendChild(btn);
      });
    }

    function syncInputHelpers(step) {
      dateHelper.hidden = true;
      timeHelper.hidden = true;
      attachBtn.hidden = true;

      if (!step) return;
      if (step.inputType === "date") {
        dateHelper.hidden = false;
        dateHelper.value = state.data.date || "2026-11-25";
      } else if (step.inputType === "time") {
        timeHelper.hidden = false;
        timeHelper.value = "";
      } else if (step.inputType === "image") {
        attachBtn.hidden = false;
      }
    }

    function askCurrentStep() {
      state.phase = "asking";
      const step = steps[state.stepIndex];
      updateProgress();
      syncInputHelpers(step);
      showTypingThen(() => {
        addBubble("bot", step.prompt);
        renderQuickReplies(step.quickReplies);
        textInput.focus();
      }, 280);
    }

    function buildSummaryHtml() {
      const d = state.data;
      const fromDisp = formatDisplayTime(d.fromTime);
      const toDisp = d.toTime ? formatDisplayTime(d.toTime) : null;
      const timeLine =
        type === "lost"
          ? `${fromDisp} – ${toDisp}`
          : toDisp
            ? `${fromDisp} – ${toDisp}`
            : `${fromDisp} (Exact time)`;

      return `
        <div class="summary-card">
          <div class="summary-title">${type === "lost" ? "LOST ITEM SUMMARY" : "FOUND ITEM SUMMARY"}</div>
          <div class="summary-grid">
            <div><span>Item</span><strong>${escapeHtml(d.item)}</strong></div>
            <div><span>Brand</span><strong>${escapeHtml(d.brand)}</strong></div>
            <div><span>Colour</span><strong>${escapeHtml(d.colour)}</strong></div>
            <div><span>Location</span><strong>${escapeHtml(d.location)}</strong></div>
            <div><span>Date</span><strong>${escapeHtml(formatDisplayDate(d.date))}</strong></div>
            <div><span>${type === "lost" ? "Lost Between" : "Found Time"}</span><strong>${escapeHtml(timeLine)}</strong></div>
          </div>
          <div class="summary-desc"><span>Description:</span> ${escapeHtml(d.description)}</div>
          <div class="summary-img-row">
            <span>Image:</span> ${
              d.image
                ? `<img src="${d.image}" alt="Uploaded item" class="summary-thumb" />`
                : `<em>Optional (None uploaded)</em>`
            }
          </div>
        </div>
      `;
    }

    function showSummary() {
      state.phase = "confirm";
      state.editingField = null;
      updateProgress();
      syncInputHelpers(null);

      showTypingThen(() => {
        addBubble("bot", "Here are the details I collected. Are these correct?", buildSummaryHtml());
        renderQuickReplies(["Confirm Report", "Edit Details"]);
      }, 320);
    }

    function showEditFieldSelector() {
      state.phase = "choose_edit";
      const fieldChips = [
        "Edit Item", "Edit Brand", "Edit Colour", "Edit Location",
        "Edit Date", "Edit From Time", "Edit To Time", "Edit Description", "Edit Image",
      ];
      addBubble("bot", "Which detail would you like to change?");
      renderQuickReplies(fieldChips);
    }

    function confirmAndSaveReport() {
      const d = state.data;
      const fromIso = `${d.date}T${d.fromTime}:00`;
      const toIso = d.toTime ? `${d.date}T${d.toTime}:00` : null;

      const res = BLUE.Api.createReport({
        type,
        item: d.item,
        brand: d.brand,
        colour: d.colour,
        location: d.location,
        date: d.date,
        from: fromIso,
        to: toIso,
        description: d.description,
        image: d.image || null,
      });

      if (!res.ok) {
        addBubble("bot", `Oops — ${res.error} Please edit the time details.`);
        showEditFieldSelector();
        return;
      }

      state.phase = "done";
      updateProgress();
      renderQuickReplies(["Report Another Item"]);
      BLUE.Toast.success(`Report ${res.report.reportId} saved!`);

      const allReports = BLUE.Api.getReports();
      const matches = BLUE.Matching.findMatches(res.report, allReports, 40);

      let matchesHtml = "";
      if (matches.length > 0) {
        matchesHtml = `
          <div class="chat-matches-wrap">
            <div class="chat-matches-heading">
              Found ${matches.length} time-eligible match${matches.length > 1 ? "es" : ""} (Found.from &gt; Lost.to):
            </div>
            ${matches
              .slice(0, 4)
              .map(
                ({ report, percentage, matchedAttributes }) => `
              <div class="chat-match-item">
                <div class="chat-match-top">
                  ${
                    report.image
                      ? `<img src="${report.image}" alt="${escapeHtml(report.item)}" class="chat-match-thumb" />`
                      : `<div class="chat-match-thumb placeholder">${escapeHtml(report.item.slice(0, 2).toUpperCase())}</div>`
                  }
                  <div class="chat-match-meta">
                    <strong>${escapeHtml(report.item)} (${report.reportId})</strong>
                    <span>${escapeHtml(report.brand)} &bull; ${escapeHtml(report.colour)} &bull; 📍 ${escapeHtml(report.location)}</span>
                    <div class="match-reasons">${matchedAttributes.map((a) => `<span class="reason-chip">${escapeHtml(a)}</span>`).join("")}</div>
                  </div>
                  <span class="match-percent-badge ${percentage >= 65 ? "high" : "medium"}">${percentage}%</span>
                </div>
                <button type="button" class="btn btn-xs btn-primary start-chat-match-btn" data-target-id="${report.reportId}" data-source-id="${res.report.reportId}">
                  Start Chat with @${escapeHtml(report.username)}
                </button>
              </div>
            `
              )
              .join("")}
          </div>
        `;
      }

      showTypingThen(() => {
        const msg =
          matches.length > 0
            ? `Report ${res.report.reportId} has been saved! I automatically checked eligible ${type === "lost" ? "Found" : "Lost"} reports (verifying Found.from > Lost.to) and discovered ${matches.length} potential match${matches.length > 1 ? "es" : ""}:`
            : `Report ${res.report.reportId} has been saved! No time-eligible matches met the threshold yet, but your report is live and will match future reports automatically.`;
        const row = addBubble("bot", msg, matchesHtml);

        row.querySelectorAll(".start-chat-match-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            const target = BLUE.Api.getReportById(btn.dataset.targetId);
            const source = BLUE.Api.getReportById(btn.dataset.sourceId);
            if (target) BLUE.ChatWindow.openWithMatch(target, source);
          });
        });

        if (typeof onReportCreated === "function") {
          onReportCreated(res.report, matches);
        }
      }, 360);
    }

    function processAnswerForKey(key, raw) {
      const text = String(raw || "").trim();

      if (key === "item") {
        if (!text) return { error: "Please tell me what item this is." };
        if (text.toLowerCase() === "other") {
          state.awaitingCustomItem = true;
          return { subPrompt: "Sure! Please type the exact name of the item." };
        }
        state.awaitingCustomItem = false;
        state.data.item = text;
        return { ok: true };
      }

      if (key === "brand") {
        if (!text) return { error: "Please enter a brand name or choose \"I don't know\"." };
        state.data.brand = text.toLowerCase() === "i don't know" ? "Unknown" : text;
        return { ok: true };
      }

      if (key === "colour") {
        if (!text) return { error: "Please share the colour of the item." };
        state.data.colour = text;
        return { ok: true };
      }

      if (key === "location") {
        if (!text) return { error: "Please tell me the campus location or type a custom spot." };
        state.data.location = text;
        return { ok: true };
      }

      if (key === "date") {
        const parsed = parseNaturalDate(text);
        if (!parsed) {
          return {
            error:
              "I couldn't recognize that date. Try formats like 2026-11-25, 25 Nov 2026, Today, or use the calendar picker.",
          };
        }
        state.data.date = parsed;
        return { ok: true };
      }

      if (key === "from") {
        const parsed = parseNaturalTime(text);
        if (!parsed) {
          return {
            error: "Please enter a valid time like 10:00 AM, 14:30, or pick one from the suggestions.",
          };
        }
        state.data.fromTime = parsed;
        // If re-editing From and existing To is now invalid, clear or warn
        if (state.data.toTime) {
          const fMs = new Date(`${state.data.date}T${parsed}:00`).getTime();
          const tMs = new Date(`${state.data.date}T${state.data.toTime}:00`).getTime();
          if (tMs <= fMs) {
            state.data.toTime = null;
          }
        }
        return { ok: true };
      }

      if (key === "to") {
        const lower = text.toLowerCase();
        if (
          type === "found" &&
          (lower.includes("exact") || lower === "skip" || lower === "null" || lower === "none")
        ) {
          state.data.toTime = null;
          return { ok: true };
        }

        const parsed = parseNaturalTime(text, state.data.fromTime);
        if (!parsed) {
          return {
            error:
              type === "lost"
                ? "Please enter a valid end time (e.g. 12:00 PM or +1 hour)."
                : "Please enter a valid end time, or tap \"Exact time (Leave To NULL)\".",
          };
        }

        const fromMs = new Date(`${state.data.date}T${state.data.fromTime}:00`).getTime();
        const toMs = new Date(`${state.data.date}T${parsed}:00`).getTime();
        if (toMs <= fromMs) {
          return {
            error: `The "To" time (${formatDisplayTime(parsed)}) must be strictly later than "From" (${formatDisplayTime(state.data.fromTime)}). Please enter a later time.`,
          };
        }
        state.data.toTime = parsed;
        return { ok: true };
      }

      if (key === "description") {
        if (text.length < 3) {
          return { error: "Please write a short description (at least 3 characters) to help identify the item." };
        }
        state.data.description = text;
        return { ok: true };
      }

      if (key === "image") {
        const lower = text.toLowerCase();
        if (lower.includes("skip") || lower === "no" || lower === "none") {
          state.data.image = null;
          return { ok: true };
        }
        return { error: "Tap \"Upload Image\" to attach a photo, or choose \"Skip (No Image)\"." };
      }

      return { ok: true };
    }

    function handleUserInput(rawText) {
      const text = String(rawText || "").trim();
      if (!text) {
        addBubble("bot", "Please type an answer or choose one of the quick options below.");
        return;
      }

      addBubble("user", text);
      textInput.value = "";
      const lower = text.toLowerCase();

      // Global conversational navigation commands
      if (lower === "cancel" || lower === "restart" || lower === "start over" || lower === "report another item") {
        startConversation();
        return;
      }

      if (lower === "back" || lower === "go back" || lower === "previous") {
        if (state.phase === "asking" && state.stepIndex > 0) {
          state.stepIndex -= 1;
          askCurrentStep();
        } else if (state.phase === "confirm" || state.phase === "choose_edit") {
          state.stepIndex = steps.length - 1;
          askCurrentStep();
        } else {
          addBubble("bot", "We're at the first question already!");
        }
        return;
      }

      if (state.phase === "done") {
        startConversation();
        return;
      }

      if (state.phase === "confirm") {
        if (lower.includes("confirm")) {
          confirmAndSaveReport();
        } else if (lower.includes("edit")) {
          showEditFieldSelector();
        } else {
          addBubble("bot", "Please choose \"Confirm Report\" to submit, or \"Edit Details\" to update any field.");
        }
        return;
      }

      if (state.phase === "choose_edit") {
        const mapEdit = {
          "edit item": "item",
          "edit brand": "brand",
          "edit colour": "colour",
          "edit location": "location",
          "edit date": "date",
          "edit from time": "from",
          "edit to time": "to",
          "edit description": "description",
          "edit image": "image",
        };
        const targetKey = mapEdit[lower];
        if (!targetKey) {
          addBubble("bot", "Tap one of the field buttons below to edit that answer.");
          return;
        }
        state.editingField = targetKey;
        const idx = steps.findIndex((s) => s.key === targetKey);
        state.stepIndex = idx;
        state.phase = "editing_single";
        const step = steps[idx];
        syncInputHelpers(step);
        showTypingThen(() => {
          addBubble("bot", step.prompt);
          renderQuickReplies(step.quickReplies);
        }, 240);
        return;
      }

      const currentStep = steps[state.stepIndex];
      const result = processAnswerForKey(currentStep.key, text);

      if (result.error) {
        showTypingThen(() => {
          addBubble("bot", result.error);
        }, 220);
        return;
      }

      if (result.subPrompt) {
        showTypingThen(() => {
          addBubble("bot", result.subPrompt);
          renderQuickReplies([]);
        }, 220);
        return;
      }

      if (state.phase === "editing_single") {
        // If user edited From and Lost To became null, prompt To next before summary
        if (state.editingField === "from" && type === "lost" && !state.data.toTime) {
          state.stepIndex = steps.findIndex((s) => s.key === "to");
          state.editingField = "to";
          syncInputHelpers(steps[state.stepIndex]);
          showTypingThen(() => {
            addBubble("bot", "Since From time changed, please enter an updated To time later than From.");
            renderQuickReplies(steps[state.stepIndex].quickReplies);
          }, 240);
          return;
        }
        showSummary();
        return;
      }

      // Advance to next question
      state.stepIndex += 1;
      if (state.stepIndex < steps.length) {
        askCurrentStep();
      } else {
        showSummary();
      }
    }

    function startConversation() {
      clearTimeout(typingTimer);
      state = {
        stepIndex: 0,
        phase: "asking",
        editingField: null,
        awaitingCustomItem: false,
        data: {
          item: "",
          brand: "",
          colour: "",
          location: "",
          date: "",
          fromTime: "",
          toTime: null,
          description: "",
          image: null,
        },
      };

      messagesEl.innerHTML = "";
      renderQuickReplies([]);
      updateProgress();
      syncInputHelpers(steps[0]);

      addBubble("bot", greeting);
      askCurrentStep();
    }

    formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      handleUserInput(textInput.value);
    });

    dateHelper.addEventListener("change", () => {
      if (dateHelper.value) handleUserInput(dateHelper.value);
    });

    timeHelper.addEventListener("change", () => {
      if (timeHelper.value) handleUserInput(formatDisplayTime(timeHelper.value));
    });

    attachBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const dataUrl = await BLUE.Items.readAndCompressImage(file, 640);
        state.data.image = dataUrl;
        addBubble("user", `Uploaded image: ${file.name}`, `<img src="${dataUrl}" alt="Uploaded preview" class="chat-upload-thumb" />`);
        if (state.phase === "editing_single") {
          showSummary();
        } else {
          state.stepIndex += 1;
          if (state.stepIndex < steps.length) askCurrentStep();
          else showSummary();
        }
      } catch (err) {
        BLUE.Toast.error(err.message || "Could not process image.");
      }
    });

    backBtn.addEventListener("click", () => {
      if (state.stepIndex > 0 || state.phase !== "asking") {
        handleUserInput("back");
      }
    });

    restartBtn.addEventListener("click", () => {
      startConversation();
      BLUE.Toast.info("Conversation restarted.");
    });

    startConversation();

    return {
      restart: startConversation,
    };
  }

  BLUE.Chatbot = {
    createAssistant,
    parseNaturalDate,
    parseNaturalTime,
  };
})(window);
