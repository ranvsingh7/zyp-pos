"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  PosProvider,
  usePos,
  cartToPayload,
  orderHasUnsavedEdits,
  makePlainLine,
  makeVariantLine,
} from "@/components/pos/pos-store";
import { TableGrid } from "@/components/pos/table-grid";
import { MenuBrowser } from "@/components/pos/menu-browser";
import { OrderPanel } from "@/components/pos/order-cart";
import { KotViewDialog } from "@/components/pos/kot-view-dialog";
import { CancelKotDialog } from "@/components/pos/cancel-kot-dialog";
import { VariantPickerDialog } from "@/components/pos/variant-picker-dialog";
import { MoveOrderDialog } from "@/components/pos/move-order-dialog";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
} from "lucide-react";
import { ToastView, type ToastData } from "@/components/menu/toast";
import { openPrintWindow, writePrintWindow } from "@/components/orders/orders-print";
import {
  createOrderAction,
  updateOrderAction,
  holdOrderAction,
  resumeOrderAction,
  moveOrderAction,
  printKotAction,
  reprintKotAction,
  cancelKotAction,
  listOrderKotsAction,
} from "@/actions/orders/actions";
import type { ActionResult } from "@/actions/orders/_shared";
import type { MenuItemView, MenuVariantView } from "@/lib/menu/types";
import type { OrderView, KotView, StaffMap } from "@/lib/orders/types";
import type { TableSectionView, TableView } from "@/lib/tables/types";
import type { MenuCategoryView } from "@/lib/menu/types";

export function PosManager({
  sections,
  tables,
  categories,
  items,
  activeOrders,
  heldOrders,
  staff,
  initialTableId,
}: {
  sections: TableSectionView[];
  tables: TableView[];
  categories: MenuCategoryView[];
  items: MenuItemView[];
  activeOrders: OrderView[];
  heldOrders: OrderView[];
  staff: StaffMap;
  initialTableId: string | null;
}) {
  return (
    <PosProvider initialTableId={initialTableId}>
      <PosInner
        sections={sections}
        tables={tables}
        categories={categories}
        items={items}
        activeOrders={activeOrders}
        heldOrders={heldOrders}
        staff={staff}
        initialTableId={initialTableId}
      />
    </PosProvider>
  );
}

