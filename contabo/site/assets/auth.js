// AfterKey — account surface. Login, registration, reset, vault dashboard.
// No inline handlers, no third-party calls. Session is an httpOnly cookie.

const path = location.pathname.replace(/\/+$/, "") || "/";
const api = async (url, options = {}) => {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body };
};

const say = (el, text, state) => {
  if (!el) return;
  el.textContent = text;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
};

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;

/* Reveal-password control, used by every form. */
for (const btn of document.querySelectorAll("[data-reveal]")) {
  const input = document.getElementById(btn.getAttribute("aria-controls"));
  if (!input) continue;
  btn.addEventListener("click", () => {
    const shown = input.type === "text";
    input.type = shown ? "password" : "text";
    btn.setAttribute("aria-pressed", String(!shown));
    btn.setAttribute("aria-label", shown ? "Show password" : "Hide password");
    input.focus({ preventScroll: true });
  });
}

const submitButton = (form) => form.querySelector("[data-submit]");
const busy = (form, on, label) => {
  const btn = submitButton(form);
  const span = form.querySelector("[data-label]");
  if (!btn) return;
  btn.disabled = on;
  if (span && label) span.textContent = on ? label : span.dataset.rest || span.textContent;
  if (!on && span && span.dataset.rest) span.textContent = span.dataset.rest;
};
for (const span of document.querySelectorAll("[data-label]")) {
  span.dataset.rest = span.textContent;
}

const afterAuth = () => {
  const next = new URLSearchParams(location.search).get("next");
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  location.replace(safe);
};

/* ── sign in ─────────────────────────────────────────────────── */

function wireLogin(form) {
  const email = form.querySelector("#email");
  const password = form.querySelector("#password");
  const msg = form.querySelector("[data-msg]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton(form).disabled) return;
    const e = email.value.trim().toLowerCase();
    if (!validEmail(e)) {
      email.setAttribute("aria-invalid", "true");
      say(msg, "Enter the address you signed up with.", "err");
      email.focus();
      return;
    }
    if (!password.value) {
      password.setAttribute("aria-invalid", "true");
      say(msg, "Enter your password.", "err");
      password.focus();
      return;
    }
    email.removeAttribute("aria-invalid");
    password.removeAttribute("aria-invalid");

    busy(form, true, "Signing in…");
    say(msg, "");
    try {
      const { res, body } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: e, password: password.value }),
      });
      if (res.ok) {
        afterAuth();
        return;
      }
      if (res.status === 429) say(msg, "Too many attempts. Wait a few minutes.", "err");
      else if (res.status === 422) say(msg, "Enter a valid address and password.", "err");
      else say(msg, (body && body.message) || "Those details do not match an account.", "err");
    } catch {
      say(msg, "No connection to the server. Try again.", "err");
    } finally {
      password.value = "";
      busy(form, false);
    }
  });
}

/* ── register ────────────────────────────────────────────────── */

function wireRegister(form) {
  const email = form.querySelector("#email");
  const password = form.querySelector("#password");
  const msg = form.querySelector("[data-msg]");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton(form).disabled) return;
    const e = email.value.trim().toLowerCase();
    if (!validEmail(e)) {
      email.setAttribute("aria-invalid", "true");
      say(msg, "That address does not look complete.", "err");
      email.focus();
      return;
    }
    if (password.value.length < 10) {
      password.setAttribute("aria-invalid", "true");
      say(msg, "Use at least 10 characters.", "err");
      password.focus();
      return;
    }
    email.removeAttribute("aria-invalid");
    password.removeAttribute("aria-invalid");

    busy(form, true, "Creating…");
    say(msg, "");
    try {
      const { res, body } = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: e, password: password.value }),
      });
      if (res.ok) {
        afterAuth();
        return;
      }
      if (res.status === 409) say(msg, "An account with that address already exists.", "err");
      else if (res.status === 429) say(msg, "Too many attempts. Wait a few minutes.", "err");
      else if (res.status === 422) say(msg, (body && body.message) || "Check the details above.", "err");
      else say(msg, "Could not create the account. Try again.", "err");
    } catch {
      say(msg, "No connection to the server. Try again.", "err");
    } finally {
      password.value = "";
      busy(form, false);
    }
  });
}

