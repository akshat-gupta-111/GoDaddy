/**
 * BLUE.Api — Backend-ready modular data layer backed by LocalStorage.
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,24}$/;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const CATEGORY_MAP = [
    { keys: ["bottle", "flask", "thermos", "tumbler"], category: "Drinkware" },
    { keys: ["id", "card", "pass", "badge"], category: "Identity" },
    { keys: ["earphone", "earbud", "headphone", "airpod", "buds"], category: "Audio" },
    { keys: ["laptop", "macbook", "notebook pc", "charger", "power bank", "usb", "cable", "phone", "mobile"], category: "Electronics" },
    { keys: ["bag", "backpack", "rucksack", "pouch", "satchel"], category: "Bags" },
    { keys: ["wallet", "purse", "key", "keys", "umbrella", "glasses"], category: "Accessories" },
    { keys: ["book", "notebook", "manual", "calculator", "notes"], category: "Academics" },
    { keys: ["watch", "smartwatch", "band"], category: "Wearables" },
  ];

  const LOCATION_COORDS = {
    "college library": { lat: 28.5450, lng: 77.1926 },
    "canteen": { lat: 28.5442, lng: 77.1912 },
    "classroom": { lat: 28.5461, lng: 77.1939 },
    "parking area": { lat: 28.5435, lng: 77.1918 },
    "playground": { lat: 28.5470, lng: 77.1908 },
    "hostel": { lat: 28.5474, lng: 77.1901 },
    "laboratory": { lat: 28.5464, lng: 77.1943 },
  };

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function inferCategory(itemName) {
    const lower = normalize(itemName);
    for (const rule of CATEGORY_MAP) {
      if (rule.keys.some((k) => lower.includes(k))) {
        return rule.category;
      }
    }
    return "Other";
  }

  function inferCoordinates(locationName) {
    const lower = normalize(locationName);
    for (const [k, coords] of Object.entries(LOCATION_COORDS)) {
      if (lower.includes(k)) return { ...coords };
    }
    return { lat: 28.5452, lng: 77.1924 };
  }

  function sanitizeUser(user) {
    if (!user) return null;
    const { password, ...safe } = user;
    return safe;
  }

  function validateUsernameAvailability(rawUsername, excludeUserId = null) {
    const trimmed = String(rawUsername || "").trim();
    if (!trimmed) {
      return { valid: false, available: false, reason: "Username is required." };
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      return {
        valid: false,
        available: false,
        reason: "Use 3–24 characters (letters, numbers, _, ., -).",
      };
    }

    const target = normalize(trimmed);
    const users = BLUE.Storage.getUsers();
    const conflict = users.find(
      (u) => normalize(u.username) === target && u.id !== excludeUserId
    );

    if (conflict) {
      return {
        valid: false,
        available: false,
        reason: `Username "${trimmed}" is already taken.`,
      };
    }

    return { valid: true, available: true, reason: "Username is available." };
  }

  function getCurrentUser() {
    const session = BLUE.Storage.getSession();
    if (!session || !session.userId) return null;
    const users = BLUE.Storage.getUsers();
    return sanitizeUser(users.find((u) => u.id === session.userId));
  }

  function login({ identifier, password, remember = true }) {
    const idNorm = normalize(identifier);
    if (!idNorm || !password) {
      return { ok: false, error: "Please enter both username/email and password." };
    }
    const users = BLUE.Storage.getUsers();
    const user = users.find(
      (u) => normalize(u.username) === idNorm || normalize(u.email) === idNorm
    );
    if (!user || user.password !== password) {
      return { ok: false, error: "Invalid username/email or password." };
    }
    BLUE.Storage.saveSession({ userId: user.id, loggedInAt: new Date().toISOString() }, remember);
    return { ok: true, user: sanitizeUser(user) };
  }

  function signup({ fullName, username, email, password }) {
    const nameClean = String(fullName || "").trim();
    const emailClean = String(email || "").trim();
    const usernameClean = String(username || "").trim();

    if (!nameClean) return { ok: false, error: "Full Name is required." };
    const usernameCheck = validateUsernameAvailability(usernameClean);
    if (!usernameCheck.available) return { ok: false, error: usernameCheck.reason };
    if (!EMAIL_REGEX.test(emailClean)) return { ok: false, error: "Please enter a valid email address." };
    if (!password || password.length < 6) {
      return { ok: false, error: "Password must be at least 6 characters." };
    }

    const users = BLUE.Storage.getUsers();
    if (users.find((u) => normalize(u.email) === normalize(emailClean))) {
      return { ok: false, error: "An account with this email already exists." };
    }

    const newUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      fullName: nameClean,
      username: usernameClean,
      email: emailClean,
      password,
      rollNumber: "",
      department: "",
      year: "",
      avatar: "",
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    BLUE.Storage.saveUsers(users);
    BLUE.Storage.saveSession({ userId: newUser.id, loggedInAt: new Date().toISOString() }, true);
    return { ok: true, user: sanitizeUser(newUser) };
  }

  function resetPassword({ identifier, newPassword }) {
    const idNorm = normalize(identifier);
    if (!idNorm) return { ok: false, error: "Enter your registered username or email." };
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: "New password must be at least 6 characters." };
    }
    const users = BLUE.Storage.getUsers();
    const idx = users.findIndex(
      (u) => normalize(u.username) === idNorm || normalize(u.email) === idNorm
    );
    if (idx === -1) return { ok: false, error: "No account found matching that username or email." };
    users[idx].password = newPassword;
    BLUE.Storage.saveUsers(users);
    return { ok: true };
  }

  function updateProfile(userId, updates) {
    const users = BLUE.Storage.getUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return { ok: false, error: "User account not found." };

    const nextUsername = String(updates.username || "").trim();
    const usernameCheck = validateUsernameAvailability(nextUsername, userId);
    if (!usernameCheck.available) return { ok: false, error: usernameCheck.reason };

    const prevUsername = users[idx].username;
    users[idx] = {
      ...users[idx],
      rollNumber: String(updates.rollNumber ?? users[idx].rollNumber).trim(),
      department: String(updates.department ?? users[idx].department).trim(),
      year: String(updates.year ?? users[idx].year).trim(),
      username: nextUsername,
      avatar: updates.avatar !== undefined ? updates.avatar : users[idx].avatar,
      updatedAt: new Date().toISOString(),
    };
    BLUE.Storage.saveUsers(users);

    if (prevUsername !== nextUsername) {
      const reports = BLUE.Storage.getReports().map((r) =>
        r.userId === userId ? { ...r, username: nextUsername } : r
      );
      BLUE.Storage.saveReports(reports);
    }

    return { ok: true, user: sanitizeUser(users[idx]) };
  }

  function logout() {
    BLUE.Storage.clearSession();
  }

  // ==================== Reports API ====================

  function generateNextReportId(type, existingReports) {
    const prefix = type === "lost" ? "L" : "F";
    let maxNum = 0;
    existingReports.forEach((r) => {
      if (r.type === type && typeof r.reportId === "string" && r.reportId.startsWith(prefix)) {
        const n = parseInt(r.reportId.slice(1), 10);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
      }
    });
    return `${prefix}${String(maxNum + 1).padStart(3, "0")}`;
  }

  function validateReportTiming(type, fromIso, toIso) {
    if (!fromIso) {
      return { ok: false, error: "From timestamp is mandatory." };
    }
    const fromMs = new Date(fromIso).getTime();
    if (Number.isNaN(fromMs)) {
      return { ok: false, error: "Invalid From date/time." };
    }

    if (type === "lost") {
      if (!toIso) {
        return { ok: false, error: "To timestamp is mandatory for Lost reports." };
      }
      const toMs = new Date(toIso).getTime();
      if (Number.isNaN(toMs) || toMs <= fromMs) {
        return { ok: false, error: "Lost To time must be strictly later than From time." };
      }
    } else if (type === "found" && toIso !== null && toIso !== undefined && toIso !== "") {
      const toMs = new Date(toIso).getTime();
      if (Number.isNaN(toMs) || toMs <= fromMs) {
        return { ok: false, error: "Found To time must be strictly later than From time." };
      }
    }

    return { ok: true };
  }

  function getReports(type = null) {
    const all = BLUE.Storage.getReports();
    const list = type ? all.filter((r) => r.type === type) : [...all];
    return list.sort((a, b) => {
      const numA = parseInt(String(a.reportId || "0").slice(1), 10) || 0;
      const numB = parseInt(String(b.reportId || "0").slice(1), 10) || 0;
      if (b.date !== a.date) return String(b.date).localeCompare(String(a.date));
      return numB - numA;
    });
  }

  function getReportById(reportId) {
    return BLUE.Storage.getReports().find((r) => r.reportId === reportId) || null;
  }

  function createReport(payload) {
    const type = payload.type === "found" ? "found" : "lost";
    const timingCheck = validateReportTiming(type, payload.from, payload.to);
    if (!timingCheck.ok) {
      return { ok: false, error: timingCheck.error };
    }

    const currentUser = getCurrentUser();
    const reports = BLUE.Storage.getReports();
    const reportId = generateNextReportId(type, reports);

    const newReport = {
      reportId,
      type,
      userId: currentUser ? currentUser.id : "guest_user",
      username: currentUser ? currentUser.username : "student_guest",
      item: String(payload.item || "").trim(),
      category: payload.category || inferCategory(payload.item),
      brand: String(payload.brand || "Unknown").trim() || "Unknown",
      colour: String(payload.colour || "").trim(),
      location: String(payload.location || "").trim(),
      coordinates: payload.coordinates || inferCoordinates(payload.location),
      date: payload.date,
      from: payload.from,
      to: type === "found" && !payload.to ? null : payload.to,
      description: String(payload.description || "").trim(),
      image: payload.image || null,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    reports.unshift(newReport);
    BLUE.Storage.saveReports(reports);
    return { ok: true, report: newReport };
  }

  function markReunited(reportIds = []) {
    const ids = new Set(reportIds.filter(Boolean));
    if (ids.size === 0) return [];
    const reports = BLUE.Storage.getReports().map((r) =>
      ids.has(r.reportId) ? { ...r, status: "reunited" } : r
    );
    BLUE.Storage.saveReports(reports);
    return reports.filter((r) => ids.has(r.reportId));
  }

  function toggleReportStatus(reportId) {
    const reports = BLUE.Storage.getReports().map((r) =>
      r.reportId === reportId
        ? { ...r, status: r.status === "active" ? "reunited" : "active" }
        : r
    );
    BLUE.Storage.saveReports(reports);
    return reports.find((r) => r.reportId === reportId) || null;
  }

  // ==================== Peer Chat API ====================

  function getChats() {
    return BLUE.Storage.getChats().sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  }

  function startOrOpenChat(matchedReport, sourceReport = null) {
    const chats = BLUE.Storage.getChats();
    const lostId =
      matchedReport.type === "lost"
        ? matchedReport.reportId
        : sourceReport?.type === "lost"
          ? sourceReport.reportId
          : null;
    const foundId =
      matchedReport.type === "found"
        ? matchedReport.reportId
        : sourceReport?.type === "found"
          ? sourceReport.reportId
          : null;

    const existing = chats.find(
      (c) =>
        (lostId && c.lostReportId === lostId && foundId && c.foundReportId === foundId) ||
        c.peerUsername === matchedReport.username && c.itemTitle.includes(matchedReport.item)
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const newChat = {
      chatId: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      peerUsername: matchedReport.username,
      itemTitle: `${matchedReport.item} (${matchedReport.brand} • ${matchedReport.colour})`,
      lostReportId: lostId,
      foundReportId: foundId,
      targetReportId: matchedReport.reportId,
      status: matchedReport.status === "reunited" ? "reunited" : "open",
      updatedAt: now,
      messages: [
        {
          id: `msg_${Date.now()}`,
          sender: "system",
          senderName: "BLUE Match",
          text: `Connected with @${matchedReport.username} regarding ${matchedReport.item} (${matchedReport.reportId}) at ${matchedReport.location}.`,
          timestamp: now,
        },
      ],
    };

    chats.unshift(newChat);
    BLUE.Storage.saveChats(chats);
    return newChat;
  }

  function appendChatMessage(chatId, sender, senderName, text) {
    const chats = BLUE.Storage.getChats();
    const idx = chats.findIndex((c) => c.chatId === chatId);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    chats[idx].messages.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      sender,
      senderName,
      text,
      timestamp: now,
    });
    chats[idx].updatedAt = now;
    BLUE.Storage.saveChats(chats);
    return chats[idx];
  }

  function closeChatAsReunited(chatId) {
    const chats = BLUE.Storage.getChats();
    const idx = chats.findIndex((c) => c.chatId === chatId);
    if (idx === -1) return null;
    const chat = chats[idx];
    chat.status = "reunited";
    chat.updatedAt = new Date().toISOString();
    chat.messages.push({
      id: `msg_${Date.now()}`,
      sender: "system",
      senderName: "BLUE",
      text: "Item marked as REUNITED! Status Dashboard analytics have been updated.",
      timestamp: chat.updatedAt,
    });
    BLUE.Storage.saveChats(chats);

    markReunited([chat.lostReportId, chat.foundReportId, chat.targetReportId]);
    return chat;
  }

  BLUE.Api = {
    EMAIL_REGEX,
    USERNAME_REGEX,
    inferCategory,
    validateUsernameAvailability,
    getCurrentUser,
    login,
    signup,
    resetPassword,
    updateProfile,
    logout,
    validateReportTiming,
    getReports,
    getReportById,
    createReport,
    markReunited,
    toggleReportStatus,
    getChats,
    startOrOpenChat,
    appendChatMessage,
    closeChatAsReunited,
  };
})(window);
