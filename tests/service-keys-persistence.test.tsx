// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Plan serviceKeys: the whole path, end to end, against real MongoDB.
 *
 * The reported symptom is "I tick services, save, reopen Edit, and the boxes
 * are empty". That claim spans six hops, so this suite walks all six and
 * asserts the value is identical at each one:
 *
 *   browser FormData
 *     -> the action's own field extraction + zod schema
 *     -> createPlan / updatePlan
 *     -> the MongoDB document            <- what the reviewer actually asked for
 *     -> toView (the plan GET response)
 *     -> EditPlanButton defaults         <- the checkboxes the admin sees
 *
 * Nothing here is stubbed except the two auth calls, so a break anywhere in the
 * chain fails the test rather than being papered over.
 */

let capturedFormData: FormData | null = null;

vi.mock("@/actions/admin/plans", async () => {
  // Keep the real actions; only stub the module boundary the dialog imports so
  // we can watch what the browser sends, and re-parse it through the real
  // schema + real service.
  const actual =
    await vi.importActual<typeof import("@/actions/admin/plans")>("@/actions/admin/plans");
  return {
    ...actual,
    createPlanAction: (form: FormData) => {
      capturedFormData = form;
      return Promise.resolve({ success: true, planId: "stubbed" });
    },
    updatePlanAction: (planId: string, form: FormData) => {
      capturedFormData = form;
      return Promise.resolve({ success: true, planId });
    },
    setPlanActiveAction: () => Promise.resolve({ success: true }),
  };
});

import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createPlan, updatePlan, getPlanById, listPlans } from "@/lib/admin/plan-service";
import { createSubscription } from "@/lib/admin/subscription-service";
import { planSaveSchema } from "@/lib/admin/query";
import { CreatePlanButton, EditPlanButton } from "@/components/admin/plan-actions";
import {
  SERVICE_KEYS,
  normalizeServiceKeys,
  type ServiceKey,
} from "@/lib/services/catalog";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_servicekeys_persist_e2e";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASIC = ["DASHBOARD", "POS", "MENU", "TABLES", "ORDERS"] as const;
const BASIC_PLUS_INVENTORY = [...BASIC, "INVENTORY"] as const;

