/**
 * BLUE.Auth — Login, Signup, live unique username check, password toggles & reset
 */
(function (global) {
  const BLUE = (global.BLUE = global.BLUE || {});

  function updateUsernameFeedback(inputEl, iconEl, msgEl, rawVal, excludeUserId = null) {
    const trimmed = String(rawVal || "").trim();
    if (!trimmed) {
      inputEl.classList.remove("is-valid", "is-invalid");
      iconEl.textContent = "";
      iconEl.className = "username-status-icon";
      msgEl.textContent = "";
      msgEl.className = "validation-msg";
      return { valid: false, available: false };
    }

    const res = BLUE.Api.validateUsernameAvailability(trimmed, excludeUserId);
    if (res.available) {
      inputEl.classList.add("is-valid");
      inputEl.classList.remove("is-invalid");
      iconEl.textContent = "✓";
      iconEl.className = "username-status-icon available";
      msgEl.textContent = res.reason;
      msgEl.className = "validation-msg available";
    } else {
      inputEl.classList.add("is-invalid");
      inputEl.classList.remove("is-valid");
      iconEl.textContent = "✕";
      iconEl.className = "username-status-icon taken";
      msgEl.textContent = res.reason;
      msgEl.className = "validation-msg taken";
    }
    return res;
  }

  function init() {
    const tabLogin = document.getElementById("tab-login");
    const tabSignup = document.getElementById("tab-signup");
    const loginForm = document.getElementById("login-form-panel");
    const signupForm = document.getElementById("signup-form-panel");
    const switchToSignup = document.getElementById("switch-to-signup");
    const switchToLogin = document.getElementById("switch-to-login");

    const loginIdInput = document.getElementById("login-identifier");
    const loginPwdInput = document.getElementById("login-password");
    const loginRemember = document.getElementById("login-remember");

    const signupNameInput = document.getElementById("signup-fullname");
    const signupUserInput = document.getElementById("signup-username");
    const signupUserIcon = document.getElementById("signup-username-icon");
    const signupUserMsg = document.getElementById("signup-username-msg");
    const signupEmailInput = document.getElementById("signup-email");
    const signupPwdInput = document.getElementById("signup-password");
    const signupConfirmInput = document.getElementById("signup-confirm-password");

    const forgotBtn = document.getElementById("forgot-password-btn");
    const forgotModal = document.getElementById("forgot-modal");
    const forgotForm = document.getElementById("forgot-password-form");

    function setAuthMode(mode) {
      const isLogin = mode === "login";
      tabLogin.classList.toggle("active", isLogin);
      tabSignup.classList.toggle("active", !isLogin);
      tabLogin.setAttribute("aria-selected", String(isLogin));
      tabSignup.setAttribute("aria-selected", String(!isLogin));
      loginForm.hidden = !isLogin;
      signupForm.hidden = isLogin;
    }

    tabLogin.addEventListener("click", () => setAuthMode("login"));
    tabSignup.addEventListener("click", () => setAuthMode("signup"));
    switchToSignup.addEventListener("click", () => setAuthMode("signup"));
    switchToLogin.addEventListener("click", () => setAuthMode("login"));

    // Password Visibility Toggles
    document.querySelectorAll(".toggle-password").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const reveal = target.type === "password";
        target.type = reveal ? "text" : "password";
        btn.querySelector(".eye-open").hidden = reveal;
        btn.querySelector(".eye-closed").hidden = !reveal;
      });
    });

    // Real-time unique username validation while typing on Signup
    signupUserInput.addEventListener("input", () => {
      updateUsernameFeedback(
        signupUserInput,
        signupUserIcon,
        signupUserMsg,
        signupUserInput.value
      );
    });

    // Login Submission
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      document.getElementById("login-identifier-error").textContent = "";
      document.getElementById("login-password-error").textContent = "";

      const identifier = loginIdInput.value.trim();
      const password = loginPwdInput.value;

      let valid = true;
      if (!identifier) {
        document.getElementById("login-identifier-error").textContent =
          "Please enter your username or email.";
        valid = false;
      }
      if (!password) {
        document.getElementById("login-password-error").textContent = "Please enter your password.";
        valid = false;
      }
      if (!valid) return;

      const result = BLUE.Api.login({
        identifier,
        password,
        remember: loginRemember.checked,
      });

      if (!result.ok) {
        document.getElementById("login-password-error").textContent = result.error;
        BLUE.Toast.error(result.error);
        return;
      }

      loginForm.reset();
      BLUE.Toast.success(`Welcome back, @${result.user.username}!`);
      BLUE.App.onAuthChanged();
      BLUE.App.navigate("profile");
    });

    // Signup Submission
    signupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      document.getElementById("signup-fullname-error").textContent = "";
      document.getElementById("signup-email-error").textContent = "";
      document.getElementById("signup-password-error").textContent = "";
      document.getElementById("signup-confirm-password-error").textContent = "";

      const fullName = signupNameInput.value.trim();
      const username = signupUserInput.value.trim();
      const email = signupEmailInput.value.trim();
      const password = signupPwdInput.value;
      const confirmPassword = signupConfirmInput.value;

      let hasError = false;
      if (!fullName) {
        document.getElementById("signup-fullname-error").textContent = "Full Name is required.";
        hasError = true;
      }

      const usernameStatus = updateUsernameFeedback(
        signupUserInput,
        signupUserIcon,
        signupUserMsg,
        username
      );
      if (!usernameStatus.available) {
        hasError = true;
      }

      if (!BLUE.Api.EMAIL_REGEX.test(email)) {
        document.getElementById("signup-email-error").textContent =
          "Enter a valid email address.";
        hasError = true;
      }

      if (password.length < 6) {
        document.getElementById("signup-password-error").textContent =
          "Password must be at least 6 characters.";
        hasError = true;
      }

      if (confirmPassword !== password) {
        document.getElementById("signup-confirm-password-error").textContent =
          "Passwords do not match.";
        hasError = true;
      }

      if (hasError) {
        BLUE.Toast.error("Please resolve the highlighted errors before continuing.");
        return;
      }

      const result = BLUE.Api.signup({ fullName, username, email, password });
      if (!result.ok) {
        BLUE.Toast.error(result.error);
        if (result.error.toLowerCase().includes("email")) {
          document.getElementById("signup-email-error").textContent = result.error;
        }
        return;
      }

      signupForm.reset();
      signupUserInput.classList.remove("is-valid", "is-invalid");
      signupUserIcon.textContent = "";
      signupUserMsg.textContent = "";

      BLUE.Toast.success(`Account created! Welcome to BLUE, @${result.user.username}.`);
      BLUE.App.onAuthChanged();
      BLUE.App.navigate("profile");
    });

    // Forgot Password Modal
    forgotBtn.addEventListener("click", () => {
      document.getElementById("forgot-identifier-error").textContent = "";
      document.getElementById("forgot-password-error").textContent = "";
      forgotForm.reset();
      forgotModal.hidden = false;
    });

    forgotForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const identifier = document.getElementById("forgot-identifier").value.trim();
      const newPassword = document.getElementById("forgot-new-password").value;

      document.getElementById("forgot-identifier-error").textContent = "";
      document.getElementById("forgot-password-error").textContent = "";

      const res = BLUE.Api.resetPassword({ identifier, newPassword });
      if (!res.ok) {
        if (res.error.toLowerCase().includes("password")) {
          document.getElementById("forgot-password-error").textContent = res.error;
        } else {
          document.getElementById("forgot-identifier-error").textContent = res.error;
        }
        return;
      }

      forgotModal.hidden = true;
      BLUE.Toast.success("Password updated! You can now log in.");
    });
  }

  BLUE.Auth = {
    init,
    updateUsernameFeedback,
  };
})(window);
