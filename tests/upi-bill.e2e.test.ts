import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/guards", () => ({
  requireAuth: vi.fn(),
  requireRestaurant: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentRestaurant: vi.fn(),
}));

import mongoose from "mongoose";
import jsQR from "jsqr";
import { PNG } from "pngjs";

import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { MenuVariantModel } from "@/models/MenuVariant";
import { OrderModel } from "@/models/Order";
import { BillModel } from "@/models/Bill";
import { TableSectionModel } from "@/models/TableSection";
import { RestaurantTableModel } from "@/models/RestaurantTable";
import { KotModel } from "@/models/KitchenOrderTicket";
import { InventoryItemModel } from "@/models/InventoryItem";
import { StockMovementModel } from "@/models/StockMovement";
import { TableAuditLogModel } from "@/models/TableAuditLog";

import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import { createMenuItem } from "@/lib/menu/item-service";
import { createTable } from "@/lib/tables/table-service";
import { createOrder } from "@/lib/orders/order-service";
import { generateBill, getBill, recordPayment } from "@/lib/billing/bill-service";
import { buildBillHtml, type BillRestaurantHeader } from "@/lib/billing/print";
import { buildUpiPaymentQrDataUri, buildUpiPaymentUri } from "@/lib/billing/payment-qr";
import {
  getRestaurantUpiId,
  getSettingsSnapshot,
  updateRestaurantSettings,
} from "@/lib/settings/settings-service";
import {
  isValidUpiId,
  restaurantSettingsUpdateSchema,
} from "@/lib/settings/validation";
import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import type { BillView } from "@/lib/billing/types";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_upi_e2e";

const BY = "0123456789abcdef01234567";
const UPI = "spicegarden@okaxis";

let available = false;

const RESTAURANT_NAME = "Spice Garden";

/**
 * Mirrors the `YesNo` control in settings-manager.tsx: the choice is held in a
 * hidden `<input>` whose value is the *string* "true"/"false", because
 * `FormData` cannot carry anything else.
 */
function booleanFormValues(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    gstRegistered: "true",
    taxEnabled: "true",
    taxInclusive: "false",
    serviceChargeEnabled: "false",
    roundOffEnabled: "true",
    ...overrides,
  };
}

const BOOLEAN_FIELDS = [
  "gstRegistered",
  "taxEnabled",
  "taxInclusive",
  "serviceChargeEnabled",
  "roundOffEnabled",
] as const;

async function seedTenant(
  name: string
): Promise<{ restaurantId: string; userId: string }> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `upi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@restopos.test`,
    passwordHash,
    isActive: true,
  });
  const result = await createRestaurantForUser(String(user._id), {
    name,
    ownerName: "Owner",
    phone: "9876543210",
    address: "12 MG Road",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    gstRegistered: true,
    gstin: "29ABCDE1234F1Z5",
    businessType: "Restaurant",
  });
  return { restaurantId: result.restaurantId, userId: String(user._id) };
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 4000 });
    available = true;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  if (available) {
    await Promise.all([
      UserModel.deleteMany({ email: /^upi-/ }),
      RestaurantModel.deleteMany({ name: /^UpiTest/ }),
      RestaurantSettingsModel.deleteMany({}),
      MenuCategoryModel.deleteMany({}),
      MenuItemModel.deleteMany({}),
      MenuVariantModel.deleteMany({}),
      OrderModel.deleteMany({}),
      BillModel.deleteMany({}),
      KotModel.deleteMany({}),
      InventoryItemModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      RestaurantTableModel.deleteMany({}),
      TableSectionModel.deleteMany({}),
      TableAuditLogModel.collection.deleteMany({}),
    ]);
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  if (!available) return;
  await RestaurantSettingsModel.deleteMany({});
});

/** Decodes a `data:image/png;base64,...` QR back to its payload. */
function decodeQr(dataUri: string | null): string | null {
  if (!dataUri) return null;
  const png = PNG.sync.read(Buffer.from(dataUri.split(",")[1], "base64"));
  const result = jsQR(
    new Uint8ClampedArray(png.data),
    png.width,
    png.height
  );
  return result ? result.data : null;
}

