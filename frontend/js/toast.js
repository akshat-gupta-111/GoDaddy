/**
 * BLUE.Toast — Lightweight animated toast notifications
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  const ICONS = {
    success: "✓",
    error: "✕",
    warning: "!",
    info: "i",
  };

  function show(message, type = "info", duration = 4200) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");

    const iconSpan = document.createElement("span");
    iconSpan.className = "toast-icon";
    iconSpan.textContent = ICONS[type] || ICONS.info;

    const bodySpan = document.createElement("span");
    bodySpan.className = "toast-body";
    bodySpan.textContent = message;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "toast-close";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.innerHTML = "&times;";

    toast.appendChild(iconSpan);
    toast.appendChild(bodySpan);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    const removeToast = () => {
      if (!toast.parentNode) return;
      toast.style.opacity = "0";
      toast.style.transform = "translateX(16px)";
      toast.style.transition = "opacity 0.18s ease, transform 0.18s ease";
      setTimeout(() => toast.remove(), 180);
    };

    closeBtn.addEventListener("click", removeToast);
    if (duration > 0) {
      setTimeout(removeToast, duration);
    }
  }

  BLUE.Toast = {
    show,
    success: (msg, duration) => show(msg, "success", duration),
    error: (msg, duration) => show(msg, "error", duration),
    warning: (msg, duration) => show(msg, "warning", duration),
    info: (msg, duration) => show(msg, "info", duration),
  };
})(window);
