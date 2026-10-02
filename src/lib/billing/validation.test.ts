import { describe, it, expect } from "vitest";
import {
  generateBillInputSchema,
  recordPaymentInputSchema,
  completePaymentInputSchema,
  cancelBillInputSchema,
  listBillsInputSchema,
} from "./validation";

const BILL_ID = "6aaa850250b8071247f0adca";
const OK = "6aaa850250b8071247f0adca";

describe("billing validation", () => {
  describe("generateBillInputSchema", () => {
    it("accepts a valid order id", () => {
      expect(generateBillInputSchema.safeParse({ orderId: OK }).success).toBe(true);
    });
    it("rejects a malformed object id", () => {
      expect(generateBillInputSchema.safeParse({ orderId: "nope" }).success).toBe(false);
      expect(generateBillInputSchema.safeParse({ orderId: "" }).success).toBe(false);
      expect(generateBillInputSchema.safeParse({}).success).toBe(false);
    });

    it("accepts discount fields and cleans empty strings", () => {
      const result = generateBillInputSchema.safeParse({
        orderId: OK,
        discountType: "PERCENTAGE",
        discountValue: "10",
        discountReason: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discountValue).toBe(10);
        expect(result.data.discountReason).toBeNull();
      }
    });

    it("accepts an explicit no-discount payload", () => {
      const result = generateBillInputSchema.safeParse({
        orderId: OK,
        discountType: null,
        discountValue: null,
        discountReason: null,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.discountType).toBeNull();
    });

    it("rejects a percentage above 100", () => {
      expect(
        generateBillInputSchema.safeParse({
          orderId: OK,
          discountType: "PERCENTAGE",
          discountValue: 101,
        }).success
      ).toBe(false);
    });

    it("rejects negative discount values and unknown types", () => {
      expect(
        generateBillInputSchema.safeParse({
          orderId: OK,
          discountType: "FIXED",
          discountValue: -5,
        }).success
      ).toBe(false);
      expect(
        generateBillInputSchema.safeParse({
          orderId: OK,
          discountType: "COUPON",
          discountValue: 10,
        }).success
      ).toBe(false);
    });

    it("rejects an over-long discount reason", () => {
      expect(
        generateBillInputSchema.safeParse({
          orderId: OK,
          discountType: "FIXED",
          discountValue: 50,
          discountReason: "x".repeat(301),
        }).success
      ).toBe(false);
    });
  });

  describe("recordPaymentInputSchema", () => {
    it("accepts a minimal payment", () => {
      const parsed = recordPaymentInputSchema.safeParse({
        billId: BILL_ID,
        method: "CASH",
        amountPaise: 50000,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.amountPaise).toBe(50000);
        // optional fields are absent (undefined) until provided
        expect(parsed.data.referenceNumber).toBeUndefined();
      }
    });

    it("rejects zero, negative, fractional or non-numeric amounts", () => {
      for (const amount of [0, -5, 10.5, "abc", null]) {
        const result = recordPaymentInputSchema.safeParse({
          billId: BILL_ID,
          method: "CASH",
          amountPaise: amount,
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects unknown methods and bad bill id", () => {
      expect(
        recordPaymentInputSchema.safeParse({ billId: BILL_ID, method: "CHEQUE", amountPaise: 1 })
          .success
      ).toBe(false);
      expect(
        recordPaymentInputSchema.safeParse({ billId: "bad", method: "CASH", amountPaise: 1 })
          .success
      ).toBe(false);
    });
  });

  describe("completePaymentInputSchema", () => {
    it("accepts a valid complete call without amount", () => {
      const result = completePaymentInputSchema.safeParse({
        billId: BILL_ID,
        method: "UPI",
      });
      expect(result.success).toBe(true);
    });
    it("rejects a missing method", () => {
      expect(completePaymentInputSchema.safeParse({ billId: BILL_ID }).success).toBe(false);
    });
  });

  describe("cancelBillInputSchema", () => {
    it("accepts a reason and defaults it to empty", () => {
      const result = cancelBillInputSchema.safeParse({ billId: BILL_ID });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.reason).toBeUndefined();
      expect(
        cancelBillInputSchema.safeParse({ billId: BILL_ID, reason: "Wrong amount" }).success
      ).toBe(true);
    });
    it("rejects an over-long reason", () => {
      expect(
        cancelBillInputSchema.safeParse({
          billId: BILL_ID,
          reason: "x".repeat(301),
        }).success
      ).toBe(false);
    });
  });

  describe("listBillsInputSchema", () => {
    it("accepts defaults and coerces offset/limit", () => {
      const result = listBillsInputSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset).toBe(0);
        expect(result.data.limit).toBe(20);
        expect(result.data.status).toBeUndefined();
      }
    });
    it("accepts filters", () => {
      const result = listBillsInputSchema.safeParse({
        status: "PAID",
        search: "BILL-000001",
        offset: "10",
        limit: "50",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.offset).toBe(10);
        expect(result.data.limit).toBe(50);
      }
    });
    it("rejects unknown statuses and out-of-range paging", () => {
      expect(listBillsInputSchema.safeParse({ status: "VOID" }).success).toBe(false);
      expect(listBillsInputSchema.safeParse({ offset: -1 }).success).toBe(false);
      expect(listBillsInputSchema.safeParse({ limit: 101 }).success).toBe(false);
    });
  });
});