import {
  INVENTORY_UNITS,
  INVENTORY_UNIT_LABELS,
  type InventoryBaseUnit,
  type InventoryStockStatus,
  type InventoryUnit,
} from "./constants";

/**
 * Unit conversion.
 *
 * Inventory stock is stored in a base unit as integers. Users see and enter
 * values in a display / purchase unit. Conversions only happen inside a unit
 * family: KG <-> G, L <-> ML, DOZEN <-> PCS. PACK and BOX are separate
 * families and are never inter-convertible.
 *
 * All conversions round to the nearest integer base unit, which is the
 * smallest unit we track (1 G, 1 ML, 1 PCS, 1 PACK, 1 BOX).
 */

type UnitFamily = "MASS" | "VOLUME" | "COUNT" | "PACKAGE";

interface UnitMeta {
  family: UnitFamily;
  baseUnit: InventoryBaseUnit;
  /** How many base units one of this unit is worth. */
  factor: number;
}

const UNIT_META: Record<InventoryUnit, UnitMeta> = {
  KG: { family: "MASS", baseUnit: "G", factor: 1000 },
  G: { family: "MASS", baseUnit: "G", factor: 1 },
  L: { family: "VOLUME", baseUnit: "ML", factor: 1000 },
  ML: { family: "VOLUME", baseUnit: "ML", factor: 1 },
  DOZEN: { family: "COUNT", baseUnit: "PCS", factor: 12 },
  PCS: { family: "COUNT", baseUnit: "PCS", factor: 1 },
  PACK: { family: "PACKAGE", baseUnit: "PACK", factor: 1 },
  BOX: { family: "PACKAGE", baseUnit: "BOX", factor: 1 },
};

export function isInventoryUnit(value: unknown): value is InventoryUnit {
  return (
    typeof value === "string" &&
    (INVENTORY_UNITS as readonly string[]).includes(value)
  );
}

export function unitMeta(unit: InventoryUnit): UnitMeta {
  return UNIT_META[unit];
}

export function unitLabel(unit: InventoryUnit): string {
  return INVENTORY_UNIT_LABELS[unit];
}

/** The canonical base unit for a display unit (KG -> G, DOZEN -> PCS). */
export function baseUnitFor(unit: InventoryUnit): InventoryBaseUnit {
  return UNIT_META[unit].baseUnit;
}

/**
 * Conversion multiplier from `from` to `to`. Returns null when the units
 * belong to different families (e.g. KG -> ML), which callers must reject.
 */
export function conversionFactor(
  from: InventoryUnit,
  to: InventoryUnit
): number | null {
  const a = UNIT_META[from];
  const b = UNIT_META[to];
  if (a.family !== b.family) return null;
  // PACK and BOX share the PACKAGE family but are not inter-convertible.
  if (a.family === "PACKAGE" && from !== to) return null;
  return a.factor / b.factor;
}

/** True when `unit` can be used to measure stock stored in `baseUnit`. */
export function isUnitCompatibleWithBase(
  baseUnit: InventoryBaseUnit,
  unit: InventoryUnit
): boolean {
  return UNIT_META[unit].baseUnit === baseUnit;
}

/** Convert a display quantity to integer base units. */
export function toBaseQuantity(
  quantity: number,
  unit: InventoryUnit
): number {
  if (!Number.isFinite(quantity)) {
    throw new Error("Invalid quantity.");
  }
  return Math.round(quantity * UNIT_META[unit].factor);
}

/** Convert integer base units back to a display quantity. */
export function fromBaseQuantity(
  baseQuantity: number,
  unit: InventoryUnit
): number {
  if (!Number.isFinite(baseQuantity)) {
    throw new Error("Invalid stock value.");
  }
  return baseQuantity / UNIT_META[unit].factor;
}

/** Convert between two display units; null when incompatible. */
export function convertQuantity(
  quantity: number,
  from: InventoryUnit,
  to: InventoryUnit
): number | null {
  const factor = conversionFactor(from, to);
  if (factor === null) return null;
  return quantity * factor;
}

/**
 * Cost of one base unit, given a rate expressed per display unit.
 * e.g. ₹280 per KG -> 28000 paise / 1000 = 28 paise per G.
 */
export function ratePerBasePaise(
  ratePerUnitPaise: number,
  unit: InventoryUnit
): number {
  return Math.round(ratePerUnitPaise / UNIT_META[unit].factor);
}

/** The rate per display unit, given the stored cost of one base unit. */
export function ratePerUnitPaise(
  costPerBasePaise: number,
  unit: InventoryUnit
): number {
  return Math.round(costPerBasePaise * UNIT_META[unit].factor);
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** "12 kg", "500 g", "2.5 pcs". Used to render base stock in a display unit. */
export function formatStockQuantity(
  baseQuantity: number,
  unit: InventoryUnit
): string {
  return `${trimNumber(fromBaseQuantity(baseQuantity, unit))} ${unitLabel(unit)}`;
}

/** Format a plain quantity (already in `unit`) with the unit suffix. */
export function formatQuantity(quantity: number, unit: InventoryUnit): string {
  return `${trimNumber(quantity)} ${unitLabel(unit)}`;
}

/**
 * Stock status derived from balances (never stored, so it can never go stale).
 *   currentStock <= 0                       -> OUT_OF_STOCK
 *   currentStock > 0 && <= minimumStock      -> LOW_STOCK
 *   otherwise                                -> IN_STOCK
 */
export function stockStatusFor(
  currentStock: number,
  minimumStock: number
): InventoryStockStatus {
  if (currentStock <= 0) return "OUT_OF_STOCK";
  if (currentStock <= minimumStock) return "LOW_STOCK";
  return "IN_STOCK";
}

/**
 * Suggest a sensible display unit for a base unit. Used when creating an item
 * so a stock of 12000 G is shown as 12 kg rather than 12000 g.
 */
export function displayUnitForBase(baseUnit: InventoryBaseUnit): InventoryUnit {
  switch (baseUnit) {
    case "G":
      return "KG";
    case "ML":
      return "L";
    case "PCS":
      return "PCS";
    case "PACK":
      return "PACK";
    case "BOX":
      return "BOX";
  }
}
