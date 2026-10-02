"use client";

import * as React from "react";
import type { OrderView } from "@/lib/orders/types";
import type { OrderType } from "@/lib/orders/constants";
import { ORDER_TYPES } from "@/lib/orders/constants";

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  unitPricePaise: number;
  quantity: number;
  note: string;
}

export function cartLineKey(
  menuItemId: string,
  variantId: string | null,
  note: string
): string {
  return `${menuItemId}:${variantId ?? ""}:${note}`;
}

export function makePlainLine(
  menuItemId: string,
  name: string,
  unitPricePaise: number
): CartLine {
  return {
    key: cartLineKey(menuItemId, null, ""),
    menuItemId,
    name,
    variantId: null,
    variantName: null,
    unitPricePaise,
    quantity: 1,
    note: "",
  };
}

export function makeVariantLine(
  menuItemId: string,
  name: string,
  variantId: string,
  variantName: string,
  unitPricePaise: number
): CartLine {
  return {
    key: cartLineKey(menuItemId, variantId, ""),
    menuItemId,
    name,
    variantId,
    variantName,
    unitPricePaise,
    quantity: 1,
    note: "",
  };
}

export function cartToPayload(cart: CartLine[]) {
  return cart.map((line) => ({
    menuItemId: line.menuItemId,
    variantId: line.variantId ?? undefined,
    quantity: line.quantity,
    note: line.note || undefined,
  }));
}

export function cartTotalPaise(cart: CartLine[]): number {
  return cart.reduce(
    (sum, line) => sum + line.unitPricePaise * line.quantity,
    0
  );
}

/** True when the cart is exactly the saved order (no unsaved edits). */
export function cartMatchesOrder(cart: CartLine[], order: OrderView): boolean {
  if (cart.length !== order.items.length) return false;
  return cart.every((line, index) => {
    const saved = order.items[index];
    return (
      line.menuItemId === saved.menuItemId &&
      line.variantId === saved.variantId &&
      line.quantity === saved.quantity &&
      (line.note ?? "") === (saved.note ?? "")
    );
  });
}

/**
 * True when there is work to save: unsaved edits against the loaded order,
 * or — for a brand-new order — items on the cart (once a table is chosen or
 * the order type doesn't need one).
 */
export function orderHasUnsavedEdits(state: PosState): boolean {
  if (state.activeOrder) {
    return (
      !cartMatchesOrder(state.cart, state.activeOrder) ||
      state.orderNote !== (state.activeOrder.orderNote ?? "")
    );
  }
  if (state.cart.length === 0) return false;
  return Boolean(state.tableId) || state.orderType !== "DINE_IN";
}

export interface PosState {
  orderType: OrderType;
  tableId: string | null;
  cart: CartLine[];
  customerName: string;
  customerPhone: string;
  orderNote: string;
  activeOrder: OrderView | null;
  search: string;
  selectedCategory: string;
  /**
   * Order whose KOT history stays on screen after the order itself was
   * cancelled (e.g. cancelling a KOT that emptied the order). Keeps the
   * persisted CANCELLED KOT visible instead of hiding it from the history
   * panel. Cleared once a new session/order takes over.
   */
  lastOrderId: string | null;
}

export type PosAction =
  | { type: "SET_ORDER_TYPE"; orderType: OrderType }
  | { type: "SELECT_TABLE"; tableId: string | null }
  | { type: "ADD_LINE"; line: CartLine }
  | { type: "UPDATE_LINE"; key: string; patch: Partial<Pick<CartLine, "quantity" | "note">> }
  | { type: "REMOVE_LINE"; key: string }
  | { type: "SET_CUSTOMER_NAME"; value: string }
  | { type: "SET_CUSTOMER_PHONE"; value: string }
  | { type: "SET_ORDER_NOTE"; value: string }
  | { type: "SET_SEARCH"; value: string }
  | { type: "SET_CATEGORY"; value: string }
  | { type: "LOAD_ORDER"; order: OrderView }
  | { type: "NEW_ORDER" }
  | { type: "ORDER_CANCELLED"; orderId: string };

export function initialState(): PosState {
  return {
    orderType: "DINE_IN",
    tableId: null,
    cart: [],
    customerName: "",
    customerPhone: "",
    orderNote: "",
    activeOrder: null,
    search: "",
    selectedCategory: "all",
    lastOrderId: null,
  };
}

