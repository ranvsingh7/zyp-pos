export class TableNotFoundError extends Error {
  constructor(message = "Table not found.") {
    super(message);
    this.name = "TableNotFoundError";
  }
}

export class TableValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableValidationError";
  }
}

export class TableInUseError extends Error {
  constructor(
    message = "This table has historical records and cannot be permanently deleted. Deactivate it instead."
  ) {
    super(message);
    this.name = "TableInUseError";
  }
}

export class TableForbiddenError extends Error {
  constructor(message = "You do not have permission to manage tables.") {
    super(message);
    this.name = "TableForbiddenError";
  }
}

export class SectionNotFoundError extends Error {
  constructor(message = "Section not found.") {
    super(message);
    this.name = "SectionNotFoundError";
  }
}

export class SectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SectionValidationError";
  }
}

export class SectionInUseError extends Error {
  constructor(
    message = "This section contains active tables and cannot be deleted. Deactivate it instead."
  ) {
    super(message);
    this.name = "SectionInUseError";
  }
}