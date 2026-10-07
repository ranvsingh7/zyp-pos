import "server-only";

import mongoose, { type QueryFilter } from "mongoose";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { RestaurantModel, type Restaurant } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword } from "@/lib/auth/password";
import { businessTypes } from "@/lib/business-types";
import { isSuperAdmin } from "@/lib/auth/roles";
import { DEFAULT_TAX_CONFIG, type GstScheme } from "@/lib/billing/constants";
import { resolveEffectiveTaxEnabled } from "@/lib/billing/tax-config";
import type { TaxSettingsView } from "@/lib/billing/tax-settings";
import {
  AdminForbiddenError,
  DuplicateOwnerEmailError,
  OwnerAccountNotFoundError,
  OwnerPasswordResetForbiddenError,
  PlanNotFoundError,
  RestaurantNotFoundError,
  SubscriptionValidationError,
} from "./errors";
import { runInTransaction } from "./_shared";
import {
  createSubscription,
  getSubscriptionByRestaurantId,
  type SubscriptionView,
} from "./subscription-service";
import { ensureTrialPlan } from "./platform-settings";
import { logPlatformAudit } from "./audit";

export interface RestaurantAdminView {
  id: string;
  name: string;
  owner: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
  } | null;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  businessType: string;
  gstRegistered: boolean;
  gstin: string | null;
  isActive: boolean;
  taxSettings: TaxSettingsView | null;
  subscription: SubscriptionView | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRestaurantView(
  restaurant: {
    _id: unknown;
    name: unknown;
    ownerId: unknown;
    phone: unknown;
    email: unknown;
    address: unknown;
    city: unknown;
    state: unknown;
    pincode: unknown;
    businessType: unknown;
    gstRegistered: unknown;
    gstin: unknown;
    isActive: unknown;
    createdAt: unknown;
    updatedAt: unknown;
  },
  owner: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
  } | null,
  subscription: SubscriptionView | null
): RestaurantAdminView {
  return {
    id: String(restaurant._id),
    name: String(restaurant.name),
    owner,
    phone: String(restaurant.phone),
    email: restaurant.email ? String(restaurant.email) : null,
    address: String(restaurant.address),
    city: String(restaurant.city),
    state: String(restaurant.state),
    pincode: String(restaurant.pincode),
    businessType: String(restaurant.businessType),
    gstRegistered: Boolean(restaurant.gstRegistered),
    gstin: restaurant.gstin ? String(restaurant.gstin) : null,
    isActive: Boolean(restaurant.isActive),
    taxSettings: null,
    subscription,
    createdAt: new Date(restaurant.createdAt as string | number | Date),
    updatedAt: new Date(restaurant.updatedAt as string | number | Date),
  };
}

async function loadSubscriptionFor(restaurantId: string): Promise<SubscriptionView | null> {
  const sub = await getSubscriptionByRestaurantId(restaurantId);
  if (!sub) return null;
  return sub;
}

async function loadOwnerFor(restaurantId: string, ownerId: string | null) {
  if (!ownerId) return null;
  const user = await UserModel.findById(ownerId)
    .select("_id fullName email phone")
    .lean();
  return user
    ? {
        id: String(user._id),
        fullName: String(user.fullName),
        email: String(user.email),
        phone: user.phone ? String(user.phone) : null,
      }
    : null;
}

export interface CreateRestaurantAdminInput {
  name: string;
  phone: string;
  email?: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  businessType: string;
  gstRegistered?: boolean;
  gstin?: string | null;
  taxEnabled?: boolean | null;
  defaultTaxRate?: number | null;
  taxInclusive?: boolean | null;
  gstScheme?: GstScheme | null;
  cgstRatePercent?: number | null;
  sgstRatePercent?: number | null;
  igstRatePercent?: number | null;
  ownerFullName: string;
  ownerEmail: string;
  ownerPhone?: string | null;
  password: string;
  planId?: string | null;
  isTrial?: boolean;
  discountAmountPaise?: number | null;
  finalPricePaise?: number | null;
  durationDays?: number | null;
  gracePeriodDays?: number | null;
  notes?: string | null;
  createdBy?: string | null;
  reason?: string | null;
}

/**
 * Admin-driven restaurant creation: provisions the owner account, restaurant,
 * settings, and subscription in a single unit of work, so a partially created
 * tenant is never observable.
 */
