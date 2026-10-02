"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Store,
  BadgeDollarSign,
  CreditCard,
  Package,
  AlarmClock,
  Ban,
  ScrollText,
  Settings,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "cn";
import { LogoutButton } from "@/components/dashboard/logout-button";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/restaurants", label: "Restaurants", icon: Store },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: BadgeDollarSign },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/plans", label: "Plans", icon: Package },
  { href: "/admin/expiring", label: "Expiring soon", icon: AlarmClock },
  { href: "/admin/expired", label: "Expired", icon: Ban },
  { href: "/admin/audit-logs", label: "Audit logs", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell({
  userName,
  children,
}: {
  userName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-background lg:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <UtensilsCrossed className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">ZYP POS</p>
            <p className="text-[11px] text-muted-foreground">Super Admin</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Store className="size-4" />
            Visit app
          </Link>
          <div className="mt-2 flex items-center justify-between gap-2 px-3">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {userName}
            </span>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:pl-56">
        <header className="flex h-14 items-center justify-between gap-3 border-b bg-background px-4 lg:hidden">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <UtensilsCrossed className="size-4" />
            ZYP POS Admin
          </span>
          <LogoutButton />
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}