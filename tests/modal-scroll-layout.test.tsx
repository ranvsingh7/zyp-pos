// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Layout contract for the plan + subscription modals.
 *
 * jsdom has no layout engine, so this cannot measure real scroll offsets. What
 * it can do is pin the structural contract that makes the browser behaviour
 * correct, which is exactly the part that regressed:
 *
 *   popup (max-h, overflow-hidden)
 *     └─ form          <- must be a shrinkable flex column
 *          ├─ header    (fixed)
 *          ├─ body      (the only scroll container)
 *          └─ footer    (fixed, always reachable)
 *
 * The bug this guards: the <form> sat between the popup and the body as a plain
 * block with the default `min-height: auto`, so it grew to its content height,
 * the body's `overflow-y-auto` never engaged, and the popup's `overflow-hidden`
 * clipped the footer off the bottom of the screen with no way to scroll to it.
 */

// Accepts and ignores any arguments: the layout contract does not care about
// what a submission would do, only that the dialog renders and can scroll.
const noopAction = vi.fn(async (...args: unknown[]) => {
  void args;
  return { success: true, error: null, fieldErrors: null };
});

vi.mock("@/actions/admin/plans", () => ({
  createPlanAction: (form: FormData) => noopAction(form),
  updatePlanAction: (id: string, form: FormData) => noopAction(form),
  setPlanActiveAction: () => noopAction(),
}));

vi.mock("@/actions/admin/subscriptions", () => ({
  createSubscriptionAction: (form: FormData) => noopAction(form),
  renewSubscriptionAction: (form: FormData) => noopAction(form),
  changeSubscriptionPlanAction: (form: FormData) => noopAction(form),
  changeSubscriptionPricingAction: (form: FormData) => noopAction(form),
  extendSubscriptionExpiryAction: (form: FormData) => noopAction(form),
  suspendSubscriptionAction: (form: FormData) => noopAction(form),
  reactivateSubscriptionAction: (form: FormData) => noopAction(form),
  cancelSubscriptionAction: (form: FormData) => noopAction(form),
  recordPaymentAction: (form: FormData) => noopAction(form),
}));

import { CreatePlanButton, EditPlanButton } from "@/components/admin/plan-actions";
import {
  CreateSubscriptionDialog,
  RenewSubscriptionDialog,
  ChangePlanDialog,
} from "@/components/admin/subscription-actions";
import type { PlanView } from "@/lib/admin/plan-service";
import type { SubscriptionView } from "@/lib/admin/subscription-service";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function plan(id: string, name: string, serviceKeys: PlanView["serviceKeys"]): PlanView {
  return {
    planId: id,
    name,
    description: null,
    pricePaise: 99900,
    billingCycle: "MONTHLY",
    durationDays: 30,
    gracePeriodDays: 3,
    isFree: false,
    tier: "PAID",
    isActive: true,
    features: [],
    serviceKeys,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function subscription(planId: string, planName: string): SubscriptionView {
  return {
    subscriptionId: "sub-1",
    restaurantId: "rest-1",
    restaurantName: "Spice House",
    planId,
    planName,
    billingCycle: "MONTHLY",
    durationDays: 30,
    serviceKeys: ["DASHBOARD", "MENU"],
    isFree: false,
    listPricePaise: 99900,
    discountAmountPaise: 0,
    finalPricePaise: 99900,
    startDate: new Date("2026-01-01"),
    expiryDate: new Date("2026-01-31"),
    gracePeriodDays: 3,
    graceEndDate: new Date("2026-02-03"),
    status: "ACTIVE",
    storedStatus: "ACTIVE",
    daysLeft: 10,
    autoRenew: false,
    notes: null,
    suspendedAt: null,
    suspendedBy: null,
    suspensionReason: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as SubscriptionView;
}

function render(node: React.ReactNode): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(node);
  });
}

function cleanup(): void {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
}

function clickButton(prefix: string): void {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith(prefix)
  );
  if (!btn) {
    throw new Error(
      `No button starting with "${prefix}". Buttons: ${document.body.textContent}`
    );
  }
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function popup(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="dialog-popup"]');
  if (!el) throw new Error("Dialog popup is not open");
  return el;
}

