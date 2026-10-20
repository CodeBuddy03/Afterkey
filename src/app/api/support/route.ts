import { z } from "zod";
import { created, fail, handleRoute, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent } from "@/lib/auth/guards";
import { limitByIp } from "@/lib/security/rate-limit";
import { db } from "@/lib/db";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { recordAudit } from "@/lib/security/audit";
import { zEmail, zShortText } from "@/lib/validation/common";

const schema = z.object({
  name: zShortText(120),
  email: zEmail(),
  subject: zShortText(160),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(5000),
});

/** Public contact/support request intake. */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await limitByIp(ip, "support:new", 5, 3600);
  if (!limit.ok) return fail(429, "rate_limited", "Too many messages. Please try again in an hour.");

  const body = await readJson(req, schema);

  const request = await db.q1<{ id: string }>(
    `INSERT INTO support_requests (name, email, subject, message) VALUES ($1, $2, $3, $4) RETURNING id`,
    [body.name, body.email, body.subject, body.message],
  );
  if (!request) throw new Error("Could not store support request");

  await recordAudit({
    action: "support.request_created",
    actorType: "system",
    actorLabel: body.email,
    targetType: "support_request",
    targetId: request.id,
    ip,
    userAgent,
    metadata: { subject: body.subject },
  });

  // Notify the operations inbox (queued; fails honestly if email is unconfigured).
  await queueEmail({
    to: env().EMAIL_ADMIN_ADDRESS,
    template: "admin_alert",
    rendered: renderEmail("admin_alert", {
      headline: `Support request: ${body.subject}`,
      body: `From: ${body.name} <${body.email}>\n\n${body.message.slice(0, 2000)}`,
    }),
    relatedType: "support_request",
    relatedId: request.id,
    dedupeKey: `support:${request.id}`,
  });

  return created({
    ok: true,
    message: "Thank you — your message has been received. We normally reply within two working days.",
  });
});

export const runtime = "nodejs";
