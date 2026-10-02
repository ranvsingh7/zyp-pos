export class InventoryForbiddenError extends Error {
  constructor(message = "You do not have permission to manage inventory.") {
    super(message);
    this.name = "InventoryForbiddenError";
  }
}

export class InventoryItemNotFoundError extends Error {
  constructor(message = "Inventory item not found.") {
    super(message);
    this.name = "InventoryItemNotFoundError";
  }
}

export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryValidationError";
  }
}

export class InventoryCategoryNotFoundError extends Error {
  constructor(message = "Inventory category not found.") {
    super(message);
    this.name = "InventoryCategoryNotFoundError";
  }
}

export class DuplicateInventoryItemError extends Error {
  constructor(message = "An inventory item with this name already exists.") {
    super(message);
    this.name = "DuplicateInventoryItemError";
  }
}

export class DuplicateInventoryCategoryError extends Error {
  constructor(message = "An inventory category with this name already exists.") {
    super(message);
    this.name = "DuplicateInventoryCategoryError";
  }
}

export class IncompatibleUnitError extends Error {
  constructor(
    message = "This unit is not compatible with the item's stock unit."
  ) {
    super(message);
    this.name = "IncompatibleUnitError";
  }
}

export class InsufficientStockError extends Error {
  availableLabel: string;

  constructor(availableLabel: string) {
    super(`Insufficient stock. Available: ${availableLabel}.`);
    this.name = "InsufficientStockError";
    this.availableLabel = availableLabel;
  }
}

export class PurchaseNotFoundError extends Error {
  constructor(message = "Purchase not found.") {
    super(message);
    this.name = "PurchaseNotFoundError";
  }
}

export class PurchaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseValidationError";
  }
}

export class DuplicatePurchaseNumberError extends Error {
  constructor(message = "A purchase with this number already exists.") {
    super(message);
    this.name = "DuplicatePurchaseNumberError";
  }
}

export class StockMovementNotFoundError extends Error {
  constructor(message = "Stock movement not found.") {
    super(message);
    this.name = "StockMovementNotFoundError";
  }
}
