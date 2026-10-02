import "server-only";

import type { QueryFilter } from "mongoose";
import { connectDB } from "@/lib/db";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel, type Subscription } from "@/models/Subscription";
import { SubscriptionHistoryModel, type SubscriptionHistoryAction } from "@/models/SubscriptionHistory";
import { RestaurantModel } from "@/models/Restaurant";
import type { PlanBillingCycle, SubscriptionStatus } from "@/lib/admin/constants";
import { BLOCKED_SUBSCRIPTION_STATUSES } from "@/lib/admin/constants";
import {
  PlanNotFoundError,
  SubscriptionNotFoundError,
  SubscriptionValidationError,
} from "./errors";
import {
  buildPlanSnapshot,
  calculateExpiryDate,
  calculateGraceEndDate,
  computePricing,
  isFreePlan,
  statusForPlanTier,
  type PlanSnapshot,
  type PricingResult,
} from "./plan-config";
import { resolveEntitledServices, type ServiceKey } from "@/lib/services/catalog";
import { addUtcDays, daysUntil } from "./date-utils";
import { getPlatformSettings } from "./platform-settings";
import { runInTransaction } from "./_shared";
import { logPlatformAudit } from "./audit";

/* ------------------------------------------------------------------ */
/* Status classification (pure, testable)                              */
/* ------------------------------------------------------------------ */

export interface DerivationContext {
  now?: Date;
  warningDays?: number;
  graceDays?: number;
}

/**
 * Single source of truth for where a subscription sits in its lifecycle.
 * Manual terminal states (SUSPENDED / CANCELLED) are never auto-flipped. Every
 * other state derives from dates + platform policy:
 *   days > warning         -> stored state (TRIAL/ACTIVE)
 *   days <= warning, > 0   -> EXPIRING
 *   day of expiry .. grace -> GRACE_PERIOD
 *   past grace             -> EXPIRED
 */
export function deriveSubscriptionStatus(input: {
  storedStatus: SubscriptionStatus;
  expiryDate: Date | null | undefined;
  gracePeriodDays?: number | null;
  now?: Date;
  warningDays?: number;
  graceDays?: number;
}): SubscriptionStatus {
  const { storedStatus, expiryDate, gracePeriodDays = null } = input;
  if (storedStatus === "SUSPENDED" || storedStatus === "CANCELLED") {
    return storedStatus;
  }
  // NONE means "this restaurant has no subscription". It is never persisted,
  // but if a document ever carries it we must not read the date arithmetic as
  // licence to serve the venue: a missing subscription blocks.
  if (storedStatus === "NONE") {
    return "NONE";
  }
  const now = input.now ?? new Date();
  const warningDays = input.warningDays ?? 7;
  // A grace period recorded on the subscription itself is authoritative: a
  // SUPER_ADMIN who assigns `gracePeriodDays: 0` means "cut off at expiry", and
  // the platform-wide default must not quietly add days to that. The platform
  // value is only the fallback for subscriptions that never set one.
  const graceDays =
    gracePeriodDays != null && gracePeriodDays >= 0
      ? gracePeriodDays
      : (input.graceDays ?? 7);

  if (!expiryDate) {
    return storedStatus === "TRIAL" ? "TRIAL" : "ACTIVE";
  }
  const days = daysUntil(expiryDate, now);
  if (days <= -graceDays) return "EXPIRED";
  if (days < 0) return "GRACE_PERIOD";
  if (days <= warningDays) return "EXPIRING";
  return storedStatus === "TRIAL" ? "TRIAL" : "ACTIVE";
}

export function isBlockedStatus(status: SubscriptionStatus): boolean {
  return (BLOCKED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Persists the derived status wherever it differs. Kept read-path cheap: only
 * statuses that can *become* multi-day states equal to a new label are touched
 * (never SUSPENDED/CANCELLED), and only docs whose window is within warning or
 * already past expiry are fetched.
 */
export async function refreshSubscriptionStatuses(
  now: Date = new Date()
): Promise<void> {
  const settings = await getPlatformSettings();
  const candidates = await SubscriptionModel.find({
    status: { $in: ["TRIAL", "ACTIVE", "GRACE_PERIOD", "EXPIRING"] },
  })
    .select("restaurantId status expiryDate gracePeriodDays")
    .lean();

  const writes: Array<{
    updateOne: {
      filter: { _id: unknown };
      update: { $set: { status: SubscriptionStatus } };
    };
  }> = [];
  for (const doc of candidates) {
    const derived = deriveSubscriptionStatus({
      storedStatus: doc.status as SubscriptionStatus,
      expiryDate: doc.expiryDate,
      gracePeriodDays: doc.gracePeriodDays,
      now,
      warningDays: settings.expiryWarningDays,
      graceDays: settings.gracePeriodDays,
    });
    if (derived !== doc.status) {
      writes.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { status: derived } },
        },
      });
    }
  }
  if (writes.length > 0) {
    await SubscriptionModel.bulkWrite(writes);
  }
}

/* ------------------------------------------------------------------ */
/* Views / helpers                                                     */
/* ------------------------------------------------------------------ */