/* ── reset ───────────────────────────────────────────────────── */

function wireReset(form) {
  const token = new URLSearchParams(location.search).get("token") || "";
  const email = form.querySelector("#email");
  const password = form.querySelector("#password");
  const msg = form.querySelector("[data-msg]");
  const requestOnly = form.querySelector("[data-request-only]");
  const confirmOnly = form.querySelector("[data-confirm-only]");
  const title = document.querySelector("[data-title]");
  const sub = document.querySelector("[data-sub]");

  if (token) {
    form.dataset.mode = "confirm";
    if (requestOnly) requestOnly.hidden = true;
    if (confirmOnly) confirmOnly.hidden = false;
    if (title) title.textContent = "Choose a new password";
    if (sub) sub.textContent = "The link works once, then it is spent.";
    const span = form.querySelector("[data-label]");
    if (span) span.textContent = "Set new password";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton(form).disabled) return;

    if (form.dataset.mode === "confirm") {
      if (password.value.length < 10) {
        password.setAttribute("aria-invalid", "true");
        say(msg, "Use at least 10 characters.", "err");
        password.focus();
        return;
      }
      busy(form, true, "Saving…");
      say(msg, "");
      try {
        const { res } = await api("/api/auth/reset/confirm", {
          method: "POST",
          body: JSON.stringify({ token, password: password.value }),
        });
        if (res.ok) {
          say(msg, "Password changed. Taking you to sign in…", "ok");
          setTimeout(() => location.replace("/login"), 900);
        } else if (res.status === 410) {
          say(msg, "That link has expired. Request a new one.", "err");
        } else {
          say(msg, "Could not change the password. Request a new link.", "err");
        }
      } catch {
        say(msg, "No connection to the server. Try again.", "err");
      } finally {
        busy(form, false);
      }
      return;
    }

    const e = email.value.trim().toLowerCase();
    if (!validEmail(e)) {
      email.setAttribute("aria-invalid", "true");
      say(msg, "Enter the address on the account.", "err");
      email.focus();
      return;
    }
    busy(form, true, "Sending…");
    say(msg, "");
    try {
      const { res } = await api("/api/auth/reset/request", {
        method: "POST",
        body: JSON.stringify({ email: e }),
      });
      if (res.ok) {
        say(msg, "If that address has an account, a link is on its way.", "ok");
        form.reset();
      } else if (res.status === 429) {
        say(msg, "Too many requests. Wait a few minutes.", "err");
      } else {
        say(msg, "Could not send the link. Try again.", "err");
      }
    } catch {
      say(msg, "No connection to the server. Try again.", "err");
    } finally {
      busy(form, false);
    }
  });
}

/* ── dashboard ───────────────────────────────────────────────── */

const RULES = {
  on_confirm: "On confirmation",
  on_date: "On a set date",
  undecided: "Not decided",
};

