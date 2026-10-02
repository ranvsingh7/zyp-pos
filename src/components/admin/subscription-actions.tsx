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
import { PLAN_BILLING_CYCLE_LABELS } from "@/lib/admin/view-labels";
import type { SubscriptionView } from "@/lib/admin/subscription-service";
import type { PlanView } from "@/lib/admin/plan-service";
import {
  createSubscriptionAction,
  renewSubscriptionAction,
  changeSubscriptionPlanAction,
  changeSubscriptionPricingAction,
  extendSubscriptionExpiryAction,
  suspendSubscriptionAction,
  reactivateSubscriptionAction,
  cancelSubscriptionAction,
  type SubscriptionActionState,
} from "@/actions/admin/subscriptions";
import { recordPaymentAction, type PaymentActionState } from "@/actions/admin/payments";

function paiseToRupeesString(paise?: number | null): string {
  return paise == null ? "" : String(Math.round(paise) / 100);
}

function toDateInputValue(value?: Date | string | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function toDateTimeIso(dateInput: string): string {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function StateNote({ state }: { state: { message?: string; success?: boolean } | null }) {
  if (!state?.message) return null;
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

function useDialogState(action: (form: FormData) => Promise<SubscriptionActionState>) {
  return useActionState<SubscriptionActionState, FormData>((prev, form) => action(form), {});
}

/* ------------------------------------------------------------------ */
/* Create (first) subscription                                          */
/* ------------------------------------------------------------------ */

export function CreateSubscriptionDialog({
  restaurantId,
  restaurantName,
  plans,
}: {
  restaurantId: string;
  restaurantName: string;
  plans: PlanView[];
}) {
  const [state, formAction, pending] = useDialogState(createSubscriptionAction);
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [discount, setDiscount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  useCloseOnSuccess(state, setOpen);

  const selectedPlan = plans.find((p) => p.planId === planId);

  // The plan Select is a Base UI composite, not a native <select>, so it
  // contributes nothing to FormData. Without the hidden input below the
  // selection existed only in React state, `formData.get("planId")` came back
  // as null and createSubscriptionSchema rejected it with
  // "expected string, received null".
  //
  // The guard covers the one path the disabled submit button cannot: pressing
  // Enter in a text field submits the form without a plan chosen.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (planId !== "") return;
    event.preventDefault();
    setPlanError("Please select a plan");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Create subscription</Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction} onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create subscription</DialogTitle>
            <DialogDescription>{restaurantName} · {formatPaise(selectedPlan?.pricePaise ?? 0)}/{PLAN_BILLING_CYCLE_LABELS[selectedPlan?.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS] ?? "…"}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <input type="hidden" name="planId" value={planId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Plan *</Label>
                <Select
                  value={planId}
                  onValueChange={(v) => {
                    setPlanId(v ?? "");
                    setPlanError(null);
                  }}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select plan" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.planId} value={p.planId}>
                        {p.name} · {formatPaise(p.pricePaise)}/{PLAN_BILLING_CYCLE_LABELS[p.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={planError ? [planError] : state._errors?.planId} />
              </div>

              {/* Duration, grace period and the amount charged all come from the
                  plan, so they are shown rather than typed. Only the discount is
                  an admin decision. */}
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
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
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                {toDateTimeIso(startDate) !== "" && <input type="hidden" name="startDate" value={toDateTimeIso(startDate)} />}
              </div>

              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>

              <div className="grid gap-2">
                <Label>Reason</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending || !planId}>
              {pending && <Loader2 className="animate-spin" />}
              Create subscription
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Renewal                                                             */
/* ------------------------------------------------------------------ */

export function RenewSubscriptionDialog({
  restaurantId,
  restaurantName,
  subscription,
  plans,
}: {
  restaurantId: string;
  restaurantName: string;
  subscription: SubscriptionView;
  plans: PlanView[];
}) {
  const [state, formAction, pending] = useDialogState(renewSubscriptionAction);
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(subscription.planId);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  useCloseOnSuccess(state, setOpen);

  const selectedPlan = plans.find((p) => p.planId === planId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary">Renew</Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Renew subscription</DialogTitle>
            <DialogDescription>{restaurantName}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Plan</Label>
                <Select value={planId} onValueChange={(v) => setPlanId(v ?? "")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.planId} value={p.planId}>
                        {p.name} · {formatPaise(p.pricePaise)}/{PLAN_BILLING_CYCLE_LABELS[p.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="planId" value={planId} />
              </div>

              {/* The renewed term is dated and priced by the plan; the only
                  admin inputs are the plan and an optional discount. */}
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                {selectedPlan ? (
                  <div className="grid gap-1">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">New term</span>
                      <span>{selectedPlan.durationDays} days</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Grace period</span>
                      <span>{selectedPlan.gracePeriodDays} days</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Price</span>
                      <span>
                        {selectedPlan.isFree
                          ? "Free"
                          : formatPaise(selectedPlan.pricePaise)}{" "}
                        /{PLAN_BILLING_CYCLE_LABELS[selectedPlan.billingCycle as keyof typeof PLAN_BILLING_CYCLE_LABELS]}
                      </span>
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
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              <div className="grid gap-2">
                <Label>Reason</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Renew
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Change plan                                                         */
/* ------------------------------------------------------------------ */

export function ChangePlanDialog({
  restaurantId,
  subscription,
  plans,
}: {
  restaurantId: string;
  subscription: SubscriptionView;
  plans: PlanView[];
}) {
  const [state, formAction, pending] = useDialogState(changeSubscriptionPlanAction);
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState("");

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary">Change plan</Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>{subscription.restaurantName} · currently {subscription.planName}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>New plan *</Label>
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
                <FieldError errors={state._errors?.planId} />
              </div>
              <div className="grid gap-2">
                <Label>Discount (₹)</Label>
                <Input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" inputMode="decimal" />
                {discount !== "" && <input type="hidden" name="discountAmountPaise" value={String(Math.round(Number(discount) * 100))} />}
              </div>
              <p className="text-xs text-muted-foreground">
                Switching plans re-prices the subscription from the new plan. The current
                expiry date is kept; the new duration and grace period apply from the
                next renewal.
              </p>
              <div className="grid gap-2">
                <Label>Reason</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending || !planId}>
              {pending && <Loader2 className="animate-spin" />}
              Change plan
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Change pricing                                                      */
/* ------------------------------------------------------------------ */

export function ChangePricingDialog({
  restaurantId,
  subscription,
}: {
  restaurantId: string;
  subscription: SubscriptionView;
}) {
  const [state, formAction, pending] = useDialogState(changeSubscriptionPricingAction);
  const [open, setOpen] = useState(false);
  const [discount, setDiscount] = useState(paiseToRupeesString(subscription.discountAmountPaise));
  const [reason, setReason] = useState("");

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary">Edit discount</Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Edit discount</DialogTitle>
            <DialogDescription>{subscription.restaurantName}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="grid gap-1">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Plan price</span>
                    <span>{subscription.isFree ? "Free" : formatPaise(subscription.listPricePaise)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Current discount</span>
                    <span>{formatPaise(subscription.discountAmountPaise)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Current final</span>
                    <span>{formatPaise(subscription.finalPricePaise)}</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Discount (₹)</Label>
                <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
                {discount !== "" && <input type="hidden" name="discountAmountPaise" value={String(Math.round(Number(discount) * 100))} />}
              </div>
              <div className="grid gap-2">
                <Label>Reason</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
              <p className="text-xs text-muted-foreground">
                The amount charged is always the plan price minus this discount. To change
                the price itself, edit the plan.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save discount
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Extend expiry                                                       */
/* ------------------------------------------------------------------ */

export function ExtendExpiryDialog({
  restaurantId,
  subscription,
}: {
  restaurantId: string;
  subscription: SubscriptionView;
}) {
  const [state, formAction, pending] = useDialogState(extendSubscriptionExpiryAction);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");
  const [newDate, setNewDate] = useState("");
  const [reason, setReason] = useState("");

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary">Extend expiry</Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Extend expiry</DialogTitle>
            <DialogDescription>Current expiry: {toDateInputValue(subscription.expiryDate)}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Add days</Label>
                <Input value={days} onChange={(e) => setDays(e.target.value)} placeholder="30" inputMode="numeric" />
                {days !== "" && <input type="hidden" name="days" value={days} />}
              </div>
              <div className="grid gap-2">
                <Label>Or set new expiry date</Label>
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                {toDateTimeIso(newDate) !== "" && <input type="hidden" name="newExpiryDate" value={toDateTimeIso(newDate)} />}
              </div>
              <div className="grid gap-2">
                <Label>Reason</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Extend
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Action with reason (suspend / reactivate / cancel)                  */
/* ------------------------------------------------------------------ */

function ReasonActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  action,
}: {
  trigger: string;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive" | "secondary";
  action: (form: FormData) => Promise<SubscriptionActionState>;
}) {
  const [state, formAction, pending] = useDispatchAction(action);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary" className={confirmVariant === "destructive" ? "text-destructive" : ""}>
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
              <Label htmlFor={`reason-${title}`}>Reason</Label>
              <Textarea id={`reason-${title}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} name="reason" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" variant={confirmVariant} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function useDispatchAction(action: (form: FormData) => Promise<SubscriptionActionState>) {
  return useActionState<SubscriptionActionState, FormData>((prev, form) => action(form), {});
}

/* Approved: explicit suspend/reactivate/cancel dialogs */
export function SuspendActionDialog({ restaurantId, restaurantName }: { restaurantId: string; restaurantName: string }) {
  return (
    <ReasonActionDialog
      trigger="Suspend"
      title="Suspend subscription"
      description={`Block access for ${restaurantName}. This does not delete any data.`}
      confirmLabel="Suspend"
      confirmVariant="destructive"
      action={(form) => {
        const fd = new FormData();
        fd.set("restaurantId", restaurantId);
        fd.set("reason", String(form.get("reason") ?? ""));
        return suspendSubscriptionAction(fd);
      }}
    />
  );
}

export function ReactivateActionDialog({ restaurantId, restaurantName }: { restaurantId: string; restaurantName: string }) {
  return (
    <ReasonActionDialog
      trigger="Reactivate"
      title="Reactivate subscription"
      description={`Restore access for ${restaurantName}.`}
      confirmLabel="Reactivate"
      action={(form) => {
        const fd = new FormData();
        fd.set("restaurantId", restaurantId);
        fd.set("reason", String(form.get("reason") ?? ""));
        return reactivateSubscriptionAction(fd);
      }}
    />
  );
}

export function CancelActionDialog({ restaurantId, restaurantName }: { restaurantId: string; restaurantName: string }) {
  return (
    <ReasonActionDialog
      trigger="Cancel"
      title="Cancel subscription"
      description={`Cancel the subscription for ${restaurantName}. Access is blocked once cancelled.`}
      confirmLabel="Cancel subscription"
      confirmVariant="destructive"
      action={(form) => {
        const fd = new FormData();
        fd.set("restaurantId", restaurantId);
        fd.set("reason", String(form.get("reason") ?? ""));
        return cancelSubscriptionAction(fd);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Record payment                                                      */
/* ------------------------------------------------------------------ */

export function RecordPaymentDialog({
  restaurantId,
  subscriptionId,
}: {
  restaurantId: string;
  subscriptionId: string;
}) {
  const [state, formAction, pending] = useActionState<PaymentActionState, FormData>(
    (prev, form) => recordPaymentAction(form),
    {}
  );
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Record payment</Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Generates an invoice number automatically.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Amount (₹) *</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
                <input type="hidden" name="amountPaise" value={String(Math.round(Number(amount) * 100) || 0)} />
                <FieldError errors={state._errors?.amountPaise} />
              </div>
              <div className="grid gap-2">
                <Label>Payment method *</Label>
                <Select value={method} onValueChange={(v) => setMethod(v ?? "")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["UPI", "BANK_TRANSFER", "CASH", "CARD", "OTHER"].map((m) => (
                      <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="paymentMethod" value={method} />
              </div>
              <div className="grid gap-2">
                <Label>Transaction reference</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                {reference !== "" && <input type="hidden" name="transactionReference" value={reference} />}
              </div>
              <div className="grid gap-2">
                <Label>Paid at</Label>
                <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                {toDateTimeIso(paidAt) !== "" && <input type="hidden" name="paidAt" value={toDateTimeIso(paidAt)} />}
              </div>
              <div className="grid gap-2">
                <Label>Note</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending || amount === ""}>
              {pending && <Loader2 className="animate-spin" />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Aggregate subscription action bar per status                        */
/* ------------------------------------------------------------------ */

export function SubscriptionActions({
  restaurantId,
  restaurantName,
  subscription,
  plans,
}: {
  restaurantId: string;
  restaurantName: string;
  subscription: SubscriptionView | null;
  plans: PlanView[];
}) {
  const status = subscription?.status;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!subscription && <CreateSubscriptionDialog restaurantId={restaurantId} restaurantName={restaurantName} plans={plans} />}
      {subscription && (
        <>
          <RenewSubscriptionDialog restaurantId={restaurantId} restaurantName={restaurantName} subscription={subscription} plans={plans} />
          {status !== "CANCELLED" && <ChangePlanDialog restaurantId={restaurantId} subscription={subscription} plans={plans} />}
          {status !== "CANCELLED" && <ChangePricingDialog restaurantId={restaurantId} subscription={subscription} />}
          <ExtendExpiryDialog restaurantId={restaurantId} subscription={subscription} />
          <RecordPaymentDialog restaurantId={restaurantId} subscriptionId={subscription.subscriptionId} />
          {status !== "SUSPENDED" && status !== "CANCELLED" && <SuspendActionDialog restaurantId={restaurantId} restaurantName={restaurantName} />}
          {status === "SUSPENDED" && <ReactivateActionDialog restaurantId={restaurantId} restaurantName={restaurantName} />}
          {status !== "CANCELLED" && <CancelActionDialog restaurantId={restaurantId} restaurantName={restaurantName} />}
        </>
      )}
    </div>
  );
}