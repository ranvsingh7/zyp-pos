import { describe, it, expect } from "vitest";
import {
  tableInputSchema,
  tableUpdateSchema,
  tableStatusSchema,
  tableActivationSchema,
  sectionInputSchema,
} from "@/lib/tables/validation";

const validTable = {
  name: "T1",
  capacity: 4,
  sectionId: null,
  status: "AVAILABLE",
  isActive: true,
};

describe("tableInputSchema", () => {
  it("accepts a valid input", () => {
    const result = tableInputSchema.safeParse(validTable);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sectionId).toBeNull();
      expect(result.data.status).toBe("AVAILABLE");
    }
  });

  it("trims and enforces 1-50 char names", () => {
    expect(tableInputSchema.safeParse({ ...validTable, name: "  " }).success).toBe(
      false
    );
    expect(
      tableInputSchema.safeParse({ ...validTable, name: "x".repeat(51) }).success
    ).toBe(false);
    const result = tableInputSchema.safeParse({ ...validTable, name: "  T2  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("T2");
  });

  it("enforces capacity 1-20 as integers", () => {
    expect(tableInputSchema.safeParse({ ...validTable, capacity: 0 }).success).toBe(
      false
    );
    expect(tableInputSchema.safeParse({ ...validTable, capacity: 21 }).success).toBe(
      false
    );
    expect(
      tableInputSchema.safeParse({ ...validTable, capacity: 2.5 }).success
    ).toBe(false);
    // Coerces numeric strings.
    const result = tableInputSchema.safeParse({ ...validTable, capacity: "6" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.capacity).toBe(6);
  });

  it("accepts only valid statuses and defaults", () => {
    expect(
      tableInputSchema.safeParse({ ...validTable, status: "OCCUPIED" }).success
    ).toBe(true);
    expect(
      tableInputSchema.safeParse({ ...validTable, status: "BROKEN" }).success
    ).toBe(false);
    const result = tableInputSchema.safeParse({
      name: "T3",
      capacity: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("AVAILABLE");
      expect(result.data.isActive).toBe(true);
      expect(result.data.sectionId).toBeNull();
    }
  });

  it("accepts a valid 24-char section id and rejects malformed ones", () => {
    expect(
      tableInputSchema.safeParse({
        ...validTable,
        sectionId: "0123456789abcdef01234567",
      }).success
    ).toBe(true);
    expect(
      tableInputSchema.safeParse({ ...validTable, sectionId: "not-an-id" }).success
    ).toBe(false);
  });

  it("rejects unknown fields only through strict piping (loose by default)", () => {
    const result = tableInputSchema.safeParse({ ...validTable, evil: true });
    expect(result.success).toBe(true);
  });
});

describe("table update/status/activation", () => {
  it("requires a valid id on update", () => {
    expect(tableUpdateSchema.safeParse(validTable).success).toBe(false);
    expect(
      tableUpdateSchema.safeParse({
        ...validTable,
        id: "0123456789abcdef01234567",
      }).success
    ).toBe(true);
  });

  it("validates status payloads", () => {
    expect(
      tableStatusSchema.safeParse({
        id: "0123456789abcdef01234567",
        status: "RESERVED",
      }).success
    ).toBe(true);
    expect(
      tableStatusSchema.safeParse({ id: "nope", status: "RESERVED" }).success
    ).toBe(false);
  });

  it("validates activation payloads", () => {
    expect(
      tableActivationSchema.safeParse({
        id: "0123456789abcdef01234567",
        isActive: false,
      }).success
    ).toBe(true);
    expect(
      tableActivationSchema.safeParse({ id: "x", isActive: false }).success
    ).toBe(false);
  });
});

describe("sectionInputSchema", () => {
  it("validates section names and defaults", () => {
    const result = sectionInputSchema.safeParse({ name: "Ground Floor" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
      expect(result.data.displayOrder).toBeUndefined();
    }
    expect(sectionInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(sectionInputSchema.safeParse({ name: "x".repeat(51) }).success).toBe(
      false
    );
  });
});