export interface SubscriptionView {
  subscriptionId: string;
  restaurantId: string;
  restaurantName: string;
  planId: string;
  /** Plan name snapshot taken when the subscription was priced. */
  planName: string;
  billingCycle: PlanBillingCycle;
  /** Plan duration snapshot (days) the expiry date was derived from. */
  durationDays: number;
  /**
   * The services this subscription was granted, as resolved for display.
   *
   * Always populated, even for documents written before snapshots existed: the
   * documented fallback is applied so the UI never shows an empty entitlement
   * list for a venue that is genuinely entitled to features. The stored
   * `serviceKeys` field itself is never backfilled.
   */
  serviceKeys: ServiceKey[];
  /** Free tier: priced at ₹0, no payment required. */
  isFree: boolean;
  listPricePaise: number;
  discountAmountPaise: number;
  finalPricePaise: number;
  startDate: Date;
  expiryDate: Date;
  gracePeriodDays: number;
  /** Last day the venue may still operate: expiry + the plan's grace period. */
  graceEndDate: Date;
  status: SubscriptionStatus;
  storedStatus: SubscriptionStatus;
  daysLeft: number;
  autoRenew: boolean;
  notes: string | null;
  /** When the current hold started, if the subscription is suspended. */
  suspendedAt: Date | null;
  /** The SUPER_ADMIN who placed the current hold. */
  suspendedBy: string | null;
  /** Why the venue is on hold, for display on the admin card. */
  suspensionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Effective status + access verdict used by guards and pages. */
export interface SubscriptionAccessInfo {
  allowed: boolean;
  status: SubscriptionStatus;
  /** Whole days until expiry (negative = already expired). */
  daysLeft: number;
  expiryDate: Date | null;
  planName: string | null;
}

async function planNameMap(): Promise<Map<string, string>> {
  const plans = await PlanModel.find().select("_id name").lean();
  return new Map(plans.map((p) => [String(p._id), String(p.name)]));
}

/** Live plan service keys, keyed by plan id, for the snapshot-less fallback. */
async function planServiceKeysMap(): Promise<Map<string, string[]>> {
  const plans = await PlanModel.find().select("_id serviceKeys").lean();
  return new Map(
    plans.map((p) => [String(p._id), Array.isArray(p.serviceKeys) ? p.serviceKeys.map(String) : []])
  );
}

export function toView(
  sub: {
    _id: unknown;
    restaurantId: unknown;
    planId: unknown;
    planName?: unknown;
    serviceKeys?: unknown;
    listPricePaise: unknown;
    discountAmountPaise: unknown;
    finalPricePaise: unknown;
    billingCycle: unknown;
    startDate: unknown;
    expiryDate: unknown;
    durationDays?: unknown;
    gracePeriodDays: unknown;
    isFree?: unknown;
    status: unknown;
    autoRenew: unknown;
    notes: unknown;
    suspendedAt: unknown;
    suspendedBy: unknown;
    suspensionReason: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  },
  restaurantName: string,
  livePlanName: string,
  now: Date = new Date(),
  /**
   * The plan's current service keys. Only consulted for subscriptions written
   * before service snapshots existed; see `resolveEntitledServices`.
   */
  livePlanServiceKeys: readonly string[] = []
): SubscriptionView {
  const status = deriveSubscriptionStatus({
    storedStatus: sub.status as SubscriptionStatus,
    expiryDate: (sub.expiryDate ?? null) as Date | null,
    gracePeriodDays: (sub.gracePeriodDays ?? null) as number | null,
    now,
  });
  const expiryDate = new Date(sub.expiryDate as string | number | Date);
  const gracePeriodDays = Math.max(0, Number(sub.gracePeriodDays ?? 0));
  // The snapshot wins over the live plan name: renaming a plan later must not
  // rewrite what a subscription says it was sold as.
  const planName = sub.planName ? String(sub.planName) : livePlanName;
  const billingCycle = String(sub.billingCycle ?? "MONTHLY") as PlanBillingCycle;
  return {
    subscriptionId: String(sub._id),
    restaurantId: String(sub.restaurantId),
    restaurantName,
    planId: String(sub.planId),
    planName,
    billingCycle,
    durationDays:
      Number(sub.durationDays ?? 0) > 0
        ? Number(sub.durationDays)
        : Math.max(
            0,
            Math.round(
              (expiryDate.getTime() - new Date(sub.startDate as string | number | Date).getTime()) /
                (24 * 60 * 60 * 1000)
            )
          ),
    isFree: isFreePlan({
      billingCycle,
      pricePaise: Number(sub.listPricePaise ?? 0),
      isFree: sub.isFree,
    }),
    serviceKeys: resolveEntitledServices(sub.serviceKeys, livePlanServiceKeys),
    listPricePaise: Number(sub.listPricePaise ?? 0),
    discountAmountPaise: Number(sub.discountAmountPaise ?? 0),
    finalPricePaise: Number(sub.finalPricePaise ?? 0),
    startDate: new Date(sub.startDate as string | number | Date),
    expiryDate,
    gracePeriodDays,
    graceEndDate: calculateGraceEndDate(expiryDate, gracePeriodDays),
    status,
    storedStatus: sub.status as SubscriptionStatus,
    daysLeft: sub.expiryDate
      ? daysUntil(expiryDate, now)
      : (sub.status === "TRIAL" ? 30 : 0),
    autoRenew: Boolean(sub.autoRenew),
    notes: sub.notes ? String(sub.notes) : null,
    suspendedAt: sub.suspendedAt ? new Date(sub.suspendedAt as string | number | Date) : null,
    suspendedBy: sub.suspendedBy ? String(sub.suspendedBy) : null,
    suspensionReason: sub.suspensionReason ? String(sub.suspensionReason) : null,
    createdAt: new Date(sub.createdAt as string | number | Date),
    updatedAt: new Date(sub.updatedAt as string | number | Date),
  };
}

/**
 * Loads a plan from the database and freezes it into the snapshot a
 * subscription is priced and dated against. This is the only path that decides
 * price / duration / grace period / billing cycle — a caller can name a plan
 * but can never dictate what it is worth.
 */
async function loadPlanSnapshot(
  planId: string,
  options: { requireActive?: boolean } = {}
): Promise<PlanSnapshot> {
  await connectDB();
  const plan = await PlanModel.findById(planId).lean();
  if (!plan) throw new PlanNotFoundError();
  if (options.requireActive !== false && !plan.isActive) {
    throw new SubscriptionValidationError("Cannot subscribe to an inactive plan.");
  }
  const settings = await getPlatformSettings();
  return buildPlanSnapshot(
    {
      _id: plan._id,
      name: plan.name,
      billingCycle: plan.billingCycle,
      pricePaise: plan.pricePaise,
      durationDays: plan.durationDays,
      gracePeriodDays: plan.gracePeriodDays ?? settings.gracePeriodDays,
      isFree: plan.isFree,
      isActive: plan.isActive,
      // Part of what the subscriber is being sold, so it belongs in the frozen
      // snapshot exactly as much as the price and the term.
      serviceKeys: plan.serviceKeys,
    },
    { defaultGracePeriodDays: settings.gracePeriodDays }
  );
}

/** Everything derived from (plan + start date + discount) for one write. */
async function priceFromPlan(input: {
  planId: string;
  startDate: Date;
  discountAmountPaise?: number | null;
  requireActivePlan?: boolean;
}): Promise<{ snapshot: PlanSnapshot; pricing: PricingResult; expiryDate: Date; graceEndDate: Date }> {
  const snapshot = await loadPlanSnapshot(input.planId, {
    requireActive: input.requireActivePlan !== false,
  });
  const pricing = computePricing({
    listPricePaise: snapshot.listPricePaise,
    discountAmountPaise: input.discountAmountPaise,
    isFree: snapshot.isFree,
  });
  const expiryDate = calculateExpiryDate(input.startDate, snapshot.durationDays);
  return {
    snapshot,
    pricing,
    expiryDate,
    graceEndDate: calculateGraceEndDate(expiryDate, snapshot.gracePeriodDays),
  };
}

/* ------------------------------------------------------------------ */
/* History + audit helpers                                             */
/* ------------------------------------------------------------------ */

interface SnapshotPoint {
  planId?: unknown;
  planName?: string | null;
  listPricePaise?: number | null;
  discountAmountPaise?: number | null;
  finalPricePaise?: number | null;
  startDate?: Date | null;
  expiryDate?: Date | null;
}

async function appendHistory(
  input: {
    subscription: {
      _id: unknown;
      restaurantId: unknown;
      planId: unknown;
    };
    action: SubscriptionHistoryAction;
    from: SnapshotPoint;
    to: SnapshotPoint;
    planName: string;
    changedBy: unknown;
    changedByRole: string | null;
    reason?: string | null;
  },
  session?: import("mongoose").ClientSession
): Promise<void> {
  await SubscriptionHistoryModel.create(
    [
      {
        subscriptionId: String(input.subscription._id),
        restaurantId: String(input.subscription.restaurantId),
        action: input.action,
        from: {
          planName: input.from.planName ?? null,
          planId: input.from.planId ? String(input.from.planId) : null,
          listPricePaise:
            input.from.listPricePaise != null ? Number(input.from.listPricePaise) : null,
          discountAmountPaise:
            input.from.discountAmountPaise != null
              ? Number(input.from.discountAmountPaise)
              : null,
          finalPricePaise:
            input.from.finalPricePaise != null ? Number(input.from.finalPricePaise) : null,
          startDate: input.from.startDate ?? null,
          expiryDate: input.from.expiryDate ?? null,
        },
        to: {
          planName: input.to.planName ?? input.planName ?? null,
          planId: input.to.planId ? String(input.to.planId) : null,
          listPricePaise:
            input.to.listPricePaise != null ? Number(input.to.listPricePaise) : null,
          discountAmountPaise:
            input.to.discountAmountPaise != null
              ? Number(input.to.discountAmountPaise)
              : null,
          finalPricePaise:
            input.to.finalPricePaise != null ? Number(input.to.finalPricePaise) : null,
          startDate: input.to.startDate ?? null,
          expiryDate: input.to.expiryDate ?? null,
        },
        changedBy: input.changedBy ? String(input.changedBy) : null,
        changedByRole: input.changedByRole,
        reason: input.reason ?? null,
      },
    ],
    session ? { session } : undefined
  );
}

type SubscriptionDocumentLean = {
  _id: unknown;
  restaurantId: unknown;
  planId: unknown;
  planName?: string | null;
  listPricePaise: number;
  discountAmountPaise: number;
  finalPricePaise: number;
  billingCycle: string;
  startDate: unknown;
  expiryDate: unknown;
  durationDays?: number | null;
  gracePeriodDays: number;
  isFree?: boolean | null;
  status: string;
  autoRenew: boolean;
  notes: string | null;
  suspendedAt: Date | null;
  suspendedBy: unknown;
  suspensionReason: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

async function snapshotFor(
  sub: SubscriptionDocumentLean,
  fallbackPlanName: string
): Promise<SnapshotPoint> {
  return {
    planId: sub.planId,
    // Historical rows keep the name the subscription was sold under.
    planName: sub.planName ? String(sub.planName) : fallbackPlanName,
    listPricePaise: sub.listPricePaise,
    discountAmountPaise: sub.discountAmountPaise,
    finalPricePaise: sub.finalPricePaise,
    startDate: new Date(sub.startDate as string | number | Date),
    expiryDate: new Date(sub.expiryDate as string | number | Date),
  };
}

/**
 * Shape a history snapshot for an audit row. Audit records are read by people
 * and exported to CSV, so ids and dates are normalised to strings: a raw
 * ObjectId buried in `before`/`after` renders as an opaque binary blob and is
 * useless to whoever is reviewing the trail.
 */
function auditPoint(point: SnapshotPoint): Record<string, unknown> {
  return {
    planId: point.planId != null ? String(point.planId) : null,
    planName: point.planName,
    listPricePaise: point.listPricePaise,
    discountAmountPaise: point.discountAmountPaise,
    finalPricePaise: point.finalPricePaise,
    startDate: point.startDate ? new Date(point.startDate).toISOString() : null,
    expiryDate: point.expiryDate ? new Date(point.expiryDate).toISOString() : null,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function getSubscriptionById(
  subscriptionId: string
): Promise<SubscriptionView | null> {
  await connectDB();
  const sub = await SubscriptionModel.findById(subscriptionId).lean();
  if (!sub) return null;

  const [restaurant, plans, planServices] = await Promise.all([
    RestaurantModel.findById(sub.restaurantId).select("name").lean(),
    planNameMap(),
    planServiceKeysMap(),
  ]);
  const planName =
    plans.get(String(sub.planId)) ?? (sub.planId ? String(sub.planId) : "Plan");
  return toView(
    sub as unknown as SubscriptionDocumentLean,
    restaurant?.name ? String(restaurant.name) : "Restaurant",
    planName,
    new Date(),
    planServices.get(String(sub.planId)) ?? []
  );
}

/** The single current subscription for a restaurant. */
export async function getSubscriptionByRestaurantId(
  restaurantId: string
): Promise<SubscriptionView | null> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId }).sort({ createdAt: 1 }).lean();
  if (!sub) return null;
  const [restaurant, plans, planServices] = await Promise.all([
    RestaurantModel.findById(restaurantId).select("name").lean(),
    planNameMap(),
    planServiceKeysMap(),
  ]);
  return toView(
    sub as unknown as SubscriptionDocumentLean,
    restaurant?.name ? String(restaurant.name) : "Restaurant",
    plans.get(String(sub.planId)) ?? "Plan",
    new Date(),
    planServices.get(String(sub.planId)) ?? []
  );
}

/**
 * Guard-facing access check, and the single source of truth for "may this
 * restaurant use ZYP POS?".
 *
 * A restaurant may only use the application when a SUPER_ADMIN has assigned it
 * a subscription that is still valid. No subscription at all is therefore
 * blocked — previously a missing subscription was treated as an open trial,
 * which let any self-onboarded venue in unchecked.
 *
 * Validity is decided from the stored status *and* the expiry date, never from
 * anything the client sends:
 *   - none at all            -> NONE (blocked)
 *   - ACTIVE / TRIAL, future expiry -> allowed (the product supports a trial)
 *   - expiry in the past     -> EXPIRED / GRACE_PERIOD, per platform policy
 *   - SUSPENDED or CANCELLED -> blocked regardless of the expiry date
 */
export async function getSubscriptionAccess(
  restaurantId: string,
  now: Date = new Date()
): Promise<SubscriptionAccessInfo> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId }).lean();
  if (!sub) {
    return {
      allowed: false,
      status: "NONE",
      daysLeft: 0,
      expiryDate: null,
      planName: null,
    };
  }
  const settings = await getPlatformSettings();
  const status = deriveSubscriptionStatus({
    storedStatus: sub.status as SubscriptionStatus,
    expiryDate: sub.expiryDate,
    gracePeriodDays: sub.gracePeriodDays,
    now,
    warningDays: settings.expiryWarningDays,
    graceDays: settings.gracePeriodDays,
  });
  return {
    allowed: !isBlockedStatus(status),
    status,
    daysLeft: sub.expiryDate ? daysUntil(new Date(sub.expiryDate), now) : 0,
    expiryDate: sub.expiryDate ? new Date(sub.expiryDate) : null,
    planName: sub.planId ? String(sub.planId) : null,
  };
}

