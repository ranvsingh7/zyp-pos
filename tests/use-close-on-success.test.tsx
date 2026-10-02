// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCloseOnSuccess } from "@/components/admin/admin-hooks";

/**
 * Regression coverage for the render-phase state update in
 * `useCloseOnSuccess`.
 *
 * The bug: the hook tracked the previously seen action state with `useState`
 * and called `setPrev`/`setOpen` while rendering. Because `PlanDialog` calls
 * the hook and its parent (`CreatePlanButton`) owns the `open` state, that
 * updated one component during another's render and React logged
 * "Cannot update a component while rendering a different component".
 *
 * The harness below reproduces the real component shape: the parent owns
 * `open`, the child calls the hook — the same arrangement that produced the
 * warning — so a regression reintroduces the same console error here.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ActionState = { success?: boolean; message?: string; _errors?: Record<string, string[]> };

/** Handle the harness writes to, so a test can drive it imperatively. */
interface HarnessHandle {
  isOpen: () => boolean;
  submit: (state: ActionState) => void;
  reopen: () => void;
  setOpen: (open: boolean) => void;
}

/**
 * Stands in for PlanDialog: calls the hook, owns no state itself.
 *
 * `tag` makes each test's components a distinct pair of function names. React
 * logs a given render-phase warning only once per component-name pair, so
 * without this every scenario after the first would silently pass even with the
 * bug reintroduced.
 */
function makeChild(tag: string) {
  function Child({
    state,
    setOpen,
  }: {
    state: ActionState;
    setOpen: (open: boolean) => void;
  }) {
    useCloseOnSuccess(state, setOpen);
    return null;
  }
  Object.defineProperty(Child, "name", { value: `PlanDialog_${tag}` });
  return Child;
}

/** Stands in for CreatePlanButton: owns the `open` state. */
function makeParent(tag: string) {
  const Child = makeChild(tag);
  function Parent({
    handle,
    initialState,
    strict,
  }: {
    handle: HarnessHandle;
    initialState: ActionState;
    strict?: boolean;
  }) {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<ActionState>(initialState);

    handle.isOpen = () => open;
    handle.submit = (next) => setState(next);
    handle.reopen = () => setOpen(true);
    handle.setOpen = setOpen;

    const tree = (
      <div>
        <span data-testid="open">{String(open)}</span>
        <Child state={state} setOpen={setOpen} />
      </div>
    );
    return strict ? <React.StrictMode>{tree}</React.StrictMode> : tree;
  }
  Object.defineProperty(Parent, "name", { value: `CreatePlanButton_${tag}` });
  return Parent;
}

let host: HTMLDivElement;
let root: Root;
let handle: HarnessHandle;
let consoleErrors: string[];
let tagCounter = 0;

function mount(initialState: ActionState, strict = false): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  handle = {} as HarnessHandle;
  const Parent = makeParent(`t${++tagCounter}`);
  act(() => {
    root.render(<Parent handle={handle} initialState={initialState} strict={strict} />);
  });
}

function unmount(): void {
  act(() => root.unmount());
  host.remove();
}

