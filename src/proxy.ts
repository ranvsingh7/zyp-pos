import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, decryptSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/roles";

const PUBLIC_PATHS = ["/", "/login", "/signup", "/forgot-password"];
const APP_PATHS = ["/dashboard", "/menu", "/tables", "/pos", "/inventory", "/kot"];
const ADMIN_PATHS = ["/admin"];

function isAppPath(pathname: string): boolean {
  return APP_PATHS.some((prefix) => pathname.startsWith(prefix));
}

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    (pathname.includes(".") && !pathname.endsWith(".ts"))
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const session = await decryptSession(token);
  const userId = session?.userId ?? null;
  const hasRestaurant = Boolean(session?.restaurantId);
  const isSuper = isSuperAdmin(session?.role ?? null);

  const logTraffic = (action: string, reason?: string) => {
    if (process.env.DEBUG_PROXY !== "true") return;
    console.log(
      `[proxy] ${request.method} ${pathname} -> ${action}` +
        ` | session=${userId ? `valid(user=${userId},` : "none"}` +
        (userId ? ` restaurant=${hasRestaurant ? "yes" : "no"}, role=${isSuper ? "super_admin" : "user"})` : "") +
        (reason ? ` | reason=${reason}` : "")
    );
  };

  if (!userId) {
    if (isAppPath(pathname) || isAdminPath(pathname)) {
      logTraffic("/login", "no-valid-session-on-protected-path");
      return NextResponse.redirect(new URL("/login", request.url));
    }
    logTraffic("pass-through", "public-path-no-session");
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    const target = isSuper ? "/admin" : hasRestaurant ? "/dashboard" : "/onboarding/restaurant";
    logTraffic(target, `session-exists-but-requesting-public-path`);
    return NextResponse.redirect(new URL(target, request.url));
  }

  if (isAppPath(pathname) && !hasRestaurant && !isSuper) {
    logTraffic("/onboarding/restaurant", "app-path-without-restaurant");
    return NextResponse.redirect(new URL("/onboarding/restaurant", request.url));
  }

  if (isAdminPath(pathname) && !isSuper) {
    logTraffic("/dashboard", "non-super-admin-on-admin-path");
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isSuper && !isAdminPath(pathname) && !isAppPath(pathname)) {
    // Keep super admins inside the admin panel unless they explicitly browse a
    // public or app page the proxy may route for them.
    if (!pathname.startsWith("/subscription-blocked")) {
      logTraffic("/admin", "super-admin-on-non-admin-page");
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  if (pathname.startsWith("/onboarding") && hasRestaurant) {
    logTraffic("/dashboard", "onboarding-with-restaurant");
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  logTraffic("pass-through", "allowed");
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};