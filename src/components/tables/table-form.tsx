"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { TableView } from "@/lib/tables/types";
import type { TableSectionView } from "@/lib/tables/types";
import { createTableAction, updateTableAction } from "@/actions/tables/actions";

export function TableForm({
  open,
  onClose,
  sections,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  sections: TableSectionView[];
  initial?: TableView | null;
  onSaved: () => void;
}) {
  const editing = Boolean(initial);

  const [name, setName] = useState(initial?.name ?? "");
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? ""));
  const [sectionId, setSectionId] = useState<string>(
    initial?.sectionId ?? "none"
  );
  const [status, setStatus] = useState<string>(initial?.status ?? "AVAILABLE");
  const [isActive, setIsActive] = useState<boolean>(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(o: boolean) {
    if (!o) onClose();
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      capacity: capacity === "" ? undefined : Number(capacity),
      sectionId: sectionId === "none" ? undefined : sectionId,
      status: status as "AVAILABLE" | "OCCUPIED" | "RESERVED",
      isActive,
    };
    const res = initial
      ? await updateTableAction({ id: initial.id, ...payload })
      : await createTableAction(payload);
    setSaving(false);
    if (res.success) {
      onSaved();
      onClose();
    } else {
      setError(res.message ?? "Save failed.");
    }
  }

  // Only used for the Edit form: keep "Active" status selectable.
  // Also keep the currently selected (possibly deactivated) section listed so
  // an in-flight edit never shows a dangling ObjectId in the select.
  const sectionOptions = sections.filter(
    (s) => s.isActive || s.id === sectionId
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {editing ? "Edit Table" : "Add Table"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editing
              ? "Update table details."
              : "Create a new table on your restaurant floor."}
          </DialogDescription>
        </DialogHeader>

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
              <Label htmlFor="table-name">Table name / number *</Label>
              <Input
                id="table-name"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="e.g. T1, Table 4, VIP 1"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="table-capacity">Capacity (seats) *</Label>
              <Input
                id="table-capacity"
                type="number"
                min={1}
                max={20}
                step={1}
                value={capacity}
                onChange={(e) => setCapacity(e.currentTarget.value)}
                placeholder="e.g. 4"
              />
              <p className="text-xs text-muted-foreground">
                Between 1 and 20 seats.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="table-section">Section</Label>
              <Select
                value={sectionId}
                onValueChange={(v) => setSectionId(v ?? "none")}
              >
                <SelectTrigger id="table-section" className="w-full">
                  <SelectValue placeholder="Select a section" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No section</SelectItem>
                  {sectionOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sectionOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No sections yet. Use &quot;Manage Sections&quot; to create
                  one.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="table-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v ?? "AVAILABLE")}
              >
                <SelectTrigger id="table-status" className="w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AVAILABLE">Available</SelectItem>
                  <SelectItem value="OCCUPIED">Occupied</SelectItem>
                  <SelectItem value="RESERVED">Reserved</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label className="text-sm">Active</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Inactive tables are hidden from the floor view.
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={(v) => setIsActive(v)}
                aria-label="Table active"
              />
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving || !name.trim() || capacity === ""}
            onClick={handleSubmit}
          >
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
            {saving ? "Saving…" : editing ? "Save Changes" : "Create Table"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}