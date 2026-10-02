"use server";

import { redirect } from "next/navigation";
import mongoose from "mongoose";
import { getSessionUserId, setSession } from "@/lib/auth/session";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import {
  restaurantRegistrationSchema,
  type RestaurantRegistrationInput,
} from "@/lib/validations";

export interface OnboardingFormState {
  message?: string;
  _errors?: Record<string, string[]>;
  fields?: Record<string, unknown>;
}

export async function onboardingAction(
  _prevState: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  const userId = await getSessionUserId();
  if (!userId) {
    redirect("/login");
  }

  const raw: Record<string, unknown> = {
    name: formData.get("name")?.toString() ?? "",
    ownerName: formData.get("ownerName")?.toString() ?? "",
    phone: formData.get("phone")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    address: formData.get("address")?.toString() ?? "",
    city: formData.get("city")?.toString() ?? "",
    state: formData.get("state")?.toString() ?? "",
    pincode: formData.get("pincode")?.toString() ?? "",
    gstRegistered:
      formData.get("gstRegistered")?.toString() === "true" ||
      formData.get("gstRegistered") === "on",
    gstin: formData.get("gstin")?.toString() ?? "",
    businessType: formData.get("businessType")?.toString() ?? "",
  };

  let payload: RestaurantRegistrationInput;
  try {
    payload = restaurantRegistrationSchema.parse(raw);
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return { message: "Something went wrong. Please try again." };
    }
    const zodError = error as {
      flatten: () => { fieldErrors: Record<string, string[]> };
    };
    return { _errors: zodError.flatten().fieldErrors };
  }

  try {
    const result = await createRestaurantForUser(userId, payload);

    if (!result.userExists) {
      return { message: "Account not found. Please log in again." };
    }
    if (!result.userActive) {
      return { message: "This account has been deactivated." };
    }

    await setSession(userId, result.restaurantId, "OWNER");
  } catch {
    return { message: "Something went wrong. Please try again." };
  }

  redirect("/dashboard");
}