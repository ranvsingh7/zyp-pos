export class MenuNotFoundError extends Error {
  constructor(message = "Record not found.") {
    super(message);
    this.name = "MenuNotFoundError";
  }
}

export class MenuValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuValidationError";
  }
}

export class MenuCategoryInUseError extends Error {
  constructor(
    message = "This category contains menu items. Move or deactivate them before deleting."
  ) {
    super(message);
    this.name = "MenuCategoryInUseError";
  }
}

export class MenuAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuAuthorizationError";
  }
}