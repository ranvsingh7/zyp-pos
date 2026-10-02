"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { KotView } from "@/lib/orders/types";

/**
 * Confirmation for CANCEL KOT. The KOT is voided non-destructively: its
 * original printed snapshot and history entry stay intact; only cancellation
 * metadata is recorded. The reason is optional.
 */
export function CancelKotDialog({
  kot,
  pending,
  onConfirm,
  onClose,
}: {
  kot: KotView;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-8">Cancel KOT {kot.kotNumber}?</DialogTitle>
          <DialogDescription>
            The KOT is voided and cannot be reprinted afterwards. Its saved
            snapshot stays in KOT history. {kot.items.length} kitchen item
            {kot.items.length === 1 ? "" : "s"} affected.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label
            htmlFor="kot-cancel-reason"
            className="mb-1.5 block text-sm font-medium"
          >
            Reason <span className="text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="kot-cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder="e.g. Printed by mistake"
            rows={2}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
            Keep KOT
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? "Cancelling…" : "Cancel KOT"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}