/** Any React "update during render" complaint surfaces on console.error. */
function renderPhaseWarnings(): string[] {
  return consoleErrors.filter((m) =>
    /Cannot update a component|while rendering a different component|Too many re-renders/i.test(m)
  );
}

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useCloseOnSuccess", () => {
  it("does not close on initial render", () => {
    mount({});
    expect(handle.isOpen()).toBe(false);

    // Even a state that already reports success must not close the dialog on
    // mount: the mount pass is not a new submission.
    unmount();
    mount({ success: true });
    expect(handle.isOpen()).toBe(false);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("keeps the dialog open and shows the error when a submit fails", () => {
    mount({});
    act(() => handle.setOpen(true));
    expect(handle.isOpen()).toBe(true);

    act(() =>
      handle.submit({ success: false, _errors: { name: ["Required"] } })
    );

    expect(handle.isOpen()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("closes the dialog when a submit succeeds", () => {
    mount({});
    act(() => handle.setOpen(true));
    expect(handle.isOpen()).toBe(true);

    act(() => handle.submit({ success: true }));

    expect(handle.isOpen()).toBe(false);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("closes again on a second success after being reopened", () => {
    mount({});

    act(() => handle.setOpen(true));
    act(() => handle.submit({ success: true }));
    expect(handle.isOpen()).toBe(false);

    act(() => handle.reopen());
    expect(handle.isOpen()).toBe(true);

    act(() => handle.submit({ success: true }));
    expect(handle.isOpen()).toBe(false);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("does not immediately close when reopened with a stale successful state", () => {
    mount({});

    act(() => handle.setOpen(true));
    act(() => handle.submit({ success: true }));
    expect(handle.isOpen()).toBe(false);

    // Reopening must not trip over the still-present successful state: the
    // hook already recorded it, and reopening produces no new state object.
    act(() => handle.reopen());
    expect(handle.isOpen()).toBe(true);

    // And it must survive unrelated re-renders that do not change the state.
    act(() => handle.submit({ success: true }));
    expect(handle.isOpen()).toBe(false);
    act(() => handle.reopen());
    expect(handle.isOpen()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("ignores a repeated identical state and only closes once per submission", () => {
    mount({});
    act(() => handle.setOpen(true));

    const success: ActionState = { success: true };
    act(() => handle.submit(success));
    expect(handle.isOpen()).toBe(false);

    // Re-submitting the very same object must not be treated as a new
    // submission, so nothing further happens.
    act(() => handle.setOpen(true));
    act(() => handle.submit(success));
    expect(handle.isOpen()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("handles rapid success/failure sequences without stray updates", () => {
    mount({});
    act(() => handle.setOpen(true));

    act(() => handle.submit({ success: false }));
    expect(handle.isOpen()).toBe(true);

    act(() => handle.submit({ success: false, message: "Invalid" }));
    expect(handle.isOpen()).toBe(true);

    act(() => handle.submit({ success: true }));
    expect(handle.isOpen()).toBe(false);

    // A late failure after success must not reopen or re-close anything.
    act(() => handle.setOpen(true));
    act(() => handle.submit({ success: false }));
    expect(handle.isOpen()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("behaves correctly under StrictMode double-invoked effects", () => {
    mount({}, true);
    act(() => handle.setOpen(true));
    expect(handle.isOpen()).toBe(true);

    act(() => handle.submit({ success: true }));
    expect(handle.isOpen()).toBe(false);

    act(() => handle.reopen());
    expect(handle.isOpen()).toBe(true);
    expect(renderPhaseWarnings()).toEqual([]);
  });

  it("works with an inline callback, whose identity changes every render", () => {
    // staff-manager passes `() => setConfirming(false)`, a new closure on every
    // render, so the effect re-runs constantly and must stay a no-op.
    let open = true;
    const closers: Array<() => void> = [];

    function InlineChild({ state }: { state: ActionState }) {
      useCloseOnSuccess(state, () => {
        open = false;
        closers.push(() => undefined);
      });
      return null;
    }

    function InlineParent() {
      const [state, setState] = useState<ActionState>({});
      return (
        <div>
          <InlineChild state={state} />
          <button type="button" onClick={() => setState({ success: true })}>
            submit
          </button>
        </div>
      );
    }

    const localHost = document.createElement("div");
    document.body.appendChild(localHost);
    const localRoot = createRoot(localHost);
    act(() => {
      localRoot.render(<InlineParent />);
    });
    // The mount pass ran the effect with a fresh closure and must not close.
    expect(open).toBe(true);

    const button = localHost.querySelector("button")!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(open).toBe(false);
    expect(renderPhaseWarnings()).toEqual([]);

    act(() => localRoot.unmount());
    localHost.remove();
  });
});
