import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { verifyPassword } from "@/lib/auth/password";
import { loginSchema } from "@/lib/validations";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Testable login core. The server action only wraps this: it passes request
 * context (IP/user-agent) and sets the session cookie on success. Kept free of
 * `cookies()`/`redirect()` so the security behavior (rate limiting + audit)
 * is unit-testable against the database.
 */

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface LoginAttemptInput {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export type LoginResult =
  | {
      ok: true;
      userId: string;
      restaurantId: string | null;
      role: string;
    }
  | { ok: false; reason: "validation" | "invalid_credentials" | "deactivated" | "rate_limited" };

interface LoginUserDoc {
  _id: unknown;
  email?: string;
  passwordHash?: string;
  role: string;
  restaurantId?: unknown;
  isActive: boolean;
}

/** Escapes PCRE metacharacters so a user-supplied email cannot alter the pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function attemptLogin(input: LoginAttemptInput): Promise<LoginResult> {
  const parsed = loginSchema.safeParse({ email: input.email, password: input.password });
  if (!parsed.success) return { ok: false, reason: "validation" };
  const { email, password } = parsed.data;
  const ip = input.ip?.trim() || null;
  const userAgent = input.userAgent?.trim() || null;
  const requestId = input.requestId ?? null;

  await connectDB();
  const doc = await UserModel.aggregate<LoginUserDoc>([
    // Case-insensitive on purpose. Email addresses are case-insensitive in
    // practice, stored values are lowercased by the schema, and an exact-match
    // `$match` makes an autocapitalised input ("User@Example.com") look like an
    // unknown account. Belt-and-braces with loginSchema's `.toLowerCase()` so
    // any future caller that skips the schema still resolves the right user.
    { $match: { email: { $regex: `^${escapeRegExp(email)}$`, $options: "i" } } },
    {
      $project: {
        _id: 1,
        email: 1,
        passwordHash: 1,
        role: 1,
        restaurantId: 1,
        isActive: 1,
      },
    },
  ]);
  const user = doc[0] ?? null;
  const restaurantId = user?.restaurantId ? String(user.restaurantId) : null;
  const loginKey = `${email.toLowerCase()}:${ip ?? "unknown"}`;

  // Shared MongoDB-backed bucket: one budget across all instances/processes.
  const decision = await rateLimit(
    `login:${loginKey}`,
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_ATTEMPT_WINDOW_MS
  );

  if (!decision.allowed) {
    await writeAuditLog({
      restaurantId,
      action: "FAILED_LOGIN",
      resourceType: "USER",
      resourceId: user ? String(user?._id) : email,
      reason: "Rate limit exceeded.",
      success: false,
      ip,
      userAgent,
      requestId,
      metadata: { email, ip },
    });
    return { ok: false, reason: "rate_limited" };
  }

  const recordFailedLogin = (reason: string) =>
    writeAuditLog({
      restaurantId,
      action: "FAILED_LOGIN",
      resourceType: "USER",
      resourceId: user ? String(user?._id) : email,
      reason,
      success: false,
      ip,
      userAgent,
      requestId,
      metadata: { email, ip },
    });

  if (process.env.DEBUG_LOGIN === "true") {
    console.log(
      JSON.stringify({
        tag: "login-diagnostic",
        dbName: mongoose.connection.name,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        emailInput: email,
        userFound: false,
      })
    );
  }

  if (!user) {
    await recordFailedLogin("Invalid credentials: account does not exist.");
    return { ok: false, reason: "invalid_credentials" };
  }
  if (!user.passwordHash) {
    await recordFailedLogin("Invalid credentials: no password on file.");
    return { ok: false, reason: "invalid_credentials" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  // Safe login diagnostics. Never logs the password or the hash itself — only
  // shape-level facts needed to tell "wrong database" apart from "wrong
  // password". Stripped from production builds by the DEBUG_LOGIN flag.
  if (process.env.DEBUG_LOGIN === "true") {
    console.log(
      JSON.stringify({
        tag: "login-diagnostic",
        dbName: mongoose.connection.name,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        emailInput: email,
        emailStored: user.email ?? null,
        emailMatches: (user.email ?? "") === email,
        userFound: true,
        role: user.role,
        restaurantId: restaurantId ?? null,
        isActive: user.isActive,
        hashExists: true,
        hashAlgo: String(user.passwordHash).split("$")[1] ?? null,
        verifyResult: valid,
      })
    );
  }
  if (!valid) {
    await recordFailedLogin("Invalid credentials: wrong password.");
    return { ok: false, reason: "invalid_credentials" };
  }

  if (!user.isActive) {
    await recordFailedLogin("Deactivated account.");
    return { ok: false, reason: "deactivated" };
  }

  const userId = String(user._id);
  await writeAuditLog({
    restaurantId,
    actorUserId: userId,
    actorRole: user.role === "OWNER" || user.role === "MANAGER" || user.role === "CASHIER" || user.role === "WAITER"
      ? user.role
      : undefined,
    action: "LOGIN",
    resourceType: "USER",
    resourceId: userId,
    reason: "Successful login.",
    success: true,
    ip,
    userAgent,
    requestId,
    metadata: { email },
  });

  return { ok: true, userId, restaurantId, role: user.role };
}