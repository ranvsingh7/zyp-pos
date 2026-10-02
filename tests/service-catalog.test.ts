/**
 * Service catalog and entitlement-resolution rules.
 *
 * These are the pure functions every gate in the product ultimately depends on,
 * so they are tested without a database: navigation filtering, page guards,
 * server actions and API handlers all funnel through the same
 * `resolveEntitledServices` decision.
 */
import { describe, it, expect } from "vitest";
import {
  BASIC_DEFAULT_SERVICE_KEYS,
  SERVICE_KEYS,
  LEGACY_SUBSCRIPTION_SERVICE_KEYS,
  expandServiceKeys,
  getService,
  isServiceKey,
  listActiveServices,
  missingDependencies,
  normalizeServiceKeys,
  resolveEntitledServices,
  serviceForRoute,
  serviceName,
  type ServiceKey,
} from "@/lib/services/catalog";

describe("service catalog", () => {
  it("exposes every service named in the specification", () => {
    const expected: readonly ServiceKey[] = [
      "DASHBOARD",
      "POS",
      "MENU",
      "TABLES",
      "ORDERS",
      "BILLING",
      "KOT",
      "INVENTORY",
      "REPORTS",
      "AUDIT",
      "CUSTOMERS",
      "DIGITAL_MENU",
      "QR_ORDERING",
      "ONLINE_ORDERING",
      "KDS",
      "API_INTEGRATION",
    ];
    expect(SERVICE_KEYS).toEqual(expected);
    for (const key of expected) {
      expect(isServiceKey(key)).toBe(true);
      expect(getService(key).name).toBeTruthy();
    }
  });

  it("rejects unknown keys rather than storing them", () => {
    expect(isServiceKey("TELEPORTATION")).toBe(false);
    expect(isServiceKey(undefined)).toBe(false);
    expect(isServiceKey(7)).toBe(false);
    expect(normalizeServiceKeys(["POS", "TELEPORTATION", "MENU"])).toEqual([
      "POS",
      "MENU",
      "TABLES",
      "ORDERS",
    ]);
  });

  it("keeps unimplemented services inactive so plans cannot sell them", () => {
    const active = listActiveServices().map((s) => s.key);
    expect(active).not.toContain("CUSTOMERS");
    expect(active).not.toContain("KDS");
    expect(active).toContain("POS");
    expect(active).toContain("REPORTS");
    // Audit is implemented and now sellable, and it is deliberately absent from
    // the legacy fallback so un-migrated venues are not handed it for free.
    expect(active).toContain("AUDIT");
    expect(LEGACY_SUBSCRIPTION_SERVICE_KEYS).not.toContain("AUDIT");
  });

  it("normalizes to a stable, de-duplicated, dependency-complete order", () => {
    // POS drags in MENU, TABLES and ORDERS regardless of the order given, and
    // two equivalent selections serialize identically.
    expect(normalizeServiceKeys(["POS"])).toEqual(["POS", "MENU", "TABLES", "ORDERS"]);
    expect(normalizeServiceKeys(["POS", "MENU", "TABLES", "ORDERS"])).toEqual([
      "POS",
      "MENU",
      "TABLES",
      "ORDERS",
    ]);
    expect(normalizeServiceKeys(["REPORTS", "POS", "REPORTS"])).toEqual([
      "POS",
      "MENU",
      "TABLES",
      "ORDERS",
      "REPORTS",
    ]);
  });

  it("treats a missing or non-array selection as granting nothing", () => {
    expect(normalizeServiceKeys(undefined)).toEqual([]);
    expect(normalizeServiceKeys(null)).toEqual([]);
    expect(normalizeServiceKeys("POS" as unknown as string[])).toEqual([]);
  });

  it("applies POS and KOT dependencies transitively", () => {
    // Catalog order, not selection order, so stored values are comparable.
    expect(expandServiceKeys(["KOT"])).toEqual(["ORDERS", "KOT"]);
    expect(expandServiceKeys(["POS"])).toEqual(["POS", "MENU", "TABLES", "ORDERS"]);
  });

  it("reports dependencies the admin did not pick explicitly", () => {
    // Selecting POS alone implies three more; the editor can say so.
    expect(missingDependencies(["POS"])).toEqual([
      { key: "POS", requires: ["MENU", "TABLES", "ORDERS"] },
    ]);
    // Already selected explicitly: nothing to warn about.
    expect(missingDependencies(["POS", "MENU", "TABLES", "ORDERS"])).toEqual([]);
    // A dependency one level down still surfaces.
    expect(missingDependencies(["POS", "MENU", "TABLES"])).toEqual([
      { key: "POS", requires: ["ORDERS"] },
    ]);
    expect(missingDependencies(["DASHBOARD"])).toEqual([]);
  });

  it("starts the BASIC plan at exactly the till and its data", () => {
    expect(BASIC_DEFAULT_SERVICE_KEYS).toEqual(["DASHBOARD", "POS", "MENU", "TABLES", "ORDERS"]);
    // A BASIC restaurant must not reach billing, reports or inventory.
    const basic = resolveEntitledServices(normalizeServiceKeys(BASIC_DEFAULT_SERVICE_KEYS));
    expect(basic).toContain("POS");
    expect(basic).not.toContain("BILLING");
    expect(basic).not.toContain("REPORTS");
    expect(basic).not.toContain("INVENTORY");
    expect(basic).not.toContain("KOT");
  });

  it("maps restaurant routes to the service that owns them", () => {
    expect(serviceForRoute("/pos")).toBe("POS");
    expect(serviceForRoute("/pos/orders")).toBe("POS");
    expect(serviceForRoute("/reports")).toBe("REPORTS");
    expect(serviceForRoute("/kot")).toBe("KOT");
    expect(serviceForRoute("/billing")).toBe("BILLING");
    // An unimplemented feature has no route to guard yet.
    expect(serviceForRoute("/customers")).toBeNull();
    expect(serviceForRoute("/some-unknown-path")).toBeNull();
  });

  it("gives a readable label for a locked feature", () => {
    expect(serviceName("REPORTS")).toBe(getService("REPORTS").name);
  });
});