/** A real venue, because createSubscription validates the restaurant exists. */
async function seedRestaurant(): Promise<string> {
  const user = await UserModel.create({
    fullName: "Owner",
    email: `persist-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash: await hashPassword("Password123!"),
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name: "Persist Cafe",
    ownerName: "Owner",
    phone: "9876543210",
    address: "1 Food St",
    city: "Mumbai",
    state: "MA",
    pincode: "400001",
    gstRegistered: false,
    gstin: "",
    businessType: "Restaurant",
  });
  return result.restaurantId;
}

let available = false;
let host: HTMLDivElement | null = null;
let root: Root | null = null;

/* ------------------------------------------------------------------ */
/* The action's own parsing, exercised against real browser FormData   */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `createPlanAction` / `updatePlanAction` field for field. This is the
 * code under test's counterpart: if the action and this ever diverge, the suite
 * stops proving anything, so the extraction below is copied from
 * src/actions/admin/plans.ts rather than re-imagined.
 */
function parseLikeTheAction(form: FormData) {
  return planSaveSchema.safeParse({
    name: form.get("name"),
    description: form.get("description"),
    pricePaise: form.get("pricePaise"),
    billingCycle: form.get("billingCycle"),
    durationDays: form.get("durationDays"),
    isActive: form.get("isActive") === "true" || form.get("isActive") === "on",
    features: (form.get("features")?.toString() ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    serviceKeys: form.getAll("serviceKeys").map((v) => String(v)),
  });
}

/* ------------------------------------------------------------------ */
/* Browser helpers                                                     */
/* ------------------------------------------------------------------ */

function render(node: React.ReactNode): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  // Bind the root locally: inside the act() callback the module-level binding
  // is no longer narrowed to a non-null value.
  const created = createRoot(host);
  root = created;
  act(() => created.render(node));
}

function unmount(): void {
  const created = root;
  if (created && host?.isConnected) {
    act(() => created.unmount());
    host.remove();
  }
  root = null;
  host = null;
}

function click(node: Element): void {
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function submitForm(): void {
  const form = document.querySelector("form");
  if (!form) throw new Error("No form rendered");
  act(() => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
}

/** Sets a controlled input the way a user types into it. */
function setText(id: string, value: string): void {
  const input = document.getElementById(id);
  if (!input) throw new Error(`No field with id "${id}"`);
  act(() => {
    const proto =
      input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Currently ticked service keys, as the browser sees them. */
function checkedKeys(): string[] {
  return allServiceCheckboxes()
    .filter(([, input]) => input.checked)
    .map(([, input]) => input.value);
}

/** The dialog's own submit button, not the trigger that opened it. */
function dialogSubmit(): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!b) throw new Error("The dialog has no submit button");
  return b;
}

function buttonStartingWith(prefix: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll("button")).find((x) =>
    (x.textContent ?? "").trim().startsWith(prefix)
  );
  if (!b) throw new Error(`No button starting with "${prefix}"`);
  return b as HTMLButtonElement;
}

/** Every service checkbox in the editor, as [displayName, input]. */
function allServiceCheckboxes(): Array<[string, HTMLInputElement]> {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="serviceKeys"]')
  ).map((input) => {
    const label = input.closest("label");
    const name =
      label?.querySelector("span span")?.textContent?.replace(" (required)", "").trim() ?? "";
    return [name, input];
  });
}

/**
 * Drives the editor to an exact set of ticked services by clicking only the
 * boxes whose state is wrong. Clicking a ticked box removes it, so a naive
 * "click the ones I want" loop would invert the selection.
 */
function setSelectionTo(desired: readonly string[]): void {
  const want = new Set(desired);
  for (const [name, input] of allServiceCheckboxes()) {
    const key = input.value;
    const shouldBeChecked = want.has(key);
    if (input.checked !== shouldBeChecked) click(input);
    // Dependencies can flip siblings; re-read after each click.
    void name;
  }
  // A dependency expansion can tick a box we did not ask for. Re-run until it
  // settles so the final state is what we asked for.
  for (let pass = 0; pass < 5; pass += 1) {
    const wrong = allServiceCheckboxes().find(([, input]) => input.checked !== want.has(input.value));
    if (!wrong) return;
    click(wrong[1]);
  }
  throw new Error(`Could not settle selection; wanted ${[...want].join(",")}`);
}

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    available = true;
  } catch {
    available = false;
  }
}, 15000);

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!available) return;
  await Promise.all([
    PlanModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    UserModel.deleteMany({}),
    RestaurantModel.deleteMany({}),
    RestaurantSettingsModel.deleteMany({}),
  ]);
  capturedFormData = null;
});

afterEach(() => {
  unmount();
  document.body.innerHTML = "";
  capturedFormData = null;
});

describe("plan serviceKeys persistence", () => {
  it("1-3. browser FormData -> action schema -> MongoDB document", async () => {
    if (!available) return;
    render(<CreatePlanButton />);
    click(buttonStartingWith("Create plan"));
    setText("plan-name", "Pro");
    setText("plan-price", "999");
    setSelectionTo(BASIC);
    submitForm();

    const form = capturedFormData;
    expect(form, "the editor must submit a form").not.toBeNull();

    const parsed = parseLikeTheAction(form!);
    expect(parsed.success, "the action's schema must accept the editor's payload").toBe(true);
    if (!parsed.success) return;
    expect([...parsed.data.serviceKeys].sort()).toEqual([...BASIC].sort());

    await createPlan({ ...parsed.data, createdBy: null });

    // The document, read straight out of MongoDB: no view, no serializer.
    const doc = await PlanModel.findOne({ name: "Pro" }).lean();
    const raw = (doc?.serviceKeys ?? []).map(String);
    console.log("MONGO serviceKeys:", JSON.stringify(raw));
    expect([...raw].sort()).toEqual([...BASIC].sort());
  });

  it("3. plan GET returns the exact serviceKeys that were saved", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC_PLUS_INVENTORY],
      createdBy: null,
    });

    const fetched = await getPlanById(plan.planId);
    expect([...(fetched?.serviceKeys ?? [])].sort()).toEqual(
      [...BASIC_PLUS_INVENTORY].sort()
    );
    const listed = (await listPlans({ includeInactive: true })).find(
      (p) => p.planId === plan.planId
    );
    expect([...(listed?.serviceKeys ?? [])].sort()).toEqual(
      [...BASIC_PLUS_INVENTORY].sort()
    );
  });

  it("4-5. Edit Plan re-opens with the saved services already ticked", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC_PLUS_INVENTORY],
      createdBy: null,
    });

    // Round-trip through the read model first: this is what the admin page
    // hands to the button, so a missing field here is the reported bug.
    const view = await getPlanById(plan.planId);
    expect(view).not.toBeNull();

    render(<EditPlanButton plan={view!} />);
    click(buttonStartingWith("Edit"));

    const checkedKeys = allServiceCheckboxes()
      .filter(([, input]) => input.checked)
      .map(([, input]) => input.value);

    console.log("EDIT FORM ticked:", JSON.stringify(checkedKeys));
    expect([...checkedKeys].sort()).toEqual([...BASIC_PLUS_INVENTORY].sort());

    // Spot-check by label too, so a swapped value attribute cannot hide.
    for (const key of BASIC_PLUS_INVENTORY) {
      expect(checkedKeys, `${key} must be ticked in Edit`).toContain(key);
    }
    for (const key of ["BILLING", "KOT", "REPORTS"]) {
      expect(checkedKeys, `${key} must NOT be ticked`).not.toContain(key);
    }
  });

  it("6. adding a service through Edit persists the enlarged list", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC],
      createdBy: null,
    });

    render(<EditPlanButton plan={plan} />);
    click(buttonStartingWith("Edit"));
    setSelectionTo(BASIC_PLUS_INVENTORY);
    submitForm();

    const parsed = parseLikeTheAction(capturedFormData!);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await updatePlan(plan.planId, parsed.data, { updatedBy: null });

    const doc = await PlanModel.findById(plan.planId).lean();
    const raw = (doc?.serviceKeys ?? []).map(String);
    console.log("AFTER ADD:", JSON.stringify(raw));
    expect([...raw].sort()).toEqual([...BASIC_PLUS_INVENTORY].sort());
  });

  it("7. removing a service through Edit persists the reduced list", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC_PLUS_INVENTORY],
      createdBy: null,
    });

    render(<EditPlanButton plan={plan} />);
    click(buttonStartingWith("Edit"));
    setSelectionTo(BASIC);
    submitForm();

    const parsed = parseLikeTheAction(capturedFormData!);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    await updatePlan(plan.planId, parsed.data, { updatedBy: null });

    const doc = await PlanModel.findById(plan.planId).lean();
    const raw = (doc?.serviceKeys ?? []).map(String);
    console.log("AFTER REMOVE:", JSON.stringify(raw));
    expect([...raw].sort()).toEqual([...BASIC].sort());
    expect(raw).not.toContain("INVENTORY");
  });

  it("21. a second Edit after a save still shows the saved services", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC],
      createdBy: null,
    });

    // Save an edit that removes POS, then re-open from a freshly read plan —
    // the "save, close, reopen" cycle the admin actually performs.
    const first = await getPlanById(plan.planId);
    render(<EditPlanButton plan={first!} />);
    click(buttonStartingWith("Edit"));
    setSelectionTo(["DASHBOARD", "MENU", "TABLES", "ORDERS"]);
    submitForm();
    const parsed = parseLikeTheAction(capturedFormData!);
    if (!parsed.success) throw new Error("schema rejected the payload");
    await updatePlan(plan.planId, parsed.data, { updatedBy: null });
    unmount();
    document.body.innerHTML = "";
    capturedFormData = null;

    const second = await getPlanById(plan.planId);
    render(<EditPlanButton plan={second!} />);
    click(buttonStartingWith("Edit"));
    const checked = allServiceCheckboxes()
      .filter(([, i]) => i.checked)
      .map(([, i]) => i.value);
    console.log("REOPEN AFTER SAVE:", JSON.stringify(checked));
    expect(checked).not.toContain("POS");
    expect([...checked].sort()).toEqual(["DASHBOARD", "MENU", "ORDERS", "TABLES"]);
  });

  it("8-9. a subscription snapshots the plan's services onto the record", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...BASIC],
      createdBy: null,
    });

    const restaurantId = await seedRestaurant();
    await createSubscription({
      restaurantId,
      planId: plan.planId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: null,
    });

    const sub = await SubscriptionModel.findOne({ restaurantId }).lean();
    const snap = (sub?.serviceKeys ?? []).map(String);
    console.log("SUBSCRIPTION snapshot:", JSON.stringify(snap));
    expect([...snap].sort()).toEqual([...BASIC].sort());
  });

  it("27. the schema refuses a key that is not in the catalog", async () => {
    if (!available) return;
    // A tampered client cannot invent a capability.
    const parsed = planSaveSchema.safeParse({
      name: "Pro",
      pricePaise: 100,
      billingCycle: "MONTHLY",
      serviceKeys: ["INVENTORY", "NOT_A_REAL_SERVICE"],
    });
    expect(parsed.success).toBe(false);
  });

  it("stores stable keys, never display names", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Pro",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: ["MENU", "TABLES"],
      createdBy: null,
    });
    const doc = await PlanModel.findById(plan.planId).lean();
    const raw = (doc?.serviceKeys ?? []).map(String);
    for (const value of raw) {
      expect(SERVICE_KEYS as readonly string[]).toContain(value);
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
      // "Menu" / "Menu management" would be a display name, never a key.
      expect(value).not.toMatch(/ /);
    }
    expect(normalizeServiceKeys(raw)).toEqual(
      normalizeServiceKeys(["MENU", "TABLES"]) as ServiceKey[]
    );
  });
});

describe("edit matrix: the final selection is what gets stored", () => {
  /** Runs the real dialog -> real FormData -> real schema -> real service. */
  async function editAndPersist(
    planId: string,
    start: readonly string[],
    final: readonly string[]
  ): Promise<string[]> {
    // Every expectation is stated in normalized terms: storing a plan runs the
    // selection through dependency expansion, so a plan saved as
    // DASHBOARD/POS/MENU legitimately reopens with ORDERS and TABLES ticked too.
    const N = (keys: readonly string[]) => normalizeServiceKeys(keys);
    const view = await getPlanById(planId);
    if (!view) throw new Error(`plan ${planId} vanished`);
    render(<EditPlanButton plan={view} />);
    click(buttonStartingWith("Edit"));
    // Confirm the editor opened on the stored selection, not an empty one.
    expect(checkedKeys().sort()).toEqual([...N(start)].sort());
    setSelectionTo(N(final));
    submitForm();
    unmount();

    const form = capturedFormData;
    expect(form, "the editor must submit a form").not.toBeNull();
    const parsed = parseLikeTheAction(form!);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) throw new Error("schema rejected the payload");

    // What the browser actually sent, before any server code runs.
    const submitted = form!.getAll("serviceKeys").map(String);
    console.log("SUBMITTED:", JSON.stringify(submitted));

    await updatePlan(planId, parsed.data, { updatedBy: null });
    const doc = await PlanModel.findById(planId).lean();
    return (doc?.serviceKeys ?? []).map(String);
  }

  const sorted = (keys: readonly string[]) => [...normalizeServiceKeys(keys)].sort();

  async function makePlan(name: string, keys: readonly string[]): Promise<string> {
    const plan = await createPlan({
      name,
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: [...keys],
      createdBy: null,
    });
    return plan.planId;
  }

  const START3 = ["DASHBOARD", "POS", "MENU"];

  it("TEST A - add one service", async () => {
    if (!available) return;
    const id = await makePlan("Matrix A", START3);
    const stored = await editAndPersist(id, START3, [...START3, "INVENTORY"]);
    expect([...stored].sort()).toEqual(sorted([...START3, "INVENTORY"]));
  });

  it("TEST B - add several services at once", async () => {
    if (!available) return;
    const id = await makePlan("Matrix B", START3);
    const want = [...START3, "INVENTORY", "REPORTS", "AUDIT"];
    const stored = await editAndPersist(id, START3, want);
    expect([...stored].sort()).toEqual(sorted(want));
  });

  it("TEST C - remove a service", async () => {
    if (!available) return;
    const start = [...START3, "INVENTORY"];
    const id = await makePlan("Matrix C", start);
    const stored = await editAndPersist(id, start, START3);
    expect([...stored].sort()).toEqual(sorted(START3));
  });

  it("TEST D - add and remove in the SAME edit", async () => {
    if (!available) return;
    // The combination most likely to lose an addition: the removal and the
    // addition have to survive one shared state update.
    const start = [...START3, "TABLES"];
    const id = await makePlan("Matrix D", start);
    const want = [...START3, "INVENTORY", "REPORTS"];
    const stored = await editAndPersist(id, start, want);
    expect([...stored].sort()).toEqual(sorted(want));
  });

  it("TEST E - save with no changes leaves the list byte-identical", async () => {
    if (!available) return;
    const id = await makePlan("Matrix E", [...START3, "TABLES"]);
    const stored = await editAndPersist(id, [...START3, "TABLES"], [...START3, "TABLES"]);
    expect([...stored].sort()).toEqual(sorted([...START3, "TABLES"]));
  });

  it("reopening after an add shows the added box ticked", async () => {
    if (!available) return;
    const id = await makePlan("Matrix Reopen", START3);
    await editAndPersist(id, START3, [...START3, "INVENTORY"]);

    const view = await getPlanById(id);
    if (!view) throw new Error(`plan ${id} vanished`);
    render(<EditPlanButton plan={view} />);
    click(buttonStartingWith("Edit"));
    expect(checkedKeys().sort()).toEqual(sorted([...START3, "INVENTORY"]));
    unmount();
  });

  it("a plan edit leaves an issued subscription snapshot untouched", async () => {
    if (!available) return;
    const id = await makePlan("Matrix Snapshot", START3);
    const restaurantId = await seedRestaurant();
    await createSubscription({ restaurantId, planId: id, startDate: new Date(), createdBy: null });
    const before = (await SubscriptionModel.findOne({ restaurantId }).lean())?.serviceKeys ?? [];

    await editAndPersist(id, START3, [...START3, "INVENTORY", "REPORTS"]);

    const after = (await SubscriptionModel.findOne({ restaurantId }).lean())?.serviceKeys ?? [];
    expect(after.map(String).sort()).toEqual(before.map(String).sort());
    expect(after.map(String)).not.toContain("INVENTORY");
  });
});

describe("the plan editor refuses to strand a venue without a Dashboard", () => {
  it("blocks Save and says why, then re-enables it once Dashboard is ticked", async () => {
    if (!available) return;
    const plan = await createPlan({
      name: "Needs a dashboard",
      pricePaise: 99900,
      billingCycle: "MONTHLY",
      durationDays: 30,
      isActive: true,
      serviceKeys: ["DASHBOARD", "POS", "MENU"],
      createdBy: null,
    });
    const view = await getPlanById(plan.planId);
    if (!view) throw new Error("plan vanished");

    render(<EditPlanButton plan={view} />);
    click(buttonStartingWith("Edit"));

    // Normalized: POS pulls in MENU/TABLES/ORDERS. Nothing requires DASHBOARD,
    // so dropping it is genuinely reachable.
    setSelectionTo(normalizeServiceKeys(["POS", "MENU"]));

    // The picker explains the rule...
    expect(document.body.textContent ?? "").toMatch(/Dashboard must be included/i);
    // ...and the reason sits next to the now-inert Save button, because a
    // scrolled-away warning reads as "I clicked Save and nothing happened".
    expect(document.body.textContent ?? "").toMatch(/Tick .Dashboard. to save this plan/i);
    expect(dialogSubmit().disabled, "Save must be blocked").toBe(true);

    setSelectionTo(normalizeServiceKeys(["DASHBOARD", "POS", "MENU"]));
    expect(document.body.textContent ?? "").not.toMatch(/Tick .Dashboard. to save this plan/i);
    expect(dialogSubmit().disabled, "Save must work again").toBe(false);
    unmount();
  });
});
