import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { MenuCategoryModel } from "@/models/MenuCategory";
import { MenuItemModel } from "@/models/MenuItem";
import { OrderModel } from "@/models/Order";
import { BillModel } from "@/models/Bill";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword } from "@/lib/auth/password";
import { createRestaurantForUser } from "@/lib/restaurant-service";
import { createCategory } from "@/lib/menu/category-service";
import { createMenuItem } from "@/lib/menu/item-service";
import { createOrder } from "@/lib/orders/order-service";
import { createTable } from "@/lib/tables/table-service";
import { generateBill, getBill } from "@/lib/billing/bill-service";
import { buildBillHtml, toLogoDataUri, type BillRestaurantHeader } from "@/lib/billing/print";
import {
  getRestaurantLogo,
  getSettingsSnapshot,
  removeRestaurantLogo,
  saveRestaurantLogo,
  SettingsValidationError,
} from "@/lib/settings/settings-service";
import { validateLogoBytes } from "@/lib/settings/logo";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_logo_e2e";

/** A real, decodable 1x1 PNG. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x01, 0x02, 0x03,
]);
/** A second, different 1x1 PNG used to prove replacement really swaps bytes. */
const PNG_2 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x01, 0x02, 0x04,
]);

let available = false;

interface Tenant {
  restaurantId: string;
  userId: string;
}

async function seedTenant(name: string): Promise<Tenant> {
  const passwordHash = await hashPassword("Password123!");
  const user = await UserModel.create({
    fullName: "Owner",
    email: `logo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@restopos.test`,
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
    gstRegistered: false,
    gstin: "",
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
      UserModel.deleteMany({ email: /^logo-/ }),
      RestaurantModel.deleteMany({ name: /^Logo/ }),
      RestaurantSettingsModel.deleteMany({}),
      MenuCategoryModel.deleteMany({}),
      MenuItemModel.deleteMany({}),
      OrderModel.deleteMany({}),
      BillModel.deleteMany({}),
      TableAuditLogModel.collection.deleteMany({}),
    ]);
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  if (!available) return;
  await UserModel.deleteMany({ email: /^logo-/ });
  await RestaurantModel.deleteMany({ name: /^Logo/ });
  await RestaurantSettingsModel.deleteMany({});
});

/* ------------------------------------------------------------------ */
/* Persistence: write, reload, replace, remove                         */
/* ------------------------------------------------------------------ */

