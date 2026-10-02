import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";

const SESSION_COOKIE = "restopos_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set.");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  restaurantId?: string | null;
  /** Snapshot of the role at login; the DB remains the source of truth. */
  role?: string | null;
  [key: string]: unknown;
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function decryptSession(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    const userId =
      typeof payload.userId === "string" ? payload.userId : undefined;
    if (!userId) return null;
    const restaurantId =
      typeof payload.restaurantId === "string"
        ? payload.restaurantId
        : null;
    const role = typeof payload.role === "string" ? payload.role : null;
    return { userId, restaurantId, role };
  } catch {
    return null;
  }
}

export async function setSession(
  userId: string,
  restaurantId?: string | null,
  role?: string | null
): Promise<void> {
  const token = await encryptSession({
    userId,
    restaurantId: restaurantId ?? null,
    role: role ?? null,
  });

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  };

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, cookieOptions);
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export const getSessionUserId = cache(async (): Promise<string | null> => {
  const token = await getSessionToken();
  const session = await decryptSession(token);
  return session?.userId ?? null;
});

export const getSessionRestaurantId = cache(async (): Promise<string | null> => {
  const token = await getSessionToken();
  const session = await decryptSession(token);
  return session?.restaurantId ?? null;
});

export const getSessionRole = cache(async (): Promise<string | null> => {
  const token = await getSessionToken();
  const session = await decryptSession(token);
  return session?.role ?? null;
});

export { SESSION_COOKIE };