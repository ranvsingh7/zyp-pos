import type {
  PlanBillingCycle,
  PlanTier,
  SubscriptionStatus,
  SubscriptionPaymentMethod,
  SubscriptionPaymentStatus,
} from "@/lib/admin/constants";

export const PLAN_BILLING_CYCLE_LABELS: Record<PlanBillingCycle, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  FREE: "Free",
};

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  FREE: "Free",
  PAID: "Paid",
};

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

export const SUBSCRIPTION_PAYMENT_STATUS_LABELS: Record<
  SubscriptionPaymentStatus,
  string
> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

export const PAYMENT_METHODS: SubscriptionPaymentMethod[] = [
  "UPI",
  "BANK_TRANSFER",
  "CASH",
  "CARD",
  "OTHER",
];

export const BILLING_CYCLES: PlanBillingCycle[] = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "FREE",
];