function wireDashboard() {
  const panel = document.querySelector("[data-panel]");
  const empty = document.querySelector("[data-empty]");
  const dialog = document.getElementById("entry-dialog");
  const form = document.querySelector("[data-entry-form]");
  const msg = document.querySelector("[data-entry-msg]");
  const who = document.querySelector("[data-who]");
  const accountEmail = document.querySelector("[data-account-email]");

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      /* cookie is cleared server-side regardless */
    }
    location.replace("/login");
  };
  for (const b of document.querySelectorAll("[data-logout]")) b.addEventListener("click", signOut);

  const render = (entries) => {
    if (!panel) return;
    panel.querySelectorAll(".panel__row").forEach((n) => n.remove());

    if (!entries.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "panel__row";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "panel__title";
      title.textContent = entry.title;
      const meta = document.createElement("div");
      meta.className = "panel__meta";
      meta.textContent = `Sealed ${new Date(entry.created_at * 1000).toLocaleDateString()} · ${RULES[entry.release_rule] || "Not decided"}`;
      left.append(title, meta);

      const to = document.createElement("div");
      to.className = "panel__to";
      to.textContent = entry.recipient || "No recipient named";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--quiet";
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        if (!confirm(`Remove “${entry.title}” permanently?`)) return;
        del.disabled = true;
        const { res } = await api(`/api/entries/${entry.id}`, { method: "DELETE" });
        if (res.ok) load();
        else del.disabled = false;
      });

      row.append(left, to, del);
      panel.append(row);
    }
  };

  const load = async () => {
    const { res, body } = await api("/api/entries");
    if (res.status === 401) {
      location.replace("/login?next=/app");
      return null;
    }
    if (res.ok && body && Array.isArray(body.entries)) {
      render(body.entries);
      return body.entries;
    }
    return null;
  };

  const open = () => {
    if (!dialog) return;
    form.reset();
    say(msg, "");
    dialog.showModal();
    form.querySelector("#title").focus();
  };
  for (const b of document.querySelectorAll("[data-new]")) b.addEventListener("click", open);
  const cancel = document.querySelector("[data-cancel]");
  if (cancel) cancel.addEventListener("click", () => dialog.close());

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const save = form.querySelector("[data-save]");
      if (save.disabled) return;
      const payload = {
        title: form.querySelector("#title").value.trim(),
        recipient: form.querySelector("#recipient").value.trim(),
        recipient_email: form.querySelector("#recipient_email").value.trim().toLowerCase(),
        release_rule: form.querySelector("#release_rule").value,
        body: form.querySelector("#body").value,
      };
      if (!payload.title) {
        say(msg, "Give the entry a name.", "err");
        form.querySelector("#title").focus();
        return;
      }
      const span = save.querySelector("[data-label]");
      save.disabled = true;
      if (span) span.textContent = "Sealing…";
      say(msg, "");
      try {
        const { res, body } = await api("/api/entries", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          dialog.close();
          await load();
        } else if (res.status === 401) {
          location.replace("/login?next=/app");
        } else if (res.status === 422) {
          say(msg, (body && body.message) || "Check the fields above.", "err");
        } else {
          say(msg, "Could not save the entry. Try again.", "err");
        }
      } catch {
        say(msg, "No connection to the server. Try again.", "err");
      } finally {
        save.disabled = false;
        if (span) span.textContent = "Seal entry";
      }
    });
  }

  (async () => {
    const me = await api("/api/auth/me");
    if (me.res.status === 401) {
      location.replace("/login?next=/app");
      return;
    }
    const email = me.body && me.body.email ? me.body.email : "";
    if (who) who.textContent = email || "Signed in";
    if (accountEmail) accountEmail.textContent = email || "Not set";
    await load();
  })();
}

/* ── dispatch ────────────────────────────────────────────────── */

/* heirs ---------------------------------------------------------- */

const HEIR_STATUS = {
  ready: "Not invited",
  invited: "Invitation sent",
  active: "Has access",
};

