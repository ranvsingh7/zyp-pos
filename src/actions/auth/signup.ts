"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { hashPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";
import { signupSchema } from "@/lib/validations";
import { signupRateLimitDecision } from "@/lib/rate-limit";

export interface FormState {
  message?: string;
  _errors?: Record<string, string[]>;
  success?: boolean;
  fields?: Record<string, string>;
}

export async function signupAction(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const raw = {
    fullName: formData.get("fullName")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    password: formData.get("password")?.toString() ?? "",
    confirmPassword: formData.get("confirmPassword")?.toString() ?? "",
  };

  const validation = signupSchema.safeParse(raw);
  if (!validation.success) {
    return { _errors: validation.error.flatten().fieldErrors };
  }

  const { fullName, email, password } = validation.data;

  const headerStore = await headers();
  const ip =
    (headerStore.get("x-forwarded-for") ?? headerStore.get("x-real-ip") ?? "")
      .split(",")[0]
      .trim() || null;
  const decision = await signupRateLimitDecision(email, ip);
  if (!decision.allowed) {
    return {
      message: "Too many sign-up attempts. Please try again later.",
      fields: { fullName, email },
    };
  }

  try {
    await connectDB();

    const existing = await UserModel.findOne({ email });
    if (existing) {
      return {
        message: "An account with this email already exists.",
        fields: { fullName, email },
      };
    }

    const passwordHash = await hashPassword(password);
    const user = await UserModel.create({
      fullName,
      email,
      passwordHash,
      role: "OWNER",
      isActive: true,
    });

    await setSession(String(user._id), null, "OWNER");
  } catch {
    return { message: "Something went wrong. Please try again." };
  }

  redirect("/onboarding/restaurant");
}