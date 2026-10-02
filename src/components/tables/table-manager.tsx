"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X, RefreshCcw, Layers, Table2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { TableView } from "@/lib/tables/types";
import type { TableSectionView } from "@/lib/tables/types";
import type { TableStatus } from "@/lib/tables/constants";
import { TableCard } from "@/components/tables/table-card";
import { TableForm } from "@/components/tables/table-form";
import { SectionManager } from "@/components/tables/section-manager";
import { ConfirmDialog } from "@/components/menu/confirm-dialog";
import { ToastView, type ToastData } from "@/components/menu/toast";
import {
  deleteTableAction,
  setTableActiveAction,
  updateTableStatusAction,
} from "@/actions/tables/actions";

interface TableManagerProps {
  canEdit: boolean;
  canChangeStatus: boolean;
  sections: TableSectionView[];
  tables: TableView[];
}

type StatusFilter = "all" | TableStatus | "INACTIVE";

export function TableManager({
  canEdit,
  canChangeStatus,
  sections,
  tables,
}: TableManagerProps) {
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [sectionManagerOpen, setSectionManagerOpen] = useState(false);
  const [tableEditor, setTableEditor] = useState<
    | null
    | { mode: "create" }
    | { mode: "edit"; table: TableView }
  >(null);
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((kind: ToastData["kind"], message: string) => {
    if (toastRef.current) clearTimeout(toastRef.current);
    setToast({ kind, message });
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const activeSections = sections.filter((s) => s.isActive);

  const filtered = tables.filter((table) => {
    const q = debounced.trim().toLowerCase();
    if (q) {
      const inName = table.name.toLowerCase().includes(q);
      const inSection =
        (table.sectionName ?? "").toLowerCase().includes(q);
      if (!inName && !inSection) return false;
    }
    if (sectionFilter !== "all" && table.sectionId !== sectionFilter) {
      return false;
    }
    if (statusFilter === "AVAILABLE" && (!table.isActive || table.status !== "AVAILABLE")) return false;
    if (statusFilter === "OCCUPIED" && (!table.isActive || table.status !== "OCCUPIED")) return false;
    if (statusFilter === "RESERVED" && (!table.isActive || table.status !== "RESERVED")) return false;
    if (statusFilter === "INACTIVE" && table.isActive) return false;
    return true;
  });

  const counts = useMemoCounts(tables);

  function refresh() {
    router.refresh();
  }

  function onMutation(kind: "success" | "error", message: string) {
    refresh();
    showToast(kind, message);
  }

  async function runConfirmAction() {
    setConfirmPending(true);
    try {
      await confirmState?.action();
      onMutation("success", "Done.");
    } catch (e: unknown) {
      onMutation("error", e instanceof Error ? e.message : "Action failed.");
    } finally {
      setConfirmPending(false);
      setConfirmState(null);
    }
  }

  function promptDelete(table: TableView) {
    setCardMenuOpen(null);
    setConfirmState({
      title: `Delete "${table.name}"?`,
      message:
        "This table will be permanently removed. You can only keep a record by disabling it instead.",
      action: async () => {
        const res = await deleteTableAction({ id: table.id });
        if (!res.success) throw new Error(res.message);
      },
    });
  }

  async function handleChangeStatus(table: TableView, status: TableStatus) {
    const res = await updateTableStatusAction({ id: table.id, status });
    if (res.success) onMutation("success", `${table.name} → ${status}.`);
    else onMutation("error", res.message ?? "Update failed.");
  }

  async function handleToggleActive(table: TableView) {
    const activate = !table.isActive;
    const res = await setTableActiveAction({
      id: table.id,
      isActive: activate,
    });
    if (res.success)
      onMutation("success", activate ? "Table enabled." : "Table disabled.");
    else onMutation("error", res.message ?? "Update failed.");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-8 sm:px-6">
        {/* Page header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              Tables
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your restaurant tables and seating.
            </p>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSectionManagerOpen(true)}
              >
                <Layers className="mr-1 size-3.5" />
                Sections
              </Button>
              <Button size="sm" onClick={() => setTableEditor({ mode: "create" })}>
                <Plus className="mr-1 size-3.5" />
                Add Table
              </Button>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="Total tables"
            value={counts.total}
            icon={<Table2 className="size-4" />}
          />
          <SummaryCard
            label="Available"
            value={counts.available}
            icon={<span className="size-2 rounded-full bg-green-600" />}
          />
          <SummaryCard
            label="Occupied"
            value={counts.occupied}
            icon={<span className="size-2 rounded-full bg-amber-500" />}
          />
          <SummaryCard
            label="Reserved"
            value={counts.reserved}
            icon={<span className="size-2 rounded-full bg-sky-500" />}
          />
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tables…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              className="pl-9 pr-3"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              className="gap-1.5"
            >
              <RefreshCcw className="size-3.5" />
              Refresh
            </Button>
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter((v as StatusFilter) ?? "all")
              }
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="OCCUPIED">Occupied</SelectItem>
                <SelectItem value="RESERVED">Reserved</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Section quick-filters */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setSectionFilter("all")}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              sectionFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            All ({tables.length})
          </button>
          {activeSections.map((s) => {
            const count = tables.filter((t) => t.sectionId === s.id).length;
            return (
              <button
                key={s.id}
                onClick={() =>
                  setSectionFilter((p) => (p === s.id ? "all" : s.id))
                }
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  sectionFilter === s.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {s.name} ({count})
              </button>
            );
          })}
          {activeSections.length === 0 && (
            <span className="whitespace-nowrap rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground">
              {canEdit
                ? "No sections yet — create one to organize tables."
                : "No sections yet."}
            </span>
          )}
        </div>

        {/* Tables grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <p className="text-muted-foreground">
              {tables.length === 0
                ? "No tables yet. Add your first table to get started."
                : "No tables match your filters."}
            </p>
            {tables.length === 0 && canEdit && (
              <Button
                size="sm"
                className="mt-4"
                onClick={() => setTableEditor({ mode: "create" })}
              >
                <Plus className="mr-1 size-3.5" />
                Add Table
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                canEdit={canEdit}
                canChangeStatus={canChangeStatus}
                onEdit={(t) => setTableEditor({ mode: "edit", table: t })}
                onChangeStatus={handleChangeStatus}
                onToggleActive={handleToggleActive}
                onOpenMenu={(t) =>
                  setCardMenuOpen((p) => (p === t.id ? null : t.id))
                }
              />
            ))}
          </div>
        )}
      </main>

      {/* Card action menu */}
      {cardMenuOpen && canEdit && (
        <div className="fixed inset-0 z-40" onClick={() => setCardMenuOpen(null)}>
          <div
            className="absolute right-4 top-4 z-50 w-40 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const table = tables.find((t) => t.id === cardMenuOpen);
              if (!table) return null;
              return (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-left"
                    onClick={() => {
                      setCardMenuOpen(null);
                      setTableEditor({ mode: "edit", table });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-left"
                    onClick={() => handleToggleActive(table)}
                  >
                    {table.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-left text-destructive hover:text-destructive"
                    onClick={() => promptDelete(table)}
                  >
                    Delete
                  </Button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modals */}
      <SectionManager
        open={sectionManagerOpen}
        onClose={() => setSectionManagerOpen(false)}
        sections={sections}
        onSaved={refresh}
      />

      {tableEditor && (
        <TableForm
          key={tableEditor.mode === "edit" ? tableEditor.table.id : "create"}
          open
          onClose={() => setTableEditor(null)}
          sections={sections}
          initial={tableEditor.mode === "edit" ? tableEditor.table : null}
          onSaved={refresh}
        />
      )}

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.title ?? ""}
        message={confirmState?.message}
        confirmLabel="Delete"
        destructive
        pending={confirmPending}
        onConfirm={runConfirmAction}
        onClose={() => setConfirmState(null)}
      />

      <ToastView toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function useMemoCounts(tables: TableView[]) {
  let total = 0;
  let available = 0;
  let occupied = 0;
  let reserved = 0;
  for (const t of tables) {
    total += 1;
    if (!t.isActive) continue;
    if (t.status === "AVAILABLE") available += 1;
    else if (t.status === "OCCUPIED") occupied += 1;
    else reserved += 1;
  }
  return { total, available, occupied, reserved };
}