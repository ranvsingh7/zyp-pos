import { Suspense } from "react";
import { requireAuth } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { requireRestaurant } from "@/lib/auth/guards";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { normalizeTaxOverride } from "@/lib/billing/tax-config";
import { getRestaurantTaxSettings } from "@/lib/billing/tax-settings";
import type { MenuCategoryView, MenuItemView, MenuVariantView } from "@/lib/menu/types";
import { MenuManager } from "@/components/menu/menu-manager";
import { AppHeaderServer } from "@/components/app-header-server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Menu Management",
};

async function MenuPageContent() {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("MENU", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;

  const [categories, rawItems, rawVariants, taxSettings] = await Promise.all([
    MenuCategoryModel.find({ restaurantId: restaurant.id })
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
    MenuItemModel.find({ restaurantId: restaurant.id })
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
    MenuVariantModel.find({ restaurantId: restaurant.id })
      .sort({ displayOrder: 1 })
      .lean(),
    getRestaurantTaxSettings(restaurant.id),
  ]);

  const variantMap = new Map<string, MenuVariantView[]>();
  for (const v of rawVariants) {
    const itemId = v.menuItemId.toString();
    const view: MenuVariantView = {
      id: v._id.toString(),
      menuItemId: itemId,
      name: v.name,
      displayName: v.displayName,
      pricePaise: v.price,
      description: v.description ?? null,
      sku: v.sku ?? null,
      sizeValue: v.sizeValue ?? null,
      sizeUnit: v.sizeUnit ?? null,
      isActive: v.isActive,
      displayOrder: v.displayOrder,
      taxOverride: normalizeTaxOverride(
        v.taxOverride as Parameters<typeof normalizeTaxOverride>[0]
      ),
    };
    if (!variantMap.has(itemId)) variantMap.set(itemId, []);
    variantMap.get(itemId)!.push(view);
  }

  const categoryViews: MenuCategoryView[] = categories.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    description: c.description ?? null,
    isActive: c.isActive,
    displayOrder: c.displayOrder,
  }));

  const categoryIdByName = new Map(
    categoryViews.map((c) => [c.id, c.name])
  );

  const itemViews: MenuItemView[] = rawItems.map((item) => ({
    id: item._id.toString(),
    categoryId: item.categoryId.toString(),
    categoryName: categoryIdByName.get(item.categoryId.toString()) ?? null,
    name: item.name,
    description: item.description ?? null,
    itemType: item.itemType,
    vegType: item.vegType,
    imageUrl: item.imageUrl ?? null,
    hasVariants: item.hasVariants,
    hsnSacCode: item.hsnSacCode ?? null,
    basePrice: item.basePrice ?? null,
    isAvailable: item.isAvailable,
    isActive: item.isActive,
    displayOrder: item.displayOrder,
    taxOverride: normalizeTaxOverride(
      item.taxOverride as Parameters<typeof normalizeTaxOverride>[0]
    ),
    variants: variantMap.get(item._id.toString()) ?? [],
  }));

  const ownerRoles = ["OWNER", "MANAGER"];
  const canEdit = ownerRoles.includes(auth.role);
  const canToggleAvailability = ["OWNER", "MANAGER", "CASHIER"].includes(auth.role);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer
        userName={auth.fullName}
        restaurantName={restaurant.name}
        restaurantLogoUrl={restaurant.logoUrl}
      />
      <MenuManager
        canEdit={canEdit}
        canToggleAvailability={canToggleAvailability}
        gstEnabled={taxSettings.taxEnabled}
        categories={categoryViews}
        items={itemViews}
      />
    </div>
  );
}

export default async function MenuPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading menu…</div>
        </div>
      }
    >
      <MenuPageContent />
    </Suspense>
  );
}