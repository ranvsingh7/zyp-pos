export const businessTypes = [
  "Restaurant",
  "Cafe",
  "Fast Food",
  "Bakery",
  "Cloud Kitchen",
  "Other",
] as const;

export type BusinessType = (typeof businessTypes)[number];