"use client";

import * as React from "react";
import { useCloseOnSuccess } from "@/components/admin/admin-hooks";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { formatPaise } from "@/lib/menu/prices";
import { businessTypes } from "@/lib/business-types";
import { PLAN_BILLING_CYCLE_LABELS } from "@/lib/admin/view-labels";
import { DEFAULT_TAX_CONFIG, GST_RATE_PRESETS, GST_SCHEME_LABELS } from "@/lib/billing/constants";
import type { PlanView } from "@/lib/admin/plan-service";
import type { RestaurantAdminView } from "@/lib/admin/restaurant-admin-service";
import {
  createRestaurantAction,
  updateRestaurantAction,
  suspendRestaurantAction,
  reactivateRestaurantAction,
  transferRestaurantAction,
  type RestaurantActionState,
} from "@/actions/admin/restaurants";

function StateNote({ state }: { state: RestaurantActionState }) {
  if (!state.message) return null;
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${state.success ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-destructive/10 text-destructive"}`}>
      {state.message}
    </div>
  );
}

function FieldError({ errors }: { errors?: string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-sm text-destructive">{errors[0]}</p>;
}

/* ------------------------------------------------------------------ */
/* Create restaurant (owner + restaurant + subscription)               */
/* ------------------------------------------------------------------ */

export function CreateRestaurantDialog({ plans }: { plans: PlanView[] }) {
  const [state, formAction, pending] = useActionState<RestaurantActionState, FormData>(
    (prev, form) => createRestaurantAction(form),
    {}
  );
  const [open, setOpen] = useState(false);
  const [gstRegistered, setGstRegistered] = useState(false);
  const [businessType, setBusinessType] = useState("");
  const [planId, setPlanId] = useState("");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");

  useCloseOnSuccess(state, setOpen);

  const selectedPlan = plans.find((p) => p.planId === planId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Add restaurant</Button>
      <DialogPopup className="sm:max-w-2xl">
        <form action={formAction} noValidate>
          <DialogHeader>
            <DialogTitle>Add restaurant</DialogTitle>
            <DialogDescription>Creates the restaurant, its OWNER account, and subscription in one go.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <StateNote state={state} />
            <div className="grid gap-5">
              <div>
                <p className="mb-2 text-sm font-medium">Owner account</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label>Full name *</Label>
                    <Input name="ownerFullName" placeholder="Anshul Sharma" />
                    <FieldError errors={state._errors?.ownerFullName} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Email *</Label>
                    <Input name="ownerEmail" type="email" placeholder="owner@example.com" />
                    <FieldError errors={state._errors?.ownerEmail} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Phone</Label>
                    <Input name="ownerPhone" placeholder="9876543210" />
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  <Label>Password *</Label>
                  <Input name="password" type="password" placeholder="Min. 8 characters" />
                  <FieldError errors={state._errors?.password} />
                </div>
              </div>

              <div className="border-t pt-4">
                <p className="mb-2 text-sm font-medium">Restaurant</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Restaurant name *</Label>
                    <Input name="name" placeholder="Curry House" />
                    <FieldError errors={state._errors?.name} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Phone *</Label>
                    <Input name="phone" placeholder="9876543210" />
                    <FieldError errors={state._errors?.phone} />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label>Email</Label>
                    <Input name="email" type="email" placeholder="restaurant@example.com" />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label>Address *</Label>
                    <Input name="address" placeholder="Street address" />
                    <FieldError errors={state._errors?.address} />
                  </div>
                  <div className="grid gap-2">
                    <Label>City *</Label>
                    <Input name="city" placeholder="Mumbai" />
                    <FieldError errors={state._errors?.city} />
                  </div>
                  <div className="grid gap-2">
                    <Label>State *</Label>
                    <Input name="state" placeholder="Maharashtra" />
                    <FieldError errors={state._errors?.state} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Pincode *</Label>
                    <Input name="pincode" placeholder="400001" />
                    <FieldError errors={state._errors?.pincode} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Business type *</Label>
                    <Select value={businessType} onValueChange={(v) => setBusinessType(v ?? "")}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {businessTypes.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input type="hidden" name="businessType" value={businessType} />
                    <FieldError errors={state._errors?.businessType} />
                  </div>
                  <div className="grid gap-2">
                    <Label>GST registered?</Label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setGstRegistered(true)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${gstRegistered ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"}`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setGstRegistered(false)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${!gstRegistered ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"}`}
                      >
                        No
                      </button>
                      <input type="hidden" name="gstRegistered" value={gstRegistered ? "true" : "false"} />
                    </div>
                  </div>
                  {gstRegistered && (
                    <div className="grid gap-2 sm:col-span-2">
                      <Label>GSTIN</Label>
                      <Input name="gstin" placeholder="22AAAAA0000A1Z5" />
                      <FieldError errors={state._errors?.gstin} />
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <p className="mb-2 text-sm font-medium">Subscription</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Plan</Label>
                    <Select value={planId} onValueChange={(v) => setPlanId(v ?? "")}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select plan" /></SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.planId} value={p.planId}>
                            {p.name} · {formatPaise(p.pricePaise)}/{PLAN_BILLING_CYCLE_LABELS[p.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input type="hidden" name="planId" value={planId} />
                    <FieldError errors={state._errors?.planId} />
                  </div>
                  {/* Duration, grace period and price come from the plan; a free
                      plan is what makes the subscription a trial. */}
                  <div className="rounded-md border bg-muted/40 p-3 text-sm sm:col-span-2">
                    {selectedPlan ? (
                      <div className="grid gap-1">
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Price</span>
                          <span>
                            {selectedPlan.isFree
                              ? "Free"
                              : formatPaise(selectedPlan.pricePaise)}{" "}
                            /{PLAN_BILLING_CYCLE_LABELS[selectedPlan.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS]}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Duration</span>
                          <span>{selectedPlan.durationDays} days</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Grace period</span>
                          <span>{selectedPlan.gracePeriodDays} days</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Status</span>
                          <span>{selectedPlan.isFree ? "Trial (free plan)" : "Active"}</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Select a plan to see its terms.</span>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label>Discount (₹)</Label>
                    <Input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" inputMode="decimal" />
                    {discount !== "" && <input type="hidden" name="discountAmountPaise" value={String(Math.round(Number(discount) * 100))} />}
                  </div>
                  <div className="grid gap-2">
                    <Label>Notes</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
                    <input type="hidden" name="notes" value={notes} />
                  </div>
                </div>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Create restaurant
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Edit restaurant                                                     */
/* ------------------------------------------------------------------ */

export function EditRestaurantDialog({ restaurant }: { restaurant: RestaurantAdminView }) {
  const [state, formAction, pending] = useActionState<RestaurantActionState, FormData>(
    (prev, form) => updateRestaurantAction(restaurant.id, form),
    {}
  );
  const [open, setOpen] = useState(false);
  const [gstRegistered, setGstRegistered] = useState(restaurant.gstRegistered);
  const [businessType, setBusinessType] = useState(restaurant.businessType);

  const tax = restaurant.taxSettings;
  const [taxEnabled, setTaxEnabled] = useState(tax?.taxEnabled ?? DEFAULT_TAX_CONFIG.taxEnabled);
  const taxLocked = !gstRegistered;
  const submittedTaxEnabled = taxLocked ? false : taxEnabled;
  const [taxInclusive, setTaxInclusive] = useState(tax?.taxInclusive ?? false);
  const [gstScheme, setGstScheme] = useState(tax?.gstScheme ?? "INTRA_STATE");
  const initialRate = tax?.defaultTaxRate ?? DEFAULT_TAX_CONFIG.defaultTaxRate;
  const [ratePreset, setRatePreset] = useState(
    (GST_RATE_PRESETS as readonly number[]).includes(initialRate) ? String(initialRate) : "custom"
  );
  const [defaultTaxRate, setDefaultTaxRate] = useState(String(initialRate));
  const [cgstRate, setCgstRate] = useState(String(tax?.cgstRatePercent ?? DEFAULT_TAX_CONFIG.cgstRatePercent));
  const [sgstRate, setSgstRate] = useState(String(tax?.sgstRatePercent ?? DEFAULT_TAX_CONFIG.sgstRatePercent));
  const [igstRate, setIgstRate] = useState(String(tax?.igstRatePercent ?? DEFAULT_TAX_CONFIG.igstRatePercent));

  useCloseOnSuccess(state, setOpen);

  function applyPreset(value: string | null) {
    if (!value) return;
    setRatePreset(value);
    if (value === "custom") return;
    const rate = Number(value);
    setDefaultTaxRate(value);
    setCgstRate(String(rate / 2));
    setSgstRate(String(rate / 2));
    setIgstRate(value);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary">Edit details</Button>
      <DialogPopup className="sm:max-w-2xl">
        <form action={formAction} noValidate>
          <DialogHeader>
            <DialogTitle>Edit restaurant</DialogTitle>
            <DialogDescription>{restaurant.name}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <StateNote state={state} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input name="name" defaultValue={restaurant.name} />
                <FieldError errors={state._errors?.name} />
              </div>
              <div className="grid gap-2">
                <Label>Phone</Label>
                <Input name="phone" defaultValue={restaurant.phone} />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input name="email" type="email" defaultValue={restaurant.email ?? ""} />
              </div>
              <div className="grid gap-2">
                <Label>Address</Label>
                <Input name="address" defaultValue={restaurant.address} />
              </div>
              <div className="grid gap-2">
                <Label>City</Label>
                <Input name="city" defaultValue={restaurant.city} />
              </div>
              <div className="grid gap-2">
                <Label>State</Label>
                <Input name="state" defaultValue={restaurant.state} />
              </div>
              <div className="grid gap-2">
                <Label>Pincode</Label>
                <Input name="pincode" defaultValue={restaurant.pincode} />
              </div>
              <div className="grid gap-2">
                <Label>Business type</Label>
                <Select value={businessType} onValueChange={(v) => setBusinessType(v ?? "")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {businessTypes.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="businessType" value={businessType} />
              </div>
              <div className="grid gap-2">
                <Label>GST registered?</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setGstRegistered(true)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${gstRegistered ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"}`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGstRegistered(false);
                      setTaxEnabled(false);
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${!gstRegistered ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"}`}
                  >
                    No
                  </button>
                  <input type="hidden" name="gstRegistered" value={gstRegistered ? "true" : "false"} />
                </div>
              </div>
              {gstRegistered && (
                <div className="grid gap-2 sm:col-span-2">
                  <Label>GSTIN</Label>
                  <Input name="gstin" defaultValue={restaurant.gstin ?? ""} />
                  <FieldError errors={state._errors?.gstin} />
                </div>
              )}
              <div className="grid gap-2 sm:col-span-2">
                <Label>Reason for change</Label>
                <Input name="reason" placeholder="Optional" />
              </div>
            </div>

            <div className="mt-5 border-t pt-4">
              <p className="mb-1 text-sm font-medium">Tax configuration</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Applies to new bills for this restaurant. Existing bills keep their snapshots.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Tax enabled?</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTaxEnabled(true)}
                      disabled={taxLocked}
                      className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${taxEnabled ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"} ${taxLocked ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaxEnabled(false)}
                      disabled={taxLocked}
                      className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${!taxEnabled ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"} ${taxLocked ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      No
                    </button>
                    <input type="hidden" name="taxEnabled" value={submittedTaxEnabled ? "true" : "false"} />
                  </div>
                  {taxLocked && (
                    <p className="text-xs text-muted-foreground">
                      GST registration is required to enable GST.
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>GST scheme</Label>
                  <Select value={gstScheme} onValueChange={(v) => setGstScheme(v ?? "INTRA_STATE")}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INTRA_STATE">{GST_SCHEME_LABELS.INTRA_STATE}</SelectItem>
                      <SelectItem value="INTER_STATE">{GST_SCHEME_LABELS.INTER_STATE}</SelectItem>
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="gstScheme" value={gstScheme} />
                </div>
                <div className="grid gap-2">
                  <Label>Default rate preset</Label>
                  <Select value={ratePreset} onValueChange={applyPreset}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GST_RATE_PRESETS.map((r) => (
                        <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                      ))}
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Default tax rate (%)</Label>
                  <Input
                    name="defaultTaxRate"
                    value={defaultTaxRate}
                    onChange={(e) => {
                      setDefaultTaxRate(e.target.value);
                      setRatePreset("custom");
                    }}
                    inputMode="decimal"
                    placeholder="5"
                  />
                  <FieldError errors={state._errors?.defaultTaxRate} />
                </div>
                <div className="grid gap-2">
                  <Label>CGST (%)</Label>
                  <Input name="cgstRatePercent" value={cgstRate} onChange={(e) => setCgstRate(e.target.value)} inputMode="decimal" />
                  <FieldError errors={state._errors?.cgstRatePercent} />
                </div>
                <div className="grid gap-2">
                  <Label>SGST (%)</Label>
                  <Input name="sgstRatePercent" value={sgstRate} onChange={(e) => setSgstRate(e.target.value)} inputMode="decimal" />
                  <FieldError errors={state._errors?.sgstRatePercent} />
                </div>
                <div className="grid gap-2">
                  <Label>IGST (%)</Label>
                  <Input name="igstRatePercent" value={igstRate} onChange={(e) => setIgstRate(e.target.value)} inputMode="decimal" />
                  <FieldError errors={state._errors?.igstRatePercent} />
                </div>
                <div className="grid gap-2">
                  <Label>Tax inclusive prices?</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTaxInclusive(true)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${taxInclusive ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaxInclusive(false)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium ring-1 transition-colors ${!taxInclusive ? "bg-primary text-primary-foreground ring-primary" : "bg-background text-muted-foreground ring-border"}`}
                    >
                      No
                    </button>
                    <input type="hidden" name="taxInclusive" value={taxInclusive ? "true" : "false"} />
                  </div>
                </div>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Suspend / reactivate                                                */
/* ------------------------------------------------------------------ */

function ConfirmRestaurantAction({
  trigger,
  title,
  description,
  confirmLabel,
  variant = "destructive",
  run,
}: {
  trigger: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "destructive" | "secondary";
  run: (prev: RestaurantActionState, form: FormData) => Promise<RestaurantActionState>;
}) {
  const [state, formAction, pending] = useActionState<RestaurantActionState, FormData>(run, {});
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  useCloseOnSuccess(state, setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary" className={variant === "destructive" ? "text-destructive" : ""}>
        {trigger}
      </Button>
      <DialogPopup className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <StateNote state={state} />
            <div className="grid gap-2">
              <Label htmlFor={`res-reason-${title}`}>Reason</Label>
              <Textarea id={`res-reason-${title}`} value={reason} onChange={(e) => setReason(e.target.value)} name="reason" rows={3} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" variant={variant} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function SuspendRestaurantDialog({ restaurant }: { restaurant: RestaurantAdminView }) {
  return (
    <ConfirmRestaurantAction
      trigger="Suspend"
      title="Suspend restaurant"
      description={`Block access for ${restaurant.name} immediately.`}
      confirmLabel="Suspend restaurant"
      run={(prev, form) => {
        const fd = new FormData();
        fd.set("reason", String(form.get("reason") ?? ""));
        return suspendRestaurantAction(restaurant.id, fd.get("reason")?.toString() ?? undefined);
      }}
    />
  );
}

export function ReactivateRestaurantDialog({ restaurant }: { restaurant: RestaurantAdminView }) {
  return (
    <ConfirmRestaurantAction
      trigger="Reactivate"
      title="Reactivate restaurant"
      description={`Restore access for ${restaurant.name}.`}
      confirmLabel="Reactivate restaurant"
      variant="secondary"
      run={(prev, form) => {
        const fd = new FormData();
        fd.set("reason", String(form.get("reason") ?? ""));
        return reactivateRestaurantAction(restaurant.id, fd.get("reason")?.toString() ?? undefined);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Transfer ownership                                                  */
/* ------------------------------------------------------------------ */

export function TransferRestaurantDialog({ restaurant }: { restaurant: RestaurantAdminView }) {
  const [state, formAction, pending] = useActionState<RestaurantActionState, FormData>(
    (prev, form) => transferRestaurantAction(restaurant.id, String(form.get("newOwnerEmail") ?? "")),
    {}
  );
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  useCloseOnSuccess(state, setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary">Transfer ownership</Button>
      <DialogPopup className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Transfer ownership</DialogTitle>
            <DialogDescription>Target must be an existing platform user account.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <StateNote state={state} />
            <div className="grid gap-2">
              <Label>New owner email *</Label>
              <Input name="newOwnerEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending || !email.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}