/**
 * BLUE.Storage — Shared LocalStorage persistence for users, 150+ reports, chats, and sessions
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  const KEYS = {
    USERS: "blue_users_v1",
    SESSION: "blue_session_v1",
    REPORTS: "blue_reports_v2",
    CHATS: "blue_chats_v2",
    SEEDED_V2: "blue_seeded_v2",
  };

  function safeRead(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.error("Storage read error:", err);
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error("Storage write error:", err);
      return false;
    }
  }

  function ensureSeeded() {
    if (!localStorage.getItem(KEYS.USERS)) {
      const seedUsers = [
        {
          id: "usr_suhani",
          fullName: "Suhani Sharma",
          username: "suhani",
          email: "suhani@campus.edu",
          password: "Password@123",
          rollNumber: "24CSE104",
          department: "Computer Science & Engineering",
          year: "3rd Year",
          avatar: "",
          createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        },
        {
          id: "usr_aarav",
          fullName: "Aarav Mehta",
          username: "aarav",
          email: "aarav@campus.edu",
          password: "Password@123",
          rollNumber: "24ECE042",
          department: "Electronics & Communication",
          year: "2nd Year",
          avatar: "",
          createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        },
      ];
      safeWrite(KEYS.USERS, seedUsers);
    }

    if (!localStorage.getItem(KEYS.SEEDED_V2)) {
      const sampleReports = Array.isArray(global.BLUE_SAMPLE_REPORTS)
        ? global.BLUE_SAMPLE_REPORTS
        : [];
      safeWrite(KEYS.REPORTS, sampleReports);

      const initialChats = [
        {
          chatId: "chat_demo_1",
          peerUsername: "student_13",
          itemTitle: "Water Bottle (Milton • Blue)",
          lostReportId: "L010",
          foundReportId: "F010",
          status: "open",
          updatedAt: new Date(Date.now() - 1800000).toISOString(),
          messages: [
            {
              id: "m1",
              sender: "peer",
              senderName: "@student_13",
              text: "Hi! I saw your match alert for the Milton Water Bottle near College Library. Does yours have a small sticker on the base?",
              timestamp: new Date(Date.now() - 1800000).toISOString(),
            },
          ],
        },
      ];
      safeWrite(KEYS.CHATS, initialChats);
      localStorage.setItem(KEYS.SEEDED_V2, "1");
    }
  }

  BLUE.Storage = {
    KEYS,
    ensureSeeded,
    getUsers: () => safeRead(KEYS.USERS, []),
    saveUsers: (users) => safeWrite(KEYS.USERS, users),
    getReports: () => safeRead(KEYS.REPORTS, []),
    saveReports: (reports) => safeWrite(KEYS.REPORTS, reports),
    getChats: () => safeRead(KEYS.CHATS, []),
    saveChats: (chats) => safeWrite(KEYS.CHATS, chats),
    getSession: () => {
      const persistent = safeRead(KEYS.SESSION, null);
      if (persistent) return persistent;
      try {
        const temp = sessionStorage.getItem(KEYS.SESSION);
        return temp ? JSON.parse(temp) : null;
      } catch {
        return null;
      }
    },
    saveSession: (session, remember = true) => {
      if (remember) {
        sessionStorage.removeItem(KEYS.SESSION);
        safeWrite(KEYS.SESSION, session);
      } else {
        localStorage.removeItem(KEYS.SESSION);
        try {
          sessionStorage.setItem(KEYS.SESSION, JSON.stringify(session));
        } catch (err) {
          console.error("Session write error:", err);
        }
      }
    },
    clearSession: () => {
      localStorage.removeItem(KEYS.SESSION);
      sessionStorage.removeItem(KEYS.SESSION);
    },
  };
})(window);