function header(overrides: Partial<BillRestaurantHeader> = {}): BillRestaurantHeader {
  return {
    name: RESTAURANT_NAME,
    address: "12 MG Road",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    phone: "9876543210",
    gstin: "29ABCDE1234F1Z5",
    logoDataUri: null,
    upiId: null,
    paymentQrDataUri: null,
    ...overrides,
  };
}

/**
 * Renders a bill through the *real* `printBillAction`, i.e. the production
 * preview/print path including `loadBillHeader()`. Deliberately not a copy of
 * that logic: a mirrored helper would keep passing even if the action encoded
 * the wrong amount into the QR.
 */
async function renderBill(restaurantId: string, bill: BillView): Promise<string> {
  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  const owner = await UserModel.findById(restaurant!.ownerId as never).lean();

  vi.mocked(requireAuth).mockResolvedValue({
    id: String(owner!._id),
    fullName: "Owner",
    email: "owner@restopos.test",
    phone: null,
    role: "OWNER",
    restaurantId,
    isActive: true,
  } as Awaited<ReturnType<typeof requireAuth>>);
  vi.mocked(requireRestaurant).mockResolvedValue({
    id: restaurantId,
    name: restaurant!.name,
    ownerId: String(owner!._id),
    phone: "9876543210",
    email: null,
    logoUrl: null,
  } as Awaited<ReturnType<typeof requireRestaurant>>);

  const { printBillAction } = await import("@/actions/billing/actions");
  const result = await printBillAction({ billId: bill.id });
  expect(result.success, `print failed: ${result.message ?? ""}`).toBe(true);
  expect((result as { html?: string }).html).toBeTruthy();
  return (result as { html: string }).html;
}

// Menu and table names only need to be unique within a restaurant, so this
// counter is per restaurant: two restaurants get identical naming (letting I1
// compare their slips directly) while repeated calls in one stay distinct.
const seqByRestaurant = new Map<string, number>();

async function seedBill(restaurantId: string, discount = true): Promise<string> {
  const n = (seqByRestaurant.get(restaurantId) ?? 0) + 1;
  seqByRestaurant.set(restaurantId, n);
  const category = await createCategory(restaurantId, {
    name: `Mains ${n}`,
    isActive: true,
    displayOrder: n,
  });
  const item = await createMenuItem(restaurantId, {
    categoryId: category.id,
    name: `Coffee ${n}`,
    itemType: "BEVERAGE",
    vegType: "VEG",
    hasVariants: false,
    basePriceRupees: 100,
    isAvailable: true,
    isActive: true,
    hsnSacCode: "996311",
  });
  const table = await createTable(restaurantId, {
    name: `T${n}`,
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
  });
  const order = await createOrder(restaurantId, BY, {
    orderType: "DINE_IN",
    tableId: table.id,
    items: [{ menuItemId: item.id, quantity: 2 }],
  });
  const bill = await generateBill(
    restaurantId,
    order.id,
    BY,
    discount
      ? ({
          discountType: "PERCENTAGE",
          discountValue: 10,
          discountReason: "Monsoon offer",
        } as never)
      : ({} as never)
  );
  const paid = await recordPayment(restaurantId, bill.id, BY, {
    method: "UPI",
    amountPaise: bill.grandTotalPaise,
    referenceNumber: "UPI123456",
  } as never);
  return paid.id;
}

async function getBillView(restaurantId: string, billId: string): Promise<BillView> {
  const view = await getBill(restaurantId, billId);
  expect(view).not.toBeNull();
  return view as BillView;
}

/* ================================================================== */
/* A + 11. Boolean settings: the reported bug                          */
/* ================================================================== */

