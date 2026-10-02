import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/admin-common";
import { CreatePlanButton, EditPlanButton, TogglePlanActiveButton } from "@/components/admin/plan-actions";
import { listPlans } from "@/lib/admin/plan-service";
import { formatPaise } from "@/lib/menu/prices";
import { PLAN_BILLING_CYCLE_LABELS } from "@/lib/admin/view-labels";
import { ServiceKeyList } from "@/components/service-key-list";

export default async function AdminPlansPage() {
  const plans = await listPlans({ includeInactive: true });

  return (
    <>
      <PageHeader
        title="Plans"
        description="Subscription plans offered to restaurants."
        actions={<CreatePlanButton />}
      />

      {plans.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <p className="text-center text-sm text-muted-foreground">No plans yet. Create your first plan.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.planId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {plan.name}
                      {plan.isActive && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Active</Badge>}
                      {!plan.isActive && <Badge className="bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Inactive</Badge>}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.description ?? `Every ${PLAN_BILLING_CYCLE_LABELS[plan.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS]?.toLowerCase() ?? plan.billingCycle.toLowerCase()} period`}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="font-heading text-2xl font-semibold">
                  {formatPaise(plan.pricePaise)}
                  <span className="text-sm font-normal text-muted-foreground"> / {PLAN_BILLING_CYCLE_LABELS[plan.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS]?.toLowerCase() ?? plan.billingCycle.toLowerCase()}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Duration: {plan.durationDays} days</p>
                {/* The service set is what is actually enforced, so it is what
                    a Super Admin needs to see here. `features` stays as
                    marketing copy below. */}
                {plan.serviceKeys.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                      Services included
                    </p>
                    <ServiceKeyList serviceKeys={plan.serviceKeys} />
                  </div>
                )}
                {plan.features.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {plan.features.slice(0, 6).map((f, i) => (
                      <li key={i} className="flex gap-2"><span className="text-emerald-600">•</span><span>{f}</span></li>
                    ))}
                    {plan.features.length > 6 && <li className="text-xs">+{plan.features.length - 6} more</li>}
                  </ul>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <EditPlanButton plan={plan} />
                  <TogglePlanActiveButton plan={plan} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}