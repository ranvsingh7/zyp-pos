"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { setSession } from "@/lib/auth/session";
import { attemptLogin } from "@/lib/auth/login-service";
import { loginSchema } from "@/lib/validations";

export interface LoginFormState {
  message?: string;
  _errors?: Record<string, string[]>;
  fields?: Record<string, string>;
}

async function readRequestContext() {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    ip = (forwarded ? forwarded.split(",")[0].trim() : null) ?? h.get("x-real-ip");
    userAgent = h.get("user-agent");
  } catch {
    // very unlikely inside an action — audit falls back to generated ids
  }
  return { ip, userAgent };
}

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const raw = {
    email: formData.get("email")?.toString() ?? "",
    password: formData.get("password")?.toString() ?? "",
  };

  const validation = loginSchema.safeParse(raw);
  if (!validation.success) {
    return { _errors: validation.error.flatten().fieldErrors };
  }

  const { ip, userAgent } = await readRequestContext();
  const result = await attemptLogin({
    // Pass the normalized value, not the raw form input. `raw.email` may carry
    // uppercase or stray whitespace, which would not match the stored
    // (lowercased) email and would surface as "Invalid email or password".
    email: validation.data.email,
    password: raw.password,
    ip,
    userAgent,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "validation":
        return { message: "Please enter a valid email and password." };
      case "rate_limited":
        return {
          message: "Too many login attempts. Please try again in a few minutes.",
        };
      case "deactivated":
        return { message: "This account has been deactivated." };
      default:
        return { message: "Invalid email or password." };
    }
  }

  await setSession(result.userId, result.restaurantId, result.role ?? null);
  redirect(result.role === "SUPER_ADMIN" ? "/admin" : "/dashboard");
}