import "server-only";

import type { TableView } from "@/lib/tables/types";
import type { TableStatus } from "@/lib/tables/constants";
import { naturalCompare } from "@/lib/tables/utils";

export interface SectionViewInput {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface RawTableDoc {
  _id: unknown;
  name: string;
  capacity: number;
  sectionId?: unknown;
  status?: unknown;
  isActive: boolean;
  displayOrder: number;
  position?: { x: number; y: number } | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Maps a raw Mongoose table document to a client-safe TableView. */
export function toTableView(
  doc: RawTableDoc,
  sectionsById: Map<string, SectionViewInput>
): TableView {
  const status: TableStatus = ["AVAILABLE", "OCCUPIED", "RESERVED"].includes(
    String(doc.status)
  )
    ? (String(doc.status) as TableStatus)
    : "AVAILABLE";
  const sectionId = doc.sectionId ? String(doc.sectionId) : null;
  return {
    id: String(doc._id),
    name: doc.name,
    capacity: doc.capacity,
    sectionId,
    sectionName: sectionId ? sectionsById.get(sectionId)?.name ?? null : null,
    status,
    isActive: doc.isActive,
    displayOrder: doc.displayOrder,
    position: doc.position ?? null,
    createdAt: doc.createdAt ? String(doc.createdAt) : "",
    updatedAt: doc.updatedAt ? String(doc.updatedAt) : "",
  };
}

/** Server-side: hydrate raw table + section docs into views ready for the UI. */
export function buildTableView(
  doc: RawTableDoc,
  sections: SectionViewInput[]
): TableView {
  const sectionsById = new Map(sections.map((s) => [s.id, s]));
  return toTableView(doc, sectionsById);
}

/** Natural sort that keeps displayOrder as the primary key. */
export function sortTables(views: TableView[]): TableView[] {
  return [...views].sort(
    (a, b) =>
      a.displayOrder - b.displayOrder ||
      naturalCompare(a.name, b.name) ||
      a.id.localeCompare(b.id)
  );
}