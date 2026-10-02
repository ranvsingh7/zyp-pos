import "server-only";

import type { Role } from "@/lib/auth/roles";
import { DISPLAY_TIMEZONE } from "@/lib/format/date";

/* Plan billing cycles */
export const PLAN_BILLING_CYCLES = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "FREE",
] as const;
export type PlanBillingCycle = (typeof PLAN_BILLING_CYCLES)[number];

export const PLAN_BILLING_CYCLE_LABELS: Record<PlanBillingCycle, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  FREE: "Free",
};

/** Default paid period length (days) per billing cycle. */
export const PLAN_BILLING_CYCLE_DAYS: Record<PlanBillingCycle, number> = {
  MONTHLY: 30,
  QUARTERLY: 90,
  HALF_YEARLY: 180,
  YEARLY: 365,
  // A free plan has no recurring charge; the cycle only marks the tier, and
  // the plan's own configured duration is what decides how long access lasts.
  FREE: 30,
};

/* Plan tier — the free tier is a plan, not a separate subscription system. */
export const PLAN_TIERS = ["FREE", "PAID"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Guard rails for the plan configuration form. */
export const MAX_PLAN_PRICE_PAISE = 100_000_00; // ₹1,00,000
export const MAX_PLAN_DURATION_DAYS = 3650; // 10 years
export const MAX_PLAN_GRACE_PERIOD_DAYS = 90;

/* Subscription lifecycle */
export const SUBSCRIPTION_STATUSES = [
  // Derived-only: the restaurant has no subscription document at all. It is
  // never persisted (a Subscription always has a plan), it exists so the UI and
  // the access gate can say "no subscription" instead of mislabelling it.
  "NONE",
  "TRIAL",
  "ACTIVE",
  "EXPIRING",
  "GRACE_PERIOD",
  "EXPIRED",
  "SUSPENDED",
  "CANCELLED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  NONE: "No subscription",
  TRIAL: "Trial",
  ACTIVE: "Active",
  EXPIRING: "Expiring",
  GRACE_PERIOD: "Grace period",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
};

/** Statuses that block restaurant application access. */
export const BLOCKED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "NONE",
  "EXPIRED",
  "SUSPENDED",
  "CANCELLED",
];

/** Statuses that still allow access but show a renewal warning banner. */
export const WARNING_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "EXPIRING",
  "GRACE_PERIOD",
];

/* Subscription change history */
export const SUBSCRIPTION_HISTORY_ACTIONS = [
  "CREATED",
  "RENEWED",
  "PLAN_CHANGED",
  "PRICE_CHANGED",
  "EXPIRY_EXTENDED",
  "SUSPENDED",
  "REACTIVATED",
  "CANCELLED",
] as const;

/* Subscription payments */
export const SUBSCRIPTION_PAYMENT_METHODS = [
  "UPI",
  "BANK_TRANSFER",
  "CASH",
  "CARD",
  "OTHER",
] as const;
export type SubscriptionPaymentMethod = (typeof SUBSCRIPTION_PAYMENT_METHODS)[number];

export const SUBSCRIPTION_PAYMENT_METHOD_LABELS: Record<
  SubscriptionPaymentMethod,
  string
> = {
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  CASH: "Cash",
  CARD: "Card",
  OTHER: "Other",
};

export const SUBSCRIPTION_PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUSES)[number];

export const SUBSCRIPTION_PAYMENT_STATUS_LABELS: Record<
  SubscriptionPaymentStatus,
  string
> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

/* Invoice numbering */
export const SUBSCRIPTION_INVOICE_PREFIX = "SUB";
export const SUBSCRIPTION_INVOICE_PAD = 6;

/* Platform defaults (overridable from /admin/settings). */
export const DEFAULT_TRIAL_DURATION_DAYS = 14;
export const DEFAULT_EXPIRY_WARNING_DAYS = 7;
export const DEFAULT_GRACE_PERIOD_DAYS = 7;
export const DEFAULT_ADMIN_TIMEZONE = DISPLAY_TIMEZONE;

/* Module defaults */
export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_ERROR_LIMIT = 4;
export const ADMIN_AUDIT_PAGE_SIZE = 25;

/** Roles allowed on the platform admin panel. */
export const ADMIN_PANEL_ROLES: Role[] = ["SUPER_ADMIN"];