export async function createRestaurantAdmin(
  input: CreateRestaurantAdminInput
): Promise<{ restaurantId: string; ownerId: string; subscriptionId: string | null }> {
  await connectDB();

  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail) throw new DuplicateOwnerEmailError();
  const existingUser = await UserModel.findOne({ email: ownerEmail }).select("_id").lean();
  if (existingUser) throw new DuplicateOwnerEmailError();

  if (!(businessTypes as readonly string[]).includes(input.businessType)) {
    throw new SubscriptionValidationError("Invalid business type.");
  }
  const businessType = input.businessType as (typeof businessTypes)[number];

  const gstRegistered = Boolean(input.gstRegistered);
  const gstin = gstRegistered ? (input.gstin?.trim() || null) : null;
  if (gstRegistered && !gstin) {
    throw new SubscriptionValidationError(
      "GSTIN is required when GST registration is enabled."
    );
  }
  const taxConfig = resolveTaxConfigForWrite({
    taxEnabled: input.taxEnabled,
    defaultTaxRate: input.defaultTaxRate,
    taxInclusive: input.taxInclusive,
    gstScheme: input.gstScheme,
    cgstRatePercent: input.cgstRatePercent,
    sgstRatePercent: input.sgstRatePercent,
    igstRatePercent: input.igstRatePercent,
  });

  let planId: string = String(input.planId ?? "");
  let isTrial = Boolean(input.isTrial);
  if (!planId) {
    const trial = await ensureTrialPlan();
    planId = trial.planId;
    isTrial = true;
  } else {
    const plan = await import("@/models/Plan").then(({ PlanModel }) =>
      PlanModel.findById(planId).select("_id isActive pricePaise").lean()
    );
    if (!plan) throw new PlanNotFoundError();
    if (!plan.isActive) {
      throw new SubscriptionValidationError("Cannot subscribe to an inactive plan.");
    }
    if (isTrial && Number(plan.pricePaise) > 0) {
      throw new SubscriptionValidationError("A trial subscription requires a free plan.");
    }
  }

  const passwordHash = await hashPassword(input.password);
  const startDate = new Date();

  const result = await runInTransaction<{
    restaurantId: string;
    ownerId: string;
    subscriptionId: string | null;
  }>(async (session) => {
    const opts = session ? { session } : undefined;
    const [owner] = await UserModel.create(
      [
        {
          fullName: input.ownerFullName.trim(),
          email: ownerEmail,
          passwordHash,
          phone: input.ownerPhone?.trim() || null,
          role: "OWNER",
          restaurantId: null,
          isActive: true,
        },
      ],
      opts
    );
    const ownerId = String(owner._id);

    const [restaurant] = await RestaurantModel.create(
      [
        {
          name: input.name.trim(),
          ownerId,
          phone: input.phone.trim(),
          email: input.email?.trim() || null,
          address: input.address.trim(),
          city: input.city.trim(),
          state: input.state.trim(),
          pincode: input.pincode.trim(),
          gstRegistered,
          gstin,
          businessType,
          isActive: true,
        },
      ],
      opts
    );
    const restaurantId = String(restaurant._id);

    await RestaurantSettingsModel.create(
      [
        {
          restaurantId,
          currency: "INR",
          // GST registration is the master control: an unregistered restaurant
          // is created with tax always disabled.
          taxEnabled: resolveEffectiveTaxEnabled(taxConfig.taxEnabled, gstRegistered),
          defaultTaxRate: taxConfig.defaultTaxRate,
          taxInclusive: taxConfig.taxInclusive,
          gstScheme: taxConfig.gstScheme,
          cgstRatePercent: taxConfig.cgstRatePercent,
          sgstRatePercent: taxConfig.sgstRatePercent,
          igstRatePercent: taxConfig.igstRatePercent,
        },
      ],
      opts
    );
    await UserModel.updateOne(
      { _id: ownerId },
      { $set: { restaurantId, role: "OWNER" } },
      opts
    );

    let subscriptionId: string | null = null;
    // Plan-driven like every other path: the caller names a plan and a start
    // date, and the service resolves price, duration, grace and the trial/active
    // state from the plan. `isTrial` and the duration/grace overrides are
    // deliberately not forwarded — a free plan is a TRIAL by virtue of its tier.
    const sub = await createSubscription(
      {
        restaurantId,
        planId,
        startDate,
        discountAmountPaise: input.discountAmountPaise,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
        changedByRole: "SUPER_ADMIN",
        reason: input.reason ?? null,
      },
      { session }
    );
    if (sub) subscriptionId = sub.subscriptionId;

    return { restaurantId, ownerId, subscriptionId };
  });

  await logPlatformAudit({
    action: "RESTAURANT_CREATED",
    actorId: input.createdBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "RESTAURANT",
    entityId: result.restaurantId,
    entityName: input.name.trim(),
    summary: `Restaurant created: ${input.name.trim()}`,
    metadata: {
      ownerEmail,
      planId,
      isTrial,
      startDateIso: startDate.toISOString(),
    },
  });

  return result;
}

