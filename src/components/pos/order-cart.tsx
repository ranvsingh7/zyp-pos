"use client";

import React from "react";
import {
  Minus,
  Plus,
  X,
  Printer,
  StickyNote,
  AlertTriangle,
  Save,
  Pause,
  Play,
  MoveRight,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  usePos,
  orderHasUnsavedEdits,
  type CartLine,
} from "@/components/pos/pos-store";
import { KotHistory } from "@/components/pos/kot-history";
import type { MenuItemView } from "@/lib/menu/types";
import type { OrderView, KotView, KotItemView, StaffMap } from "@/lib/orders/types";
import { ORDER_TYPES, ORDER_STATUS_LABELS, orderTypeLabel } from "@/lib/orders/constants";
import { formatPaise } from "@/lib/menu/prices";

/** A cart line and the locked/printed quantity it sits on. */
interface NewRow {
  fragmentKey: string;
  line: CartLine;
  /** Editable floor: the already-printed quantity under this line. */
  floor: number;
}

/**
 * Computes, for each cart line, how many units are already covered by printed
 * KOTs. The printed budget is tracked per item+variant (server side) and
 * consumed line-by-line in the same order, so adding/changing notes never
 * exposes already-printed quantity as editable, and duplicate identical lines
 * share one budget instead of double-counting it.
 */
function printedFloors(cart: CartLine[], order: OrderView): number[] {
  const floors: number[] = new Array(cart.length).fill(0);

  const buckets = new Map<string, Array<{ printed: number }>>();
  order.items.forEach((item) => {
    const key = `${item.menuItemId}:${item.variantId ?? ""}`;
    const list = buckets.get(key);
    if (list) list.push({ printed: item.printedQuantity });
    else buckets.set(key, [{ printed: item.printedQuantity }]);
  });

  const cursor = new Map<string, number>();
  cart.forEach((line, cartIndex) => {
    if (line.quantity <= 0) return;
    const key = `${line.menuItemId}:${line.variantId ?? ""}`;
    const bucket = buckets.get(key) ?? [];
    let floor = 0;
    let at = cursor.get(key) ?? 0;
    while (at < bucket.length && floor < line.quantity) {
      const entry = bucket[at];
      if (entry.printed > 0) {
        const take = Math.min(entry.printed, line.quantity - floor);
        floor += take;
        entry.printed -= take;
      }
      if (entry.printed <= 0 || floor >= line.quantity) {
        at += 1;
      }
      cursor.set(key, at);
    }
    floors[cartIndex] = floor;
  });

  return floors;
}

/**
 * The single right-side Order workspace panel.
 *
 * ONE unified card:
 *   TOP    — order number / selected table + status (always visible).
 *   MIDDLE — the order's COMPLETE KOT history, rendered with the existing
 *            compact KOT card design. Scrollable; fills the available height.
 *   BOTTOM — the NEW / UNSENT ITEMS area. Only appears while staff is
 *            creating a new order or adding/editing quantities not yet sent
 *            to the kitchen. Already-printed lines are never shown here (they
 *            are historical KOT snapshots), so there are no locked item cards,
 *            no +/- controls, no delete or note buttons on printed items.
 *
 * The primary action is PRINT KOT (first / complete snapshot) or PRINT NEW
 * KOT (only the newly-added quantities). SAVE ORDER, HOLD/RESUME and MOVE
 * order are preserved as secondary actions.
 */
