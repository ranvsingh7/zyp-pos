"use server";

import { requireAuth, requireRestaurant } from "@/lib/auth/guards";
import { assertCanViewAuditLogs } from "@/lib/audit/permissions";
import { listAuditLogs, type AuditLogView } from "@/lib/audit/audit-service";
import { auditQuerySchema, toAuditFilters } from "@/lib/audit/query";

export interface AuditListResult {
  success: boolean;
  message?: string;
  data?: {
    rows: AuditLogView[];
    total: number;
    page: number;
    pageSize: number;
  };
}

/**
 * Tenant-scoped audit query for the viewer. The restaurant is always derived
 * from the authenticated session — a client can never read another tenant's
 * logs by spoofing an id.
 */
export async function listAuditLogsAction(input: unknown): Promise<AuditListResult> {
  const user = await requireAuth();
  const restaurant = await requireRestaurant();
  try {
    assertCanViewAuditLogs(user.role);
  } catch {
    return { success: false, message: "You do not have permission to view audit logs." };
  }

  const filters = toAuditFilters(input);
  if (!filters) {
    return { success: false, message: "Invalid audit query." };
  }
  const parsed = auditQuerySchema.safeParse(input ?? {});
  const result = await listAuditLogs(String(restaurant.id), filters, {
    page: parsed.success ? parsed.data.page : 1,
    pageSize: 25,
  });
  return { success: true, data: result };
}