export interface UpdateRestaurantInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  businessType?: string | null;
  gstRegistered?: boolean | null;
  gstin?: string | null;
  taxEnabled?: boolean | null;
  defaultTaxRate?: number | null;
  taxInclusive?: boolean | null;
  gstScheme?: GstScheme | null;
  cgstRatePercent?: number | null;
  sgstRatePercent?: number | null;
  igstRatePercent?: number | null;
  editedBy?: string | null;
  reason?: string | null;
}

interface TaxConfigWrite {
  taxEnabled: boolean;
  defaultTaxRate: number;
  taxInclusive: boolean;
  gstScheme: GstScheme;
  cgstRatePercent: number;
  sgstRatePercent: number;
  igstRatePercent: number;
}

function asFiniteRate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

/**
 * Merges an optional tax payload over stored settings and validates the
 * result: rates within 0–100, and CGST + SGST (intra-state) or IGST
 * (inter-state) equal to the combined default rate. Unspecified component
 * rates derive from the combined rate so presets stay consistent.
 */
function resolveTaxConfigForWrite(input: {
  taxEnabled?: boolean | null;
  defaultTaxRate?: number | null;
  taxInclusive?: boolean | null;
  gstScheme?: GstScheme | null;
  cgstRatePercent?: number | null;
  sgstRatePercent?: number | null;
  igstRatePercent?: number | null;
}): TaxConfigWrite {
  const taxEnabled = input.taxEnabled ?? DEFAULT_TAX_CONFIG.taxEnabled;
  const defaultTaxRate = asFiniteRate(input.defaultTaxRate) ?? DEFAULT_TAX_CONFIG.defaultTaxRate;
  const gstScheme = input.gstScheme ?? "INTRA_STATE";
  const cgstRatePercent = asFiniteRate(input.cgstRatePercent) ?? defaultTaxRate / 2;
  const sgstRatePercent = asFiniteRate(input.sgstRatePercent) ?? defaultTaxRate / 2;
  const igstRatePercent = asFiniteRate(input.igstRatePercent) ?? defaultTaxRate;
  if (gstScheme === "INTER_STATE") {
    if (Math.abs(igstRatePercent - defaultTaxRate) > 0.001) {
      throw new SubscriptionValidationError(
        "IGST rate must equal the default tax rate for inter-state billing."
      );
    }
  } else if (Math.abs(cgstRatePercent + sgstRatePercent - defaultTaxRate) > 0.001) {
    throw new SubscriptionValidationError(
      "CGST + SGST must equal the default tax rate."
    );
  }
  return {
    taxEnabled,
    defaultTaxRate,
    taxInclusive: input.taxInclusive ?? false,
    gstScheme,
    cgstRatePercent,
    sgstRatePercent,
    igstRatePercent,
  };
}

