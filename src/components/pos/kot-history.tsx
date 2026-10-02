"use client";

import { History, Eye, Printer, Ban } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KotStatusBadge } from "@/components/pos/kot-status-badge";
import type { KotView, StaffMap } from "@/lib/orders/types";
import { formatDateTime } from "@/lib/orders/format";

/**
 * Compact, complete KOT history for the selected order/table. Mirrors the
 * style of the Order Details KOT history: one dense card per stored snapshot
 * (never recomputed from the live order), scrollable when many KOTs exist.
 */
export function KotHistory({
  kots,
  busyKotId,
  onView,
  onReprint,
  onCancel,
  staff,
  className,
  emptyText,
}: {
  kots: KotView[];
  busyKotId: string | null;
  onView: (kot: KotView) => void;
  onReprint: (kot: KotView) => void;
  onCancel: (kot: KotView) => void;
  staff?: StaffMap;
  className?: string;
  emptyText?: string;
}) {
  function staffName(id: string | null): string {
    if (!id) return "—";
    return staff?.[id]?.fullName ?? id;
  }
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col rounded-xl border bg-card shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4" />
          KOT history
        </p>
        {kots.length > 0 && (
          <Badge variant="secondary">{kots.length}</Badge>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {kots.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {emptyText ?? "No KOTs printed yet. Save the order and press PRINT KOT."}
          </p>
        ) : (
          kots.map((kot) => (
            <div
              key={kot.id}
              data-testid="kot-history-card"
              data-status={kot.status}
              className="rounded-lg border bg-card px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {kot.kotNumber}
                    <KotStatusBadge kot={kot} />
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Created {formatDateTime(kot.createdAt)}
                  </p>
                  {kot.printedAt && (
                    <p className="truncate text-xs text-muted-foreground">
                      Printed {formatDateTime(kot.printedAt)}
                      {kot.printedCount > 1
                        ? ` · reprinted ${kot.printedCount}×`
                        : ""}
                    </p>
                  )}
                  {kot.status === "CANCELLED" && (
                    <>
                      <p
                        data-testid="kot-cancelled-at"
                        className="truncate text-xs text-destructive"
                      >
                        Cancelled {formatDateTime(kot.cancelledAt)}
                      </p>
                      <p
                        data-testid="kot-cancelled-by"
                        className="truncate text-xs text-destructive"
                      >
                        Cancelled by {staffName(kot.cancelledBy)}
                      </p>
                      {kot.cancellationReason && (
                        <p
                          data-testid="kot-cancelled-reason"
                          className="truncate text-xs text-destructive"
                        >
                          Reason: {kot.cancellationReason}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busyKotId === kot.id}
                    onClick={() => onView(kot)}
                    aria-label={`View KOT ${kot.kotNumber}`}
                  >
                    <Eye className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={busyKotId === kot.id || kot.status === "CANCELLED"}
                    onClick={() => onReprint(kot)}
                    aria-label={`Reprint KOT ${kot.kotNumber}`}
                  >
                    <Printer className="size-4" />
                  </Button>
                  {kot.status !== "CANCELLED" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busyKotId === kot.id}
                      onClick={() => onCancel(kot)}
                      aria-label={`Cancel KOT ${kot.kotNumber}`}
                      className="text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Ban className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
              {kot.items.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-border/60 pt-1.5">
                  {kot.items.map((item, index) => (
                    <li
                      key={index}
                      className="text-xs text-muted-foreground"
                    >
                      <span className="font-medium text-foreground">
                        {item.quantity} × {item.name}
                      </span>
                      {item.variant ? ` · ${item.variant}` : ""}
                      {item.note ? ` — “${item.note}”` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}