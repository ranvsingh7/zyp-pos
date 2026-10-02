// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Regression coverage for the Base UI uncontrolled/default-value warning on
 * /admin/settings:
 *
 *   "Base UI: A component is changing the default value state of an
 *    uncontrolled FieldControl after being initialized."
 *
 * Every field is controlled, so the warning cannot fire. The
 * save -> revalidatePath -> fresh-snapshot render is the trigger this suite
 * exercises, because that is what used to mutate `defaultValue` on already
 * mounted inputs. Server actions are stubbed; persistence and validation are
 * covered by tests/settings.e2e.test.ts.
 */
vi.mock("@/actions/admin/settings", () => ({
  updateSettingsAction: vi.fn(async () => ({ success: true })),
}));

import { SettingsForm } from "@/components/admin/settings-form";
import { updateSettingsAction } from "@/actions/admin/settings";

const mockedUpdateSettingsAction = vi.mocked(updateSettingsAction);

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = React.ComponentProps<typeof SettingsForm>["snapshot"];

const NUMERIC_FIELDS = [
  "trialDurationDays",
  "expiryWarningDays",
  "gracePeriodDays",
] as const;

/** A complete, already-persisted settings document. */
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    trialDurationDays: 14,
    expiryWarningDays: 7,
    gracePeriodDays: 7,
    timezone: "Asia/Kolkata",
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;
let consoleErrors: string[];

/**
 * Base UI's own warning text, plus the two sibling symptoms the same root
 * cause produces (switching to controlled / uncontrolled).
 */
function baseUiValueWarnings(): string[] {
  return consoleErrors.filter((m) =>
    /uncontrolled FieldControl|controlled FieldControl|Elements should not switch from uncontrolled/i.test(
      m
    )
  );
}

function renderForm(snap: Snapshot): void {
  act(() => {
    root.render(<SettingsForm snapshot={snap} />);
  });
}

function field(name: string): HTMLInputElement {
  const el = document.getElementById(name);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`No input #${name}`);
  }
  return el;
}

function setField(name: string, value: string): void {
  const el = field(name);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

describe("SettingsForm controlled value lifecycle", () => {
  it("renders existing saved settings with stable values", () => {
    renderForm(snapshot({ trialDurationDays: 30, gracePeriodDays: 21 }));

    expect(field("trialDurationDays").value).toBe("30");
    expect(field("expiryWarningDays").value).toBe("7");
    expect(field("gracePeriodDays").value).toBe("21");
    expect(field("timezone").value).toBe("Asia/Kolkata");
    expect(baseUiValueWarnings()).toEqual([]);
  });

  it("keeps every field controlled when a save revalidates with a fresh snapshot", () => {
    // Exactly the production flow: updateSettingsAction calls
    // revalidatePath("/admin/settings"), so the page re-renders this component
    // with a new snapshot object while the inputs stay mounted.
    renderForm(snapshot());
    renderForm(snapshot({ gracePeriodDays: 30, timezone: "UTC" }));

    expect(baseUiValueWarnings()).toEqual([]);
  });

  it("keeps every field controlled when optional values are missing", () => {
    // A partially written / pre-migration settings document: values arrive
    // undefined rather than as numbers.
    renderForm(
      snapshot({
        trialDurationDays: undefined as never,
        expiryWarningDays: undefined as never,
        gracePeriodDays: undefined as never,
        timezone: undefined as never,
      })
    );

    for (const name of NUMERIC_FIELDS) {
      expect(field(name).value).not.toBe("");
      expect(field(name).value).toBe("0");
    }
    expect(field("timezone").value).toBe("");
    expect(baseUiValueWarnings()).toEqual([]);
  });

  it("does not flip controlled/uncontrolled when a value arrives late", () => {
    // Settings finish loading after the first paint.
    renderForm(
      snapshot({
        gracePeriodDays: undefined as never,
        timezone: undefined as never,
      })
    );
    renderForm(snapshot({ gracePeriodDays: 30, timezone: "UTC" }));

    expect(baseUiValueWarnings()).toEqual([]);
    // The read-once pattern keeps the admin's working copy; a stale snapshot
    // must not silently re-seed a form mid-edit.
    expect(field("gracePeriodDays").value).toBe("0");
  });

  it("still accepts edits and keeps them across the revalidation re-render", () => {
    renderForm(snapshot());

    setField("gracePeriodDays", "45");
    setField("timezone", "Europe/London");
    expect(field("gracePeriodDays").value).toBe("45");
    expect(field("timezone").value).toBe("Europe/London");

    renderForm(snapshot({ gracePeriodDays: 30, timezone: "UTC" }));

    // The pending edit survives the revalidated snapshot.
    expect(field("gracePeriodDays").value).toBe("45");
    expect(field("timezone").value).toBe("Europe/London");
    expect(baseUiValueWarnings()).toEqual([]);
  });

  it("submits the edited values, not the snapshot values", () => {
    renderForm(snapshot());

    setField("trialDurationDays", "60");
    setField("timezone", "Asia/Singapore");

    const form = document.querySelector("form")!;
    act(() => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(mockedUpdateSettingsAction).toHaveBeenCalledTimes(1);
    const sent = mockedUpdateSettingsAction.mock.calls[0][0] as FormData;
    expect(sent.get("trialDurationDays")).toBe("60");
    expect(sent.get("timezone")).toBe("Asia/Singapore");
    expect(sent.get("gracePeriodDays")).toBe("7");
    expect(baseUiValueWarnings()).toEqual([]);
  });

  it("leaves the min/max contract and field names untouched", () => {
    renderForm(snapshot());

    expect(field("trialDurationDays")).toMatchObject({ min: "0", max: "365" });
    expect(field("expiryWarningDays")).toMatchObject({ min: "0", max: "90" });
    expect(field("gracePeriodDays")).toMatchObject({ min: "0", max: "90" });
    expect(field("timezone").type).toBe("text");
    for (const name of [...NUMERIC_FIELDS, "timezone"]) {
      expect(field(name).name).toBe(name);
    }
  });
});
