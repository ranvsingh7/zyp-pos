import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KotView } from "@/lib/orders/types";
import { KotStatusBadge } from "./kot-status-badge";

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
    items: [],
    orderNote: null,
    printedAt: "2026-09-23T09:24:00.000Z",
    printedCount: 1,
    createdAt: "2026-09-23T09:24:00.000Z",
    createdBy: "user-1",
    ...overrides,
  };
}

describe("KotStatusBadge", () => {
  it("shows NEW + PRINTED for a normal pending KOT", () => {
    const html = renderToStaticMarkup(
      <KotStatusBadge kot={kotView({ state: "PENDING" })} />
    );
    expect(html).toContain("New");
    expect(html).toContain("Printed");
    expect(html).not.toContain("CANCELLED");
  });

  it("shows NEW + SENT for a normal KOT confirmed by the kitchen", () => {
    const html = renderToStaticMarkup(
      <KotStatusBadge kot={kotView({ state: "SENT" })} />
    );
    expect(html).toContain("New");
    expect(html).toContain("Sent");
    expect(html).not.toContain("Printed");
  });

  it("shows a clearly visible CANCELLED badge for a cancelled KOT", () => {
    const html = renderToStaticMarkup(
      <KotStatusBadge
        kot={kotView({
          status: "CANCELLED",
          cancelledAt: "2026-09-23T09:54:00.000Z",
          cancelledBy: "user-2",
          cancellationReason: "Customer cancelled",
        })}
      />
    );
    expect(html).toContain("CANCELLED");
  });

  it("never shows NEW/PRINTED/SENT as the status of a cancelled KOT", () => {
    const html = renderToStaticMarkup(
      <KotStatusBadge
        kot={kotView({
          status: "CANCELLED",
          cancelledAt: "2026-09-23T09:54:00.000Z",
        })}
      />
    );
    expect(html).not.toContain("New");
    expect(html).not.toContain("Printed");
    expect(html).not.toContain("Sent");
  });
});