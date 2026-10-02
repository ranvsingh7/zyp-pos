export class OrderNotFoundError extends Error {
  constructor(message = "Order not found.") {
    super(message);
    this.name = "OrderNotFoundError";
  }
}

export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderValidationError";
  }
}

export class OrderForbiddenError extends Error {
  constructor(message = "You do not have permission to manage orders.") {
    super(message);
    this.name = "OrderForbiddenError";
  }
}