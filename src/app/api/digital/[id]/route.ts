import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { zId } from "@/lib/validation/common";
import { archiveModule, getModuleItem, updateModule } from "@/lib/vault/modules";
import { digitalCreateSchema, digitalSpec } from "@/lib/vault/module-specs";

const idSchema = z.object({ id: zId() });
const patchSchema = digitalCreateSchema.partial();

async function itemId(routeCtx: { params: Promise<Record<string, string>> }): Promise<string> {
  const parsed = idSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_id", "Invalid record identifier.");
  return parsed.data.id;
}

/** GET /api/digital/[id] */
export const GET = handleRoute(async (req, routeCtx) => {
  const ctx = await requireUser();
  const item = await getModuleItem(digitalSpec, ctx.user.id, await itemId(routeCtx));
  return ok({ item });
});

/** PATCH /api/digital/[id] */
export const PATCH = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const body = await readJson(req, patchSchema);
  const item = await updateModule(digitalSpec, ctx.user.id, id, body);
  await recordAudit({
    action: "vault.digital_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "digital_account",
    targetId: id,
    metadata: { fields: Object.keys(body) },
  });
  return ok({ item });
});

/** DELETE /api/digital/[id] — soft archive. */
export const DELETE = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const result = await archiveModule(digitalSpec, ctx.user.id, id, true);
  await recordAudit({
    action: "vault.digital_archived",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "digital_account",
    targetId: id,
  });
  return ok(result);
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