export function OrderPanel({
  items,
  busy,
  kots,
  busyKotId,
  pendingPrintKind,
  pendingKitchenItems,
  tableName,
  onPrint,
  onSave,
  onHold,
  onResume,
  onMove,
  onViewKot,
  onReprintKot,
  onCancelKot,
  staff,
  className,
}: {
  items: MenuItemView[];
  busy: boolean;
  kots: KotView[];
  busyKotId: string | null;
  pendingPrintKind: "ADD" | "MODIFY" | null;
  pendingKitchenItems: KotItemView[];
  tableName: string | null;
  onPrint: () => void;
  onSave: () => void;
  onHold: () => void;
  onResume: () => void;
  onMove: () => void;
  onViewKot: (kot: KotView) => void;
  onReprintKot: (kot: KotView) => void;
  onCancelKot: (kot: KotView) => void;
  staff?: StaffMap;
  className?: string;
}) {
  const { state, dispatch } = usePos();
  const { cart, activeOrder } = state;
  const [noteKey, setNoteKey] = React.useState<string | null>(null);

  const sellableIds = new Set(
    items
      .filter((i) => i.isActive && i.isAvailable)
      .map((i) => i.id)
  );
  const unavailableNames = [
    ...new Set(
      cart
        .filter((line) => !sellableIds.has(line.menuItemId))
        .map((line) => line.name)
    ),
  ];

  const hasTable =
    activeOrder != null ||
    Boolean(state.tableId) ||
    state.orderType !== "DINE_IN";
  // Only lines with a quantity not yet covered by printed KOTs are shown;
  // the printed ledger stays locked inside the KOT history cards.
  const floors = activeOrder
    ? printedFloors(cart, activeOrder)
    : cart.map(() => 0);
  const rows: NewRow[] = cart.flatMap((line, index) => {
    const floor = floors[index] ?? 0;
    const unsent = line.quantity - floor;
    if (unsent <= 0) return [];
    return [{ fragmentKey: `n-${index}`, line, floor }];
  });
  const newQuantity = rows.reduce(
    (sum, row) => sum + (row.line.quantity - row.floor),
    0
  );
  const newSubtotalPaise = rows.reduce(
    (sum, row) =>
      sum + (row.line.quantity - row.floor) * row.line.unitPricePaise,
    0
  );
  const pendingCount = pendingKitchenItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );
  const lastKot = kots.length > 0 ? kots[kots.length - 1] : null;

  const hasUnsavedEdits = orderHasUnsavedEdits(state);

  const status =
    activeOrder?.status === "HELD"
      ? "HELD"
      : activeOrder?.status === "OPEN" || activeOrder == null
        ? "OPEN"
        : activeOrder.status;

  // The current/new-order area only has a purpose while staff is creating an
  // order or has unsent changes. A pristine, fully-printed order shows just
  // the header + KOT history (no editable cart, no note input).
  const showCurrentArea =
    activeOrder == null || newQuantity > 0 || hasUnsavedEdits;
  const orderNoteVisible =
    activeOrder == null || newQuantity > 0 || state.orderNote.length > 0;

  const canSubmit =
    hasTable && (hasUnsavedEdits || (activeOrder != null && pendingPrintKind != null));
  const canSave = hasUnsavedEdits && !busy;
  // Saving an order with unprinted quantities makes them printable; HOLD/MOVE
  // apply to the saved order, so edits must be saved first.
  const canHold = activeOrder != null && status === "OPEN" && !hasUnsavedEdits && !busy;
  const canResume = activeOrder != null && status === "HELD" && !busy;
  const canMove =
    activeOrder != null &&
    activeOrder.orderType === "DINE_IN" &&
    !hasUnsavedEdits &&
    !busy;

  const firstPrint =
    activeOrder == null || activeOrder.pendingKitchenPrint === "ADD";
  const label = firstPrint ? "PRINT KOT" : "PRINT NEW KOT";

  let hint: string;
  if (busy) {
    hint = "Please wait…";
  } else if (!hasTable) {
    hint = "Select a table to start an order.";
  } else if (activeOrder && !hasUnsavedEdits && !pendingPrintKind) {
    hint = "No new items to print.";
  } else if (activeOrder == null && cart.length === 0) {
    hint = "Add items, then print the kitchen ticket.";
  } else if (label === "PRINT NEW KOT") {
    hint = "Prints only the newly added quantities.";
  } else {
    hint = "Saves the order and prints the first KOT.";
  }

  const itemCount = activeOrder
    ? activeOrder.items.reduce((sum, item) => sum + item.quantity, 0)
    : cart.reduce((sum, line) => sum + line.quantity, 0);

  function renderRow(row: NewRow) {
    const line = row.line;
    const unsent = line.quantity - row.floor;
    return (
      <div
        key={row.fragmentKey}
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {line.name}
              {line.variantName && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {line.variantName}
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatPaise(line.unitPricePaise)} each
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {line.note && (
              <span className="max-w-24 truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                “{line.note}”
              </span>
            )}
            <button
              type="button"
              onClick={() => dispatch({ type: "REMOVE_LINE", key: line.key })}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${line.name}`}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={line.quantity <= row.floor}
              onClick={() =>
                dispatch({
                  type: "UPDATE_LINE",
                  key: line.key,
                  patch: { quantity: Math.max(1, line.quantity - 1) },
                })
              }
              className="flex size-7 items-center justify-center rounded-md border border-input transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Decrease ${line.name} quantity`}
            >
              <Minus className="size-3.5" />
            </button>
            <span className="w-8 text-center text-sm font-semibold">
              {unsent}
            </span>
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: "UPDATE_LINE",
                  key: line.key,
                  patch: { quantity: line.quantity + 1 },
                })
              }
              className="flex size-7 items-center justify-center rounded-md border border-input transition-colors hover:bg-muted"
              aria-label={`Increase ${line.name} quantity`}
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                setNoteKey((key) => (key === line.key ? null : line.key))
              }
              className={cn(
                "ml-1 flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium transition-colors hover:bg-muted",
                noteKey === line.key && "border-primary bg-muted"
              )}
              aria-label={`Add note to ${line.name}`}
            >
              <StickyNote className="size-3.5" />
              Note
            </button>
          </div>
          <span className="text-sm font-semibold">
            {formatPaise(
              line.unitPricePaise * Math.max(1, unsent)
            )}
          </span>
        </div>

        {noteKey === line.key && (
          <div className="mt-2">
            <Textarea
              rows={2}
              value={line.note}
              autoFocus
              onChange={(e) =>
                dispatch({
                  type: "UPDATE_LINE",
                  key: line.key,
                  patch: { note: e.currentTarget.value },
                })
              }
              placeholder="e.g. Extra spicy, no onions…"
              className="text-sm"
            />
            <div className="mt-1 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setNoteKey(null)}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm",
        className
      )}
    >
      {/* TOP — order number + selected table, always visible */}
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {activeOrder
              ? `Order #${activeOrder.orderNumber}`
              : state.orderType === "DINE_IN"
                ? tableName
                  ? `Table ${tableName}`
                  : "Select a table"
                : orderTypeLabel[state.orderType]}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {activeOrder
              ? `${activeOrder.orderType === "DINE_IN" ? `Table ${activeOrder.tableNameSnapshot ?? "—"} · ` : ""}${ORDER_STATUS_LABELS[activeOrder.status]}`
              : "New order"}
            {" · "}
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pendingPrintKind != null ? (
            <Badge className="bg-amber-500 text-white">
              NEW KOT{pendingCount > 0 ? ` · +${pendingCount}` : ""}
            </Badge>
          ) : lastKot ? (
            <Badge variant="outline">{lastKot.kotNumber}</Badge>
          ) : null}
        </div>
      </div>

      {/* MIDDLE — the order's COMPLETE KOT history (existing compact card design) */}
      <KotHistory
        kots={kots}
        busyKotId={busyKotId}
        onView={onViewKot}
        onReprint={onReprintKot}
        onCancel={onCancelKot}
        staff={staff}
        className="min-h-0 flex-1 rounded-none border-0 bg-transparent shadow-none"
        emptyText={
          activeOrder == null
            ? "Select a table (or an order type) to start an order — its KOT history will appear here."
            : "No KOTs printed yet. Save the order and press PRINT KOT."
        }
      />

      {/* BOTTOM — NEW / UNSENT ITEMS area (only while there is something new) */}
      {showCurrentArea && (
        <>
          <div className="shrink-0 border-t border-border/50" />
          <div className="shrink-0">
            {/* New order: order type (DINE_IN / TAKEAWAY / QUICK_SALE) */}
            {activeOrder == null && (
              <div className="flex flex-col gap-2 border-b border-border/50 px-4 py-3">
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                  {ORDER_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => dispatch({ type: "SET_ORDER_TYPE", orderType: type })}
                      className={cn(
                        "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                        state.orderType === type
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {orderTypeLabel[type]}
                    </button>
                  ))}
                </div>
                {state.orderType !== "DINE_IN" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={state.customerName}
                      onChange={(e) =>
                        dispatch({ type: "SET_CUSTOMER_NAME", value: e.currentTarget.value })
                      }
                      placeholder="Customer name"
                      className="text-sm"
                    />
                    <Input
                      value={state.customerPhone}
                      onChange={(e) =>
                        dispatch({ type: "SET_CUSTOMER_PHONE", value: e.currentTarget.value })
                      }
                      placeholder="Phone"
                      className="text-sm"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Existing non-dine-in order: edit customer */}
            {activeOrder != null && activeOrder.orderType !== "DINE_IN" && (
              <div className="grid grid-cols-2 gap-2 border-b border-border/50 px-4 py-3">
                <Input
                  value={state.customerName}
                  onChange={(e) =>
                    dispatch({ type: "SET_CUSTOMER_NAME", value: e.currentTarget.value })
                  }
                  placeholder="Customer name"
                  className="text-sm"
                />
                <Input
                  value={state.customerPhone}
                  onChange={(e) =>
                    dispatch({ type: "SET_CUSTOMER_PHONE", value: e.currentTarget.value })
                  }
                  placeholder="Phone"
                  className="text-sm"
                />
              </div>
            )}

            {/* Unavailable warning */}
            {unavailableNames.length > 0 && (
              <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  {unavailableNames.slice(0, 3).join(", ")}
                  {unavailableNames.length > 3 ? " and more" : ""}{" "}
                  {unavailableNames.length === 1 ? "is" : "are"} no longer
                  available. Remove {unavailableNames.length === 1 ? "it" : "them"} before
                  printing.
                </p>
              </div>
            )}

            {/* New / unsent items — only unprinted quantities */}
            <div className="max-h-44 overflow-y-auto px-4 py-3">
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {activeOrder == null
                    ? "Tap menu items to add them here."
                    : "No new kitchen quantities."}
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    New items · {newQuantity} qty
                  </p>
                  {rows.map((row) => renderRow(row))}
                </div>
              )}
            </div>

            {/* Optional order note — only visible when it has a purpose */}
            {orderNoteVisible && (
              <div className="px-4 pb-1">
                <Textarea
                  rows={1}
                  value={state.orderNote}
                  onChange={(e) =>
                    dispatch({ type: "SET_ORDER_NOTE", value: e.currentTarget.value })
                  }
                  placeholder="Note for this order (optional)"
                  className="min-h-0 resize-none text-sm"
                />
              </div>
            )}

            {/* Subtotal of the new/unsent items */}
            <div className="flex items-center justify-between border-t border-border/50 px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">
                Subtotal
              </span>
              <span className="text-lg font-semibold">
                {formatPaise(newSubtotalPaise)}
              </span>
            </div>

            {/* Order + KOT actions */}
            <div className="flex flex-col gap-1.5 px-4 pb-4">
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!canSubmit || busy}
                onClick={onPrint}
              >
                <Printer className="size-4" />
                {label}
              </Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!canSave}
                  onClick={onSave}
                >
                  <Save className="size-3.5" />
                  Save order
                </Button>
                {canResume || status === "HELD" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!canResume}
                    onClick={onResume}
                  >
                    <Play className="size-3.5" />
                    Resume order
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!canHold}
                    onClick={onHold}
                  >
                    <Pause className="size-3.5" />
                    Hold order
                  </Button>
                )}
              </div>
              {canMove && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!canMove}
                  onClick={onMove}
                >
                  <MoveRight className="size-3.5" />
                  Move to another table
                </Button>
              )}
              <p className="text-center text-xs text-muted-foreground">{hint}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}