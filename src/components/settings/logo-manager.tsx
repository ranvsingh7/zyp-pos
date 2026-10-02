"use client";

import * as React from "react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LOGO_ACCEPT_ATTRIBUTE,
  LOGO_FILE_PICKER_LABEL,
  LOGO_MAX_BYTES,
  LOGO_MIME_LABELS,
  LOGO_ROUTE_PATH,
  type LogoMimeType,
} from "@/lib/settings/constants";
import { validateLogoBytes } from "@/lib/settings/logo";
import {
  removeLogoAction,
  uploadLogoAction,
  type SettingsActionState,
} from "@/actions/settings/actions";

function StateNote({ state }: { state: SettingsActionState }) {
  if (!state.message) return null;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-sm ${
        state.success
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {state.message}
    </div>
  );
}

export function LogoManager({
  canEdit,
  logo,
}: {
  canEdit: boolean;
  logo: { present: boolean; mimeType: string; size: number; updatedAt: string };
}) {
  const [uploadState, runUpload, uploading] = useActionState<SettingsActionState, FormData>(
    async (prev, form) => {
      const next = await uploadLogoAction(prev, form);
      // Only a real success flips the stored flag. Previously the "removed"
      // result stayed sticky forever, so uploading a new logo after a remove
      // still rendered "no logo".
      if (next.success) {
        setLogoOverride({ present: true, version: next.logoVersion ?? "" });
        // The bytes now live in MongoDB; the blob preview has done its job.
        replacePreview(null);
      }
      return next;
    },
    {}
  );
  const [removeState, setRemoveState] = useState<SettingsActionState>({});
  const [removing, startRemove] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [logoOverride, setLogoOverride] = useState<{ present: boolean; version: string } | null>(
    null
  );
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  /**
   * The rendered state is derived from the server snapshot, overridden only by
   * the most recent successful write. The blob URL is used for the local
   * pre-save preview and is dropped as soon as the write succeeds, so the
   * displayed image is always the persisted server URL — the blob would not
   * survive a reload.
   */
  const present = logoOverride ? logoOverride.present : logo.present;
  const version = logoOverride?.version || logo.updatedAt;
  const src = preview ?? (present ? `${LOGO_ROUTE_PATH}?v=${encodeURIComponent(version)}` : null);
  const mimeLabel = logo.mimeType
    ? (LOGO_MIME_LABELS[logo.mimeType as LogoMimeType] ?? logo.mimeType)
    : "";

  function replacePreview(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }

  async function onPick(file: File | null) {
    if (!file) {
      replacePreview(null);
      setClientError(null);
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      replacePreview(null);
      setClientError("Logo must be 2 MB or smaller.");
      return;
    }
    const check = validateLogoBytes(new Uint8Array(await file.arrayBuffer()), file.type);
    if (!check.ok) {
      replacePreview(null);
      setClientError(check.error ?? "Invalid image.");
      return;
    }
    setClientError(null);
    replacePreview(URL.createObjectURL(file));
  }

  function onRemove() {
    startRemove(async () => {
      const next = await removeLogoAction();
      setRemoveState(next);
      if (next.success) {
        // Drop the local preview and show the server's (now empty) state.
        replacePreview(null);
        setLogoOverride({ present: false, version: next.logoVersion ?? "" });
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Logo is stored with your restaurant and shown in the app header. {LOGO_FILE_PICKER_LABEL}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <StateNote state={uploadState} />
        {clientError && <p className="text-sm text-destructive">{clientError}</p>}
        <StateNote state={removeState} />

        <div className="flex items-center gap-4">
          {src ? (
            <img
              src={src}
              alt="Restaurant logo"
              className="size-16 rounded-lg border bg-white object-contain p-1"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              No logo
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {logo.size > 0
              ? `${mimeLabel} · ${Math.max(1, Math.round(logo.size / 1024))} KB`
              : "No logo uploaded yet."}
          </p>
        </div>

        {canEdit && (
          <form
            key={uploadState.logoVersion ?? "logo-form"}
            action={runUpload}
            className="grid gap-3"
            onSubmit={() => setClientError(null)}
          >
            <div className="grid gap-2">
              <Label htmlFor="logo">Logo image</Label>
              <Input
                id="logo"
                name="logo"
                type="file"
                accept={LOGO_ACCEPT_ATTRIBUTE}
                onChange={(e) => void onPick(e.currentTarget.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Maximum {Math.round(LOGO_MAX_BYTES / (1024 * 1024))} MB. The image type is
                verified from the file contents, not from the browser.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                {present ? "Replace logo" : "Upload logo"}
              </Button>
              {present && (
                <Button type="button" variant="destructive" disabled={removing} onClick={onRemove}>
                  {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Remove
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