/**
 * The entire client-supplied surface of "create subscription": which plan,
 * when it starts, an optional discount and a note. Price, duration, billing
 * cycle, grace period, expiry and the final amount are all resolved from the
 * plan document on the server — extra properties on the input object are
 * ignored, so a tampered payload cannot change what is charged or for how long.
 */
export interface CreateSubscriptionInput {
  restaurantId: string;
  planId: string;
  discountAmountPaise?: number | null;
  startDate?: Date;
  notes?: string | null;
  createdBy?: string | null;
  changedByRole?: string | null;
  reason?: string | null;
}

export async function createSubscription(
  input: CreateSubscriptionInput,
  meta: { session?: import("mongoose").ClientSession } = {}
): Promise<SubscriptionView> {
  await connectDB();
  if (!input.startDate || Number.isNaN(new Date(input.startDate).getTime())) {
    throw new SubscriptionValidationError("A valid start date is required.");
  }

  const existing = await SubscriptionModel.findOne({ restaurantId: input.restaurantId }).lean();
  if (existing) {
    throw new SubscriptionValidationError(
      "This restaurant already has a subscription. Renew or manage the existing one instead."
    );
  }

  const startDate = new Date(input.startDate);
  const { snapshot, pricing, expiryDate } = await priceFromPlan({
    planId: input.planId,
    startDate,
    discountAmountPaise: input.discountAmountPaise,
  });

  const restaurant = await RestaurantModel.findById(input.restaurantId).select("name").lean();
  if (!restaurant) throw new SubscriptionNotFoundError();

  const planName = snapshot.planName;
  // The plan's tier decides the lifecycle state: a free plan can never be
  // billed and a paid plan can never be quietly stored as a trial.
  const status = statusForPlanTier(snapshot.isFree);

  async function persist(session?: import("mongoose").ClientSession): Promise<void> {
    const [sub] = await SubscriptionModel.create(
      [
        {
          restaurantId: input.restaurantId,
          planId: snapshot.planId,
          planName,
          billingCycle: snapshot.billingCycle,
          listPricePaise: pricing.listPricePaise,
          discountAmountPaise: pricing.discountAmountPaise,
          finalPricePaise: pricing.finalPricePaise,
          durationDays: snapshot.durationDays,
          gracePeriodDays: snapshot.gracePeriodDays,
          isFree: snapshot.isFree,
          // Entitlement snapshot: frozen at issue time so later plan edits
          // cannot change what this venue was sold.
          serviceKeys: snapshot.serviceKeys,
          startDate,
          expiryDate,
          status,
          autoRenew: false,
          notes: input.notes ?? null,
          createdBy: input.createdBy ?? null,
        },
      ],
      session ? { session } : undefined
    );

    await appendHistory(
      {
        subscription: sub,
        action: "CREATED",
        from: {},
        to: {
          planId: snapshot.planId,
          planName,
          ...pricing,
          startDate,
          expiryDate,
        },
        planName,
        changedBy: input.createdBy ?? null,
        changedByRole: input.changedByRole ?? null,
        reason: input.reason ?? null,
      },
      session
    );
  }

  if (meta.session !== undefined) {
    await persist(meta.session);
  } else {
    await runInTransaction((session) => persist(session));
  }

  const created = await getSubscriptionByRestaurantId(input.restaurantId);
  if (!created) throw new SubscriptionNotFoundError();
  await logPlatformAudit({
    action: "SUBSCRIPTION_CREATED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: created.subscriptionId,
    entityName: restaurant ? String(restaurant.name) : undefined,
    summary: `Subscription created for ${String(restaurant ? restaurant.name : "")} (${planName}, ${created.finalPricePaise} paise)`,
    // Nothing to diff against on create, so `before` stays null.
    before: null,
    after: {
      planId: snapshot.planId,
      planName,
      status: created.status,
      billingCycle: snapshot.billingCycle,
      listPricePaise: pricing.listPricePaise,
      discountAmountPaise: pricing.discountAmountPaise,
      finalPricePaise: pricing.finalPricePaise,
      durationDays: snapshot.durationDays,
      gracePeriodDays: snapshot.gracePeriodDays,
      serviceKeys: snapshot.serviceKeys,
      startDate: new Date(created.startDate),
      expiryDate: new Date(created.expiryDate),
    },
    metadata: {
      planId: snapshot.planId,
      planName,
      billingCycle: snapshot.billingCycle,
      listPricePaise: pricing.listPricePaise,
      discountAmountPaise: pricing.discountAmountPaise,
      finalPricePaise: pricing.finalPricePaise,
      durationDays: snapshot.durationDays,
      gracePeriodDays: snapshot.gracePeriodDays,
      isFree: snapshot.isFree,
      serviceKeys: snapshot.serviceKeys,
      startDate: startDate.toISOString(),
      expiryDate: expiryDate.toISOString(),
      status,
    },
  });

  return created;
}

