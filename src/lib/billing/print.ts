import { formatPaise } from "@/lib/menu/prices";
import { BILL_PAYMENT_METHOD_LABELS } from "./constants";
import { effectiveRateForDisplay } from "./tax";
import { discountValueLabel } from "@/lib/orders/discount";
import type { BillView } from "./types";

export interface BillRestaurantHeader {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  gstin: string | null;
  /**
   * The restaurant logo as a `data:` URI, or null when no logo is stored.
   *
   * The bytes are inlined rather than referenced as `/api/settings/logo`
   * because this document is `document.write`-n into a hidden iframe and
   * printed almost immediately: a separate request would race the print
   * dialog and can print a broken or empty image. Inlining also keeps the bill
   * self-contained — it does not depend on the settings page, the session
   * cookie, or a second round-trip.
   */
  logoDataUri?: string | null;
  /**
   * The restaurant's saved UPI ID, shown under the payment QR so the customer
   * can also type it in manually. Null when no UPI ID is configured.
   */
  upiId?: string | null;
  /**
   * The UPI payment request built from the saved UPI ID and this bill's final
   * payable amount, encoded as a PNG `data:` URI. Null when no UPI ID is
   * configured. Built on the server by `buildUpiPaymentQrDataUri()` so the slip
   * carries no client input and needs no second request before printing.
   */
  paymentQrDataUri?: string | null;
}

/**
 * Builds a `data:` URI from stored logo bytes. Only the three magic-byte
 * verified image types can reach here, so the mime type is interpolated from a
 * known-good value rather than a client-supplied header.
 */
export function toLogoDataUri(logo: {
  data: Uint8Array;
  mimeType: string;
} | null): string | null {
  if (!logo || !logo.mimeType || !logo.data || logo.data.length === 0) return null;
  return `data:${logo.mimeType};base64,${Buffer.from(logo.data).toString("base64")}`;
}

function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Builds a self-contained 80mm thermal bill (stored snapshot only — never the
 * live order). Fields that are absent or zero are omitted so the slip stays
 * clean: unregistered restaurants get a plain "Tax" line, registered ones get
 * CGST+SGST or IGST.
 */
