import { describe, it, expect } from "vitest";
import {
  parseOrdersSearchParams,
  isOrdersQueryFiltered,
  ordersQueryToSearchParams,
} from "@/lib/orders/orders-query";
import { DEFAULT_ORDER_SORT, ORDERS_PAGE_SIZE } from "@/lib/orders/constants";

const OID = "0123456789abcdef01234567";

describe("orders query parsing", () => {
  it("defaults to today / newest / page 1 with no filters", () => {
    const query = parseOrdersSearchParams({});
    expect(query).toEqual({
      q: "",
      date: "today",
      from: null,
      to: null,
      type: "",
      status: "",
      payment: "",
      table: null,
      staff: null,
      sort: DEFAULT_ORDER_SORT,
      page: 1,
    });
    expect(isOrdersQueryFiltered(query)).toBe(false);
  });

  it("accepts valid values and array params (first wins)", () => {
    const query = parseOrdersSearchParams({
      q: ["  paneer  "],
      date: "7d",
      type: "TAKEAWAY",
      status: "PAID",
      payment: "PARTIAL",
      table: OID,
      staff: OID,
      sort: "amount_desc",
      page: "3",
    });
    expect(query.q).toBe("paneer");
    expect(query.date).toBe("7d");
    expect(query.type).toBe("TAKEAWAY");
    expect(query.status).toBe("PAID");
    expect(query.payment).toBe("PARTIAL");
    expect(query.table).toBe(OID);
    expect(query.staff).toBe(OID);
    expect(query.sort).toBe("amount_desc");
    expect(query.page).toBe(3);
    expect(isOrdersQueryFiltered(query)).toBe(true);
  });

  it("falls back safely for invalid filter values", () => {
    const query = parseOrdersSearchParams({
      date: "last-decade",
      type: "FLY",
      status: "ALMOST",
      payment: "IOU",
      table: "not-an-id",
      staff: "123",
      sort: "cheapest",
      page: "-4",
    });
    expect(query.date).toBe("today");
    expect(query.type).toBe("");
    expect(query.status).toBe("");
    expect(query.payment).toBe("");
    expect(query.table).toBeNull();
    expect(query.staff).toBeNull();
    expect(query.sort).toBe(DEFAULT_ORDER_SORT);
    expect(query.page).toBe(1);
  });

  it("keeps a valid custom range and validates its dates", () => {
    const query = parseOrdersSearchParams({
      date: "custom",
      from: "2025-03-01",
      to: "not-a-date",
    });
    expect(query.date).toBe("custom");
    expect(query.from).toBe("2025-03-01");
    expect(query.to).toBeNull();
  });

  it("caps the search query length", () => {
    const query = parseOrdersSearchParams({ q: "x".repeat(500) });
    expect(query.q.length).toBe(80);
  });

  it("treats an empty table/staff filter as none", () => {
    const query = parseOrdersSearchParams({ table: "", staff: "" });
    expect(query.table).toBeNull();
    expect(query.staff).toBeNull();
  });

  it("round-trips through search params without the default date", () => {
    const query = parseOrdersSearchParams({
      q: "table 4",
      type: "DINE_IN",
      payment: "UNPAID",
      page: "2",
    });
    const params = ordersQueryToSearchParams(query);
    expect(params.get("q")).toBe("table 4");
    expect(params.get("type")).toBe("DINE_IN");
    expect(params.get("payment")).toBe("UNPAID");
    expect(params.get("page")).toBe("2");
    expect(params.get("date")).toBeNull(); // today is the implicit default
    expect(params.get("sort")).toBeNull(); // newest is the implicit default
  });

  it("uses the shared page size constant", () => {
    expect(ORDERS_PAGE_SIZE).toBeGreaterThan(0);
  });
});