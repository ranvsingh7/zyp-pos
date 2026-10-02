"use client";

import { useEffect, useRef } from "react";

/**
 * Closes a dialog once a server action reports success.
 *
 * The decision of *whether* a submission just succeeded is made by comparing
 * the incoming action state against the previously seen one, held in a ref.
 * That comparison deliberately happens inside an effect rather than during
 * render: the previous version called `setPrev`/`setOpen` while rendering,
 * which updated `CreatePlanButton`'s state from inside `PlanDialog` and
 * produced React's "Cannot update a component while rendering a different
 * component" warning.
 *
 * A ref rather than state is what makes this possible — a ref can record "the
 * last state I acted on" without scheduling another render. `setOpen` is
 * called after the commit, so the parent is never mutated mid-render.
 *
 * Behaviour:
 *   - First render: `prev` is seeded with the current state, so the effect is a
 *     no-op and the dialog never closes on mount.
 *   - Failure: the state changes but `success` is falsy, so nothing happens and
 *     the dialog stays open with its errors.
 *   - Success: a *new* state carrying `success` closes the dialog.
 *   - Reopening afterwards: the stale successful state is already recorded in
 *     `prev`, and reopening does not produce a new state object, so the dialog
 *     stays open instead of closing on the spot.
 *   - Repeated/rapid submissions: each genuinely new state is handled once; the
 *     same object re-observed is skipped.
 */
export function useCloseOnSuccess<T extends { success?: boolean }>(
  state: T,
  setOpen: (open: boolean) => void
): void {
  // Seeded with the first state so the mount pass is never a "change".
  const prevStateRef = useRef<T>(state);

  useEffect(() => {
    const prev = prevStateRef.current;
    // Not a new submission result — nothing to react to. This also keeps the
    // effect idempotent when it re-runs because `setOpen` is a new closure.
    if (state === prev) return;

    prevStateRef.current = state;
    if (state.success) setOpen(false);
  }, [state, setOpen]);
}
