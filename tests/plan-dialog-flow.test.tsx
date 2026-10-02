// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Exercises the real `CreatePlanButton` -> `PlanDialog` flow, not a stand-in.
 *
 * The server actions are mocked so this suite only covers the React behaviour
 * of the dialog: it must close on success, stay open on failure, stay open when
 * reopened with a stale successful state, and must never update a component
 * while rendering another.
 *
 * Plan CRUD itself is covered by tests/admin.e2e.test.ts.
 */

const createPlanAction = vi.fn<(form: FormData) => Promise<unknown>>();
const updatePlanAction = vi.fn<(id: string, form: FormData) => Promise<unknown>>();

vi.mock("@/actions/admin/plans", () => ({
  createPlanAction: (form: FormData) => createPlanAction(form),
  updatePlanAction: (id: string, form: FormData) => updatePlanAction(id, form),
  setPlanActiveAction: vi.fn(async () => ({ success: true })),
}));

import { CreatePlanButton, EditPlanButton } from "@/components/admin/plan-actions";
import type { PlanView } from "@/lib/admin/plan-service";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let consoleErrors: string[];

function renderApp(node: React.ReactNode): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(node);
  });
}

function text(): string {
  return document.body.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith(label)
  );
  if (!match) throw new Error(`No button matching "${label}". Buttons: ${text()}`);
  return match as HTMLButtonElement;
}

function dialogPresent(): boolean {
  return document.querySelector('[data-slot="dialog-popup"]') !== null;
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/**
 * Finds the control the way a user does: locate the <label>, follow its
 * `htmlFor` to the input. The dialog renders in a portal, so this goes through
 * `document` rather than the mount host.
 */
function setField(label: string, value: string): void {
  const el = Array.from(document.querySelectorAll("label")).find((l) =>
    (l.textContent ?? "").includes(label)
  );
  if (!el) throw new Error(`No label matching "${label}". Body: ${text()}`);

  const htmlFor = el.getAttribute("for");
  const input = htmlFor
    ? document.getElementById(htmlFor)
    : (el.querySelector("input, textarea") as HTMLInputElement | null);
  if (!input) throw new Error(`Label "${label}" points at no control (for=${htmlFor})`);

  act(() => {
    const proto =
      input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitForm(): void {
  const form = document.querySelector("form");
  if (!form) throw new Error("No form rendered");
  act(() => {
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true })
    );
  });
}

function renderPhaseWarnings(): string[] {
  return consoleErrors.filter((m) =>
    /Cannot update a component|while rendering a different component|Too many re-renders/i.test(
      m
    )
  );
}

/** Flushes the action promise + resulting re-render. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const EXISTING_PLAN: PlanView = {
  planId: "plan-1",
  name: "Silver",
  description: "Silver plan",
  pricePaise: 9900,
  billingCycle: "MONTHLY",
  durationDays: 30,
  gracePeriodDays: 7,
  isFree: false,
  tier: "PAID",
  isActive: true,
  features: ["POS"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as PlanView;

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  createPlanAction.mockReset();
  updatePlanAction.mockReset();
});

afterEach(() => {
  act(() => {
    if (root) root.unmount();
  });
  host?.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("CreatePlanButton -> PlanDialog", () => {
  it("opens, submits successfully, and closes without a render-phase update", async () => {
    createPlanAction.mockResolvedValue({ success: true });
    renderApp(<CreatePlanButton />);

    // Closed to begin with.
    expect(dialogPresent()).toBe(false);

    click(button("Create plan"));
    expect(dialogPresent()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);

    setField("Plan name", "Gold");
    setField("Price", "199");
    submitForm();
    await settle();

    // The dialog closed because the action succeeded.
    expect(dialogPresent()).toBe(false);
    expect(createPlanAction).toHaveBeenCalledTimes(1);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("stays open and shows the error when the submit fails", async () => {
    createPlanAction.mockResolvedValue({
      success: false,
      _errors: { name: ["Plan name is required"] },
    });
    renderApp(<CreatePlanButton />);

    click(button("Create plan"));
    expect(dialogPresent()).toBe(true);

    submitForm();
    await settle();

    expect(dialogPresent()).toBe(true);
    expect(text()).toContain("Plan name is required");
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("reopens and stays open despite the stale successful state", async () => {
    createPlanAction.mockResolvedValue({ success: true });
    renderApp(<CreatePlanButton />);

    click(button("Create plan"));
    setField("Plan name", "Gold");
    setField("Price", "199");
    submitForm();
    await settle();
    expect(dialogPresent()).toBe(false);

    // Reopening must not immediately trip over the retained success state.
    click(button("Create plan"));
    expect(dialogPresent()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);

    // A second, successful submit closes it again.
    setField("Plan name", "Platinum");
    setField("Price", "299");
    submitForm();
    await settle();
    expect(dialogPresent()).toBe(false);
    expect(createPlanAction).toHaveBeenCalledTimes(2);
    expect(renderPhaseWarnings()).toEqual([]);
  });
});

describe("EditPlanButton -> PlanDialog", () => {
  it("closes on a successful edit", async () => {
    updatePlanAction.mockResolvedValue({ success: true });
    renderApp(<EditPlanButton plan={EXISTING_PLAN} />);

    click(button("Edit"));
    expect(dialogPresent()).toBe(true);

    submitForm();
    await settle();

    expect(dialogPresent()).toBe(false);
    expect(updatePlanAction).toHaveBeenCalledTimes(1);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("stays open when the edit fails", async () => {
    updatePlanAction.mockResolvedValue({
      success: false,
      _errors: { pricePaise: ["Price must be a non-negative number"] },
    });
    renderApp(<EditPlanButton plan={EXISTING_PLAN} />);

    click(button("Edit"));
    submitForm();
    await settle();

    expect(dialogPresent()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);
  });
});
