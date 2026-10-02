// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Diagnostic: what does the browser actually send?
 *
 * The plan editor renders its services as controlled checkboxes, so the value
 * that reaches the server action is whatever the DOM reports as `checked` at
 * submit time. This captures that exact FormData, which is the only place a
 * "selections vanish" bug can hide.
 */

let captured: FormData | null = null;

vi.mock("@/actions/admin/plans", () => ({
  createPlanAction: (form: FormData) => {
    captured = form;
    return Promise.resolve({ success: true, planId: "p1" });
  },
  updatePlanAction: (planId: string, form: FormData) => {
    captured = form;
    return Promise.resolve({ success: true, planId });
  },
  setPlanActiveAction: () => Promise.resolve({ success: true }),
}));

import { CreatePlanButton } from "@/components/admin/plan-actions";
import { SERVICE_KEYS, listServices } from "@/lib/services/catalog";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
}

function cleanup(): void {
  if (host?.isConnected) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.innerHTML = "";
  captured = null;
}

function checkboxFor(labelText: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll("label")).find((l) =>
    (l.textContent ?? "").includes(labelText)
  );
  if (!label) throw new Error(`No checkbox labelled "${labelText}"`);
  const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error(`Label "${labelText}" has no checkbox`);
  return input;
}

/** Clicks exactly like a user, respecting a disabled control. */
function toggle(labelText: string): void {
  const input = checkboxFor(labelText);
  if (input.disabled) throw new Error(`"${labelText}" is disabled and cannot be clicked`);
  act(() => {
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function submittedServiceKeys(): string[] {
  if (!captured) throw new Error("Form was never submitted");
  return captured.getAll("serviceKeys").map(String);
}

function submit(): void {
  const form = document.querySelector("form");
  if (!form) throw new Error("No form rendered");
  act(() => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
}

function openCreatePlan(): void {
  render(<CreatePlanButton />);
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith("Create plan")
  )!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(cleanup);

describe("plan editor -> FormData", () => {
  it("reports the catalogued services and their enabled state", () => {
    const services = listServices();
    console.log(
      "CATALOG:",
      services.map((s) => `${s.key}${s.enabled ? "" : "(disabled)"}`).join(", ")
    );
    console.log("TOTAL KEYS:", SERVICE_KEYS.length);
    // Recorded for the report; not an assertion about future catalog growth.
    expect(services.length).toBe(SERVICE_KEYS.length);
  });

  it("submits the pre-checked Basic selection with no interaction at all", () => {
    openCreatePlan();
    // The plan editor opens with the Basic set already ticked. Saving without
    // touching anything must still send those five keys.
    submit();
    const sent = submittedServiceKeys();
    console.log("UNTOUCHED SUBMIT:", JSON.stringify(sent));
    expect([...sent].sort()).toEqual(["DASHBOARD", "MENU", "ORDERS", "POS", "TABLES"]);
  });

  it("omits a service once the admin unticks it", () => {
    openCreatePlan();
    // Unticking is what a user does to REMOVE a service, not to add one.
    const before = checkboxFor("POS");
    expect(before.checked, "POS starts ticked").toBe(true);
    toggle("POS");
    submit();
    const sent = submittedServiceKeys();
    console.log("AFTER UNTICK POS:", JSON.stringify(sent));
    expect(sent).not.toContain("POS");
    expect(sent).toEqual(["DASHBOARD", "MENU", "TABLES", "ORDERS"]);
  });

  it("adds a service the admin ticks, and sends real catalog keys only", () => {
    openCreatePlan();
    toggle("Inventory");
    submit();
    const sent = submittedServiceKeys();
    console.log("AFTER TICK INVENTORY:", JSON.stringify(sent));
    expect(sent).toContain("INVENTORY");
    for (const value of sent) {
      expect(SERVICE_KEYS as readonly string[]).toContain(value);
    }
    // No display names, no indexes, no stray boolean flags.
    for (const value of sent) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it("keeps ticked state across re-render, so a stale render cannot clear it", () => {
    openCreatePlan();
    toggle("Inventory");
    // Force a re-render pass; a state that reset to [] would show up here.
    act(() => {
      root.render(<CreatePlanButton />);
    });
    submit();
    console.log("AFTER RERENDER:", JSON.stringify(submittedServiceKeys()));
    expect(submittedServiceKeys()).toContain("INVENTORY");
  });
});
