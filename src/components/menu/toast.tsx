"use client";

import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "cn";

export type ToastKind = "success" | "error";

export interface ToastData {
  kind: ToastKind;
  message: string;
}

export function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastData | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;

  const Icon = toast.kind === "success" ? CheckCircle2 : AlertTriangle;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60]">
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg animate-in slide-in-from-bottom-2 fade-in",
          toast.kind === "success"
            ? "border-green-600/30 bg-green-50 text-green-900"
            : "border-red-600/30 bg-red-50 text-red-900"
        )}
        role="status"
      >
        <Icon className="size-4 shrink-0" />
        <span>{toast.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}