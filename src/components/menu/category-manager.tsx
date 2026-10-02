"use client";

import { useState, useCallback } from "react";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ConfirmDialog } from "@/components/menu/confirm-dialog";
import type { MenuCategoryView } from "@/lib/menu/types";
import {
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  toggleCategoryStatusAction,
  reorderCategoriesAction,
} from "@/actions/menu/categories";

function sortCategories(cats: MenuCategoryView[]): MenuCategoryView[] {
  return [...cats].sort(
    (a, b) =>
      a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)
  );
}

export function CategoryManager({
  open,
  onClose,
  categories,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  categories: MenuCategoryView[];
  onSaved: () => void;
}) {
  const [view, setView] = useState<"list" | "add" | "edit">("list");
  const [localCats, setLocalCats] = useState<MenuCategoryView[]>(() =>
    sortCategories(categories)
  );
  const [editing, setEditing] = useState<MenuCategoryView | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<MenuCategoryView | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  // Sync list view with the latest server data while the dialog stays open.
  const [prevCats, setPrevCats] = useState(categories);
  if (categories !== prevCats) {
    setPrevCats(categories);
    setLocalCats(sortCategories(categories));
  }

  const syncAndRefresh = useCallback(() => {
    onSaved();
  }, [onSaved]);

  function openAdd() {
    setName("");
    setDescription("");
    setError(null);
    setView("add");
  }

  function openEdit(cat: MenuCategoryView) {
    setName(cat.name);
    setDescription(cat.description ?? "");
    setError(null);
    setEditing(cat);
    setView("edit");
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const payload = { name: name.trim(), description: description.trim() || undefined };
    const res =
      view === "edit" && editing
        ? await updateCategoryAction({ id: editing.id, ...payload })
        : await createCategoryAction(payload);
    setSaving(false);
    if (res.success) {
      setView("list");
      syncAndRefresh();
    } else {
      setError(res.message ?? "Save failed.");
    }
  }

  async function handleMove(cat: MenuCategoryView, direction: -1 | 1) {
    const idx = localCats.findIndex((c) => c.id === cat.id);
    if (idx === -1) return;
    const otherIdx = idx + direction;
    if (otherIdx < 0 || otherIdx >= localCats.length) return;
    const reordered = [...localCats];
    [reordered[idx], reordered[otherIdx]] = [reordered[otherIdx], reordered[idx]];
    const res = await reorderCategoriesAction({
      orderedIds: reordered.map((c) => c.id),
    });
    if (res.success) {
      setLocalCats(
        reordered.map((c, i) => ({ ...c, displayOrder: i }))
      );
      syncAndRefresh();
    }
  }

  async function handleToggle(cat: MenuCategoryView) {
    const res = await toggleCategoryStatusAction({
      id: cat.id,
      isActive: !cat.isActive,
    });
    if (res.success) syncAndRefresh();
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeletePending(true);
    const res = await deleteCategoryAction({ id: confirmDelete.id });
    setDeletePending(false);
    setConfirmDelete(null);
    if (res.success) syncAndRefresh();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogPopup className="max-w-lg">
          <DialogHeader className="pr-8">
            <DialogTitle>
              {view === "list"
                ? "Manage Categories"
                : view === "add"
                  ? "Add Category"
                  : "Edit Category"}
            </DialogTitle>
            {view === "list" && (
              <Button size="sm" className="ml-auto" onClick={openAdd}>
                <Plus className="mr-1 size-4" />
                Add
              </Button>
            )}
            <DialogDescription className="sr-only">
              Manage menu categories.
            </DialogDescription>
          </DialogHeader>

          {/* List */}
          {view === "list" && (
            <DialogBody>
              <div className="divide-y divide-border/50 -mx-2">
                {localCats.map((cat, idx) => (
                  <div
                    key={cat.id}
                    className="flex items-center gap-3 px-2 py-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 text-muted-foreground"
                        disabled={idx === 0}
                        onClick={() => handleMove(cat, -1)}
                        aria-label="Move up"
                      >
                        <ArrowUp className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 text-muted-foreground"
                        disabled={idx === localCats.length - 1}
                        onClick={() => handleMove(cat, 1)}
                        aria-label="Move down"
                      >
                        <ArrowDown className="size-3" />
                      </Button>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${!cat.isActive ? "opacity-60" : ""}`}>
                        {cat.name}
                      </p>
                      {cat.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {cat.description}
                        </p>
                      )}
                    </div>

                    <Switch
                      checked={cat.isActive}
                      onCheckedChange={() => handleToggle(cat)}
                      aria-label={cat.isActive ? "Disable" : "Enable"}
                    />

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => openEdit(cat)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete(cat)}
                    >
                      Delete
                    </Button>
                  </div>
                ))}

                {localCats.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No categories yet.
                  </p>
                )}
              </div>
            </DialogBody>
          )}

          {/* Add / Edit form */}
          {(view === "add" || view === "edit") && (
            <>
              <DialogBody>
                {error && (
                  <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="cat-name">Name</Label>
                    <Input
                      id="cat-name"
                      value={name}
                      onChange={(e) => setName(e.currentTarget.value)}
                      placeholder="e.g. Main Course"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="cat-desc">Description (optional)</Label>
                    <Textarea
                      id="cat-desc"
                      value={description}
                      onChange={(e) => setDescription(e.currentTarget.value)}
                      placeholder="Short description"
                      rows={2}
                    />
                  </div>
                </div>
              </DialogBody>

              <DialogFooter>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => setView("list")}
                >
                  Cancel
                </Button>
                <Button size="sm" disabled={saving || !name.trim()} onClick={handleSave}>
                  {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
                  {saving ? "Saving…" : view === "add" ? "Add Category" : "Save Changes"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogPopup>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete "${confirmDelete?.name}"?`}
        message={
          "Categories linked to active menu items cannot be deleted. You will see an error if this category is still in use."
        }
        confirmLabel="Delete"
        destructive
        pending={deletePending}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
      />
    </>
  );
}