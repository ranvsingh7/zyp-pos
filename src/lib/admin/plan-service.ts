import "server-only";

import { connectDB } from "@/lib/db";
import { PlanModel } from "@/models/Plan";
import {
  DEFAULT_GRACE_PERIOD_DAYS,
  MAX_PLAN_DURATION_DAYS,
  MAX_PLAN_GRACE_PERIOD_DAYS,
  MAX_PLAN_PRICE_PAISE,
  PLAN_BILLING_CYCLE_DAYS,
  type PlanBillingCycle,
  type PlanTier,
} from "./constants";
import { PlanNotFoundError, PlanValidationError } from "./errors";
import { isPlanBillingCycle, resolvePlanTier } from "./plan-config";
import { logPlatformAudit } from "./audit";
import { normalizeServiceKeys, type ServiceKey } from "@/lib/services/catalog";

export interface PlanView {
  planId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  billingCycle: PlanBillingCycle;
  durationDays: number;
  gracePeriodDays: number;
  /** Free tier: priced at ₹0 and never requires a payment. */
  isFree: boolean;
  tier: PlanTier;
  isActive: boolean;
  features: string[];
  /** Service keys this plan includes. See the service catalog. */
  serviceKeys: ServiceKey[];
  createdAt: Date;
  updatedAt: Date;
}

function toView(plan: {
  _id: unknown;
  name: unknown;
  description: unknown;
  pricePaise: unknown;
  billingCycle: unknown;
  durationDays: unknown;
  gracePeriodDays: unknown;
  isFree: unknown;
  isActive: unknown;
  features: unknown;
  serviceKeys?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}): PlanView {
  const pricePaise = Number(plan.pricePaise ?? 0);
  const billingCycle = isPlanBillingCycle(plan.billingCycle) ? plan.billingCycle : "MONTHLY";
  // Pre-migration plans carry no isFree flag; the cycle/price decide instead.
  const isFree = resolvePlanTier({ billingCycle, pricePaise, isFree: plan.isFree }) === "FREE";
  const durationDays = Number(plan.durationDays ?? 0) || PLAN_BILLING_CYCLE_DAYS[billingCycle];
  const rawGrace = plan.gracePeriodDays;
  return {
    planId: String(plan._id),
    name: String(plan.name),
    description: plan.description ? String(plan.description) : null,
    pricePaise,
    billingCycle,
    durationDays,
    gracePeriodDays:
      rawGrace == null ? DEFAULT_GRACE_PERIOD_DAYS : Math.max(0, Math.round(Number(rawGrace))),
    isFree,
    tier: isFree ? "FREE" : "PAID",
    isActive: Boolean(plan.isActive),
    features: Array.isArray(plan.features) ? plan.features.map(String) : [],
    serviceKeys: normalizeServiceKeys(
      Array.isArray(plan.serviceKeys) ? plan.serviceKeys : []
    ),
    createdAt: new Date(plan.createdAt as string | number | Date),
    updatedAt: new Date(plan.updatedAt as string | number | Date),
  };
}

export interface PlanFilters {
  search?: string;
  includeInactive?: boolean;
}

export async function listPlans(filters: PlanFilters = {}): Promise<PlanView[]> {
  await connectDB();
  const query: Record<string, unknown> = {};
  if (!filters.includeInactive) {
    query.isActive = true;
  }
  if (filters.search?.trim()) {
    query.name = { $regex: filters.search.trim(), $options: "i" };
  }
  const plans = await PlanModel.find(query).sort({ pricePaise: 1, name: 1 }).lean();
  return plans.map((p) =>
    toView(p as unknown as Parameters<typeof toView>[0])
  );
}

/** Active plans only — the only set a subscription may be created from. */
export async function listActivePlans(): Promise<PlanView[]> {
  return listPlans({ includeInactive: false });
}

export async function getPlanById(planId: string): Promise<PlanView | null> {
  await connectDB();
  const plan = await PlanModel.findById(planId).lean();
  return plan
    ? toView(plan as unknown as Parameters<typeof toView>[0])
    : null;
}

