import { cn } from "cn";

const VEG_STYLES: Record<string, string> = {
  VEG: "border-green-600 text-green-700",
  NON_VEG: "border-red-600 text-red-700",
  EGG: "border-amber-500 text-amber-600",
  NA: "border-muted-foreground text-muted-foreground",
};

const VEG_LABELS: Record<string, string> = {
  VEG: "Veg",
  NON_VEG: "Non-veg",
  EGG: "Contains egg",
  NA: "Not specified",
};

export function VegMark({ vegType, withLabel = false }: { vegType: string; withLabel?: boolean }) {
  const style =
    VEG_STYLES[vegType] ?? "border-muted-foreground text-muted-foreground";

  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={VEG_LABELS[vegType] ?? vegType}
      aria-label={VEG_LABELS[vegType] ?? vegType}
    >
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-2 bg-card",
          style
        )}
      >
        <span className="size-1.5 rounded-full bg-current" />
      </span>
      {withLabel && (
        <span className="text-xs font-medium text-muted-foreground">
          {VEG_LABELS[vegType] ?? vegType}
        </span>
      )}
    </span>
  );
}