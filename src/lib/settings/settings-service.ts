import "server-only";

import { connectDB } from "@/lib/db";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { writeAuditLog } from "@/lib/audit/audit-service";
import {
  DEFAULT_TAX_CONFIG,
  BILL_PREFIX_DEFAULT,
} from "@/lib/billing/constants";
import { resolveEffectiveTaxEnabled } from "@/lib/billing/tax-config";
import { normalizeBillPrefix } from "@/lib/billing/bill-service";
import { DEFAULT_PURCHASE_PREFIX } from "@/lib/inventory/constants";
import {
  KOT_PREFIX_DEFAULT,
  PREFIX_MAX,
  type LogoMimeType,
} from "./constants";
import { validateLogoBytes } from "./logo";
import { isValidUpiId, type RestaurantSettingsUpdateInput } from "./validation";

export class SettingsNotFoundError extends Error {
  constructor(message = "Restaurant settings not found.") {
    super(message);
    this.name = "SettingsNotFoundError";
  }
}

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export interface RestaurantSettingsSnapshot {
  restaurant: {
    name: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    businessType: string;
    gstRegistered: boolean;
    gstin: string;
  };
  tax: {
    taxEnabled: boolean;
    defaultTaxRate: number;
    cgstRatePercent: number;
    sgstRatePercent: number;
    igstRatePercent: number;
    gstScheme: string;
    taxInclusive: boolean;
  };
  billing: {
    currency: string;
    billPrefix: string;
    kotPrefix: string;
    purchasePrefix: string;
    serviceChargeEnabled: boolean;
    serviceChargeRate: number;
    roundOffEnabled: boolean;
    upiId: string;
  };
  logo: {
    present: boolean;
    mimeType: string;
    size: number;
    updatedAt: string;
  };
}

interface RestaurantDoc {
  name: string;
  phone: string;
  email?: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  businessType: string;
  gstRegistered: boolean;
  gstin?: string | null;
  logo?: {
    mimeType: string;
    size: number;
    updatedAt?: Date | null;
  } | null;
}

interface SettingsDoc {
  currency?: string | null;
  defaultTaxRate?: number | null;
  taxEnabled?: boolean | null;
  cgstRatePercent?: number | null;
  sgstRatePercent?: number | null;
  igstRatePercent?: number | null;
  taxInclusive?: boolean | null;
  gstScheme?: string | null;
  serviceChargeEnabled?: boolean | null;
  serviceChargeRate?: number | null;
  roundOffEnabled?: boolean | null;
  billPrefix?: string | null;
  kotPrefix?: string | null;
  purchasePrefix?: string | null;
  upiId?: string | null;
}

export async function getSettingsSnapshot(
  restaurantId: string
): Promise<RestaurantSettingsSnapshot> {
  await connectDB();
  const [restaurant, settings] = await Promise.all([
    RestaurantModel.findById(restaurantId)
      .select("name phone email address city state pincode businessType gstRegistered gstin logo.mimeType logo.size logo.updatedAt")
      .lean(),
    RestaurantSettingsModel.findOne({ restaurantId }).lean(),
  ]);
  if (!restaurant) throw new SettingsNotFoundError();

  const r = restaurant as unknown as RestaurantDoc;
  const s = (settings as unknown as SettingsDoc | null) ?? {};
  const gstRegistered = Boolean(r.gstRegistered);
  const defaultTaxRate = s.defaultTaxRate ?? DEFAULT_TAX_CONFIG.defaultTaxRate;

  return {
    restaurant: {
      name: r.name,
      phone: r.phone,
      email: r.email ?? "",
      address: r.address,
      city: r.city,
      state: r.state,
      pincode: r.pincode,
      businessType: r.businessType,
      gstRegistered,
      gstin: r.gstin ?? "",
    },
    tax: {
      // GST registration stays the master control on taxation, exactly as the
      // billing engine resolves it.
      taxEnabled: resolveEffectiveTaxEnabled(s.taxEnabled ?? DEFAULT_TAX_CONFIG.taxEnabled, gstRegistered),
      defaultTaxRate,
      cgstRatePercent: s.cgstRatePercent ?? defaultTaxRate / 2,
      sgstRatePercent: s.sgstRatePercent ?? defaultTaxRate / 2,
      igstRatePercent: s.igstRatePercent ?? defaultTaxRate,
      gstScheme: s.gstScheme ?? "INTRA_STATE",
      taxInclusive: Boolean(s.taxInclusive),
    },
    billing: {
      currency: s.currency ?? "INR",
      billPrefix: s.billPrefix ?? BILL_PREFIX_DEFAULT,
      kotPrefix: s.kotPrefix ?? KOT_PREFIX_DEFAULT,
      purchasePrefix: s.purchasePrefix ?? DEFAULT_PURCHASE_PREFIX,
      serviceChargeEnabled: Boolean(s.serviceChargeEnabled),
      serviceChargeRate: s.serviceChargeRate ?? 0,
      roundOffEnabled: Boolean(s.roundOffEnabled),
      upiId: isValidUpiId(s.upiId) ? s.upiId : "",
    },
    logo: {
      present: Boolean(r.logo?.mimeType),
      mimeType: r.logo?.mimeType ?? "",
      size: r.logo?.size ?? 0,
      updatedAt: r.logo?.updatedAt ? new Date(r.logo.updatedAt).toISOString() : "",
    },
  };
}