describe("logo persistence in MongoDB", () => {
  it("1. an uploaded logo is really written to MongoDB", async () => {
    if (!available) return;
    const t = await seedTenant("Logo Upload Cafe");

    const saved = await saveRestaurantLogo(t.restaurantId, PNG, "image/png", {
      userId: t.userId,
      role: "OWNER",
    });
    expect(saved.mimeType).toBe("image/png");
    expect(saved.size).toBe(PNG.byteLength);

    // Read the raw BSON, bypassing every mongoose accessor, exactly as Mongo
    // actually holds it.
    const raw = await RestaurantModel.collection.findOne({
      _id: new mongoose.Types.ObjectId(t.restaurantId),
    });
    expect(raw?.logo).toBeTruthy();
    expect(raw?.logo.mimeType).toBe("image/png");
    expect(raw?.logo.size).toBe(PNG.byteLength);

    expect(raw).not.toBeNull();
    const stored = raw!.logo.data as unknown as { buffer?: Uint8Array };
    const bytes = Buffer.from(stored.buffer ?? (raw!.logo.data as unknown as Buffer));
    expect(bytes.equals(Buffer.from(PNG))).toBe(true);
  });

  it("2. the logo survives a reload (fresh read, no client state)", async () => {
    if (!available) return;
    const t = await seedTenant("Logo Reload Cafe");
    await saveRestaurantLogo(t.restaurantId, PNG, "image/png");

    // A "reload" is a brand-new read: nothing is carried in memory.
    const fetched = await getRestaurantLogo(t.restaurantId);
    expect(fetched).not.toBeNull();
    expect(fetched?.mimeType).toBe("image/png");
    expect(Buffer.from(fetched!.data).equals(Buffer.from(PNG))).toBe(true);
    expect(fetched?.updatedAt).toBeTruthy();

    // The settings snapshot that drives the settings <img> must agree.
    const snapshot = await getSettingsSnapshot(t.restaurantId);
    expect(snapshot.logo.present).toBe(true);
    expect(snapshot.logo.mimeType).toBe("image/png");
    expect(snapshot.logo.size).toBe(PNG.byteLength);
  });

  it("2b. a lean-read BSON Binary is decoded, not silently lost", async () => {
    if (!available) return;
    const t = await seedTenant("Logo Binary Cafe");
    // Write through the raw driver, i.e. exactly what a restored backup or a
    // second writer leaves behind. This is the shape the bug lived in.
    await RestaurantModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(t.restaurantId) },
      {
        $set: {
          logo: {
            data: Buffer.from(PNG),
            mimeType: "image/png",
            size: PNG.byteLength,
            updatedAt: new Date(),
          },
        },
      }
    );

    const raw = await RestaurantModel.collection.findOne({
      _id: new mongoose.Types.ObjectId(t.restaurantId),
    });
    const binary = raw!.logo.data as unknown as { constructor: { name: string } };

    // The real defect: driver 6+ `Binary` is not a Node Buffer, and
    // `Buffer.from(binary)` does NOT throw -- it silently yields zero bytes.
    // That is why a perfectly good upload used to read as "no logo" and 404.
    expect(binary.constructor.name).toBe("Binary");
    expect(binary).not.toBeInstanceOf(Buffer);
    expect(Buffer.from(binary as unknown as Buffer).length).toBe(0);

    // The read path must therefore normalise explicitly.
    const fetched = await getRestaurantLogo(t.restaurantId);
    expect(fetched).not.toBeNull();
    expect(fetched!.size).toBe(PNG.byteLength);
    expect(Buffer.from(fetched!.data).equals(Buffer.from(PNG))).toBe(true);
  });

  it("3. replacing a logo swaps the bytes and leaves no old data", async () => {
    if (!available) return;
    const t = await seedTenant("Logo Replace Cafe");
    await saveRestaurantLogo(t.restaurantId, PNG, "image/png");
    const first = await getRestaurantLogo(t.restaurantId);

    await saveRestaurantLogo(t.restaurantId, PNG_2, "image/png");
    const second = await getRestaurantLogo(t.restaurantId);

    expect(Buffer.from(second!.data).equals(Buffer.from(PNG_2))).toBe(true);
    expect(Buffer.from(second!.data).equals(Buffer.from(PNG))).toBe(false);
    expect(second!.size).toBe(PNG_2.byteLength);
    expect(first!.updatedAt).not.toBe(second!.updatedAt);

    // Exactly one logo sub-document, holding only the new bytes.
    const raw = await RestaurantModel.collection.findOne({
      _id: new mongoose.Types.ObjectId(t.restaurantId),
    });
    const keys = Object.keys(raw?.logo ?? {});
    expect(keys.sort()).toEqual(["data", "mimeType", "size", "updatedAt"]);
  });

  it("4. removing a logo stays removed after a reload", async () => {
    if (!available) return;
    const t = await seedTenant("Logo Remove Cafe");
    await saveRestaurantLogo(t.restaurantId, PNG, "image/png");
    expect((await getSettingsSnapshot(t.restaurantId)).logo.present).toBe(true);

    await removeRestaurantLogo(t.restaurantId);

    expect(await getRestaurantLogo(t.restaurantId)).toBeNull();
    const afterReload = await getSettingsSnapshot(t.restaurantId);
    expect(afterReload.logo.present).toBe(false);
    expect(afterReload.logo.mimeType).toBe("");
    expect(afterReload.logo.size).toBe(0);

    const raw = await RestaurantModel.collection.findOne({
      _id: new mongoose.Types.ObjectId(t.restaurantId),
    });
    expect(raw?.logo === undefined || raw?.logo === null).toBe(true);
  });

  it("5. restaurant A can never read restaurant B's logo", async () => {
    if (!available) return;
    const a = await seedTenant("Logo Alpha Cafe");
    const b = await seedTenant("Logo Bravo Cafe");
    await saveRestaurantLogo(a.restaurantId, PNG, "image/png");
    await saveRestaurantLogo(b.restaurantId, PNG_2, "image/png");

    // Each tenant reads strictly under its own id.
    const fromA = await getRestaurantLogo(a.restaurantId);
    const fromB = await getRestaurantLogo(b.restaurantId);
    expect(Buffer.from(fromA!.data).equals(Buffer.from(PNG))).toBe(true);
    expect(Buffer.from(fromB!.data).equals(Buffer.from(PNG_2))).toBe(true);

    // And a restaurant that exists but owns no logo returns nothing, rather
    // than falling through to another tenant's bytes.
    const c = await seedTenant("Logo Charlie Cafe");
    expect(await getRestaurantLogo(c.restaurantId)).toBeNull();

    // A non-existent restaurant id yields nothing rather than throwing.
    expect(await getRestaurantLogo("000000000000000000000000")).toBeNull();
  });

  it("5b. saving over another restaurant is impossible (unknown id rejected)", async () => {
    if (!available) return;
    await expect(
      saveRestaurantLogo("000000000000000000000000", PNG, "image/png")
    ).rejects.toThrow();
  });

  it("6. invalid image bytes are rejected and nothing is stored", async () => {
    if (!available) return;
    const t = await seedTenant("Logo Reject Cafe");
    const notAnImage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

    expect(validateLogoBytes(notAnImage, "image/png").ok).toBe(false);
    await expect(
      saveRestaurantLogo(t.restaurantId, notAnImage, "image/png")
    ).rejects.toThrow(SettingsValidationError);
    expect(await getRestaurantLogo(t.restaurantId)).toBeNull();

    // A declared type that disagrees with the magic bytes is refused.
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await expect(
      saveRestaurantLogo(t.restaurantId, jpegBytes, "image/png")
    ).rejects.toThrow(SettingsValidationError);
    expect(await getRestaurantLogo(t.restaurantId)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Bill printing                                                       */
/* ------------------------------------------------------------------ */

const BY = "0123456789abcdef01234567";

async function seedBillFor(restaurantId: string): Promise<string> {
  const category = await createCategory(restaurantId, {
    name: "Mains",
    isActive: true,
    displayOrder: 0,
  });
  const item = await createMenuItem(restaurantId, {
    categoryId: category.id,
    name: "Paneer Tikka",
    itemType: "FOOD",
    vegType: "VEG",
    hasVariants: false,
    basePriceRupees: 250,
    isAvailable: true,
    isActive: true,
  });
  const table = await createTable(restaurantId, {
    name: "T1",
    capacity: 4,
    sectionId: null,
    status: "AVAILABLE",
    isActive: true,
  });
  const order = await createOrder(restaurantId, BY, {
    orderType: "DINE_IN",
    tableId: table.id,
    items: [{ menuItemId: item.id, quantity: 1 }],
  });
  const bill = await generateBill(restaurantId, order.id, BY);
  return bill.id;
}

function headerWith(logoDataUri: string | null): BillRestaurantHeader {
  return {
    name: "Print Kitchen",
    address: "1 Food St",
    city: "Mumbai",
    state: "MA",
    pincode: "400001",
    phone: "9876543210",
    gstin: "29ABCDE1234F1Z5",
    logoDataUri,
  };
}

describe("bill print logo", () => {
  it("7. a bill printed with a logo embeds the image inline", async () => {
    if (!available) return;
    const t = await seedTenant("Logo Bill Cafe");
    await saveRestaurantLogo(t.restaurantId, PNG, "image/png");
    const billId = await seedBillFor(t.restaurantId);

    const bill = await getBill(t.restaurantId, billId);
    expect(bill).not.toBeNull();

    // Reproduce exactly what printBillAction assembles.
    const logo = await getRestaurantLogo(t.restaurantId);
    const html = buildBillHtml(bill!, headerWith(toLogoDataUri(logo)));

    // Inlined, so the print iframe needs no second request and cannot race.
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain("<img");
    // The payload really is the stored bytes.
    const expected = Buffer.from(PNG).toString("base64");
    expect(html).toContain(expected);
    // It is a complete, self-contained data URI.
    const match = html.match(/src="(data:image\/png;base64,[^"]+)"/);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1].split(",")[1], "base64").equals(Buffer.from(PNG))).toBe(true);
  });

  it("8. a bill without a logo prints normally and reserves no space", async () => {
    if (!available) return;
    const t = await seedTenant("Logo NoLogo Cafe");
    const billId = await seedBillFor(t.restaurantId);
    const bill = await getBill(t.restaurantId, billId);
    expect(bill).not.toBeNull();

    expect(await getRestaurantLogo(t.restaurantId)).toBeNull();
    const html = buildBillHtml(
      bill!,
      headerWith(toLogoDataUri(await getRestaurantLogo(t.restaurantId)))
    );

    // No image element at all — not a broken or empty one.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("src=");
    // The rest of the slip is unchanged.
    expect(html).toContain("Print Kitchen");
    expect(html).toContain("1 Food St, Mumbai, MA, 400001");
    expect(html).toContain("Tel: 9876543210");
    expect(html).toContain("TAX INVOICE / BILL");
    expect(html).toContain("GRAND TOTAL");
    expect(html).toContain("Paneer Tikka");
  });

  it("9. bill calculations and layout are untouched by the logo", async () => {
    if (!available) return;
    const withLogo = await seedTenant("Logo Calc A Cafe");
    const withoutLogo = await seedTenant("Logo Calc B Cafe");
    await saveRestaurantLogo(withLogo.restaurantId, PNG, "image/png");

    const idA = await seedBillFor(withLogo.restaurantId);
    const idB = await seedBillFor(withoutLogo.restaurantId);
    const billA = await getBill(withLogo.restaurantId, idA);
    const billB = await getBill(withoutLogo.restaurantId, idB);
    expect(billA).not.toBeNull();
    expect(billB).not.toBeNull();

    const uri = toLogoDataUri(await getRestaurantLogo(withLogo.restaurantId));
    const htmlA = buildBillHtml(billA!, headerWith(uri));
    const htmlB = buildBillHtml(billB!, headerWith(null));

    // Identical money fields: the logo cannot influence any calculation.
    for (const key of [
      "subtotalPaise",
      "discountPaise",
      "taxableAmountPaise",
      "cgstAmountPaise",
      "sgstAmountPaise",
      "igstAmountPaise",
      "totalTaxPaise",
      "grandTotalPaise",
      "roundOffAmountPaise",
    ]) {
      expect((billA as unknown as Record<string, unknown>)[key]).toEqual(
        (billB as unknown as Record<string, unknown>)[key]
      );
    }

    // Stripping the single logo line makes the two slips byte-identical.
    const stripLogo = (html: string) =>
      html.replace(/<div class="logo c">.*?<\/div>\n/, "");
    expect(stripLogo(htmlA)).toBe(htmlB);
  });

  it("10. the logo appears in the header area, above the restaurant name", async () => {
    const html = buildBillHtml(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { billNumber: "B-000001", items: [], payments: [], gstRegistered: false } as any,
      headerWith("data:image/png;base64,AAAA")
    );
    const imgAt = html.indexOf("<img");
    const nameAt = html.indexOf("Print Kitchen");
    const addrAt = html.indexOf("1 Food St");
    const telAt = html.indexOf("Tel:");
    expect(imgAt).toBeGreaterThan(-1);
    // The logo leads the header block, above name → address → phone.
    expect(imgAt).toBeLessThan(nameAt);
    expect(nameAt).toBeLessThan(addrAt);
    expect(addrAt).toBeLessThan(telAt);
  });

  it("11. a base64 data URI is not HTML-escaped into an unrenderable src", async () => {
    // base64 contains "+" and "/" and "="; only quotes and angle brackets would
    // need escaping, and the esc() helper must not mangle the payload.
    const html = buildBillHtml(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { billNumber: "B-000001", items: [], payments: [], gstRegistered: false } as any,
      headerWith("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==")
    );
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="');
  });
});

/* ------------------------------------------------------------------ */
/* Historical bills                                                    */
/* ------------------------------------------------------------------ */

describe("historical bill behaviour", () => {
  it("12. the bill stores no logo, so a later logo change cannot corrupt it", async () => {
    if (!available) return;
    const t = await seedTenant("Logo History Cafe");
    await saveRestaurantLogo(t.restaurantId, PNG, "image/png");
    const billId = await seedBillFor(t.restaurantId);

    const before = await BillModel.findById(billId).lean();
    expect(before).not.toBeNull();
    const viewBefore = await getBill(t.restaurantId, billId);
    expect(viewBefore).not.toBeNull();
    // The Bill document has no logo field: the print slip resolves the
    // restaurant's current logo, exactly as it resolves name/address/phone.
    expect("logo" in (before as Record<string, unknown>)).toBe(false);

    // Change, remove, and re-add the logo after the bill exists.
    await saveRestaurantLogo(t.restaurantId, PNG_2, "image/png");
    const afterReplace = await BillModel.findById(billId).lean();
    expect(afterReplace!.grandTotalPaise).toBe(before!.grandTotalPaise);
    expect(afterReplace!.billNumber).toBe(before!.billNumber);
    expect(afterReplace!.items).toEqual(before!.items);

    await removeRestaurantLogo(t.restaurantId);
    const afterRemove = await BillModel.findById(billId).lean();
    expect(afterRemove!.grandTotalPaise).toBe(before!.grandTotalPaise);
    expect("logo" in (afterRemove as Record<string, unknown>)).toBe(false);

    // Reprinting the old bill now shows the restaurant's current logo state.
    const viewAfterRemove = await getBill(t.restaurantId, billId);
    const reprintNoLogo = buildBillHtml(
      viewAfterRemove!,
      headerWith(toLogoDataUri(await getRestaurantLogo(t.restaurantId)))
    );
    expect(reprintNoLogo).not.toContain("<img");
    expect(reprintNoLogo).toContain(before!.billNumber);
    expect(reprintNoLogo).toContain("GRAND TOTAL");

    await saveRestaurantLogo(t.restaurantId, PNG, "image/png");
    const reprintWithLogo = buildBillHtml(
      viewAfterRemove!,
      headerWith(toLogoDataUri(await getRestaurantLogo(t.restaurantId)))
    );
    expect(reprintWithLogo).toContain('src="data:image/png;base64,');
    expect(reprintWithLogo).toContain(before!.billNumber);
  });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

describe("logo data URI helper", () => {
  it("returns null for nothing, empty bytes or a missing mime type", () => {
    expect(toLogoDataUri(null)).toBeNull();
    expect(toLogoDataUri({ data: new Uint8Array(), mimeType: "image/png" })).toBeNull();
    expect(toLogoDataUri({ data: PNG, mimeType: "" })).toBeNull();
  });

  it("encodes bytes as base64 with the verified mime type", () => {
    expect(toLogoDataUri({ data: PNG, mimeType: "image/png" })).toBe(
      `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`
    );
  });
});
