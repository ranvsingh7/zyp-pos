import type { Role } from "@/lib/auth/roles";

/** Logo uploads are capped at 2 MB and validated by magic bytes, not MIME. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

export const LOGO_ACCEPT_ATTRIBUTE = LOGO_MIME_TYPES.join(",");

export const LOGO_MIME_LABELS: Record<LogoMimeType, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
};

export const LOGO_FILE_PICKER_LABEL = "PNG, JPEG or WebP up to 2 MB";

/** Prefix fields reused by bill, KOT and purchase numbering. */
export const PREFIX_MAX = 12;
export const PREFIX_DEFAULT = "BILL";
export const KOT_PREFIX_DEFAULT = "KOT";
export const PURCHASE_PREFIX_DEFAULT = "PUR";

/** Service charge is a percentage of the post-discount billable value. */
export const SERVICE_CHARGE_RATE_MAX = 100;

/**
 * The restaurant UPI ID used as the destination of the bill's payment QR.
 *
 * The QR encodes a `upi://pay?pa=<UPI ID>&…` URI rather than a web link, so the
 * customer's UPI app opens with the payee and amount already filled in.
 *
 * Structure is `<something>@<provider>`. The provider side is intentionally not
 * matched against a list of handles or PSPs, so new and existing providers all
 * keep working without a code change.
 */
export const UPI_ID_MAX = 256;
export const UPI_ID_PLACEHOLDER = "restaurantname@provider";
export const UPI_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

/**
 * Restaurant settings are owner/manager work, matching the existing menu-edit
 * and audit-view boundaries. CASHIER and WAITER are always denied server-side.
 */
export const SETTINGS_MANAGE_ROLES: readonly Role[] = ["OWNER", "MANAGER"];

/** How long a browser may reuse the logo bytes before re-fetching. */
export const LOGO_CACHE_CONTROL = "private, max-age=300";

/** Authenticated route that serves the current tenant's stored logo bytes. */
export const LOGO_ROUTE_PATH = "/api/settings/logo";
