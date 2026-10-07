import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * Integration coverage for the SUPER_ADMIN owner-password-reset feature.
 *
 * Everything below runs against a real MongoDB (no authorization or persistence
 * is mocked away). The only thing stubbed is the request boundary — `cookies()`
 * and `redirect()` — because a server action needs a request scope to exist.
 * That means `requireAuth`/`requireSuperAdmin` still resolve the session from a
 * real signed JWT and re-read the role from the database on every call, so the
 * authorization assertions below are genuine.
 */

let currentToken: string | null = null;

// next/cache needs an active request scope; outside one `revalidatePath` throws
// an invariant error that `wrapAdminAction` would surface as a fake failure
// message. Stubbed so the real action body runs, and recorded so the successful
// path can be asserted on.
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "restopos_session" && currentToken
        ? { name, value: currentToken }
        : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Map(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  permanentRedirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

import mongoose from "mongoose";
import { UserModel } from "@/models/User";
import { RestaurantModel } from "@/models/Restaurant";
import { RestaurantSettingsModel } from "@/models/RestaurantSettings";
import { PlanModel } from "@/models/Plan";
import { SubscriptionModel } from "@/models/Subscription";
import { SubscriptionHistoryModel } from "@/models/SubscriptionHistory";
import { SubscriptionPaymentModel } from "@/models/SubscriptionPayment";
import { PlatformCounterModel } from "@/models/PlatformCounter";
import { TableAuditLogModel } from "@/models/TableAuditLog";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { UserRole } from "@/lib/auth/roles";
import { encryptSession } from "@/lib/auth/session";
import { attemptLogin } from "@/lib/auth/login-service";
import { getCurrentUser } from "@/lib/auth/guards";
import { requireSuperAdmin } from "@/lib/admin/permissions";
import { resetRestaurantOwnerPassword } from "@/lib/admin/restaurant-admin-service";
import { resetOwnerPasswordSchema } from "@/lib/admin/query";
import { resetOwnerPasswordAction } from "@/actions/admin/restaurants";
import {
  AdminForbiddenError,
  OwnerAccountNotFoundError,
  OwnerPasswordResetForbiddenError,
} from "@/lib/admin/errors";

const MONGODB_E2E_URI =
  process.env.MONGODB_E2E_URI ?? "mongodb://127.0.0.1:27018/restopos_owner_reset_e2e";

const OLD_PASSWORD = "OldOwnerPass1";
const NEW_PASSWORD = "BrandNewPass1";

let available = false;
let seq = 0;

function uniqueEmail(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@restopos.test`;
}

interface Seeded {
  userId: string;
  email: string;
}

interface SeededTenant {
  restaurantId: string;
  ownerId: string;
  ownerEmail: string;
}

/**
 * Creates a user plus the restaurant that owns them, wired exactly the way the
 * application wires ownership: `Restaurant.ownerId` → user, and the user's
 * `restaurantId` → restaurant.
 */
async function seedUserWithRestaurant(
  role: UserRole,
  restaurantName: string
): Promise<SeededTenant> {
  const email = uniqueEmail("owner");
  const user = await UserModel.create({
    fullName: `${restaurantName} Owner`,
    email,
    passwordHash: await hashPassword(OLD_PASSWORD),
    phone: "9876543210",
    role,
    isActive: true,
  });
  const restaurant = await RestaurantModel.create({
    name: restaurantName,
    ownerId: String(user._id),
    phone: "9876543210",
    address: "1 Food St",
    city: "Mumbai",
    state: "MA",
    pincode: "400001",
    businessType: "Restaurant",
    isActive: true,
  });
  await UserModel.updateOne(
    { _id: user._id },
    { $set: { restaurantId: String(restaurant._id) } }
  );
  return {
    restaurantId: String(restaurant._id),
    ownerId: String(user._id),
    ownerEmail: email,
  };
}

async function seedSuperAdmin(): Promise<Seeded> {
  const email = uniqueEmail("superadmin");
  const user = await UserModel.create({
    fullName: "Platform Admin",
    email,
    passwordHash: await hashPassword(OLD_PASSWORD),
    role: "SUPER_ADMIN",
    restaurantId: null,
    isActive: true,
  });
  return { userId: String(user._id), email };
}

/** Signs a real session JWT for a user, exactly as login would. */
async function sessionTokenFor(userId: string, role: UserRole): Promise<string> {
  const doc = await UserModel.findById(userId).select("tokenVersion restaurantId").lean();
  return encryptSession({
    userId,
    restaurantId: doc?.restaurantId ? String(doc.restaurantId) : null,
    role,
    tokenVersion: doc?.tokenVersion ?? 0,
  });
}

async function superAdminActor() {
  const admin = await seedSuperAdmin();
  const token = await sessionTokenFor(admin.userId, "SUPER_ADMIN");
  currentToken = token;
  return admin;
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

async function storedHashOf(userId: string): Promise<string | null> {
  const user = await UserModel.findById(userId).select("+passwordHash").lean();
  return user?.passwordHash ?? null;
}

beforeAll(async () => {
  try {
    await mongoose.connect(MONGODB_E2E_URI, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db?.command({ ping: 1 });
    available = true;
  } catch {
    available = false;
  }
}, 15000);

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  currentToken = null;
  if (!available) return;
  await UserModel.deleteMany({});
  await RestaurantModel.deleteMany({});
  await RestaurantSettingsModel.deleteMany({});
  await PlanModel.deleteMany({});
  await SubscriptionModel.deleteMany({});
  await SubscriptionHistoryModel.deleteMany({});
  await SubscriptionPaymentModel.deleteMany({});
  await PlatformCounterModel.deleteMany({});
  await TableAuditLogModel.collection.deleteMany({});
  await mongoose.connection.collection("ratelimits").deleteMany({});
});

it("requires a reachable MongoDB so a skipped run can never look green", () => {
  expect(available, `MongoDB unreachable at ${MONGODB_E2E_URI}`).toBe(true);
});

/* ------------------------------------------------------------------ */
/* 1. A SUPER_ADMIN can reset an OWNER password                        */
/* ------------------------------------------------------------------ */

describe("SUPER_ADMIN owner password reset: the happy path", () => {
  it("lets a SUPER_ADMIN set a new owner password and signs the owner out everywhere", async () => {
    const admin = await superAdminActor();
    const tenant = await seedUserWithRestaurant("OWNER", "Curry House");

    const state = await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );

    expect(state.success).toBe(true);
    expect(state.message).toBe("Owner password reset successfully.");

    // 17. The owner can log in with the new password...
    const login = await attemptLogin({
      email: tenant.ownerEmail,
      password: NEW_PASSWORD,
    });
    expect(login.ok).toBe(true);

    // 18. ...and the old password no longer works.
    const oldLogin = await attemptLogin({
      email: tenant.ownerEmail,
      password: OLD_PASSWORD,
    });
    expect(oldLogin.ok).toBe(false);

    // 12. Stored only as an argon2id hash, never plaintext.
    const stored = await storedHashOf(tenant.ownerId);
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(NEW_PASSWORD);
    expect(stored!.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(NEW_PASSWORD, stored!)).toBe(true);

    // 19. The acting SUPER_ADMIN keeps its own session.
    const stillAdmin = await getCurrentUser();
    expect(stillAdmin?.id).toBe(admin.userId);
    expect(stillAdmin?.role).toBe("SUPER_ADMIN");
  });

  it("resolves the owner from Restaurant.ownerId, not from anything the client sends", async () => {
    await superAdminActor();
    const tenant = await seedUserWithRestaurant("OWNER", "Tandoor Nights");
    const bystander = await seedUserWithRestaurant("OWNER", "Unrelated Diner");

    // 10. A client-supplied userId is simply not part of the contract: the
    // action signature takes only a restaurantId, and the bystander's field is
    // ignored rather than honoured.
    await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        userId: bystander.ownerId,
      })
    );

    // 9. The intended owner was resolved server-side and updated.
    expect(await verifyPassword(NEW_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(true);
    // The bystander is untouched.
    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(bystander.ownerId))!)).toBe(
      true
    );
  });

  it("does not let a client update any field other than the password", async () => {
    await superAdminActor();
    const tenant = await seedUserWithRestaurant("OWNER", "Pizza Palace");
    const before = await UserModel.findById(tenant.ownerId).lean();

    await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        // Mass-assignment attempts, in the shapes an attacker would try.
        role: "SUPER_ADMIN",
        email: "attacker@restopos.test",
        isActive: "false",
        restaurantId: "000000000000000000000000",
        passwordHash: "injected-hash",
        $set: JSON.stringify({ role: "SUPER_ADMIN" }),
      })
    );

    const after = await UserModel.findById(tenant.ownerId).lean();
    expect(after?.role).toBe("OWNER");
    expect(after?.email).toBe(before?.email);
    expect(after?.isActive).toBe(true);
    expect(String(after?.restaurantId)).toBe(tenant.restaurantId);
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });
});

/* ------------------------------------------------------------------ */
/* 2-6. Only SUPER_ADMIN may execute the reset                        */
/* ------------------------------------------------------------------ */

describe("owner password reset: authorization", () => {
  const TENANT_ROLES_UNDER_TEST: UserRole[] = ["OWNER", "MANAGER", "CASHIER", "WAITER"];

  it.each(TENANT_ROLES_UNDER_TEST)(
    "refuses a %s session at the server action",
    async (role) => {
      const tenant = await seedUserWithRestaurant("OWNER", `${role} Tenant`);
      currentToken = await sessionTokenFor(tenant.ownerId, role);

      await expect(
        resetOwnerPasswordAction(
          tenant.restaurantId,
          form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
        )
      ).rejects.toThrow("redirect:/dashboard");

      // Nothing was written.
      expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(
        true
      );
    }
  );

  it("refuses an unauthenticated caller", async () => {
    const tenant = await seedUserWithRestaurant("OWNER", "Anon Tenant");
    currentToken = null;

    await expect(
      resetOwnerPasswordAction(
        tenant.restaurantId,
        form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      )
    ).rejects.toThrow("redirect:/login");

    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(
      true
    );
  });

  it("refuses a tampered/forged session cookie", async () => {
    const tenant = await seedUserWithRestaurant("OWNER", "Forged Tenant");
    currentToken = "eyJhbGciOiJIUzI1NiJ9.forged.signature";

    // A present-but-unverifiable cookie is torn down through the signout route
    // (the guard's existing behaviour) rather than the plain /login redirect.
    await expect(
      resetOwnerPasswordAction(
        tenant.restaurantId,
        form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      )
    ).rejects.toThrow("redirect:/api/auth/signout?error=session_expired");

    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(
      true
    );
  });

  it("refuses a session whose role claim was tampered with after signing", async () => {
    const tenant = await seedUserWithRestaurant("OWNER", "Escalation Tenant");
    // A real, correctly-signed JWT for the owner — but one minted carrying a
    // SUPER_ADMIN role claim. The guard re-reads the role from the database and
    // the reset is still refused.
    currentToken = await encryptSession({
      userId: tenant.ownerId,
      restaurantId: tenant.restaurantId,
      role: "SUPER_ADMIN",
      tokenVersion: 0,
    });

    await expect(
      resetOwnerPasswordAction(
        tenant.restaurantId,
        form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      )
    ).rejects.toThrow("redirect:/dashboard");

    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(
      true
    );
  });

  it("refuses a session whose tokenVersion claim predates a revocation", async () => {
    const tenant = await seedUserWithRestaurant("OWNER", "Revoked Token Tenant");
    const staleToken = await encryptSession({
      userId: tenant.ownerId,
      restaurantId: tenant.restaurantId,
      role: "OWNER",
      tokenVersion: 0,
    });
    // Simulate a prior credential change having bumped the counter.
    await UserModel.updateOne({ _id: tenant.ownerId }, { $inc: { tokenVersion: 1 } });
    currentToken = staleToken;

    await expect(
      resetOwnerPasswordAction(
        tenant.restaurantId,
        form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      )
    ).rejects.toThrow("redirect:/api/auth/signout?error=session_expired");
  });

  it("refuses every tenant role at the service layer, independent of the action", async () => {
    const tenant = await seedUserWithRestaurant("OWNER", "Direct Service Tenant");

    const forbiddenActors: (UserRole | null)[] = [
      "OWNER",
      "MANAGER",
      "CASHIER",
      "WAITER",
      null,
    ];
    for (const role of forbiddenActors) {
      await expect(
        resetRestaurantOwnerPassword(tenant.restaurantId, NEW_PASSWORD, {
          actorId: tenant.ownerId,
          role,
        })
      ).rejects.toThrow(AdminForbiddenError);
    }

    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(
      true
    );
  });

  it("keeps requireSuperAdmin as the single gate the action uses", async () => {
    const tenant = await seedUserWithRestaurant("OWNER", "Guard Tenant");
    currentToken = await sessionTokenFor(tenant.ownerId, "MANAGER");
    await expect(requireSuperAdmin()).rejects.toThrow("redirect:/dashboard");

    const admin = await seedSuperAdmin();
    currentToken = await sessionTokenFor(admin.userId, "SUPER_ADMIN");
    await expect(requireSuperAdmin()).resolves.toMatchObject({ role: "SUPER_ADMIN" });
  });
});

/* ------------------------------------------------------------------ */
/* 7-8, 11. Target resolution refuses the wrong account                */
/* ------------------------------------------------------------------ */

describe("owner password reset: target resolution", () => {
  it("rejects a syntactically invalid restaurantId", async () => {
    await superAdminActor();
    await expect(
      resetOwnerPasswordAction(
        "not-an-object-id",
        form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      )
    ).resolves.toMatchObject({ success: false, message: "Restaurant not found." });
  });

  it("rejects a well-formed but unknown restaurantId", async () => {
    await superAdminActor();
    const missingId = new mongoose.Types.ObjectId().toString();
    const state = await resetOwnerPasswordAction(
      missingId,
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );
    expect(state).toMatchObject({ success: false, message: "Restaurant not found." });
  });

  it("rejects a restaurant with no ownerId", async () => {
    await superAdminActor();
    // The schema requires ownerId, so this row is written through the raw
    // driver to reproduce the legacy/corrupt state the guard must survive:
    // a restaurant that exists but has nothing to resolve an owner from.
    const raw = await RestaurantModel.collection.insertOne({
      name: "Ownerless Cafe",
      ownerId: null,
      phone: "9876543210",
      address: "1 Food St",
      city: "Mumbai",
      state: "MA",
      pincode: "400001",
      businessType: "Restaurant",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const restaurantId = String(raw.insertedId);

    const state = await resetOwnerPasswordAction(
      restaurantId,
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );
    expect(state).toMatchObject({ success: false, message: "Owner account not found." });
    await expect(
      resetRestaurantOwnerPassword(restaurantId, NEW_PASSWORD, {
        actorId: null,
        role: "SUPER_ADMIN",
      })
    ).rejects.toThrow(OwnerAccountNotFoundError);
  });

  it("rejects a restaurant whose ownerId points at a deleted account", async () => {
    const admin = await superAdminActor();
    const ghostId = new mongoose.Types.ObjectId();
    const restaurant = await RestaurantModel.create({
      name: "Ghost Owner Cafe",
      ownerId: ghostId,
      phone: "9876543210",
      address: "1 Food St",
      city: "Mumbai",
      state: "MA",
      pincode: "400001",
      businessType: "Restaurant",
      isActive: true,
    });

    const state = await resetOwnerPasswordAction(
      String(restaurant._id),
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );
    expect(state).toMatchObject({ success: false, message: "Owner account not found." });
    expect(admin.userId).toBeTruthy();
  });

  it("never resets a SUPER_ADMIN account, even when a restaurant points at one", async () => {
    await superAdminActor();
    const otherAdmin = await seedSuperAdmin();
    const restaurant = await RestaurantModel.create({
      name: "Malicious Link",
      ownerId: otherAdmin.userId,
      phone: "9876543210",
      address: "1 Food St",
      city: "Mumbai",
      state: "MA",
      pincode: "400001",
      businessType: "Restaurant",
      isActive: true,
    });

    const state = await resetOwnerPasswordAction(
      String(restaurant._id),
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );
    expect(state.success).toBe(false);
    expect(state.message).not.toContain(NEW_PASSWORD);

    await expect(
      resetRestaurantOwnerPassword(String(restaurant._id), NEW_PASSWORD, {
        actorId: null,
        role: "SUPER_ADMIN",
      })
    ).rejects.toThrow(OwnerPasswordResetForbiddenError);

    // The platform admin's own credential is intact.
    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(otherAdmin.userId))!)).toBe(
      true
    );
  });

  it("refuses to cross a tenant boundary", async () => {
    await superAdminActor();
    const ownerA = await seedUserWithRestaurant("OWNER", "Tenant A");
    const ownerB = await seedUserWithRestaurant("OWNER", "Tenant B");

    // Point Tenant A's ownerId at Tenant B's owner while B's user row still
    // claims Tenant B — the shape an IDOR attempt or a corrupted link produces.
    // B's restaurant row is removed first only to clear the unique ownerId
    // index; B's owner record itself is left fully intact.
    await RestaurantModel.collection.deleteOne({ _id: new mongoose.Types.ObjectId(ownerB.restaurantId) });
    await RestaurantModel.updateOne(
      { _id: ownerA.restaurantId },
      { $set: { ownerId: ownerB.ownerId } }
    );

    await expect(
      resetRestaurantOwnerPassword(ownerA.restaurantId, NEW_PASSWORD, {
        actorId: null,
        role: "SUPER_ADMIN",
      })
    ).rejects.toThrow(OwnerPasswordResetForbiddenError);

    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(ownerB.ownerId))!)).toBe(
      true
    );
  });

  it("refuses to reset a non-OWNER account reached through ownerId", async () => {
    await superAdminActor();
    const manager = await seedUserWithRestaurant("MANAGER", "Manager Stand-in");
    const state = await resetOwnerPasswordAction(
      manager.restaurantId,
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );
    expect(state.success).toBe(false);
    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(manager.ownerId))!)).toBe(
      true
    );
  });
});

/* ------------------------------------------------------------------ */
/* Password validation                                                  */
/* ------------------------------------------------------------------ */

describe("owner password reset: validation", () => {
  it("applies the established policy: 8+ characters, non-blank, matching confirmation", () => {
    expect(
      resetOwnerPasswordSchema.safeParse({
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      }).success
    ).toBe(true);

    expect(
      resetOwnerPasswordSchema.safeParse({ newPassword: "", confirmPassword: "" }).success
    ).toBe(false);

    expect(
      resetOwnerPasswordSchema.safeParse({
        newPassword: "        ",
        confirmPassword: "        ",
      }).success
    ).toBe(false);

    expect(
      resetOwnerPasswordSchema.safeParse({
        newPassword: "Short12",
        confirmPassword: "Short12",
      }).success
    ).toBe(false);

    const mismatch = resetOwnerPasswordSchema.safeParse({
      newPassword: NEW_PASSWORD,
      confirmPassword: `${NEW_PASSWORD}x`,
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) {
      expect(mismatch.error.issues[0]?.message).toBe("Passwords do not match.");
    }
  });

  it("surfaces a mismatch as a field error and writes nothing", async () => {
    await superAdminActor();
    const tenant = await seedUserWithRestaurant("OWNER", "Mismatch Diner");

    const state = await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({ newPassword: NEW_PASSWORD, confirmPassword: "DifferentPass1" })
    );
    expect(state.success).toBeFalsy();
    expect(state._errors?.confirmPassword).toContain("Passwords do not match.");
    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(
      true
    );
  });

  it("surfaces a too-short password as a field error and writes nothing", async () => {
    await superAdminActor();
    const tenant = await seedUserWithRestaurant("OWNER", "Short Diner");

    const state = await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({ newPassword: "abc", confirmPassword: "abc" })
    );
    expect(state._errors?.newPassword).toContain("Password must be at least 8 characters.");
    expect(await verifyPassword(OLD_PASSWORD, (await storedHashOf(tenant.ownerId))!)).toBe(
      true
    );
  });
});

/* ------------------------------------------------------------------ */
/* 16. Session invalidation                                             */
/* ------------------------------------------------------------------ */

describe("owner password reset: session invalidation", () => {
  it("kills the owner's existing sessions and leaves the SUPER_ADMIN session valid", async () => {
    const admin = await seedSuperAdmin();
    const adminToken = await sessionTokenFor(admin.userId, "SUPER_ADMIN");
    const tenant = await seedUserWithRestaurant("OWNER", "Session Diner");
    const ownerToken = await sessionTokenFor(tenant.ownerId, "OWNER");

    // Before the reset, both sessions authenticate.
    currentToken = ownerToken;
    expect((await getCurrentUser())?.id).toBe(tenant.ownerId);
    currentToken = adminToken;
    expect((await getCurrentUser())?.id).toBe(admin.userId);

    currentToken = adminToken;
    await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );

    // The owner's pre-reset token no longer authenticates...
    currentToken = ownerToken;
    expect(await getCurrentUser()).toBeNull();
    // ...but the SUPER_ADMIN session is untouched.
    currentToken = adminToken;
    expect((await getCurrentUser())?.id).toBe(admin.userId);

    // A fresh login with the new password produces a working session.
    const login = await attemptLogin({ email: tenant.ownerEmail, password: NEW_PASSWORD });
    expect(login.ok).toBe(true);
    if (login.ok) {
      const fresh = await encryptSession({
        userId: login.userId,
        restaurantId: login.restaurantId,
        role: login.role,
        tokenVersion: login.tokenVersion,
      });
      currentToken = fresh;
      expect((await getCurrentUser())?.id).toBe(tenant.ownerId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 13-15. Response safety and audit trail                              */
/* ------------------------------------------------------------------ */

describe("owner password reset: response safety and audit", () => {
  it("never returns password or hash material to the client", async () => {
    await superAdminActor();
    const tenant = await seedUserWithRestaurant("OWNER", "Leaky Diner");
    const state = await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
    );
    const hash = (await storedHashOf(tenant.ownerId))!;
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(hash);
    expect(serialized).not.toContain("$argon2");
    // 13. And the audit-shaped metadata never leaks it either.
    expect(state.message).toBe("Owner password reset successfully.");
  });

  it("writes a platform audit record with actor, target and no secret material", async () => {
    const admin = await superAdminActor();
    const tenant = await seedUserWithRestaurant("OWNER", "Audited Diner");

    await resetOwnerPasswordAction(
      tenant.restaurantId,
      form({
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        reason: "Owner reported lockout",
      })
    );

    const entry = await TableAuditLogModel.findOne({
      action: "RESTAURANT_OWNER_PASSWORD_RESET",
    }).lean();
    expect(entry).toBeTruthy();
    expect(String(entry?.userId)).toBe(admin.userId);
    expect(entry?.actorRole).toBe("SUPER_ADMIN");
    expect(String(entry?.restaurantId)).toBe(tenant.restaurantId);
    expect(String(entry?.entityId)).toBe(tenant.ownerId);
    expect(entry?.entityType).toBe("USER");
    expect(entry?.reason).toBe("Owner reported lockout");

    const hash = (await storedHashOf(tenant.ownerId))!;
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain(hash);
    expect(serialized).not.toContain("$argon2");
  });

  it("leaves existing auth behavior unchanged", async () => {
    const admin = await seedSuperAdmin();
    const tenant = await seedUserWithRestaurant("OWNER", "Regression Diner");

    // An unreset owner's session still works, and login still round-trips.
    currentToken = await sessionTokenFor(tenant.ownerId, "OWNER");
    expect((await getCurrentUser())?.id).toBe(tenant.ownerId);

    const ok = await attemptLogin({ email: tenant.ownerEmail, password: OLD_PASSWORD });
    expect(ok.ok).toBe(true);

    const bad = await attemptLogin({ email: tenant.ownerEmail, password: "wrong-pass" });
    expect(bad.ok).toBe(false);

    // Super admin sessions minted before any reset are unaffected.
    currentToken = await sessionTokenFor(admin.userId, "SUPER_ADMIN");
    expect((await getCurrentUser())?.id).toBe(admin.userId);

    // Deactivated accounts are still rejected by the guard path.
    await UserModel.updateOne({ _id: tenant.ownerId }, { $set: { isActive: false } });
    currentToken = await sessionTokenFor(tenant.ownerId, "OWNER");
    expect(await getCurrentUser()).toBeTruthy();
  });
});