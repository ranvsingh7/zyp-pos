import type { TaxOverrideConfig } from "@/lib/billing/tax-config";

export interface MenuCategoryView {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface MenuVariantView {
  id: string;
  menuItemId: string;
  name: string;
  displayName: string;
  pricePaise: number;
  description: string | null;
  sku: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  displayOrder: number;
  isActive: boolean;
  taxOverride: TaxOverrideConfig;
}

export interface MenuItemView {
  id: string;
  categoryId: string;
  categoryName: string | null;
  name: string;
  description: string | null;
  itemType: string;
  vegType: string;
  imageUrl: string | null;
  hasVariants: boolean;
  /**
   * Optional restaurant-entered HSN/SAC code, snapshotted onto orders and bills.
   * Null for items that never had one configured (and for all non-GST venues,
   * where the field is neither shown nor required).
   */
  hsnSacCode: string | null;
  basePrice: number | null;
  isAvailable: boolean;
  isActive: boolean;
  displayOrder: number;
  taxOverride: TaxOverrideConfig;
  variants: MenuVariantView[];
}