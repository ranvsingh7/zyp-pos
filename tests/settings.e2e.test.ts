import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// next/cache requires an active request scope; outside one `revalidatePath`
// throws an invariant error. Stubbed here so the real action can be invoked
// directly, and recorded so tests can assert what it revalidated.
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: vi.fn(),
  requireRestaurant: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentRestaurant: vi.fn(),
}));

import mongoose from "mongoose";
import React from "react";
import { renderToString } from "react-dom/server";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { SettingsManager } from "@/components/settings/settings-manager";
import {
  SettingsValidationError,
  getRestaurantLogo,
  getSettingsSnapshot,
  removeRestaurantLogo,
  saveRestaurantLogo,
  updateRestaurantSettings,
  type RestaurantSettingsSnapshot,
} from "@/lib/settings/settings-service";
import {
  SettingsForbiddenError,
  assertCanManageSettings,
  canManageSettings,
} from "@/lib/settings/permissions";
import { detectLogoMimeType, validateLogoBytes } from "@/lib/settings/logo";
import { LOGO_MAX_BYTES } from "@/lib/settings/constants";
import { calculateBill } from "@/lib/billing/tax";
import { getRestaurantTaxSettings } from "@/lib/billing/tax-settings";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_settings_e2e";

let available = false;

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x01, 0x02, 0x03,
]);
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
]);
const NOT_AN_IMAGE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x00]);

async function createRestaurant(
  name: string,
  gstRegistered = false
): Promise<{ restaurantId: string; userId: string }> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `settings-${Date.now()}-${Math.random()}@restopos.test`,
    passwordHash,
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name,
    ownerName: "Owner",
    phone: "9876543210",
    address: "1 Food St",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    gstRegistered,
    gstin: gstRegistered ? "27ABCDE1234F1Z5" : "",
    businessType: "Restaurant",
  });
  return { restaurantId: result.restaurantId, userId: String(user._id) };
}

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
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
  vi.clearAllMocks();
});

it("requires a reachable MongoDB so a skipped run can never look green", () => {
  expect(available, `MongoDB unreachable at ${MONGODB_E2E_URI}`).toBe(true);
});

describe("settings: permissions", () => {
  it("A. allows owner and manager, denies cashier and waiter", () => {
    expect(canManageSettings("OWNER")).toBe(true);
    expect(canManageSettings("MANAGER")).toBe(true);
    expect(canManageSettings("CASHIER")).toBe(false);
    expect(canManageSettings("WAITER")).toBe(false);
    expect(() => assertCanManageSettings("CASHIER")).toThrow(SettingsForbiddenError);
    expect(() => assertCanManageSettings("OWNER")).not.toThrow();
  });
});

describe("settings: configuration form", () => {
  it("R. renders every existing configuration section from the snapshot", async () => {
    const snapshot: RestaurantSettingsSnapshot = {
      restaurant: {
        name: "Curry House",
        phone: "9876543210",
        email: "",
        address: "1 Food St",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        businessType: "Restaurant",
        gstRegistered: true,
        gstin: "27ABCDE1234F1Z5",
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
        serviceChargeEnabled: false,
        serviceChargeRate: 0,
        roundOffEnabled: false,
        upiId: "",
      },
      logo: { present: false, mimeType: "", size: 0, updatedAt: "" },
    };

    const html = renderToString(
      React.createElement(SettingsManager, {
        snapshot,
        canEdit: true,
        gstRegistered: true,
      })
    );

    expect(html).toContain("Restaurant profile");
    expect(html).toContain("GST registration");
    expect(html).toContain("Tax configuration");
    expect(html).toContain("Billing and numbering");
    expect(html).toContain("Branding");
    expect(html).toContain("Save settings");
    expect(html).toContain('name="defaultTaxRate"');
    expect(html).toContain('name="billPrefix"');
    expect(html).toContain('name="purchasePrefix"');
    // The stored profile must be rendered as the form's starting values.
    expect(html).toContain("Curry House");
  });

  it("S. shows a read-only view without edit controls for staff", () => {
    const snapshot: RestaurantSettingsSnapshot = {
      restaurant: {
        name: "Curry House",
        phone: "9876543210",
        email: "",
        address: "1 Food St",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        businessType: "Restaurant",
        gstRegistered: false,
        gstin: "",
      },
      tax: {
        taxEnabled: false,
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
        serviceChargeEnabled: false,
        serviceChargeRate: 0,
        roundOffEnabled: false,
        upiId: "",
      },
      logo: { present: false, mimeType: "", size: 0, updatedAt: "" },
    };

    const html = renderToString(
      React.createElement(SettingsManager, { snapshot, canEdit: false, gstRegistered: false })
    );

    expect(html).not.toContain("Save settings");
    expect(html).not.toContain('name="defaultTaxRate"');
    expect(html).toContain("Only the restaurant owner or a manager can change these settings.");
  });
});

