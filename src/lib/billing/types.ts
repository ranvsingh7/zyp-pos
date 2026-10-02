import type { BillPaymentMethod, BillStatus, GstScheme } from "./constants";
import type { OrderStatus, OrderType } from "@/lib/orders/constants";

export interface BillItemView {
  menuItemId: string;
  nameSnapshot: string;
  variantId: string | null;
  variantNameSnapshot: string | null;
  /**
   * HSN/SAC frozen at bill time from the order line's snapshot. Null when the
   * sold item never had a code configured. Only shown when set.
   */
  hsnSacCode: string | null;
  quantity: number;
  unitPricePaise: number;
  taxableValuePaise: number;
  discountAmountPaise: number;
  taxRatePercent: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  lineTotalPaise: number;
}

export interface PaymentView {
  id: string;
  method: BillPaymentMethod;
  amountPaise: number;
  referenceNumber: string | null;
  note: string | null;
  receivedBy: string;
  createdAt: string;
}

export interface BillView {
  id: string;
  orderId: string;
  orderNumber: number;
  orderType: OrderType;
  orderStatus: OrderStatus;
  billNumber: string;
  status: BillStatus;
  paymentStatus: BillStatus;
  tableId: string | null;
  tableNameSnapshot: string | null;
  customerName: string | null;
  customerPhone: string | null;

  items: BillItemView[];

  subtotalPaise: number;
  discountPaise: number;
  /** Kind of order discount captured at bill time; null for legacy. */
  discountType: "PERCENTAGE" | "FIXED" | null;
  /** Discount in discountType units (percent or rupees); null when legacy. */
  discountValue: number | null;
  discountReason: string | null;
  taxableAmountPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  totalTaxPaise: number;
  taxRatePercent: number;
  cgstRatePercent: number;
  sgstRatePercent: number;
  igstRatePercent: number;
  taxInclusive: boolean;
  gstScheme: GstScheme;
  gstRegistered: boolean;
  gstin: string | null;

  serviceChargeEnabled: boolean;
  serviceChargeRatePercent: number;
  serviceChargeAmountPaise: number;
  roundOffEnabled: boolean;
  roundOffAmountPaise: number;

  grandTotalPaise: number;
  paidAmountPaise: number;
  dueAmountPaise: number;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  printedCount: number;

  payments: PaymentView[];
}

export interface BillListItemView {
  id: string;
  orderId: string;
  orderNumber: number;
  billNumber: string;
  status: BillStatus;
  paymentStatus: BillStatus;
  orderType: OrderType;
  orderStatus: OrderStatus;
  tableNameSnapshot: string | null;
  customerName: string | null;
  grandTotalPaise: number;
  paidAmountPaise: number;
  dueAmountPaise: number;
  createdAt: string;
  updatedAt: string;
}