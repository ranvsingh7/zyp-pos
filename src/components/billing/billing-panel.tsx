"use client";

import { useState } from "react";
import { IndianRupee, ReceiptText, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateBillAction, cancelBillAction } from "@/actions/billing/actions";
import { PaymentModal } from "@/components/billing/payment-modal";
import { PrintBillButton } from "@/components/billing/print-bill-button";
import { BILL_STATUS_LABELS, BILL_PAYMENT_METHOD_LABELS } from "@/lib/billing/constants";
import { formatPaise } from "@/lib/menu/prices";
import { effectiveRateForDisplay } from "@/lib/billing/tax";
import {
  computeOrderDiscountPaise,
  discountValueLabel,
} from "@/lib/orders/discount";
import type { DiscountType } from "@/lib/orders/constants";
import type { BillView } from "@/lib/billing/types";

function StatusBadge({ status }: { status: BillView["status"] }) {
  const tone: Record<BillView["status"], string> = {
    DRAFT: "bg-muted text-muted-foreground",
    UNPAID: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    PARTIAL: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    CANCELLED: "bg-destructive/15 text-destructive",
    REFUNDED: "bg-muted text-muted-foreground",
  };
  return <Badge className={tone[status]}>{BILL_STATUS_LABELS[status]}</Badge>;
}

function AmountRow({
  label,
  value,
  strong,
  negative,
}: {
  label: string;
  value: number;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={strong ? "text-base font-bold" : "text-sm"}
        // Negative discount/round-off shown with a minus.
      >
        {negative && value > 0 ? "−" : ""}
        {formatPaise(value)}
      </span>
    </div>
  );
}

interface BillingPanelProps {
  orderId: string;
  initialBill: BillView | null;
  canManage: boolean;
  canCancel: boolean;
  subtotalPaise?: number;
}

