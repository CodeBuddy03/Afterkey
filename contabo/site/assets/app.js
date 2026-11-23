// AfterKey — interaction layer. No dependencies, no inline handlers.

const nav = document.querySelector("[data-nav]");
const toggle = document.querySelector("[data-nav-toggle]");
const menu = document.querySelector("[data-mobile-menu]");

/* ── sticky nav ─────────────────────────────────────────── */
if (nav) {
  const onScroll = () => {
    nav.classList.toggle("is-stuck", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/* ── mobile menu ────────────────────────────────────────── */
if (nav && toggle && menu) {
  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  };

  toggle.addEventListener("click", () => {
    setOpen(!nav.classList.contains("is-open"));
  });

  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) setOpen(false);
  });

  window.matchMedia("(min-width: 901px)").addEventListener("change", (e) => {
    if (e.matches) setOpen(false);
  });
}

/* ── section reveals ────────────────────────────────────── */
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const targets = document.querySelectorAll(".reveal");

if (reduced || !("IntersectionObserver" in window)) {
  targets.forEach((el) => el.classList.add("is-in"));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  targets.forEach((el) => io.observe(el));
}

/* ── access form ────────────────────────────────────────── */
const form = document.querySelector("[data-form]");

if (form) {
  const input = form.querySelector("#email");
  const button = form.querySelector("[data-submit]");
  const msg = form.querySelector("[data-msg]");
  const honeypot = form.querySelector("[data-hp]");
  const WAIT = new Set(["Sending…", "Sending..."]);

  const say = (text, state) => {
    if (!msg) return;
    msg.textContent = text;
    if (state) msg.dataset.state = state;
    else delete msg.dataset.state;
  };

  const valid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input || !button || button.disabled) return;

    const email = input.value.trim();

    if (!valid(email)) {
      input.setAttribute("aria-invalid", "true");
      say("That address does not look complete.", "err");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");

    // Bot trap: answer as if accepted, send nothing.
    if (honeypot && honeypot.value) {
      say("You are on the list. Watch for a message from AfterKey.", "ok");
      form.reset();
      return;
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Sending…";
    say("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        say("You are on the list. Watch for a message from AfterKey.", "ok");
        form.reset();
      } else if (res.status === 422) {
        input.setAttribute("aria-invalid", "true");
        say("Enter a valid email address.", "err");
      } else if (res.status === 429) {
        say("Too many requests from this connection. Try again later.", "err");
      } else {
        say("Something went wrong on our side. Try again in a moment.", "err");
      }
    } catch {
      say("No connection to the server. Check your network and try again.", "err");
    } finally {
      button.disabled = false;
      button.textContent = WAIT.has(label) ? "Request access" : label;
    }
  });

  if (input) {
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid")) input.removeAttribute("aria-invalid");
    });
  }
}
