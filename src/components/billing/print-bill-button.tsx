"use client";

import { useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printBillAction } from "@/actions/billing/actions";
import type { BillView } from "@/lib/billing/types";

interface PrintBillButtonProps {
  billId: string;
  onPrinted?: (bill: BillView) => void;
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  disabled?: boolean;
  className?: string;
}

/**
 * Fetches the stored bill snapshot and opens it in a hidden iframe for the
 * browser's print dialog (80mm thermal styles are embedded in the HTML).
 */
/**
 * Resolves once every image in the written document has finished decoding (or
 * failed), so the print dialog never captures a half-loaded logo or payment QR.
 * Both are inlined as `data:` URIs, so this covers all of them without changing
 * the print mechanism. Falls back to a timer so a stalled image can never block
 * printing.
 */
function whenImagesReady(doc: Document, timeoutMs = 2000): Promise<void> {
  const images = Array.from(doc.images);
  const pending = images.filter((image) => !image.complete);
  if (pending.length === 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const image of pending) {
        image.onload = null;
        image.onerror = null;
      }
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    for (const image of pending) {
      image.onload = finish;
      image.onerror = finish;
    }
  });
}

export function PrintBillButton({
  billId,
  onPrinted,
  label = "Print bill",
  size,
  variant = "outline",
  disabled,
  className,
}: PrintBillButtonProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePrint() {
    setBusy(true);
    setError(null);
    try {
      const result = await printBillAction({ billId });
      if (!result.success) {
        setError(result.message ?? "Could not print the bill.");
        return;
      }
      if (result.html) {
        const frame = iframeRef.current;
        if (frame?.contentDocument) {
          const doc = frame.contentDocument;
          doc.open();
          doc.write(result.html);
          doc.close();
          // Wait for the inlined logo and payment QR to decode rather than
          // guessing with a fixed delay, otherwise the slip can print with a
          // blank logo box or an unreadable QR.
          await whenImagesReady(doc);
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        }
      }
      if (result.bill) onPrinted?.(result.bill);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not print the bill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || busy}
        onClick={handlePrint}
        className={className}
      >
        <Printer className="size-4" />
        {label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
      <iframe
        ref={iframeRef}
        title="bill-print-frame"
        className="hidden"
        aria-hidden
      />
    </div>
  );
}