/** Renewal is plan-driven exactly like creation: plan + start + discount + note. */
export interface RenewSubscriptionInput {
  restaurantId: string;
  /** Plan for the renewed term. Defaults to the plan already on the subscription. */
  planId?: string;
  /** Start of the renewed term. Defaults to the current expiry, or today. */
  startDate?: Date;
  discountAmountPaise?: number | null;
  notes?: string | null;
  createdBy?: string | null;
  changedByRole?: string | null;
  reason?: string | null;
}

export async function renewSubscription(
  input: RenewSubscriptionInput
): Promise<SubscriptionView> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({
    restaurantId: input.restaurantId,
    status: { $ne: "CANCELLED" },
  }).lean();
  if (!sub) throw new SubscriptionNotFoundError();
  if (sub.status === "SUSPENDED") {
    throw new SubscriptionValidationError("Suspended subscriptions cannot be renewed. Reactivate first.");
  }

  const now = new Date();
  const currentExpiry = new Date(sub.expiryDate);
  const currentPlanId = String(sub.planId);
  const targetPlanId = input.planId && String(input.planId) !== currentPlanId
    ? String(input.planId)
    : currentPlanId;
  const planSwitched = targetPlanId !== currentPlanId;

  // The renewed term is priced and dated from the plan, never from whatever
  // the caller sends. A renewal with no explicit plan keeps the current one but
  // still re-reads it, so a plan edit is picked up on the next renewal.
  const periodStart = resolvePeriodStart(input.startDate, currentExpiry, now);
  const { snapshot, pricing, expiryDate: newExpiry } = await priceFromPlan({
    planId: targetPlanId,
    startDate: periodStart,
    discountAmountPaise: input.discountAmountPaise ?? sub.discountAmountPaise,
  });

  const fromSnapshot = await snapshotFor(
    sub as unknown as SubscriptionDocumentLean,
    "on renewal"
  );

  await runInTransaction(async (session) => {
    await SubscriptionModel.updateOne(
      { _id: sub._id },
      {
        $set: {
          planId: snapshot.planId,
          planName: snapshot.planName,
          billingCycle: snapshot.billingCycle,
          listPricePaise: pricing.listPricePaise,
          discountAmountPaise: pricing.discountAmountPaise,
          finalPricePaise: pricing.finalPricePaise,
          durationDays: snapshot.durationDays,
          gracePeriodDays: snapshot.gracePeriodDays,
          isFree: snapshot.isFree,
          // Entitlement snapshot: frozen at issue time so later plan edits
          // cannot change what this venue was sold.
          serviceKeys: snapshot.serviceKeys,
          startDate: periodStart,
          expiryDate: newExpiry,
          // A paid term is ACTIVE; a free plan renews as a TRIAL.
          status: statusForPlanTier(snapshot.isFree),
          notes: input.notes ?? sub.notes ?? null,
        },
      },
      session ? { session } : undefined
    );
    await appendHistory({
      subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
      action: "RENEWED",
      from: {
        ...fromSnapshot,
        expiryDate: currentExpiry,
      },
      to: {
        planId: snapshot.planId,
        planName: snapshot.planName,
        ...pricing,
        startDate: periodStart,
        expiryDate: newExpiry,
      },
      planName: snapshot.planName,
      changedBy: input.createdBy ?? null,
      changedByRole: input.changedByRole ?? null,
      reason: input.reason ?? null,
    });
    if (planSwitched) {
      await appendHistory({
        subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
        action: "PLAN_CHANGED",
        from: fromSnapshot,
        to: {
          planId: snapshot.planId,
          planName: snapshot.planName,
          listPricePaise: pricing.listPricePaise,
          discountAmountPaise: pricing.discountAmountPaise,
          finalPricePaise: pricing.finalPricePaise,
          startDate: new Date(sub.startDate),
          expiryDate: currentExpiry,
        },
        planName: snapshot.planName,
        changedBy: input.createdBy ?? null,
        changedByRole: input.changedByRole ?? null,
        reason: "Plan switch during renewal",
      });
    }
  });

  await logPlatformAudit({
    action: "SUBSCRIPTION_RENEWED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: String(sub._id),
    summary: `Subscription renewed until ${newExpiry.toISOString()}`,
    reason: input.reason ?? null,
    before: {
      ...auditPoint(fromSnapshot),
      status: sub.status,
      serviceKeys: Array.isArray(sub.serviceKeys) ? sub.serviceKeys : [],
    },
    after: {
      planId: snapshot.planId,
      planName: snapshot.planName,
      status: statusForPlanTier(snapshot.isFree),
      listPricePaise: pricing.listPricePaise,
      discountAmountPaise: pricing.discountAmountPaise,
      finalPricePaise: pricing.finalPricePaise,
      serviceKeys: snapshot.serviceKeys,
      startDate: periodStart,
      expiryDate: newExpiry,
    },
    metadata: {
      planName: snapshot.planName,
      planSwitched,
      durationDays: snapshot.durationDays,
      gracePeriodDays: snapshot.gracePeriodDays,
      serviceKeys: snapshot.serviceKeys,
      finalPricePaise: pricing.finalPricePaise,
      newExpiryDate: newExpiry.toISOString(),
    },
  });

  const updated = await getSubscriptionById(String(sub._id));
  if (!updated) throw new SubscriptionNotFoundError();
  return updated;
}

