import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@db";
import {
  auditLogs,
  enumValues,
  financeEntries,
  monthlySales,
  users,
  type MonthlySale,
} from "@db/schema";

export type FinanceEntryRow = {
  id: string;
  entryTypeId: string;
  typeCode: string;
  typeLabel: string;
  typeColor: string | null;
  category: string | null;
  description: string;
  amount: number;
  currency: string;
  competenceDate: string;
  isVariable: boolean;
  recurring: boolean;
  recurrencePeriod: "monthly" | "quarterly" | "annual" | null;
  recurrenceEnd: string | null;
  parentEntryId: string | null;
  costCenter: string | null;
  supplier: string | null;
  receiptUrl: string | null;
};

/** Live entries of a product; soft-deleted rows stay out of every total. */
export async function listFinanceEntries(productId: string): Promise<FinanceEntryRow[]> {
  const rows = await db
    .select({
      id: financeEntries.id,
      entryTypeId: financeEntries.entryTypeId,
      typeCode: enumValues.code,
      typeLabel: enumValues.label,
      typeColor: enumValues.color,
      category: financeEntries.category,
      description: financeEntries.description,
      amount: financeEntries.amount,
      currency: financeEntries.currency,
      competenceDate: financeEntries.competenceDate,
      isVariable: financeEntries.isVariable,
      recurring: financeEntries.recurring,
      recurrencePeriod: financeEntries.recurrencePeriod,
      recurrenceEnd: financeEntries.recurrenceEnd,
      parentEntryId: financeEntries.parentEntryId,
      costCenter: financeEntries.costCenter,
      supplier: financeEntries.supplier,
      receiptUrl: financeEntries.receiptUrl,
    })
    .from(financeEntries)
    .innerJoin(enumValues, eq(enumValues.id, financeEntries.entryTypeId))
    .where(and(eq(financeEntries.productId, productId), isNull(financeEntries.deletedAt)))
    .orderBy(desc(financeEntries.competenceDate), asc(financeEntries.description));

  return rows.map((row) => ({
    ...row,
    typeCode: row.typeCode ?? "other",
    typeLabel: row.typeLabel ?? "—",
  }));
}

export async function listFinanceEntriesFor(productIds: string[]) {
  if (productIds.length === 0) return [];
  return db
    .select({
      productId: financeEntries.productId,
      amount: financeEntries.amount,
      competenceDate: financeEntries.competenceDate,
      isVariable: financeEntries.isVariable,
      typeCode: enumValues.code,
    })
    .from(financeEntries)
    .innerJoin(enumValues, eq(enumValues.id, financeEntries.entryTypeId))
    .where(and(inArray(financeEntries.productId, productIds), isNull(financeEntries.deletedAt)));
}

export async function listMonthlySales(productId: string): Promise<MonthlySale[]> {
  return db
    .select()
    .from(monthlySales)
    .where(eq(monthlySales.productId, productId))
    .orderBy(asc(monthlySales.competence));
}

export async function listMonthlySalesFor(productIds: string[]) {
  if (productIds.length === 0) return [];
  return db
    .select()
    .from(monthlySales)
    .where(inArray(monthlySales.productId, productIds))
    .orderBy(asc(monthlySales.competence));
}

export type AuditRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  actorName: string | null;
};

/** The product's audit trail, newest first. Read-only by construction. */
export async function listAuditTrail(productId: string, limit = 300): Promise<AuditRow[]> {
  return db
    .select({
      id: auditLogs.id,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      action: auditLogs.action,
      field: auditLogs.field,
      oldValue: auditLogs.oldValue,
      newValue: auditLogs.newValue,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(eq(auditLogs.productId, productId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
