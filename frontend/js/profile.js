/**
 * BLUE.Profile — Student Profile view/edit, unique username check, avatar upload & logout
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  let isEditing = false;

  function setEditMode(editing) {
    isEditing = editing;
    const rollInput = document.getElementById("profile-roll");
    const deptInput = document.getElementById("profile-department");
    const yearSelect = document.getElementById("profile-year");
    const usernameInput = document.getElementById("profile-username");
    const editActions = document.getElementById("profile-edit-actions");
    const editBtn = document.getElementById("edit-profile-btn");
    const modeBadge = document.getElementById("profile-mode-badge");

    rollInput.disabled = !editing;
    deptInput.disabled = !editing;
    yearSelect.disabled = !editing;
    usernameInput.disabled = !editing;

    editActions.hidden = !editing;
    editBtn.hidden = editing;
    modeBadge.textContent = editing ? "Editing Profile" : "View Mode";
    modeBadge.classList.toggle("editing", editing);

    if (!editing) {
      usernameInput.classList.remove("is-valid", "is-invalid");
      document.getElementById("profile-username-icon").textContent = "";
      document.getElementById("profile-username-msg").textContent = "";
    }
  }

  function renderAvatar(user) {
    const img = document.getElementById("profile-avatar-img");
    const fallback = document.getElementById("profile-avatar-fallback");
    const actions = document.getElementById("profile-avatar-actions");

    if (user.avatar) {
      img.src = user.avatar;
      img.hidden = false;
      fallback.hidden = true;
      actions.hidden = false;
    } else {
      img.hidden = true;
      fallback.hidden = false;
      fallback.textContent = (user.fullName || user.username || "U").charAt(0).toUpperCase();
      actions.hidden = true;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function renderMyReports(user) {
    const all = BLUE.Api.getReports();
    const myLost = all.filter((r) => r.type === "lost" && r.userId === user.id);
    const myFound = all.filter((r) => r.type === "found" && r.userId === user.id);

    document.getElementById("profile-lost-count").textContent = String(myLost.length);
    document.getElementById("profile-found-count").textContent = String(myFound.length);

    const listEl = document.getElementById("profile-my-reports");
    const combined = [...myLost, ...myFound];

    if (combined.length === 0) {
      listEl.innerHTML = `<p class="muted-text">You haven't reported any Lost or Found items yet. Start a chat with BLUE Lost or Found Assistant!</p>`;
      return;
    }

    listEl.innerHTML = "";
    combined.forEach((report) => {
      const row = document.createElement("div");
      row.className = "my-report-row";
      row.innerHTML = `
        <div>
          <div class="my-report-title">${escapeHtml(report.item)} <small class="muted-text">(${report.reportId})</small></div>
          <div class="my-report-sub">${escapeHtml(report.location)} &bull; ${escapeHtml(report.date)}</div>
        </div>
        <span class="item-type-pill ${report.type}">${report.status === "reunited" ? "Reunited" : report.type}</span>
      `;
      row.addEventListener("click", () => {
        BLUE.Items.openItemModal(report);
      });
      listEl.appendChild(row);
    });
  }

  function render() {
    const user = BLUE.Api.getCurrentUser();
    const guestEl = document.getElementById("profile-guest-state");
    const contentEl = document.getElementById("profile-content");

    if (!user) {
      guestEl.hidden = false;
      contentEl.hidden = true;
      return;
    }

    guestEl.hidden = true;
    contentEl.hidden = false;

    document.getElementById("profile-heading").textContent = user.fullName || user.username;
    document.getElementById("profile-username-badge").textContent = `@${user.username}`;
    const metaParts = [
      user.department || "Department not set",
      user.year || "Year not set",
      user.rollNumber ? `Roll: ${user.rollNumber}` : "Roll No. not set",
    ];
    document.getElementById("profile-meta-line").textContent = metaParts.join(" • ");

    document.getElementById("profile-roll").value = user.rollNumber || "";
    document.getElementById("profile-department").value = user.department || "";
    document.getElementById("profile-year").value = user.year || "";
    document.getElementById("profile-username").value = user.username || "";
    document.getElementById("profile-email").value = user.email || "";

    renderAvatar(user);
    renderMyReports(user);
    setEditMode(false);
  }

  function init() {
    document.getElementById("profile-go-auth-btn").addEventListener("click", () => {
      BLUE.App.navigate("auth");
    });

    document.getElementById("edit-profile-btn").addEventListener("click", () => {
      setEditMode(true);
      const user = BLUE.Api.getCurrentUser();
      if (user) {
        BLUE.Auth.updateUsernameFeedback(
          document.getElementById("profile-username"),
          document.getElementById("profile-username-icon"),
          document.getElementById("profile-username-msg"),
          document.getElementById("profile-username").value,
          user.id
        );
      }
    });

    document.getElementById("cancel-profile-btn").addEventListener("click", () => {
      render();
      BLUE.Toast.info("Profile changes discarded.");
    });

    const usernameInput = document.getElementById("profile-username");
    usernameInput.addEventListener("input", () => {
      if (!isEditing) return;
      const user = BLUE.Api.getCurrentUser();
      if (!user) return;
      BLUE.Auth.updateUsernameFeedback(
        usernameInput,
        document.getElementById("profile-username-icon"),
        document.getElementById("profile-username-msg"),
        usernameInput.value,
        user.id
      );
    });

    document.getElementById("profile-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const user = BLUE.Api.getCurrentUser();
      if (!user) return;

      const usernameCheck = BLUE.Auth.updateUsernameFeedback(
        usernameInput,
        document.getElementById("profile-username-icon"),
        document.getElementById("profile-username-msg"),
        usernameInput.value,
        user.id
      );

      if (!usernameCheck.available) {
        BLUE.Toast.error(usernameCheck.reason);
        return;
      }

      const res = BLUE.Api.updateProfile(user.id, {
        rollNumber: document.getElementById("profile-roll").value,
        department: document.getElementById("profile-department").value,
        year: document.getElementById("profile-year").value,
        username: usernameInput.value,
      });

      if (!res.ok) {
        BLUE.Toast.error(res.error);
        return;
      }

      BLUE.Toast.success("Profile updated successfully!");
      BLUE.App.onAuthChanged();
      render();
      BLUE.Items.refreshAll();
      BLUE.Dashboard.render();
    });

    document.getElementById("profile-avatar-input").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      const user = BLUE.Api.getCurrentUser();
      if (!file || !user) return;

      BLUE.Items.readAndCompressImage(file, 360)
        .then((dataUrl) => {
          const res = BLUE.Api.updateProfile(user.id, {
            username: user.username,
            avatar: dataUrl,
          });
          if (res.ok) {
            render();
            BLUE.Toast.success("Profile picture updated.");
          }
        })
        .catch((err) => BLUE.Toast.error(err.message || "Could not load image."));
      e.target.value = "";
    });

    document.getElementById("profile-remove-avatar-btn").addEventListener("click", () => {
      const user = BLUE.Api.getCurrentUser();
      if (!user) return;
      BLUE.Api.updateProfile(user.id, { username: user.username, avatar: "" });
      render();
      BLUE.Toast.info("Profile picture removed.");
    });

    document.getElementById("logout-btn").addEventListener("click", () => {
      BLUE.Api.logout();
      BLUE.App.onAuthChanged();
      BLUE.Toast.info("You have been logged out.");
      BLUE.App.navigate("auth");
    });

    document.querySelectorAll("[data-jump-route]").forEach((btn) => {
      btn.addEventListener("click", () => BLUE.App.navigate(btn.dataset.jumpRoute));
    });
  }

  BLUE.Profile = {
    init,
    render,
  };
})(window);
