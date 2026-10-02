import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KotView, StaffMap } from "@/lib/orders/types";
import { KotHistory } from "./kot-history";

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

const staff: StaffMap = {
  "user-2": { fullName: "Priya K", role: "CASHIER" },
};

const noop = vi.fn();

describe("KotHistory (POS)", () => {
  beforeEach(() => {
    noop.mockClear();
  });

  it("renders a cancelled KOT card with the CANCELLED badge and full timeline", () => {
    const html = renderToStaticMarkup(
      <KotHistory
        kots={[
          kotView({
            status: "CANCELLED",
            cancelledAt: "2026-09-23T09:54:00.000Z",
            cancelledBy: "user-2",
            cancellationReason: "Printed by mistake",
          }),
        ]}
        busyKotId={null}
        onView={noop}
        onReprint={noop}
        onCancel={noop}
        staff={staff}
      />
    );

    expect(html).toContain("K-016");
    expect(html).toContain("data-status=\"CANCELLED\"");
    expect(html).toContain("CANCELLED");
    expect(html).toContain("Created");
    expect(html).toContain("Printed");
    expect(html).toContain("kot-history-card");
    expect(html).toContain("kot-cancelled-at");
    expect(html).toContain("Cancelled by Priya K");
    // The persisted reason is shown — never invented client-side.
    expect(html).toContain("Reason: Printed by mistake");
    // The original snapshot items stay visible.
    expect(html).toContain("Paneer Tikka");
  });

  it("keeps the cancelled KOT in history (never hidden) alongside active KOTs", () => {
    const html = renderToStaticMarkup(
      <KotHistory
        kots={[
          kotView({ id: "kot-active", status: "ACTIVE" }),
          kotView({
            id: "kot-cancelled",
            status: "CANCELLED",
            cancelledAt: "2026-09-23T09:54:00.000Z",
            cancelledBy: "user-2",
            cancellationReason: "Wrong item",
          }),
        ]}
        busyKotId={null}
        onView={noop}
        onReprint={noop}
        onCancel={noop}
        staff={staff}
      />
    );

    expect(html).toContain("data-status=\"ACTIVE\"");
    expect(html).toContain("data-status=\"CANCELLED\"");
    // Active badges still render their NEW + PRINTED pair (no regression).
    expect(html).toContain("New");
    expect(html).toContain("Printed");
  });

  it("does not render CANCELLED detail for an active KOT", () => {
    const html = renderToStaticMarkup(
      <KotHistory
        kots={[kotView({ status: "ACTIVE" })]}
        busyKotId={null}
        onView={noop}
        onReprint={noop}
        onCancel={noop}
        staff={staff}
      />
    );
    expect(html).not.toContain("kot-cancelled-at");
    expect(html).not.toContain("Cancelled by");
  });
});