"use client";

/**
 * Opens a popup synchronously in the click gesture (so popup blockers don't
 * swallow the print window after the async server round-trip) and prints
 * pre-rendered thermal HTML written into it.
 */
export function openPrintWindow(): Window | null {
  return window.open("", "_blank", "width=400,height=640");
}

export function writePrintWindow(win: Window, html: string): void {
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  window.setTimeout(() => {
    if (win.closed) return;
    win.focus();
    win.print();
    win.onafterprint = () => win.close();
  }, 150);
}