export async function updateRestaurant(
  restaurantId: string,
  input: UpdateRestaurantInput
): Promise<RestaurantAdminView> {
  await connectDB();
  const existing = await RestaurantModel.findById(restaurantId).lean();
  if (!existing) throw new RestaurantNotFoundError();

  const patch: Record<string, unknown> = {};
  if (input.name != null) patch.name = String(input.name).trim();
  if (input.phone != null) patch.phone = String(input.phone).trim();
  if (input.email !== undefined) patch.email = input.email?.trim() || null;
  if (input.address != null) patch.address = String(input.address).trim();
  if (input.city != null) patch.city = String(input.city).trim();
  if (input.state != null) patch.state = String(input.state).trim();
  if (input.pincode != null) patch.pincode = String(input.pincode).trim();
  if (input.businessType != null) {
    if (!(businessTypes as readonly string[]).includes(input.businessType)) {
      throw new SubscriptionValidationError("Invalid business type.");
    }
    patch.businessType = input.businessType;
  }
  if (input.gstRegistered != null) {
    patch.gstRegistered = Boolean(input.gstRegistered);
    if (input.gstin === undefined) patch.gstin = Boolean(input.gstRegistered) ? existing.gstin : null;
  }
  if (input.gstin !== undefined) {
    patch.gstin = input.gstRegistered === false ? null : (input.gstin?.trim() || null);
  }

  const resolvedRegistered =
    input.gstRegistered != null ? Boolean(input.gstRegistered) : Boolean(existing.gstRegistered);
  const resolvedGstin =
    input.gstin !== undefined ? (input.gstin?.trim() || null) : (existing.gstin ? String(existing.gstin) : null);
  if (resolvedRegistered && !resolvedGstin) {
    throw new SubscriptionValidationError(
      "GSTIN is required when GST registration is enabled."
    );
  }

  // Tax configuration lives on RestaurantSettings (per-restaurant isolation).
  // Merge the payload over stored settings so partial updates validate
  // against the effective configuration.
  const taxFieldsProvided =
    input.taxEnabled != null ||
    input.defaultTaxRate != null ||
    input.taxInclusive != null ||
    input.gstScheme != null ||
    input.cgstRatePercent != null ||
    input.sgstRatePercent != null ||
    input.igstRatePercent != null;
  // GST registration is the master control: an unregistered restaurant can
  // never have tax enabled, no matter what the payload (or stored settings)
  // says, so we always write taxEnabled=false for it.
  const forceTaxDisabled = !resolvedRegistered;
  let settingsChanged: string[] = [];
  if (taxFieldsProvided || forceTaxDisabled) {
    const current = await RestaurantSettingsModel.findOne({ restaurantId }).lean();
    const merged = resolveTaxConfigForWrite({
      taxEnabled: input.taxEnabled ?? (current as { taxEnabled?: boolean } | null)?.taxEnabled ?? null,
      defaultTaxRate:
        input.defaultTaxRate ?? (current as { defaultTaxRate?: number } | null)?.defaultTaxRate ?? null,
      taxInclusive:
        input.taxInclusive ?? (current as { taxInclusive?: boolean } | null)?.taxInclusive ?? null,
      gstScheme: (input.gstScheme ?? (current as { gstScheme?: GstScheme } | null)?.gstScheme ?? null) as GstScheme | null,
      cgstRatePercent:
        input.cgstRatePercent ?? (current as { cgstRatePercent?: number } | null)?.cgstRatePercent ?? null,
      sgstRatePercent:
        input.sgstRatePercent ?? (current as { sgstRatePercent?: number } | null)?.sgstRatePercent ?? null,
      igstRatePercent:
        input.igstRatePercent ?? (current as { igstRatePercent?: number } | null)?.igstRatePercent ?? null,
    });
    const settingsPatch: Record<string, unknown> = {};
    if (input.taxEnabled != null) settingsPatch.taxEnabled = merged.taxEnabled;
    if (input.defaultTaxRate != null) settingsPatch.defaultTaxRate = merged.defaultTaxRate;
    if (input.taxInclusive != null) settingsPatch.taxInclusive = merged.taxInclusive;
    if (input.gstScheme != null) settingsPatch.gstScheme = merged.gstScheme;
    if (input.cgstRatePercent != null) settingsPatch.cgstRatePercent = merged.cgstRatePercent;
    if (input.sgstRatePercent != null) settingsPatch.sgstRatePercent = merged.sgstRatePercent;
    if (input.igstRatePercent != null) settingsPatch.igstRatePercent = merged.igstRatePercent;
    if (forceTaxDisabled) settingsPatch.taxEnabled = false;
    if (Object.keys(settingsPatch).length > 0) {
      await RestaurantSettingsModel.updateOne(
        { restaurantId },
        { $set: settingsPatch },
        { upsert: true }
      );
      settingsChanged = Object.keys(settingsPatch);
    }
  }

  await RestaurantModel.updateOne({ _id: restaurantId }, { $set: patch });

  await logPlatformAudit({
    action: "RESTAURANT_EDITED",
    actorId: input.editedBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "RESTAURANT",
    entityId: restaurantId,
    entityName: String(existing.name),
    summary: `Restaurant edited: ${String(existing.name)}`,
    metadata: { changed: [...Object.keys(patch), ...settingsChanged] },
  });

  return getRestaurantById(restaurantId) as Promise<RestaurantAdminView>;
}

