import { env } from "../env";
import { log } from "../logger";
import type { EmailRow, RenderedEmail } from "./outbox";

/**
 * Email provider adapters.
 *
 *  file   — development/tests: the full message is persisted to the database
 *           outbox (status 'sent' means stored, not delivered anywhere).
 *  smtp   — real delivery through SMTP_URL (Mailpit locally, SES/Postmark/… in prod).
 *  resend — Resend HTTP API.
 *
 * A provider error is reported honestly: the message goes back to 'queued'
 * with backoff, then to 'failed' (dead-letter) — never to a fake 'sent'.
 */

export interface SendResult {
  ok: boolean;
  provider: string;
  providerMessageId?: string;
  errorCode?: string;
  errorDetail?: string;
  /** file adapter: marks that nothing left this machine. */
  storedOnly?: boolean;
}

export interface EmailProviderAdapter {
  name: string;
  configured(): boolean;
  send(message: EmailRow): Promise<SendResult>;
}

async function fileAdapter(): Promise<EmailProviderAdapter> {
  return {
    name: "file",
    configured: () => true,
    async send(message) {
      // Message bodies are already persisted on the email_messages row; this
      // adapter marks delivery as stored-only. Never call it in production
      // (env validation forbids EMAIL_PROVIDER=file there).
      log.info("email_stored_file_adapter", { messageId: message.id, template: message.template });
      return { ok: true, provider: "file", providerMessageId: `file:${message.id}`, storedOnly: true };
    },
  };
}

function smtpAdapter(): EmailProviderAdapter {
  return {
    name: "smtp",
    configured: () => Boolean(process.env.SMTP_URL),
    async send(message) {
      const smtpUrl = process.env.SMTP_URL;
      if (!smtpUrl) {
        return { ok: false, provider: "smtp", errorCode: "smtp_not_configured", errorDetail: "SMTP_URL is not set" };
      }
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport(smtpUrl);
      try {
        const info = await transport.sendMail({
          from: env().EMAIL_FROM,
          to: message.toEmail,
          subject: message.subject,
          text: message.textBody,
          html: message.htmlBody,
          headers: { "X-AfterKey-Message-Id": message.id },
        });
        return { ok: true, provider: "smtp", providerMessageId: info.messageId ?? undefined };
      } catch (err) {
        const e = err as { responseCode?: number; message?: string };
        return {
          ok: false,
          provider: "smtp",
          errorCode: e.responseCode ? `smtp_${e.responseCode}` : "smtp_error",
          errorDetail: (e.message ?? "SMTP send failed").slice(0, 300),
        };
      } finally {
        transport.close();
      }
    },
  };
}

function resendAdapter(): EmailProviderAdapter {
  return {
    name: "resend",
    configured: () => Boolean(process.env.RESEND_API_KEY),
    async send(message) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return { ok: false, provider: "resend", errorCode: "resend_not_configured", errorDetail: "RESEND_API_KEY is not set" };
      }
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env().EMAIL_FROM,
            to: [message.toEmail],
            subject: message.subject,
            html: message.htmlBody,
            text: message.textBody,
            headers: { "X-AfterKey-Message-Id": message.id },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          return {
            ok: false,
            provider: "resend",
            errorCode: `resend_${res.status}`,
            errorDetail: bodyText.slice(0, 300) || res.statusText,
          };
        }
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, provider: "resend", providerMessageId: data.id };
      } catch (err) {
        return {
          ok: false,
          provider: "resend",
          errorCode: "resend_network_error",
          errorDetail: (err instanceof Error ? err.message : "request failed").slice(0, 300),
        };
      }
    },
  };
}

export async function getEmailProvider(): Promise<EmailProviderAdapter> {
  switch (env().EMAIL_PROVIDER) {
    case "smtp":
      return smtpAdapter();
    case "resend":
      return resendAdapter();
    case "file":
    default:
      return fileAdapter();
  }
}

export interface EmailProviderStatus {
  provider: string;
  configured: boolean;
  sending: boolean;
  hint?: string;
}

export async function emailProviderStatus(): Promise<EmailProviderStatus> {
  const provider = await getEmailProvider();
  const configured = provider.configured();
  const hint = !configured
    ? env().EMAIL_PROVIDER === "smtp"
      ? "Set SMTP_URL to a reachable SMTP endpoint."
      : env().EMAIL_PROVIDER === "resend"
        ? "Set RESEND_API_KEY to a Resend API key."
        : undefined
    : env().EMAIL_PROVIDER === "file"
      ? "Messages are stored in the database only — configure SMTP or Resend to actually deliver email."
      : undefined;
  return { provider: provider.name, configured, sending: configured && env().EMAIL_PROVIDER !== "file", hint };
}

/** Used by the worker: deliver one message end-to-end. */
export async function deliverEmail(message: EmailRow): Promise<SendResult> {
  const provider = await getEmailProvider();
  if (!provider.configured()) {
    return {
      ok: false,
      provider: provider.name,
      errorCode: "provider_not_configured",
      errorDetail: `Email provider '${provider.name}' is not configured`,
    };
  }
  return provider.send(message);
}

/** Health probe used by /api/ready (no secrets returned). */
export async function probeEmail(): Promise<{ ok: boolean; detail: string }> {
  const status = await emailProviderStatus();
  if (!status.configured) return { ok: false, detail: status.hint ?? "email provider not configured" };
  if (status.provider === "file") return { ok: true, detail: "file outbox (messages stored, not delivered)" };
  return { ok: true, detail: `${status.provider} configured` };
}

/** Record a provider webhook event (bounces etc.) when the provider reports one. */
export async function recordProviderDeliveryEvent(
  messageId: string | null,
  type: "bounced" | "complained" | "failed",
  detail: string,
): Promise<void> {
  if (!messageId) return;
  const { markEmailDeliveryEvent } = await import("./outbox");
  await markEmailDeliveryEvent(messageId, type, detail);
}

export type { RenderedEmail };
