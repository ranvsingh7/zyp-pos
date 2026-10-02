import { Suspense } from "react";
import type { Metadata } from "next";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { getSettingsSnapshot } from "@/lib/settings/settings-service";
import { canManageSettings } from "@/lib/settings/permissions";
import { AppHeaderServer } from "@/components/app-header-server";
import { SettingsSubnav } from "@/components/settings/settings-subnav";
import { SettingsManager } from "@/components/settings/settings-manager";

export const metadata: Metadata = {
  title: "Settings",
};

async function SettingsPageContent() {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();
  const snapshot = await getSettingsSnapshot(String(restaurant.id));

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Restaurant profile, tax, billing and branding. Changes apply to new bills only —
            existing bills keep the values they were generated with.
          </p>
        </div>
        <SettingsSubnav />
        <SettingsManager
          snapshot={snapshot}
          canEdit={canManageSettings(auth.role)}
          gstRegistered={snapshot.restaurant.gstRegistered}
        />
      </main>
    </div>
  );
}

export default async function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading settings…</div>
        </div>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}
