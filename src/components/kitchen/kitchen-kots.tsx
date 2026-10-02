"use client";

import * as React from "react";
import { Printer, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  openPrintWindow,
  writePrintWindow,
} from "@/components/orders/orders-print";
import {
  reprintKotAction,
  viewKotAction,
  listKotsAction,
} from "@/actions/orders/actions";
import { ToastView, type ToastData } from "@/components/menu/toast";
import { orderTypeLabel } from "@/lib/orders/constants";
import { formatDateTime } from "@/lib/orders/format";
import type { KotItemView, KotView } from "@/lib/orders/types";

const ACTION_TONE: Record<KotItemView["action"], string> = {
  ADDED: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
};

export function KitchenKots({ kots: initial }: { kots: KotView[] }) {
  const [kots, setKots] = React.useState<KotView[]>(initial);
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = React.useState(false);
  const [toast, setToast] = React.useState<ToastData | null>(null);
  const toastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = React.useCallback(
    (kind: ToastData["kind"], message: string) => {
      if (toastRef.current) clearTimeout(toastRef.current);
      setToast({ kind, message });
      toastRef.current = setTimeout(() => setToast(null), 3500);
    },
    []
  );

  async function refresh() {
    try {
      setRefreshing(true);
      const result = await listKotsAction({ limit: 50 });
      if (result.success && result.kots) setKots(result.kots);
    } catch {
      setKots([]);
    } finally {
      setRefreshing(false);
    }
  }

  async function runKot(action: "view" | "reprint", kot: KotView) {
    const win = openPrintWindow();
    if (!win) {
      showToast("error", "Printing could not be started.");
      return;
    }
    setBusy((map) => ({ ...map, [kot.id]: true }));
    try {
      const result =
        action === "view"
          ? await viewKotAction({ kotId: kot.id })
          : await reprintKotAction({ kotId: kot.id });
      if (!result.success || !result.html) {
        win.close();
        showToast("error", result.message ?? "Could not open the KOT.");
        return;
      }
      writePrintWindow(win, result.html);
      if (action === "reprint") {
        showToast("success", `KOT ${kot.kotNumber} sent to printer.`);
      }
    } catch (error) {
      try {
        win.close();
      } catch {
        // ignore
      }
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not open the KOT."
      );
    } finally {
      setBusy((map) => ({ ...map, [kot.id]: false }));
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {kots.length} KOT{kots.length === 1 ? "" : "s"} shown
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>

        {kots.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <Printer className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No kitchen tickets printed yet. Print one from POS and it appears
              here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {kots.map((kot) => (
              <div
                key={kot.id}
                className="flex flex-col rounded-xl border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-heading text-lg font-semibold">
                    {kot.kotNumber}
                  </p>
                  <Badge variant="outline">New</Badge>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <p>
                    Order #{kot.orderNumber} · {orderTypeLabel[kot.orderType]}
                    {kot.tableName ? ` · ${kot.tableName}` : ""}
                  </p>
                  <p className="truncate">
                    {kot.customerName ?? kot.orderNote ?? "—"} ·{" "}
                    {kot.printedAt ? formatDateTime(kot.printedAt) : ""}
                  </p>
                </div>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {kot.items.map((item, index) => (
                    <li
                      key={index}
                      className="flex items-start justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {item.quantity} × {item.name}
                          {item.variant ? ` (${item.variant})` : ""}
                        </p>
                        {item.note && (
                          <p className="truncate text-xs text-muted-foreground">
                            {item.note}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className={ACTION_TONE[item.action]}>
                        {item.action}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy[kot.id])}
                    onClick={() => runKot("view", kot)}
                  >
                    <Eye className="size-4" />
                    View
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy[kot.id])}
                    onClick={() => runKot("reprint", kot)}
                  >
                    <Printer className="size-4" />
                    Reprint
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ToastView toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}