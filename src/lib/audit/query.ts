import { z } from "zod";
import type { AuditLogFilters } from "./audit-service";

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

export const auditQuerySchema = z.object({
  fromYmd: z.string().regex(ymdRegex, "Invalid start date.").nullish(),
  toYmd: z.string().regex(ymdRegex, "Invalid end date.").nullish(),
  actorUserId: z.string().min(1).nullish(),
  action: z.string().min(1).max(60).nullish(),
  resourceType: z.string().min(1).max(40).nullish(),
  success: z.enum(["true", "false"]).nullish(),
  search: z.string().trim().max(120).nullish(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export function toAuditFilters(input: unknown): AuditLogFilters | null {
  const parsed = auditQuerySchema.safeParse(input ?? {});
  if (!parsed.success) return null;
  return {
    fromYmd: parsed.data.fromYmd ?? null,
    toYmd: parsed.data.toYmd ?? null,
    actorUserId: parsed.data.actorUserId ?? null,
    action: (parsed.data.action as AuditLogFilters["action"]) ?? null,
    resourceType: (parsed.data.resourceType as AuditLogFilters["resourceType"]) ?? null,
    success:
      parsed.data.success === "true"
        ? true
        : parsed.data.success === "false"
          ? false
          : null,
    search: parsed.data.search || null,
  };
}