/**
 * The renewed term continues from the current expiry when the venue is still
 * inside its paid period, otherwise it starts today. An explicit start date
 * always wins, and the expiry is still derived from the plan.
 */
function resolvePeriodStart(
  requested: Date | undefined,
  currentExpiry: Date,
  now: Date
): Date {
  if (requested && !Number.isNaN(new Date(requested).getTime())) {
    return new Date(requested);
  }
  return currentExpiry > now ? currentExpiry : now;
}

export interface ChangePlanInput {
  restaurantId: string;
  planId: string;
  discountAmountPaise?: number | null;
  createdBy?: string | null;
  changedByRole?: string | null;
  reason?: string | null;
}

/**
 * Switch plan mid-period. The remaining term keeps the expiry it already has —
 * switching tiers must never silently hand out or swallow paid days — but the
 * pricing re-anchors to the new plan and the new plan's duration/grace are
 * snapshotted so the next renewal is dated from the plan the venue is on.
 */
export async function changeSubscriptionPlan(input: ChangePlanInput): Promise<SubscriptionView> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId: input.restaurantId }).lean();
  if (!sub) throw new SubscriptionNotFoundError();
  if (sub.status === "CANCELLED") {
    throw new SubscriptionValidationError("Cancelled subscriptions cannot change plans.");
  }
  if (String(sub.planId) === String(input.planId)) {
    throw new SubscriptionValidationError("Subscription is already on this plan.");
  }

  const before = await snapshotFor(sub as unknown as SubscriptionDocumentLean, "before");
  const snapshot = await loadPlanSnapshot(input.planId);
  // A plan switch starts the new plan's price from scratch: any discount on the
  // old plan does not carry across unless the caller states a new one.
  const pricing = computePricing({
    listPricePaise: snapshot.listPricePaise,
    discountAmountPaise: input.discountAmountPaise ?? 0,
    isFree: snapshot.isFree,
  });

  await runInTransaction(async (session) => {
    await SubscriptionModel.updateOne(
      { _id: sub._id },
      {
        $set: {
          planId: snapshot.planId,
          planName: snapshot.planName,
          billingCycle: snapshot.billingCycle,
          listPricePaise: pricing.listPricePaise,
          discountAmountPaise: pricing.discountAmountPaise,
          finalPricePaise: pricing.finalPricePaise,
          durationDays: snapshot.durationDays,
          gracePeriodDays: snapshot.gracePeriodDays,
          isFree: snapshot.isFree,
          // Entitlement snapshot: frozen at issue time so later plan edits
          // cannot change what this venue was sold.
          serviceKeys: snapshot.serviceKeys,
          // Upgrading from free makes the venue ACTIVE and vice versa; the plan
          // on record is what decides, never a client-supplied flag.
          status: statusForPlanTier(snapshot.isFree),
        },
      },
      session ? { session } : undefined
    );
    await appendHistory({
      subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
      action: "PLAN_CHANGED",
      from: before,
      to: {
        planId: snapshot.planId,
        planName: snapshot.planName,
        listPricePaise: pricing.listPricePaise,
        discountAmountPaise: pricing.discountAmountPaise,
        finalPricePaise: pricing.finalPricePaise,
        startDate: new Date(sub.startDate),
        expiryDate: new Date(sub.expiryDate),
      },
      planName: snapshot.planName,
      changedBy: input.createdBy ?? null,
      changedByRole: input.changedByRole ?? null,
      reason: input.reason ?? null,
    });
  });

  await logPlatformAudit({
    action: "SUBSCRIPTION_PLAN_CHANGED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: String(sub._id),
    summary: `Plan changed to ${snapshot.planName}`,
    reason: input.reason ?? null,
    before: {
      ...auditPoint(before),
      status: sub.status,
      serviceKeys: Array.isArray(sub.serviceKeys) ? sub.serviceKeys : [],
    },
    after: {
      planId: snapshot.planId,
      planName: snapshot.planName,
      status: statusForPlanTier(snapshot.isFree),
      listPricePaise: pricing.listPricePaise,
      discountAmountPaise: pricing.discountAmountPaise,
      finalPricePaise: pricing.finalPricePaise,
      durationDays: snapshot.durationDays,
      gracePeriodDays: snapshot.gracePeriodDays,
      serviceKeys: snapshot.serviceKeys,
    },
    metadata: {
      fromPlanId: String(sub.planId),
      toPlanId: snapshot.planId,
      listPricePaise: pricing.listPricePaise,
      newFinalPricePaise: pricing.finalPricePaise,
      durationDays: snapshot.durationDays,
      gracePeriodDays: snapshot.gracePeriodDays,
      isFree: snapshot.isFree,
      serviceKeys: snapshot.serviceKeys,
      expiryDate: new Date(sub.expiryDate).toISOString(),
    },
  });

  const updated = await getSubscriptionById(String(sub._id));
  if (!updated) throw new SubscriptionNotFoundError();
  return updated;
}

