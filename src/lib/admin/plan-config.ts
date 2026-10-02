/**
 * Pure, database-free plan math.
 *
 * The Plan document is the single source of truth for price, billing cycle,
 * duration and grace period. Every subscription path (create, renew, change
 * plan) runs through this module so a client can never decide what a
 * subscription costs, how long it lasts or when it expires — it may only name a
 * plan, a start date, a discount and a note.
 *
 * Everything here is deterministic and side-effect free so the rules can be
 * unit tested without a database and reused by the admin UI preview.
 */

import {
  MAX_PLAN_DURATION_DAYS,
  MAX_PLAN_GRACE_PERIOD_DAYS,
  MAX_PLAN_PRICE_PAISE,
  PLAN_BILLING_CYCLES,
  PLAN_BILLING_CYCLE_DAYS,
  type PlanBillingCycle,
  type PlanTier,
} from "./constants";
import { addUtcDays, isUtcDate } from "./date-utils";
import { PlanValidationError, SubscriptionValidationError } from "./errors";
import { normalizeServiceKeys, type ServiceKey } from "@/lib/services/catalog";

/** The immutable slice of a plan a subscription is priced and dated against. */
export interface PlanSnapshot {
  planId: string;
  planName: string;
  billingCycle: PlanBillingCycle;
  /** Plan list price in paise. Always 0 for the free tier. */
  listPricePaise: number;
  durationDays: number;
  gracePeriodDays: number;
  isFree: boolean;
  /**
   * Services granted by this plan, normalized and with dependencies filled in.
   * Frozen onto the subscription so later plan edits cannot change an
   * entitlement that has already been issued.
   */
  serviceKeys: ServiceKey[];
}

export function isPlanBillingCycle(value: unknown): value is PlanBillingCycle {
  return typeof value === "string" && (PLAN_BILLING_CYCLES as readonly string[]).includes(value);
}

/**
 * Free vs paid is a property of the plan, never of the subscription: a plan is
 * free when it is on the FREE cycle or costs nothing. Documents written before
 * the `isFree` flag existed have no flag, so the price/cycle are the fallback
 * and legacy ₹0 plans keep behaving like the free tier they always were.
 */
export function resolvePlanTier(input: {
  billingCycle?: unknown;
  pricePaise?: unknown;
  isFree?: unknown;
}): PlanTier {
  if (input.isFree === true) return "FREE";
  if (input.isFree === false) return "PAID";
  if (isPlanBillingCycle(input.billingCycle) && input.billingCycle === "FREE") return "FREE";
  return Number(input.pricePaise ?? 0) === 0 ? "FREE" : "PAID";
}

export function isFreePlan(input: {
  billingCycle?: unknown;
  pricePaise?: unknown;
  isFree?: unknown;
}): boolean {
  return resolvePlanTier(input) === "FREE";
}