function classes(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * The single assertion that matters for the five modals: the dialog is bounded
 * by the visible viewport, the form can shrink inside it, and the body is the
 * only thing that scrolls while the header and footer stay put.
 */
function expectScrollableDialog(): void {
  const pop = popup();

  // Bounded by the *visible* viewport. `dvh` is what keeps the footer on screen
  // on mobile, where 100vh is taller than the area the user can actually see.
  const popClasses = classes(pop);
  expect(
    popClasses.some((c) => c.includes("max-h-[calc(100dvh-2rem)]")),
    "popup must be bounded by the dynamic viewport height"
  ).toBe(true);
  expect(
    popClasses.some((c) => c.includes("overflow-hidden")),
    "popup must clip instead of growing past the viewport"
  ).toBe(true);
  expect(popClasses).toContain("flex-col");

  // The form is the popup's flex child. It is styled through child variants on
  // the popup rather than classes on the form, so the contract to pin is: the
  // popup ships the rules, and the form is a *direct* child for `>form` to match.
  const form = pop.querySelector("form");
  expect(form, "dialog must wrap its content in a form").not.toBeNull();
  expect(
    form!.parentElement,
    "form must be a direct child of the popup for the flex rules to apply"
  ).toBe(pop);
  for (const rule of [
    "[&>form]:flex",
    "[&>form]:flex-col",
    "[&>form]:min-h-0",
    "[&>form]:flex-1",
  ]) {
    expect(popClasses, `popup must style its form with ${rule}`).toContain(rule);
  }

  const body = pop.querySelector<HTMLElement>('[data-slot="dialog-body"]');
  expect(body, "dialog must have a body").not.toBeNull();
  const bodyClasses = classes(body!);
  expect(bodyClasses, "body is the scroll container").toContain("overflow-y-auto");
  // `min-h-0` is what lets a flex item shrink below its content height; without
  // it the body refuses to scroll no matter what the popup allows.
  expect(bodyClasses, "body must be allowed to shrink").toContain("min-h-0");
  expect(bodyClasses, "body takes the remaining space").toContain("flex-1");
  // Scrolling the body must not chain on to the page behind the dialog.
  expect(bodyClasses).toContain("overscroll-contain");

  // Header and footer sit beside the body, never inside it, so they stay
  // visible while only the content scrolls.
  const header = pop.querySelector('[data-slot="dialog-header"]');
  const footer = pop.querySelector('[data-slot="dialog-footer"]');
  expect(header, "dialog must have a header").not.toBeNull();
  expect(footer, "dialog must have a footer with actions").not.toBeNull();
  expect(body!.contains(header!), "header must not be inside the scroll area").toBe(false);
  expect(body!.contains(footer!), "footer must not be inside the scroll area").toBe(false);

  // Header/footer must not shrink, or the footer buttons get squashed.
  expect(classes(header!)).toContain("shrink-0");
  expect(classes(footer!)).toContain("shrink-0");

  // The body must not scroll sideways on a narrow screen.
  expect(bodyClasses.some((c) => c === "overflow-x-auto" || c === "overflow-x-scroll")).toBe(
    false
  );
}

const PLANS: PlanView[] = [plan("p1", "Pro", ["DASHBOARD", "MENU"]), plan("p2", "Basic", ["DASHBOARD"])];

beforeEach(() => {
  noopAction.mockClear();
});

afterEach(() => {
  if (host?.isConnected) cleanup();
});

describe("plan + subscription dialogs scroll internally", () => {
  it("Create Plan", () => {
    render(<CreatePlanButton />);
    clickButton("Create plan");
    expectScrollableDialog();
    cleanup();
  });

  it("Edit Plan", () => {
    render(<EditPlanButton plan={PLANS[0]} />);
    clickButton("Edit");
    expectScrollableDialog();
    cleanup();
  });

  it("Create Subscription", () => {
    render(
      <CreateSubscriptionDialog
        restaurantId="rest-1"
        restaurantName="Spice House"
        plans={PLANS}
      />
    );
    clickButton("Create subscription");
    expectScrollableDialog();
    cleanup();
  });

  it("Renew Subscription", () => {
    render(
      <RenewSubscriptionDialog
        restaurantId="rest-1"
        restaurantName="Spice House"
        subscription={subscription("p1", "Pro")}
        plans={PLANS}
      />
    );
    clickButton("Renew");
    expectScrollableDialog();
    cleanup();
  });

  it("Change Plan", () => {
    render(
      <ChangePlanDialog
        restaurantId="rest-1"
        subscription={subscription("p1", "Pro")}
        plans={PLANS}
      />
    );
    clickButton("Change plan");
    expectScrollableDialog();
    cleanup();
  });

  it("keeps the submit action reachable below the fold", () => {
    render(<CreatePlanButton />);
    clickButton("Create plan");

    // The regression showed up as a form you could fill in but not submit, so
    // assert the primary action really is in the footer, outside the scroller.
    const footer = popup().querySelector('[data-slot="dialog-footer"]');
    const submit = footer?.querySelector('button[type="submit"]');
    expect(submit, "footer must hold the submit button").not.toBeNull();
    expect(
      (submit?.textContent ?? "").toLowerCase(),
      "submit button must be labelled"
    ).not.toBe("");
    cleanup();
  });

  it("does not open more than one scroll container per dialog", () => {
    render(<CreatePlanButton />);
    clickButton("Create plan");

    // A second scrollable ancestor would trap the user in an inner scroller
    // while the outer one is also trying to scroll.
    const scrollers = Array.from(
      popup().querySelectorAll<HTMLElement>('*')
    ).filter((el) => {
      const c = classes(el);
      return (
        c.some((x) => x === "overflow-y-auto" || x === "overflow-y-scroll" || x === "overflow-auto") &&
        !el.hasAttribute("data-slot")
      );
    });
    // The service picker is allowed its own list; the dialog body is the only
    // page-level scroller.
    expect(scrollers.length).toBeLessThanOrEqual(1);
    cleanup();
  });
});