describe("A. boolean settings accept real booleans, not the strings FormData sends", () => {
  it("A1. the form's 'true'/'false' strings parse into actual booleans", () => {
    const parsed = restaurantSettingsUpdateSchema.safeParse(booleanFormValues());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // The regression: these must be real booleans, not "true"/"false" strings.
    for (const field of BOOLEAN_FIELDS) {
      const value = (parsed.data as unknown as Record<string, unknown>)[field];
      expect(typeof value, `${field} must be a boolean`).toBe("boolean");
    }
    expect(parsed.data.gstRegistered).toBe(true);
    expect(parsed.data.taxEnabled).toBe(true);
    expect(parsed.data.taxInclusive).toBe(false);
    expect(parsed.data.serviceChargeEnabled).toBe(false);
    expect(parsed.data.roundOffEnabled).toBe(true);
  });

  it("A2. each boolean field is accepted as true and false independently", () => {
    for (const field of BOOLEAN_FIELDS) {
      for (const token of ["true", "false"]) {
        const parsed = restaurantSettingsUpdateSchema.safeParse(
          booleanFormValues({ [field]: token })
        );
        expect(parsed.success, `${field}=${token} must be accepted`).toBe(true);
        if (!parsed.success) continue;
        expect((parsed.data as unknown as Record<string, unknown>)[field]).toBe(
          token === "true"
        );
      }
    }
  });

  it("A3. real booleans (not strings) are also accepted", () => {
    const parsed = restaurantSettingsUpdateSchema.safeParse({
      gstRegistered: true,
      taxEnabled: false,
      taxInclusive: true,
      serviceChargeEnabled: true,
      roundOffEnabled: false,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.taxInclusive).toBe(true);
  });

  it("A4. non-boolean junk is still rejected rather than coerced", () => {
    for (const junk of ["yes", "1", "0", "on", "TRUE", "False", "null", {}]) {
      const parsed = restaurantSettingsUpdateSchema.safeParse(
        booleanFormValues({ gstRegistered: junk as string })
      );
      expect(parsed.success, `should reject ${JSON.stringify(junk)}`).toBe(false);
    }
  });

  it("A5. a boolean field absent from the form is left untouched", () => {
    const parsed = restaurantSettingsUpdateSchema.safeParse({ upiId: null });
    expect(parsed.success).toBe(true);
    for (const field of BOOLEAN_FIELDS) {
      expect(field in (parsed.data ?? {})).toBe(false);
    }
  });

  it("A6. the boolean path end-to-end persists real booleans", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest BoolE2E");

    // Feed the service the exact values the form produces.
    const parsed = restaurantSettingsUpdateSchema.parse(booleanFormValues());
    await updateRestaurantSettings(id, parsed);

    const snapshot = await getSettingsSnapshot(id);
    expect(snapshot.restaurant.gstRegistered).toBe(true);
    expect(snapshot.tax.taxEnabled).toBe(true);
    expect(snapshot.tax.taxInclusive).toBe(false);
    expect(snapshot.billing.serviceChargeEnabled).toBe(false);
    expect(snapshot.billing.roundOffEnabled).toBe(true);

    // Persisted as real booleans in Mongo, not the strings "true"/"false".
    const raw = await RestaurantSettingsModel.collection.findOne({
      restaurantId: new mongoose.Types.ObjectId(id),
    });
    expect(raw?.taxEnabled).toBe(true);
    expect(raw?.taxInclusive).toBe(false);
    expect(raw?.roundOffEnabled).toBe(true);
    expect(typeof raw?.taxEnabled).toBe("boolean");

    const rawRestaurant = await RestaurantModel.collection.findOne({
      _id: new mongoose.Types.ObjectId(id),
    });
    expect(rawRestaurant?.gstRegistered).toBe(true);
    expect(typeof rawRestaurant?.gstRegistered).toBe("boolean");
  });

  it("A7. toggling boolean settings off still works (regression guard)", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest BoolOff");

    const parsed = restaurantSettingsUpdateSchema.parse(
      booleanFormValues({
        taxEnabled: "false",
        taxInclusive: "false",
        serviceChargeEnabled: "false",
        roundOffEnabled: "false",
      })
    );
    await updateRestaurantSettings(id, parsed);

    const snapshot = await getSettingsSnapshot(id);
    expect(snapshot.tax.taxEnabled).toBe(false);
    expect(snapshot.tax.taxInclusive).toBe(false);
    expect(snapshot.billing.roundOffEnabled).toBe(false);
  });
});

/* ================================================================== */
/* B + C. UPI ID validation and storage                                */
/* ================================================================== */