/** Suspend a restaurant: flips the tenant flag and pulls its subscription. */
export async function suspendRestaurant(
  restaurantId: string,
  meta: { createdBy?: string | null; reason?: string | null } = {}
): Promise<RestaurantAdminView> {
  await connectDB();
  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  if (!restaurant) throw new RestaurantNotFoundError();

  await runInTransaction(async (session) => {
    const opts = session ? { session } : undefined;
    await RestaurantModel.updateOne({ _id: restaurantId }, { $set: { isActive: false } }, opts);
    const sub = await import("@/models/Subscription").then(({ SubscriptionModel }) =>
      SubscriptionModel.findOne({ restaurantId }).lean()
    );
    if (sub && sub.status !== "CANCELLED" && sub.status !== "SUSPENDED") {
      await import("@/models/Subscription").then(({ SubscriptionModel }) =>
        SubscriptionModel.updateOne({ _id: sub._id }, { $set: { status: "SUSPENDED" } }, opts)
      );
    }
  });

  await logPlatformAudit({
    action: "RESTAURANT_SUSPENDED",
    restaurantId,
    actorId: meta.createdBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "RESTAURANT",
    entityId: restaurantId,
    entityName: String(restaurant.name),
    summary: `Restaurant suspended: ${String(restaurant.name)}`,
    metadata: { reason: meta.reason ?? null },
  });

  return getRestaurantById(restaurantId) as Promise<RestaurantAdminView>;
}

export async function reactivateRestaurant(
  restaurantId: string,
  meta: { createdBy?: string | null; reason?: string | null } = {}
): Promise<RestaurantAdminView> {
  await connectDB();
  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  if (!restaurant) throw new RestaurantNotFoundError();

  await RestaurantModel.updateOne(
    { _id: restaurantId },
    { $set: { isActive: true } }
  );

  await logPlatformAudit({
    action: "RESTAURANT_ACTIVATED",
    restaurantId,
    actorId: meta.createdBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "RESTAURANT",
    entityId: restaurantId,
    entityName: String(restaurant.name),
    summary: `Restaurant reactivated: ${String(restaurant.name)}`,
    metadata: { reason: meta.reason ?? null },
  });

  return getRestaurantById(restaurantId) as Promise<RestaurantAdminView>;
}

/** Transfer restaurant ownership to an existing platform user account. */
export async function transferRestaurant(
  restaurantId: string,
  newOwnerEmail: string,
  meta: { createdBy?: string | null; reason?: string | null } = {}
): Promise<RestaurantAdminView> {
  await connectDB();
  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  if (!restaurant) throw new RestaurantNotFoundError();

  const newOwner = await UserModel.findOne({
    email: newOwnerEmail.trim().toLowerCase(),
  })
    .select("_id restaurantId isActive")
    .lean();
  if (!newOwner) {
    throw new SubscriptionValidationError("Target owner account does not exist.");
  }
  if (!newOwner.isActive) {
    throw new SubscriptionValidationError("Target owner account is deactivated.");
  }
  if (newOwner.restaurantId && String(newOwner.restaurantId) !== restaurantId) {
    throw new SubscriptionValidationError("Target owner already belongs to another restaurant.");
  }

  await runInTransaction(async (session) => {
    const opts = session ? { session } : undefined;
    const newOwnerId = String(newOwner._id);
    await UserModel.updateOne(
      { _id: newOwnerId },
      { $set: { restaurantId, role: "OWNER" } },
      opts
    );
    await RestaurantModel.updateOne(
      { _id: restaurantId },
      { $set: { ownerId: newOwnerId } },
      opts
    );
    if (restaurant.ownerId && String(restaurant.ownerId) !== newOwnerId) {
      await UserModel.updateOne(
        { _id: restaurant.ownerId },
        { $set: { restaurantId: null } },
        opts
      );
    }
  });

  await logPlatformAudit({
    action: "RESTAURANT_EDITED",
    restaurantId,
    actorId: meta.createdBy ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "RESTAURANT",
    entityId: restaurantId,
    entityName: String(restaurant.name),
    summary: `Ownership transferred to ${newOwnerEmail.trim().toLowerCase()}`,
    metadata: { reason: meta.reason ?? null, newOwnerEmail },
  });

  return getRestaurantById(restaurantId) as Promise<RestaurantAdminView>;
}

