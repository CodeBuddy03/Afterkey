import { assertRecordQuota } from "@/lib/billing/entitlements";
import { created, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser, requireVerified } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { createModule, listModule } from "@/lib/vault/modules";
import { propertyCreateSchema, propertySpec } from "@/lib/vault/module-specs";

/** GET /api/properties — list the caller's properties. */
export const GET = handleRoute(async (req) => {
  const ctx = await requireUser();
  const url = new URL(req.url);
  const items = await listModule(propertySpec, ctx.user.id, {
    q: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("type") ?? undefined,
    includeArchived: url.searchParams.get("archived") === "1",
  });
  return ok({ items, total: items.length });
});

/** POST /api/properties — create a property record. */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  requireVerified(ctx);
  await assertRecordQuota(ctx.user.id);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, propertyCreateSchema);

  const item = await createModule(propertySpec, ctx.user.id, {
    ...body,
    propertyType: body.propertyType ?? "other",
  });

  await recordAudit({
    action: "vault.property_created",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "property",
    targetId: String(item.id),
    metadata: { name: body.name },
  });

  return created({ item });
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