describe("B/C. UPI ID setting", () => {
  it("B. a valid UPI ID saves and persists", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Save");

    const parsed = restaurantSettingsUpdateSchema.parse({
      ...booleanFormValues(),
      upiId: UPI,
    });
    const snapshot = await updateRestaurantSettings(id, parsed);

    expect(snapshot.billing.upiId).toBe(UPI);
    expect(await getRestaurantUpiId(id)).toBe(UPI);

    // Stored on the existing per-restaurant settings document.
    const raw = await RestaurantSettingsModel.collection.findOne({
      restaurantId: new mongoose.Types.ObjectId(id),
    });
    expect(raw?.upiId).toBe(UPI);
  });

  it("B2. the UPI ID is trimmed on save", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Trim");
    const parsed = restaurantSettingsUpdateSchema.parse({ upiId: `  ${UPI}  ` });
    expect(parsed.upiId).toBe(UPI);

    const snapshot = await updateRestaurantSettings(id, parsed);
    expect(snapshot.billing.upiId).toBe(UPI);
  });

  it("B3. valid handles from many providers are accepted (no hardcoded list)", () => {
    const valid = [
      "restaurantname@upi",
      "spicegarden@okaxis",
      "a@ybl",
      "my.restaurant@paytm",
      "shop_1@oksbi",
      "MiXeD@YbL",
    ];
    for (const upiId of valid) {
      expect(isValidUpiId(upiId), `should accept ${upiId}`).toBe(true);
      expect(restaurantSettingsUpdateSchema.safeParse({ upiId }).success).toBe(true);
    }
  });

  it("C. invalid UPI IDs are rejected by the schema", () => {
    const invalid = [
      "restaurantname",
      "restaurantname@",
      "@provider",
      "restaurant@pro vider",
      "restaurant name@provider",
      "restaurantname@pro/vider",
      "restaurantname@provider#1",
      "restaurantname@1234",
      "a".repeat(65) + "@provider",
      "restaurantname@" + "p".repeat(64) + "x",
      "<script>alert(1)</script>@provider",
      "javascript:alert(1)",
      "upi://pay?pa=x@y",
      "https://example.com/pay",
      "data:text/html,x@y",
      "restaurantname@provider\nInjected: 1",
    ];
    for (const upiId of invalid) {
      expect(
        restaurantSettingsUpdateSchema.safeParse({ upiId }).success,
        `should reject ${JSON.stringify(upiId)}`
      ).toBe(false);
    }
  });

  it("C1b. empty and whitespace-only input clear the field instead of erroring", () => {
    for (const empty of ["", "   ", "\t\n"]) {
      const parsed = restaurantSettingsUpdateSchema.safeParse({ upiId: empty });
      expect(parsed.success, `${JSON.stringify(empty)} should be accepted as a clear`).toBe(
        true
      );
      expect(parsed.data?.upiId).toBeNull();
    }
  });

  it("C2. the service re-validates independently of the schema", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Guard");

    for (const bad of ["javascript:alert(1)", "no-at-sign", "a@b c"]) {
      await expect(
        updateRestaurantSettings(id, { upiId: bad as never })
      ).rejects.toBeTruthy();
    }
    expect(await getRestaurantUpiId(id)).toBeNull();
  });

  it("C3. a legacy/hand-edited unsafe value is never read back as a UPI ID", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Legacy");
    await RestaurantSettingsModel.collection.updateOne(
      { restaurantId: new mongoose.Types.ObjectId(id) },
      { $set: { upiId: "javascript:alert(1)" } },
      { upsert: true }
    );
    expect(await getRestaurantUpiId(id)).toBeNull();
    expect((await getSettingsSnapshot(id)).billing.upiId).toBe("");
    expect(await buildUpiPaymentQrDataUri("javascript:alert(1)", "X", 100)).toBeNull();
  });

  it("D. an empty UPI ID is allowed, clears the value, and hides the QR", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Empty");
    await updateRestaurantSettings(id, { upiId: UPI });
    expect(await getRestaurantUpiId(id)).toBe(UPI);

    // Blank clears it, like email/GSTIN.
    const parsed = restaurantSettingsUpdateSchema.parse({ upiId: "" });
    expect(parsed.upiId).toBeNull();

    const snapshot = await updateRestaurantSettings(id, parsed);
    expect(snapshot.billing.upiId).toBe("");
    expect(await getRestaurantUpiId(id)).toBeNull();

    // Stays cleared after a reload.
    expect((await getSettingsSnapshot(id)).billing.upiId).toBe("");

    // And a bill now prints no QR.
    const bill = await getBillView(id, await seedBill(id));
    const html = await renderBill(id, bill);
    expect(html).not.toContain("SCAN TO PAY");
    expect(html).not.toContain("UPI ID:");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain('class="qr"');
  });
});

