import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");

  console.log(
    `[auth-guard] clearing session cookie via /api/auth/signout (${error ?? "invalid_session"})`
  );

  const loginUrl = new URL("/login", request.url);
  if (error) loginUrl.searchParams.set("error", error);

  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}