/**
 * Partial update of the restaurant profile + its settings document. Only the
 * fields present in `input` are written, so a save never clears untouched
 * configuration, and GST registration remains the master control on tax.
 */
export async function updateRestaurantSettings(
  restaurantId: string,
  input: RestaurantSettingsUpdateInput,
  actor?: { userId?: string | null; role?: string | null }
): Promise<RestaurantSettingsSnapshot> {
  await connectDB();
  const existing = await RestaurantModel.findById(restaurantId)
    .select("name phone email address city state pincode businessType gstRegistered gstin")
    .lean();
  if (!existing) throw new SettingsNotFoundError();
  const current = existing as unknown as RestaurantDoc;
  const settings = (await RestaurantSettingsModel.findOne({ restaurantId }).lean()) as unknown as
    | SettingsDoc
    | null;

  const restaurantPatch: Record<string, unknown> = {};
  if (input.name != null) restaurantPatch.name = input.name;
  if (input.businessType != null) restaurantPatch.businessType = input.businessType;
  if (input.phone != null) restaurantPatch.phone = input.phone;
  if (input.email !== undefined) restaurantPatch.email = input.email?.trim() || null;
  if (input.address != null) restaurantPatch.address = input.address;
  if (input.city != null) restaurantPatch.city = input.city;
  if (input.state != null) restaurantPatch.state = input.state;
  if (input.pincode != null) restaurantPatch.pincode = input.pincode;

  const gstRegistered =
    input.gstRegistered != null ? Boolean(input.gstRegistered) : Boolean(current.gstRegistered);
  const gstin =
    input.gstin !== undefined
      ? input.gstin?.trim() || null
      : current.gstin
        ? String(current.gstin)
        : null;
  if (input.gstRegistered != null) {
    restaurantPatch.gstRegistered = gstRegistered;
    // Deregistering must not leave a GSTIN behind on the record.
    if (input.gstin === undefined && !gstRegistered) restaurantPatch.gstin = null;
  }
  if (input.gstin !== undefined) restaurantPatch.gstin = input.gstin?.trim() || null;
  if (gstRegistered && !gstin) {
    throw new SettingsValidationError("GSTIN is required when GST registration is enabled.");
  }

  // Tax lives on RestaurantSettings (per-restaurant isolation). Merge over the
  // stored values first so a partial save validates against the effective
  // configuration rather than half of it.
  const settingsPatch: Record<string, unknown> = {};
  // An enabled service charge with no rate would silently add nothing to bills.
  const nextServiceChargeEnabled =
    input.serviceChargeEnabled ?? Boolean(settings?.serviceChargeEnabled);
  if (nextServiceChargeEnabled) {
    const rate = input.serviceChargeRate ?? settings?.serviceChargeRate ?? 0;
    if (rate <= 0) {
      throw new SettingsValidationError("Enter a service charge rate greater than zero.");
    }
  }
  const nextGstScheme = input.gstScheme ?? settings?.gstScheme ?? "INTRA_STATE";
  const nextDefaultRate = input.defaultTaxRate ?? settings?.defaultTaxRate ?? DEFAULT_TAX_CONFIG.defaultTaxRate;
  const nextCgst = input.cgstRatePercent ?? settings?.cgstRatePercent ?? nextDefaultRate / 2;
  const nextSgst = input.sgstRatePercent ?? settings?.sgstRatePercent ?? nextDefaultRate / 2;
  const nextIgst = input.igstRatePercent ?? settings?.igstRatePercent ?? nextDefaultRate;

  // Only re-check the split when the payload actually touches tax, so saving
  // an unrelated field is never blocked by legacy stored rates.
  const taxTouched =
    input.taxEnabled != null ||
    input.defaultTaxRate != null ||
    input.cgstRatePercent != null ||
    input.sgstRatePercent != null ||
    input.igstRatePercent != null ||
    input.gstScheme != null;
  if (taxTouched) {
    if (nextGstScheme === "INTER_STATE") {
      if (Math.abs(nextIgst - nextDefaultRate) > 0.001) {
        throw new SettingsValidationError(
          "IGST rate must equal the default tax rate for inter-state billing."
        );
      }
    } else if (Math.abs(nextCgst + nextSgst - nextDefaultRate) > 0.001) {
      throw new SettingsValidationError("CGST + SGST must equal the default tax rate.");
    }
  }

  if (input.taxEnabled != null) {
    settingsPatch.taxEnabled = resolveEffectiveTaxEnabled(input.taxEnabled, gstRegistered);
  } else if (!gstRegistered && settings?.taxEnabled) {
    // Unregistering a restaurant must immediately disable tax, otherwise bills
    // would keep charging GST the restaurant is no longer registered for.
    settingsPatch.taxEnabled = false;
  }
  if (input.defaultTaxRate != null) settingsPatch.defaultTaxRate = nextDefaultRate;
  if (input.cgstRatePercent != null) settingsPatch.cgstRatePercent = nextCgst;
  if (input.sgstRatePercent != null) settingsPatch.sgstRatePercent = nextSgst;
  if (input.igstRatePercent != null) settingsPatch.igstRatePercent = nextIgst;
  if (input.gstScheme != null) settingsPatch.gstScheme = nextGstScheme;
  if (input.taxInclusive != null) settingsPatch.taxInclusive = Boolean(input.taxInclusive);

  if (input.serviceChargeEnabled != null) {
    settingsPatch.serviceChargeEnabled = Boolean(input.serviceChargeEnabled);
  }
  if (input.serviceChargeRate != null) {
    settingsPatch.serviceChargeRate = input.serviceChargeRate;
  }
  if (input.roundOffEnabled != null) settingsPatch.roundOffEnabled = Boolean(input.roundOffEnabled);
  if (input.billPrefix != null) settingsPatch.billPrefix = normalizeBillPrefix(input.billPrefix);
  if (input.kotPrefix != null) settingsPatch.kotPrefix = normalizePrefix(input.kotPrefix, KOT_PREFIX_DEFAULT);
  if (input.purchasePrefix != null) {
    settingsPatch.purchasePrefix = normalizePrefix(input.purchasePrefix, DEFAULT_PURCHASE_PREFIX);
  }
  // A blank UPI ID clears it (null), so the bill stops printing a QR. The same
  // tenant-scoped `$set`/`$unset` write as every other field keeps one restaurant
  // from touching another's value. The value is re-checked here as well as in the
  // schema, because this write is the last gate before the handle is embedded in
  // a `upi://pay` URI on the restaurant's own bills.
  if (input.upiId !== undefined) {
    if (input.upiId === null) {
      settingsPatch.upiId = null;
    } else if (isValidUpiId(input.upiId)) {
      settingsPatch.upiId = input.upiId;
    } else {
      throw new SettingsValidationError("Enter a valid UPI ID in the form restaurantname@provider.");
    }
  }

  if (Object.keys(restaurantPatch).length > 0) {
    await RestaurantModel.updateOne({ _id: restaurantId }, { $set: restaurantPatch });
  }
  if (Object.keys(settingsPatch).length > 0) {
    await RestaurantSettingsModel.updateOne(
      { restaurantId },
      { $set: settingsPatch },
      { upsert: true }
    );
  }

  const changed = [...Object.keys(restaurantPatch), ...Object.keys(settingsPatch)];
  if (changed.length > 0) {
    await writeAuditLog({
      restaurantId,
      actorUserId: actor?.userId ?? null,
      actorRole: (actor?.role as never) ?? null,
      action: "SETTINGS_CHANGE",
      resourceType: "SETTINGS",
      resourceId: restaurantId,
      after: { changed },
      metadata: { changed },
    });
  }

  return getSettingsSnapshot(restaurantId);
}

