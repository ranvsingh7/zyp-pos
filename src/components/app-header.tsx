"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UtensilsCrossed, LayoutDashboard, ClipboardList, ListOrdered, Table2, Calculator, ReceiptText, BarChart3, Package, ChefHat, ScrollText, Settings } from "lucide-react";
import { cn } from "cn";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { serviceForRoute } from "@/lib/services/catalog";

interface AppHeaderProps {
  userName: string;
  restaurantName?: string | null;
  /** Tenant logo URL. The bytes are served by the authenticated settings route. */
  restaurantLogoUrl?: string | null;
  /**
   * Services the venue's plan grants. Navigation items whose service is missing
   * are hidden.
   *
   * This is presentation only. Every guarded page and action re-checks the
   * entitlement server-side, so hiding a link is a courtesy, never the control.
   */
  serviceKeys?: readonly string[];
}

export const SETTINGS_NAV_ITEM = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
} as const;

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pos", label: "POS", icon: Calculator },
  { href: "/orders", label: "Orders", icon: ListOrdered },
  { href: "/menu", label: "Menu", icon: ClipboardList },
  { href: "/tables", label: "Tables", icon: Table2 },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/billing", label: "Billing", icon: ReceiptText },
  { href: "/kot", label: "Kitchen", icon: ChefHat },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/audit", label: "Audit", icon: ScrollText },
  SETTINGS_NAV_ITEM,
];

export function AppHeader({
  userName,
  restaurantName,
  restaurantLogoUrl,
  serviceKeys,
}: AppHeaderProps) {
  const pathname = usePathname();
  // Undefined means "not resolved" (e.g. a screen outside a venue context) and
  // shows everything; an explicit list hides what it does not contain.
  const granted = serviceKeys ? new Set(serviceKeys) : null;
  const visibleItems = granted
    ? NAV_ITEMS.filter((item) => {
        const service = serviceForRoute(item.href);
        // Routes with no owning service (settings, audit) are not plan features.
        return service === null || granted.has(service);
      })
    : NAV_ITEMS;

  return (
    <>
      <SubscriptionBanner />
      <header className="flex items-center justify-between border-b px-6 py-4">
      <div className="flex shrink-0 items-center gap-3">
        {restaurantLogoUrl ? (
          <img
            src={restaurantLogoUrl}
            alt=""
            className="size-8 shrink-0 rounded-lg border bg-white object-contain p-0.5"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
        )}
        <span className="font-heading text-lg font-semibold tracking-tight">
          ZYP POS
        </span>
        {restaurantName && (
          <span className="hidden text-sm text-muted-foreground md:inline">
            · {restaurantName}
          </span>
        )}
      </div>

      <nav className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1">
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors md:px-3",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline">
          {userName}
        </span>
        <LogoutButton />
      </div>
      </header>
    </>
  );
}