export interface ChangePricingInput {
  restaurantId: string;
  /** The only lever an admin has here: a discount off the plan's own price. */
  discountAmountPaise?: number | null;
  createdBy?: string | null;
  changedByRole?: string | null;
  reason?: string | null;
}

/**
 * Set the discount on the existing subscription. There is deliberately no
 * list-price or final-price override any more: the amount charged is always the
 * plan's price minus this discount, so a client payload cannot talk the venue
 * into a different number than the plan says.
 */
export async function changeSubscriptionPricing(
  input: ChangePricingInput
): Promise<SubscriptionView> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId: input.restaurantId }).lean();
  if (!sub) throw new SubscriptionNotFoundError();
  if (sub.status === "CANCELLED") {
    throw new SubscriptionValidationError("Cancelled subscriptions cannot change pricing.");
  }

  const before = await snapshotFor(sub as unknown as SubscriptionDocumentLean, "before");
  // Re-read the plan so the price is the plan's, then re-apply the new discount
  // on top. A free plan stays ₹0 whatever discount is typed in.
  const snapshot = await loadPlanSnapshot(String(sub.planId));
  const pricing = computePricing({
    listPricePaise: snapshot.listPricePaise,
    discountAmountPaise: input.discountAmountPaise ?? 0,
    isFree: snapshot.isFree,
  });

  await runInTransaction(async (session) => {
    await SubscriptionModel.updateOne(
      { _id: sub._id },
      {
        $set: {
          planName: snapshot.planName,
          billingCycle: snapshot.billingCycle,
          listPricePaise: pricing.listPricePaise,
          discountAmountPaise: pricing.discountAmountPaise,
          finalPricePaise: pricing.finalPricePaise,
          durationDays: snapshot.durationDays,
          gracePeriodDays: snapshot.gracePeriodDays,
          isFree: snapshot.isFree,
        },
      },
      session ? { session } : undefined
    );
    await appendHistory({
      subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
      action: "PRICE_CHANGED",
      from: before,
      to: {
        ...before,
        planName: undefined,
        listPricePaise: pricing.listPricePaise,
        discountAmountPaise: pricing.discountAmountPaise,
        finalPricePaise: pricing.finalPricePaise,
      },
      planName: before.planName ?? "Plan",
      changedBy: input.createdBy ?? null,
      changedByRole: input.changedByRole ?? null,
      reason: input.reason ?? null,
    });
  });

  await logPlatformAudit({
    action: "SUBSCRIPTION_PRICE_CHANGED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: String(sub._id),
    summary: `Pricing changed to final ₹${(pricing.finalPricePaise / 100).toFixed(2)}`,
    metadata: { ...pricing, planId: snapshot.planId },
  });

  const updated = await getSubscriptionById(String(sub._id));
  if (!updated) throw new SubscriptionNotFoundError();
  return updated;
}

export interface ExtendExpiryInput {
  restaurantId: string;
  days?: number | null;
  newExpiryDate?: Date | null;
  createdBy?: string | null;
  changedByRole?: string | null;
  reason?: string | null;
}

