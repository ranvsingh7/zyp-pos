import "server-only";

import { revalidateTag, updateTag } from "next/cache";

export function invalidateNextTag(tag: string): void {
  try {
    updateTag(tag);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("updateTag can only be called from within a Server Action")
    ) {
      try {
        revalidateTag(tag, "max");
      } catch (fallbackError) {
        if (
          !(
            fallbackError instanceof Error &&
            fallbackError.message.includes("static generation store missing in revalidateTag")
          )
        ) {
          throw fallbackError;
        }
      }
      return;
    }
    throw error;
  }
}

/**
 * Next's data cache exists during an app request, but service-level tests and
 * scripts can call the same loaders outside a Next request context. Keep those
 * callers correct without hiding real database errors.
 */
export async function withNextCache<T>(
  cachedRead: () => Promise<T>,
  uncachedRead: () => Promise<T>
): Promise<T> {
  try {
    return await cachedRead();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("incrementalCache missing in unstable_cache")
    ) {
      return uncachedRead();
    }
    throw error;
  }
}
