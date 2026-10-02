import { describe, it, expect } from "vitest";
import type { OrderView } from "@/lib/orders/types";
import { initialState, reducePos } from "./pos-store";

function orderView(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: "order-1001",
    orderNumber: 1001,
    orderType: "DINE_IN",
    status: "OPEN",
    tableId: "table-b1",
    tableNameSnapshot: "B1",
    customerName: "Aarav",
    customerPhone: null,
    items: [],
    totalPaise: 0,
    pendingKitchenPrint: null,
    pendingKitchenItems: [],
    discountPaise: 0,
    discountType: null,
    discountValue: null,
    discountReason: null,
    orderNote: null,
    createdBy: "user-1",
    cancelledBy: null,
    createdAt: "2026-09-24T02:00:00.000Z",
    updatedAt: "2026-09-24T02:00:00.000Z",
    heldAt: null,
    resumedAt: null,
    sentToKitchenAt: null,
    cancelledAt: null,
    cancellationReason: null,
    paidAt: null,
    ...overrides,
  };
}

describe("reducePos ORDER_CANCELLED (POS KOT history retention)", () => {
  it("keeps the cancelled order's id as lastOrderId so its KOT history stays visible", () => {
    const state = reducePos(
      { ...initialState(), activeOrder: orderView(), orderType: "DINE_IN" },
      { type: "ORDER_CANCELLED", orderId: "order-1001" }
    );

    expect(state.lastOrderId).toBe("order-1001");
    // Same fresh-draft reset semantics as NEW_ORDER.
    expect(state.activeOrder).toBeNull();
    expect(state.cart).toEqual([]);
    expect(state.orderType).toBe("DINE_IN");
  });

  it("then LOAD_ORDER takes over the screen and clears the stale history id", () => {
    const cancelled = reducePos(initialState(), {
      type: "ORDER_CANCELLED",
      orderId: "order-1001",
    });
    const next = reducePos(cancelled, {
      type: "LOAD_ORDER",
      order: orderView({ id: "order-1002", status: "OPEN", tableId: "table-b2" }),
    });

    expect(next.activeOrder?.id).toBe("order-1002");
    expect(next.lastOrderId).toBeNull();
  });

  it("NEW_ORDER clears the retained history id (explicit fresh start)", () => {
    const cancelled = reducePos(initialState(), {
      type: "ORDER_CANCELLED",
      orderId: "order-1001",
    });
    const next = reducePos(cancelled, { type: "NEW_ORDER" });

    expect(next.lastOrderId).toBeNull();
    expect(next.activeOrder).toBeNull();
  });

  it("selecting a new session (order type or table) clears the retained id", () => {
    const cancelled = reducePos(initialState(), {
      type: "ORDER_CANCELLED",
      orderId: "order-1001",
    });

    expect(
      reducePos(cancelled, { type: "SET_ORDER_TYPE", orderType: "TAKEAWAY" })
        .lastOrderId
    ).toBeNull();
    expect(
      reducePos(cancelled, { type: "SELECT_TABLE", tableId: "table-b2" })
        .lastOrderId
    ).toBeNull();
  });

  it("survive-cancel path (LOAD_ORDER) keeps the order on screen without stale history", () => {
    const base = reducePos(
      { ...initialState(), activeOrder: orderView() },
      { type: "LOAD_ORDER", order: orderView({ id: "order-1001" }) }
    );
    expect(base.activeOrder?.id).toBe("order-1001");
    expect(base.lastOrderId).toBeNull();
  });
});