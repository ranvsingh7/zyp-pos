"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/admin/permissions";
import {
  createPlan,
  updatePlan,
  setPlanActive,
} from "@/lib/admin/plan-service";
import { planSaveSchema } from "@/lib/admin/query";

export interface SavePlanState {
  success?: boolean;
  message?: string;
  planId?: string;
  _errors?: Record<string, string[]>;
}

export async function createPlanAction(
  formData: FormData
): Promise<SavePlanState> {
  const admin = await requireSuperAdmin();
  const parsed = planSaveSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    pricePaise: formData.get("pricePaise"),
    billingCycle: formData.get("billingCycle"),
    durationDays: formData.get("durationDays"),
    isActive: formData.get("isActive") === "true" || formData.get("isActive") === "on",
    features: (formData.get("features")?.toString() ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    // Checkbox-style multi-select: every checked key is submitted under one
    // name, so FormData.getAll is the only correct way to read it.
    serviceKeys: formData.getAll("serviceKeys").map((v) => String(v)),
  });
  if (!parsed.success) {
    return { _errors: parsed.error.flatten().fieldErrors };
  }
  const plan = await createPlan({
    ...parsed.data,
    createdBy: admin.id,
  });
  revalidatePath("/admin/plans");
  return { success: true, planId: plan.planId };
}

export async function updatePlanAction(
  planId: string,
  formData: FormData
): Promise<SavePlanState> {
  const admin = await requireSuperAdmin();
  const parsed = planSaveSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    pricePaise: formData.get("pricePaise"),
    billingCycle: formData.get("billingCycle"),
    durationDays: formData.get("durationDays"),
    isActive: formData.get("isActive") === "true" || formData.get("isActive") === "on",
    features: (formData.get("features")?.toString() ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    // Checkbox-style multi-select: every checked key is submitted under one
    // name, so FormData.getAll is the only correct way to read it.
    serviceKeys: formData.getAll("serviceKeys").map((v) => String(v)),
  });
  if (!parsed.success) {
    return { _errors: parsed.error.flatten().fieldErrors };
  }
  await updatePlan(planId, parsed.data, { updatedBy: admin.id });
  revalidatePath("/admin/plans");
  return { success: true, planId };
}

export async function setPlanActiveAction(
  planId: string,
  isActive: boolean
): Promise<SavePlanState> {
  const admin = await requireSuperAdmin();
  await setPlanActive(planId, isActive, { updatedBy: admin.id });
  revalidatePath("/admin/plans");
  return { success: true, planId };
}