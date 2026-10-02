export const MENU_ITEM_TYPES = ["FOOD", "BEVERAGE", "OTHER"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

export const MENU_VEG_TYPES = ["VEG", "NON_VEG", "EGG", "NA"] as const;
export type MenuVegType = (typeof MENU_VEG_TYPES)[number];

export const MENU_SIZE_UNITS = ["ML", "L", "GM", "KG", "PCS"] as const;
export type MenuSizeUnit = (typeof MENU_SIZE_UNITS)[number];

export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Longest HSN/SAC code we accept. The GST Council's HSN table tops out at 8
 * digits (SAC codes are 6), so 8 is a generous ceiling. Only the length is
 * enforced — which codes are valid is the restaurant's call, never ours.
 */
export const HSN_SAC_CODE_MAX = 8;