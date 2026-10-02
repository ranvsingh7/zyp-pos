import { NextResponse } from "next/server";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { LOGO_CACHE_CONTROL } from "@/lib/settings/constants";
import { getRestaurantLogo } from "@/lib/settings/settings-service";

/**
 * Serves the authenticated tenant's logo bytes. The restaurant is resolved
 * from the session cookie (never a query parameter or path segment), so there
 * is no way to address another restaurant's logo.
 */
export async function GET() {
  await requireAuth();
  const restaurant = await requireRestaurant();

  const logo = await getRestaurantLogo(String(restaurant.id));
  if (!logo) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mimeType,
      "Content-Length": String(logo.size),
      "Cache-Control": LOGO_CACHE_CONTROL,
      // Never let a stale logo survive a replacement or removal.
      ETag: `"${logo.updatedAt}-${logo.size}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
