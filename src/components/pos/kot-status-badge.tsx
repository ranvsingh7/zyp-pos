"use client";

import { Badge } from "@/components/ui/badge";
import type { KotView } from "@/lib/orders/types";

/**
 * Primary KOT status badge(s) shown in KOT history.
 *
 * Normal (active) KOTs keep the existing NEW + PRINTED/SENT badge pair exactly
 * as they are. A CANCELLED KOT shows a single clearly-visible red CANCELLED
 * badge and never NEW or PRINTED, so it can't be mistaken for an active KOT.
 * The status comes straight from the stored KotView (`kot.status`); no
 * duplicate status field exists.
 */
export function KotStatusBadge({ kot }: { kot: KotView }) {
  if (kot.status === "CANCELLED") {
    return (
      <Badge
        data-testid="kot-status-badge"
        data-status="CANCELLED"
        className="bg-red-600 text-white"
      >
        CANCELLED
      </Badge>
    );
  }
  const printState = kot.state === "SENT" ? "SENT" : "PRINTED";
  return (
    <span
      data-testid="kot-status-badge"
      data-status={printState}
      className="flex items-center gap-2"
    >
      <Badge variant="outline">New</Badge>
      <Badge variant="secondary">{kot.state === "SENT" ? "Sent" : "Printed"}</Badge>
    </span>
  );
}