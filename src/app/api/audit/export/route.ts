import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { assertServiceForCurrentVenue, ServiceAccessError } from "@/lib/services/access";
import { assertCanViewAuditLogs } from "@/lib/audit/permissions";
import { exportAuditLogs } from "@/lib/audit/audit-service";
import { auditQuerySchema, toAuditFilters } from "@/lib/audit/query";

/**
 * Protected CSV backup of the audit trail. Ownership + role checks run here,
 * not in the browser (a waiter hand-editing the URL can never pull an export).
 * The tenant scope always comes from the session cookie, never query params.
 * Streams from a MongoDB cursor so memory stays flat on large trails.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();

  // Gating only the page would still leave the whole trail downloadable by
  // anyone who can reach this URL directly, so the export is gated too.
  try {
    await assertServiceForCurrentVenue("AUDIT");
  } catch (error) {
    if (error instanceof ServiceAccessError) {
      return NextResponse.json(
        { error: error.message, service: error.service },
        { status: 403 }
      );
    }
    throw error;
  }
  assertCanViewAuditLogs(auth.role);

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = auditQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid audit export query." },
      { status: 400 }
    );
  }

  const filters = toAuditFilters(parsed.data);
  const result = await exportAuditLogs(String(restaurant.id), filters ?? {});

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}