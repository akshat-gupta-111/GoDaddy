/**
 * BLUE.ChatWindow — Interactive Peer-to-Peer BLUE Chat Window
 * Connects matched Lost & Found users and lets them mark items as Reunited.
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  let activeChatId = null;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function updateBadge() {
    const badge = document.getElementById("nav-chat-count");
    if (badge) {
      const openCount = BLUE.Api.getChats().filter((c) => c.status === "open").length;
      badge.textContent = String(openCount);
    }
  }

  function renderThreads() {
    const listEl = document.getElementById("chat-threads-list");
    const chats = BLUE.Api.getChats();
    updateBadge();

    if (!activeChatId && chats.length > 0) {
      activeChatId = chats[0].chatId;
    }

    listEl.innerHTML = "";
    if (chats.length === 0) {
      listEl.innerHTML = `<div class="muted-text" style="padding:1rem;">No active conversations yet. Click "Start Chat" on any match!</div>`;
      return;
    }

    chats.forEach((chat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `chat-thread-item ${chat.chatId === activeChatId ? "active" : ""}`;
      btn.innerHTML = `
        <div class="thread-top">
          <strong>@${escapeHtml(chat.peerUsername)}</strong>
          <span class="thread-status ${chat.status}">${chat.status === "reunited" ? "Reunited ✓" : "Active"}</span>
        </div>
        <div class="thread-item-title">${escapeHtml(chat.itemTitle)}</div>
      `;
      btn.addEventListener("click", () => {
        activeChatId = chat.chatId;
        renderThreads();
        renderActiveChat();
      });
      listEl.appendChild(btn);
    });
  }

  function renderActiveChat() {
    const headerPeer = document.getElementById("chat-win-peer");
    const headerItem = document.getElementById("chat-win-item");
    const msgsEl = document.getElementById("chat-win-messages");
    const reuniteBtn = document.getElementById("chat-reunite-btn");
    const inputEl = document.getElementById("chat-win-input");

    const chats = BLUE.Api.getChats();
    const chat = chats.find((c) => c.chatId === activeChatId);

    if (!chat) {
      headerPeer.textContent = "Select a conversation";
      headerItem.textContent = "Click Start Chat on any match card to message a student.";
      msgsEl.innerHTML = "";
      reuniteBtn.disabled = true;
      return;
    }

    headerPeer.textContent = `@${chat.peerUsername}`;
    headerItem.textContent = `${chat.itemTitle} ${chat.lostReportId ? `• ${chat.lostReportId}` : ""} ${chat.foundReportId ? `• ${chat.foundReportId}` : ""}`;
    reuniteBtn.disabled = chat.status === "reunited";
    reuniteBtn.textContent = chat.status === "reunited" ? "Reunited ✓" : "Mark as Reunited";

    msgsEl.innerHTML = "";
    chat.messages.forEach((m) => {
      const row = document.createElement("div");
      const cls = m.sender === "me" ? "user" : m.sender === "system" ? "system" : "bot";
      row.className = `chat-bubble-row ${cls}`;
      const timeStr = new Date(m.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      if (m.sender === "system") {
        row.innerHTML = `<div class="chat-system-note">${escapeHtml(m.text)}</div>`;
      } else {
        row.innerHTML = `
          ${cls === "bot" ? `<div class="msg-avatar">${escapeHtml(chat.peerUsername.slice(0, 1).toUpperCase())}</div>` : ""}
          <div class="chat-bubble ${cls}">
            <div class="bubble-text">${escapeHtml(m.text)}</div>
            <span class="bubble-time">${escapeHtml(m.senderName)} &bull; ${timeStr}</span>
          </div>
        `;
      }
      msgsEl.appendChild(row);
    });

    msgsEl.scrollTop = msgsEl.scrollHeight;
    inputEl.focus();
  }

  function openModal() {
    const modal = document.getElementById("chat-window-modal");
    renderThreads();
    renderActiveChat();
    modal.hidden = false;
  }

  function openWithMatch(targetReport, sourceReport = null) {
    const chat = BLUE.Api.startOrOpenChat(targetReport, sourceReport);
    activeChatId = chat.chatId;
    openModal();
    BLUE.Toast.info(`Chat opened with @${targetReport.username}`);
  }

  function init() {
    updateBadge();

    const openBtn = document.getElementById("nav-open-chat-btn");
    if (openBtn) {
      openBtn.addEventListener("click", openModal);
    }

    document.getElementById("chat-win-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!activeChatId) return;
      const inputEl = document.getElementById("chat-win-input");
      const text = inputEl.value.trim();
      if (!text) return;

      const user = BLUE.Api.getCurrentUser();
      const myName = user ? `@${user.username}` : "@you";
      BLUE.Api.appendChatMessage(activeChatId, "me", myName, text);
      inputEl.value = "";
      renderActiveChat();

      // Realistic automated peer acknowledgement for demo flow
      const currentChatId = activeChatId;
      setTimeout(() => {
        const chats = BLUE.Api.getChats();
        const c = chats.find((x) => x.chatId === currentChatId);
        if (!c || c.status === "reunited") return;
        BLUE.Api.appendChatMessage(
          currentChatId,
          "peer",
          `@${c.peerUsername}`,
          "Thanks for reaching out! We can meet at the Central Security / Library Help Desk today to verify and hand over the item."
        );
        if (activeChatId === currentChatId && !document.getElementById("chat-window-modal").hidden) {
          renderActiveChat();
        }
      }, 650);
    });

    document.getElementById("chat-reunite-btn").addEventListener("click", () => {
      if (!activeChatId) return;
      BLUE.Api.closeChatAsReunited(activeChatId);
      renderThreads();
      renderActiveChat();
      BLUE.Items.refreshAll();
      BLUE.Profile.render();
      BLUE.Dashboard.render();
      BLUE.Toast.success("Item marked as Reunited! Dashboard updated.");
    });
  }

  BLUE.ChatWindow = {
    init,
    openModal,
    openWithMatch,
    updateBadge,
  };
})(window);