/** Document prefixes are alphanumeric and upper-cased, matching bill numbering. */
function normalizePrefix(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").trim().toUpperCase();
  return (cleaned || fallback).slice(0, PREFIX_MAX);
}

export interface StoredLogo {
  data: Buffer;
  mimeType: LogoMimeType;
  size: number;
  updatedAt: string;
}

/** Stores validated logo bytes on the restaurant, replacing any previous logo. */
export async function saveRestaurantLogo(
  restaurantId: string,
  bytes: Uint8Array,
  declaredType?: string | null,
  actor?: { userId?: string | null; role?: string | null }
): Promise<StoredLogo> {
  await connectDB();
  const result = validateLogoBytes(bytes, declaredType);
  if (!result.ok || !result.mimeType) {
    throw new SettingsValidationError(result.error ?? "Invalid logo file.");
  }
  const updatedAt = new Date();
  const data = Buffer.from(bytes);
  const updated = await RestaurantModel.updateOne(
    { _id: restaurantId },
    { $set: { logo: { data, mimeType: result.mimeType, size: result.size, updatedAt } } }
  );
  if (updated.matchedCount === 0) throw new SettingsNotFoundError();

  await writeAuditLog({
    restaurantId,
    actorUserId: actor?.userId ?? null,
    actorRole: (actor?.role as never) ?? null,
    action: "SETTINGS_CHANGE",
    resourceType: "SETTINGS",
    resourceId: restaurantId,
    after: { logo: { mimeType: result.mimeType, size: result.size } },
  });

  return { data, mimeType: result.mimeType, size: result.size, updatedAt: updatedAt.toISOString() };
}