export interface SavePlanInput {
  name?: string;
  description?: string | null;
  pricePaise?: number | null;
  billingCycle?: string;
  durationDays?: number | null;
  gracePeriodDays?: number | null;
  isFree?: boolean;
  isActive?: boolean;
  features?: string[];
  /**
   * Service keys to grant. Unknown keys are dropped and declared dependencies
   * are added, so what gets stored is always a valid entitlement set.
   */
  serviceKeys?: string[];
}

export interface CreatePlanInput extends SavePlanInput {
  name: string;
  pricePaise: number;
  billingCycle: string;
  createdBy?: string | null;
}

/**
 * The plan is the single source of truth for what a subscription costs and how
 * long it lasts, so a plan that cannot be priced consistently is rejected at
 * configuration time rather than blowing up at checkout.
 *
 * Free is derived, never asserted: a plan is free when it sits on the FREE
 * cycle or costs nothing, and it can never claim to be free while charging
 * money. That also means a ₹0 plan created before the FREE cycle existed keeps
 * working as the free tier it always was.
 */
function resolvePlanEconomics(input: {
  pricePaise?: number | null;
  billingCycle?: string | null;
  isFree?: boolean | null;
}): { pricePaise: number; isFree: boolean } {
  if (!isPlanBillingCycle(input.billingCycle)) {
    throw new PlanValidationError("Invalid billing cycle.");
  }
  const billingCycle = input.billingCycle as PlanBillingCycle;

  const pricePaise = Math.round(Number(input.pricePaise ?? 0));
  if (!Number.isFinite(pricePaise) || pricePaise < 0) {
    throw new PlanValidationError("Price must be a non-negative number.");
  }
  if (pricePaise > MAX_PLAN_PRICE_PAISE) {
    throw new PlanValidationError("Price is above the maximum allowed plan price.");
  }

  const isFree = billingCycle === "FREE" || pricePaise === 0;
  if (isFree && pricePaise !== 0) {
    throw new PlanValidationError("A free plan must be priced at ₹0.");
  }
  if (billingCycle === "FREE" && pricePaise !== 0) {
    throw new PlanValidationError("The FREE billing cycle must be priced at ₹0.");
  }
  return { pricePaise, isFree };
}

function resolveDurationDays(
  requested: number | null | undefined,
  billingCycle: PlanBillingCycle
): number {
  const days =
    Number(requested && requested > 0 ? requested : 0) ||
    PLAN_BILLING_CYCLE_DAYS[billingCycle] ||
    30;
  const rounded = Math.round(days);
  if (!Number.isFinite(rounded) || rounded < 1 || rounded > MAX_PLAN_DURATION_DAYS) {
    throw new PlanValidationError(
      `Duration must be between 1 and ${MAX_PLAN_DURATION_DAYS} days.`
    );
  }
  return rounded;
}

function resolveGracePeriodDays(requested: number | null | undefined): number {
  const days = Math.round(Number(requested ?? DEFAULT_GRACE_PERIOD_DAYS));
  if (!Number.isFinite(days) || days < 0 || days > MAX_PLAN_GRACE_PERIOD_DAYS) {
    throw new PlanValidationError(
      `Grace period must be between 0 and ${MAX_PLAN_GRACE_PERIOD_DAYS} days.`
    );
  }
  return days;
}

function normalizeFeatures(features: unknown): string[] {
  return Array.isArray(features)
    ? features.map((f) => String(f).trim()).filter(Boolean).slice(0, 20)
    : [];
}

