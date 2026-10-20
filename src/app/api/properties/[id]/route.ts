import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { zId } from "@/lib/validation/common";
import { archiveModule, getModuleItem, updateModule } from "@/lib/vault/modules";
import { propertyCreateSchema, propertySpec } from "@/lib/vault/module-specs";

const idSchema = z.object({ id: zId() });
const patchSchema = propertyCreateSchema.partial();

async function itemId(routeCtx: { params: Promise<Record<string, string>> }): Promise<string> {
  const parsed = idSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_id", "Invalid record identifier.");
  return parsed.data.id;
}

/** GET /api/properties/[id] */
export const GET = handleRoute(async (req, routeCtx) => {
  const ctx = await requireUser();
  const item = await getModuleItem(propertySpec, ctx.user.id, await itemId(routeCtx));
  return ok({ item });
});

/** PATCH /api/properties/[id] */
export const PATCH = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const body = await readJson(req, patchSchema);
  const item = await updateModule(propertySpec, ctx.user.id, id, body);
  await recordAudit({
    action: "vault.property_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "property",
    targetId: id,
    metadata: { fields: Object.keys(body) },
  });
  return ok({ item });
});

/** DELETE /api/properties/[id] — soft archive. */
export const DELETE = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const result = await archiveModule(propertySpec, ctx.user.id, id, true);
  await recordAudit({
    action: "vault.property_archived",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "property",
    targetId: id,
  });
  return ok(result);
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