describe("settings: profile and tax configuration", () => {
  it(
    "B. returns the stored configuration with the app's defaults",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      const snapshot = await getSettingsSnapshot(restaurantId);
      expect(snapshot.restaurant.name).toBe("Curry House");
      expect(snapshot.restaurant.gstRegistered).toBe(false);
      expect(snapshot.tax.taxEnabled).toBe(false);
      expect(snapshot.billing.billPrefix).toBe("BILL");
      expect(snapshot.billing.kotPrefix).toBe("KOT");
      expect(snapshot.billing.purchasePrefix).toBe("PUR");
      expect(snapshot.billing.serviceChargeEnabled).toBe(false);
      expect(snapshot.billing.roundOffEnabled).toBe(false);
      expect(snapshot.billing.currency).toBe("INR");
      expect(snapshot.logo.present).toBe(false);
    },
    30000
  );

  it(
    "C. writes only the fields in the payload and leaves the rest untouched",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House", true);
      await RestaurantSettingsModel.updateOne(
        { restaurantId },
        { $set: { billPrefix: "GHAR", serviceChargeEnabled: true, serviceChargeRate: 7 } }
      );

      await updateRestaurantSettings(restaurantId, { city: "Pune" });

      const restaurant = await RestaurantModel.findById(restaurantId).lean();
      expect(restaurant?.city).toBe("Pune");
      expect(restaurant?.name).toBe("Curry House");
      expect(restaurant?.address).toBe("1 Food St");
      const settings = await RestaurantSettingsModel.findOne({ restaurantId }).lean();
      expect(settings?.billPrefix).toBe("GHAR");
      expect(settings?.serviceChargeEnabled).toBe(true);
      expect(settings?.serviceChargeRate).toBe(7);
    },
    30000
  );

  it(
    "D. normalizes prefixes and reports them back",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      const snapshot = await updateRestaurantSettings(restaurantId, {
        billPrefix: "inv-42",
        kotPrefix: "kitchen",
        purchasePrefix: "buy",
      });
      expect(snapshot.billing.billPrefix).toBe("INV42");
      expect(snapshot.billing.kotPrefix).toBe("KITCHEN");
      expect(snapshot.billing.purchasePrefix).toBe("BUY");
    },
    30000
  );

  it(
    "E. rejects component rates that do not match the combined rate",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House", true);
      await expect(
        updateRestaurantSettings(restaurantId, {
          defaultTaxRate: 18,
          cgstRatePercent: 5,
          sgstRatePercent: 5,
        })
      ).rejects.toThrow(SettingsValidationError);
      const settings = await RestaurantSettingsModel.findOne({ restaurantId }).lean();
      expect(settings?.defaultTaxRate).toBe(5);
    },
    30000
  );

  it(
    "E2. a save that touches no tax field is not blocked by legacy stored rates",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House", true);
      await RestaurantSettingsModel.updateOne(
        { restaurantId },
        { $set: { defaultTaxRate: 18, cgstRatePercent: 5, sgstRatePercent: 5 } }
      );

      const snapshot = await updateRestaurantSettings(restaurantId, { city: "Pune" });

      expect(snapshot.restaurant.city).toBe("Pune");
      expect(snapshot.tax.defaultTaxRate).toBe(18);
      expect(snapshot.tax.cgstRatePercent).toBe(5);
    },
    30000
  );

  it(
    "F. GST registration stays the master control on tax",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House", true);
      await updateRestaurantSettings(restaurantId, { taxEnabled: true });
      expect((await getRestaurantTaxSettings(restaurantId)).taxEnabled).toBe(true);

      // Turning registration off must immediately stop charging GST.
      await updateRestaurantSettings(restaurantId, { gstRegistered: false, gstin: null });
      expect((await getRestaurantTaxSettings(restaurantId)).taxEnabled).toBe(false);
      const settings = await RestaurantSettingsModel.findOne({ restaurantId }).lean();
      expect(settings?.taxEnabled).toBe(false);
      expect(settings?.gstScheme).toBe("INTRA_STATE");
    },
    30000
  );

  it(
    "G. rejects enabling GST registration without a GSTIN",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      await expect(
        updateRestaurantSettings(restaurantId, { gstRegistered: true, gstin: null })
      ).rejects.toThrow(SettingsValidationError);
      const restaurant = await RestaurantModel.findById(restaurantId).lean();
      expect(restaurant?.gstRegistered).toBe(false);
    },
    30000
  );

  it(
    "G2. clearing the email and deregistering GST clears both stored values",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House", true);
      await RestaurantModel.updateOne({ _id: restaurantId }, { $set: { email: "hi@shop.test" } });
      const snapshot = await updateRestaurantSettings(restaurantId, {
        email: null,
        gstRegistered: false,
      });
      expect(snapshot.restaurant.email).toBe("");
      expect(snapshot.restaurant.gstRegistered).toBe(false);
      const restaurant = await RestaurantModel.findById(restaurantId).lean();
      expect(restaurant?.email ?? null).toBeNull();
      expect(restaurant?.gstin ?? null).toBeNull();
    },
    30000
  );

  it(
    "H. rejects an enabled service charge with no rate",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      await expect(
        updateRestaurantSettings(restaurantId, { serviceChargeEnabled: true, serviceChargeRate: 0 })
      ).rejects.toThrow(SettingsValidationError);
    },
    30000
  );

  it(
    "I. never writes to another restaurant",
    async () => {
      if (!available) return;
      const a = await createRestaurant("Kitchen A");
      const b = await createRestaurant("Kitchen B", true);
      await updateRestaurantSettings(a.restaurantId, { city: "Goa", billPrefix: "AAA" });
      const untouched = await getSettingsSnapshot(b.restaurantId);
      expect(untouched.restaurant.city).toBe("Mumbai");
      expect(untouched.billing.billPrefix).toBe("BILL");
      const otherRestaurant = await RestaurantModel.findById(b.restaurantId).lean();
      expect(otherRestaurant?.name).toBe("Kitchen B");
    },
    30000
  );

  it(
    "J. saved service charge and round-off flow into bill totals",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      const snapshot = await updateRestaurantSettings(restaurantId, {
        serviceChargeEnabled: true,
        serviceChargeRate: 10,
        roundOffEnabled: true,
      });
      const tax = await getRestaurantTaxSettings(restaurantId);
      const bill = calculateBill({
        items: [{ quantity: 1, unitPricePaise: 10500 }],
        discountPaise: 0,
        taxRatePercent: tax.defaultTaxRate,
        taxInclusive: tax.taxInclusive,
        serviceChargeEnabled: snapshot.billing.serviceChargeEnabled,
        serviceChargeRatePercent: snapshot.billing.serviceChargeRate,
        roundOffEnabled: snapshot.billing.roundOffEnabled,
        gstScheme: "INTRA_STATE",
        gstRegistered: false,
      });
      // 10500 + 5% tax = 11025 sale value, +10% service charge, rounded to a
      // whole rupee exactly as an invoice would be.
      expect(bill.totalTaxPaise).toBe(525);
      expect(bill.serviceChargeAmountPaise).toBe(1103);
      expect(bill.roundOffAmountPaise).toBe(-28);
      expect(bill.grandTotalPaise).toBe(12100);
    },
    30000
  );
});