describe("resolveEntitledServices", () => {
  it("treats a stored snapshot as authoritative, even an empty one", () => {
    // An explicit [] means "this plan grants nothing" and must not be
    // "helpfully" filled in from the live plan.
    expect(resolveEntitledServices([], ["POS", "MENU", "TABLES", "ORDERS"])).toEqual([]);
    expect(resolveEntitledServices(["BILLING"], ["POS", "MENU", "TABLES", "ORDERS"])).toEqual([
      "BILLING",
    ]);
  });

  it("keeps a snapshot's dependencies satisfied", () => {
    // A snapshot of POS stored before the dependency rule existed still works.
    expect(resolveEntitledServices(["POS"])).toEqual(["POS", "MENU", "TABLES", "ORDERS"]);
  });

  it("falls back to the plan's current services when no snapshot exists", () => {
    expect(
      resolveEntitledServices(undefined, ["POS", "MENU", "TABLES", "ORDERS", "BILLING"])
    ).toEqual(["POS", "MENU", "TABLES", "ORDERS", "BILLING"]);
  });

  it("falls back to the legacy set when neither subscription nor plan has services", () => {
    // A pre-snapshot venue must not be locked out of features it has always had.
    expect(resolveEntitledServices(undefined)).toEqual([...LEGACY_SUBSCRIPTION_SERVICE_KEYS]);
    expect(resolveEntitledServices(undefined, [])).toEqual([...LEGACY_SUBSCRIPTION_SERVICE_KEYS]);
    expect(LEGACY_SUBSCRIPTION_SERVICE_KEYS).toContain("REPORTS");
    expect(LEGACY_SUBSCRIPTION_SERVICE_KEYS).toContain("INVENTORY");
  });

  it("does not let a service added to the catalog leak into legacy entitlements", () => {
    // The legacy set is the historical "everything we had on the day we started
    // tracking" snapshot, not a mirror of today's active list. Enabling a new
    // service must not hand it to pre-snapshot subscribers.
    expect(LEGACY_SUBSCRIPTION_SERVICE_KEYS).not.toContain("CUSTOMERS");
    expect(LEGACY_SUBSCRIPTION_SERVICE_KEYS).not.toContain("KDS");
    expect(LEGACY_SUBSCRIPTION_SERVICE_KEYS).not.toContain("API_INTEGRATION");
    // Every legacy key must still be a real catalog entry.
    for (const key of LEGACY_SUBSCRIPTION_SERVICE_KEYS) {
      expect(isServiceKey(key)).toBe(true);
    }
  });

  it("ignores junk in a stored snapshot instead of granting it", () => {
    expect(resolveEntitledServices(["POS", "TELEPORTATION", 42])).toEqual([
      "POS",
      "MENU",
      "TABLES",
      "ORDERS",
    ]);
  });

  it("gives a venue with no subscription the same everything-available default", () => {
    // Self-onboarding and the trial flow must not be locked out before a
    // subscription exists.
    expect(resolveEntitledServices(undefined)).toContain("POS");
    expect(resolveEntitledServices(undefined)).toContain("REPORTS");
  });
});
