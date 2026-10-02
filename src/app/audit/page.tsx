import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeaderServer } from "@/components/app-header-server";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { requireService } from "@/lib/services/service-gate";
import { assertCanViewAuditLogs } from "@/lib/audit/permissions";
import {
  listAuditLogs,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES_LIST,
} from "@/lib/audit/audit-service";
import { AuditLogViewer } from "@/components/audit/audit-log-viewer";
import { connectDB } from "@/lib/db";
import { UserModel } from "@/models/User";

export const metadata: Metadata = {
  title: "Audit Logs | ZYP POS",
};

async function AuditContent() {
  const auth = await requireAuth();
  const restaurant = await requireRestaurant();

  // Subscription entitlement is decided before role permission: a venue whose
  // plan excludes AUDIT must not be able to reach the page with an OWNER
  // account any more than a venue that is not on the plan at all. The
  // SUPER_ADMIN bypass lives inside the gate, so the platform audit under
  // /admin is untouched.
  const service = await requireService("AUDIT", {
    userName: auth.fullName,
    restaurantName: restaurant.name,
    restaurantLogoUrl: restaurant.logoUrl,
  });
  if (!service.allowed) return service.page;

  try {
    assertCanViewAuditLogs(auth.role);
  } catch {
    redirect("/dashboard");
  }

  await connectDB();
  const staff = await UserModel.find({ restaurantId: restaurant.id })
    .select("_id fullName role")
    .sort({ fullName: 1 })
    .lean();

  const initial = await listAuditLogs(String(restaurant.id), {}, { page: 1, pageSize: 25 });

  return (
    <div className="min-h-screen bg-background">
      <AppHeaderServer userName={auth.fullName} restaurantName={restaurant.name} restaurantLogoUrl={restaurant.logoUrl} />
      <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-10 sm:px-6">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Audit Logs
          </h1>
          <p className="text-sm text-muted-foreground">
            Append-only evidence of every sensitive action in {restaurant.name}.
            Logs cannot be edited or deleted; only owners and managers can
            review or export them.
          </p>
        </div>

        <AuditLogViewer
          initial={initial}
          actions={[...AUDIT_ACTIONS]}
          resourceTypes={[...AUDIT_ENTITY_TYPES_LIST]}
          staff={staff.map((u) => ({
            id: String(u._id),
            fullName: u.fullName,
            role: String(u.role),
          }))}
        />
      </main>
    </div>
  );
}

export default async function AuditPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading audit logs…</div>
        </div>
      }
    >
      <AuditContent />
    </Suspense>
  );
}