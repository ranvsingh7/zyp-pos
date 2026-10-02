"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { assertCanManageStaff, StaffForbiddenError } from "@/lib/staff/permissions";
import {
  createStaffSchema,
  firstStaffMessage,
  resetStaffPasswordSchema,
  staffRoleSchema,
  updateStaffSchema,
} from "@/lib/staff/validation";
import {
  createStaffMember,
  resetStaffPassword,
  setStaffActive,
  updateStaffMember,
  type StaffMemberView,
} from "@/lib/staff/staff-service";

export interface StaffActionState {
  success?: boolean;
  message?: string;
  _errors?: Record<string, string[]>;
  member?: StaffMemberView;
}

async function wrapStaffAction(fn: () => Promise<StaffActionState>): Promise<StaffActionState> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NEXT_REDIRECT") throw error;
    if (error instanceof StaffForbiddenError) {
      return { success: false, message: error.message };
    }
    const message =
      error instanceof Error ? error.message : "Something went wrong. Try again.";
    return { success: false, message };
  }
}

/**
 * Resolves the tenant from the session cookie. The restaurant id is never read
 * from the form, so a hand-edited request can never reach another restaurant's
 * staff list.
 */
async function requireStaffContext(): Promise<{
  restaurantId: string;
  userId: string;
  role: string;
}> {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  assertCanManageStaff(user.role);
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

/** Rejects a forged role before it reaches the service layer. */
function readRole(form: FormData): string | undefined {
  const raw = form.get("role");
  if (raw == null || raw === "") return undefined;
  const parsed = staffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : "__invalid__";
}

export async function createStaffAction(
  _prev: StaffActionState,
  form: FormData
): Promise<StaffActionState> {
  return wrapStaffAction(async () => {
    const { restaurantId, userId, role } = await requireStaffContext();
    const parsed = createStaffSchema.safeParse({
      fullName: form.get("fullName"),
      email: form.get("email"),
      phone: form.get("phone"),
      role: readRole(form),
      password: form.get("password"),
    });
    if (!parsed.success) {
      return {
        success: false,
        message: firstStaffMessage(parsed.error),
        _errors: fieldErrors(parsed.error.issues),
      };
    }
    const member = await createStaffMember(
      restaurantId,
      parsed.data,
      { userId, role }
    );
    revalidatePath("/settings/staff");
    return {
      success: true,
      message: `${member.fullName} can now sign in with ${member.email}.`,
      member,
    };
  });
}

export async function updateStaffAction(
  _prev: StaffActionState,
  form: FormData
): Promise<StaffActionState> {
  return wrapStaffAction(async () => {
    const { restaurantId, userId, role } = await requireStaffContext();
    const targetId = String(form.get("userId") ?? "");
    if (!targetId) return { success: false, message: "Staff member is required." };

    const raw: Record<string, unknown> = {
      fullName: form.get("fullName") ?? undefined,
      email: form.get("email") ?? undefined,
      phone: form.get("phone") ?? undefined,
    };
    const roleValue = readRole(form);
    if (roleValue === "__invalid__") {
      return { success: false, message: "Please select a valid role." };
    }
    if (roleValue !== undefined) raw.role = roleValue;
    const isActive = form.get("isActive");
    if (isActive === "true" || isActive === "false") raw.isActive = isActive === "true";

    const parsed = updateStaffSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        message: firstStaffMessage(parsed.error),
        _errors: fieldErrors(parsed.error.issues),
      };
    }
    const member = await updateStaffMember(
      restaurantId,
      targetId,
      parsed.data,
      { userId, role }
    );
    revalidatePath("/settings/staff");
    return { success: true, message: `${member.fullName} updated.`, member };
  });
}

export async function setStaffActiveAction(
  _prev: StaffActionState,
  form: FormData
): Promise<StaffActionState> {
  return wrapStaffAction(async () => {
    const { restaurantId, userId, role } = await requireStaffContext();
    const targetId = String(form.get("userId") ?? "");
    const isActive = form.get("isActive") === "true";
    if (!targetId) return { success: false, message: "Staff member is required." };
    const member = await setStaffActive(restaurantId, targetId, isActive, { userId, role });
    revalidatePath("/settings/staff");
    return {
      success: true,
      message: isActive
        ? `${member.fullName} reactivated.`
        : `${member.fullName} deactivated and can no longer sign in.`,
      member,
    };
  });
}

export async function resetStaffPasswordAction(
  _prev: StaffActionState,
  form: FormData
): Promise<StaffActionState> {
  return wrapStaffAction(async () => {
    const { restaurantId, userId, role } = await requireStaffContext();
    const parsed = resetStaffPasswordSchema.safeParse({
      userId: form.get("userId"),
      newPassword: form.get("newPassword"),
    });
    if (!parsed.success) {
      return {
        success: false,
        message: firstStaffMessage(parsed.error),
        _errors: fieldErrors(parsed.error.issues),
      };
    }
    const result = await resetStaffPassword(
      restaurantId,
      parsed.data.userId,
      parsed.data.newPassword,
      { userId, role }
    );
    revalidatePath("/settings/staff");
    return {
      success: true,
      message: `Password reset for ${result.email}. Share it securely — it is not shown again.`,
    };
  });
}
