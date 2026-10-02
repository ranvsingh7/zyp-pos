export interface ActionResult {
  success: boolean;
  message?: string;
  id?: string;
}

export async function wrapMenuAction(
  fn: () => Promise<ActionResult>
): Promise<ActionResult> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NEXT_REDIRECT") {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Something went wrong.";
    return { success: false, message };
  }
}