/** Extend the subscription period by N days (or to an explicit date). */
export async function extendSubscriptionExpiry(
  input: ExtendExpiryInput
): Promise<SubscriptionView> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId: input.restaurantId }).lean();
  if (!sub) throw new SubscriptionNotFoundError();
  if (sub.status === "CANCELLED") {
    throw new SubscriptionValidationError("Cancelled subscriptions cannot be extended.");
  }

  const currentExpiry = new Date(sub.expiryDate);
  let newExpiry: Date;
  if (input.newExpiryDate) {
    newExpiry = new Date(input.newExpiryDate);
    if (Number.isNaN(newExpiry.getTime()) || newExpiry <= currentExpiry) {
      throw new SubscriptionValidationError("New expiry date must be after the current expiry date.");
    }
  } else {
    const days = Number(input.days ?? 0);
    if (!Number.isFinite(days) || days <= 0) {
      throw new SubscriptionValidationError("Extension days must be a positive number.");
    }
    newExpiry = addUtcDays(currentExpiry, days);
  }

  const before = await snapshotFor(sub as unknown as SubscriptionDocumentLean, "before");

  await runInTransaction(async (session) => {
    await SubscriptionModel.updateOne(
      { _id: sub._id },
      { $set: { expiryDate: newExpiry } },
      session ? { session } : undefined
    );
    await appendHistory({
      subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
      action: "EXPIRY_EXTENDED",
      from: { ...before, expiryDate: currentExpiry },
      to: { ...before, expiryDate: newExpiry },
      planName: before.planName ?? "Plan",
      changedBy: input.createdBy ?? null,
      changedByRole: input.changedByRole ?? null,
      reason: input.reason ?? null,
    });
  });

  await logPlatformAudit({
    action: "SUBSCRIPTION_EXPIRY_EXTENDED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: String(sub._id),
    summary: `Expiry extended to ${newExpiry.toISOString()}`,
    metadata: { from: currentExpiry.toISOString(), to: newExpiry.toISOString() },
  });

  const updated = await getSubscriptionById(String(sub._id));
  if (!updated) throw new SubscriptionNotFoundError();
  return updated;
}

export interface ToggleSubscriptionInput {
  restaurantId: string;
  createdBy?: string | null;
  changedByRole?: string | null;
  reason?: string | null;
}

export async function suspendSubscription(input: ToggleSubscriptionInput): Promise<SubscriptionView> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId: input.restaurantId }).lean();
  if (!sub) throw new SubscriptionNotFoundError();
  if (sub.status === "SUSPENDED") {
    throw new SubscriptionValidationError("Subscription is already suspended.");
  }
  // Cancellation is terminal. Allowing a hold here would let a cancelled venue
  // be suspended and then resumed, silently resurrecting a cancelled
  // subscription into ACTIVE.
  if (sub.status === "CANCELLED") {
    throw new SubscriptionValidationError(
      "Subscription is cancelled and cannot be suspended."
    );
  }

  const before = await snapshotFor(sub as unknown as SubscriptionDocumentLean, "before");
  const suspendedAt = new Date();
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  await runInTransaction(async (session) => {
    await SubscriptionModel.updateOne(
      { _id: sub._id },
      {
        $set: {
          status: "SUSPENDED" as SubscriptionStatus,
          suspendedAt,
          suspendedBy: input.createdBy ?? null,
          suspensionReason: reason,
        },
      },
      session ? { session } : undefined
    );
    await appendHistory({
      subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
      action: "SUSPENDED",
      from: before,
      to: before,
      planName: before.planName ?? "Plan",
      changedBy: input.createdBy ?? null,
      changedByRole: input.changedByRole ?? null,
      reason: reason ?? null,
    });
  });

  await logPlatformAudit({
    action: "SUBSCRIPTION_SUSPENDED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: String(sub._id),
    // Only business facts, never payment credentials.
    summary: `Subscription suspended${reason ? ` — ${reason}` : ""}`,
    reason,
    before: { ...auditPoint(before), status: sub.status, suspendedAt: sub.suspendedAt ?? null },
    after: { ...auditPoint(before), status: "SUSPENDED", suspendedAt },
  });

  const updated = await getSubscriptionById(String(sub._id));
  if (!updated) throw new SubscriptionNotFoundError();
  return updated;
}

/**
 * Lifts a hold.
 *
 * Resuming only restores ACTIVE when the paid period is still valid. If the
 * expiry date passed while the venue was suspended the subscription is moved to
 * EXPIRED instead of ACTIVE, so the restaurant stays blocked and has to be
 * renewed — a hold must never quietly hand back paid time that ran out.
 * EXPIRED (rather than leaving it SUSPENDED) is deliberate: the renewal path
 * rejects suspended subscriptions, so this is what makes the venue renewable.
 */
export async function reactivateSubscription(
  input: ToggleSubscriptionInput
): Promise<SubscriptionView> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId: input.restaurantId }).lean();
  if (!sub) throw new SubscriptionNotFoundError();
  if (sub.status !== "SUSPENDED") {
    throw new SubscriptionValidationError("Only suspended subscriptions can be reactivated.");
  }

  const now = new Date();
  const settings = await getPlatformSettings();
  const resumedStatus = deriveSubscriptionStatus({
    storedStatus: "ACTIVE",
    expiryDate: sub.expiryDate,
    gracePeriodDays: sub.gracePeriodDays,
    now,
    warningDays: settings.expiryWarningDays,
    graceDays: settings.gracePeriodDays,
  });
  const restored = resumedStatus !== "EXPIRED";
  const nextStatus: SubscriptionStatus = restored ? "ACTIVE" : "EXPIRED";

  const before = await snapshotFor(sub as unknown as SubscriptionDocumentLean, "before");
  await runInTransaction(async (session) => {
    await SubscriptionModel.updateOne(
      { _id: sub._id },
      {
        $set: {
          status: nextStatus,
          // The hold is over: clear it so a stale reason is never shown
          // against a subscription that is no longer suspended.
          suspendedAt: null,
          suspendedBy: null,
          suspensionReason: null,
        },
      },
      session ? { session } : undefined
    );
    await appendHistory({
      subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
      action: "REACTIVATED",
      from: before,
      to: { ...before, startDate: before.startDate ?? undefined, expiryDate: before.expiryDate ?? undefined },
      planName: before.planName ?? "Plan",
      changedBy: input.createdBy ?? null,
      changedByRole: input.changedByRole ?? null,
      reason: restored
        ? (input.reason?.trim() || null)
        : `Hold lifted but the term had already ended on ${
            sub.expiryDate ? new Date(sub.expiryDate).toISOString() : "an unknown date"
          }; renewal required`,
    });
  });

  await logPlatformAudit({
    action: "SUBSCRIPTION_REACTIVATED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: String(sub._id),
    summary: restored
      ? "Subscription resumed — restaurant access restored"
      : "Hold lifted but the term had already expired — renewal required, restaurant stays blocked",
    reason: input.reason ?? null,
    before: {
      ...auditPoint(before),
      status: sub.status,
      suspendedAt: sub.suspendedAt ?? null,
      suspensionReason: sub.suspensionReason ?? null,
    },
    after: {
      ...auditPoint(before),
      status: nextStatus,
      suspendedAt: null,
      suspensionReason: null,
    },
  });

  const updated = await getSubscriptionById(String(sub._id));
  if (!updated) throw new SubscriptionNotFoundError();
  return updated;
}

