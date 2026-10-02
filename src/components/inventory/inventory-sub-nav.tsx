"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/inventory", label: "Items" },
  { href: "/inventory/purchases", label: "Purchases" },
  { href: "/inventory/movements", label: "Movements" },
];

export function InventorySubNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Inventory sections"
      className="flex w-fit items-center gap-1 rounded-lg border bg-muted/40 p-1"
    >
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-background text-foreground shadow-sm"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}