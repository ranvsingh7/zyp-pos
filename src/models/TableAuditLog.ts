import {
  Schema,
  model,
  models,
  type Model,
  type InferSchemaType,
} from "mongoose";

/**
 * The single, shared audit trail for the whole application (tables, billing,
 * inventory, auth, KOTs, security events). There is deliberately ONE collection
 * — the documentation forbids a second, parallel audit system.
 *
 * Security contract (enforced at the model):
 * - Append-only: every legacy + new action funnels through create(). Pre-hooks
 *   below reject updates/deletes at the Mongoose boundary, so application code
 *   cannot rewrite or destroy historical evidence.
 * - Tenant-scoped: every record carries its restaurantId (except system-scoped
 *   events such as a failed login with an unknown email, which has no tenant).
 * - Field mapping to the security spec (audit fields):
 *     actorUserId  -> `userId`      (may be null: failed logins with unknown email)
 *     actorRole    -> `actorRole`
 *     resourceType -> `entityType`
 *     resourceId   -> `entityId`
 *     + `before`, `after`, `reason`, `success`, `ip`, `userAgent`, `requestId`.
 */
export const TABLE_AUDIT_ACTIONS = [
  // Table & floor plan
  "TABLE_CREATED",
  "TABLE_UPDATED",
  "TABLE_STATUS_CHANGED",
  "TABLE_ACTIVATED",
  "TABLE_DEACTIVATED",
  "SECTION_CREATED",
  "SECTION_UPDATED",
  "SECTION_DEACTIVATED",
  // Billing uses the same audit trail (one system, not a second one).
  "BILL_GENERATED",
  "BILL_DISCOUNT_APPLIED",
  "BILL_PAYMENT_ADDED",
  "BILL_PAID",
  "BILL_CANCELLED",
  "BILL_PRINTED",
  // Inventory uses the same audit trail (one system, not a second one).
  "INVENTORY_ITEM_CREATED",
  "INVENTORY_ITEM_UPDATED",
  "INVENTORY_ITEM_DEACTIVATED",
  "INVENTORY_ITEM_REACTIVATED",
  "INVENTORY_CATEGORY_CREATED",
  "INVENTORY_CATEGORY_UPDATED",
  "PURCHASE_CREATED",
  "PURCHASE_REVERSED",
  "STOCK_ADDED",
  "STOCK_REMOVED",
  "STOCK_WASTAGE_RECORDED",
  "STOCK_CONSUMPTION_RECORDED",
  // Orders & kitchen
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",
  "DISCOUNT_OVERRIDE",
  "KOT_CREATED",
  "KOT_CANCELLED",
  // Platform / SaaS admin management
  "ADMIN_LOGIN",
  "FAILED_ADMIN_LOGIN",
  "RESTAURANT_CREATED",
  "RESTAURANT_EDITED",
  "RESTAURANT_SUSPENDED",
  "RESTAURANT_ACTIVATED",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_RENEWED",
  "SUBSCRIPTION_PLAN_CHANGED",
  "SUBSCRIPTION_PRICE_CHANGED",
  "SUBSCRIPTION_EXPIRY_EXTENDED",
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_REACTIVATED",
  "SUBSCRIPTION_CANCELLED",
  // Plan catalogue. Distinct from the generic CREATE/UPDATE so a plan edit is
  // greppable, and so a change to the *service entitlements* of a plan can be
  // told apart from an ordinary field edit. Note the hold/resume operations on
  // a subscription are the existing SUBSCRIPTION_SUSPENDED /
  // SUBSCRIPTION_REACTIVATED actions above — deliberately not duplicated here.
  "PLAN_CREATED",
  "PLAN_UPDATED",
  "PLAN_ACTIVATED",
  "PLAN_DEACTIVATED",
  "PLAN_SERVICES_UPDATED",
  "PAYMENT_RECORDED",
  "PAYMENT_UPDATED",
  "PAYMENT_REFUNDED",
  // Auth & security
  "LOGIN",
  "FAILED_LOGIN",
  "LOGOUT",
  "DELETE_ATTEMPT",
  "STAFF_CHANGE",
  "SETTINGS_CHANGE",
  // Generic lifecycle actions (applied with specific resource types)
  "CREATE",
  "UPDATE",
  "CANCEL",
  "VOID",
  "REFUND",
  "PAYMENT",
  "STOCK_ADJUSTMENT",
] as const;

