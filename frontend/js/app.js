/**
 * BLUE.App — Application router, navbar active states, modals & bootstrap
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  const ROUTES = ["auth", "profile", "lost", "found", "dashboard"];

  function navigate(route, updateHash = true) {
    const targetRoute = ROUTES.includes(route) ? route : "auth";

    ROUTES.forEach((r) => {
      const pageEl = document.getElementById(`page-${r}`);
      const navEl = document.getElementById(`nav-${r}`);
      const active = r === targetRoute;
      if (pageEl) pageEl.hidden = !active;
      if (navEl) navEl.classList.toggle("active", active);
    });

    if (targetRoute === "profile") {
      BLUE.Profile.render();
    } else if (targetRoute === "dashboard") {
      BLUE.Dashboard.render();
    }

    if (updateHash && global.location.hash !== `#${targetRoute}`) {
      global.location.hash = `#${targetRoute}`;
    }

    const navMenu = document.getElementById("nav-menu");
    const navToggle = document.getElementById("nav-toggle");
    if (navMenu && navMenu.classList.contains("open")) {
      navMenu.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  }

  function onAuthChanged() {
    const user = BLUE.Api.getCurrentUser();
    const pill = document.getElementById("nav-session-pill");
    const usernameEl = document.getElementById("nav-session-username");
    if (user) {
      pill.hidden = false;
      usernameEl.textContent = `@${user.username}`;
    } else {
      pill.hidden = true;
    }
  }

  function setupModals() {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const modal = document.getElementById(btn.dataset.closeModal);
        if (modal) modal.hidden = true;
      });
    });

    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.hidden = true;
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document.querySelectorAll(".modal-backdrop").forEach((m) => {
          m.hidden = true;
        });
      }
    });
  }

  function init() {
    BLUE.Storage.ensureSeeded();
    setupModals();

    BLUE.Auth.init();
    BLUE.Profile.init();
    BLUE.ChatWindow.init();
    BLUE.Items.init();
    BLUE.Dashboard.init();

    document.querySelectorAll("[data-route]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        navigate(el.dataset.route);
      });
    });

    const navToggle = document.getElementById("nav-toggle");
    const navMenu = document.getElementById("nav-menu");
    navToggle.addEventListener("click", () => {
      const nextOpen = !navMenu.classList.contains("open");
      navMenu.classList.toggle("open", nextOpen);
      navToggle.setAttribute("aria-expanded", String(nextOpen));
    });

    global.addEventListener("hashchange", () => {
      const hashRoute = global.location.hash.replace("#", "");
      navigate(hashRoute || "auth", false);
    });

    onAuthChanged();

    const initialHash = global.location.hash.replace("#", "");
    if (ROUTES.includes(initialHash)) {
      navigate(initialHash, false);
    } else {
      const user = BLUE.Api.getCurrentUser();
      navigate(user ? "profile" : "auth");
    }
  }

  BLUE.App = {
    init,
    navigate,
    onAuthChanged,
  };

  document.addEventListener("DOMContentLoaded", init);
})(window);
