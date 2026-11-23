// AfterKey — the page a recipient opens from the email.
// One token in the query string, one request, no account, no cookie.

const card = document.querySelector("[data-state]");
const ready = document.querySelector("[data-ready]");
const pending = document.querySelector("[data-pending]");
const closed = document.querySelector("[data-closed]");
const outFrom = document.querySelector("[data-from]");
const outTitle = document.querySelector("[data-title]");
const outBody = document.querySelector("[data-body]");
const outFoot = document.querySelector("[data-foot]");

const setState = (name) => {
  if (card) card.dataset.state = name;
  if (pending) pending.hidden = name !== "loading";
  if (ready) ready.hidden = name !== "ready";
  if (closed) closed.hidden = name !== "closed";
};

const token = new URLSearchParams(window.location.search).get("token") || "";

const day = (seconds) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const closeWith = (heading, text) => {
  if (closed) {
    const h = closed.querySelector("h1");
    const p = closed.querySelector(".rel__text");
    if (h) h.textContent = heading;
    if (p) p.textContent = text;
  }
  setState("closed");
};

const open_ = async () => {
  if (!token) {
    closeWith("This link is not complete.", "Ask the person who sent it for the full link.");
    return;
  }

  let res;
  try {
    res = await fetch(`/api/release/${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    closeWith(
      "The note could not be checked.",
      "Your connection dropped. Reload this page when you are back online."
    );
    return;
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.status === 410) {
    closeWith(
      "This link is no longer open.",
      "It may have expired, or the person who sent it closed it. Ask them for a new one if you still need it."
    );
    return;
  }
  if (res.status === 429) {
    closeWith("Too many attempts.", "Wait a little while, then open the link again.");
    return;
  }
  if (!res.ok || !body || body.ok !== true) {
    closeWith("This link is not working.", "Reload the page, or ask the sender for a new link.");
    return;
  }

  if (outFrom) {
    outFrom.textContent = body.from
      ? `${body.from} asked that this reach you`
      : "This was left for you";
  }
  if (outTitle) outTitle.textContent = body.title || "";
  if (outBody) outBody.textContent = body.body || "";
  if (outFoot) {
    const parts = [];
    if (body.recipient) parts.push(`For ${body.recipient}`);
    if (body.expires_at) parts.push(`Open until ${day(body.expires_at)}`);
    outFoot.textContent = parts.join(" · ");
  }

  setState("ready");
  document.title = `${body.title || "A private note"} | AfterKey`;
};

setState("loading");
open_();
