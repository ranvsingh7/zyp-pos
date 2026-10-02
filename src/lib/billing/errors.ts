export class BillNotFoundError extends Error {
  constructor(message = "Bill not found.") {
    super(message);
    this.name = "BillNotFoundError";
  }
}

export class BillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillValidationError";
  }
}

export class BillForbiddenError extends Error {
  constructor(message = "You do not have permission to manage bills.") {
    super(message);
    this.name = "BillForbiddenError";
  }
}

export class BillAlreadyPaidError extends Error {
  constructor(message = "This bill is already fully paid.") {
    super(message);
    this.name = "BillAlreadyPaidError";
  }
}

export class BillNotPayableError extends Error {
  constructor(message = "This bill can no longer receive payments.") {
    super(message);
    this.name = "BillNotPayableError";
  }
}

export class OverpaymentError extends Error {
  constructor(message = "Payment exceeds the amount due.") {
    super(message);
    this.name = "OverpaymentError";
  }
}

export class BillConflictError extends Error {
  constructor(message = "The bill was changed by another action. Refresh and try again.") {
    super(message);
    this.name = "BillConflictError";
  }
}
