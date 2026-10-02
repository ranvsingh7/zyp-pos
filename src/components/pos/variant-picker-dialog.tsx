"use client";

import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { MenuItemView, MenuVariantView } from "@/lib/menu/types";
import { formatPaise } from "@/lib/menu/prices";

export function VariantPickerDialog({
  open,
  item,
  onSelect,
  onClose,
}: {
  open: boolean;
  item: MenuItemView | null;
  onSelect: (variant: MenuVariantView) => void;
  onClose: () => void;
}) {
  const variants = item?.variants.filter((v) => v.isActive) ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-8">
            {item ? item.name : "Choose a variant"}
          </DialogTitle>
          {item && (
            <DialogDescription>
              Select a size or variant to add to the order.
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody>
          {variants.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              This item has no active variants.
            </p>
          ) : (
            <div className="flex flex-col gap-2 py-1">
              {variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => onSelect(variant)}
                  className="flex w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="font-medium">{variant.displayName}</span>
                  <span className="text-muted-foreground">
                    {formatPaise(variant.pricePaise)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </DialogBody>
      </DialogPopup>
    </Dialog>
  );
}