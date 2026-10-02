import type { TableStatus } from "@/lib/tables/constants";

export interface TableSectionView {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface TableView {
  id: string;
  name: string;
  capacity: number;
  sectionId: string | null;
  sectionName: string | null;
  status: TableStatus;
  isActive: boolean;
  displayOrder: number;
  position: { x: number; y: number } | null;
  createdAt: string;
  updatedAt: string;
}