function PosInner({
  sections,
  tables,
  categories,
  items,
  activeOrders,
  heldOrders,
  staff,
  initialTableId,
}: {
  sections: TableSectionView[];
  tables: TableView[];
  categories: MenuCategoryView[];
  items: MenuItemView[];
  activeOrders: OrderView[];
  heldOrders: OrderView[];
  staff: StaffMap;
  initialTableId: string | null;
}) {
  const router = useRouter();
  const { state, dispatch } = usePos();

  const [busy, setBusy] = React.useState(false);
  const [busyKotId, setBusyKotId] = React.useState<string | null>(null);
  const [variantPickerItem, setVariantPickerItem] = React.useState<MenuItemView | null>(null);
  const [switchTarget, setSwitchTarget] = React.useState<TableView | null>(null);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [toast, setToast] = React.useState<ToastData | null>(null);
  const toastRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [kots, setKots] = React.useState<KotView[]>([]);
  const [viewKot, setViewKot] = React.useState<KotView | null>(null);
  const [cancelKot, setCancelKot] = React.useState<KotView | null>(null);
  const initialRouteApplied = React.useRef(false);

  const orderId = state.activeOrder?.id ?? null;
  // The KOT history panel mirrors the active order; when that order was just
  // cancelled (emptied), the cancelled order's persisted KOT history stays on
  // screen via lastOrderId so the CANCELLED badge / timeline remain visible.
  const historyOrderId = orderId ?? state.lastOrderId ?? null;
  // Server-computed via the incremental KOT delta logic: null = nothing
  // pending, "ADD" = first print pending, "MODIFY" = new print pending.
  const pendingPrintKind = state.activeOrder?.pendingKitchenPrint ?? null;
  const pendingKitchenItems = state.activeOrder?.pendingKitchenItems ?? [];
  const selectedTableId = state.activeOrder?.tableId ?? state.tableId;
  const selectedTableName =
    tables.find((t) => t.id === selectedTableId)?.name ??
    state.activeOrder?.tableNameSnapshot ??
    null;

  React.useEffect(() => {
    if (initialRouteApplied.current || !initialTableId) return;
    initialRouteApplied.current = true;
    const routeOrder = activeOrders.find((order) => order.tableId === initialTableId);
    if (routeOrder) {
      dispatch({ type: "LOAD_ORDER", order: routeOrder });
    } else if (
      tables.some(
        (table) => table.id === initialTableId && table.status === "AVAILABLE"
      )
    ) {
      dispatch({ type: "SELECT_TABLE", tableId: initialTableId });
    }
  }, [activeOrders, dispatch, initialTableId, tables]);

  React.useEffect(() => {
    if (initialTableId || (!state.activeOrder && !state.tableId)) return;
    dispatch({ type: "NEW_ORDER" });
    setKots([]);
  }, [dispatch, initialTableId, state.activeOrder, state.tableId]);

  const hasUnsavedEdits = orderHasUnsavedEdits(state);

  const refreshKots = React.useCallback(async (id: string | null) => {
    if (!id) {
      setKots([]);
      return;
    }
    const result = await listOrderKotsAction({ orderId: id });
    setKots(result.success ? result.kots ?? [] : []);
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => void refreshKots(historyOrderId), 0);
    return () => clearTimeout(t);
  }, [historyOrderId, refreshKots]);

  const showToast = React.useCallback((kind: ToastData["kind"], message: string) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast({ kind, message });
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  async function runMutation(
    action: () => Promise<ActionResult>,
    successMessage: string,
    onSuccess?: (result: ActionResult) => void
  ): Promise<boolean> {
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) {
        showToast("error", result.message ?? "Action failed.");
        return false;
      }
      showToast("success", successMessage);
      router.refresh();
      onSuccess?.(result);
      return true;
    } catch (error: unknown) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Action failed."
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openTable(table: TableView) {
    const currentId = state.activeOrder?.tableId ?? state.tableId;
    if (currentId === table.id) return;
    const targetOrder = activeOrders.find((o) => o.tableId === table.id);

    if (state.activeOrder) {
      // An order is on screen: warn before discarding any unsaved edits.
      if (hasUnsavedEdits) {
        setSwitchTarget(table);
        return;
      }
      router.push(`/pos?table=${encodeURIComponent(table.id)}`);
      return;
    }

    // Composing a NEW order. Selecting a table only attaches it (the draft
    // cart is preserved), so no warning. Only warn when the target holds an
    // existing order that would replace the draft.
    if (targetOrder && state.cart.length > 0) {
      setSwitchTarget(table);
      return;
    }
    router.push(`/pos?table=${encodeURIComponent(table.id)}`);
  }

  function loadTable(table: TableView) {
    const order = activeOrders.find((o) => o.tableId === table.id);
    if (order) {
      dispatch({ type: "LOAD_ORDER", order });
    } else if (table.status === "AVAILABLE") {
      dispatch({ type: "SELECT_TABLE", tableId: table.id });
    }
  }

  function handleAddItem(item: MenuItemView) {
    if (!item.isAvailable || !item.isActive) return;
    if (item.hasVariants) {
      setVariantPickerItem(item);
      return;
    }
    if (item.basePrice == null) {
      showToast("error", `${item.name} has no price set.`);
      return;
    }
    dispatch({
      type: "ADD_LINE",
      line: makePlainLine(item.id, item.name, item.basePrice),
    });
  }

  function handleVariantSelect(variant: MenuVariantView) {
    const item = variantPickerItem;
    if (!item) return;
    dispatch({
      type: "ADD_LINE",
      line: makeVariantLine(
        item.id,
        item.name,
        variant.id,
        variant.displayName,
        variant.pricePaise
      ),
    });
    setVariantPickerItem(null);
  }

  /**
   * Saves the current cart — creates a new order (DINE_IN / TAKEAWAY /
   * QUICK_SALE) or updates the existing one. Never prints. Returns the saved
   * order, or null on failure.
   */
  async function performSave(options: {
    refresh?: boolean;
    loadIntoState?: boolean;
  } = {}): Promise<OrderView | null> {
    const { refresh = true, loadIntoState = true } = options;
    if (!state.tableId && !state.activeOrder && state.orderType === "DINE_IN") {
      showToast("error", "Select a table first.");
      return null;
    }
    setBusy(true);
    try {
      let saved = state.activeOrder;
      if (state.activeOrder) {
        const result = await updateOrderAction({
          orderId: state.activeOrder.id,
          customerName: state.customerName || undefined,
          customerPhone: state.customerPhone || undefined,
          orderNote: state.orderNote || undefined,
          items: cartToPayload(state.cart),
        });
        if (!result.success) {
          showToast("error", result.message ?? "Order could not be saved.");
          return null;
        }
        saved = result.order ?? state.activeOrder;
        if (loadIntoState) dispatch({ type: "LOAD_ORDER", order: saved });
      } else {
        const result = await createOrderAction({
          orderType: state.orderType,
          tableId:
            state.orderType === "DINE_IN"
              ? state.tableId ?? undefined
              : undefined,
          customerName: state.customerName || undefined,
          customerPhone: state.customerPhone || undefined,
          orderNote: state.orderNote || undefined,
          items: cartToPayload(state.cart),
        });
        if (!result.success) {
          showToast("error", result.message ?? "Order could not be created.");
          return null;
        }
        saved = result.order ?? null;
        if (saved && loadIntoState) dispatch({ type: "LOAD_ORDER", order: saved });
      }
      if (!saved) return null;
      // The server-computed table status / active order list is the source of
      // truth — refresh so the TableGrid and props reflect the mutation right
      // away (switching back to this table must show the current order).
      if (refresh) {
        void refreshKots(saved.id);
        router.refresh();
      }
      return saved;
    } catch (error: unknown) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Order could not be saved."
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const wasNew = state.activeOrder == null;
    const saved = await performSave();
    if (saved) {
      showToast("success", wasNew ? "Order created." : "Order saved.");
    }
  }

  /**
   * Primary action — saves the current cart and then prints the incremental
   * KOT: first print = full order, later prints = only newly added
   * quantities. Never prints automatically.
   */
  async function saveAndPrintKot() {
    // Open the popup synchronously in the click gesture so popup blockers
    // don't swallow the print window after the async server round-trip.
    const win = openPrintWindow();
    if (!win) {
      showToast("error", "Printing could not be started.");
      return;
    }
    const existingOrderId = state.activeOrder?.id ?? null;
    const saved = await performSave({ refresh: false, loadIntoState: false });
    if (!saved) {
      try {
        win.close();
      } catch {
        // ignore
      }
      return;
    }
    setBusy(true);
    try {
      const printed = await printKotAction({ orderId: saved.id });
      if (!printed.success) {
        dispatch({ type: "LOAD_ORDER", order: saved });
        router.refresh();
        win.close();
        showToast("error", printed.message ?? "Order saved, but printing failed.");
        return;
      }
      if (printed.hasPending === false || !printed.html) {
        dispatch({ type: "LOAD_ORDER", order: printed.order ?? saved });
        router.refresh();
        win.close();
        showToast("success", "Order saved — nothing new to print.");
        return;
      }
      writePrintWindow(win, printed.html);
      showToast("success", `KOT ${printed.kotNumber} printed.`);
      if (printed.order) dispatch({ type: "LOAD_ORDER", order: printed.order });
      if (existingOrderId === saved.id) {
        void refreshKots(saved.id);
      } else {
        router.refresh();
      }
    } catch (error) {
      try {
        win.close();
      } catch {
        // ignore
      }
      showToast(
        "error",
        error instanceof Error ? error.message : "Printing could not be started."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleHold() {
    const order = state.activeOrder;
    if (!order) return;
    await runMutation(
      () => holdOrderAction({ orderId: order.id }),
      "Order held.",
      () => {
        dispatch({ type: "NEW_ORDER" });
      }
    );
  }

  async function resumeHeldOrder(order: OrderView) {
    await runMutation(
      () => resumeOrderAction({ orderId: order.id }),
      "Order resumed.",
      (result) => {
        if (result.order) dispatch({ type: "LOAD_ORDER", order: result.order });
      }
    );
  }

  async function handleMove(destination: TableView) {
    const order = state.activeOrder;
    if (!order) return;
    setMoveOpen(false);
    await runMutation(
      () =>
        moveOrderAction({
          orderId: order.id,
          destinationTableId: destination.id,
        }),
      `Order moved to ${destination.name}.`,
      (result) => {
        if (result.order) dispatch({ type: "LOAD_ORDER", order: result.order });
      }
    );
  }

  function handleCancelKot(kot: KotView) {
    if (kot.status === "CANCELLED") {
      showToast("error", "This KOT is already cancelled.");
      return;
    }
    setCancelKot(kot);
  }

  async function confirmCancelKot(reason: string) {
    const kot = cancelKot;
    if (!kot) return;
    setBusyKotId(kot.id);
    try {
      const result = await cancelKotAction({ kotId: kot.id, reason: reason || undefined });
      if (!result.success) {
        showToast("error", result.message ?? "Could not cancel the KOT.");
        return;
      }
      setCancelKot(null);
      showToast("success", `KOT ${kot.kotNumber} cancelled.`);
      // Keep the server-computed props (TableGrid occupancy, active/held order
      // lists) in sync with the cancelled state so switching tables still shows
      // the persisted CANCELLED KOT and any emptied order's table is released.
      router.refresh();
      if (result.orderCancelled) {
        // Cancellation emptied the order: it was cancelled server-side and its
        // table released. Start a fresh order, but keep the cancelled order's
        // persisted KOT history (CANCELLED badge + cancellation timeline) on
        // screen — it must never be silently hidden. The KOT belongs to the
        // order currently on screen (KOT cards are only shown for it).
        const cancelledOrderId = state.activeOrder?.id ?? orderId;
        dispatch({ type: "ORDER_CANCELLED", orderId: cancelledOrderId ?? "" });
        void refreshKots(cancelledOrderId);
      } else if (result.order) {
        // The order survives — reload it so the cart shows the removed
        // quantities and the recomputed pending print / totals.
        dispatch({ type: "LOAD_ORDER", order: result.order });
        void refreshKots(result.order.id);
      } else {
        void refreshKots(orderId);
      }
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not cancel the KOT."
      );
    } finally {
      setBusyKotId(null);
    }
  }

  async function reprintKot(kot: KotView) {
    if (kot.status === "CANCELLED") {
      showToast("error", "A cancelled KOT cannot be reprinted.");
      return;
    }
    // Open the popup synchronously in the click gesture so popup blockers
    // don't swallow the print window after the async server round-trip.
    const win = openPrintWindow();
    if (!win) {
      showToast("error", "Printing could not be started.");
      return;
    }
    setBusyKotId(kot.id);
    try {
      const result = await reprintKotAction({ kotId: kot.id });
      if (!result.success || !result.html) {
        win.close();
        showToast("error", result.message ?? "Could not reprint the KOT.");
        return;
      }
      writePrintWindow(win, result.html);
      showToast("success", `KOT ${kot.kotNumber} sent to printer.`);
      void refreshKots(orderId);
    } catch (error) {
      try {
        win.close();
      } catch {
        // ignore
      }
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not reprint the KOT."
      );
    } finally {
      setBusyKotId(null);
    }
  }

  const workspaceOpen = Boolean(
    state.activeOrder ||
      state.tableId ||
      (initialTableId && tables.some((table) => table.id === initialTableId))
  );

  return (
    <>
      <div
        className={
          workspaceOpen
            ? "grid grid-cols-1 gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)]"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        {!workspaceOpen && (
        <aside className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TableGrid
              sections={sections}
              tables={tables}
              activeOrders={activeOrders}
              heldOrders={heldOrders}
              busy={busy}
              selectedTableId={selectedTableId}
              onOpenTable={openTable}
              onResumeOrder={resumeHeldOrder}
            />
          </div>
        </aside>
        )}

        <section className={workspaceOpen ? "flex min-h-0 flex-col gap-3 overflow-hidden" : "hidden"}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => router.push("/pos")}
          >
            <ArrowLeft className="size-4" />
            Tables
          </Button>
          <MenuBrowser
            categories={categories}
            items={items}
            onAddItem={handleAddItem}
          />
        </section>

        <aside className={workspaceOpen ? "flex min-h-0 w-full flex-col lg:w-[400px] lg:justify-self-end" : "hidden"}>
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <OrderPanel
              className="min-h-0 flex-1"
              items={items}
              busy={busy}
              kots={kots}
              busyKotId={busyKotId}
              pendingPrintKind={pendingPrintKind}
              pendingKitchenItems={pendingKitchenItems}
              tableName={selectedTableName}
              staff={staff}
              onPrint={saveAndPrintKot}
              onSave={handleSave}
              onHold={handleHold}
              onResume={() => state.activeOrder && resumeHeldOrder(state.activeOrder)}
              onMove={() => setMoveOpen(true)}
              onViewKot={(kot) => setViewKot(kot)}
              onReprintKot={(kot) => void reprintKot(kot)}
              onCancelKot={handleCancelKot}
            />
          </div>
        </aside>
      </div>

      <VariantPickerDialog
        open={variantPickerItem !== null}
        item={variantPickerItem}
        onSelect={handleVariantSelect}
        onClose={() => setVariantPickerItem(null)}
      />

      {moveOpen && state.activeOrder && (
        <MoveOrderDialog
          currentTableId={state.activeOrder.tableId}
          tables={tables}
          busy={busy}
          onConfirm={(table) => void handleMove(table)}
          onClose={() => setMoveOpen(false)}
        />
      )}

      {switchTarget && (
        <Dialog open onOpenChange={(o) => !o && setSwitchTarget(null)}>
          <DialogPopup className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="pr-8">Switch to {switchTarget.name}?</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm text-muted-foreground">
                Unprinted changes in the current order will be discarded.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setSwitchTarget(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const target = switchTarget;
                  setSwitchTarget(null);
                  loadTable(target);
                }}
              >
                Switch
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}

      {viewKot && (
        <KotViewDialog
          kot={viewKot}
          busy={busyKotId === viewKot.id}
          staff={staff}
          onClose={() => setViewKot(null)}
          onReprint={(kot) => {
            setViewKot(null);
            void reprintKot(kot);
          }}
        />
      )}

      {cancelKot && (
        <CancelKotDialog
          kot={cancelKot}
          pending={busyKotId === cancelKot.id}
          onConfirm={(reason) => void confirmCancelKot(reason)}
          onClose={() => setCancelKot(null)}
        />
      )}

      <ToastView toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}