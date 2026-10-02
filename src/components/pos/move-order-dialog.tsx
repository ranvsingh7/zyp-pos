"use client";

import { useState } from "react";
import { MoveRight } from "lucide-react";
import { cn } from "cn";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { TableView } from "@/lib/tables/types";

/**
 * Restores the move-to-another-table workflow for a DINE_IN order. Lists each
 * active table; only AVAILABLE tables (or the one hosting another active
 * order, which the server swaps) are valid destinations. Non-destructive.
 */
export function MoveOrderDialog({
  currentTableId,
  tables,
  busy,
  onConfirm,
  onClose,
}: {
  currentTableId: string | null;
  tables: TableView[];
  busy: boolean;
  onConfirm: (destinationTable: TableView) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const destination = tables.find((t) => t.id === selectedId) ?? null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-8">Move to another table</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="mb-3 text-sm text-muted-foreground">
            The order moves to the chosen table. Printed KOTs are kept as-is.
          </p>
          <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
            {tables
              .filter((t) => t.isActive)
              .map((table) => {
                const isCurrent = table.id === currentTableId;
                const isReserved =
                  !isCurrent && (table.status === "RESERVED" || table.status === "OCCUPIED");
                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={isCurrent || isReserved}
                    onClick={() => setSelectedId(table.id)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-left transition-colors",
                      isCurrent
                        ? "cursor-not-allowed border-input opacity-50"
                        : isReserved
                          ? "cursor-not-allowed border-input opacity-50"
                          : selectedId === table.id
                            ? "border-primary ring-2 ring-primary"
                            : "border-input hover:border-primary/40 hover:bg-muted"
                    )}
                  >
                    <span className="block truncate text-sm font-semibold">
                      {table.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {isCurrent ? "Current" : table.status === "AVAILABLE" ? "Available" : "In use"}
                    </span>
                  </button>
                );
              })}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!destination || busy}
            onClick={() => destination && onConfirm(destination)}
          >
            <MoveRight className="size-4" />
            Move order
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}