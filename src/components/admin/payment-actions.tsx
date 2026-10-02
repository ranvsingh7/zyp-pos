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
import type { PaymentView } from "@/lib/admin/payment-service";
import { updatePaymentAction, refundPaymentAction, type PaymentActionState } from "@/actions/admin/payments";
import { recordPaymentAction } from "@/actions/admin/payments";
import { PAYMENT_METHODS, SUBSCRIPTION_PAYMENT_METHOD_LABELS } from "@/lib/admin/view-labels";

function paiseToRupeesString(paise?: number | null): string {
  return paise == null ? "" : String(Math.round(paise) / 100);
}

function toDateInputValue(value?: Date | string | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function toDateTimeIso(dateInput: string): string {
  return dateInput ? new Date(dateInput).toISOString() : "";
}

function StateNote({ state }: { state: PaymentActionState }) {
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

export function EditPaymentDialog({ payment }: { payment: PaymentView }) {
  const [state, formAction, pending] = useActionState<PaymentActionState, FormData>(
    (prev, form) => updatePaymentAction(form),
    {}
  );
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(paiseToRupeesString(payment.amountPaise));
  const [method, setMethod] = useState(payment.paymentMethod);
  const [reference, setReference] = useState(payment.transactionReference ?? "");
  const [status, setStatus] = useState(payment.status);
  const [paidAt, setPaidAt] = useState(toDateInputValue(payment.paidAt));
  const [note, setNote] = useState(payment.note ?? "");

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary" size="sm">Edit</Button>
      <DialogPopup className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Edit payment</DialogTitle>
            <DialogDescription>{payment.invoiceNumber} · {payment.restaurantName}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="paymentId" value={payment.paymentId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Amount (₹)</Label>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                  {amount !== "" && <input type="hidden" name="amountPaise" value={String(Math.round(Number(amount) * 100))} />}
                </div>
                <div className="grid gap-2">
                  <Label>Method</Label>
<Select value={method} onValueChange={(v) => setMethod(v ?? "UPI")}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{SUBSCRIPTION_PAYMENT_METHOD_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="paymentMethod" value={method} />
                </div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v ?? "PENDING")}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["PENDING", "PAID", "FAILED", "REFUNDED"].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="status" value={status} />
                </div>
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
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function RefundPaymentButton({ payment }: { payment: PaymentView }) {
  const [state, formAction, pending] = useActionState<PaymentActionState, FormData>(
    (prev, form) => refundPaymentAction(payment.paymentId, String(form.get("note") ?? "")),
    {}
  );
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  useCloseOnSuccess(state, setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary" size="sm" className="text-destructive">Refund</Button>
      <DialogPopup className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Refund payment</DialogTitle>
            <DialogDescription>{payment.invoiceNumber} · {formatPaise(payment.amountPaise)}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <StateNote state={state} />
            <div className="grid gap-2">
              <Label>Refund note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} name="note" rows={3} />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Refund
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function RecordPaymentCompact({
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
  useCloseOnSuccess(state, setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="secondary" size="sm">+ Payment</Button>
      <DialogPopup className="sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <StateNote state={state} />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Amount (₹) *</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
                <input type="hidden" name="amountPaise" value={String(Math.round(Number(amount) * 100) || 0)} />
                <FieldError errors={state._errors?.amountPaise} />
              </div>
              <div className="grid gap-2">
                <Label>Method *</Label>
                <Select value={method} onValueChange={(v) => setMethod(v ?? "")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{SUBSCRIPTION_PAYMENT_METHOD_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="paymentMethod" value={method} />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={pending || !amount}>
              {pending && <Loader2 className="animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}