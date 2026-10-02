import { describe, it, expect, vi } from "vitest";

// This test renders the REAL Order Detail page component (the one served at
// /orders/[id]) through the ACTUAL orders-page path: it renders the same
// KOT-history card list and Timeline that the live page does. Server-only and
// browser-only modules are stubbed so the pure render path is exercised.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/actions/orders/actions", () => ({
  cancelOrderAction: vi.fn(),
  printKotAction: vi.fn(),
  reprintKotAction: vi.fn(),
  viewKotAction: vi.fn(),
}));

vi.mock("@/components/billing/billing-panel", () => ({
  BillingPanel: () => null,
}));

vi.mock("@/components/pos/cancel-order-dialog", () => ({
  CancelOrderDialog: () => null,
}));

vi.mock("@/components/menu/toast", () => ({
  ToastView: () => null,
}));

import { renderToStaticMarkup } from "react-dom/server";
import type { KotView, OrderView, StaffMap } from "@/lib/orders/types";
import { formatDateTime } from "@/lib/orders/format";
import { OrderDetail } from "./order-detail";

function kotView(overrides: Partial<KotView> = {}): KotView {
  return {
    id: "kot-1",
    kotNumber: "K-016",
    orderNumber: 1001,
    orderType: "DINE_IN",
    type: "NEW",
    state: "PENDING",
    status: "ACTIVE",
    cancellationReason: null,
    cancelledAt: null,
    cancelledBy: null,
    tableName: "T1",
    customerName: null,
    items: [
      {
        name: "Paneer Tikka",
        variant: null,
        quantity: 2,
        note: null,
        action: "ADDED",
      },
    ],
    orderNote: null,
    printedAt: "2026-09-23T09:24:00.000Z",
    printedCount: 1,
    createdAt: "2026-09-23T09:24:00.000Z",
    createdBy: "user-1",
    ...overrides,
  };
}

function orderView(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: "order-1",
    orderNumber: 1001,
    orderType: "DINE_IN",
    status: "OPEN",
    tableId: "table-1",
    tableNameSnapshot: "T1",
    customerName: "Aarav",
    customerPhone: null,
    items: [
      {
        menuItemId: "item-1",
        nameSnapshot: "Paneer Tikka",
        variantId: null,
        variantNameSnapshot: null,
        hsnSacCode: null,
        quantity: 2,
        unitPricePaise: 45000,
        lineTotalPaise: 90000,
        note: null,
        printedQuantity: 2,
        unsentQuantity: 0,
      },
    ],
    totalPaise: 90000,
    pendingKitchenPrint: null,
    pendingKitchenItems: [],
    discountPaise: 0,
    discountType: null,
    discountValue: null,
    discountReason: null,
    orderNote: null,
    createdBy: "user-1",
    cancelledBy: null,
    createdAt: "2026-09-23T09:20:00.000Z",
    updatedAt: "2026-09-23T09:24:00.000Z",
    heldAt: null,
    resumedAt: null,
    sentToKitchenAt: "2026-09-23T09:24:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
    paidAt: null,
    ...overrides,
  };
}

const staff: StaffMap = {
  "user-1": { fullName: "Anil K", role: "CASHIER" },
  "user-2": { fullName: "Priya M", role: "CASHIER" },
};

const cancelledKot = (overrides: Partial<KotView> = {}) =>
  kotView({
    id: "kot-cancelled",
    status: "CANCELLED",
    cancelledAt: "2026-09-23T09:54:00.000Z",
    cancelledBy: "user-2",
    cancellationReason: "Printed by mistake",
    ...overrides,
  });

function render(kots: KotView[]) {
  return renderToStaticMarkup(
    <OrderDetail
      details={{ order: orderView(), kots, bill: null, staff }}
      canManage={true}
      canCancelBill={true}
      canCancelOrder={true}
    />
  );
}

function timelineAround(html: string, label: string): string {
  const idx = html.indexOf(label);
  if (idx === -1) return "";
  return html.slice(idx, idx + 160);
}

describe("OrderDetail — Orders → Order Details (real page render path)", () => {
  it("shows the visible CANCELLED badge on a cancelled KOT in KOT history", () => {
    const html = render([cancelledKot()]);

    // The ACTUAL POS badge component is used on this page.
    expect(html).toContain("data-testid=\"kot-status-badge\"");
    expect(html).toContain("data-status=\"CANCELLED\"");
    expect(html).toContain(">CANCELLED<");
    expect(html).toContain("K-016");
  });

  it("keeps New + Printed for a normal ACTIVE KOT (no regression)", () => {
    const html = render([kotView({ status: "ACTIVE", state: "PENDING" }), kotView({ status: "ACTIVE", state: "SENT" })]);

    expect(html).toContain(">New<");
    expect(html).toContain(">Printed<");
    expect(html).toContain(">Sent<");
    expect(html).not.toContain(">CANCELLED<");
  });

  it("shows a CANCELLED KOT with printedAt as CANCELLED (never Printed-primary)", () => {
    const html = render([cancelledKot({ printedAt: "2026-09-23T09:24:00.000Z", printedCount: 1 })]);

    // Primary status is the CANCELLED badge — not the New/Printed pair.
    expect(html).toContain(">CANCELLED<");
    expect(html).not.toContain(">New<");
    expect(html).not.toContain(">Printed<");
    // The persisted print time is still listed as detail below the status.
    expect(html).toContain(`Printed ${formatDateTime("2026-09-23T09:24:00.000Z")}`);
  });

  it("renders the Timeline with the Cancelled event using the persisted cancelledAt", () => {
    const html = render([cancelledKot()]);

    expect(html).toContain("KOT K-016 cancelled");
    const cancelledLine = timelineAround(html, "KOT K-016 cancelled");
    const expectedAt = formatDateTime("2026-09-23T09:54:00.000Z");
    expect(cancelledLine).toContain(expectedAt);
    // persisted detail: who + why
    expect(cancelledLine).toContain("Priya M");
    expect(cancelledLine).toContain("Printed by mistake");
  });

  it("does not add a Cancelled timeline event when cancelledAt is missing", () => {
    const html = render([
      kotView({
        status: "CANCELLED",
        cancelledAt: null,
        cancelledBy: "user-2",
        cancellationReason: "void",
      }),
    ]);

    expect(html).not.toContain("KOT K-016 cancelled");
  });

  it("shows the cancellation detail line in KOT history (Cancelled … by … reason)", () => {
    const html = render([cancelledKot()]);

    expect(html).toContain(`Cancelled ${formatDateTime("2026-09-23T09:54:00.000Z")}`);
    expect(html).toContain("by Priya M");
    expect(html).toContain("Printed by mistake");
  });
});