// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The server actions are stubbed so this suite exercises the form's React state
 * only. Persistence, validation and the service are covered by
 * tests/settings.e2e.test.ts.
 */
vi.mock("@/actions/settings/actions", () => ({
  updateSettingsAction: vi.fn(async () => ({ success: true })),
  uploadLogoAction: vi.fn(async () => ({ success: true })),
  removeLogoAction: vi.fn(async () => ({ success: true })),
}));

import { SettingsManager } from "@/components/settings/settings-manager";
import type { RestaurantSettingsSnapshot } from "@/lib/settings/settings-service";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Every text input the form renders. */
const TEXT_FIELDS = [
  "name",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "pincode",
  "gstin",
  "billPrefix",
  "kotPrefix",
  "purchasePrefix",
  "serviceChargeRate",
  "upiId",
] as const;

function snapshot(
  overrides: {
    restaurant?: Partial<RestaurantSettingsSnapshot["restaurant"]>;
    billing?: Partial<RestaurantSettingsSnapshot["billing"]>;
  } = {}
): RestaurantSettingsSnapshot {
  return {
    restaurant: {
      name: "Curry House",
      phone: "9876543210",
      email: "curry@restopos.test",
      address: "1 Food St",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      businessType: "Restaurant",
      gstRegistered: true,
      gstin: "27ABCDE1234F1Z5",
      ...overrides.restaurant,
    },
    tax: {
      taxEnabled: true,
      defaultTaxRate: 5,
      cgstRatePercent: 2.5,
      sgstRatePercent: 2.5,
      igstRatePercent: 5,
      gstScheme: "INTRA_STATE",
      taxInclusive: false,
    },
    billing: {
      currency: "INR",
      billPrefix: "BILL",
      kotPrefix: "KOT",
      purchasePrefix: "PUR",
      serviceChargeEnabled: true,
      serviceChargeRate: 5,
      roundOffEnabled: false,
      upiId: "curry@okaxis",
      ...overrides.billing,
    },
    logo: { present: false, mimeType: "", size: 0, updatedAt: "" },
  };
}

/** Mounts the form and returns handles to re-render and read it. */
function mount(next: RestaurantSettingsSnapshot) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  const render = (s: RestaurantSettingsSnapshot) =>
    act(() => {
      root.render(
        React.createElement(SettingsManager, {
          snapshot: s,
          canEdit: true,
          gstRegistered: true,
        })
      );
    });

  render(next);

  return {
    rerender: render,
    input: (name: string) => {
      const el = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!el) throw new Error(`no input named ${name}`);
      return el;
    },
    form: () => host.querySelector("form")!,
    destroy: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/**
 * Sets an input's value the way typing does. React reads the DOM value through
 * its own descriptor, so the native setter is called directly before
 * dispatching the bubbling `input` event its onChange listens for.
 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * Collects everything React and Base UI log while `fn` runs, so the assertions
 * can look for the uncontrolled/controlled warning without muting the console.
 */
