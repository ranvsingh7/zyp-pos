"use client";

import { Printer } from "lucide-react";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { KotView, StaffMap } from "@/lib/orders/types";
import { formatDateTime } from "@/lib/orders/format";
import { orderTypeLabel } from "@/lib/orders/constants";

/**
 * In-app KOT snapshot viewer. Opens the stored (immutable) KOT record in a
 * modal — it NEVER triggers the browser print dialog. REPRINT is the only
 * action that routes to the existing print flow (and is disabled for a
 * cancelled KOT, which can never be reprinted).
 */
export function KotViewDialog({
  kot,
  busy,
  onClose,
  onReprint,
  staff,
}: {
  kot: KotView;
  busy: boolean;
  onClose: () => void;
  onReprint: (kot: KotView) => void;
  staff?: StaffMap;
}) {
  const cancelled = kot.status === "CANCELLED";

  function staffName(id: string | null): string {
    if (!id) return "—";
    return staff?.[id]?.fullName ?? id;
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader className="flex items-start justify-between gap-3">
          <div className="pr-8">
            <DialogTitle>KOT {kot.kotNumber}</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Order #{kot.orderNumber} ·{" "}
              {kot.orderType === "DINE_IN"
                ? kot.tableName
                  ? `Table ${kot.tableName}`
                  : orderTypeLabel[kot.orderType]
                : orderTypeLabel[kot.orderType]}
            </p>
          </div>
          <div
            data-testid="kot-view-dialog"
            data-status={kot.status}
            className="flex shrink-0 items-center gap-1.5"
          >
            {cancelled ? (
              <Badge variant="destructive">Cancelled</Badge>
            ) : (
              <>
                <Badge variant="outline">New</Badge>
                <Badge variant="secondary">
                  {kot.state === "SENT" ? "Sent" : "Printed"}
                </Badge>
              </>
            )}
          </div>
        </DialogHeader>
        <DialogBody>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(kot.createdAt)}</dd>
            {kot.printedAt && (
              <>
                <dt className="text-muted-foreground">Printed</dt>
                <dd>
                  {formatDateTime(kot.printedAt)}
                  {kot.printedCount > 1
                    ? ` · reprinted ${kot.printedCount}×`
                    : ""}
                </dd>
              </>
            )}
            {cancelled && (
              <>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd>{formatDateTime(kot.cancelledAt)}</dd>
                <dt className="text-muted-foreground">Cancelled by</dt>
                <dd>{staffName(kot.cancelledBy)}</dd>
                {kot.cancellationReason && (
                  <>
                    <dt className="text-muted-foreground">Reason</dt>
                    <dd>{kot.cancellationReason}</dd>
                  </>
                )}
              </>
            )}
            {kot.customerName && (
              <>
                <dt className="text-muted-foreground">Customer</dt>
                <dd>{kot.customerName}</dd>
              </>
            )}
          </dl>

          <div className="mt-4 rounded-lg border border-border/60">
            <p className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Kitchen items
            </p>
            <ul className="flex flex-col gap-1 p-3">
              {kot.items.length === 0 && (
                <li className="text-sm text-muted-foreground">No items.</li>
              )}
              {kot.items.map((item, index) => (
                <li key={index} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{item.name}</span>
                    {item.variant ? ` · ${item.variant}` : ""}
                    {item.note ? ` — “${item.note}”` : ""}
                  </span>
                  <span className="shrink-0 font-semibold">
                    × {item.quantity}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {kot.orderNote && (
            <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Order note: “{kot.orderNote}”
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            size="sm"
            disabled={busy || kot.status === "CANCELLED"}
            onClick={() => onReprint(kot)}
          >
            <Printer className="size-4" />
            Reprint
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}