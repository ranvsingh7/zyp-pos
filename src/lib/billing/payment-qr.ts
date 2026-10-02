import "server-only";

import QRCode from "qrcode";

import { isValidUpiId } from "@/lib/settings/validation";

/**
 * Rendered size in device pixels for the bill's payment QR. The slip is printed
 * on 80mm paper with a 32mm-wide code, so ~300px is comfortably above what a
 * 203dpi thermal head resolves while keeping the inlined PNG small.
 */
const QR_PIXELS = 300;

/** Quiet zone in modules. The spec requires 4; 2 still scans reliably. */
const QR_MARGIN = 2;

/**
 * Error-correction level. `M` recovers ~15% damage, which covers smudges and
 * thermal head wear without inflating the symbol for an 80mm slip.
 */
const QR_ERROR_CORRECTION = "M" as const;

/** Currency every UPI payment request is denominated in here. */
const UPI_CURRENCY = "INR";

/** The UPI deep-link scheme payment apps register for. */
const UPI_SCHEME = "upi://pay";

/**
 * Converts paise to the exact rupee string UPI's `am` parameter expects
 * (two decimals, e.g. `28350` -> `283.50`).
 *
 * This only formats the amount for display; it never changes the bill total.
 */
function paiseToRupees(amountPaise: number): string | null {
  if (!Number.isFinite(amountPaise) || amountPaise < 0) return null;
  return (Math.round(amountPaise) / 100).toFixed(2);
}

/**
 * Builds the UPI payment request URI for a bill:
 *
 *   upi://pay?pa=<UPI ID>&pn=<Restaurant Name>&am=<Amount>&cu=INR
 *
 * `pa` (payee address) and `pn` (payee name) are percent-encoded, which is
 * required because a restaurant name routinely contains spaces and `&`. The
 * amount is the final payable total — after discount, GST and every other
 * existing billing step — so the customer's app opens pre-filled with exactly
 * what the bill asks for.
 *
 * Returns null when there is no usable UPI ID, so a restaurant without one
 * simply has no payment URI rather than a broken one.
 */
export function buildUpiPaymentUri(
  upiId: string | null | undefined,
  restaurantName: string | null | undefined,
  amountPaise: number
): string | null {
  if (!isValidUpiId(upiId)) return null;
  const amount = paiseToRupees(amountPaise);
  if (amount === null) return null;

  const params = new URLSearchParams({
    pa: upiId,
    cu: UPI_CURRENCY,
    am: amount,
  });
  // `pn` is the payee name a payment app displays; keep it, but never let an
  // empty name produce a bare parameter.
  const name = (restaurantName ?? "").trim();
  if (name) params.set("pn", name);

  // URLSearchParams encodes spaces as `+`, which is valid in a query string but
  // less compatible with UPI apps than `%20`, so the ampersands are joined
  // manually with already-encoded components.
  const query = params
    .toString()
    .replace(/\+/g, "%20")
    .replace(/%2F/g, "/")
    .replace(/%3A/g, ":");
  return `${UPI_SCHEME}?${query}`;
}

/**
 * Encodes a UPI payment URI into a PNG `data:` URI for the bill.
 *
 * Returns null — never a placeholder or a broken image — when no UPI ID is
 * configured or the request cannot be built, so a bill with no UPI ID reserves
 * no space and shows no QR.
 *
 * The QR is produced here on the server and inlined for the same reason the logo
 * is: the slip is `document.write`-n into a hidden iframe and printed
 * immediately, so a separate request would race the print dialog. It also
 * guarantees the QR encodes exactly the persisted UPI ID and the final payable
 * amount, with no client input involved.
 */
export async function buildUpiPaymentQrDataUri(
  upiId: string | null | undefined,
  restaurantName: string | null | undefined,
  amountPaise: number
): Promise<string | null> {
  const uri = buildUpiPaymentUri(upiId, restaurantName, amountPaise);
  if (!uri) return null;
  try {
    return await QRCode.toDataURL(uri, {
      type: "image/png",
      width: QR_PIXELS,
      margin: QR_MARGIN,
      errorCorrectionLevel: QR_ERROR_CORRECTION,
    });
  } catch {
    // A URI that cannot be encoded must never break printing the bill.
    return null;
  }
}
