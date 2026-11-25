/* The assistant page. The server is stateless, so history, draft and token are kept here. */
(function (BLUE) {
  const { h } = BLUE;
  const GREETING = "Hi! Tell me what you lost or found. For example: “lost: grey hoodie, library, yesterday 4 pm”.";
  let state;

  function reset() {
    state = { messages: [{ role: "assistant", content: GREETING }], draft: {}, token: null,
      awaiting: false, photoFor: null, busy: false };
  }
  reset();

  let root = null; // the page currently on screen, if it is the assistant

  function draw() {
    if (!root || !root.isConnected) return;
    const log = h("div", { class: "chat-log", role: "log" },
      state.messages.map((m) => h("div", { class: `bubble ${m.role}` },
        m.preview ? h("img", { src: m.preview, alt: "Your photo", class: "bubble-photo" }) : null,
        m.content,
        m.results && m.results.length ? BLUE.grid(m.results, "") : null,
        m.contacts && m.contacts.length ? h("button", { type: "button", class: "btn small-btn",
          onclick: () => BLUE.contactsPopup(m.contacts) }, "Show Lost and Found numbers") : null)),
      state.busy ? h("div", { class: "bubble assistant typing", "aria-label": "Assistant is typing" }, h("i"), h("i"), h("i")) : null);

    const quick = [];
    const chip = (label, action, primary) => h("button", { type: "button", class: primary ? "chip primary" : "chip",
      disabled: state.busy, onclick: action }, label);
    if (state.awaiting) {
      quick.push(chip("Yes, save it", () => send("Yes, save it", true), true),
        chip("Change something", () => root.querySelector("input").focus()));
    } else if (state.photoFor) {
      quick.push(chip("Upload photo", () => BLUE.pickPhoto(sendPhoto), true),
        chip("Skip photo", () => { state.photoFor = null; draw(); }));
    } else if (state.messages.length === 1) {
      ["I lost something", "I found something", "Show recently found items"].forEach((t) => quick.push(chip(t, () => send(t))));
    }

    const input = h("input", { type: "text", maxlength: "1000", placeholder: "Type your message…", "aria-label": "Message", disabled: state.busy });
    const form = h("form", { class: "chat-form", onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) send(input.value.trim()); } },
      input, h("button", { class: "btn primary", type: "submit", disabled: state.busy }, "Send"));

    const previous = root.querySelector(".chat-form input");
    if (previous && !state.busy) input.value = previous.value;
    root.replaceChildren(
      h("div", { class: "chat-head" }, h("div", {}, h("h1", {}, "Lost & Found assistant"),
        h("p", { class: "muted" }, "Find an item or report one, one question at a time.")),
        h("button", { type: "button", class: "btn", disabled: state.busy, onclick: () => { reset(); draw(); } }, "New chat")),
      log, h("div", { class: "chips" }, quick), form);
    log.scrollTop = log.scrollHeight;
    if (!state.busy) input.focus({ preventScroll: true });
  }

  async function exchange(userMessage, call, apply) {
    const current = state;
    current.messages.push(userMessage);
    current.busy = true;
    draw();
    try {
      const data = await call();
      if (current !== state) return; // the user started a new chat or signed out
      apply(data);
      current.messages.push({ role: "assistant", content: data.reply, results: data.results, contacts: data.contacts });
      current.busy = false;
      draw();
      BLUE.contactsPopup(data.contacts);
    } catch (error) {
      if (current !== state) return;
      current.messages.push({ role: "assistant", content: error.message });
      current.busy = false;
      draw();
    }
  }

  function send(text, confirm = false) {
    if (state.busy) return;
    const history = state.messages.slice(-20).map(({ role, content }) => ({ role, content }));
    const body = { message: text, history, draft: state.draft, confirm_token: state.token };
    if (confirm) body.confirm = true;
    const field = root && root.querySelector(".chat-form input");
    if (field) field.value = "";
    exchange({ role: "user", content: text }, () => BLUE.api.chat(body), (data) => {
      state.draft = data.draft;
      state.token = data.confirm_token;
      state.awaiting = data.awaiting_confirmation;
      if (data.awaiting_image && data.saved_report) state.photoFor = data.saved_report.report_id;
      else if (data.awaiting_confirmation || Object.keys(data.draft).length) state.photoFor = null;
    });
  }

  function sendPhoto(file) {
    const reportId = state.photoFor;
    if (state.busy || !reportId) return;
    exchange({ role: "user", content: "Here is a photo of the item.", preview: URL.createObjectURL(file) },
      () => BLUE.api.chatPhoto(reportId, file), () => { state.photoFor = null; });
  }

  BLUE.chat = {
    reset,
    page() { root = h("section", { class: "chat card" }); queueMicrotask(draw); return root; },
  };
})(window.BLUE = window.BLUE || {});
