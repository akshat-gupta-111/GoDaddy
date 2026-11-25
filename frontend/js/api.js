/* Talks to the Flask API. Nothing about users or reports is stored in the browser except the login token. */
(function (BLUE) {
  const KEY = "blue_token";
  let memory = "";

  const token = {
    get() { try { return localStorage.getItem(KEY) || memory; } catch { return memory; } },
    set(value) {
      memory = value || "";
      try { value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY); } catch { /* private mode */ }
    },
  };

  async function request(method, path, body) {
    const headers = {};
    const sentToken = token.get();
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(`/api${path}`, { method, headers, body });
    } catch {
      throw Object.assign(new Error("Cannot reach the server. Check your connection and try again."), { status: 0 });
    }
    const data = await response.json().catch(() => ({}));
    // A late 401 from an earlier session must not log out the current one.
    if (response.status === 401 && sentToken && sentToken === token.get()) BLUE.onSignedOut();
    if (!response.ok) {
      throw Object.assign(new Error(data.error || "Something went wrong. Please try again."),
        { status: response.status, fields: data.fields });
    }
    return data;
  }

  function photoForm(file, extra = {}) {
    const form = new FormData();
    Object.entries(extra).forEach(([k, v]) => form.append(k, v));
    form.append("image", file);
    return form;
  }

  const id = encodeURIComponent;
  BLUE.token = token;
  BLUE.api = {
    signup: (body) => request("POST", "/signup", body),
    login: (body) => request("POST", "/login", body),
    logout: () => request("POST", "/logout"),
    profile: () => request("GET", "/profile"),
    saveProfile: (body) => request("PUT", "/profile", body),
    report: (type, body) => request("POST", `/reports/${type}`, body),
    mine: () => request("GET", "/reports/mine"),
    matches: (reportId) => request("GET", `/reports/${id(reportId)}/matches`),
    reunite: (reportId) => request("POST", `/reports/${id(reportId)}/reunite`),
    photo: (reportId, file) => request("POST", `/reports/${id(reportId)}/image`, photoForm(file)),
    search: (body) => request("POST", "/search", body),
    insights: () => request("GET", "/insights"),
    chat: (body) => request("POST", "/chat", body),
    chatPhoto: (reportId, file) => request("POST", "/chat/image", photoForm(file, { report_id: reportId })),
  };
})(window.BLUE = window.BLUE || {});