describe("settings: restaurant logo", () => {
  it(
    "K. stores PNG bytes on the restaurant and serves them back",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      const saved = await saveRestaurantLogo(restaurantId, PNG_BYTES, "image/png");
      expect(saved.mimeType).toBe("image/png");
      expect(saved.size).toBe(PNG_BYTES.byteLength);

      const stored = await RestaurantModel.findById(restaurantId).select("logo");
      expect(Buffer.isBuffer(stored?.logo?.data)).toBe(true);
      expect(Array.from(stored?.logo?.data ?? [])).toEqual(Array.from(PNG_BYTES));

      const logo = await getRestaurantLogo(restaurantId);
      expect(logo?.mimeType).toBe("image/png");
      expect(Array.from(logo?.data ?? [])).toEqual(Array.from(PNG_BYTES));
      expect((await getSettingsSnapshot(restaurantId)).logo.present).toBe(true);
    },
    30000
  );

  it(
    "L. accepts JPEG and WebP from their magic bytes",
    async () => {
      if (!available) return;
      expect(detectLogoMimeType(JPEG_BYTES)).toBe("image/jpeg");
      expect(detectLogoMimeType(WEBP_BYTES)).toBe("image/webp");
      const { restaurantId } = await createRestaurant("Curry House");
      await saveRestaurantLogo(restaurantId, JPEG_BYTES, "image/jpeg");
      expect((await getRestaurantLogo(restaurantId))?.mimeType).toBe("image/jpeg");
      await saveRestaurantLogo(restaurantId, WEBP_BYTES, "image/webp");
      expect((await getRestaurantLogo(restaurantId))?.mimeType).toBe("image/webp");
    },
    30000
  );

  it(
    "M. rejects a file whose bytes are not an image even when the type claims otherwise",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      await expect(
        saveRestaurantLogo(restaurantId, NOT_AN_IMAGE, "image/png")
      ).rejects.toThrow(SettingsValidationError);
      expect(await getRestaurantLogo(restaurantId)).toBeNull();
    },
    30000
  );

  it(
    "N. rejects an image larger than 2 MB",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      const oversized = new Uint8Array(LOGO_MAX_BYTES + 1);
      oversized.set(PNG_BYTES, 0);
      await expect(
        saveRestaurantLogo(restaurantId, oversized, "image/png")
      ).rejects.toThrow(SettingsValidationError);
      const check = validateLogoBytes(oversized, "image/png");
      expect(check.ok).toBe(false);
      expect(await getRestaurantLogo(restaurantId)).toBeNull();
    },
    30000
  );

  it(
    "O. replaces an existing logo and removes it on request",
    async () => {
      if (!available) return;
      const { restaurantId } = await createRestaurant("Curry House");
      await saveRestaurantLogo(restaurantId, PNG_BYTES, "image/png");
      const replaced = await saveRestaurantLogo(restaurantId, JPEG_BYTES, "image/jpeg");
      expect(replaced.mimeType).toBe("image/jpeg");
      expect((await getRestaurantLogo(restaurantId))?.size).toBe(JPEG_BYTES.byteLength);

      await removeRestaurantLogo(restaurantId);
      expect(await getRestaurantLogo(restaurantId)).toBeNull();
      const stored = await RestaurantModel.findById(restaurantId).select("logo").lean();
      expect(stored?.logo ?? null).toBeNull();
    },
    30000
  );

  it(
    "P. one tenant can never read or overwrite another tenant's logo",
    async () => {
      if (!available) return;
      const a = await createRestaurant("Kitchen A");
      const b = await createRestaurant("Kitchen B");
      await saveRestaurantLogo(a.restaurantId, PNG_BYTES, "image/png");

      // B's lookup can only ever address B, so A's bytes stay unreachable.
      expect(await getRestaurantLogo(b.restaurantId)).toBeNull();
      await saveRestaurantLogo(b.restaurantId, JPEG_BYTES, "image/jpeg");

      const aLogo = await getRestaurantLogo(a.restaurantId);
      expect(Array.from(aLogo?.data ?? [])).toEqual(Array.from(PNG_BYTES));
      const bLogo = await getRestaurantLogo(b.restaurantId);
      expect(Array.from(bLogo?.data ?? [])).toEqual(Array.from(JPEG_BYTES));
    },
    30000
  );

  it(
    "Q. the logo route serves the session tenant's bytes and 404s without one",
    async () => {
      if (!available) return;
      const { GET } = await import("@/app/api/settings/logo/route");
      const a = await createRestaurant("Kitchen A");
      const b = await createRestaurant("Kitchen B");
      await saveRestaurantLogo(a.restaurantId, PNG_BYTES, "image/png");

      vi.mocked(requireAuth).mockResolvedValue({
        id: a.userId,
        fullName: "Owner",
        email: "a@restopos.test",
        phone: null,
        role: "OWNER",
        restaurantId: a.restaurantId,
        isActive: true,
      });
      vi.mocked(requireRestaurant).mockResolvedValue({
        id: a.restaurantId,
        name: "Kitchen A",
        ownerId: a.userId,
        phone: "9876543210",
        email: null,
        logoUrl: "/api/settings/logo",
      });

      const response = await GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);

      vi.mocked(requireRestaurant).mockResolvedValue({
        id: b.restaurantId,
        name: "Kitchen B",
        ownerId: b.userId,
        phone: "9876543210",
        email: null,
        logoUrl: null,
      });
      expect((await GET()).status).toBe(404);
    },
    30000
  );
});