export async function createPlan(input: CreatePlanInput): Promise<PlanView> {
  await connectDB();
  const name = String(input.name ?? "").trim();
  if (!name) throw new PlanValidationError("Plan name is required.");
  const { pricePaise, isFree } = resolvePlanEconomics({
    pricePaise: input.pricePaise,
    billingCycle: input.billingCycle,
    isFree: input.isFree,
  });
  const durationDays = resolveDurationDays(input.durationDays, input.billingCycle as PlanBillingCycle);
  const gracePeriodDays = resolveGracePeriodDays(input.gracePeriodDays);

  const plan = await PlanModel.create({
    name,
    description: input.description?.trim() || null,
    pricePaise,
    billingCycle: input.billingCycle,
    durationDays,
    gracePeriodDays,
    isFree,
    isActive: Boolean(input.isActive ?? true),
    features: normalizeFeatures(input.features),
    serviceKeys: normalizeServiceKeys(input.serviceKeys ?? []),
    createdBy: input.createdBy ?? null,
  });

  // Allow-listed business fields only. A plan row never holds credentials, and
  // an explicit list (rather than spreading the document) means a future column
  // cannot silently start leaking into the audit trail.
  await logPlatformAudit({
    action: "PLAN_CREATED",
    actorId: input.createdBy ?? null,
    actorRole: "SUPER_ADMIN",
    entityType: "PLAN",
    entityId: String(plan._id),
    entityName: name,
    summary: `Plan created: ${name} (${isFree ? "Free" : `₹${(pricePaise / 100).toFixed(2)}`} / ${String(input.billingCycle).toLowerCase()})`,
    // Nothing existed before, so `before` stays null and `after` is the plan.
    before: null,
    after: {
      name,
      description: input.description?.trim() || null,
      pricePaise,
      billingCycle: input.billingCycle,
      durationDays,
      gracePeriodDays,
      isFree,
      isActive: Boolean(input.isActive ?? true),
      features: normalizeFeatures(input.features),
      serviceKeys: normalizeServiceKeys(input.serviceKeys ?? []),
    },
    metadata: {
      pricePaise,
      billingCycle: input.billingCycle,
      durationDays,
      gracePeriodDays,
      isFree,
      serviceKeys: normalizeServiceKeys(input.serviceKeys ?? []),
    },
  });

  return getPlanById(String(plan._id)) as Promise<PlanView>;
}

