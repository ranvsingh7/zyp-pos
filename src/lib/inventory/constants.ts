import type { Role } from "@/lib/auth/roles";

/**
 * Inventory units.
 *
 * `unit` is the unit a user sees and enters values in (display / purchase unit).
 * `baseUnit` is the canonical unit stock is persisted in. All `currentStock`,
 * `minimumStock` and `beforeStock` / `afterStock` values are stored in the base
 * unit as integers to avoid floating point drift.
 */
export const INVENTORY_UNITS = [
  "KG",
  "G",
  "L",
  "ML",
  "PCS",
  "DOZEN",
  "PACK",
  "BOX",
] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

/**
 * Units stock can be persisted in. KG converts to G, L to ML and DOZEN to PCS.
 * PACK and BOX are their own base units (they are not inter-convertible).
 */
export const INVENTORY_BASE_UNITS = ["G", "ML", "PCS", "PACK", "BOX"] as const;
export type InventoryBaseUnit = (typeof INVENTORY_BASE_UNITS)[number];

export const INVENTORY_UNIT_LABELS: Record<InventoryUnit, string> = {
  KG: "kg",
  G: "g",
  L: "L",
  ML: "ml",
  PCS: "pcs",
  DOZEN: "dozen",
  PACK: "pack",
  BOX: "box",
};

export const INVENTORY_STOCK_STATUSES = [
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
] as const;
export type InventoryStockStatus = (typeof INVENTORY_STOCK_STATUSES)[number];

export const INVENTORY_STOCK_STATUS_LABELS: Record<
  InventoryStockStatus,
  string
> = {
  IN_STOCK: "In Stock",
  LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock",
};

export const STOCK_MOVEMENT_TYPES = [
  "PURCHASE",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "WASTAGE",
  "CONSUMPTION",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  PURCHASE: "Purchase",
  ADJUSTMENT_IN: "Adjustment In",
  ADJUSTMENT_OUT: "Adjustment Out",
  WASTAGE: "Wastage",
  CONSUMPTION: "Consumption",
};

/** Movement types that increase stock. Everything else decreases stock. */
export const STOCK_IN_TYPES: StockMovementType[] = [
  "PURCHASE",
  "ADJUSTMENT_IN",
];

export function isStockInType(type: StockMovementType): boolean {
  return STOCK_IN_TYPES.includes(type);
}

export const STOCK_MOVEMENT_REFERENCE_TYPES = [
  "PURCHASE",
  "ADJUSTMENT",
  "WASTAGE",
  "CONSUMPTION",
  "OPENING",
  "MANUAL",
] as const;
export type StockMovementReferenceType =
  (typeof STOCK_MOVEMENT_REFERENCE_TYPES)[number];

/** Reasons offered by the adjustment flow (requirement: reason required). */
export const ADJUSTMENT_REASONS = [
  "Physical Count",
  "Opening Stock",
  "Correction",
  "Damage",
  "Other",
] as const;

/** Reasons offered by the wastage flow. */
export const WASTAGE_REASONS = [
  "Spoiled",
  "Damaged",
  "Expired",
  "Spillage",
  "Other",
] as const;

/** Reasons offered by the consumption flow. */
export const CONSUMPTION_REASONS = [
  "Kitchen Use",
  "Staff Meal",
  "Tasting",
  "Other",
] as const;

export const INVENTORY_ITEM_NAME_MAX = 120;
export const INVENTORY_ITEM_DESCRIPTION_MAX = 500;
export const INVENTORY_CATEGORY_NAME_MAX = 80;
export const INVENTORY_SKU_MAX = 40;
export const INVENTORY_NOTE_MAX = 500;
export const INVENTORY_SUPPLIER_MAX = 120;
export const INVENTORY_INVOICE_MAX = 80;

/** Pagination sizes (requirement: 20-50 per page). */
export const INVENTORY_PAGE_SIZE = 20;
export const PURCHASE_PAGE_SIZE = 20;
export const MOVEMENT_PAGE_SIZE = 20;
export const LOW_STOCK_DASHBOARD_LIMIT = 10;
export const RECENT_MOVEMENTS_LIMIT = 10;

/** Purchase number defaults. The prefix can be overridden per restaurant. */
export const DEFAULT_PURCHASE_PREFIX = "PUR";
export const PURCHASE_NUMBER_PAD = 4;

/** Mongo duplicate key error code (used for retry / idempotency). */
export const MONGODB_DUPLICATE_KEY = 11000;

/** Roles that may view inventory. */
export const INVENTORY_VIEW_ROLES: Role[] = ["OWNER", "MANAGER", "CASHIER"];

/** Roles that may create / edit items and move stock. */
export const INVENTORY_MANAGE_ROLES: Role[] = ["OWNER", "MANAGER"];