/* ------------------------------------------------------------------ */
/* Owner password reset (SUPER_ADMIN)                                  */
/* ------------------------------------------------------------------ */

/** Result of a successful reset. Carries no password material of any kind. */
export interface ResetOwnerPasswordResult {
  restaurantId: string;
  ownerId: string;
  ownerEmail: string;
}

/**
 * Sets a new password for the OWNER account of one restaurant, on behalf of a
 * SUPER_ADMIN.
 *
 * Target resolution is entirely server-side and one-directional: the caller
 * supplies a `restaurantId`, and the owner is read from `Restaurant.ownerId`.
 * There is deliberately no `userId` parameter — a client that supplies one is
 * not given a way to express it, so IDOR is not a case this function has to
 * defend against at the write. The only account that can be affected is the
 * canonical owner of the named restaurant.
 *
 * Safety properties:
 * - Authorisation is asserted here as well as in the server action, so any
 *   future caller still needs SUPER_ADMIN. The UI hiding the button is not a
 *   control.
 * - The write is `$set`-only and scoped by `_id` + `role: "OWNER"` +
 *   `restaurantId`, so it can only ever touch the password of that one
 *   OWNER user, and cannot be steered by client-supplied update operators.
 * - A SUPER_ADMIN (or any non-OWNER) account reachable through `ownerId` is
 *   refused, so no path here can reset a platform admin's own password.
 * - `tokenVersion` is incremented in the same update. Sessions are stateless
 *   signed JWTs with no server-side token record, so that counter is the
 *   existing revocation lever: `loadUser()` compares the claim against the
 *   stored value, which revokes every session the owner already holds while
 *   leaving every other user — including the acting SUPER_ADMIN — untouched.
 *
 * The plaintext is hashed with the shared `hashPassword` (argon2id, the same
 * call signup and the staff reset use) and is never selected, returned, logged
 * or audited.
 */
export async function resetRestaurantOwnerPassword(
  restaurantId: string,
  newPassword: string,
  meta: { actorId?: string | null; role?: string | null; reason?: string | null } = {}
): Promise<ResetOwnerPasswordResult> {
  // Defence in depth: the action resolves the actor through `requireSuperAdmin`,
  // but the service refuses anyone else on its own so a direct/programmatic
  // caller cannot skip the guard.
  if (!isSuperAdmin(meta.role)) {
    throw new AdminForbiddenError();
  }

  await connectDB();

  if (!mongoose.isObjectIdOrHexString(restaurantId)) {
    throw new RestaurantNotFoundError();
  }
  const restaurant = await RestaurantModel.findById(restaurantId)
    .select("_id name ownerId")
    .lean();
  if (!restaurant) throw new RestaurantNotFoundError();

  const ownerId = restaurant.ownerId ? String(restaurant.ownerId) : null;
  if (!ownerId) throw new OwnerAccountNotFoundError();

  // The target is identified by the restaurant's own owner relationship, and the
  // projection deliberately excludes `passwordHash` — the hash is never read
  // into memory on the read path, let alone returned.
  const owner = await UserModel.findById(ownerId)
    .select("_id email role restaurantId isActive")
    .lean();
  if (!owner) throw new OwnerAccountNotFoundError();

  if (owner.role !== "OWNER") {
    // Covers SUPER_ADMIN and every non-owner role. Refused before any write so a
    // platform account can never be reset through this feature.
    throw new OwnerPasswordResetForbiddenError();
  }
  // Tenant check: the owner must actually belong to the restaurant being reset.
  // Without it, a stale or tampered `ownerId` pointing at an OWNER of a different
  // restaurant would let one venue's admin action rewrite another venue's
  // credential.
  if (owner.restaurantId && String(owner.restaurantId) !== restaurantId) {
    throw new OwnerPasswordResetForbiddenError(
      "The owner account of this restaurant is not assigned to it."
    );
  }

  const passwordHash = await hashPassword(newPassword);

  // Scoped to the resolved owner and re-asserted in the filter itself, so the
  // update is not merely guarded in JS — if the role/tenant changed between the
  // read above and this write, `matchedCount` is 0 and nothing is modified.
  const result = await UserModel.updateOne(
    { _id: ownerId, role: "OWNER", restaurantId: restaurantId },
    { $set: { passwordHash }, $inc: { tokenVersion: 1 } }
  );
  if (result.matchedCount === 0) {
    throw new OwnerPasswordResetForbiddenError(
      "The owner account changed during the reset. Please reload and try again."
    );
  }

  await logPlatformAudit({
    action: "RESTAURANT_OWNER_PASSWORD_RESET",
    restaurantId,
    actorId: meta.actorId ?? undefined,
    actorRole: "SUPER_ADMIN",
    entityType: "USER",
    entityId: ownerId,
    entityName: String(owner.email),
    summary: `Owner password reset for ${String(restaurant.name)}`,
    reason: meta.reason ?? null,
    // Metadata records who was affected and that sessions were revoked. It
    // deliberately carries neither the new password nor the hash, and the full
    // form payload is never passed through.
    metadata: {
      ownerUserId: ownerId,
      ownerEmail: String(owner.email),
      targetRole: "OWNER",
      previousSessionsInvalidated: true,
    },
  });

  return {
    restaurantId,
    ownerId,
    ownerEmail: String(owner.email),
  };
}