function orderToCart(order: OrderView): CartLine[] {
  return order.items.map((item) => ({
    key: cartLineKey(item.menuItemId, item.variantId, item.note ?? ""),
    menuItemId: item.menuItemId,
    name: item.nameSnapshot,
    variantId: item.variantId,
    variantName: item.variantNameSnapshot,
    unitPricePaise: item.unitPricePaise,
    quantity: item.quantity,
    note: item.note ?? "",
  }));
}

export function reducePos(state: PosState, action: PosAction): PosState {
  switch (action.type) {
    case "SET_ORDER_TYPE": {
      if (state.activeOrder) return state;
      if (!(ORDER_TYPES as readonly string[]).includes(action.orderType)) return state;
      const orderType = action.orderType;
      return {
        ...state,
        orderType,
        tableId: orderType === "DINE_IN" ? state.tableId : null,
        lastOrderId: null,
      };
    }
    // Selecting a table while composing a NEW order (no active order loaded)
    // only attaches the table — the draft cart, customer and note are all
    // preserved. When an active order is on screen, picking a table starts a
    // fresh dine-in session there.
    case "SELECT_TABLE": {
      if (!action.tableId) return state;
      if (!state.activeOrder) {
        return {
          ...state,
          orderType: "DINE_IN",
          tableId: action.tableId,
          lastOrderId: null,
        };
      }
      return {
        ...initialState(),
        orderType: "DINE_IN",
        tableId: action.tableId,
        search: state.search,
        selectedCategory: state.selectedCategory,
      };
    }
    case "ADD_LINE": {
      const existing = state.cart.find((line) => line.key === action.line.key);
      if (existing) {
        return {
          ...state,
          cart: state.cart.map((line) =>
            line.key === existing.key
              ? { ...line, quantity: line.quantity + action.line.quantity }
              : line
          ),
        };
      }
      return { ...state, cart: [...state.cart, action.line] };
    }
    case "UPDATE_LINE": {
      return {
        ...state,
        cart: state.cart.map((line) => {
          if (line.key !== action.key) return line;
          const next = { ...line, ...action.patch };
          if (next.quantity < 1) next.quantity = 1;
          return next;
        }),
      };
    }
    case "REMOVE_LINE":
      return { ...state, cart: state.cart.filter((line) => line.key !== action.key) };
    case "SET_CUSTOMER_NAME":
      return { ...state, customerName: action.value };
    case "SET_CUSTOMER_PHONE":
      return { ...state, customerPhone: action.value };
    case "SET_ORDER_NOTE":
      return { ...state, orderNote: action.value };
    case "SET_SEARCH":
      return { ...state, search: action.value };
    case "SET_CATEGORY":
      return { ...state, selectedCategory: action.value };
    case "LOAD_ORDER": {
      const order = action.order;
      return {
        ...state,
        orderType: order.orderType,
        tableId: order.tableId,
        cart: orderToCart(order),
        customerName: order.customerName ?? "",
        customerPhone: order.customerPhone ?? "",
        orderNote: order.orderNote ?? "",
        activeOrder: order,
        lastOrderId: null,
      };
    }
    case "NEW_ORDER":
      return {
        ...initialState(),
        orderType: state.orderType,
        search: state.search,
        selectedCategory: state.selectedCategory,
      };
    case "ORDER_CANCELLED":
      // Same fresh-draft reset as NEW_ORDER, but the cancelled order's id is
      // remembered so its persisted KOT history (with the red CANCELLED badge
      // and timeline) stays visible instead of being wiped from the panel.
      return {
        ...initialState(),
        orderType: state.orderType,
        search: state.search,
        selectedCategory: state.selectedCategory,
        lastOrderId: action.orderId,
      };
    default:
      return state;
  }
}

export type PosDispatch = React.Dispatch<PosAction>;

const PosStateContext = React.createContext<PosState | null>(null);
const PosDispatchContext = React.createContext<PosDispatch | null>(null);

export function PosProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducePos, undefined, initialState);
  return (
    <PosStateContext.Provider value={state}>
      <PosDispatchContext.Provider value={dispatch}>
        {children}
      </PosDispatchContext.Provider>
    </PosStateContext.Provider>
  );
}

export function usePos(): { state: PosState; dispatch: PosDispatch } {
  const state = React.useContext(PosStateContext);
  const dispatch = React.useContext(PosDispatchContext);
  if (!state || !dispatch) {
    throw new Error("usePos must be used within a PosProvider.");
  }
  return { state, dispatch };
}