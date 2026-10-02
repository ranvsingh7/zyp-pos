"use client";

/**
 * Plan editor control for choosing which services a plan includes.
 *
 * Reads the catalog directly (the module is deliberately not `server-only`) so
 * the options can never drift from what the access gate actually enforces.
 *
 * Unimplemented services are shown as unavailable rather than hidden: a Super
 * Admin should be able to see that the catalog knows about them, and that
 * shipping one is as small as flipping `enabled` in the catalog.
 */
import * as React from "react";
import { Label } from "@/components/ui/label";
import {
  listServices,
  missingDependencies,
  normalizeServiceKeys,
  serviceName,
  type ServiceKey,
} from "@/lib/services/catalog";

export function ServiceKeyPicker({
  selected,
  onChange,
  error,
}: {
  selected?: readonly string[] | null;
  onChange: (next: ServiceKey[]) => void;
  error?: string;
}) {
  // A plan saved before services existed has no list; treat it as "nothing
  // selected" rather than crashing the editor. Memoised so the `useMemo` deps
  // below are stable rather than a fresh array on every render.
  const selection = React.useMemo(
    () => (Array.isArray(selected) ? selected : []),
    [selected]
  );
  const services = listServices();
  const effective = React.useMemo(() => new Set(normalizeServiceKeys(selection)), [selection]);
  const implied = React.useMemo(() => missingDependencies(selection), [selection]);

  const toggle = (key: ServiceKey) => {
    const next = selection.includes(key)
      ? selection.filter((k) => k !== key)
      : [...selection, key];
    onChange(normalizeServiceKeys(next));
  };

  return (
    <div className="grid gap-2">
      <Label>Services included</Label>
      <p className="text-sm text-muted-foreground">
        A venue can only use the services selected here. Changing a plan does not change
        subscriptions that were already issued.
      </p>
      <div
        role="group"
        aria-label="Services included"
        className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
      >
        {services.map((service) => {
          // A dependency pulled in by another selection is on, and locked, so
          // it cannot be deselected into a broken configuration.
          const isImplied =
            !selection.includes(service.key) && effective.has(service.key);
          const disabled = !service.enabled || isImplied;
          return (
            <label
              key={service.key}
              className={
                disabled && !service.enabled
                  ? "flex items-start gap-2 opacity-60"
                  : "flex items-start gap-2"
              }
            >
              <input
                type="checkbox"
                name="serviceKeys"
                value={service.key}
                checked={effective.has(service.key)}
                disabled={disabled}
                onChange={() => toggle(service.key)}
                className="mt-1"
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">
                  {service.name}
                  {isImplied ? " (required)" : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {service.enabled
                    ? service.description
                    : "Not available yet — no implementation to grant."}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {implied.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {implied
            .map(
              (i) =>
                `${serviceName(i.key)} also requires ${i.requires
                  .map(serviceName)
                  .join(", ")}.`
            )
            .join(" ")}
        </p>
      )}
      {!effective.has("DASHBOARD") && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
        >
          Dashboard must be included. A venue cannot reach its own landing page without
          it, and nothing else on this list implies it, so the form will not save until
          it is ticked.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
