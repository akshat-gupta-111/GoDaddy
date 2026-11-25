/* Small DOM helpers. All text goes through textContent, never innerHTML. */
(function (BLUE) {
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "class") el.className = value;
      else if (key === "value") el.value = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }

  function toast(message, kind = "info") {
    const el = h("div", { class: `toast ${kind}`, role: "status" }, message);
    document.getElementById("toasts").append(el);
    setTimeout(() => el.remove(), 4500);
  }

  const dialog = () => document.getElementById("dialog");
  function openDialog(...content) {
    document.getElementById("dialog-body").replaceChildren(...content);
    if (!dialog().open) dialog().showModal();
  }
  function closeDialog() { if (dialog().open) dialog().close(); }

  /* The Lost and Found department numbers pop up whenever something matched. */
  function contactsPopup(contacts) {
    if (!contacts || !contacts.length) return;
    openDialog(
      h("h2", {}, "Possible match found"),
      h("p", { class: "muted" }, "Items are held by the Lost and Found department. Call to check and collect."),
      h("ul", { class: "contacts" }, contacts.map((c) =>
        h("li", {}, h("span", {}, c.label), h("a", { href: `tel:${c.phone.replace(/\s/g, "")}` }, c.phone)))),
      h("p", { class: "muted small" }, "Demo numbers"),
      h("button", { class: "btn primary block", type: "button", onclick: closeDialog }, "Got it"),
    );
  }

  function when(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value
      : date.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }

  /* Local time in the YYYY-MM-DDTHH:MM form used by inputs and the API. */
  function localValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function photo(report, large = false) {
    const box = h("div", { class: large ? "photo large" : "photo" });
    const empty = () => box.replaceChildren(h("span", { class: "no-photo" }, "No photo"));
    if (report.image_url) {
      box.append(h("img", { src: report.image_url, alt: `${report.colour} ${report.item}`, loading: "lazy", onerror: empty }));
    } else empty();
    return box;
  }

  function reportDialog(report) {
    const window_ = report.to_time && report.to_time !== report.from_time
      ? `${when(report.from_time)} – ${when(report.to_time)}` : when(report.from_time);
    openDialog(
      photo(report, true),
      h("h2", {}, `${report.colour} ${report.item}`),
      h("p", {}, report.description),
      h("dl", {},
        [["Type", report.report_type], ["Brand", report.brand], ["Place", report.place],
          ["When", window_ || "Not given"], ["Status", report.status]]
          .map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
    );
  }

  function card(report, actions = []) {
    return h("article", { class: "card item" },
      h("button", { class: "item-open", type: "button", onclick: () => reportDialog(report), "aria-label": `Details of ${report.colour} ${report.item}` },
        photo(report),
        report.score !== null && report.score !== undefined
          ? h("span", { class: `score ${report.score >= 70 ? "high" : ""}` }, `${report.score}% match`) : null),
      h("div", { class: "item-body" },
        h("div", { class: "item-tags" },
          h("span", { class: `tag ${report.report_type}` }, report.report_type),
          report.status === "reunited" ? h("span", { class: "tag done" }, "reunited") : null,
          report.is_mine ? h("span", { class: "tag" }, "yours") : null),
        h("h3", {}, `${report.colour} ${report.item}`),
        h("p", { class: "muted small" }, [report.place, when(report.from_time)].filter(Boolean).join(" · ")),
        report.image_score !== null && report.image_score !== undefined
          ? h("p", { class: "small photo-score" }, `Photo likeness ${report.image_score}%`) : null,
        actions.length ? h("div", { class: "actions" }, actions) : null));
  }

  const grid = (reports, emptyText, actions) => reports.length
    ? h("div", { class: "grid" }, reports.map((r) => card(r, actions ? actions(r) : [])))
    : h("p", { class: "empty" }, emptyText);

  /* A button that cannot be pressed twice while its action runs. */
  function busyButton(label, className, action) {
    const button = h("button", { type: "button", class: className }, label);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await action(); } catch (error) { toast(error.message, "error"); } finally { button.disabled = false; }
    });
    return button;
  }

  /* Returns a problem with the chosen photo, or "" if it can be uploaded. */
  function photoProblem(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a JPEG, PNG or WebP photo.";
    return file.size > 5 * 1024 * 1024 ? "The photo must be 5 MB or smaller." : "";
  }

  function pickPhoto(onFile) {
    const input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const problem = photoProblem(file);
      if (problem) toast(problem, "error"); else onFile(file);
    });
    input.click();
  }

  Object.assign(BLUE, { h, toast, openDialog, closeDialog, contactsPopup, when, localValue, grid, busyButton, pickPhoto, photoProblem });
})(window.BLUE = window.BLUE || {});
