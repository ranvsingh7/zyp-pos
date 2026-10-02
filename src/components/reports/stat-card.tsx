import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: string;
}

/** Compact KPI/stat tile used across the dashboard and reports. */
export function StatCard({ label, value, hint, icon: Icon, tone }: StatCardProps) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        {Icon && (
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted ${tone ?? "text-muted-foreground"}`}
          >
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 truncate font-heading text-base font-semibold">
            {value}
          </p>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}