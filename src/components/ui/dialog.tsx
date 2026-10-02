"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

function Dialog({
  open,
  onOpenChange,
  children,
  ...props
}: DialogPrimitive.Root.Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...props}>
      {children}
    </DialogPrimitive.Root>
  );
}

function DialogPopup({
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop data-slot="dialog-backdrop" className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-closed:animate-out data-closed:fade-out data-open:animate-in data-open:fade-in" />
      <DialogPrimitive.Popup
        data-slot="dialog-popup"
        className={cn(
          // `dvh` tracks the *visible* viewport, so on mobile (where the
          // dynamic toolbar makes `100vh` taller than what the user can see)
          // the footer stays on screen instead of being clipped below the
          // browser chrome. The `vh` declaration is the fallback for browsers
          // without `dvh` support; the later class wins where both apply.
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-card shadow-xl ring-1 ring-foreground/10 outline-none sm:w-full data-closed:animate-out data-closed:fade-out data-closed:zoom-out-95 data-open:animate-in data-open:fade-in data-open:zoom-in-95",
          // The form is the direct flex child, so it has to take part in the
          // flex chain for `DialogBody`'s `min-h-0 flex-1 overflow-y-auto` to
          // work. Without this the form keeps its default `min-height: auto`,
          // grows to its content height, the body never becomes a scroll
          // container, and the popup clips the footer out of reach.
          "[&>form]:flex [&>form]:min-h-0 [&>form]:flex-1 [&>form]:flex-col",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 z-10 size-7 text-muted-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          }
        />
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 items-start gap-4 px-6 pt-5 pb-3", className)}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      // `overscroll-contain` stops the body handing leftover scroll on to the
      // page behind the dialog once it reaches the end.
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2",
        className
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("font-heading text-lg font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border/50 px-6 py-4",
        className
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};