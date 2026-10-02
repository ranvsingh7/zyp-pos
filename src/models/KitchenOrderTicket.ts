import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import {
  ORDER_TYPES,
  ORDER_ITEM_NOTE_MAX,
  ORDER_NOTE_MAX,
  ORDER_CUSTOMER_NAME_MAX,
} from "@/lib/orders/constants";

const KOT_ITEM_ACTIONS = ["ADDED"] as const;
const KOT_TYPES = ["NEW", "MODIFIED"] as const;
const KOT_STATES = ["PENDING", "SENT"] as const;
// Cancellation is non-destructive: the original KOT record stays but is marked
// CANCELLED so it remains visible in history while no longer actionable.
const KOT_STATUSES = ["ACTIVE", "CANCELLED"] as const;

const kotItemSchema = new Schema(
  {
    menuItemId: {
      // Item identity used to compute incremental deltas against later prints.
      // Absent on legacy KOTs created before this field existed; those fall back
      // to name+variant+note matching.
      type: Schema.Types.ObjectId,
      ref: "MenuItem",
      default: null,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "MenuVariant",
      default: null,
    },
    name: {
      // Server snapshot of the menu item name at KOT creation time.
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    variant: {
      type: String,
      trim: true,
      default: null,
      maxlength: 100,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    note: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_ITEM_NOTE_MAX,
    },
    action: {
      // Always "ADDED" — each KOT prints newly-added items and quantity
      // increases, not removals or cancelled quantities.
      type: String,
      enum: KOT_ITEM_ACTIONS as unknown as string[],
      default: "ADDED",
    },
  },
  { _id: false }
);

/**
 * A Kitchen Order Ticket (KOT). Represents the INCREMENTAL delta to send to the
 * kitchen since the last PRINTED KOT: only newly-added items and increased
 * quantities (against the accumulated "printed ledger") are stored. The first
 * KOT of an order carries the complete order. Printed KOT records are immutable
 * snapshots; reprints use the saved snapshot. Decreased/removed quantities are
 * never re-printed as a new KOT.
 */
const kitchenOrderTicketSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    kotNumber: {
      type: String,
      required: true,
      trim: true,
    },
    orderNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    type: {
      // NEW = the first KOT for an order. MODIFIED = a later KOT that carries
      // only the newly-added items / increased quantities since the last
      // printed KOT. The UI/print label for MODIFIED KOTs is "Updated", but the
      // stored enum value is MODIFIED.
      type: String,
      enum: KOT_TYPES as unknown as string[],
      default: "NEW",
    },
    orderType: {
      type: String,
      enum: ORDER_TYPES as unknown as string[],
      required: true,
    },
    tableName: {
      // Snapshot for dine-in KOTs ("T5"). Null for takeaway / quick sale.
      type: String,
      trim: true,
      default: null,
      maxlength: 50,
    },
    customerName: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_CUSTOMER_NAME_MAX,
    },
    items: {
      type: [kotItemSchema],
      default: [],
    },
    orderNote: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_NOTE_MAX,
    },
    claimKey: {
      // Idempotency guard computed from the exact order snapshot. Unique per
      // restaurant so two rapid PRINT KOT clicks (same order state) can never
      // create duplicate KOTs. A different order state yields a different
      // claimKey and therefore a new KOT.
      type: String,
      required: true,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    printedAt: {
      type: Date,
      default: null,
    },
    printedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    state: {
      // PENDING = printed but not yet confirmed as received by kitchen.
      // SENT = confirmed as received by kitchen.
      type: String,
      enum: KOT_STATES as unknown as string[],
      default: "PENDING",
    },
    status: {
      // ACTIVE = this KOT is part of the live kitchen workflow.
      // CANCELLED = voided after printing (e.g. wrong table / printed by
      // mistake). The snapshot is preserved; only cancellation metadata is
      // added. Cancelled KOTs are no longer reprinted or cancelled again.
      type: String,
      enum: KOT_STATUSES as unknown as string[],
      default: "ACTIVE",
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: ORDER_ITEM_NOTE_MAX,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// An order can have many KOTs (one per revision); this index backs
// KOT history lookups. claimKey is unique so a repeated print of the same
// order state can never insert two records.
kitchenOrderTicketSchema.index({ restaurantId: 1, orderId: 1 });
kitchenOrderTicketSchema.index({ restaurantId: 1, claimKey: 1 }, { unique: true });
kitchenOrderTicketSchema.index({ restaurantId: 1, kotNumber: 1 }, { unique: true });
kitchenOrderTicketSchema.index({ restaurantId: 1, state: 1 });
kitchenOrderTicketSchema.index({ restaurantId: 1, createdAt: -1 });

export type KotItem = InferSchemaType<typeof kotItemSchema>;
export type KitchenOrderTicket = InferSchemaType<typeof kitchenOrderTicketSchema>;
export type KitchenOrderTicketDocument = KitchenOrderTicket & { _id: unknown };

export const KotModel =
  (models.KitchenOrderTicket as Model<KitchenOrderTicket>) ||
  model<KitchenOrderTicket>("KitchenOrderTicket", kitchenOrderTicketSchema);