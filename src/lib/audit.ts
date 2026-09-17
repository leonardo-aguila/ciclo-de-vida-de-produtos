/**
 * Audit trail writer.
 *
 * One row per changed field — who, when, which field, old value, new value.
 * Append-only: the application role has no UPDATE or DELETE grant on the table
 * (scripts/grant-app.sql), so this module is the only way anything gets in.
 */
import { db } from "@db";
import { auditLogs } from "@db/schema";

export type AuditChange = {
  field: string;
  from?: string | number | boolean | null;
  to?: string | number | boolean | null;
};

export type AuditInput = {
  entityType: string;
  entityId: string;
  /** Lets the product's audit tab show everything that happened to it. */
  productId?: string | null;
  action: "create" | "update" | "delete";
  actorId?: string | null;
  changes?: AuditChange[];
};

function normalize(value: AuditChange["from"]): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

type AuditRow = typeof auditLogs.$inferInsert;

export async function writeAudit(input: AuditInput): Promise<void> {
  const rows: AuditRow[] = (input.changes ?? [])
    // An "update" that changed nothing is noise in the log, not history.
    .filter((change) => input.action !== "update" || normalize(change.from) !== normalize(change.to))
    .map((change) => ({
      entityType: input.entityType,
      entityId: input.entityId,
      productId: input.productId ?? null,
      action: input.action,
      field: change.field,
      oldValue: normalize(change.from),
      newValue: normalize(change.to),
      actorId: input.actorId ?? null,
    }));

  // A create or delete with no field list still deserves a row: it is the fact
  // that the record appeared or disappeared that matters.
  if (rows.length === 0) {
    if (input.action === "update") return;
    rows.push({
      entityType: input.entityType,
      entityId: input.entityId,
      productId: input.productId ?? null,
      action: input.action,
      field: null,
      oldValue: null,
      newValue: null,
      actorId: input.actorId ?? null,
    });
  }

  await db.insert(auditLogs).values(rows);
}

/** Builds the change list by diffing two versions of the same record. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T & string)[],
): AuditChange[] {
  return fields
    .filter((field) => field in after)
    .map((field) => ({
      field,
      from: before[field] as AuditChange["from"],
      to: after[field] as AuditChange["to"],
    }));
}
