"use client";

import { useState, useCallback } from "react";
import { ArrowUp, ArrowDown, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createSectionAction,
  setSectionActiveAction,
  reorderSectionsAction,
} from "@/actions/tables/actions";
import type { TableSectionView } from "@/lib/tables/types";

export function SectionManager({
  open,
  onClose,
  sections,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  sections: TableSectionView[];
  onSaved: () => void;
}) {
  const [viewName, setViewName] = useState("list");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localSections, setLocalSections] = useState<TableSectionView[]>(sections);

  // Keep the list in sync with the latest server data while open.
  const [prevSections, setPrevSections] = useState(sections);
  if (sections !== prevSections) {
    setPrevSections(sections);
    setLocalSections(sections);
  }

  const startAdd = useCallback(() => {
    setName("");
    setError(null);
    setViewName("add");
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const trimmed = name.trim();
    const res = await createSectionAction({ name: trimmed });
    setSaving(false);
    if (res.success) {
      onSaved();
      startAdd?.();
      setViewName("list");
    } else {
      setError(res.message ?? "Save failed.");
    }
  }

  async function handleMove(section: TableSectionView, direction: -1 | 1) {
    const idx = localSections.findIndex((s) => s.id === section.id);
    if (idx < 0) return;
    const other = idx + direction;
    if (other < 0 || other >= localSections.length) return;
    const reordered = [...localSections];
    const tmp = reordered[idx];
    reordered[idx] = reordered[other];
    reordered[other] = tmp;
    const res = await reorderSectionsAction({
      orderedIds: reordered.map((s) => s.id),
    });
    if (res.success) {
      setLocalSections(reordered.map((s, i) => ({ ...s, displayOrder: i })));
      onSaved();
    }
  }

  async function handleToggle(section: TableSectionView) {
    const target = !section.isActive;
    const res = await setSectionActiveAction({
      id: section.id,
      isActive: target,
    });
    if (res.success) {
      setLocalSections((prev) =>
        prev.map((s) =>
          s.id === section.id ? { ...s, isActive: target } : s
        )
      );
      onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {viewName === "add" ? "Add Section" : "Manage Sections"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Manage your restaurant sections (floors / zones).
          </DialogDescription>
          {viewName === "list" && (
            <Button size="sm" className="ml-auto" onClick={startAdd}>
              <Plus className="mr-1 size-4" />
              Add Section
            </Button>
          )}
        </DialogHeader>

        {viewName === "list" && (
          <DialogBody>
            <div className="divide-y divide-border/50">
              {localSections.map((section, idx) => (
                <div
                  key={section.id}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 text-muted-foreground"
                      disabled={idx === 0}
                      onClick={() => handleMove(section, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 text-muted-foreground"
                      disabled={idx === localSections.length - 1}
                      onClick={() => handleMove(section, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{section.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {section.isActive ? "Active" : "Inactive"}
                    </p>
                  </div>
                  <Switch
                    checked={section.isActive}
                    onCheckedChange={() => handleToggle(section)}
                    aria-label={
                      section.isActive ? "Deactivate section" : "Activate section"
                    }
                  />
                </div>
              ))}
              {localSections.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No sections yet. Create your first section.
                </p>
              )}
            </div>
          </DialogBody>
        )}

        {viewName === "add" && (
          <>
            <DialogBody>
              {error && (
                <div
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="section-name">Section name *</Label>
                  <Input
                    id="section-name"
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    placeholder="e.g. Ground Floor"
                    autoFocus
                  />
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setViewName("list")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving || !name.trim()}
                onClick={handleSave}
              >
                {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                {saving ? "Saving…" : "Create Section"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}