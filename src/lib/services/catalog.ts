/**
 * The centralized service catalog.
 *
 * A "service" is a distinct capability a restaurant venue can use inside ZYP
 * POS. A plan stores the *keys* of the services it includes; a subscription
 * stores a snapshot of those keys at the moment it was issued.
 *
 * Design rules this module enforces:
 *
 * 1. Keys are stable, screaming-snake identifiers. They are written into plan
 *    and subscription documents, so renaming one is a breaking data change.
 * 2. The catalog is the single source of truth. Pages, navigation, plan
 *    editing and the access gate all read service keys from here; nothing
 *    re-declares "which services exist" or "which service guards which route".
 * 3. Adding a key here never mutates existing plan or subscription documents.
 *    Plans keep exactly the keys they were saved with, and subscriptions keep
 *    their snapshot. A new key is inert until a Super Admin explicitly puts it
 *    on a plan and a new subscription (or an explicit plan change) snapshots it.
 * 4. `enabled: false` means the service is catalogued but not yet selectable,
 *    so a plan can never advertise a capability that has no implementation.
 *    Flipping it to `true` is the whole "ship a new service" step.
 *
 * Deliberately free of `server-only`: the admin plan editor and the restaurant
 * subscription view are client/server components that both need these labels.
 */

export const SERVICE_KEYS = [
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
] as const;

export type ServiceKey = (typeof SERVICE_KEYS)[number];

export interface ServiceDefinition {
  key: ServiceKey;
  /** Display name shown in the plan editor and the subscription views. */
  name: string;
  description: string;
  /**
   * Whether a Super Admin may put this service on a plan. False means the
   * service is catalogued for future use but has no implementation yet.
   */
  enabled: boolean;
  /**
   * Services this one needs in order to work. Selecting a service pulls these
   * in automatically so a plan can never be saved in a state that breaks a
   * core workflow. Transitive; keep it minimal and truthful.
   */
  requires: readonly ServiceKey[];
  /** Restaurant-facing routes this service owns, used by page and nav gating. */
  routes: readonly string[];
}

function service(
  key: ServiceKey,
  name: string,
  description: string,
  options: {
    enabled?: boolean;
    requires?: readonly ServiceKey[];
    routes?: readonly string[];
  } = {}
): ServiceDefinition {
  return {
    key,
    name,
    description,
    enabled: options.enabled ?? true,
    requires: options.requires ?? [],
    routes: options.routes ?? [],
  };
}

/**
 * The catalog. Order is the display order in the plan editor.
 *
 * `requires` is intentionally sparse. Only real internal couplings are
 * declared — POS reads the menu, tables and orders, and KOT reads orders.
 * Nothing here pulls in a customer-facing feature (online ordering, digital
 * menu, QR), because those are sold separately.
 */
