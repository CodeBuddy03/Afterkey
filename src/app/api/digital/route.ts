import { assertRecordQuota } from "@/lib/billing/entitlements";
import { created, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser, requireVerified } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { createModule, listModule } from "@/lib/vault/modules";
import { digitalCreateSchema, digitalSpec } from "@/lib/vault/module-specs";

/** GET /api/digital — list the caller's digital accounts. */
export const GET = handleRoute(async (req) => {
  const ctx = await requireUser();
  const url = new URL(req.url);
  const items = await listModule(digitalSpec, ctx.user.id, {
    q: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    includeArchived: url.searchParams.get("archived") === "1",
  });
  return ok({ items, total: items.length });
});

/** POST /api/digital — create an account record. */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  requireVerified(ctx);
  await assertRecordQuota(ctx.user.id);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, digitalCreateSchema);

  const item = await createModule(digitalSpec, ctx.user.id, { ...body });

  await recordAudit({
    action: "vault.digital_created",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "digital_account",
    targetId: String(item.id),
    metadata: { category: body.category, service: body.serviceName },
  });

  return created({ item });
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
