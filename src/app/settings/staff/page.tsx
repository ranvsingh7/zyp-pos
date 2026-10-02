import { Suspense } from "react";
import type { Metadata } from "next";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { listStaff } from "@/lib/staff/staff-service";
import { canManageStaff } from "@/lib/staff/permissions";
import { staffListQuerySchema } from "@/lib/staff/validation";
import { AppHeaderServer } from "@/components/app-header-server";
import { SettingsSubnav } from "@/components/settings/settings-subnav";
import { StaffManager } from "@/components/settings/staff-manager";

export const metadata: Metadata = {
  title: "Staff",
};

async function StaffPageContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const params = await searchParams;

  const raw = {
    search: typeof params.search === "string" ? params.search : undefined,
    role: typeof params.role === "string" ? params.role : undefined,
    isActive: typeof params.status === "string" ? params.status : undefined,
  };
  // An unrecognised filter falls back to "no filter" rather than erroring, so a
  // hand-edited URL still renders the list.
  const parsed = staffListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : {};

  const result = await listStaff(String(restaurant.id), query);
  const canEdit = canManageStaff(auth.role);

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer
        userName={auth.fullName}
        restaurantName={restaurant.name}
        restaurantLogoUrl={restaurant.logoUrl}
      />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="text-sm text-muted-foreground">
            People who can sign in to {restaurant.name}. Each account only ever sees this
            restaurant&apos;s data.
          </p>
        </div>
        <SettingsSubnav />
        <StaffManager
          result={result}
          canEdit={canEdit}
          currentUserId={auth.id}
          isOwnerRole={auth.role === "OWNER"}
          filters={{
            search: raw.search ?? "",
            role: query.role ?? "",
            status: query.isActive ?? "",
          }}
        />
      </main>
    </div>
  );
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading staff…</div>
        </div>
      }
    >
      <StaffPageContent searchParams={searchParams} />
    </Suspense>
  );
}