export async function removeRestaurantLogo(
  restaurantId: string,
  actor?: { userId?: string | null; role?: string | null }
): Promise<void> {
  await connectDB();
  const updated = await RestaurantModel.updateOne(
    { _id: restaurantId },
    { $unset: { logo: "" } }
  );
  if (updated.matchedCount === 0) throw new SettingsNotFoundError();

  await writeAuditLog({
    restaurantId,
    actorUserId: actor?.userId ?? null,
    actorRole: (actor?.role as never) ?? null,
    action: "SETTINGS_CHANGE",
    resourceType: "SETTINGS",
    resourceId: restaurantId,
    after: { logo: null },
  });
}

/**
 * Normalises the stored logo payload to a Node Buffer.
 *
 * A `.lean()` read hands back a mongodb-driver `Binary`, which is NOT a Node
 * Buffer. The trap is that `Buffer.from(binary)` does not throw -- it quietly
 * returns a 0-length buffer -- so a healthy upload reads back as "no logo" and
 * the file appears to have been lost. Hydrated reads, by contrast, do return a
 * real Buffer, so the two read styles disagree. Normalise every shape here.
 */
function toLogoBuffer(value: unknown): Buffer | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value.length > 0 ? value : null;
  if (value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    return buf.length > 0 ? buf : null;
  }
  if (typeof value === "string") {
    // BSON binary base64-encodes itself through JSON/lean conversions.
    const buf = Buffer.from(value, "base64");
    return buf.length > 0 ? buf : null;
  }
  if (typeof value === "object") {
    const binary = value as {
      buffer?: unknown;
      toBuffer?: () => Buffer;
      length?: unknown;
      position?: unknown;
      _bsontype?: string;
    };
    if (typeof binary.toBuffer === "function") {
      const buf = binary.toBuffer();
      return buf.length > 0 ? buf : null;
    }
    if (binary.buffer instanceof Uint8Array) {
      const buf = Buffer.from(binary.buffer);
      return buf.length > 0 ? buf : null;
    }
  }
  return null;
}

/** Reads the stored logo for the authenticated tenant only. */
export async function getRestaurantLogo(restaurantId: string): Promise<StoredLogo | null> {
  await connectDB();
  // `.lean()` yields the raw BSON `Binary`, which `toLogoBuffer` normalises.
  const restaurant = (await RestaurantModel.findById(restaurantId)
    .select("logo")
    .lean()) as unknown as { logo?: { data?: unknown; mimeType?: string; size?: number; updatedAt?: Date | string | null } | null } | null;

  const logo = restaurant?.logo;
  const data = toLogoBuffer(logo?.data);
  if (!data || !logo?.mimeType) return null;

  return {
    data,
    mimeType: logo.mimeType as LogoMimeType,
    size: typeof logo.size === "number" && logo.size > 0 ? logo.size : data.length,
    updatedAt: logo.updatedAt ? new Date(logo.updatedAt).toISOString() : "",
  };
}

/**
 * Reads the saved UPI ID for one restaurant only.
 *
 * The restaurant id is always the one resolved from the session by the caller —
 * never a submitted value — and the stored handle is re-validated on read so
 * legacy or hand-edited documents can never reach a `upi://pay` URI.
 */
export async function getRestaurantUpiId(restaurantId: string): Promise<string | null> {
  await connectDB();
  const settings = (await RestaurantSettingsModel.findOne({ restaurantId })
    .select("upiId")
    .lean()) as unknown as { upiId?: string | null } | null;
  return isValidUpiId(settings?.upiId) ? settings.upiId : null;
}
