import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getService, type ServiceKey } from "@/lib/services/catalog";

/**
 * The screen a venue sees when its plan does not include the service it tried
 * to open.
 *
 * It is rendered in place of the page, not as a redirect: the user is
 * authenticated and their subscription is fine, they simply bought a smaller
 * plan. Bouncing them to a login or an "access blocked" screen would be both
 * wrong and confusing, so this distinguishes "not on your plan" from "your
 * subscription expired".
 */
export function FeatureLocked({
  service,
  planName,
  supportHref = "/settings/subscription",
}: {
  service: ServiceKey;
  /** The venue's current plan, shown so the message is actionable. */
  planName: string;
  supportHref?: string;
}) {
  const definition = getService(service);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Lock className="size-6" />
          </span>
          <CardTitle>{definition.name} is not included in your current plan</CardTitle>
          <CardDescription>{definition.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="rounded-lg bg-muted p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Current plan</span>
              <span className="font-medium">{planName || "No plan"}</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Ask your ZYP POS administrator to upgrade your plan to use {definition.name}.
          </p>
          <Button variant="secondary" render={<Link href={supportHref} />}>
            View plan details
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