/* ================================================================== */
/* H. Restaurant isolation                                            */
/* ================================================================== */

describe("H. UPI ID restaurant isolation", () => {
  it("H1. restaurant A cannot read or write restaurant B's UPI ID", async () => {
    if (!available) return;
    const { restaurantId: a } = await seedTenant("UpiTest Alpha");
    const { restaurantId: b } = await seedTenant("UpiTest Bravo");

    await updateRestaurantSettings(a, { upiId: "alpha@okaxis" });
    await updateRestaurantSettings(b, { upiId: "bravo@okaxis" });

    expect(await getRestaurantUpiId(a)).toBe("alpha@okaxis");
    expect(await getRestaurantUpiId(b)).toBe("bravo@okaxis");

    // Writing A leaves B untouched.
    await updateRestaurantSettings(a, { upiId: "alpha2@okaxis" });
    expect(await getRestaurantUpiId(b)).toBe("bravo@okaxis");
    expect(await getRestaurantUpiId(a)).toBe("alpha2@okaxis");

    // Clearing A leaves B intact.
    await updateRestaurantSettings(a, { upiId: null });
    expect(await getRestaurantUpiId(a)).toBeNull();
    expect(await getRestaurantUpiId(b)).toBe("bravo@okaxis");
  });

  it("H2. a restaurant with no UPI ID cannot see another tenant's", async () => {
    if (!available) return;
    const { restaurantId: a } = await seedTenant("UpiTest Solo");
    const { restaurantId: c } = await seedTenant("UpiTest Charlie");
    await updateRestaurantSettings(a, { upiId: "solo@okaxis" });
    expect(await getRestaurantUpiId(c)).toBeNull();
    expect(await getRestaurantUpiId("000000000000000000000000")).toBeNull();
  });

  it("H3. each bill's QR uses only its own restaurant's UPI ID", async () => {
    if (!available) return;
    const { restaurantId: a } = await seedTenant("UpiTest QA");
    const { restaurantId: b } = await seedTenant("UpiTest QB");
    await updateRestaurantSettings(a, { upiId: "alpha@okaxis" });
    await updateRestaurantSettings(b, { upiId: "bravo@okaxis" });

    const htmlA = await renderBill(a, await getBillView(a, await seedBill(a)));
    const htmlB = await renderBill(b, await getBillView(b, await seedBill(b)));

    expect(decodeQr(await buildUpiPaymentQrDataUri("alpha@okaxis", "A", 100))).toContain(
      "pa=alpha%40okaxis"
    );
    expect(htmlA).toContain("UPI ID: alpha@okaxis");
    expect(htmlA).not.toContain("bravo@okaxis");
    expect(htmlB).toContain("UPI ID: bravo@okaxis");
    expect(htmlB).not.toContain("alpha@okaxis");
  });
});

/* ================================================================== */
/* E, F, G. QR on the bill                                            */
/* ================================================================== */

