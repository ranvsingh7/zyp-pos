export const TABLE_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
};

export const TABLE_MIN_CAPACITY = 1;
export const TABLE_MAX_CAPACITY = 20;

export const TABLE_NAME_MAX_LENGTH = 50;
export const SECTION_NAME_MAX_LENGTH = 50;

export const TABLE_EDIT_ROLES = ["OWNER", "MANAGER"] as const;
export const TABLE_STATUS_ROLES = ["OWNER", "MANAGER", "CASHIER", "WAITER"] as const;

export const DEFAULT_SECTION_SUGGESTIONS = [
  "Ground Floor",
  "First Floor",
  "Outdoor",
  "Rooftop",
  "Private Dining",
] as const;