import "server-only";

import { cache } from "react";
import { PlatformSettingsModel, PLATFORM_SETTINGS_ID } from "@/models/PlatformSettings";
import { PlanModel } from "@/models/Plan";
import {
  DEFAULT_ADMIN_TIMEZONE,
  DEFAULT_EXPIRY_WARNING_DAYS,
  DEFAULT_GRACE_PERIOD_DAYS,
  DEFAULT_TRIAL_DURATION_DAYS,
} from "./constants";

export interface PlatformSettingsSnapshot {
  trialDurationDays: number;
  expiryWarningDays: number;
  gracePeriodDays: number;
  timezone: string;
}

/**
 * Platform defaults resolved once per request (React cache) from the single
 * settings document. Falls back to constants when the doc is missing, so the
 * whole admin panel works before any settings write.
 */
export const getPlatformSettings = cache(
  async (): Promise<PlatformSettingsSnapshot> => {
    const doc = await PlatformSettingsModel.findById(PLATFORM_SETTINGS_ID).lean();
    return doc
      ? {
          trialDurationDays: Number(doc.trialDurationDays ?? DEFAULT_TRIAL_DURATION_DAYS),
          expiryWarningDays: Number(doc.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS),
          gracePeriodDays: Number(doc.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS),
          timezone: String(doc.timezone ?? DEFAULT_ADMIN_TIMEZONE),
        }
      : {
          trialDurationDays: DEFAULT_TRIAL_DURATION_DAYS,
          expiryWarningDays: DEFAULT_EXPIRY_WARNING_DAYS,
          gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
          timezone: DEFAULT_ADMIN_TIMEZONE,
        };
  }
);

export async function updatePlatformSettings(input: {
  trialDurationDays?: number | null;
  expiryWarningDays?: number | null;
  gracePeriodDays?: number | null;
  timezone?: string | null;
  updatedBy?: string | null;
}): Promise<void> {
  const current = await getPlatformSettings();
  const next = {
    trialDurationDays: Math.max(0, Math.min(365, Number(input.trialDurationDays ?? current.trialDurationDays))),
    expiryWarningDays: Math.max(0, Math.min(90, Number(input.expiryWarningDays ?? current.expiryWarningDays))),
    gracePeriodDays: Math.max(0, Math.min(90, Number(input.gracePeriodDays ?? current.gracePeriodDays))),
    timezone: input.timezone?.trim() || current.timezone,
  };

  await PlatformSettingsModel.findByIdAndUpdate(
    PLATFORM_SETTINGS_ID,
    {
      $set: {
        ...next,
        updatedBy: input.updatedBy ?? null,
      },
    },
    { upsert: true }
  );
}

/**
 * Ensures a ₹0 Trial plan exists. Admin restaurant creation defaults to this
 * plan, so self-onboarded restaurants carry a trial subscription too.
 * Idempotent — returns the existing trial plan when present.
 */
export async function ensureTrialPlan(): Promise<{
  planId: string;
  name: string;
  durationDays: number;
}> {
  const existing = await PlanModel.findOne({
    pricePaise: 0,
    billingCycle: "MONTHLY",
  })
    .select("_id name durationDays")
    .lean();
  if (existing) {
    return {
      planId: String(existing._id),
      name: String(existing.name),
      durationDays: Number(existing.durationDays),
    };
  }

  const trial = await PlanModel.create({
    name: "Trial",
    description: "Free trial period for new restaurants.",
    pricePaise: 0,
    billingCycle: "MONTHLY",
    durationDays: 30,
    isActive: true,
    features: [],
  });

  return {
    planId: String(trial._id),
    name: "Trial",
    durationDays: Number(trial.durationDays),
  };
}