export const SERVICE_CATALOG: Record<ServiceKey, ServiceDefinition> = {
  DASHBOARD: service("DASHBOARD", "Dashboard", "Sales snapshot and daily overview.", {
    routes: ["/dashboard"],
  }),
  POS: service("POS", "POS", "Point of sale terminal for ringing up orders.", {
    requires: ["MENU", "TABLES", "ORDERS"],
    routes: ["/pos"],
  }),
  MENU: service("MENU", "Menu", "Menu items, categories, variants and pricing.", {
    routes: ["/menu"],
  }),
  TABLES: service("TABLES", "Tables", "Floor plan, sections and table status.", {
    routes: ["/tables"],
  }),
  ORDERS: service("ORDERS", "Orders", "Order history, holds and cancellations.", {
    routes: ["/orders"],
  }),
  BILLING: service("BILLING", "Billing", "Bill generation, payments and GST invoices.", {
    routes: ["/billing"],
  }),
  KOT: service("KOT", "Kitchen (KOT)", "Kitchen order tickets and reprint history.", {
    requires: ["ORDERS"],
    routes: ["/kot"],
  }),
  INVENTORY: service("INVENTORY", "Inventory", "Stock items, purchases and wastage.", {
    routes: ["/inventory"],
  }),
  REPORTS: service("REPORTS", "Reports", "Sales, payment and GST reporting.", {
    routes: ["/reports"],
  }),
  AUDIT: service("AUDIT", "Audit Log", "Restaurant activity history and evidence export.", {
    routes: ["/audit"],
  }),
  CUSTOMERS: service("CUSTOMERS", "Customers", "Customer directory and history.", {
    enabled: false,
  }),
  DIGITAL_MENU: service("DIGITAL_MENU", "Digital Menu", "Shareable QR-linked digital menu.", {
    enabled: false,
  }),
  QR_ORDERING: service("QR_ORDERING", "QR Ordering", "Self-service ordering via table QR.", {
    enabled: false,
  }),
  ONLINE_ORDERING: service("ONLINE_ORDERING", "Online Ordering", "Direct online order intake.", {
    enabled: false,
  }),
  KDS: service("KDS", "Kitchen Display System", "Live kitchen display screens.", {
    enabled: false,
  }),
  API_INTEGRATION: service("API_INTEGRATION", "API Integration", "Public API keys and webhooks.", {
    enabled: false,
  }),
};

const CATALOG_ORDER: readonly ServiceKey[] = SERVICE_KEYS;

export function isServiceKey(value: unknown): value is ServiceKey {
  return typeof value === "string" && (SERVICE_KEYS as readonly string[]).includes(value);
}

export function getService(key: ServiceKey): ServiceDefinition {
  return SERVICE_CATALOG[key];
}

/** Every catalogued service, in editor display order. */
export function listServices(): ServiceDefinition[] {
  return CATALOG_ORDER.map((key) => SERVICE_CATALOG[key]);
}

/**
 * Services a Super Admin may actually put on a plan. Inactive ones are
 * deliberately excluded so an admin cannot sell a capability that has no
 * implementation behind it.
 */
export function listActiveServices(): ServiceDefinition[] {
  return listServices().filter((s) => s.enabled);
}

export function serviceName(key: ServiceKey): string {
  return SERVICE_CATALOG[key]?.name ?? String(key);
}

/**
 * Adds every transitive dependency of the given services.
 *
 * Selecting POS therefore also selects MENU, TABLES and ORDERS, so a plan can
 * never be saved in a configuration that breaks the till.
 */
export function expandServiceKeys(keys: readonly string[]): ServiceKey[] {
  const out = new Set<ServiceKey>();
  const visit = (key: ServiceKey): void => {
    if (out.has(key)) return;
    out.add(key);
    for (const dep of SERVICE_CATALOG[key]?.requires ?? []) visit(dep);
  };
  for (const raw of keys) {
    if (isServiceKey(raw)) visit(raw);
  }
  return CATALOG_ORDER.filter((key) => out.has(key));
}

/**
 * The canonical stored form of a service selection: known keys only, unknown
 * keys dropped, dependencies filled in, de-duplicated, in catalog order.
 *
 * Storing the normalized form means two plans configured with the same
 * services always serialize identically, so a snapshot comparison is exact.
 */
export function normalizeServiceKeys(keys: readonly unknown[] | null | undefined): ServiceKey[] {
  if (!Array.isArray(keys)) return [];
  return expandServiceKeys(keys.filter((k): k is string => typeof k === "string"));
}

/**
 * Dependencies that `keys` does not select explicitly but that normalization
 * will add on its behalf, so the plan editor can say "this also includes
 * X" instead of silently widening the selection.
 *
 * This compares against the *raw* selection, not the normalized one. Expanding
 * first and then checking would make the answer always empty, since expansion
 * adds exactly what is missing.
 */