export function buildBillHtml(
  bill: BillView,
  header: BillRestaurantHeader
): string {
  const lines: string[] = [];

  lines.push(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(bill.billNumber)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    color: #111;
    width: 72mm;
    margin: 0 auto;
    /* Breathing room around the slip without wasting the 80mm paper width. */
    padding: 4mm 2.5mm 6mm;
  }
  .c { text-align: center; }
  .l { text-align: left; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .muted { color: #555; }

  /* Header */
  .logo { margin-bottom: 2.5mm; }
  .logo img { max-width: 34mm; max-height: 16mm; object-fit: contain; }
  .name { font-size: 13.5px; letter-spacing: 0.2px; margin-bottom: 0.5mm; }
  .sub { font-size: 10.5px; line-height: 1.45; }
  .title {
    font-size: 11.5px;
    letter-spacing: 1.2px;
    margin: 3mm 0 2.5mm;
    padding-bottom: 1.5mm;
    border-bottom: 1px solid #111;
  }

  /* Bill identity block */
  .meta { line-height: 1.6; }
  .meta .k { color: #555; }

  /* Rules */
  .sep { border-top: 1px dashed #999; margin: 2.5mm 0; }
  .sep-top { border-top: 1px solid #111; margin: 2.5mm 0 1.5mm; }

  /* Items */
  .items { width: 100%; border-collapse: collapse; }
  .items td { vertical-align: top; padding: 1.1mm 0; line-height: 1.45; }
  .items .qty { white-space: nowrap; }
  .items .hsn { font-size: 10px; padding-top: 0; }

  /* Totals */
  .totals { width: 100%; border-collapse: collapse; }
  .totals td { padding: 1mm 0; line-height: 1.45; }
  .totals .rule td { border-top: 1px solid #111; padding-top: 1.5mm; }
  .totals .foot-rule td { border-bottom: 1px solid #111; padding-bottom: 1.5mm; }
  .big { font-size: 13.5px; font-weight: 700; letter-spacing: 0.3px; }

  /* Payments */
  .pay { line-height: 1.55; }
  .pay .ref { font-size: 10.5px; }

  /* Payment QR */
  .qr { margin: 3mm auto 0; text-align: center; }
  .qr img { width: 32mm; height: 32mm; display: block; margin: 0 auto 1.5mm; }
  .qr .caption { font-size: 10.5px; letter-spacing: 0.8px; font-weight: 700; }
  .qr .upi { font-size: 10px; margin-top: 1.5mm; }

  /* Footer */
  .thanks { margin-top: 3.5mm; font-size: 12px; font-weight: 700; }

  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>`);

  // Header
  // The logo block is only emitted when a logo actually exists, so a restaurant
  // without one prints exactly as before and reserves no blank space.
  if (header.logoDataUri) {
    lines.push(
      `<div class="logo c"><img src="${esc(header.logoDataUri)}" alt="" /></div>`
    );
  }
  if (header.name) lines.push(`<div class="name c b">${esc(header.name)}</div>`);
  const addressBits = [
    header.address,
    [header.city, header.state].filter(Boolean).join(", "),
    header.pincode,
  ].filter(Boolean);
  if (addressBits.length) {
    lines.push(`<div class="sub c muted">${esc(addressBits.join(", "))}</div>`);
  }
  if (header.phone) lines.push(`<div class="sub c muted">Tel: ${esc(header.phone)}</div>`);
  if (bill.gstRegistered && bill.gstin) {
    lines.push(`<div class="sub c muted">GSTIN: ${esc(bill.gstin)}</div>`);
  }
  lines.push(`<div class="title c b">TAX INVOICE / BILL</div>`);
  lines.push(`<div class="meta"><span class="k">Bill No:</span> <span class="b">${esc(bill.billNumber)}</span></div>`);
  lines.push(`<div class="meta"><span class="k">Date:</span> ${formatDate(bill.createdAt)}</div>`);
  lines.push(`<div class="meta">Order #${bill.orderNumber} ${bill.orderType}</div>`);
  if (bill.tableNameSnapshot) {
    lines.push(`<div class="meta"><span class="k">Table:</span> ${esc(bill.tableNameSnapshot)}</div>`);
  }
  if (bill.customerName) {
    lines.push(`<div class="meta"><span class="k">Customer:</span> ${esc(bill.customerName)}</div>`);
  }
  if (bill.customerPhone) {
    lines.push(`<div class="meta"><span class="k">Phone:</span> ${esc(bill.customerPhone)}</div>`);
  }

  lines.push(`<div class="sep"></div>`);

  // Items
  lines.push(`<table class="items"><tbody>`);
  for (const item of bill.items) {
    const name = item.variantNameSnapshot
      ? `${item.nameSnapshot} (${item.variantNameSnapshot})`
      : item.nameSnapshot;
    lines.push(`<tr>`);
    lines.push(`<td>${esc(name)}</td>`);
    lines.push(`<td class="qty r">${item.quantity} x ${formatPaise(item.unitPricePaise)}</td>`);
    lines.push(`<td class="qty r">${formatPaise(item.lineTotalPaise)}</td>`);
    lines.push(`</tr>`);
    // HSN/SAC prints only for lines that actually carry a code, so a bill of
    // un-coded items looks exactly as it did before this field existed.
    if (item.hsnSacCode) {
      lines.push(
        `<tr><td class="muted hsn" colspan="3">HSN/SAC: ${esc(item.hsnSacCode)}</td></tr>`
      );
    }
  }
  lines.push(`</tbody></table>`);

  lines.push(`<div class="sep"></div>`);

  // Totals
  lines.push(`<table class="totals"><tbody>`);
  lines.push(`<tr><td>Subtotal</td><td class="r">${formatPaise(bill.subtotalPaise)}</td></tr>`);
  if (bill.discountPaise > 0) {
    const label = bill.discountType
      ? `Discount (${discountValueLabel(bill.discountType, bill.discountValue)})`
      : "Discount";
    lines.push(`<tr><td>${esc(label)}</td><td class="r">${formatPaise(-bill.discountPaise)}</td></tr>`);
  }
  if (bill.gstRegistered) {
    lines.push(`<tr class="muted"><td>Taxable</td><td class="r">${formatPaise(bill.taxableAmountPaise)}</td></tr>`);
    // Component rates are snapshotted on the bill; legacy bills predate the
    // snapshot and fall back to the combined rate (halved for CGST/SGST). For
    // mixed-rate bills (per-line GST overrides) the display rate is derived
    // from the actual amounts so the label stays truthful.
    const taxable = bill.taxableAmountPaise;
    const cgstRate = effectiveRateForDisplay(
      bill.cgstAmountPaise,
      taxable,
      bill.cgstRatePercent > 0 ? bill.cgstRatePercent : Number(bill.taxRatePercent) / 2
    );
    const sgstRate = effectiveRateForDisplay(
      bill.sgstAmountPaise,
      taxable,
      bill.sgstRatePercent > 0 ? bill.sgstRatePercent : Number(bill.taxRatePercent) / 2
    );
    const igstRate = effectiveRateForDisplay(
      bill.igstAmountPaise,
      taxable,
      bill.igstRatePercent > 0 ? bill.igstRatePercent : Number(bill.taxRatePercent)
    );
    if (bill.cgstAmountPaise > 0 || bill.sgstAmountPaise > 0) {
      lines.push(
        `<tr><td>CGST @ ${cgstRate}%</td><td class="r">${formatPaise(bill.cgstAmountPaise)}</td></tr>`
      );
      lines.push(
        `<tr><td>SGST @ ${sgstRate}%</td><td class="r">${formatPaise(bill.sgstAmountPaise)}</td></tr>`
      );
    } else if (bill.igstAmountPaise > 0) {
      lines.push(
        `<tr><td>IGST @ ${igstRate}%</td><td class="r">${formatPaise(bill.igstAmountPaise)}</td></tr>`
      );
    }
  } else if (bill.totalTaxPaise > 0) {
    const totalRate = effectiveRateForDisplay(
      bill.totalTaxPaise,
      bill.taxableAmountPaise,
      Number(bill.taxRatePercent)
    );
    lines.push(
      `<tr><td>Tax @ ${totalRate}%</td><td class="r">${formatPaise(bill.totalTaxPaise)}</td></tr>`
    );
  }
  if (bill.serviceChargeAmountPaise > 0) {
    lines.push(
      `<tr><td>Service charge</td><td class="r">${formatPaise(bill.serviceChargeAmountPaise)}</td></tr>`
    );
  }
  if (bill.roundOffEnabled && bill.roundOffAmountPaise !== 0) {
    lines.push(
      `<tr><td>Round off</td><td class="r">${formatPaise(bill.roundOffAmountPaise)}</td></tr>`
    );
  }
  // The grand total is fenced by rules so it reads as the bill's anchor line
  // without needing a larger block of space.
  lines.push(
    `<tr class="rule foot-rule big"><td>GRAND TOTAL</td><td class="r">${formatPaise(bill.grandTotalPaise)}</td></tr>`
  );
  lines.push(`</tbody></table>`);

  if (bill.discountPaise > 0 && bill.discountReason) {
    lines.push(`<div class="meta muted">Reason: ${esc(bill.discountReason)}</div>`);
  }

  // No dashed rule here: the grand total row is already closed by its own solid
  // foot-rule, so a second divider directly beneath it just doubled the line on
  // the printed slip. The dividers above the items and totals tables stay.

  // Payments
  if (bill.payments.length > 0) lines.push(`<div class="pay">`);
  for (const payment of bill.payments) {
    lines.push(
      `<div>${BILL_PAYMENT_METHOD_LABELS[payment.method]} ${formatDate(payment.createdAt)}  ${formatPaise(payment.amountPaise)}</div>`
    );
    if (payment.referenceNumber) {
      lines.push(`<div class="ref muted">Ref: ${esc(payment.referenceNumber)}</div>`);
    }
  }
  if (bill.payments.length > 0) {
    lines.push(
      `<div>Paid: <span class="b">${formatPaise(bill.paidAmountPaise)}</span> / ${formatPaise(bill.grandTotalPaise)}</div>`
    );
    if (bill.dueAmountPaise > 0) {
      lines.push(`<div>Balance due: <span class="b">${formatPaise(bill.dueAmountPaise)}</span></div>`);
    }
    lines.push(`</div>`);
  }

  // "SCAN TO PAY" QR — emitted only when the restaurant has a UPI ID, so a bill
  // without one shows no image, no caption and reserves no space. The UPI ID is
  // printed underneath so the customer can also type it in manually.
  if (header.paymentQrDataUri) {
    lines.push(
      `<div class="qr"><img src="${esc(header.paymentQrDataUri)}" alt="Scan to Pay" /><div class="caption b">SCAN TO PAY</div>`
    );
    if (header.upiId) {
      lines.push(`<div class="upi">UPI ID: ${esc(header.upiId)}</div>`);
    }
    lines.push(`</div>`);
  }

  lines.push(`<div class="c thanks b">Thank you, visit again!</div>`);

  lines.push(`</body></html>`);
  return lines.join("\n");
}