function captureWarnings<T>(fn: () => T): { result: T; messages: string[] } {
  const messages: string[] = [];
  const record = (...args: unknown[]) => {
    messages.push(
      args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")
    );
  };
  const errorSpy = vi.spyOn(console, "error").mockImplementation(record);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(record);
  try {
    return { result: fn(), messages };
  } finally {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
}

const CONTROLLED_WARNING =
  /changing the default value state of an uncontrolled FieldControl|uncontrolled input|changing a controlled input|controlled input to be uncontrolled/i;

function controlledWarnings(messages: string[]): string[] {
  return messages.filter((m) => CONTROLLED_WARNING.test(m));
}

let cleanupMount: (() => void) | null = null;

afterEach(() => {
  cleanupMount?.();
  cleanupMount = null;
});

describe("settings form: every field is controlled", () => {
  it("re-rendering with a changed snapshot logs no uncontrolled/controlled warning", () => {
    // The reported bug: a save revalidates /settings, so the server component
    // re-renders SettingsManager with a fresh snapshot. Any field still seeded
    // from `defaultValue` then changes its default value on an input that was
    // already mounted, which Base UI reports as a warning.
    const { messages } = captureWarnings(() => {
      const ui = mount(snapshot());
      cleanupMount = ui.destroy;

      ui.rerender(
        snapshot({
          restaurant: { name: "Curry House Kitchen", gstin: "27ZZZZZ9999Z1Z5" },
          billing: { billPrefix: "INV", upiId: "kitchen@ybl" },
        })
      );
    });

    expect(controlledWarnings(messages)).toEqual([]);
  });

  it("repeated re-renders, as across a save, also stay warning-free", () => {
    const { messages } = captureWarnings(() => {
      const ui = mount(snapshot());
      cleanupMount = ui.destroy;
      ui.rerender(snapshot());
      ui.rerender(snapshot({ restaurant: { name: "Renamed" } }));
      ui.rerender(snapshot({ restaurant: { name: "Renamed Again" } }));
    });

    expect(controlledWarnings(messages)).toEqual([]);
  });

  it("every text field keeps the owner's edits across the snapshot change", () => {
    const ui = mount(snapshot());
    cleanupMount = ui.destroy;

    for (const field of TEXT_FIELDS) {
      type(ui.input(field), `edited-${field}`);
      expect(ui.input(field).value, `${field} should accept typing`).toBe(
        `edited-${field}`
      );
    }

    ui.rerender(
      snapshot({
        restaurant: { name: "Server Renamed" },
        billing: { billPrefix: "SRV" },
      })
    );

    for (const field of TEXT_FIELDS) {
      expect(
        ui.input(field).value,
        `${field} should keep the typed value, not re-seed from the snapshot`
      ).toBe(`edited-${field}`);
    }
  });

  it("every text field starts with a defined string value, never undefined", () => {
    // An input whose value arrives as undefined flips to a real value on the
    // first render that has data, which is the uncontrolled -> controlled
    // transition Base UI warns about. Empty is fine; undefined is not.
    const BLANK = ["email", "gstin", "upiId"];
    const ui = mount(
      snapshot({
        restaurant: { email: "", gstin: "" },
        billing: { upiId: "" },
      })
    );
    cleanupMount = ui.destroy;

    for (const field of TEXT_FIELDS) {
      const value = ui.input(field).value;
      expect(typeof value, `${field} value type`).toBe("string");
      expect(value, `${field} should not be undefined`).not.toBe(undefined);
      if (BLANK.includes(field)) {
        expect(value, `${field} is seeded blank`).toBe("");
      } else {
        expect(value.length, `${field} should be seeded from the snapshot`).toBeGreaterThan(0);
      }
    }
  });

  it("a browser submit still posts the edited values", () => {
    // The form posts FormData to the server action, so every controlled input
    // must keep its `name`.
    const ui = mount(snapshot());
    cleanupMount = ui.destroy;

    type(ui.input("name"), "Edited Name");
    type(ui.input("upiId"), "edited@ybl");
    type(ui.input("billPrefix"), "INV2");

    const data = new FormData(ui.form());
    expect(data.get("name")).toBe("Edited Name");
    expect(data.get("upiId")).toBe("edited@ybl");
    expect(data.get("billPrefix")).toBe("INV2");
  });

  it("blank fields stay blank and do not flip to undefined", () => {
    const ui = mount(snapshot({ restaurant: { email: "" }, billing: { upiId: "" } }));
    cleanupMount = ui.destroy;

    expect(ui.input("email").value).toBe("");
    expect(ui.input("upiId").value).toBe("");

    type(ui.input("email"), "a@b.co");
    type(ui.input("email"), "");
    expect(ui.input("email").value).toBe("");

    const { messages } = captureWarnings(() => {
      ui.rerender(snapshot({ restaurant: { email: "x@y.co" } }));
    });
    expect(controlledWarnings(messages)).toEqual([]);
    // Still the owner's cleared value, not the server's.
    expect(ui.input("email").value).toBe("");
  });
});