export interface RestaurantFilters {
  search?: string;
  planId?: string;
  page?: number;
  pageSize?: number;
}

export async function listRestaurants(
  filters: RestaurantFilters = {}
): Promise<{ items: RestaurantAdminView[]; total: number; page: number; pageSize: number }> {
  await connectDB();
  const page = Math.max(1, Number(filters.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(filters.pageSize ?? 25)));

  const query: QueryFilter<Restaurant> = {};
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    const ownerIds = await UserModel.find({
      $or: [
        { fullName: { $regex: term, $options: "i" } },
        { email: { $regex: term, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();
    const ids = ownerIds.map((u) => u._id);
    query.$or = [
      { name: { $regex: term, $options: "i" } },
      { city: { $regex: term, $options: "i" } },
      { phone: { $regex: term, $options: "i" } },
      ...(ids.length > 0 ? [{ ownerId: { $in: ids } }] : []),
    ];
  }

  const restaurantDocs = await RestaurantModel.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean();
  const total = await RestaurantModel.countDocuments(query);

  const subs = await Promise.all(
    restaurantDocs.map((r) => loadSubscriptionFor(String(r._id)))
  );
  const owners = await Promise.all(
    restaurantDocs.map((r) => loadOwnerFor(String(r._id), String(r.ownerId)))
  );

  const items = restaurantDocs.map((r, i) =>
    toRestaurantView(
      r as unknown as Parameters<typeof toRestaurantView>[0],
      owners[i],
      subs[i]
    )
  );

  return { items, total, page, pageSize };
}

export async function getRestaurantById(
  restaurantId: string
): Promise<RestaurantAdminView | null> {
  await connectDB();
  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  if (!restaurant) return null;
  const [owner, sub, settings] = await Promise.all([
    loadOwnerFor(restaurantId, String(restaurant.ownerId)),
    loadSubscriptionFor(restaurantId),
    RestaurantSettingsModel.findOne({ restaurantId }).lean(),
  ]);
  const view = toRestaurantView(
    restaurant as unknown as Parameters<typeof toRestaurantView>[0],
    owner,
    sub
  );
  const doc = settings as unknown as {
    taxEnabled?: boolean;
    defaultTaxRate?: number;
    taxInclusive?: boolean;
    gstScheme?: GstScheme;
    cgstRatePercent?: number;
    sgstRatePercent?: number;
    igstRatePercent?: number;
  } | null;
  const defaultTaxRate = doc?.defaultTaxRate ?? DEFAULT_TAX_CONFIG.defaultTaxRate;
  view.taxSettings = {
    // GST registration is the master control on taxation: an unregistered
    // restaurant is always reported as tax-disabled.
    taxEnabled: resolveEffectiveTaxEnabled(
      doc?.taxEnabled ?? DEFAULT_TAX_CONFIG.taxEnabled,
      restaurant.gstRegistered
    ),
    defaultTaxRate,
    taxInclusive: doc?.taxInclusive ?? false,
    gstScheme: doc?.gstScheme ?? "INTRA_STATE",
    cgstRatePercent: doc?.cgstRatePercent ?? defaultTaxRate / 2,
    sgstRatePercent: doc?.sgstRatePercent ?? defaultTaxRate / 2,
    igstRatePercent: doc?.igstRatePercent ?? defaultTaxRate,
    gstRegistered: Boolean(restaurant.gstRegistered),
  };
  return view;
}