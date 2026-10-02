"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Users, CreditCard } from "lucide-react";
import { cn } from "cn";

const ITEMS = [
  { href: "/settings", label: "General", icon: Building2 },
  { href: "/settings/staff", label: "Staff", icon: Users },
  { href: "/settings/subscription", label: "Subscription", icon: CreditCard },
] as const;

/** Secondary navigation shared by the settings sections. */
export function SettingsSubnav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex w-fit items-center gap-1 rounded-lg bg-muted/60 p-1">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
