"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSettingsAction, type SettingsActionState } from "@/actions/admin/settings";

export function SettingsForm({
  snapshot,
}: {
  snapshot: { trialDurationDays: number; expiryWarningDays: number; gracePeriodDays: number; timezone: string };
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    (prev, form) => updateSettingsAction(form),
    {}
  );

  // These fields used to seed `defaultValue` straight from the snapshot, but
  // saving calls revalidatePath("/admin/settings"), which re-renders this
  // component with a fresh snapshot and changes `defaultValue` on inputs that
  // were already mounted. Base UI reads that as an uncontrolled field mutating
  // its default-value state after initialization and warns. Reading the
  // snapshot once into state keeps every field controlled, so the form also
  // keeps what the admin typed instead of silently re-seeding itself mid-edit.
  //
  // The `??` fallbacks keep each field a defined value from its very first
  // render, so no input can go undefined -> value. Values stay strings, which
  // is what the DOM stores anyway; updateSettingsSchema coerces them.
  const [trialDurationDays, setTrialDurationDays] = useState(
    String(snapshot.trialDurationDays ?? 0)
  );
  const [expiryWarningDays, setExpiryWarningDays] = useState(
    String(snapshot.expiryWarningDays ?? 0)
  );
  const [gracePeriodDays, setGracePeriodDays] = useState(
    String(snapshot.gracePeriodDays ?? 0)
  );
  const [timezone, setTimezone] = useState(snapshot.timezone ?? "");

  return (
    <form action={formAction} className="grid max-w-xl gap-6">
      {state.message && (
        <div className={`rounded-lg px-3 py-2 text-sm ${state.success ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-destructive/10 text-destructive"}`}>
          {state.message}
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="trialDurationDays">Trial duration (days)</Label>
        <Input
          id="trialDurationDays"
          name="trialDurationDays"
          type="number"
          min={0}
          max={365}
          value={trialDurationDays}
          onChange={(e) => setTrialDurationDays(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="expiryWarningDays">Expiry warning window (days)</Label>
        <Input
          id="expiryWarningDays"
          name="expiryWarningDays"
          type="number"
          min={0}
          max={90}
          value={expiryWarningDays}
          onChange={(e) => setExpiryWarningDays(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="gracePeriodDays">Grace period (days)</Label>
        <Input
          id="gracePeriodDays"
          name="gracePeriodDays"
          type="number"
          min={0}
          max={90}
          value={gracePeriodDays}
          onChange={(e) => setGracePeriodDays(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="timezone">Admin timezone</Label>
        <Input
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Asia/Kolkata"
        />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save settings
        </Button>
      </div>
    </form>
  );
}