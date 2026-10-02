"use client";

import * as React from "react";
import { useCloseOnSuccess } from "@/components/admin/admin-hooks";
import { useActionState, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ServiceKeyPicker } from "@/components/admin/service-key-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { BILLING_CYCLES, PLAN_BILLING_CYCLE_LABELS } from "@/lib/admin/view-labels";
import type { PlanView } from "@/lib/admin/plan-service";
import { BASIC_DEFAULT_SERVICE_KEYS, type ServiceKey } from "@/lib/services/catalog";
import { createPlanAction, updatePlanAction, setPlanActiveAction, type SavePlanState } from "@/actions/admin/plans";

function paiseToRupeesString(paise?: number | null): string {
  return paise == null ? "" : String(Math.round(paise) / 100);
}

function PlanFormBody({
  state,
  defaults,
  serviceKeys,
  onServiceKeysChange,
}: {
  state: SavePlanState;
  serviceKeys: ServiceKey[];
  onServiceKeysChange: (next: ServiceKey[]) => void;
  defaults: {
    name: string;
    description: string;
    price: string;
    billingCycle: string;
    durationDays: string;
    features: string;
    serviceKeys: string[];
    isActive: boolean;
  };
}) {
  const [name, setName] = useState(defaults.name);
  const [description, setDescription] = useState(defaults.description);
  const [price, setPrice] = useState(defaults.price);
  const [billingCycle, setBillingCycle] = useState(defaults.billingCycle);
  const [durationDays, setDurationDays] = useState(defaults.durationDays);
  const [features, setFeatures] = useState(defaults.features);
  const [isActive, setIsActive] = useState(defaults.isActive);

  return (
    <>
      <input type="hidden" name="billingCycle" value={billingCycle} />
      <input type="hidden" name="isActive" value={isActive ? "true" : "false"} />
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="plan-name">Plan name *</Label>
          <Input id="plan-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Silver" />
          {state._errors?.name && <p className="text-sm text-destructive">{state._errors.name[0]}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="plan-desc">Description</Label>
          <Textarea id="plan-desc" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="plan-price">Price (₹/period) *</Label>
            <Input id="plan-price" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="99" inputMode="decimal" />
            <input type="hidden" name="pricePaise" value={String(Math.round(Number(price) * 100) || 0)} />
            {state._errors?.pricePaise && <p className="text-sm text-destructive">{state._errors.pricePaise[0]}</p>}
          </div>
          <div className="grid gap-2">
            <Label>Billing cycle *</Label>
            <Select value={billingCycle} onValueChange={(v) => setBillingCycle(v ?? "")}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BILLING_CYCLES.map((c) => (
                  <SelectItem key={c} value={c}>{PLAN_BILLING_CYCLE_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Duration (days)</Label>
            <Input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} placeholder="30" inputMode="numeric" />
            {durationDays !== "" && <input type="hidden" name="durationDays" value={durationDays} />}
          </div>
        </div>
        <ServiceKeyPicker
          selected={serviceKeys}
          onChange={onServiceKeysChange}
          error={state._errors?.serviceKeys?.[0]}
        />
        <div className="grid gap-2">
          <Label htmlFor="plan-features">Features (one per line)</Label>
          <Textarea id="plan-features" name="features" value={features} onChange={(e) => setFeatures(e.target.value)} rows={4} placeholder={"POS & billing\nMenu management\nReports"} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active plan
        </label>
      </div>
    </>
  );
}

function PlanDialog({
  onOpenChange,
  title,
  description,
  action,
  submitLabel,
  initialState,
  defaults,
}: {
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  action: (prev: SavePlanState, form: FormData) => Promise<SavePlanState>;
  submitLabel: string;
  initialState: SavePlanState;
  defaults: {
    name: string;
    description: string;
    price: string;
    billingCycle: string;
    durationDays: string;
    features: string;
    serviceKeys: string[];
    isActive: boolean;
  };
}) {
  const [state, formAction, pending] = useActionState<SavePlanState, FormData>(action, initialState);
  useCloseOnSuccess(state, onOpenChange);
  const [serviceKeys, setServiceKeys] = useState<ServiceKey[]>(
    (defaults.serviceKeys ?? []) as ServiceKey[]
  );
  // A venue with no Dashboard cannot reach its own landing page, and nothing in
  // the catalog implies DASHBOARD, so the editor blocks the save instead of
  // letting the platform strand itself later.
  const missingDashboard = !serviceKeys.includes("DASHBOARD");
  return (
    <DialogPopup className="sm:max-w-2xl">
      <form action={formAction}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <PlanFormBody
            state={state}
            defaults={defaults}
            serviceKeys={serviceKeys}
            onServiceKeysChange={setServiceKeys}
          />
        </DialogBody>
        <DialogFooter>
          <div className="flex w-full flex-col items-end gap-1">
            {/* The button is inert while Dashboard is unticked, so it says why
                here rather than leaving an unexplained dead Save. */}
            {missingDashboard && (
              <p role="status" className="text-xs text-destructive">
                Tick “Dashboard” to save this plan.
              </p>
            )}
            <Button type="submit" disabled={pending || missingDashboard}>
              {pending && <Loader2 className="animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogPopup>
  );
}

const EMPTY_DEFAULTS = {
  name: "",
  description: "",
  price: "",
  billingCycle: "MONTHLY",
  durationDays: "",
  features: "",
  serviceKeys: [...BASIC_DEFAULT_SERVICE_KEYS],
  isActive: true,
};

export function CreatePlanButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Create plan</Button>
      {open && (
        <PlanDialog
          key="create"
          onOpenChange={setOpen}
          title="Create plan"
          description="Define a subscription plan and its periodic price."
          action={(prev, form) => createPlanAction(form)}
          submitLabel="Create plan"
          initialState={{}}
          defaults={EMPTY_DEFAULTS}
        />
      )}
    </Dialog>
  );
}

export function EditPlanButton({ plan }: { plan: PlanView }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary" size="sm">Edit</Button>
      {open && (
        <PlanDialog
          key={plan.planId}
          onOpenChange={setOpen}
          title={`Edit ${plan.name}`}
          description="Update plan details. Existing subscriptions are not re-priced."
          action={(prev, form) => updatePlanAction(plan.planId, form)}
          submitLabel="Save changes"
          initialState={{}}
          defaults={{
            name: plan.name,
            description: plan.description ?? "",
            price: paiseToRupeesString(plan.pricePaise),
            billingCycle: plan.billingCycle,
            durationDays: plan.durationDays ? String(plan.durationDays) : "",
            features: plan.features.join("\n"),
            serviceKeys: plan.serviceKeys,
            isActive: plan.isActive,
          }}
        />
      )}
    </Dialog>
  );
}

export function TogglePlanActiveButton({ plan }: { plan: PlanView }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={plan.isActive ? "secondary" : "default"}
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => { setPlanActiveAction(plan.planId, !plan.isActive); })}
    >
      {pending && <Loader2 className="animate-spin" />}
      {plan.isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}