export function BillingPanel({
  orderId,
  initialBill,
  canManage,
  canCancel,
  subtotalPaise,
}: BillingPanelProps) {
  const [bill, setBill] = useState<BillView | null>(initialBill);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType | "">("");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    const result = await generateBillAction({
      orderId,
      discountType: discountType || null,
      discountValue:
        discountType && discountValue !== "" ? Number(discountValue) : null,
      discountReason: discountReason.trim() || null,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.message ?? "Could not generate the bill.");
      return;
    }
    if (result.bill) {
      setBill(result.bill);
      setPayOpen(true);
    }
  }

  const estimatePaise =
    discountType && discountValue !== ""
      ? computeOrderDiscountPaise(
          discountType,
          Number(discountValue) || 0,
          subtotalPaise ?? 0
        )
      : 0;

  async function handleCancel() {
    if (!bill) return;
    setCancelBusy(true);
    const result = await cancelBillAction({
      billId: bill.id,
      reason: cancelReason,
    });
    setCancelBusy(false);
    if (!result.success) {
      setError(result.message ?? "Could not cancel the bill.");
      return;
    }
    if (result.bill) setBill(result.bill);
    setCancelOpen(false);
    setCancelReason("");
  }

  if (!bill) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="size-5" />
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            No bill for this order yet. Generate one from the stored order
            snapshot to take payment.
          </p>
          {canManage ? (
            <>
              <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="bill-discount-type"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Discount <span className="font-normal">(optional)</span>
                  </label>
                  {estimatePaise > 0 && (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      −{formatPaise(estimatePaise)} on the bill
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <select
                    id="bill-discount-type"
                    value={discountType}
                    onChange={(e) =>
                      setDiscountType(
                        (e.currentTarget.value as DiscountType | "") || ""
                      )
                    }
                    className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    <option value="">No discount</option>
                    <option value="PERCENTAGE">% off</option>
                    <option value="FIXED">₹ off</option>
                  </select>
                  {discountType && (
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={discountType === "PERCENTAGE" ? 1 : 0.01}
                      max={discountType === "PERCENTAGE" ? 100 : undefined}
                      placeholder={
                        discountType === "PERCENTAGE" ? "e.g. 10" : "e.g. 100"
                      }
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.currentTarget.value)}
                      className="h-8 flex-1"
                      aria-label="Discount value"
                    />
                  )}
                </div>
                {discountType && (
                  <Input
                    type="text"
                    maxLength={300}
                    placeholder="Reason (optional)"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.currentTarget.value)}
                    className="h-8"
                    aria-label="Discount reason"
                  />
                )}
              </div>
              <Button
                type="button"
                disabled={busy}
                onClick={handleGenerate}
                className="w-fit"
              >
                <ReceiptText className="size-4" />
                Generate bill
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiter accounts can view bills but not take payments.
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Component rates are snapshotted on the bill; legacy bills predate the
  // snapshot and fall back to the combined rate (halved for CGST/SGST). For
  // mixed-rate bills (per-line GST overrides) the display rate is derived from
  // the actual amounts so the label stays truthful.
  const taxable = bill.taxableAmountPaise;
  const cgstRate = effectiveRateForDisplay(
    bill.cgstAmountPaise,
    taxable,
    bill.cgstRatePercent > 0 ? bill.cgstRatePercent : bill.taxRatePercent / 2
  );
  const sgstRate = effectiveRateForDisplay(
    bill.sgstAmountPaise,
    taxable,
    bill.sgstRatePercent > 0 ? bill.sgstRatePercent : bill.taxRatePercent / 2
  );
  const igstRate = effectiveRateForDisplay(
    bill.igstAmountPaise,
    taxable,
    bill.igstRatePercent > 0 ? bill.igstRatePercent : bill.taxRatePercent
  );
  const totalRate = effectiveRateForDisplay(
    bill.totalTaxPaise,
    taxable,
    bill.taxRatePercent
  );
  const taxRows = bill.gstRegistered
    ? bill.cgstAmountPaise > 0 || bill.sgstAmountPaise > 0
      ? [
          { label: `CGST @ ${cgstRate}%`, amount: bill.cgstAmountPaise },
          { label: `SGST @ ${sgstRate}%`, amount: bill.sgstAmountPaise },
        ]
      : bill.igstAmountPaise > 0
        ? [{ label: `IGST @ ${igstRate}%`, amount: bill.igstAmountPaise }]
        : []
    : bill.totalTaxPaise > 0
      ? [{ label: `Tax @ ${totalRate}%`, amount: bill.totalTaxPaise }]
      : [];

  const hasPayments = bill.payments.length > 0;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="size-5" />
            {bill.billNumber}
          </CardTitle>
          <StatusBadge status={bill.status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-lg bg-muted/40 p-3">
            <AmountRow label="Subtotal" value={bill.subtotalPaise} />
            {bill.discountPaise > 0 && (
              <AmountRow
                label={`Discount${
                  bill.discountType
                    ? ` (${discountValueLabel(bill.discountType, bill.discountValue)})`
                    : ""
                }`}
                value={bill.discountPaise}
                negative
              />
            )}
            {bill.discountPaise > 0 && bill.discountReason && (
              <p className="-mt-0.5 text-xs text-muted-foreground italic">
                Reason: {bill.discountReason}
              </p>
            )}
            {bill.gstRegistered && (
              <AmountRow label="Taxable" value={bill.taxableAmountPaise} />
            )}
            {taxRows.map((row) => (
              <AmountRow key={row.label} label={row.label} value={row.amount} />
            ))}
            {bill.serviceChargeAmountPaise > 0 && (
              <AmountRow label="Service charge" value={bill.serviceChargeAmountPaise} />
            )}
            {bill.roundOffEnabled && bill.roundOffAmountPaise !== 0 && (
              <AmountRow
                label="Round off"
                value={Math.abs(bill.roundOffAmountPaise)}
                negative={bill.roundOffAmountPaise < 0}
              />
            )}
            <div className="mt-1 border-t border-border/50 pt-2">
              <AmountRow label="Grand total" value={bill.grandTotalPaise} strong />
            </div>
            {bill.paidAmountPaise > 0 && (
              <AmountRow label={`Paid (${hasPayments ? bill.payments.length : 0} payment${hasPayments && bill.payments.length !== 1 ? "s" : ""})`} value={bill.paidAmountPaise} />
            )}
            {bill.dueAmountPaise > 0 && (
              <AmountRow label="Balance due" value={bill.dueAmountPaise} strong />
            )}
          </div>

          {hasPayments && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Payments
              </p>
              {bill.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <IndianRupee className="size-3.5 text-muted-foreground" />
                    {BILL_PAYMENT_METHOD_LABELS[p.method]}
                    {p.referenceNumber && (
                      <span className="text-xs text-muted-foreground">
                        · {p.referenceNumber}
                      </span>
                    )}
                  </span>
                  <span className="font-semibold">{formatPaise(p.amountPaise)}</span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <>
                {bill.status !== "PAID" && bill.status !== "CANCELLED" && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setPayOpen(true)}
                  >
                    <IndianRupee className="size-4" />
                    {bill.status === "PARTIAL" ? "Continue payment" : "Pay now"}
                  </Button>
                )}
                <PrintBillButton billId={bill.id} label="Print bill" size="sm" />
              </>
            ) : null}
            {canCancel &&
              bill.status !== "PAID" &&
              bill.status !== "CANCELLED" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCancelOpen(true)}
                >
                  <XCircle className="size-4" />
                  Cancel bill
                </Button>
              )}
          </div>
        </CardContent>
      </Card>

      {payOpen && canManage && bill.status !== "PAID" && bill.status !== "CANCELLED" && (
        <PaymentModal
          key={bill.id}
          bill={bill}
          onOpenChange={setPayOpen}
          onSettled={setBill}
        />
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <div>
              <DialogTitle>Cancel {bill.billNumber}</DialogTitle>
              <DialogDescription>
                The order stays active. Unpaid cancelled bills can be re-printed for
                record keeping.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cancel-reason" className="text-xs text-muted-foreground uppercase">
                Reason (optional)
              </Label>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.currentTarget.value)}
                placeholder="e.g. Bill raised by mistake"
                rows={3}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={cancelBusy}
              onClick={() => setCancelOpen(false)}
            >
              Keep bill
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelBusy}
              onClick={handleCancel}
            >
              Cancel bill
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}