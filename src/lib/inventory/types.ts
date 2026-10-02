import type {
  InventoryBaseUnit,
  InventoryStockStatus,
  InventoryUnit,
  StockMovementReferenceType,
  StockMovementType,
} from "@/lib/inventory/constants";
import type { PurchaseStatus } from "@/models/Purchase";

export interface InventoryItemView {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  sku: string | null;
  isActive: boolean;
  /** Display / purchase unit. */
  unit: InventoryUnit;
  /** Canonical unit stock is stored in. */
  baseUnit: InventoryBaseUnit;
  /** Current stock in `baseUnit`. */
  currentStock: number;
  /** Reorder threshold in `baseUnit`. */
  minimumStock: number;
  /** Cost of one `baseUnit` in integer paise. */
  costPricePaise: number;
  /** currentStock * costPricePaise. */
  stockValuePaise: number;
  status: InventoryStockStatus;
  /** Pre-formatted display helpers (base stock rendered in `unit`). */
  currentStockLabel: string;
  minimumStockLabel: string;
  costPerUnitPaise: number;
  costPerUnitLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySummary {
  totalItems: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  inventoryValuePaise: number;
}

export interface InventoryCategoryView {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  itemCount: number;
}

export interface PurchaseLineView {
  inventoryItemId: string;
  itemName: string;
  quantity: number;
  unit: InventoryUnit;
  quantityLabel: string;
  baseQuantity: number;
  purchaseRatePaise: number;
  totalAmountPaise: number;
  beforeStock: number;
  afterStock: number;
  beforeStockLabel: string;
  afterStockLabel: string;
}

export interface PurchaseRowView {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  itemCount: number;
  subtotalPaise: number;
  status: PurchaseStatus;
  createdByName: string | null;
  createdAt: string;
}

export interface PurchaseDetailView extends PurchaseRowView {
  items: PurchaseLineView[];
  notes: string | null;
}

export interface StockMovementView {
  id: string;
  inventoryItemId: string;
  itemName: string;
  type: StockMovementType;
  direction: "IN" | "OUT";
  quantity: number;
  unit: InventoryUnit;
  /** e.g. "+10 kg" / "-500 g". */
  quantityLabel: string;
  baseQuantity: number;
  beforeStock: number;
  afterStock: number;
  beforeStockLabel: string;
  afterStockLabel: string;
  ratePaise: number | null;
  referenceType: StockMovementReferenceType;
  referenceId: string | null;
  reason: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}