export function missingDependencies(
  keys?: readonly string[] | null
): { key: ServiceKey; requires: ServiceKey[] }[] {
  const selected = Array.isArray(keys) ? keys : [];
  const explicit = new Set(selected.filter((k): k is string => typeof k === "string"));
  const effective = new Set(normalizeServiceKeys(selected));
  return listActiveServices()
    .filter((s) => effective.has(s.key))
    .flatMap((s) => {
      // Only a dependency the admin has not chosen themselves is "missing";
      // an explicitly selected dependency is not a surprise.
      const missing = s.requires.filter(
        (dep) => !explicit.has(dep) && effective.has(dep)
      );
      return missing.length ? [{ key: s.key, requires: missing }] : [];
    });
}

/** The service that owns a restaurant route, if any. */
export function serviceForRoute(route: string): ServiceKey | null {
  for (const key of CATALOG_ORDER) {
    const s = SERVICE_CATALOG[key];
    if (!s.enabled) continue;
    if (s.routes.some((r) => route === r || route.startsWith(`${r}/`))) return key;
  }
  return null;
}

/**
 * The initial BASIC configuration required by the product spec: the till and
 * the data it needs, and nothing else. Used as the default selection in the
 * plan editor and for the auto-provisioned trial plan.
 */
export const BASIC_DEFAULT_SERVICE_KEYS: readonly ServiceKey[] = [
  "DASHBOARD",
  "POS",
  "MENU",
  "TABLES",
  "ORDERS",
];

/**
 * Entitlements assumed for a subscription that predates service snapshots and
 * whose plan also predates them.
 *
 * This is the "do not break existing restaurants" fallback (§14): such a
 * subscription was sold before plans carried services at all, so it is treated
 * as having had everything that existed when service tracking was introduced.
 * It is a read-time fallback only — no historical document is rewritten, and
 * the next renewal or plan change writes a real snapshot.
 *
 * Deliberately a frozen literal rather than `listActiveServices()`: this set is
 * "what every venue had on the day we started tracking", so it must not grow
 * when the catalog does. Deriving it from the active list would mean enabling a
 * brand-new service silently handed it to every pre-snapshot subscriber, which
 * is exactly the retroactivity §18 rules out. Adding a service to the catalog
 * therefore never changes this constant — the new service reaches existing
 * subscribers only through an explicit renewal or plan change.
 */
export const LEGACY_SUBSCRIPTION_SERVICE_KEYS: readonly ServiceKey[] = [
  "DASHBOARD",
  "POS",
  "MENU",
  "TABLES",
  "ORDERS",
  "BILLING",
  "KOT",
  "INVENTORY",
  "REPORTS",
];

/**
 * Resolves the services a subscription is actually entitled to.
 *
 * `stored` is the subscription's own `serviceKeys` field, which is `undefined`
 * for documents written before snapshots existed and an array (possibly empty)
 * for everything written since.
 *
 * Resolution order:
 *  1. A stored snapshot always wins, including an explicit empty one — a plan
 *     can legitimately grant nothing, and that must not be "helpfully" filled
 *     in from the live plan.
 *  2. Otherwise the subscription predates snapshots, so fall back to the
 *     services its plan carries now. This is the closest approximation of what
 *     it was sold.
 *  3. If the plan predates services too, assume the venue has everything that
 *     exists today. It was sold before services were tracked, so locking a
 *     long-standing restaurant out of features it has always had would be a
 *     regression, and the next renewal writes a real snapshot anyway.
 *
 * This only ever *reads*. No historical document is rewritten, and no new
 * service is ever granted retroactively by this function: step 2 and 3 only
 * apply to documents that never had a snapshot in the first place.
 */
export function resolveEntitledServices(
  stored: unknown,
  livePlanServiceKeys: readonly string[] = []
): ServiceKey[] {
  if (Array.isArray(stored)) return normalizeServiceKeys(stored);
  const fromPlan = normalizeServiceKeys(livePlanServiceKeys);
  if (fromPlan.length > 0) return fromPlan;
  return [...LEGACY_SUBSCRIPTION_SERVICE_KEYS];
}