export async function updatePlan(
  planId: string,
  input: SavePlanInput,
  meta: {
    updatedBy?: string | null;
    /**
     * Internal. Set by callers that emit a more specific event for the same
     * write (e.g. activation), so one mutation does not produce two rows.
     */
    auditHandledByCaller?: boolean;
  } = {}
): Promise<PlanView> {
  await connectDB();
  const existing = await PlanModel.findById(planId).lean();
  if (!existing) throw new PlanNotFoundError();

  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new PlanValidationError("Plan name is required.");
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = input.description ? String(input.description).trim() : null;
  }

  // Price, cycle and free/paid are resolved together because they are only
  // meaningful as a set: a FREE cycle is always ₹0, a paid plan never is.
  const touchesEconomics =
    input.pricePaise !== undefined ||
    input.billingCycle !== undefined ||
    input.isFree !== undefined;
  if (touchesEconomics) {
    const billingCycle = isPlanBillingCycle(input.billingCycle)
      ? input.billingCycle
      : isPlanBillingCycle(existing.billingCycle)
        ? existing.billingCycle
        : null;
    const economics = resolvePlanEconomics({
      pricePaise: input.pricePaise !== undefined ? input.pricePaise : existing.pricePaise,
      billingCycle,
      isFree: input.isFree !== undefined ? input.isFree : existing.isFree,
    });
    patch.pricePaise = economics.pricePaise;
    patch.isFree = economics.isFree;
    if (input.billingCycle !== undefined) {
      patch.billingCycle = input.billingCycle;
      if (input.durationDays == null) {
        patch.durationDays = resolveDurationDays(
          null,
          input.billingCycle as PlanBillingCycle
        );
      }
    }
  }
  if (input.durationDays !== undefined && input.durationDays != null && input.durationDays > 0) {
    patch.durationDays = resolveDurationDays(
      input.durationDays,
      (patch.billingCycle ?? existing.billingCycle) as PlanBillingCycle
    );
  }
  if (input.gracePeriodDays !== undefined && input.gracePeriodDays != null) {
    patch.gracePeriodDays = resolveGracePeriodDays(input.gracePeriodDays);
  }
  if (input.isActive !== undefined) {
    patch.isActive = Boolean(input.isActive);
  }
  if (input.features !== undefined) {
    patch.features = normalizeFeatures(input.features);
  }
  if (input.serviceKeys !== undefined) {
    // Editing a plan never touches an issued subscription: those keep the
    // snapshot they were sold. A new service reaches an existing subscriber
    // only through an explicit renew or plan change.
    patch.serviceKeys = normalizeServiceKeys(input.serviceKeys);
  }

  // Existing subscriptions keep their own snapshot, so editing a plan never
  // re-prices or re-dates a subscription that was already sold.
  await PlanModel.updateOne({ _id: planId }, { $set: patch });

  const planName = String(patch.name ?? existing.name);
  const actorId = meta.updatedBy ?? null;
  // `existing` may predate service tracking, so normalize before diffing: an
  // empty stored list and an absent one mean the same thing here.
  const previousServiceKeys = normalizeServiceKeys(
    Array.isArray(existing.serviceKeys) ? existing.serviceKeys : []
  );
  const newServiceKeys = Array.isArray(patch.serviceKeys)
    ? (patch.serviceKeys as ServiceKey[])
    : previousServiceKeys;
  // Both sides are normalized, so a positional compare is meaningful. There is
  // deliberately no "did the new list have anything in it" guard: a platform
  // emptying a plan is exactly as much of a change as one adding a module, and
  // suppressing that event left the removal unaudited. `[] -> []` is still a
  // no-op here because the lengths match and no position differs.
  const servicesChanged =
    newServiceKeys.length !== previousServiceKeys.length ||
    newServiceKeys.some((k, i) => k !== previousServiceKeys[i]);
  // A change to which services a plan sells is a different fact from an
  // ordinary field edit, so it gets its own action and a readable diff. "Plan
  // updated" on its own would not say what a venue gained or lost.
  if (servicesChanged) {
    const previous = new Set(previousServiceKeys);
    const next = new Set(newServiceKeys);
    const added = newServiceKeys.filter((k) => !previous.has(k));
    const removed = previousServiceKeys.filter((k) => !next.has(k));
    await logPlatformAudit({
      action: "PLAN_SERVICES_UPDATED",
      actorId,
      actorRole: "SUPER_ADMIN",
      entityType: "PLAN",
      entityId: planId,
      entityName: planName,
      summary:
        `Services updated on ${planName}: ` +
        `+${added.length ? added.join(", ") : "none"} ` +
        `-${removed.length ? removed.join(", ") : "none"}`,
      before: { serviceKeys: previousServiceKeys },
      after: { serviceKeys: newServiceKeys },
      metadata: {
        planId,
        servicesAdded: added,
        servicesRemoved: removed,
        previousServiceKeys,
        newServiceKeys,
      },
    });
  }

  // Non-service edits. When only the service selection changed, emitting a
  // second event with an empty field list would be noise, so it is skipped.
  const changedFields = Object.keys(patch).filter((f) => f !== "serviceKeys");
  if (changedFields.length > 0 && !meta.auditHandledByCaller) {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of changedFields) {
      before[field] = (existing as Record<string, unknown>)[field] ?? null;
      after[field] = patch[field];
    }
    await logPlatformAudit({
      action: "PLAN_UPDATED",
      actorId,
      actorRole: "SUPER_ADMIN",
      entityType: "PLAN",
      entityId: planId,
      entityName: planName,
      summary: `Plan updated: ${planName}`,
      before,
      after,
      metadata: { planId, changed: changedFields },
    });
  }

  const updated = await getPlanById(planId);
  if (!updated) throw new PlanNotFoundError();
  return updated;
}

/** Flip a plan's active state; inactive plans can no longer be chosen. */
export async function setPlanActive(
  planId: string,
  isActive: boolean,
  meta: { updatedBy?: string | null } = {}
): Promise<PlanView> {
  await connectDB();
  // Read the prior state before the write so the audit row records a real
  // transition (including a no-op re-activation) rather than just a target.
  const before = await getPlanById(planId);
  if (!before) throw new PlanNotFoundError();

  await updatePlan(planId, { isActive }, { ...meta, auditHandledByCaller: true });

  await logPlatformAudit({
    action: isActive ? "PLAN_ACTIVATED" : "PLAN_DEACTIVATED",
    actorId: meta.updatedBy ?? null,
    actorRole: "SUPER_ADMIN",
    entityType: "PLAN",
    entityId: planId,
    entityName: before.name,
    summary: isActive
      ? `Plan activated: ${before.name}`
      : `Plan deactivated: ${before.name}`,
    before: { isActive: before.isActive },
    after: { isActive },
    metadata: { planId, wasActive: before.isActive, isActive },
  });

  const updated = await getPlanById(planId);
  if (!updated) throw new PlanNotFoundError();
  return updated;
}
