import type { EmailTemplate } from "./outbox";
import { appUrl } from "../urls";

/**
 * Email templates: professional, responsive HTML + plain text.
 *
 * Rules enforced here:
 *  - never include passwords, tokens in full beyond the single action link,
 *    recovery phrases, vault contents or private account data
 *  - no tracking pixels (privacy)
 *  - every template renders both HTML and text
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateVars = Record<string, string | undefined>;

const BRAND = "AfterKey";
const TAGLINE = "Your life. Your legacy. Your people.";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, bodyBlocks: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f1e8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#23262b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e2d8;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="background:#0f1b2d;padding:20px 28px;">
            <img src="${appUrl("/afterkey-wordmark-light.png")}" alt="${BRAND}" width="144" height="31" style="display:block;height:26px;width:auto;border:0;">
            <span style="display:block;font-size:12px;color:#c8a96a;margin-top:6px;">${TAGLINE}</span>
          </td>
        </tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;color:#0f1b2d;font-weight:600;">${esc(title)}</h1>
          ${bodyBlocks}
        </td></tr>
        <tr>
          <td style="background:#faf7f0;border-top:1px solid #e7e2d8;padding:16px 28px;font-size:12px;color:#5c6675;line-height:1.6;">
            AfterKey helps you organise essential records and instructions for the people you trust.
            AfterKey is not a bank, does not guarantee access to financial institutions, and does not replace legal advice.
            <br><br>If you did not expect this email, you can safely ignore it.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#33373d;">${text}</p>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:22px 0;">
    <a href="${esc(href)}" style="display:inline-block;background:#0f1b2d;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;">${esc(label)}</a>
  </p>`;
}

function note(text: string): string {
  return `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#5c6675;border-top:1px solid #e7e2d8;padding-top:14px;">${text}</p>`;
}

function paraList(items: string[]): string {
  return `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.7;color:#33373d;">${items
    .map((i) => `<li>${esc(i)}</li>`)
    .join("")}</ul>`;
}

interface Built {
  subject: string;
  html: string;
  text: string;
}

type Builder = (v: TemplateVars) => Built;

function pick(v: TemplateVars, key: string, fallback = ""): string {
  return v[key] ?? fallback;
}

const builders: Record<EmailTemplate, Builder> = {
  verify_email: (v) => ({
    subject: "Confirm your AfterKey email address",
    html: layout(
      "Confirm your email address",
      p(`Hi ${esc(pick(v, "name", "there"))},`) +
        p("Welcome to AfterKey. Confirm this email address so you can invite trusted recipients and configure release settings.") +
        button(pick(v, "url"), "Confirm email address") +
        note(`This link expires in ${esc(pick(v, "expiresIn", "24 hours"))}. If the button does not work, paste this link into your browser: ${esc(pick(v, "url"))}`),
    ),
    text: `Confirm your AfterKey email address\n\nHi ${pick(v, "name", "there")},\n\nConfirm this email address so you can invite trusted recipients and configure release settings.\n\nOpen: ${pick(v, "url")}\n\nThis link expires in ${pick(v, "expiresIn", "24 hours")}.\n`,
  }),

  welcome: (v) => ({
    subject: "Your AfterKey vault is ready",
    html: layout(
      "Your vault is ready",
      p(`Hi ${esc(pick(v, "name", "there"))},`) +
        p("Your AfterKey vault has been created. A few thoughtful steps now will save the people you love considerable difficulty later.") +
        paraList([
          "Add your essential financial and insurance records",
          "Store important documents privately",
          "Invite the recipients you trust",
          "Choose your check-in schedule and release preferences",
        ]) +
        button(pick(v, "url"), "Open your vault") +
        note("Take your time — you can save your progress and return at any point. Only add information you are comfortable storing."),
    ),
    text: `Your AfterKey vault is ready\n\nHi ${pick(v, "name", "there")},\n\nYour vault has been created. Next steps:\n- Add essential financial and insurance records\n- Store important documents privately\n- Invite trusted recipients\n- Choose your check-in schedule and release preferences\n\nOpen: ${pick(v, "url")}\n`,
  }),

  security_alert: (v) => ({
    subject: `Security alert: ${pick(v, "event", "account change")}`,
    html: layout(
      `Security alert: ${pick(v, "event", "account change")}`,
      p(`We detected an important change on your AfterKey account: <strong>${esc(pick(v, "event", "unknown activity"))}</strong>.`) +
        paraList([
          `Time: ${esc(pick(v, "time", "just now"))}`,
          `Approximate location: ${esc(pick(v, "location", "not available"))}`,
        ]) +
        p("If this was you, no further action is needed. If not, reset your password immediately and review your active sessions.") +
        button(pick(v, "url"), "Review security settings") +
        note("AfterKey will never ask you for your password, recovery phrase, or verification codes by email."),
    ),
    text: `Security alert: ${pick(v, "event", "account change")}\n\nEvent: ${pick(v, "event", "unknown activity")}\nTime: ${pick(v, "time", "just now")}\nLocation: ${pick(v, "location", "not available")}\n\nIf this was not you, reset your password and review your sessions:\n${pick(v, "url")}\n`,
  }),

  password_reset: (v) => ({
    subject: "Reset your AfterKey password",
    html: layout(
      "Reset your password",
      p(`Hi ${esc(pick(v, "name", "there"))},`) +
        p("We received a request to reset your AfterKey password.") +
        button(pick(v, "url"), "Choose a new password") +
        note(`This single-use link expires in ${esc(pick(v, "expiresIn", "30 minutes"))}. If you did not request this, you can ignore this email — your password will not change.`),
    ),
    text: `Reset your AfterKey password\n\nOpen: ${pick(v, "url")}\n\nThis single-use link expires in ${pick(v, "expiresIn", "30 minutes")}. If you did not request this, ignore this email.\n`,
  }),

  new_device: (v) => ({
    subject: "New sign-in to AfterKey",
    html: layout(
      "New sign-in to your account",
      p(`Your AfterKey account was accessed from a new device or browser.`) +
        paraList([
          `Device: ${esc(pick(v, "device", "Unknown device"))}`,
          `Time: ${esc(pick(v, "time", "just now"))}`,
        ]) +
        button(pick(v, "url"), "Review active sessions") +
        note("If this was not you, revoke the session and change your password immediately."),
    ),
    text: `New sign-in to AfterKey\n\nDevice: ${pick(v, "device", "Unknown device")}\nTime: ${pick(v, "time", "just now")}\n\nReview sessions: ${pick(v, "url")}\n`,
  }),

  recipient_invitation: (v) => ({
    subject: `${pick(v, "senderName", "Someone")} invited you to AfterKey`,
    html: layout(
      "You have been invited as a trusted recipient",
      p(`${esc(pick(v, "senderName", "Someone"))} has named you as a trusted recipient in their AfterKey vault.`) +
        p(pick(v, "intro", "Accepting the invitation confirms your email address and lets you receive content if a release ever occurs under their configured policy.")) +
        button(pick(v, "url"), "Review the invitation") +
        note(`This invitation expires on ${esc(pick(v, "expiresAt", "the date shown"))}. Being invited does not grant access to anyone's private vault contents now, and an invitation can be revoked at any time.`),
    ),
    text: `${pick(v, "senderName", "Someone")} invited you to AfterKey\n\nAccept the invitation:\n${pick(v, "url")}\n\nThis invitation expires on ${pick(v, "expiresAt", "the date shown")}. Being invited grants no access to private contents now.\n`,
  }),

  recipient_verification: (v) => ({
    subject: "Your AfterKey recipient access is confirmed",
    html: layout(
      "Your email address is confirmed",
      p(`Thanks — ${esc(pick(v, "email", "your email address"))} is now verified.`) +
        p(pick(v, "intro", "You will be notified if content is ever released to you under the policy of the person who invited you.")) +
        button(pick(v, "url"), "Open your recipient page"),
    ),
    text: `Your AfterKey recipient access is confirmed\n\n${pick(v, "email", "Your email")} is verified.\nOpen: ${pick(v, "url")}\n`,
  }),

  checkin_reminder: (v) => ({
    subject: `Check-in reminder: ${pick(v, "dueLabel", "your AfterKey check-in")} is due`,
    html: layout(
      "A quick check-in is due",
      p(`Hi ${esc(pick(v, "name", "there"))},`) +
        p(`Your AfterKey check-in is due on <strong>${esc(pick(v, "dueLabel", "soon"))}</strong> (${esc(pick(v, "timezone", "your timezone"))}).`) +
        p(pick(v, "detail", "Confirming that you are OK keeps your scheduled workflows paused. Nothing else happens if you check in on time.")) +
        button(pick(v, "url"), "Check in now") +
        note(`If you do not check in, your configured grace period begins after the due time: ${esc(pick(v, "consequence", "reminders continue, and your release policy (if enabled) begins its verification process."))}`),
    ),
    text: `Check-in reminder\n\nHi ${pick(v, "name", "there")},\n\nYour check-in is due on ${pick(v, "dueLabel", "soon")} (${pick(v, "timezone", "your timezone")}).\n\nCheck in: ${pick(v, "url")}\n`,
  }),

  checkin_overdue: (v) => ({
    subject: "Your AfterKey check-in is overdue",
    html: layout(
      "Your check-in is overdue",
      p(`Hi ${esc(pick(v, "name", "there"))},`) +
        p(`We have not received your check-in. This does <strong>not</strong> mean anything has happened to you — we simply have not heard from you.`) +
        p(`Your grace period ends on <strong>${esc(pick(v, "graceEndsLabel", "the date shown"))}</strong>.`) +
        button(pick(v, "url"), "Confirm you are OK") +
        note(pick(v, "consequence", "If the grace period ends without a check-in, your configured verification procedure begins before any release can happen.")),
    ),
    text: `Your AfterKey check-in is overdue\n\nHi ${pick(v, "name", "there")},\n\nWe have not received your check-in. Grace period ends: ${pick(v, "graceEndsLabel", "see app")}.\n\nConfirm you are OK: ${pick(v, "url")}\n`,
  }),

  escalation_notice: (v) => ({
    subject: "Verification required for an AfterKey check-in",
    html: layout(
      "A check-in needs verification",
      p(`${esc(pick(v, "ownerName", "An AfterKey user"))} has missed a check-in according to their configured schedule.`) +
        p(pick(v, "detail", "Before anything can be shared, their configured verification procedure must be completed. Nothing has been released.")) +
        button(pick(v, "url"), "Open the verification page") +
        note("Please only respond if you genuinely believe the person is unavailable. Your response is recorded in the security audit log."),
    ),
    text: `Verification required\n\n${pick(v, "ownerName", "An AfterKey user")} missed a check-in. Nothing has been released. Verification is required.\n\nOpen: ${pick(v, "url")}\n`,
  }),

  release_otp: (v) => ({
    subject: "Confirm you are OK — AfterKey verification code",
    html: layout(
      "Confirm you are OK",
      p(`Hi ${esc(pick(v, "name", "there"))},`) +
        p("We have not received your scheduled check-in, so your configured verification procedure has started.") +
        p(`If you are reading this, enter this code to stop the process immediately: <strong style="font-size:24px;letter-spacing:0.3em;color:#0f1b2d;">${esc(pick(v, "code", "------"))}</strong>`) +
        button(pick(v, "url"), "Enter the code now") +
        note(`The code expires in ${esc(pick(v, "expiresIn", "24 hours"))}. Nothing has been shared with anyone. This code only proves that you, the account owner, are reading your email.`),
    ),
    text: `Confirm you are OK\n\nHi ${pick(v, "name", "there")},\n\nYour verification code: ${pick(v, "code", "------")}\n\nEnter it here: ${pick(v, "url")}\n\nExpires in ${pick(v, "expiresIn", "24 hours")}. Nothing has been shared.\n`,
  }),

  release_scheduled: (v) => ({
    subject: "Action needed: a release has been scheduled",
    html: layout(
      "A release has been scheduled",
      p(`Hi ${esc(pick(v, "name", "there"))},`) +
        p(`Your verification procedure reported that you may be unavailable, so a release of selected content is now scheduled for <strong>${esc(pick(v, "releaseAtLabel", "the time shown"))}</strong>.`) +
        p("If you are reading this, you can cancel it immediately after confirming your identity.") +
        button(pick(v, "url"), "Cancel the scheduled release") +
        note(pick(v, "consequence", "Cancelling requires your password (reauthentication). The two-hour delay is an additional safety control, not proof of anything.")),
    ),
    text: `A release has been scheduled for ${pick(v, "releaseAtLabel", "the time shown")}.\n\nIf you are alive and well, cancel it here:\n${pick(v, "url")}\n`,
  }),

  release_canceled: (v) => ({
    subject: "Scheduled release cancelled",
    html: layout(
      "The scheduled release was cancelled",
      p(`The release opened on ${esc(pick(v, "openedAtLabel", "the date shown"))} was cancelled and no content will be disclosed.`) +
        paraList([
          `Cancelled by: ${esc(pick(v, "actor", "you"))}`,
          `Time: ${esc(pick(v, "time", "just now"))}`,
        ]) +
        button(pick(v, "url"), "Open your check-in settings") +
        note("All pending jobs for that release have been invalidated."),
    ),
    text: `Scheduled release cancelled.\nCancelled by: ${pick(v, "actor", "you")}\nTime: ${pick(v, "time", "just now")}\n\nOpen: ${pick(v, "url")}\n`,
  }),

  release_ready: (v) => ({
    subject: "Content is available to you in AfterKey",
    html: layout(
      "Released content is available",
      p(`${esc(pick(v, "senderName", "Someone"))} configured AfterKey to release selected content to you if their verification procedure completed without a response from them.`) +
        p(`That procedure has completed, and <strong>${esc(pick(v, "itemCount", "some"))}</strong> item(s) are now available to you.`) +
        button(pick(v, "url"), "Open the released content") +
        note(`This access link is single-use and expires on ${esc(pick(v, "expiresAt", "the date shown"))}. You will be asked to confirm your email address first. If you believe this is a mistake, contact the sender's trusted contacts — you cannot undo a release from your side.`),
    ),
    text: `${pick(v, "senderName", "Someone")} released content to you.\n\nOpen: ${pick(v, "url")}\n\nThis link is single-use and expires ${pick(v, "expiresAt", "see link")}.\n`,
  }),

  delivery_failed: (v) => ({
    subject: "AfterKey could not deliver a notification",
    html: layout(
      "A notification could not be delivered",
      p(`AfterKey tried to notify <strong>${esc(pick(v, "to", "a recipient"))}</strong> but the provider reported a failure.`) +
        paraList([
          `Template: ${esc(pick(v, "template", "unknown"))}`,
          `Reason: ${esc(pick(v, "reason", "provider error"))}`,
          `Time: ${esc(pick(v, "time", "just now"))}`,
        ]) +
        button(pick(v, "url"), "Open email operations") +
        note("No private content was included in the failed message."),
    ),
    text: `A notification to ${pick(v, "to", "a recipient")} failed.\nTemplate: ${pick(v, "template", "unknown")}\nReason: ${pick(v, "reason", "provider error")}\n`,
  }),

  account_change: (v) => ({
    subject: `AfterKey account change: ${pick(v, "event", "details updated")}`,
    html: layout(
      `Account change: ${pick(v, "event", "details updated")}`,
      p(`A change was made to your AfterKey account: <strong>${esc(pick(v, "event", "account details"))}</strong>.`) +
        paraList([
          `Time: ${esc(pick(v, "time", "just now"))}`,
          ...(pick(v, "detail") ? [`Detail: ${esc(pick(v, "detail"))}`] : []),
        ]) +
        button(pick(v, "url"), "Review your account") +
        note("If you did not make this change, reset your password and revoke your sessions now."),
    ),
    text: `Account change: ${pick(v, "event", "account details")}\n\nTime: ${pick(v, "time", "just now")}\nDetail: ${pick(v, "detail", "-")}\n\nReview: ${pick(v, "url")}\n`,
  }),

  admin_alert: (v) => ({
    subject: `AfterKey operations alert: ${pick(v, "headline", "attention required")}`,
    html: layout(
      `Operations alert: ${pick(v, "headline", "attention required")}`,
      p(`<strong>${esc(pick(v, "headline", "attention required"))}</strong>`) +
        `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;background:#faf7f0;border:1px solid #e7e2d8;border-radius:8px;padding:14px;color:#33373d;">${esc(pick(v, "body", ""))}</pre>` +
        note("This operational alert never contains user vault contents."),
    ),
    text: `Operations alert: ${pick(v, "headline", "attention required")}\n\n${pick(v, "body", "")}\n`,
  }),

  data_export_ready: (v) => ({
    subject: "Your AfterKey data export is ready",
    html: layout(
      "Your data export is ready",
      p("Your personal data export has been generated. The file is stored privately in your vault and is only downloadable by you.") +
        button(pick(v, "url"), "Download your export") +
        note("The export contains your own data only. It expires after 7 days and can be regenerated at any time."),
    ),
    text: `Your data export is ready.\n\nDownload: ${pick(v, "url")}\n`,
  }),

  account_deletion_scheduled: (v) => ({
    subject: "Your AfterKey account deletion is scheduled",
    html: layout(
      "Account deletion scheduled",
      p(`Your account is scheduled for permanent deletion on <strong>${esc(pick(v, "executeAfterLabel", "the date shown"))}</strong>.`) +
        p("Until then your account is locked. You can cancel the deletion by signing in before that time.") +
        button(pick(v, "url"), "Sign in to cancel the deletion") +
        note("Some records (such as security audit entries and billing references) are retained where the law requires it — see our Privacy Policy."),
    ),
    text: `Your account is scheduled for deletion on ${pick(v, "executeAfterLabel", "the date shown")}.\n\nYou can cancel by signing in:\n${pick(v, "url")}\n`,
  }),
};

export function renderEmail(template: EmailTemplate, vars: TemplateVars): RenderedEmail {
  const builder = builders[template];
  if (!builder) throw new Error(`Unknown email template: ${template}`);
  const built = builder(vars);
  return { subject: built.subject, html: built.html, text: built.text };
}

export const EMAIL_TEMPLATE_NAMES = Object.keys(builders) as EmailTemplate[];
