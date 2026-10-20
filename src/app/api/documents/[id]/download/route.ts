import { handleRoute } from "@/lib/api/http";
import { downloadDocument } from "@/lib/documents/download";

/** GET /api/documents/[id]/download — authorized, decrypted streaming. */
export const GET = handleRoute((req, routeCtx) => downloadDocument(req, routeCtx));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
