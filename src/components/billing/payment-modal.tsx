"use client";

import { useRef, useState } from "react";
import { Banknote, CreditCard, Smartphone, Wallet } from "lucide-react";
import { cn } from "cn";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  completePaymentAction,
  recordPaymentAction,
} from "@/actions/billing/actions";
import {
  BILL_PAYMENT_METHOD_LABELS,
  type BillPaymentMethod,
} from "@/lib/billing/constants";
import { formatPaise, rupeesToPaise } from "@/lib/menu/prices";
import type { BillView } from "@/lib/billing/types";

const METHOD_ICONS: Record<BillPaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
  OTHER: Wallet,
};

interface PaymentModalProps {
  bill: BillView;
  onOpenChange: (open: boolean) => void;
  onSettled: (bill: BillView) => void;
}

/**
 * Mounted only while a payment is being taken (the parent controls this), so
 * every open starts from a clean form built from the bill passed in. A fresh
 * idempotency key is minted per attempt to keep split payments distinct.
 */
export function PaymentModal({
  bill,
  onOpenChange,
  onSettled,
}: PaymentModalProps) {
  const duePaise = bill.dueAmountPaise;
  const [method, setMethod] = useState<BillPaymentMethod>("CASH");
  // null = "pay the full remaining due"; set once the cashier edits the field.
  const [amountPaise, setAmountPaise] = useState<number | null>(null);
  const [amountEdited, setAmountEdited] = useState(false);
  const [busy, setBusy] = useState<"record" | "complete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const keyRef = useRef(0);

  function freshIdempotencyKey(): string | undefined {
    keyRef.current += 1;
    return typeof crypto !== "undefined"
      ? `${crypto.randomUUID()}`
      : undefined;
  }

  const effectiveAmountPaise =
    amountEdited && amountPaise !== null ? amountPaise : duePaise;
  const amountValid = Number.isInteger(effectiveAmountPaise) && effectiveAmountPaise >= 1;

  async function run(
    kind: "record" | "complete",
    fn: () => Promise<{ success: boolean; message?: string; bill?: BillView | null }>
  ) {
    setBusy(kind);
    setError(null);
    setSuccess(null);
    const result = await fn();
    setBusy(null);
    if (!result.success) {
      setError(result.message ?? "Payment could not be recorded.");
      return;
    }
    if (result.bill) {
      setSuccess(
        result.bill.status === "PAID"
          ? "Payment received — bill settled."
          : `Payment received. Balance due: ${formatPaise(result.bill.dueAmountPaise)}`
      );
      onSettled(result.bill);
    } else {
      onOpenChange(false);
    }
  }

  function handleRecord() {
    if (!amountValid) return;
    void run("record", () =>
      recordPaymentAction({
        billId: bill.id,
        method,
        amountPaise: effectiveAmountPaise,
        idempotencyKey: freshIdempotencyKey(),
      })
    );
  }

  function handleComplete() {
    void run("complete", () =>
      completePaymentAction({
        billId: bill.id,
        method,
        idempotencyKey: freshIdempotencyKey(),
      })
    );
  }

  const fullyPaid = bill.status === "PAID";
  const canAct = !fullyPaid && duePaise > 0;
  const displayRupees = effectiveAmountPaise / 100;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <div>
            <DialogTitle>Receive payment</DialogTitle>
            <DialogDescription>
              {bill.billNumber} · due {formatPaise(duePaise)}
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody>
          {fullyPaid ? (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
              This bill is already fully paid.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <Label className="text-xs text-muted-foreground uppercase">
                  Payment method
                </Label>
                <div className="mt-2 grid grid-cols-4 gap-1 rounded-lg bg-muted/60 p-1">
                  {(Object.keys(BILL_PAYMENT_METHOD_LABELS) as BillPaymentMethod[]).map(
                    (name) => {
                      const Icon = METHOD_ICONS[name];
                      const active = method === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => setMethod(name)}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                            active
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon className="size-4" />
                          {BILL_PAYMENT_METHOD_LABELS[name]}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="payment-amount" className="text-xs text-muted-foreground uppercase">
                  Amount (rupees)
                </Label>
                <div className="flex items-stretch gap-2">
                  <Input
                    id="payment-amount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={displayRupees}
                    disabled={busy !== null}
                    onChange={(e) => {
                      const rupees = Number(e.currentTarget.value);
                      setAmountEdited(true);
                      setAmountPaise(
                        Number.isFinite(rupees) && rupees >= 0 ? rupeesToPaise(rupees) : 0
                      );
                    }}
                    placeholder="0.00"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null || duePaise <= 0}
                    onClick={() => {
                      setAmountPaise(null);
                      setAmountEdited(false);
                    }}
                  >
                    Full
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {duePaise > 0
                    ? `Remaining due ${formatPaise(duePaise)}`
                    : "Nothing due"}
                </p>
              </div>

              {error && (
                <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </p>
              )}
              {success && (
                <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                  {success}
                </p>
              )}
            </div>
          )}
        </DialogBody>

        {canAct && (
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || !amountValid}
              onClick={handleRecord}
            >
              Record payment
            </Button>
            <Button
              type="button"
              disabled={busy !== null}
              onClick={handleComplete}
            >
              <span className="flex items-center gap-1.5">
                <span>Complete payment</span>
                <span className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs">
                  {formatPaise(duePaise)}
                </span>
              </span>
            </Button>
          </DialogFooter>
        )}
      </DialogPopup>
    </Dialog>
  );
}