import { testRoutesEnabled } from "@/lib/env";
import { fail, handleRoute, ok } from "@/lib/api/http";
import { db } from "@/lib/db";
import { z } from "zod";

/**
 * TEST-ONLY mailbox: exposes messages captured by the file email adapter so
 * the e2e suite can complete verification/reset flows like a real recipient
 * would (through an email link). 404 unless test routes are enabled.
 */

const querySchema = z.object({
  to: z.string().max(320).optional(),
  template: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const GET = handleRoute(async (req) => {
  if (!testRoutesEnabled()) return fail(404, "not_found", "Not found");

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    to: url.searchParams.get("to") ?? undefined,
    template: url.searchParams.get("template") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return fail(400, "invalid_request", "Invalid query parameters.");

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.to) {
    params.push(parsed.data.to.toLowerCase());
    conditions.push(`lower(to_email) = $${params.length}`);
  }
  if (parsed.data.template) {
    params.push(parsed.data.template);
    conditions.push(`template = $${params.length}`);
  }
  params.push(parsed.data.limit ?? 20);

  const rows = await db.q<{
    id: string;
    toEmail: string;
    template: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    status: string;
    createdAt: Date;
  }>(
    `SELECT id, to_email, template, subject, text_body, html_body, status, created_at
       FROM email_messages
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return ok({
    messages: rows.map((r) => ({
      id: r.id,
      to: r.toEmail,
      template: r.template,
      subject: r.subject,
      text: r.textBody,
      html: r.htmlBody,
      status: r.status,
      createdAt: r.createdAt,
      // Convenience for tests: first absolute link in the text body.
      link: /https?:\/\/\S+/.exec(r.textBody)?.[0] ?? null,
    })),
  });
});