export type TableAuditAction = (typeof TABLE_AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  "TABLE",
  "SECTION",
  "BILL",
  "ORDER",
  "INVENTORY_ITEM",
  "INVENTORY_CATEGORY",
  "PURCHASE",
  "STOCK_MOVEMENT",
  "PAYMENT",
  "KOT",
  "USER",
  "AUDIT_LOG",
  "SETTINGS",
  "RESTAURANT",
  "PLAN",
  "SUBSCRIPTION",
  "SUBSCRIPTION_PAYMENT",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

const tableAuditLogSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: false,
      index: true,
    },
    /** The actor who performed the action (null = system/anonymous event). */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    /** Actor's role at the moment of the event (snapshot, not live lookup). */
    actorRole: {
      type: String,
      enum: ["OWNER", "MANAGER", "CASHIER", "WAITER", "SUPER_ADMIN"],
      required: false,
    },
    action: {
      type: String,
      enum: TABLE_AUDIT_ACTIONS as unknown as string[],
      required: true,
    },
    entityType: {
      type: String,
      enum: AUDIT_ENTITY_TYPES as unknown as string[],
      required: true,
    },
    /**
     * The id of the affected record. Usually a Mongo ObjectId string; for
     * unknown-account security events (e.g. FAILED_LOGIN) it may hold a
     * non-ObjectId value such as the attempted email.
     */
    entityId: {
      type: Schema.Types.Mixed,
      required: false,
    },
    /** Snapshot of the record before the change (where captured). */
    before: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    /** Snapshot of the record after the change (where captured). */
    after: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    /** free-text reason (cancellation reason, override justification, …). */
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    /** Short human-readable label of the affected record (e.g. venue name). */
    entityName: {
      type: String,
      trim: true,
      default: null,
    },
    /** One-line digest of the event, rendered by audit viewers directly. */
    summary: {
      type: String,
      trim: true,
      default: null,
    },
    /** Whether the audited action succeeded. Treated as true when omitted. */
    success: {
      type: Boolean,
      default: true,
    },
    ip: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    requestId: {
      type: String,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// Query-friendly tenant-scoped indexes (requirement: audit viewer filters on
// date, actor, resource; login/export cross-reference these).
tableAuditLogSchema.index({ restaurantId: 1, createdAt: -1 });
tableAuditLogSchema.index({ restaurantId: 1, userId: 1, createdAt: -1 });
tableAuditLogSchema.index({ restaurantId: 1, entityType: 1, entityId: 1 });
// Platform-side (SaaS admin audit trail) browse indexes — venue-agnostic.
tableAuditLogSchema.index({ action: 1, createdAt: -1 });
tableAuditLogSchema.index({ entityType: 1, entityId: 1 });
tableAuditLogSchema.index({ userId: 1, createdAt: -1 });

/**
 * Append-only enforcement. Audit evidence must never be mutated or deleted by
 * the application, so every mutating Mongoose operator is rejected at the
 * model boundary. `create`/`insertMany` remain available (append-only means
 * only those). Raw-driver bulk ops can still reach MongoDB during disaster
 * recovery — that is outside the application layer by design.
 */
const MUTATION_OPS = [
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "findByIdAndDelete",
  "remove",
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findByIdAndUpdate",
  "replaceOne",
] as const;

for (const op of MUTATION_OPS) {
  // Kareem 3.x (mongoose 9) invokes query pre-hooks with NO `next` callback —
  // pass the error by throwing (rejects the operation) instead.
  tableAuditLogSchema.pre(
    op as Parameters<typeof tableAuditLogSchema.pre>[0],
    function () {
      throw new Error(
        "Audit logs are append-only: updates and deletions of audit records are prohibited."
      );
    }
  );
}

export type TableAuditLog = InferSchemaType<typeof tableAuditLogSchema>;

export const TableAuditLogModel =
  (models.TableAuditLog as Model<TableAuditLog>) ||
  model<TableAuditLog>("TableAuditLog", tableAuditLogSchema);