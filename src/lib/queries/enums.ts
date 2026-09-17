import { and, asc, eq } from "drizzle-orm";
import { db } from "@db";
import { enumValues, type EnumKind, type EnumValue } from "@db/schema";

/** All active values of a domain, in the order the user arranged them. */
export async function listEnumValues(kind: EnumKind, includeInactive = false) {
  return db
    .select()
    .from(enumValues)
    .where(
      includeInactive ? eq(enumValues.kind, kind) : and(eq(enumValues.kind, kind), eq(enumValues.active, true)),
    )
    .orderBy(asc(enumValues.sortOrder), asc(enumValues.label));
}

export async function listAllEnumValues(includeInactive = false) {
  const rows = await db
    .select()
    .from(enumValues)
    .where(includeInactive ? undefined : eq(enumValues.active, true))
    .orderBy(asc(enumValues.kind), asc(enumValues.sortOrder), asc(enumValues.label));

  const byKind = new Map<EnumKind, EnumValue[]>();
  for (const row of rows) {
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  }
  return byKind;
}

/** The kanban column that means "done" — it is what completes a task. */
export function findDoneColumn(columns: EnumValue[]): EnumValue | undefined {
  return (
    columns.find((column) => (column.meta as { isDone?: boolean } | null)?.isDone) ??
    columns.find((column) => column.code === "done")
  );
}

export function enumLabel(values: EnumValue[], id: string | null | undefined): string {
  if (!id) return "—";
  return values.find((value) => value.id === id)?.label ?? "—";
}
