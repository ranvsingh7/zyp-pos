import "server-only";

export class AdminForbiddenError extends Error {
  constructor(message = "Only SUPER_ADMIN can perform this action.") {
    super(message);
    this.name = "AdminForbiddenError";
  }
}

export class PlanNotFoundError extends Error {
  constructor() {
    super("Plan not found.");
    this.name = "PlanNotFoundError";
  }
}

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

export class RestaurantNotFoundError extends Error {
  constructor() {
    super("Restaurant not found.");
    this.name = "RestaurantNotFoundError";
  }
}

export class DuplicateOwnerEmailError extends Error {
  constructor() {
    super("An account already exists with this owner email.");
    this.name = "DuplicateOwnerEmailError";
  }
}

export class SubscriptionNotFoundError extends Error {
  constructor() {
    super("Subscription not found.");
    this.name = "SubscriptionNotFoundError";
  }
}

export class SubscriptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionValidationError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super("Subscription payment not found.");
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentValidationError";
  }
}

export class PlatformSettingsNotFoundError extends Error {
  constructor() {
    super("Platform settings not found.");
    this.name = "PlatformSettingsNotFoundError";
  }
}