"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "cn";
import {
  REPORT_TAB_LABELS,
  type ReportTab,
} from "@/lib/reports/constants";

interface ReportsTabsProps {
  active: ReportTab;
  visible: ReportTab[];
}

/**
 * Report/Sub-reports selector. Only the tabs the signed-in role may view are
 * rendered; the server independently rejects direct URL access too.
 */
export function ReportsTabs({ active, visible }: ReportsTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function href(tab: ReportTab): string {
    if (tab === active) return pathname;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    params.delete("page");
    const qs = params.toString();
    return `/reports?${qs}`;
  }

  return (
    <nav
      aria-label="Report types"
      className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1"
    >
      {visible.map((tab) => (
        <Link
          key={tab}
          href={href(tab)}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {REPORT_TAB_LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}