describe("E/F/G. UPI payment QR on the bill", () => {
  it("E. a bill with a UPI ID prints the QR, caption and UPI ID", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest QrOn");
    await updateRestaurantSettings(id, { upiId: UPI });
    const bill = await getBillView(id, await seedBill(id));

    const html = await renderBill(id, bill);
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain("SCAN TO PAY");
    expect(html).toContain(`UPI ID: ${UPI}`);
    expect(html).toContain('class="qr"');
  });

  it("F. the QR encodes a proper UPI payment URI with the final payable amount", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest QrContent");
    await updateRestaurantSettings(id, { upiId: UPI });
    const bill = await getBillView(id, await seedBill(id));

    // Use the restaurant's real name — the header comes from the database.
    const restaurantName = (await RestaurantModel.findById(id).lean())!.name;
    const qr = await buildUpiPaymentQrDataUri(
      await getRestaurantUpiId(id),
      restaurantName,
      bill.grandTotalPaise
    );
    expect(qr).not.toBeNull();

    // Decode the actual QR image and inspect its payload.
    const decoded = decodeQr(qr);
    expect(decoded).not.toBeNull();
    expect(decoded).toMatch(/^upi:\/\/pay\?/);

    const params = new URLSearchParams(decoded!.split("?")[1]);
    // Payee = the configured UPI ID.
    expect(params.get("pa")).toBe(UPI);
    // Payee name = the restaurant name, correctly decoded despite the space.
    expect(params.get("pn")).toBe(restaurantName);
    // Amount = the final payable total, after discount and GST.
    expect(params.get("am")).toBe((bill.grandTotalPaise / 100).toFixed(2));
    expect(params.get("cu")).toBe("INR");

    // The QR really is on the bill, carrying that same URI.
    const html = await renderBill(id, bill);
    expect(html).toContain(qr!);
  });

  it("F2. the encoded amount is the post-discount, post-GST total", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Amount");
    await updateRestaurantSettings(id, { upiId: UPI });
    const bill = await getBillView(id, await seedBill(id, true));

    // Sanity: the bill actually had a discount and tax applied.
    expect(bill.discountPaise).toBeGreaterThan(0);
    expect(bill.totalTaxPaise).toBeGreaterThan(0);
    expect(bill.grandTotalPaise).toBe(
      bill.taxableAmountPaise + bill.totalTaxPaise
    );

    const uri = buildUpiPaymentUri(UPI, RESTAURANT_NAME, bill.grandTotalPaise);
    const am = new URLSearchParams(uri!.split("?")[1]).get("am");
    // Not the pre-discount subtotal, and not the pre-tax taxable amount.
    expect(am).toBe((bill.grandTotalPaise / 100).toFixed(2));
    expect(am).not.toBe((bill.subtotalPaise / 100).toFixed(2));
    expect(am).not.toBe((bill.taxableAmountPaise / 100).toFixed(2));
  });

  it("F3. amounts are formatted to exactly two decimals", () => {
    expect(new URLSearchParams(buildUpiPaymentUri(UPI, "X", 1)!.split("?")[1]).get("am")).toBe(
      "0.01"
    );
    expect(new URLSearchParams(buildUpiPaymentUri(UPI, "X", 100)!.split("?")[1]).get("am")).toBe(
      "1.00"
    );
    expect(
      new URLSearchParams(buildUpiPaymentUri(UPI, "X", 28350)!.split("?")[1]).get("am")
    ).toBe("283.50");
    expect(new URLSearchParams(buildUpiPaymentUri(UPI, "X", 0)!.split("?")[1]).get("am")).toBe(
      "0.00"
    );
  });

  it("F4. a restaurant name with spaces and punctuation survives encoding", () => {
    const name = "Mama's Kitchen & Co.";
    const uri = buildUpiPaymentUri(UPI, name, 52500)!;
    // The raw URI is a valid, properly escaped upi:// URL.
    expect(uri.startsWith("upi://pay?")).toBe(true);
    expect(uri).not.toContain(" ");
    expect(uri).toContain("%26"); // the ampersand in the name
    expect(new URLSearchParams(uri.split("?")[1]).get("pn")).toBe(name);
    expect(new URLSearchParams(uri.split("?")[1]).get("pa")).toBe(UPI);
  });

  it("F5. a QR is generated for every valid UPI ID shape", async () => {
    for (const upiId of ["a@ybl", "restaurantname@upi", "my.restaurant@paytm", "shop_1@oksbi"]) {
      const qr = await buildUpiPaymentQrDataUri(upiId, RESTAURANT_NAME, 52500);
      expect(qr, `expected a QR for ${upiId}`).toMatch(/^data:image\/png;base64,/);
      const decoded = decodeQr(qr);
      expect(new URLSearchParams(decoded!.split("?")[1]).get("pa")).toBe(upiId);
      expect(new URLSearchParams(decoded!.split("?")[1]).get("am")).toBe("525.00");
    }
  });

  it("G. a bill without a UPI ID prints no QR and reserves no space", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest QrOff");
    const bill = await getBillView(id, await seedBill(id));

    expect(await getRestaurantUpiId(id)).toBeNull();
    const html = await renderBill(id, bill);

    // No image, no caption, no UPI line, and no empty QR wrapper.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("SCAN TO PAY");
    expect(html).not.toContain("UPI ID:");
    expect(html).not.toContain('class="qr"');
    // The rest of the slip is intact.
    expect(html).toContain("GRAND TOTAL");
    expect(html).toContain("Thank you, visit again!");
  });

  it("G2. clearing the UPI ID removes the QR from newly built bills", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest ClearQr");
    await updateRestaurantSettings(id, { upiId: UPI });
    const bill = await getBillView(id, await seedBill(id));

    expect(await renderBill(id, bill)).toContain("SCAN TO PAY");

    await updateRestaurantSettings(id, { upiId: null });
    expect(await renderBill(id, bill)).not.toContain("SCAN TO PAY");
  });
});

