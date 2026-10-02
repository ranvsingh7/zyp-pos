"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, ReceiptText } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listBillsAction } from "@/actions/billing/actions";
import { PrintBillButton } from "@/components/billing/print-bill-button";
import {
  BILL_STATUS_LABELS,
  type BillStatus,
} from "@/lib/billing/constants";
import { formatPaise } from "@/lib/menu/prices";
import type { BillListItemView } from "@/lib/billing/types";

const FILTERS: { value: BillStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIAL", label: "Partial" },
  { value: "PAID", label: "Paid" },
  { value: "CANCELLED", label: "Cancelled" },
];

const STATUS_TONE: Record<BillStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  UNPAID: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  PARTIAL: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  PAID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  CANCELLED: "bg-destructive/15 text-destructive",
  REFUNDED: "bg-muted text-muted-foreground",
};

interface BillingListProps {
  canPrint: boolean;
  initialBills: BillListItemView[];
  initialTotal: number;
}

export function BillingList({
  canPrint,
  initialBills,
  initialTotal,
}: BillingListProps) {
  const [bills, setBills] = useState<BillListItemView[]>(initialBills);
  const [total, setTotal] = useState(initialTotal);
  const [status, setStatus] = useState<BillStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextOffset: number, nextStatus = status, nextQuery = appliedSearch) {
    setBusy(true);
    setError(null);
    const result = await listBillsAction({
      status: nextStatus === "ALL" ? "" : nextStatus,
      search: nextQuery,
      offset: nextOffset,
      limit: 20,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.message ?? "Could not load bills.");
      return;
    }
    if (nextOffset === 0) setBills(result.bills ?? []);
    else setBills((prev) => [...prev, ...(result.bills ?? [])]);
    setTotal(result.total ?? 0);
  }

  function applyFilter(nextStatus: BillStatus | "ALL") {
    setStatus(nextStatus);
    void load(0, nextStatus);
  }

  function applySearch() {
    setAppliedSearch(search.trim());
    void load(0, status, search.trim());
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                disabled={busy}
                onClick={() => applyFilter(filter.value)}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  status === filter.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 items-center gap-2 sm:justify-end">
            <Input
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              placeholder="Bill or order number"
              className="max-w-56"
            />
            <Button type="button" variant="outline" size="icon" onClick={applySearch}>
              <Search className="size-4" />
            </Button>
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {bills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
            <ReceiptText className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No bills yet{appliedSearch || status !== "ALL" ? " for this filter" : ""}.
              Generate a bill from an active order to see it here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {bills.map((bill) => (
              <li
                key={bill.id}
                className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{bill.billNumber}</p>
                    <Badge className={STATUS_TONE[bill.status]}>
                      {BILL_STATUS_LABELS[bill.status]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Order #{bill.orderNumber}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {bill.orderType === "DINE_IN"
                      ? bill.tableNameSnapshot ?? "Dine-in"
                      : bill.orderType}
                    {bill.customerName ? ` · ${bill.customerName}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold">{formatPaise(bill.grandTotalPaise)}</p>
                    {bill.dueAmountPaise > 0 ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Due {formatPaise(bill.dueAmountPaise)}
                      </p>
                    ) : (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        {formatPaise(bill.paidAmountPaise)} paid
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canPrint && (
                      <PrintBillButton
                        billId={bill.id}
                        label=""
                        size="icon"
                        variant="ghost"
                      />
                    )}
                    <Button
                        nativeButton={false}
                        render={<Link href={`/orders/${bill.orderId}`} />}
                        variant="outline"
                        size="sm"
                      >
                        Open
                      </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {bills.length < total ? (
          <div className="flex justify-center pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => load(bills.length)}
            >
              {busy ? "Loading…" : `Load more (${total - bills.length} remaining)`}
            </Button>
          </div>
        ) : null}
    </div>
  );
}