/**
 * Regression coverage for the reported bug: "Invalid input: expected boolean,
 * received string" on every save of the settings form.
 *
 * These tests drive the *real* pipeline the browser uses: render the real form,
 * lift the exact inputs it emits into a real `FormData`, and hand that to the
 * real server action. Nothing here hand-builds a JavaScript boolean, so a
 * regression that re-introduces the string/boolean mismatch fails here.
 */
describe("settings: the rendered form submits through the real action", () => {
  function baseSnapshot(
    overrides: Partial<RestaurantSettingsSnapshot["billing"]> = {}
  ): RestaurantSettingsSnapshot {
    return {
      restaurant: {
        name: "Curry House",
        phone: "9876543210",
        email: "",
        address: "1 Food St",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        businessType: "Restaurant",
        gstRegistered: true,
        gstin: "27ABCDE1234F1Z5",
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
        serviceChargeEnabled: false,
        serviceChargeRate: 0,
        roundOffEnabled: false,
        upiId: "",
        ...overrides,
      },
      logo: { present: false, mimeType: "", size: 0, updatedAt: "" },
    };
  }

  /**
   * Extracts the form controls the component actually rendered and turns them
   * into a `FormData`, the way the browser would on submit. Booleans therefore
   * arrive as the strings "true"/"false" that `YesNo`'s hidden input holds.
   */
  function formDataFrom(html: string, extra: Record<string, string> = {}): FormData {
    const form = new FormData();
    for (const tag of html.match(/<input\b[^>]*>/g) ?? []) {
      const attrs: Record<string, string> = {};
      for (const [, key, value] of tag.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
        if (key) attrs[key.toLowerCase()] = value ?? "";
      }
      const type = (attrs.type ?? "text").toLowerCase();
      if (!attrs.name || type === "submit" || type === "file") continue;
      form.set(attrs.name, attrs.value ?? "");
    }
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    return form;
  }

  async function loginAs(restaurantId: string, userId: string) {
    vi.mocked(requireAuth).mockResolvedValue({
      id: userId,
      fullName: "Owner",
      email: "settings@restopos.test",
      phone: null,
      role: "OWNER",
      restaurantId,
      isActive: true,
    } as Awaited<ReturnType<typeof requireAuth>>);
    vi.mocked(requireRestaurant).mockResolvedValue({
      id: restaurantId,
      name: "Curry House",
      ownerId: userId,
      phone: "9876543210",
      email: null,
      logoUrl: null,
    } as Awaited<ReturnType<typeof requireRestaurant>>);
  }

  it(
    "S. saving the form with its Yes/No choices no longer errors on booleans",
    async () => {
      if (!available) return;
      const { restaurantId, userId } = await createRestaurant("Form Save");
      await loginAs(restaurantId, userId);

      const html = renderToString(
        React.createElement(SettingsManager, {
          snapshot: baseSnapshot(),
          canEdit: true,
          gstRegistered: true,
        })
      );
      const form = formDataFrom(html);
      // What the browser really sends for the toggle fields.
      expect(form.get("gstRegistered")).toBe("true");
      expect(form.get("taxEnabled")).toBe("true");
      expect(form.get("taxInclusive")).toBe("false");
      expect(form.get("serviceChargeEnabled")).toBe("false");
      expect(form.get("roundOffEnabled")).toBe("false");

      const { updateSettingsAction } = await import("@/actions/settings/actions");
      const state = await updateSettingsAction({}, form);

      expect(state.success, `save failed: ${state.message ?? ""}`).toBe(true);
      expect(state._errors).toBeUndefined();

      // Stored as real booleans, not the strings.
      const snapshot = await getSettingsSnapshot(restaurantId);
      expect(snapshot.restaurant.gstRegistered).toBe(true);
      expect(snapshot.tax.taxEnabled).toBe(true);
      expect(snapshot.tax.taxInclusive).toBe(false);
      expect(snapshot.billing.roundOffEnabled).toBe(false);
      const raw = await RestaurantSettingsModel.collection.findOne({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
      });
      expect(typeof raw?.taxEnabled).toBe("boolean");
      expect(raw?.taxEnabled).toBe(true);
    },
    30000
  );

  it(
    "S2. toggling every Yes/No setting both ways saves successfully",
    async () => {
      if (!available) return;
      const { restaurantId, userId } = await createRestaurant("Form Toggles");
      await loginAs(restaurantId, userId);
      const { updateSettingsAction } = await import("@/actions/settings/actions");

      const html = renderToString(
        React.createElement(SettingsManager, {
          snapshot: baseSnapshot(),
          canEdit: true,
          gstRegistered: false,
        })
      );

      for (const value of ["true", "false"]) {
        // A non-zero rate accompanies the toggle: turning service charge on
        // without a rate is correctly rejected as invalid.
        const form = formDataFrom(html, {
          gstRegistered: value,
          taxEnabled: value,
          taxInclusive: value,
          serviceChargeEnabled: value,
          serviceChargeRate: "5",
          roundOffEnabled: value,
        });
        const state = await updateSettingsAction({}, form);
        expect(state.success, `save failed for ${value}: ${state.message ?? ""}`).toBe(
          true
        );

        const snapshot = await getSettingsSnapshot(restaurantId);
        expect(snapshot.restaurant.gstRegistered).toBe(value === "true");
        expect(snapshot.tax.taxEnabled).toBe(value === "true");
        expect(snapshot.tax.taxInclusive).toBe(value === "true");
        expect(snapshot.billing.serviceChargeEnabled).toBe(value === "true");
        expect(snapshot.billing.serviceChargeRate).toBe(5);
        expect(snapshot.billing.roundOffEnabled).toBe(value === "true");
      }
    },
    30000
  );

  it(
    "S3. the form saves a UPI ID and the Clear button removes it",
    async () => {
      if (!available) return;
      const { restaurantId, userId } = await createRestaurant("Form Upi");
      await loginAs(restaurantId, userId);
      const { updateSettingsAction } = await import("@/actions/settings/actions");
      const { getRestaurantUpiId } = await import("@/lib/settings/settings-service");

      const html = renderToString(
        React.createElement(SettingsManager, {
          snapshot: baseSnapshot(),
          canEdit: true,
          gstRegistered: true,
        })
      );

      const save = await updateSettingsAction(
        {},
        formDataFrom(html, { upiId: "spicegarden@okaxis" })
      );
      expect(save.success, `save failed: ${save.message ?? ""}`).toBe(true);
      expect(save.snapshot?.billing.upiId).toBe("spicegarden@okaxis");
      expect(await getRestaurantUpiId(restaurantId)).toBe("spicegarden@okaxis");

      // The "Clear UPI ID" button posts the same form with clearUpiId=true.
      const cleared = await updateSettingsAction(
        {},
        formDataFrom(html, { clearUpiId: "true" })
      );
      expect(cleared.success, `clear failed: ${cleared.message ?? ""}`).toBe(true);
      expect(cleared.snapshot?.billing.upiId).toBe("");
      expect(await getRestaurantUpiId(restaurantId)).toBeNull();
    },
    30000
  );

  it(
    "S4. the form still rejects an invalid UPI ID with a field error",
    async () => {
      if (!available) return;
      const { restaurantId, userId } = await createRestaurant("Form Upi Bad");
      await loginAs(restaurantId, userId);
      const { updateSettingsAction } = await import("@/actions/settings/actions");

      const html = renderToString(
        React.createElement(SettingsManager, {
          snapshot: baseSnapshot(),
          canEdit: true,
          gstRegistered: true,
        })
      );

      for (const bad of ["not-a-upi-id", "https://example.com/pay", "a@b c"]) {
        const state = await updateSettingsAction({}, formDataFrom(html, { upiId: bad }));
        expect(state.success, `${bad} should be rejected`).toBe(false);
        expect(state._errors?.upiId).toBeTruthy();
      }
    },
    30000
  );

  it(
    "S5. a save never writes another restaurant's UPI ID",
    async () => {
      if (!available) return;
      const mine = await createRestaurant("Form Mine");
      const theirs = await createRestaurant("Form Theirs");
      await loginAs(mine.restaurantId, mine.userId);
      const { updateSettingsAction } = await import("@/actions/settings/actions");
      const { getRestaurantUpiId } = await import("@/lib/settings/settings-service");

      // Try to smuggle the other tenant's id in; the session decides the target.
      const state = await updateSettingsAction(
        {},
        formDataFrom(renderToString(
          React.createElement(SettingsManager, {
            snapshot: baseSnapshot(),
            canEdit: true,
            gstRegistered: true,
          })
        ), { upiId: "theirs@okaxis", restaurantId: theirs.restaurantId })
      );
      expect(state.success).toBe(true);
      expect(await getRestaurantUpiId(mine.restaurantId)).toBe("theirs@okaxis");
      expect(await getRestaurantUpiId(theirs.restaurantId)).toBeNull();
    },
    30000
  );
});