export async function cancelSubscription(input: ToggleSubscriptionInput): Promise<SubscriptionView> {
  await connectDB();
  const sub = await SubscriptionModel.findOne({ restaurantId: input.restaurantId }).lean();
  if (!sub) throw new SubscriptionNotFoundError();
  if (sub.status === "CANCELLED") {
    throw new SubscriptionValidationError("Subscription is already cancelled.");
  }

  const before = await snapshotFor(sub as unknown as SubscriptionDocumentLean, "before");
  await runInTransaction(async (session) => {
    await SubscriptionModel.updateOne(
      { _id: sub._id },
      { $set: { status: "CANCELLED" as SubscriptionStatus } },
      session ? { session } : undefined
    );
    await appendHistory({
      subscription: sub as unknown as { _id: unknown; restaurantId: unknown; planId: unknown },
      action: "CANCELLED",
      from: before,
      to: before,
      planName: before.planName ?? "Plan",
      changedBy: input.createdBy ?? null,
      changedByRole: input.changedByRole ?? null,
      reason: input.reason ?? null,
    });
  });

  await logPlatformAudit({
    action: "SUBSCRIPTION_CANCELLED",
    restaurantId: input.restaurantId,
    actorId: input.createdBy ?? undefined,
    actorRole: input.changedByRole ?? "SUPER_ADMIN",
    entityType: "SUBSCRIPTION",
    entityId: String(sub._id),
    summary: "Subscription cancelled",
  });

  const updated = await getSubscriptionById(String(sub._id));
  if (!updated) throw new SubscriptionNotFoundError();
  return updated;
}

export interface SubscriptionFilters {
  search?: string;
  status?: string;
  planId?: string;
  page?: number;
  pageSize?: number;
}

export async function listSubscriptions(
  filters: SubscriptionFilters = {}
): Promise<{ items: SubscriptionView[]; total: number; page: number; pageSize: number }> {
  await connectDB();
  await refreshSubscriptionStatuses();

  const page = Math.max(1, Number(filters.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(filters.pageSize ?? 25)));

  const query: QueryFilter<Subscription> = {};
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.planId) {
    query.planId = filters.planId;
  }
  if (filters.search) {
    const term = filters.search.trim();
    const restaurantIds = await RestaurantModel.find({
      name: { $regex: term, $options: "i" },
    })
      .select("_id")
      .lean();
    const ids = restaurantIds.map((r) => r._id);
    const or: NonNullable<QueryFilter<Subscription>["$or"]> = [];
    if (ids.length > 0) {
      or.push({ restaurantId: { $in: ids } });
    }
    // Only treat the search term as a subscription id when it parses as one;
    // otherwise a name search would crash the query with a cast error.
    if (/^[0-9a-fA-F]{24}$/.test(term)) {
      or.push({ _id: term as unknown as string });
    }
    if (or.length > 0) {
      query.$or = or;
    } else {
      query._id = "000000000000000000000000" as unknown as string;
    }
  }

  const [subs, total, restaurants] = await Promise.all([
    SubscriptionModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    SubscriptionModel.countDocuments(query),
    RestaurantModel.find().select("_id name").lean(),
  ]);
  const nameById = new Map(restaurants.map((r) => [String(r._id), String(r.name)]));
  const [plans, planServices] = await Promise.all([planNameMap(), planServiceKeysMap()]);
  const items = subs.map((s) =>
    toView(
      s as unknown as SubscriptionDocumentLean,
      nameById.get(String(s.restaurantId)) ?? "Restaurant",
      plans.get(String(s.planId)) ?? "Plan",
      new Date(),
      planServices.get(String(s.planId)) ?? []
    )
  );

  return { items, total, page, pageSize };
}

export interface SubscriptionHistoryView {
  action: string;
  fromPlanName: string | null;
  toPlanName: string | null;
  fromListPricePaise: number | null;
  toListPricePaise: number | null;
  fromFinalPricePaise: number | null;
  toFinalPricePaise: number | null;
  fromStartDate: Date | null;
  fromExpiryDate: Date | null;
  toStartDate: Date | null;
  toExpiryDate: Date | null;
  reason: string | null;
  changedAt: Date;
  changedBy: string | null;
  changedByRole: string | null;
}

export async function listSubscriptionHistory(
  restaurantId: string
): Promise<SubscriptionHistoryView[]> {
  await connectDB();
  const rows = await SubscriptionHistoryModel.find({ restaurantId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return rows.map((h) => ({
    action: String(h.action),
    fromPlanName: h.from?.planName ?? null,
    toPlanName: h.to?.planName ?? null,
    fromListPricePaise: h.from?.listPricePaise ?? null,
    toListPricePaise: h.to?.listPricePaise ?? null,
    fromFinalPricePaise: h.from?.finalPricePaise ?? null,
    toFinalPricePaise: h.to?.finalPricePaise ?? null,
    fromStartDate: h.from?.startDate ? new Date(h.from.startDate) : null,
    fromExpiryDate: h.from?.expiryDate ? new Date(h.from.expiryDate) : null,
    toStartDate: h.to?.startDate ? new Date(h.to.startDate) : null,
    toExpiryDate: h.to?.expiryDate ? new Date(h.to.expiryDate) : null,
    reason: h.reason ?? null,
    changedAt: new Date(h.changedAt ?? h.createdAt),
    changedBy: h.changedBy ? String(h.changedBy) : null,
    changedByRole: h.changedByRole ?? null,
  }));
}