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
import type { OrderView } from "@/lib/orders/types";

export function CancelOrderDialog({
  order,
  pending,
  onConfirm,
  onClose,
}: {
  order: OrderView;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-8">Cancel order #{order.orderNumber}?</DialogTitle>
          <DialogDescription>
            The order will be marked as cancelled and its table (if any) freed.
            It cannot be reopened afterwards.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-medium">
            Reason <span className="text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder="e.g. Customer cancelled"
            rows={2}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onClose}
          >
            Keep order
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? "Cancelling…" : "Cancel order"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}