import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { assertServiceForCurrentVenue, ServiceAccessError } from "@/lib/services/access";
import { assertCanViewReportTab } from "@/lib/reports/permissions";
import { parseReportQuery } from "@/lib/reports/query";
import { buildReportExport } from "@/lib/reports/export";

/**
 * Server-generated CSV downloads. Auth + role checks run here, not in the
 * browser, so a waiter hand-editing the URL can never pull a financial export.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  // The page guard is not a security boundary for a download: this route must
  // re-check the plan, or a venue could strip reports from a BASIC plan just by
  // hitting the URL directly.
  //
  // The denial is translated into a 403 rather than left to propagate, so
  // probing this endpoint reports "not in your plan" instead of a 500.
  try {
    await assertServiceForCurrentVenue("REPORTS");
  } catch (error) {
    if (error instanceof ServiceAccessError) {
      return NextResponse.json(
        { error: error.message, service: error.service },
        { status: 403 }
      );
    }
    throw error;
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = parseReportQuery(params);
  assertCanViewReportTab(auth.role, query.tab);

  const result = await buildReportExport(String(restaurant.id), query);

  // Streamed body — rows are written straight from the MongoDB cursor, so the
  // response payload never materializes the full dataset in server memory.
  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}