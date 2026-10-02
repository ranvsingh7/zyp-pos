import Link from "next/link";
import { ArrowRight, ReceiptText, ClipboardList, ListOrdered, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serviceForRoute, type ServiceKey } from "@/lib/services/catalog";

/**
 * Shortcut row from the dashboard to the module landing pages.
 *
 * Filtered by the same entitlement the navigation uses. The header hides links
 * the plan does not include, but these cards are page content and would
 * otherwise send a BASIC owner to a module they cannot open.
 */
export function QuickActions({ serviceKeys }: { serviceKeys?: readonly ServiceKey[] }) {
  const granted = serviceKeys ? new Set(serviceKeys) : null;
  const actions = [
    {
      href: "/pos",
      label: "New order",
      description: "Open the POS",
      icon: Plus,
    },
    {
      href: "/orders",
      label: "Orders",
      description: "Order history & management",
      icon: ListOrdered,
    },
    {
      href: "/billing",
      label: "Billing",
      description: "Bills and payments",
      icon: ReceiptText,
    },
    {
      href: "/reports",
      label: "Reports",
      description: "Sales, GST and more",
      icon: ClipboardList,
    },
  ]
    .filter((a) => {
      const service = serviceForRoute(a.href);
      return service === null || !granted || granted.has(service);
    })
    .map((a) => ({ ...a, key: `${a.href}-${a.label}` }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quick actions</CardTitle>
        <CardDescription className="text-xs">Jump straight to a workflow</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {actions.map(({ href, label, description, icon: Icon, key }) => (
          <Button
            key={key}
            variant="outline"
            className="h-auto justify-start gap-3 py-3"
            nativeButton={false}
            render={<Link href={href} />}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {description}
              </span>
            </span>
            <ArrowRight className="ml-auto size-4 text-muted-foreground" />
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}