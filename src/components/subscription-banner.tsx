"use client";

import { useEffect, useState } from "react";
import { AlarmClock, TriangleAlert } from "lucide-react";
import { getSubscriptionBannerInfo, type SubscriptionBannerInfo } from "@/actions/subscription/banner";

export function SubscriptionBanner() {
  const [info, setInfo] = useState<SubscriptionBannerInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSubscriptionBannerInfo().then((result) => {
      if (!cancelled) setInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const blocked = info.status === "GRACE_PERIOD"
    ? {
        bg: "bg-orange-50 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200",
        border: "border-orange-200 dark:border-orange-800",
      }
    : {
        bg: "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
        border: "border-amber-200 dark:border-amber-800",
      };

  const message =
    info.status === "GRACE_PERIOD"
      ? "Your subscription is in its grace period. Renew now to keep access to ZYP POS."
      : `Your ${info.planName ? `${info.planName} ` : ""}subscription expires in ${info.daysLeft} day${info.daysLeft === 1 ? "" : "s"}. Renew to avoid interruptions.`;

  return (
    <div className={`flex items-center justify-center gap-2 border-b px-4 py-2 text-center text-sm font-medium ${blocked.bg} ${blocked.border}`}>
      {info.status === "GRACE_PERIOD" ? (
        <TriangleAlert className="size-4 shrink-0" />
      ) : (
        <AlarmClock className="size-4 shrink-0" />
      )}
      <span>{message}</span>
    </div>
  );
}