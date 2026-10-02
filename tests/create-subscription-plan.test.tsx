// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Regression coverage for
 *   planId: Invalid input: expected string, received null
 * on the Create Subscription dialog.
 *
 * The plan picker is a Base UI Select, which is a composite widget rather than
 * a native <select> and therefore contributes nothing to FormData. The dialog
 * has to mirror the controlled selection into a hidden input; without it
 * `formData.get("planId")` is null and createSubscriptionSchema rejects it.
 *
 * The server actions are stubbed. Plan-driven pricing, the one-per-restaurant
 * rule and plan resolution are covered by tests/admin.e2e.test.ts.
 */
vi.mock("@/actions/admin/subscriptions", () => ({
  createSubscriptionAction: vi.fn(async () => ({ success: true })),
  renewSubscriptionAction: vi.fn(async () => ({ success: true })),
  changeSubscriptionPlanAction: vi.fn(async () => ({ success: true })),
  changeSubscriptionPricingAction: vi.fn(async () => ({ success: true })),
  extendSubscriptionExpiryAction: vi.fn(async () => ({ success: true })),
  suspendSubscriptionAction: vi.fn(async () => ({ success: true })),
  reactivateSubscriptionAction: vi.fn(async () => ({ success: true })),
  cancelSubscriptionAction: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/actions/admin/payments", () => ({
  recordPaymentAction: vi.fn(async () => ({ success: true })),
}));

import { CreateSubscriptionDialog } from "@/components/admin/subscription-actions";
import { createSubscriptionAction } from "@/actions/admin/subscriptions";
import type { PlanView } from "@/lib/admin/plan-service";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockedCreate = vi.mocked(createSubscriptionAction);

const RESTAURANT_ID = "0123456789abcdef01234567";
const PLAN_ID = "fedcba987654321001234567";

function plan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    planId: PLAN_ID,
    name: "Pro",
    description: "Pro plan",
    pricePaise: 100000,
    billingCycle: "MONTHLY",
    durationDays: 30,
    gracePeriodDays: 7,
    isFree: false,
    ...overrides,
  } as unknown as PlanView;
}

let host: HTMLDivElement;
let root: Root;

function renderDialog(plans: PlanView[] = [plan()]): void {
  act(() => {
    root.render(
      <CreateSubscriptionDialog
        restaurantId={RESTAURANT_ID}
        restaurantName="Alpha Kitchen"
        plans={plans}
      />
    );
  });
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** pointerdown -> mouseup -> click, i.e. one real mouse press. */
function press(el: Element): void {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true })
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    );
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function openDialog(): void {
  const trigger = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith("Create subscription")
  );
  if (!trigger) throw new Error("trigger button not found");
  click(trigger);
}

/**
 * Base UI's Select only commits an option on `click` when a preceding
 * `pointerdown` set its allowMouseSelection flag, so the test has to replay the
 * same pointerdown -> click sequence a real mouse produces.
 */
function choosePlan(label: string): void {
  const trigger = document.querySelector('[role="combobox"]');
  if (!trigger) throw new Error("select trigger not found");
  press(trigger);

  const option = Array.from(document.querySelectorAll('[role="option"]')).find(
    (o) => (o.textContent ?? "").includes(label)
  );
  if (!option) {
    throw new Error(
      `No option "${label}". Options: ${Array.from(
        document.querySelectorAll('[role="option"]')
      )
        .map((o) => o.textContent)
        .join(" | ")}`
    );
  }
  press(option);
}

function submit(): void {
  const form = document.querySelector("form");
  if (!form) throw new Error("form not rendered");
  act(() => {
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true })
    );
  });
}

/**
 * Implicit submission: pressing Enter in a text field submits the form even
 * though the submit button is disabled. React turns this into a real submit
 * event, so the dialog's own guard is what stops it.
 */
function submitViaEnter(): void {
  submit();
}

function hiddenField(name: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${name}"]`
  );
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  mockedCreate.mockReset();
  mockedCreate.mockResolvedValue({ success: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("CreateSubscriptionDialog plan selection", () => {
  it("submits the selected plan's real id, never null", () => {
    renderDialog();
    openDialog();
    choosePlan("Pro");
    submit();

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const sent = mockedCreate.mock.calls[0][0] as FormData;
    expect(sent.get("planId")).toBe(PLAN_ID);
    expect(typeof sent.get("planId")).toBe("string");
    expect(sent.get("planId")).not.toBeNull();
    expect(sent.get("restaurantId")).toBe(RESTAURANT_ID);
  });

  it("keeps the hidden planId field in sync with the selection", () => {
    renderDialog([plan(), plan({ planId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Basic" })]);
    openDialog();

    expect(hiddenField("planId")).not.toBeNull();
    expect(hiddenField("planId")!.value).toBe("");

    choosePlan("Basic");
    expect(hiddenField("planId")!.value).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("submits the id of the plan that was actually picked, not the first one", () => {
    renderDialog([
      plan({ planId: "111111111111111111111111", name: "Basic" }),
      plan({ planId: "222222222222222222222222", name: "Standard" }),
      plan({ planId: "333333333333333333333333", name: "Pro" }),
    ]);
    openDialog();
    choosePlan("Standard");
    submit();

    const sent = mockedCreate.mock.calls[0][0] as FormData;
    expect(sent.get("planId")).toBe("222222222222222222222222");
  });

  it("reflects the selection on the trigger instead of the placeholder", () => {
    renderDialog();
    openDialog();
    expect(document.querySelector('[role="combobox"]')?.textContent ?? "").toContain(
      "Select plan"
    );

    choosePlan("Pro");

    // The trigger now reflects a chosen value rather than the placeholder.
    const triggerText = document.querySelector('[role="combobox"]')?.textContent ?? "";
    expect(triggerText).not.toContain("Select plan");
    expect(triggerText).toContain(PLAN_ID);
  });

  it("blocks submission with no plan and shows a message", () => {
    renderDialog();
    openDialog();
    submitViaEnter();

    expect(mockedCreate).not.toHaveBeenCalled();
    expect(bodyText()).toContain("Please select a plan");
  });

  it("keeps the submit button disabled until a plan is chosen", () => {
    renderDialog();
    openDialog();

    const submitButton = Array.from(
      document.querySelectorAll('button[type="submit"]')
    )[0] as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    choosePlan("Pro");
    expect(submitButton.disabled).toBe(false);
  });

  it("clears the plan message once a plan is selected", () => {
    renderDialog();
    openDialog();
    submitViaEnter();
    expect(bodyText()).toContain("Please select a plan");

    choosePlan("Pro");
    expect(bodyText()).not.toContain("Please select a plan");
  });

  it("does not send price, duration or expiry from the client", () => {
    renderDialog();
    openDialog();
    choosePlan("Pro");
    submit();

    const sent = mockedCreate.mock.calls[0][0] as FormData;
    for (const leaked of [
      "pricePaise",
      "finalPricePaise",
      "durationDays",
      "billingCycle",
      "gracePeriodDays",
      "expiresAt",
      "expiryDate",
    ]) {
      expect(sent.get(leaked)).toBeNull();
    }
  });
});