/* ================================================================== */
/* 6. Preview and print share one source of truth                     */
/* ================================================================== */

describe("6. preview and print use the same persisted UPI ID and amount", () => {
  it("6. both renderings are byte-identical and come from the stored value", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Preview");
    await updateRestaurantSettings(id, { upiId: UPI });
    const bill = await getBillView(id, await seedBill(id));

    // The print flow and any preview both build from loadBillHeader(); calling
    // it twice must produce the same slip.
    const preview = await renderBill(id, bill);
    const printed = await renderBill(id, bill);
    expect(preview).toBe(printed);
    expect(decodeQr(await buildUpiPaymentQrDataUri(await getRestaurantUpiId(id), RESTAURANT_NAME, bill.grandTotalPaise))).toContain(
      `pa=${encodeURIComponent(UPI)}`
    );

    // Changing the setting changes both together, with no client value involved.
    await updateRestaurantSettings(id, { upiId: "changed@ybl" });
    const afterUpdate = await renderBill(id, bill);
    expect(afterUpdate).not.toBe(preview);
    expect(afterUpdate).toContain("UPI ID: changed@ybl");
    expect(afterUpdate).not.toContain(UPI);
  });

  it("6b. the bill snapshot stores no UPI ID of its own", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Snapshot");
    await updateRestaurantSettings(id, { upiId: UPI });
    const billId = await seedBill(id);

    const raw = await BillModel.findById(billId).lean();
    expect(raw).not.toBeNull();
    expect("upiId" in (raw as Record<string, unknown>)).toBe(false);
    expect("paymentQrDataUri" in (raw as unknown as Record<string, unknown>)).toBe(false);
  });
});

/* ================================================================== */
/* I. Existing calculations unchanged                                  */
/* ================================================================== */

