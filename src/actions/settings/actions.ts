"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { assertCanManageSettings, SettingsForbiddenError } from "@/lib/settings/permissions";
import {
  firstSettingsMessage,
  restaurantSettingsUpdateSchema,
} from "@/lib/settings/validation";
import { LOGO_MAX_BYTES, LOGO_MIME_TYPES, LOGO_MIME_LABELS } from "@/lib/settings/constants";
import { validateLogoBytes } from "@/lib/settings/logo";
import {
  removeRestaurantLogo,
  saveRestaurantLogo,
  updateRestaurantSettings,
  type RestaurantSettingsSnapshot,
} from "@/lib/settings/settings-service";

export interface SettingsActionState {
  success?: boolean;
  message?: string;
  _errors?: Record<string, string[]>;
  snapshot?: RestaurantSettingsSnapshot;
  logoVersion?: string;
}

async function wrapSettingsAction(
  fn: () => Promise<SettingsActionState>
): Promise<SettingsActionState> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NEXT_REDIRECT") throw error;
    if (error instanceof SettingsForbiddenError) {
      return { success: false, message: error.message };
    }
    const message =
      error instanceof Error ? error.message : "Something went wrong. Try again.";
    return { success: false, message };
  }
}

/**
 * Resolves the tenant from the session cookie and enforces the owner/manager
 * boundary. The restaurant id never comes from the submitted form, so a
 * hand-edited request can never reach another restaurant's settings.
 */
async function requireSettingsContext(): Promise<{
  restaurantId: string;
  userId: string;
  role: string;
}> {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  assertCanManageSettings(user.role);
  return { restaurantId: String(restaurant.id), userId: user.id, role: user.role };
}

function fieldErrors(
  issues: { path: readonly PropertyKey[]; message?: string }[]
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = [];
    if (issue.message) errors[key].push(issue.message);
  }
  return errors;
}

export async function updateSettingsAction(
  _prev: SettingsActionState,
  form: FormData
): Promise<SettingsActionState> {
  return wrapSettingsAction(async () => {
    const { restaurantId, userId, role } = await requireSettingsContext();
    const raw: Record<string, unknown> = Object.fromEntries(form.entries());
    // The Payment card's "Clear" button submits the same form with this flag,
    // so clearing is an explicit server-confirmed action rather than the user
    // having to manually blank the field first. Validation still runs on the
    // resulting empty value, which maps to null.
    if (raw.clearUpiId === "true") {
      raw.upiId = "";
      delete raw.clearUpiId;
    }
    const parsed = restaurantSettingsUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        message: firstSettingsMessage(parsed),
        _errors: fieldErrors(parsed.error.issues),
      };
    }
    const snapshot = await updateRestaurantSettings(restaurantId, parsed.data, {
      userId,
      role,
    });
    revalidatePath("/settings");
    revalidatePath("/billing");
    return { success: true, message: "Settings saved.", snapshot };
  });
}

export async function uploadLogoAction(
  _prev: SettingsActionState,
  form: FormData
): Promise<SettingsActionState> {
  return wrapSettingsAction(async () => {
    const { restaurantId, userId, role } = await requireSettingsContext();
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, message: "Choose an image to upload." };
    }
    // Hard cap before the bytes are ever read into memory.
    if (file.size > LOGO_MAX_BYTES) {
      return { success: false, message: "Logo must be 2 MB or smaller." };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateLogoBytes(bytes, file.type);
    if (!check.ok || !check.mimeType) {
      return { success: false, message: check.error ?? "Invalid logo file." };
    }
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(check.mimeType)) {
      return { success: false, message: "Only PNG, JPEG or WebP images are supported." };
    }
    const saved = await saveRestaurantLogo(restaurantId, bytes, file.type, {
      userId,
      role,
    });
    revalidatePath("/settings");
    return {
      success: true,
      message: `Logo updated (${LOGO_MIME_LABELS[saved.mimeType]}, ${Math.round(saved.size / 1024)} KB).`,
      logoVersion: saved.updatedAt,
    };
  });
}

export async function removeLogoAction(): Promise<SettingsActionState> {
  return wrapSettingsAction(async () => {
    const { restaurantId, userId, role } = await requireSettingsContext();
    await removeRestaurantLogo(restaurantId, { userId, role });
    revalidatePath("/settings");
    return { success: true, message: "Logo removed.", logoVersion: new Date().toISOString() };
  });
}
