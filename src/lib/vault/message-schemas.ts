import { z } from "zod";
import { zId, zLongText, zShortText } from "@/lib/validation/common";

/** Shared validation for legacy messages (kept out of route modules). */

export const messageCreateSchema = z.object({
  title: zShortText(200),
  body: zLongText(20000).optional(),
  recipientId: zId().nullable().optional(),
  intendedLabel: zShortText(160).optional(),
  relationship: zShortText(80).optional(),
  releasePolicy: z.enum(["manual", "on_release"]).optional(),
  /** Explicit consent: a message is only ever released when the owner set releasePolicy='on_release' AND consent=true. */
  consent: z.boolean().optional(),
  status: z.enum(["draft", "ready", "scheduled", "archived"]).optional(),
});

export const messagePatchSchema = messageCreateSchema.partial().extend({
  scheduledFor: z.string().datetime().nullable().optional(),
});

export const PERMISSION_CATEGORIES = ["financial", "digital", "documents", "properties", "messages"] as const;
