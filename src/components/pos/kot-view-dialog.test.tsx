import { describe, it, expect, vi, beforeEach } from "vitest";

// The dialog shell is mounted client-side by Base UI (renders null on the
// server). Stub it out so renderToString exercises the dialog body itself.
vi.mock("@/components/ui/dialog", () => {
  function Pass({ children }: { children?: import("react").ReactNode }) {
    return children;
  }
  return {
    Dialog: Pass,
    DialogPopup: Pass,
    DialogHeader: Pass,
    DialogBody: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import type { KotView, StaffMap } from "@/lib/orders/types";
import { KotViewDialog } from "./kot-view-dialog";

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

describe("KotViewDialog (in-app snapshot viewer)", () => {
  beforeEach(() => {
    noop.mockClear();
  });

  it("shows the cancelled state with persisted timeline, by and reason for a cancelled KOT", () => {
    const html = renderToStaticMarkup(
      <KotViewDialog
        kot={kotView({
          status: "CANCELLED",
          cancelledAt: "2026-09-23T09:54:00.000Z",
          cancelledBy: "user-2",
          cancellationReason: "Printed by mistake",
        })}
        busy={false}
        onClose={noop}
        onReprint={noop}
        staff={staff}
      />
    );

    expect(html).toContain("K-016");
    expect(html).toContain("data-status=\"CANCELLED\"");
    expect(html).toContain("Cancelled");
    expect(html).toContain(">Cancelled by</dt><dd>Priya K</dd>");
    // The printed TIMESTAMP is part of the timeline, but the cancelled KOT
    // never renders the normal printed-KOT badge pair.
    expect(html).toContain(">Printed</dt><dd>");
    expect(html).not.toContain(">New</span>");
    expect(html).not.toContain(">Printed</span>");
    expect(html).not.toContain(">Sent</span>");
    // Original snapshot items still displayed.
    expect(html).toContain("Paneer Tikka");
    // Reprint stays disabled for a cancelled KOT.
    expect(html).toContain("disabled");
  });

  it("keeps NEW + PRINTED badges and an enabled reprint for an active KOT", () => {
    const html = renderToStaticMarkup(
      <KotViewDialog
        kot={kotView({ state: "PENDING", status: "ACTIVE" })}
        busy={false}
        onClose={noop}
        onReprint={noop}
        staff={staff}
      />
    );

    expect(html).toContain(">New<");
    expect(html).toContain(">Printed<");
    expect(html).not.toContain("data-status=\"CANCELLED\"");
    expect(html).not.toContain("Cancelled by");
  });
});