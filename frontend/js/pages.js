/* Sign in, profile, report forms, my reports and insights. */
(function (BLUE) {
  const { h, toast, grid, busyButton } = BLUE;
  const COLOURS = ["black", "blue", "navy", "grey", "silver", "white", "red", "maroon", "green", "yellow", "pink", "purple", "brown", "beige", "multicolour"];
  const PLACES = ["Library", "Canteen", "Main Auditorium", "Sports Complex", "Computer Lab", "Parking Area", "Hostel Block", "Classroom Block A"];
  const ITEMS = ["water bottle", "ID card", "charger", "earbuds", "backpack", "keys", "hoodie", "notebook", "calculator", "umbrella", "lunch box", "glasses", "phone", "wallet"];

  function field(label, name, attrs = {}, options) {
    const id = `f-${name}`;
    const control = attrs.tag === "select"
      ? h("select", { id, name }, options.map(([v, t]) => h("option", { value: v }, t)))
      : h(attrs.tag || "input", { id, name, ...attrs, tag: null });
    if (attrs.value !== undefined) control.value = attrs.value ?? "";
    const list = options && attrs.tag !== "select" ? h("datalist", { id: `${id}-list` }, options.map((v) => h("option", { value: v }))) : null;
    if (list) control.setAttribute("list", list.id);
    return h("div", { class: "field" }, h("label", { for: id }, label), control, list, h("span", { class: "error", "data-error": name }));
  }

  /* Runs the submit action once at a time and shows field errors next to their inputs. */
  function form(attrs, onSubmit, ...children) {
    const el = h("form", { ...attrs, novalidate: true }, children);
    el.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = el.querySelector("[type=submit]");
      if (button.disabled) return;
      el.querySelectorAll("[data-error]").forEach((s) => { s.textContent = ""; });
      button.disabled = true;
      try {
        await onSubmit(Object.fromEntries(new FormData(el)), el);
      } catch (error) {
        const shown = Object.entries(error.fields || {}).filter(([name, message]) => {
          const slot = el.querySelector(`[data-error="${name}"]`);
          if (slot) slot.textContent = message;
          return slot;
        });
        if (!shown.length) toast(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
    return el;
  }

  function auth() {
    let signup = false;
    const box = h("section", { class: "narrow card" });
    function draw() {
      box.replaceChildren(
        h("h1", {}, signup ? "Create your account" : "Welcome back"),
        h("p", { class: "muted" }, "Find what you lost, or help someone get theirs back."),
        form({}, async (data) => {
          if (signup && data.password !== data.confirm) {
            throw Object.assign(new Error("Passwords do not match."), { fields: { confirm: "Passwords do not match." } });
          }
          const result = await BLUE.api[signup ? "signup" : "login"]({ email: data.email, password: data.password });
          BLUE.signedIn(result);
        },
        field("Email", "email", { type: "email", autocomplete: "email", required: true }),
        field("Password", "password", { type: "password", autocomplete: signup ? "new-password" : "current-password", placeholder: signup ? "At least 8 characters" : "" }),
        signup ? field("Confirm password", "confirm", { type: "password", autocomplete: "new-password" }) : null,
        h("button", { type: "submit", class: "btn primary block" }, signup ? "Sign up" : "Log in")),
        h("p", { class: "muted center" }, signup ? "Already have an account? " : "New here? ",
          h("button", { type: "button", class: "link", onclick: () => { signup = !signup; draw(); } }, signup ? "Log in" : "Create an account")));
    }
    draw();
    return box;
  }

  function profile(user) {
    return h("section", { class: "narrow card" },
      h("h1", {}, user.profile_complete ? "Your profile" : "Complete your profile"),
      h("p", { class: "muted" }, user.profile_complete ? user.email : "Needed once, before you can report items."),
      form({}, async (data) => {
        const result = await BLUE.api.saveProfile({ ...data, year: Number(data.year) });
        const first = !user.profile_complete;
        BLUE.user = result.user;
        toast("Profile saved.", "success");
        if (first) BLUE.go("assistant");
      },
      field("Full name", "user_name", { value: user.user_name, maxlength: "80", autocomplete: "name" }),
      field("Roll number", "roll_no", { value: user.roll_no, maxlength: "30" }),
      field("Year", "year", { tag: "select", value: user.year ?? "" }, [["", "Choose year"], ...[1, 2, 3, 4, 5, 6].map((y) => [String(y), `Year ${y}`])]),
      field("Phone", "phone", { value: user.phone, type: "tel", autocomplete: "tel", placeholder: "10 to 15 digits" }),
      h("button", { type: "submit", class: "btn primary block" }, "Save profile")),
      h("hr"),
      busyButton("Log out", "btn block", async () => {
        try { await BLUE.api.logout(); } catch (error) { if (error.status !== 401) throw error; }
        BLUE.onSignedOut("You are logged out.");
      }));
  }

  async function showMatches(report, target) {
    const data = await BLUE.api.matches(report.report_id);
    target.replaceChildren(h("div", { class: "section-head" },
      h("h2", {}, `Matches for your ${report.colour} ${report.item}`),
      h("button", { type: "button", class: "link", onclick: () => target.replaceChildren() }, "Close")),
    grid(data.matches, report.status === "open" ? "No matches yet. Check again later from My reports." : "This item is already reunited."));
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    BLUE.contactsPopup(data.contacts);
  }

  function reportPage(type) {
    const lost = type === "lost";
    const matchArea = h("div", { class: "match-area" });
    const feed = h("div", {});
    const now = new Date();
    const timeNow = BLUE.localValue(now);
    const hourAgo = BLUE.localValue(new Date(now.getTime() - 3600000));
    let sequence = 0;

    async function loadFeed() {
      const mine = ++sequence;
      const filters = { report_type: type, limit: 48, text: search.value.trim(), colour: colour.value };
      try {
        const data = await BLUE.api.search(filters);
        if (mine !== sequence) return; // a newer search has started
        const filtered = filters.text || filters.colour;
        feed.replaceChildren(
          h("p", { class: "muted small" }, `${data.total} open ${type} report${data.total === 1 ? "" : "s"}${data.total > data.results.length ? `, showing ${data.results.length}` : ""}`),
          grid(data.results, filtered ? "Nothing matches those filters." : "No reports yet."));
      } catch (error) {
        if (mine === sequence) feed.replaceChildren(h("p", { class: "empty" }, error.message));
      }
    }

    let timer;
    const search = h("input", { type: "search", placeholder: "Search item, brand or place", "aria-label": "Search reports", maxlength: "300",
      oninput: () => { clearTimeout(timer); timer = setTimeout(loadFeed, 350); } });
    const colour = h("select", { "aria-label": "Filter by colour", onchange: loadFeed },
      h("option", { value: "" }, "All colours"), COLOURS.map((c) => h("option", { value: c }, c)));

    const photoInput = h("input", { type: "file", id: "f-photo", accept: "image/jpeg,image/png,image/webp" });

    const reportForm = form({ class: "card report-form" }, async (data, el) => {
      const errors = {};
      ["item", "colour", "place"].forEach((k) => { if (!data[k].trim()) errors[k] = "Required."; });
      if (!data.from_time) errors.from_time = "Required.";
      if (lost && !data.to_time) errors.to_time = "Required.";
      else if (lost && data.to_time < data.from_time) errors.to_time = "Must not be earlier than the start.";
      const file = photoInput.files[0];
      if (file && BLUE.photoProblem(file)) errors.photo = BLUE.photoProblem(file);
      if (Object.keys(errors).length) throw Object.assign(new Error("Check the highlighted fields."), { fields: errors });

      const body = { ...data, brand: data.brand.trim() || "unknown",
        description: data.description.trim() || `${data.colour.trim()} ${data.item.trim()}` };
      let { report } = await BLUE.api.report(type, body);
      let photoFailed = "";
      if (file) {
        try {
          const saved = await BLUE.api.photo(report.report_id, file);
          report = saved.report;
          if (!saved.image_analysed) toast("Photo saved but not analysed, so matches use details only. Upload it again from My reports to retry.", "error");
        } catch (error) { photoFailed = error.message; }
      }
      el.reset();
      toast(photoFailed ? `Report saved, but the photo failed: ${photoFailed} Add it from My reports.` : "Report saved.", photoFailed ? "error" : "success");
      if (!lost) toast("Please hand the item in at the Lost and Found department.");
      loadFeed();
      try { await showMatches(report, matchArea); }
      catch (error) { toast(`Saved. Matches could not load: ${error.message}`, "error"); }
    },
    h("h2", {}, lost ? "Report a lost item" : "Report a found item"),
    h("div", { class: "two" },
      field("Item", "item", { maxlength: "80", placeholder: "e.g. water bottle" }, ITEMS),
      field("Colour", "colour", { maxlength: "40", placeholder: "e.g. navy" }, COLOURS)),
    h("div", { class: "two" },
      field("Place", "place", { maxlength: "100", placeholder: "e.g. Library" }, PLACES),
      field("Brand (optional)", "brand", { maxlength: "60" })),
    h("div", { class: lost ? "two" : "" },
      field(lost ? "Lost between" : "Found at", "from_time", { type: "datetime-local", value: lost ? hourAgo : timeNow }),
      lost ? field("and", "to_time", { type: "datetime-local", value: timeNow }) : null),
    field("Details (optional)", "description", { tag: "textarea", rows: "2", maxlength: "1000", placeholder: "Stickers, scratches, anything distinctive" }),
    h("div", { class: "field" }, h("label", { for: "f-photo" }, "Photo (optional, improves matching)"), photoInput, h("span", { class: "error", "data-error": "photo" })),
    h("button", { type: "submit", class: "btn primary block" }, "Save and find matches"));

    // Restore the prefilled times after a successful save.
    reportForm.querySelectorAll("input[type=datetime-local]").forEach((i) => { i.defaultValue = i.value; });
    loadFeed();
    return h("section", {},
      h("div", { class: "page-head" }, h("h1", {}, lost ? "Lost items" : "Found items"),
        h("p", { class: "muted" }, lost ? "Report what you lost in under 30 seconds." : "Log what you found, then hand it in at the Lost and Found department.")),
      matchArea,
      h("div", { class: "split" }, reportForm,
        h("div", {}, h("div", { class: "toolbar" }, search, colour), feed)));
  }

  function mine() {
    const matchArea = h("div", { class: "match-area" });
    const list = h("div", {}, h("p", { class: "empty" }, "Loading…"));
    async function load() {
      try {
        const { reports } = await BLUE.api.mine();
        list.replaceChildren(grid(reports, "You have no reports yet. Use the assistant or the Lost and Found pages.", (r) => [
          r.status === "open" ? busyButton("Matches", "btn small-btn primary", () => showMatches(r, matchArea)) : null,
          busyButton(r.image_url ? "Change photo" : "Add photo", "btn small-btn", async () => BLUE.pickPhoto(async (file) => {
            toast("Uploading photo…");
            try {
              const saved = await BLUE.api.photo(r.report_id, file);
              if (saved.image_analysed) toast("Photo saved.", "success");
              else toast("Photo saved but not analysed. Upload it again to retry.", "error");
              await load();
            }
            catch (error) { toast(error.message, "error"); }
          })),
          r.status === "open" ? busyButton("Reunited", "btn small-btn success", async () => {
            if (!window.confirm(`Mark your ${r.colour} ${r.item} as reunited? It will leave the open lists.`)) return;
            await BLUE.api.reunite(r.report_id);
            matchArea.replaceChildren();
            toast("Marked as reunited.", "success");
            await load();
          }) : null,
        ].filter(Boolean)));
      } catch (error) {
        list.replaceChildren(h("p", { class: "empty" }, error.message));
      }
    }
    load();
    return h("section", {}, h("div", { class: "page-head" }, h("h1", {}, "My reports")), matchArea, list);
  }

  function dashboard() {
    const body = h("div", {}, h("p", { class: "empty" }, "Loading…"));
    const bars = (title, rows, key) => {
      const max = Math.max(1, ...rows.map((r) => r.count));
      return h("div", { class: "card pad" }, h("h2", {}, title),
        rows.length ? rows.map((r, i) => {
          const fill = h("div", { class: "bar-fill" });
          fill.style.width = `${Math.round((100 * r.count) / max)}%`;
          return h("div", { class: "bar" }, h("div", { class: "bar-label" }, h("span", {}, `${i + 1}. ${r[key]}`), h("strong", {}, String(r.count))),
            h("div", { class: "bar-track" }, fill));
        }) : h("p", { class: "muted" }, "No data yet."));
    };
    BLUE.api.insights().then((data) => {
      const top = data.hotspots[0];
      body.replaceChildren(
        top ? h("p", { class: "insight" }, `${top.place} is the biggest hotspot: ${top.count} of ${data.total_lost} lost reports (${Math.round((100 * top.count) / data.total_lost)}%).`) : null,
        h("div", { class: "stats" }, [["Lost reports", data.total_lost], ["Found reports", data.total_found], ["Open", data.total_open], ["Reunited", data.total_reunited]]
          .map(([label, value]) => h("div", { class: "card stat" }, h("strong", {}, String(value)), h("span", {}, label)))),
        h("div", { class: "two wide" }, bars("Top 3 most-lost items", data.top_items, "item"), bars("Top 3 hotspots", data.hotspots, "place")));
    }).catch((error) => body.replaceChildren(h("p", { class: "empty" }, error.message)));
    return h("section", {}, h("div", { class: "page-head" }, h("h1", {}, "Campus insights")), body);
  }

  BLUE.pages = { auth, profile, mine, dashboard, lost: () => reportPage("lost"), found: () => reportPage("found") };
})(window.BLUE = window.BLUE || {});
