import { MenuVariantModel } from "@/models/MenuVariant";
import { connectDB } from "@/lib/db";
import { MenuValidationError } from "@/lib/menu/errors";
import { exactCaseInsensitiveRegex } from "@/lib/menu/utils";
import { normalizeTaxOverride } from "@/lib/billing/tax-config";
import type { MenuVariantInput } from "@/lib/menu/validation";
import type { MenuVariantView } from "@/lib/menu/types";

/** The machine `name` code for a variant (uppercase, e.g. "HALF", "200ML"). */
export function resolveVariantCode(input: MenuVariantInput): string {
  const code = (input.name ?? input.displayName).trim().toUpperCase();
  return code || input.displayName.trim().toUpperCase();
}

/** Case-insensitive duplicate-name check scoped to one menu item. */
export async function assertUniqueVariantName(
  restaurantId: string,
  menuItemId: string,
  code: string,
  excludeId?: string
): Promise<void> {
  await connectDB();
  const query: Record<string, unknown> = {
    restaurantId,
    menuItemId,
    name: exactCaseInsensitiveRegex(code),
    isActive: true,
  };
  if (excludeId) query._id = { $ne: excludeId };

  const existing = await MenuVariantModel.findOne(query).select("_id").lean();
  if (existing) {
    throw new MenuValidationError(
      `A variant named "${code}" already exists for this item.`
    );
  }
}

export function variantToView(doc: {
  _id: unknown;
  menuItemId: unknown;
  name: string;
  displayName: string;
  price: number;
  description?: string | null;
  sku?: string | null;
  sizeValue?: number | null;
  sizeUnit?: string | null;
  displayOrder: number;
  isActive: boolean;
  taxOverride?: Partial<import("@/lib/billing/tax-config").TaxOverrideConfig> | null;
}): MenuVariantView {
  return {
    id: String(doc._id),
    menuItemId: String(doc.menuItemId),
    name: doc.name,
    displayName: doc.displayName,
    pricePaise: doc.price,
    description: doc.description ?? null,
    sku: doc.sku ?? null,
    sizeValue: doc.sizeValue ?? null,
    sizeUnit: doc.sizeUnit ?? null,
    displayOrder: doc.displayOrder,
    isActive: doc.isActive,
    taxOverride: normalizeTaxOverride(doc.taxOverride),
  };
}