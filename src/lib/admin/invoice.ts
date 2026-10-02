import "server-only";

import { PlatformCounterModel } from "@/models/PlatformCounter";
import {
  SUBSCRIPTION_INVOICE_PAD,
  SUBSCRIPTION_INVOICE_PREFIX,
} from "./constants";

const INVOICE_COUNTER_KEY = "subscription_invoice_seq";

/**
 * Atomic next invoice number: SUB-000001, SUB-000002, …
 *
 * The counter document uses a single findOneAndUpdate with $inc and upsert.
 * Mongo guarantees the increment is atomic, so two concurrent admin sessions can
 * never mint the same number. The sequence is global (platform-wide), exactly as
 * a physical SaaS would issue a single company-wide invoice series — invoices
 * from different restaurants intentionally never share an invoice number.
 */
export async function nextSubscriptionInvoiceNumber(): Promise<string> {
  const counter = await PlatformCounterModel.findOneAndUpdate(
    { key: INVOICE_COUNTER_KEY },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  ).exec();
  const value: number =
    counter?.value ??
    (await PlatformCounterModel.findOneAndUpdate(
      { key: INVOICE_COUNTER_KEY },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    ).then((c) => (c ? c.value : 0)));
  return `${SUBSCRIPTION_INVOICE_PREFIX}-${String(value).padStart(
    SUBSCRIPTION_INVOICE_PAD,
    "0"
  )}`;
}

/** Renders an existing invoice body from a stored payment row. */
export function formatInvoiceNumber(sequence: number): string {
  return `${SUBSCRIPTION_INVOICE_PREFIX}-${String(sequence).padStart(
    SUBSCRIPTION_INVOICE_PAD,
    "0"
  )}`;
}