function wireHeirs() {
  const panel = document.querySelector("[data-heirs]");
  if (!panel) return;
  const empty = document.querySelector("[data-heirs-empty]");
  const dialog = document.getElementById("heir-dialog");
  const form = document.querySelector("[data-heir-form]");
  const msg = document.querySelector("[data-heir-msg]");

  const draw = (heirs) => {
    panel.querySelectorAll(".panel__row").forEach((n) => n.remove());
    if (!heirs.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    for (const heir of heirs) {
      const row = document.createElement("div");
      row.className = "panel__row";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "panel__title";
      title.textContent = heir.name || "Unnamed";
      const meta = document.createElement("div");
      meta.className = "panel__meta";
      meta.textContent = heir.email;
      left.append(title, meta);

      const middle = document.createElement("div");
      middle.className = "panel__to";
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = HEIR_STATUS[heir.status] || heir.status;
      middle.append(tag);

      const actions = document.createElement("div");
      actions.className = "panel__to";
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.justifyContent = "flex-end";
      actions.style.flexWrap = "wrap";

      if (heir.status === "ready" || heir.status === "invited") {
        const send = document.createElement("button");
        send.type = "button";
        send.className = "btn btn--quiet";
        send.textContent = heir.status === "invited" ? "Send again" : "Send invitation";
        send.addEventListener("click", () => invite(heir, send));
        actions.append(send);
      }

      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "btn btn--quiet";
      drop.textContent = heir.status === "active" ? "Withdraw access" : "Remove";
      drop.addEventListener("click", () => revoke(heir, drop));
      actions.append(drop);

      row.append(left, middle, actions);
      panel.append(row);
    }
  };

  const invite = async (heir, button) => {
    const label = heir.name || heir.email;
    const ok = window.confirm(
      `Give ${label} the whole vault, read-only?\n\nThey will be able to read every entry. You can withdraw it at any time.`
    );
    if (!ok) return;
    button.disabled = true;
    say(msg, "");
    try {
      const { res, body } = await api(`/api/heirs/${heir.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      if (res.ok) load();
      else if (res.status === 401) location.replace("/login?next=/app");
      else window.alert((body && body.message) || "The invitation could not be sent. Try again.");
    } catch {
      window.alert("No connection to the server. Try again.");
    } finally {
      button.disabled = false;
    }
  };

  const revoke = async (heir, button) => {
    const label = heir.name || heir.email;
    const ok = window.confirm(
      heir.status === "active"
        ? `Withdraw ${label}'s access?\n\nThe link they hold stops working immediately.`
        : `Remove ${label} from the list?`
    );
    if (!ok) return;
    button.disabled = true;
    try {
      const { res } = await api(`/api/heirs/${heir.id}`, { method: "DELETE" });
      if (res.ok) load();
      else if (res.status === 401) location.replace("/login?next=/app");
    } finally {
      button.disabled = false;
    }
  };

  const load = async () => {
    const { res, body } = await api("/api/heirs");
    if (res.status === 401) {
      location.replace("/login?next=/app");
      return;
    }
    draw(res.ok && body && Array.isArray(body.heirs) ? body.heirs : []);
  };

  const openDialog = () => {
    if (!dialog) return;
    form.reset();
    say(msg, "");
    dialog.showModal();
    form.querySelector("#heir_name").focus();
  };

  for (const b of document.querySelectorAll("[data-new-heir]")) b.addEventListener("click", openDialog);

  const cancel = document.querySelector("[data-heir-cancel]");
  if (cancel) cancel.addEventListener("click", () => dialog.close());

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const save = form.querySelector("[data-heir-save]");
      if (save.disabled) return;
      const email = form.querySelector("#heir_email").value.trim().toLowerCase();
      const name = form.querySelector("#heir_name").value.trim();
      if (!email) {
        say(msg, "Add their email address.", "err");
        return;
      }
      const span = save.querySelector("[data-label]");
      save.disabled = true;
      if (span) span.textContent = "Saving";
      say(msg, "");
      try {
        const { res, body } = await api("/api/heirs", {
          method: "POST",
          body: JSON.stringify({ name, email }),
        });
        if (res.ok) {
          dialog.close();
          await load();
        } else if (res.status === 422) {
          say(msg, (body && body.message) || "Check the details above.", "err");
        } else if (res.status === 401) {
          location.replace("/login?next=/app");
        } else {
          say(msg, "Could not save that person. Try again.", "err");
        }
      } catch {
        say(msg, "No connection to the server. Try again.", "err");
      } finally {
        save.disabled = false;
        if (span) span.textContent = "Save";
      }
    });
  }

  load();
}

const form = document.querySelector("form[data-mode], form#form");
const isDashboard = document.querySelector("[data-panel]") !== null;

if (isDashboard) {
  wireDashboard();
  wireHeirs();
} else if (form) {
  if (path === "/reset" || path.endsWith("/reset.html")) wireReset(form);
  else if (path === "/register" || path.endsWith("/register.html")) wireRegister(form);
  else wireLogin(form);
}
