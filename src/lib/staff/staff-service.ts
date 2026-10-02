import "server-only";

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { escapeRegExp } from "@/lib/menu/utils";
import { STAFF_ASSIGNABLE_ROLES, STAFF_MAX_ROWS } from "./constants";
import { canManageStaff, StaffForbiddenError } from "./permissions";
import type { Role } from "@/lib/auth/roles";
import type {
  CreateStaffInput,
  StaffListQuery,
  UpdateStaffInput,
} from "./validation";

/**
 * Staff management for a single restaurant.
 *
 * Tenant isolation is structural: every read and every write is keyed on
 * `restaurantId`, which the caller must resolve from the session — it is never
 * read from user input. The target of a mutation is looked up with
 * `{ _id, restaurantId }`, so a user id from another restaurant simply does not
 * exist as far as this service is concerned.
 *
 * Passwords are hashed with the shared `hashPassword` (argon2id) and are never
 * selected, returned, or written to the audit trail.
 */

export class StaffNotFoundError extends Error {
  constructor(message = "Staff member not found.") {
    super(message);
    this.name = "StaffNotFoundError";
  }
}

export class StaffValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffValidationError";
  }
}

export class StaffConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffConflictError";
  }
}

export interface StaffMemberView {
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  isOwner: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface StaffListResult {
  items: StaffMemberView[];
  total: number;
  counts: { all: number; active: number; inactive: number };
}

interface StaffDoc {
  _id: unknown;
  fullName: string;
  email: string;
  phone?: string | null;
  role: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Never returns anything password-related, even if the projection changes. */
function toView(doc: StaffDoc, ownerId: string | null): StaffMemberView {
  const userId = String(doc._id);
  return {
    userId,
    fullName: doc.fullName,
    email: doc.email,
    phone: doc.phone ?? null,
    role: doc.role,
    isActive: Boolean(doc.isActive),
    isOwner: ownerId != null && ownerId === userId,
    createdAt: doc.createdAt ? new Date(doc.createdAt) : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : null,
  };
}

async function ownerIdFor(restaurantId: string): Promise<string | null> {
  const restaurant = await RestaurantModel.findById(restaurantId).select("ownerId").lean();
  return restaurant?.ownerId ? String(restaurant.ownerId) : null;
}

/** Guards against assigning a platform role from inside a tenant. */
function assertTenantRole(role: string): void {
  if (!(STAFF_ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    throw new StaffValidationError("That role cannot be assigned to restaurant staff.");
  }
}

/**
 * Authorisation is enforced here as well as in the server actions, so a forged
 * form or any future caller still cannot mutate staff. The UI only hides the
 * OWNER option from managers, which is a hint, not a control.
 */
function assertActor(actor: StaffActor, requestedRole?: string): void {
  if (!canManageStaff(actor.role as Role)) {
    throw new StaffForbiddenError();
  }
  if (requestedRole === "OWNER" && actor.role !== "OWNER") {
    throw new StaffForbiddenError("Only the restaurant owner can assign the owner role.");
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === 11000
  );
}

/** Audit snapshot. Deliberately built from an allow-list, never the raw doc. */
function snapshot(view: StaffMemberView): Record<string, unknown> {
  return {
    userId: view.userId,
    fullName: view.fullName,
    email: view.email,
    phone: view.phone,
    role: view.role,
    isActive: view.isActive,
  };
}

/**
 * `User.email` is globally unique, so the check is tenant-independent. The
 * error message is identical whether the clash is inside this restaurant or
 * another, so the endpoint never reveals that an address exists elsewhere.
 */
async function assertEmailAvailable(email: string, excludeUserId?: string): Promise<void> {
  const filter: Record<string, unknown> = { email };
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  const existing = await UserModel.findOne(filter).select("_id").lean();
  if (!existing) return;
  throw new StaffConflictError("That email address is already in use.");
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listStaff(
  restaurantId: string,
  query: StaffListQuery = {}
): Promise<StaffListResult> {
  await connectDB();
  const filter: Record<string, unknown> = { restaurantId };
  if (query.role) filter.role = query.role;
  if (query.isActive === "true") filter.isActive = true;
  if (query.isActive === "false") filter.isActive = false;
  if (query.search) {
    const rx = new RegExp(escapeRegExp(query.search), "i");
    filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
  }

  const [docs, all, active, ownerId] = await Promise.all([
    UserModel.find(filter)
      .select("_id fullName email phone role isActive createdAt updatedAt")
      .sort({ createdAt: 1 })
      .limit(STAFF_MAX_ROWS)
      .lean(),
    UserModel.countDocuments({ restaurantId }),
    UserModel.countDocuments({ restaurantId, isActive: true }),
    ownerIdFor(restaurantId),
  ]);

  const items = (docs as unknown as StaffDoc[]).map((doc) => toView(doc, ownerId));
  return { items, total: all, counts: { all, active, inactive: all - active } };
}

export async function getStaffMember(
  restaurantId: string,
  userId: string
): Promise<StaffMemberView | null> {
  await connectDB();
  const doc = await UserModel.findOne({ _id: userId, restaurantId })
    .select("_id fullName email phone role isActive createdAt updatedAt")
    .lean();
  if (!doc) return null;
  return toView(doc as unknown as StaffDoc, await ownerIdFor(restaurantId));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export interface StaffActor {
  userId: string;
  role: string;
}

export async function createStaffMember(
  restaurantId: string,
  input: CreateStaffInput,
  actor: StaffActor
): Promise<StaffMemberView> {
  await connectDB();
  assertActor(actor, input.role);
  assertTenantRole(input.role);

  const restaurant = await RestaurantModel.findById(restaurantId).select("ownerId").lean();
  if (!restaurant) throw new StaffNotFoundError("Restaurant not found.");
  const ownerId = restaurant.ownerId ? String(restaurant.ownerId) : null;
  // `Restaurant.ownerId` is the single source of truth for the owner account,
  // so a second owner is never created from the staff screen.
  if (ownerId !== null && input.role === "OWNER") {
    throw new StaffValidationError("This restaurant already has an owner.");
  }

  await assertEmailAvailable(input.email);

  const passwordHash = await hashPassword(input.password);
  let created: StaffDoc;
  try {
    const doc = await UserModel.create({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      role: input.role,
      // A brand-new login must start active; the form has no isActive toggle.
      isActive: true,
      restaurantId,
      passwordHash,
    });
    created = doc.toObject() as unknown as StaffDoc;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new StaffConflictError("That email address is already in use.");
    }
    throw err;
  }

  const view = toView(created, ownerId);
  await writeAuditLog({
    restaurantId,
    actorUserId: actor.userId,
    action: "STAFF_CHANGE",
    resourceType: "USER",
    resourceId: view.userId,
    reason: "Staff member added.",
    metadata: { change: "STAFF_CREATED", after: snapshot(view) },
  });
  return view;
}

/** Loads the target inside the tenant, or fails — never a cross-tenant write. */
async function loadTarget(
  restaurantId: string,
  userId: string
): Promise<{ view: StaffMemberView }> {
  const doc = await UserModel.findOne({ _id: userId, restaurantId })
    .select("_id fullName email phone role isActive createdAt updatedAt")
    .lean();
  if (!doc) throw new StaffNotFoundError();
  const ownerId = await ownerIdFor(restaurantId);
  return { view: toView(doc as unknown as StaffDoc, ownerId) };
}

export async function updateStaffMember(
  restaurantId: string,
  userId: string,
  input: UpdateStaffInput,
  actor: StaffActor
): Promise<StaffMemberView> {
  await connectDB();
  assertActor(actor, input.role);
  if (input.role !== undefined) assertTenantRole(input.role);

  const { view: before } = await loadTarget(restaurantId, userId);

  // The restaurant's owner is the single account guaranteed to be able to run
  // the restaurant, so their role and active flag are not editable here.
  if (before.isOwner && input.role !== undefined && input.role !== "OWNER") {
    throw new StaffValidationError("The restaurant owner cannot be demoted.");
  }
  if (before.isOwner && input.isActive === false) {
    throw new StaffValidationError("The restaurant owner cannot be deactivated.");
  }
  // Otherwise a manager could lock themselves out by editing their own row.
  if (before.userId === actor.userId && input.isActive === false) {
    throw new StaffValidationError("You cannot deactivate your own account.");
  }
  if (input.email && input.email !== before.email) {
    await assertEmailAvailable(input.email, userId);
  }

  const patch: Record<string, unknown> = {};
  if (input.fullName !== undefined) patch.fullName = input.fullName;
  if (input.email !== undefined) patch.email = input.email;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.role !== undefined) patch.role = input.role;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  try {
    if (Object.keys(patch).length > 0) {
      await UserModel.updateOne({ _id: userId, restaurantId }, { $set: patch });
    }
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new StaffConflictError("That email address is already in use.");
    }
    throw err;
  }

  const after = { ...before, ...patch, updatedAt: new Date() } as StaffMemberView;
  await writeAuditLog({
    restaurantId,
    actorUserId: actor.userId,
    action: "STAFF_CHANGE",
    resourceType: "USER",
    resourceId: userId,
    reason: "Staff member updated.",
    before: snapshot(before),
    after: snapshot(after),
    metadata: { change: "STAFF_UPDATED", changed: Object.keys(patch) },
  });
  return after;
}

export async function setStaffActive(
  restaurantId: string,
  userId: string,
  isActive: boolean,
  actor: StaffActor
): Promise<StaffMemberView> {
  await connectDB();
  assertActor(actor);
  const { view: before } = await loadTarget(restaurantId, userId);

  if (!isActive) {
    if (before.isOwner) {
      throw new StaffValidationError("The restaurant owner cannot be deactivated.");
    }
    if (before.userId === actor.userId) {
      throw new StaffValidationError("You cannot deactivate your own account.");
    }
    if (!before.isActive) return before;
  } else if (before.isActive) {
    return before;
  }

  await UserModel.updateOne({ _id: userId, restaurantId }, { $set: { isActive } });

  const after: StaffMemberView = { ...before, isActive };
  await writeAuditLog({
    restaurantId,
    actorUserId: actor.userId,
    action: "STAFF_CHANGE",
    resourceType: "USER",
    resourceId: userId,
    reason: isActive ? "Staff member activated." : "Staff member deactivated.",
    before: snapshot(before),
    after: snapshot(after),
    metadata: { change: isActive ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED" },
  });
  return after;
}

/**
 * Replaces a staff member's password. The plaintext never leaves this function:
 * only the argon2id hash is written, and neither the value nor the hash is put
 * in the audit record.
 */
export async function resetStaffPassword(
  restaurantId: string,
  userId: string,
  newPassword: string,
  actor: StaffActor
): Promise<{ userId: string; email: string }> {
  await connectDB();
  assertActor(actor);
  const { view: before } = await loadTarget(restaurantId, userId);

  const passwordHash = await hashPassword(newPassword);
  await UserModel.updateOne({ _id: userId, restaurantId }, { $set: { passwordHash } });

  await writeAuditLog({
    restaurantId,
    actorUserId: actor.userId,
    action: "STAFF_CHANGE",
    resourceType: "USER",
    resourceId: userId,
    reason: "Password reset by an administrator.",
    before: snapshot(before),
    after: snapshot(before),
    metadata: { change: "STAFF_PASSWORD_RESET" },
  });

  return { userId: before.userId, email: before.email };
}

/** True when the object id is a well-formed id, used by callers before a query. */
export function isValidStaffId(value: string): boolean {
  return mongoose.isObjectIdOrHexString(value);
}
