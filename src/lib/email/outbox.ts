import { db, withTransaction, type Tx } from "../db";
import type { Queryable } from "../db";

/**
 * Transactional email outbox. Messages are written in the SAME transaction as
 * the state change that caused them, so a committed state change always has a
 * queued message (and a rollback never sends mail). The worker delivers them
 * through the configured provider adapter.
 *
 * Nothing here reports success before a provider actually accepts the message.
 */

export type EmailTemplate =
  | "verify_email"
  | "welcome"
  | "security_alert"
  | "password_reset"
  | "new_device"
  | "recipient_invitation"
  | "recipient_verification"
  | "checkin_reminder"
  | "checkin_overdue"
  | "escalation_notice"
  | "release_otp"
  | "release_scheduled"
  | "release_canceled"
  | "release_ready"
  | "delivery_failed"
  | "account_change"
  | "admin_alert"
  | "data_export_ready"
  | "account_deletion_scheduled";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface QueueEmailInput {
  to: string;
  template: EmailTemplate;
  rendered: RenderedEmail;
  userId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  /** Unique key: queued twice with the same key only sends once. */
  dedupeKey?: string | null;
  maxAttempts?: number;
}

export async function queueEmail(input: QueueEmailInput, exec: Queryable = db): Promise<string | null> {
  const row = await exec.q1<{ id: string }>(
    `INSERT INTO email_messages
       (to_email, to_user_id, template, subject, html_body, text_body, dedupe_key, related_type, related_id, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      input.to.toLowerCase(),
      input.userId ?? null,
      input.template,
      input.rendered.subject,
      input.rendered.html,
      input.rendered.text,
      input.dedupeKey ?? null,
      input.relatedType ?? null,
      input.relatedId ?? null,
      input.maxAttempts ?? 6,
    ],
  );
  if (!row) return null; // deduped: an identical message was already queued

  await exec.q(
    `INSERT INTO email_events (message_id, type) VALUES ($1, 'queued')`,
    [row.id],
  );
  return row.id;
}

export interface EmailRow {
  id: string;
  toEmail: string;
  template: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  status: "queued" | "sending" | "sent" | "failed" | "bounced" | "complained" | "canceled";
  attempts: number;
  maxAttempts: number;
  provider: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export async function claimEmailForSending(messageId: string): Promise<EmailRow | null> {
  return withTransaction(async (tx) => {
    const row = await tx.q1<EmailRow>(
      `UPDATE email_messages
          SET status = 'sending', attempts = attempts + 1, updated_at = now()
        WHERE id = $1
          AND status IN ('queued', 'failed')
          AND attempts < max_attempts
        RETURNING id, to_email, template, subject, html_body, text_body, status,
                  attempts, max_attempts, provider, provider_message_id,
                  error_code, error_detail, created_at, sent_at`,
      [messageId],
    );
    if (!row) {
      await tx.raw(
        `INSERT INTO email_events (message_id, type) SELECT id, 'canceled' FROM email_messages WHERE id = $1
           AND status = 'queued' AND attempts >= max_attempts`,
        [messageId],
      );
      return null;
    }
    return row;
  });
}

export async function markEmailSent(
  messageId: string,
  provider: string,
  providerMessageId: string | null,
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.raw(
      `UPDATE email_messages
          SET status = 'sent', provider = $2, provider_message_id = $3,
              sent_at = now(), error_code = NULL, error_detail = NULL
        WHERE id = $1`,
      [messageId, provider, providerMessageId],
    );
    await tx.raw(`INSERT INTO email_events (message_id, type) VALUES ($1, 'sent')`, [messageId]);
  });
}

export async function markEmailFailed(messageId: string, code: string, detail: string): Promise<void> {
  await withTransaction(async (tx) => {
    const row = await tx.q1<{ attempts: number; maxAttempts: number }>(
      `UPDATE email_messages
          SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
              error_code = $2, error_detail = $3, provider = NULL
        WHERE id = $1
        RETURNING attempts, max_attempts`,
      [messageId, code, detail.slice(0, 500)],
    );
    if (row) {
      await tx.raw(
        `INSERT INTO email_events (message_id, type, detail)
         VALUES ($1, $2, $3)`,
        [messageId, row.attempts >= row.maxAttempts ? "failed" : "retry_scheduled", code],
      );
      if (row.attempts >= row.maxAttempts) {
        // Dead-letter: queue one operational alert for administrators.
        await queueDeadLetterAlert(tx, messageId, code, detail);
      }
    }
  });
}

export async function markEmailDeliveryEvent(
  messageId: string,
  event: "bounced" | "complained" | "failed",
  detail: string,
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.raw(`UPDATE email_messages SET status = $2, error_detail = $3 WHERE id = $1`, [
      messageId,
      event,
      detail.slice(0, 500),
    ]);
    await tx.raw(`INSERT INTO email_events (message_id, type, detail) VALUES ($1, $2, $3)`, [
      messageId,
      event,
      detail.slice(0, 300),
    ]);
  });
}

async function queueDeadLetterAlert(tx: Tx, messageId: string, code: string, detail: string): Promise<void> {
  const adminEmail = process.env.EMAIL_ADMIN_ADDRESS ?? "admin@afterkey.com";
  const { renderEmail } = await import("./templates");
  const rendered = renderEmail("admin_alert", {
    headline: "Email dead-letter",
    body: `Message ${messageId} exhausted its retries.\nCode: ${code}\nDetail: ${detail.slice(0, 300)}`,
  });
  await queueEmail(
    {
      to: adminEmail,
      template: "admin_alert",
      rendered,
      relatedType: "email_message",
      relatedId: messageId,
      dedupeKey: `deadletter:${messageId}`,
    },
    tx,
  );
}

export interface EmailStats {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  bounced: number;
  complained: number;
}

export async function emailStats(): Promise<EmailStats> {
  const rows = await db.q<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count FROM email_messages GROUP BY status`,
  );
  const stats: EmailStats = { queued: 0, sending: 0, sent: 0, failed: 0, bounced: 0, complained: 0 };
  for (const r of rows) {
    if (r.status in stats) stats[r.status as keyof EmailStats] = r.count;
  }
  return stats;
}