describe("I. the UPI QR does not affect existing billing", () => {
  it("I1. money, GST and discount lines are identical with and without a UPI ID", async () => {
    if (!available) return;
    const withUpi = await seedTenant("UpiTest CalcA");
    const withoutUpi = await seedTenant("UpiTest CalcB");
    await updateRestaurantSettings(withUpi.restaurantId, { upiId: UPI });

    const billA = await getBillView(
      withUpi.restaurantId,
      await seedBill(withUpi.restaurantId)
    );
    const billB = await getBillView(
      withoutUpi.restaurantId,
      await seedBill(withoutUpi.restaurantId)
    );

    // Identical inputs produce identical money, whatever the UPI setting is.
    for (const key of [
      "subtotalPaise",
      "discountPaise",
      "taxableAmountPaise",
      "cgstAmountPaise",
      "sgstAmountPaise",
      "igstAmountPaise",
      "totalTaxPaise",
      "serviceChargeAmountPaise",
      "roundOffAmountPaise",
      "grandTotalPaise",
      "paidAmountPaise",
      "dueAmountPaise",
    ] as const) {
      expect(
        (billA as unknown as Record<string, unknown>)[key],
        `${key} must not depend on the UPI setting`
      ).toEqual((billB as unknown as Record<string, unknown>)[key]);
    }

    // Same restaurant, same bill, with and without a UPI ID: once the QR block
    // is removed the two slips are byte-identical, so the QR is the *only*
    // difference the setting makes to the printed bill.
    const { restaurantId: id } = await seedTenant("UpiTest CalcC");
    await updateRestaurantSettings(id, { upiId: UPI });
    const bill = await getBillView(id, await seedBill(id));
    const withQr = await renderBill(id, bill);
    expect(withQr).toContain("SCAN TO PAY");

    await updateRestaurantSettings(id, { upiId: null });
    const withoutQr = await renderBill(id, bill);
    expect(withoutQr).not.toContain("SCAN TO PAY");

    // The QR block spans several lines and ends with a lone "</div>".
    const stripQr = (html: string) =>
      html.replace(/<div class="qr">[\s\S]*?\n<\/div>\n/g, "");
    expect(stripQr(withQr)).toBe(withoutQr);
  });

  it("I2. tax, discount, payment and logo sections still render", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest Sections");
    await updateRestaurantSettings(id, { upiId: UPI });
    const bill = await getBillView(id, await seedBill(id));

    const logoDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const html = buildBillHtml(
      bill,
      header({
        logoDataUri,
        upiId: UPI,
        paymentQrDataUri: await buildUpiPaymentQrDataUri(UPI, RESTAURANT_NAME, bill.grandTotalPaise),
      })
    );

    expect(html).toContain(logoDataUri);
    expect(html).toContain(RESTAURANT_NAME);
    expect(html).toContain("12 MG Road, Bengaluru, Karnataka, 560001");
    expect(html).toContain("GSTIN: 29ABCDE1234F1Z5");
    expect(html).toContain("TAX INVOICE / BILL");
    expect(html).toContain("Coffee");
    expect(html).toContain("HSN/SAC: 996311");
    expect(html).toContain("Subtotal");
    expect(html).toContain("Discount (10%)");
    expect(html).toContain("Monsoon offer");
    expect(html).toContain("Taxable");
    expect(html).toContain("CGST @");
    expect(html).toContain("SGST @");
    expect(html).toContain("GRAND TOTAL");
    expect(html).toContain("Paid:");
    expect(html).toContain("Thank you, visit again!");
    expect(html).toContain("SCAN TO PAY");
  });

  it("I3. the QR encodes the payable amount without altering the bill total", async () => {
    if (!available) return;
    const { restaurantId: id } = await seedTenant("UpiTest NoChange");
    const before = await seedBill(id);
    const billBefore = await getBillView(id, before);

    await updateRestaurantSettings(id, { upiId: UPI });
    const after = await seedBill(id);
    const billAfter = await getBillView(id, after);

    // Same items, same money — configuring a UPI ID changes nothing but the QR.
    expect(billAfter.grandTotalPaise).toBe(billBefore.grandTotalPaise);
    expect(billAfter.subtotalPaise).toBe(billBefore.subtotalPaise);
    expect(billAfter.totalTaxPaise).toBe(billBefore.totalTaxPaise);
    // Same line economics on both bills (each seeds its own menu item, so
    // compare the priced fields rather than item identity).
    const economics = (b: BillView) =>
      b.items.map((i) => ({
        quantity: i.quantity,
        unitPricePaise: i.unitPricePaise,
        taxableValuePaise: i.taxableValuePaise,
        discountAmountPaise: i.discountAmountPaise,
        lineTotalPaise: i.lineTotalPaise,
      }));
    expect(economics(billAfter)).toEqual(economics(billBefore));
  });
});

/* ================================================================== */
/* QR generator                                                       */
/* ================================================================== */

describe("buildUpiPaymentUri / buildUpiPaymentQrDataUri", () => {
  it("returns null for missing or invalid UPI IDs", () => {
    expect(buildUpiPaymentUri(null, "X", 100)).toBeNull();
    expect(buildUpiPaymentUri(undefined, "X", 100)).toBeNull();
    expect(buildUpiPaymentUri("", "X", 100)).toBeNull();
    expect(buildUpiPaymentUri("nope", "X", 100)).toBeNull();
    expect(buildUpiPaymentUri("javascript:alert(1)", "X", 100)).toBeNull();
  });

  it("returns null for a non-finite or negative amount", () => {
    expect(buildUpiPaymentUri(UPI, "X", Number.NaN)).toBeNull();
    expect(buildUpiPaymentUri(UPI, "X", Number.POSITIVE_INFINITY)).toBeNull();
    expect(buildUpiPaymentUri(UPI, "X", -1)).toBeNull();
  });

  it("omits pn when no restaurant name is available", () => {
    const uri = buildUpiPaymentUri(UPI, "   ", 100)!;
    expect(uri).not.toContain("pn=");
    expect(uri).toContain(`pa=${encodeURIComponent(UPI)}`);
  });

  it("always returns a valid PNG data URI for a valid request", async () => {
    const qr = await buildUpiPaymentQrDataUri(UPI, RESTAURANT_NAME, 52500);
    expect(qr).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(qr!.split(",")[1], "base64").subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a"
    );
  });
});
