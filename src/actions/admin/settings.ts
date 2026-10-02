"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/permissions";
import { updatePlatformSettings } from "@/lib/admin/platform-settings";
import { updateSettingsSchema } from "@/lib/admin/query";
import { logPlatformAudit } from "@/lib/admin/audit";
import { wrapAdminAction } from "./_shared";

export interface SettingsActionState {
  success?: boolean;
  message?: string;
  _errors?: Record<string, string[]>;
}

export async function updateSettingsAction(
  formData: FormData
): Promise<SettingsActionState> {
  const admin = await requireSuperAdmin();
  return wrapAdminAction(async () => {
    const parsed = updateSettingsSchema.safeParse({
      trialDurationDays: formData.get("trialDurationDays"),
      expiryWarningDays: formData.get("expiryWarningDays"),
      gracePeriodDays: formData.get("gracePeriodDays"),
      timezone: formData.get("timezone"),
    });
    if (!parsed.success) {
      return { _errors: parsed.error.flatten().fieldErrors };
    }
    await updatePlatformSettings({
      ...parsed.data,
      updatedBy: admin.id,
    });
    await logPlatformAudit({
      action: "SETTINGS_CHANGE",
      actorId: admin.id,
      actorRole: "SUPER_ADMIN",
      entityType: "SETTINGS",
      entityName: "Platform settings",
      summary: "Platform settings updated",
      metadata: { changed: Object.keys(parsed.data) },
    });
    revalidatePath("/admin/settings");
    return { success: true };
  });
}