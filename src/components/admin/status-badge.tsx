import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import {
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
} from "@/lib/admin/view-labels";
import type {
  SubscriptionStatus,
  SubscriptionPaymentStatus,
} from "@/lib/admin/constants";

const STATUS_STYLES: Record<SubscriptionStatus, string> = {
  NONE: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  TRIAL: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  EXPIRING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  GRACE_PERIOD: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  EXPIRED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  SUSPENDED: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function SubscriptionStatusBadge({ status }: { status: SubscriptionStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_STYLES[status])}>
      {SUBSCRIPTION_STATUS_LABELS[status]}
    </Badge>
  );
}

const PAYMENT_STYLES: Record<SubscriptionPaymentStatus, string> = {
  PENDING: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  REFUNDED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function PaymentStatusBadge({
  status,
}: {
  status: SubscriptionPaymentStatus;
}) {
  return (
    <Badge variant="outline" className={cn("border-transparent", PAYMENT_STYLES[status])}>
      {SUBSCRIPTION_PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}