import { Suspense } from "react";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { TableSectionModel } from "@/models/TableSection";
import { TableManager } from "@/components/tables/table-manager";
import { AppHeaderServer } from "@/components/app-header-server";
import { buildTableView } from "@/lib/tables/view";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Table Management",
};

async function TablesPageContent() {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const service = await requireService("TABLES", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;

  const [rawTables, sections] = await Promise.all([
    RestaurantTableModel.find({ restaurantId: restaurant.id })
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
    TableSectionModel.find({ restaurantId: restaurant.id })
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
  ]);

  const sectionViews = sections.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    displayOrder: s.displayOrder,
    isActive: s.isActive,
  }));

  const tables = rawTables.map((t) =>
    buildTableView(t as never, sectionViews)
  );

  const canEdit = auth.role === "OWNER" || auth.role === "MANAGER";

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer
        userName={auth.fullName}
        restaurantName={restaurant.name}
        restaurantLogoUrl={restaurant.logoUrl}
      />
      <TableManager
        canEdit={canEdit}
        canChangeStatus={["OWNER", "MANAGER", "CASHIER", "WAITER"].includes(
          auth.role
        )}
        sections={sectionViews}
        tables={tables}
      />
    </div>
  );
}

export default async function TablesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">
            Loading tables…
          </div>
        </div>
      }
    >
      <TablesPageContent />
    </Suspense>
  );
}