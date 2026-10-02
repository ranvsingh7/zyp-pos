import { UtensilsCrossed } from "lucide-react";
import { cn } from "cn";

export function Brand({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <UtensilsCrossed className="size-4" />
      </span>
      {showText && (
        <span className="font-heading text-lg font-semibold tracking-tight">
          ZYP POS
        </span>
      )}
    </div>
  );
}