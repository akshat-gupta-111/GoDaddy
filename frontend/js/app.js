/* Routing and session. */
(function (BLUE) {
  const view = document.getElementById("view");
  const nav = document.getElementById("nav");
  const ROUTES = ["assistant", "lost", "found", "mine", "dashboard", "profile"];
  BLUE.user = null;

  function render() {
    BLUE.closeDialog();
    nav.hidden = !BLUE.user;
    let route = location.hash.slice(1);
    if (!BLUE.user) {
      view.replaceChildren(BLUE.pages.auth());
      return;
    }
    if (!ROUTES.includes(route)) route = "assistant";
    // Reporting needs a complete profile, so send new users there first.
    if (!BLUE.user.profile_complete) route = "profile";
    nav.querySelectorAll("a").forEach((a) => {
      if (a.hash === `#${route}`) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const page = route === "assistant" ? BLUE.chat.page()
      : route === "profile" ? BLUE.pages.profile(BLUE.user) : BLUE.pages[route]();
    view.replaceChildren(page);
    window.scrollTo(0, 0);
  }

  BLUE.go = (route) => { if (location.hash === `#${route}`) render(); else location.hash = `#${route}`; };

  BLUE.signedIn = ({ token, user }) => {
    BLUE.token.set(token);
    BLUE.user = user;
    BLUE.chat.reset();
    BLUE.go("assistant");
  };

  BLUE.onSignedOut = (message = "Please log in again.") => {
    BLUE.token.set("");
    BLUE.user = null;
    BLUE.chat.reset();
    history.replaceState(null, "", location.pathname);
    render();
    BLUE.toast(message);
  };

  async function start() {
    document.querySelector(".dialog-close").addEventListener("click", BLUE.closeDialog);
    window.addEventListener("hashchange", render);
    // Another tab logged in or out: reload so old forms and chats are not sent as someone else.
    window.addEventListener("storage", (e) => { if (e.key === "blue_token" || e.key === null) location.reload(); });
    if (BLUE.token.get()) {
      try {
        BLUE.user = (await BLUE.api.profile()).user;
      } catch (error) {
        if (error.status !== 401) {
          view.replaceChildren(BLUE.h("p", { class: "empty" }, error.message, " ",
            BLUE.h("button", { type: "button", class: "btn", onclick: () => location.reload() }, "Retry")));
          return;
        }
      }
    }
    render();
  }

  start();
})(window.BLUE = window.BLUE || {});
