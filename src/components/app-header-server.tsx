import { AppHeader } from "@/components/app-header";
import { requireRestaurant } from "@/lib/auth/guards";
import { getSessionRole } from "@/lib/auth/session";
import { getServiceAccess } from "@/lib/services/access";

/**
 * Server-side wrapper around the client `AppHeader`.
 *
 * `AppHeader` cannot resolve entitlements itself — it is a client component and
 * must never receive them from a caller-supplied value. Wrapping it here means
 * every venue page gets its navigation filtered from the server's own view of
 * the subscription snapshot, and no page has to remember to pass anything.
 *
 * This only decides what is *visible*. Each guarded page independently
 * re-checks the same entitlement before rendering its body, so a user who types
 * a locked URL directly still gets the locked screen.
 */
export async function AppHeaderServer(props: {
  userName: string;
  restaurantName?: string | null;
  restaurantLogoUrl?: string | null;
}) {
  const [restaurant, role] = await Promise.all([requireRestaurant(), getSessionRole()]);
  // `role` is a primitive so this shares one cache entry with the identical
  // check the page already made through `requireService()`. See the note on
  // `getServiceAccess()` about why an options object must not be reintroduced.
  const access = await getServiceAccess(restaurant.id, role);
  return <AppHeader {...props} serviceKeys={access.serviceKeys} />;
}