function positiveInt(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function nonNegativeInt(value: unknown, max: number): number | null {
  const n = positiveInt(value);
  return n != null && n <= max ? n : null;
}

/**
 * Validates a plan configuration into the shape subscriptions are built from.
 * Throws `PlanValidationError` when the plan cannot be sold as configured —
 * a plan that is free must cost nothing, and a paid plan must cost something.
 *
 * `defaultGracePeriodDays` is only used for plan documents written before the
 * grace period was part of the plan; a configured value always wins.
 */
export function buildPlanSnapshot(
  plan: {
    _id?: unknown;
    planId?: unknown;
    name?: unknown;
    billingCycle?: unknown;
    pricePaise?: unknown;
    durationDays?: unknown;
    gracePeriodDays?: unknown;
    isFree?: unknown;
    isActive?: unknown;
    serviceKeys?: unknown;
  },
  options: { defaultGracePeriodDays?: number } = {}
): PlanSnapshot {
  const billingCycle = plan.billingCycle;
  if (!isPlanBillingCycle(billingCycle)) {
    throw new PlanValidationError("Invalid billing cycle.");
  }

  const listPricePaise = positiveInt(plan.pricePaise ?? 0);
  if (listPricePaise == null || listPricePaise > MAX_PLAN_PRICE_PAISE) {
    throw new PlanValidationError("Price must be a non-negative number.");
  }

  const isFree = isFreePlan({ billingCycle, pricePaise: listPricePaise, isFree: plan.isFree });
  if (billingCycle === "FREE" && listPricePaise !== 0) {
    throw new PlanValidationError("The FREE billing cycle must be priced at ₹0.");
  }
  if (isFree && listPricePaise !== 0) {
    throw new PlanValidationError("A free plan must be priced at ₹0.");
  }

  const durationDays = positiveInt(plan.durationDays);
  const resolvedDuration =
    durationDays && durationDays > 0
      ? durationDays
      : PLAN_BILLING_CYCLE_DAYS[billingCycle];
  if (!Number.isFinite(resolvedDuration) || resolvedDuration < 1 || resolvedDuration > MAX_PLAN_DURATION_DAYS) {
    throw new PlanValidationError(
      `Duration must be between 1 and ${MAX_PLAN_DURATION_DAYS} days.`
    );
  }

  // A plan without a stored grace period falls back to the platform default so
  // a pre-migration plan document still produces a usable subscription.
  const graceRaw = plan.gracePeriodDays;
  let gracePeriodDays: number;
  if (graceRaw == null) {
    gracePeriodDays = assertGracePeriodDays(options.defaultGracePeriodDays ?? 0);
  } else {
    const parsed = nonNegativeInt(graceRaw, MAX_PLAN_GRACE_PERIOD_DAYS);
    if (parsed == null) {
      throw new PlanValidationError(
        `Grace period must be between 0 and ${MAX_PLAN_GRACE_PERIOD_DAYS} days.`
      );
    }
    gracePeriodDays = parsed;
  }

  return {
    planId: String(plan.planId ?? plan._id ?? ""),
    planName: String(plan.name ?? "Plan"),
    billingCycle,
    listPricePaise,
    durationDays: resolvedDuration,
    gracePeriodDays,
    isFree,
    // A plan saved before services existed has no list, which normalizes to
    // `[]` here and is handled by the subscription read-path fallback rather
    // than by inventing entitlements inside the pricing maths.
    serviceKeys: normalizeServiceKeys(
      Array.isArray(plan.serviceKeys) ? plan.serviceKeys : []
    ),
  };
}

/** Validates the grace period a subscription will be stored with. */
export function assertGracePeriodDays(gracePeriodDays: number): number {
  const n = positiveInt(gracePeriodDays);
  if (n == null || n > MAX_PLAN_GRACE_PERIOD_DAYS) {
    throw new SubscriptionValidationError(
      `Grace period must be between 0 and ${MAX_PLAN_GRACE_PERIOD_DAYS} days.`
    );
  }
  return n;
}

export interface PricingResult {
  listPricePaise: number;
  discountAmountPaise: number;
  finalPricePaise: number;
}

/**
 * Final purchase price is always `plan price - discount`, computed on the
 * server. The plan price is never negotiable here, and a free plan is always
 * ₹0 with no discount to apply.
 */
export function computePricing(input: {
  listPricePaise: number;
  discountAmountPaise?: number | null;
  isFree?: boolean;
}): PricingResult {
  const listPricePaise = Math.round(Number(input.listPricePaise));
  if (!Number.isFinite(listPricePaise) || listPricePaise < 0) {
    throw new SubscriptionValidationError("Plan price must be a non-negative number.");
  }

  const discountAmountPaise = Math.round(Number(input.discountAmountPaise ?? 0));
  if (!Number.isFinite(discountAmountPaise) || discountAmountPaise < 0) {
    throw new SubscriptionValidationError("Discount must be a non-negative number.");
  }

  if (input.isFree) {
    if (listPricePaise !== 0) {
      throw new SubscriptionValidationError("A free plan must be priced at ₹0.");
    }
    if (discountAmountPaise !== 0) {
      throw new SubscriptionValidationError("A free plan cannot carry a discount.");
    }
    return { listPricePaise: 0, discountAmountPaise: 0, finalPricePaise: 0 };
  }

  if (discountAmountPaise > listPricePaise) {
    throw new SubscriptionValidationError("Discount cannot exceed the plan price.");
  }

  const finalPricePaise = listPricePaise - discountAmountPaise;
  if (!Number.isFinite(finalPricePaise) || finalPricePaise < 0) {
    throw new SubscriptionValidationError("Final price must be a non-negative number.");
  }
  return { listPricePaise, discountAmountPaise, finalPricePaise };
}

/** Expiry is derived: start date + the plan's duration. Never client supplied. */
export function calculateExpiryDate(startDate: Date, durationDays: number): Date {
  if (!isUtcDate(startDate)) {
    throw new SubscriptionValidationError("A valid start date is required.");
  }
  const days = Math.round(Number(durationDays));
  if (!Number.isFinite(days) || days < 1 || days > MAX_PLAN_DURATION_DAYS) {
    throw new SubscriptionValidationError(
      `Duration must be between 1 and ${MAX_PLAN_DURATION_DAYS} days.`
    );
  }
  return addUtcDays(startDate, days);
}

/** Last day the venue may still operate after expiry. */
export function calculateGraceEndDate(expiryDate: Date, gracePeriodDays: number): Date {
  const days = Math.round(Number(gracePeriodDays ?? 0));
  if (!Number.isFinite(days) || days < 0 || days > MAX_PLAN_GRACE_PERIOD_DAYS) {
    throw new SubscriptionValidationError(
      `Grace period must be between 0 and ${MAX_PLAN_GRACE_PERIOD_DAYS} days.`
    );
  }
  return addUtcDays(expiryDate, days);
}

/**
 * A free plan is never a trial flag the client can flip: the plan decides, and
 * the resulting subscription is stored as a TRIAL so the existing lifecycle
 * (and the access gate) treats it exactly like any other subscription.
 */
export function statusForPlanTier(isFree: boolean): "TRIAL" | "ACTIVE" {
  return isFree ? "TRIAL" : "ACTIVE";
}
