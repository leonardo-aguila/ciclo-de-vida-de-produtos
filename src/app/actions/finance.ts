"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { financeEntries, monthlySales } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canWriteFinance } from "@/lib/auth/policy";
import { instalmentDates } from "@/lib/engine/finance";
import { getProductRef } from "@/lib/queries/products";
import {
  createEntrySchema,
  deleteEntrySchema,
  deleteSaleSchema,
  importSalesSchema,
  saleSchema,
  updateEntrySchema,
} from "@/lib/schemas/finance";

async function requireFinanceWriter(productId: string) {
  const actor = await requireUserOrThrow();
  const product = await getProductRef(productId);
  if (!product) return { ok: false as const, error: fail("Produto não encontrado.") };
  authorize(
    canWriteFinance(actor, product),
    "Você só lança no financeiro de produtos de que é responsável.",
  );
  return { ok: true as const, actor, product };
}

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

export async function createEntryAction(
  _prev: ActionResult<{ created: number } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ created: number } | null>> {
  try {
    const parsed = parseForm(createEntrySchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const guard = await requireFinanceWriter(input.productId);
    if (!guard.ok) return guard.error;

    const [parent] = await db
      .insert(financeEntries)
      .values({
        productId: input.productId,
        entryTypeId: input.entryTypeId,
        category: input.category,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        competenceDate: input.competenceDate,
        isVariable: input.isVariable,
        recurring: input.recurring,
        recurrencePeriod: input.recurrencePeriod,
        recurrenceEnd: input.recurrenceEnd,
        costCenter: input.costCenter,
        supplier: input.supplier,
        receiptUrl: input.receiptUrl,
        createdBy: guard.actor.id,
      })
      .returning({ id: financeEntries.id });

    let created = 1;
    if (input.recurring && input.recurrencePeriod && input.recurrenceEnd) {
      const dates = instalmentDates(
        input.competenceDate,
        input.recurrencePeriod,
        input.recurrenceEnd,
      );
      if (dates.length > 0) {
        await db.insert(financeEntries).values(
          dates.map((competenceDate) => ({
            productId: input.productId,
            entryTypeId: input.entryTypeId,
            category: input.category,
            description: input.description,
            amount: input.amount,
            currency: input.currency,
            competenceDate,
            isVariable: input.isVariable,
            // Instalments are not themselves recurring; the parent is.
            recurring: false,
            parentEntryId: parent!.id,
            costCenter: input.costCenter,
            supplier: input.supplier,
            receiptUrl: input.receiptUrl,
            createdBy: guard.actor.id,
          })),
        );
        created += dates.length;
      }
    }

    await writeAudit({
      entityType: "finance_entry",
      entityId: parent!.id,
      productId: input.productId,
      action: "create",
      actorId: guard.actor.id,
      changes: [
        { field: "description", to: input.description },
        { field: "amount", to: input.amount },
        { field: "competenceDate", to: input.competenceDate },
        ...(created > 1 ? [{ field: "recurrence", to: `${created} parcelas geradas` }] : []),
      ],
    });

    revalidatePath(`/produtos/${input.productId}/financeiro`);
    return ok(
      { created },
      created > 1 ? `Lançamento criado com ${created} parcelas.` : "Lançamento criado.",
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateEntryAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(updateEntrySchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const [current] = await db
      .select()
      .from(financeEntries)
      .where(eq(financeEntries.id, input.id))
      .limit(1);
    if (!current || current.deletedAt) return fail("Lançamento não encontrado.");

    const guard = await requireFinanceWriter(current.productId);
    if (!guard.ok) return guard.error;

    await db
      .update(financeEntries)
      .set({
        entryTypeId: input.entryTypeId,
        category: input.category,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        competenceDate: input.competenceDate,
        isVariable: input.isVariable,
        costCenter: input.costCenter,
        supplier: input.supplier,
        receiptUrl: input.receiptUrl,
        updatedAt: new Date(),
      })
      .where(eq(financeEntries.id, input.id));

    // Editing the parent of a recurrence can rewrite its instalments, but only
    // when the user asked for it — silently rewriting months is worse.
    let affected = 1;
    if (input.applyToSeries && current.recurring) {
      const updated = await db
        .update(financeEntries)
        .set({
          entryTypeId: input.entryTypeId,
          category: input.category,
          description: input.description,
          amount: input.amount,
          isVariable: input.isVariable,
          costCenter: input.costCenter,
          supplier: input.supplier,
          updatedAt: new Date(),
        })
        .where(
          and(eq(financeEntries.parentEntryId, input.id), isNull(financeEntries.deletedAt)),
        )
        .returning({ id: financeEntries.id });
      affected += updated.length;
    }

    await writeAudit({
      entityType: "finance_entry",
      entityId: input.id,
      productId: current.productId,
      action: "update",
      actorId: guard.actor.id,
      changes: [
        { field: "description", from: current.description, to: input.description },
        { field: "amount", from: current.amount, to: input.amount },
        { field: "competenceDate", from: current.competenceDate, to: input.competenceDate },
        { field: "category", from: current.category, to: input.category },
        { field: "supplier", from: current.supplier, to: input.supplier },
        { field: "costCenter", from: current.costCenter, to: input.costCenter },
        { field: "isVariable", from: String(current.isVariable), to: String(input.isVariable) },
      ],
    });

    revalidatePath(`/produtos/${current.productId}/financeiro`);
    return ok(
      null,
      affected > 1 ? `Lançamento e ${affected - 1} parcelas atualizados.` : "Lançamento atualizado.",
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteEntryAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(deleteEntrySchema, formData);
    if (!parsed.ok) return parsed.result;

    const [current] = await db
      .select()
      .from(financeEntries)
      .where(eq(financeEntries.id, parsed.data.id))
      .limit(1);
    if (!current || current.deletedAt) return fail("Lançamento não encontrado.");

    const guard = await requireFinanceWriter(current.productId);
    if (!guard.ok) return guard.error;

    const now = new Date();
    // Soft delete: the audit trail must keep pointing at a row that exists.
    await db
      .update(financeEntries)
      .set({ deletedAt: now })
      .where(eq(financeEntries.id, current.id));

    let removed = 1;
    if (parsed.data.deleteSeries && current.recurring) {
      const children = await db
        .update(financeEntries)
        .set({ deletedAt: now })
        .where(
          and(eq(financeEntries.parentEntryId, current.id), isNull(financeEntries.deletedAt)),
        )
        .returning({ id: financeEntries.id });
      removed += children.length;
    }

    await writeAudit({
      entityType: "finance_entry",
      entityId: current.id,
      productId: current.productId,
      action: "delete",
      actorId: guard.actor.id,
      changes: [
        { field: "description", from: current.description, to: null },
        { field: "amount", from: current.amount, to: null },
        ...(removed > 1 ? [{ field: "series", to: `${removed} lançamentos excluídos` }] : []),
      ],
    });

    revalidatePath(`/produtos/${current.productId}/financeiro`);
    return ok(
      null,
      removed > 1 ? `Lançamento e ${removed - 1} parcelas excluídos.` : "Lançamento excluído.",
    );
  } catch (error) {
    return toActionError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Monthly sales                                                              */
/* -------------------------------------------------------------------------- */

export async function saveSaleAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(saleSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const guard = await requireFinanceWriter(input.productId);
    if (!guard.ok) return guard.error;

    const [existing] = await db
      .select()
      .from(monthlySales)
      .where(
        and(
          eq(monthlySales.productId, input.productId),
          eq(monthlySales.competence, input.competence),
        ),
      )
      .limit(1);

    const values = {
      newMrr: input.newMrr,
      recurringRevenue: input.recurringRevenue,
      oneTimeRevenue: input.oneTimeRevenue,
      churnAmount: input.churnAmount,
      churnRate: input.churnRate,
      newCustomers: input.newCustomers,
      activeCustomers: input.activeCustomers,
      churnedCustomers: input.churnedCustomers,
      avgTicket: input.avgTicket,
      source: "manual" as const,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(monthlySales).set(values).where(eq(monthlySales.id, existing.id));
      await writeAudit({
        entityType: "monthly_sale",
        entityId: existing.id,
        productId: input.productId,
        action: "update",
        actorId: guard.actor.id,
        changes: [
          { field: "recurringRevenue", from: existing.recurringRevenue, to: input.recurringRevenue },
          { field: "oneTimeRevenue", from: existing.oneTimeRevenue, to: input.oneTimeRevenue },
          { field: "churnAmount", from: existing.churnAmount, to: input.churnAmount },
          { field: "activeCustomers", from: existing.activeCustomers, to: input.activeCustomers },
        ],
      });
    } else {
      const [created] = await db
        .insert(monthlySales)
        .values({ productId: input.productId, competence: input.competence, ...values })
        .returning({ id: monthlySales.id });
      await writeAudit({
        entityType: "monthly_sale",
        entityId: created!.id,
        productId: input.productId,
        action: "create",
        actorId: guard.actor.id,
        changes: [
          { field: "competence", to: input.competence },
          { field: "recurringRevenue", to: input.recurringRevenue },
        ],
      });
    }

    revalidatePath(`/produtos/${input.productId}/financeiro`);
    revalidatePath(`/produtos/${input.productId}/visao-geral`);
    return ok(null, "Venda mensal salva.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteSaleAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(deleteSaleSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [current] = await db
      .select()
      .from(monthlySales)
      .where(eq(monthlySales.id, parsed.data.id))
      .limit(1);
    if (!current) return fail("Registro não encontrado.");

    const guard = await requireFinanceWriter(current.productId);
    if (!guard.ok) return guard.error;

    await writeAudit({
      entityType: "monthly_sale",
      entityId: current.id,
      productId: current.productId,
      action: "delete",
      actorId: guard.actor.id,
      changes: [{ field: "competence", from: current.competence, to: null }],
    });

    await db.delete(monthlySales).where(eq(monthlySales.id, current.id));

    revalidatePath(`/produtos/${current.productId}/financeiro`);
    return ok(null, "Competência excluída.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function importSalesAction(
  _prev: ActionResult<{ inserted: number; updated: number } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ inserted: number; updated: number } | null>> {
  try {
    const parsed = parseForm(importSalesSchema, formData);
    if (!parsed.ok) return parsed.result;
    const { productId, rows } = parsed.data;

    const guard = await requireFinanceWriter(productId);
    if (!guard.ok) return guard.error;
    if (rows.length === 0) return fail("Nenhuma linha válida para importar.");

    const existing = await db
      .select({ competence: monthlySales.competence })
      .from(monthlySales)
      .where(eq(monthlySales.productId, productId));
    const known = new Set(existing.map((row) => row.competence));

    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      if (known.has(row.competence)) updated += 1;
      else inserted += 1;
    }

    // One statement: an import that fails halfway must not leave half a year in.
    await db
      .insert(monthlySales)
      .values(
        rows.map((row) => ({
          productId,
          competence: row.competence,
          newMrr: row.newMrr,
          recurringRevenue: row.recurringRevenue,
          oneTimeRevenue: row.oneTimeRevenue,
          churnAmount: row.churnAmount,
          churnRate: row.churnRate,
          newCustomers: row.newCustomers,
          activeCustomers: row.activeCustomers,
          churnedCustomers: row.churnedCustomers,
          avgTicket: row.avgTicket,
          source: "csv" as const,
        })),
      )
      .onConflictDoUpdate({
        target: [monthlySales.productId, monthlySales.competence],
        set: {
          newMrr: sql`excluded.new_mrr`,
          recurringRevenue: sql`excluded.recurring_revenue`,
          oneTimeRevenue: sql`excluded.one_time_revenue`,
          churnAmount: sql`excluded.churn_amount`,
          churnRate: sql`excluded.churn_rate`,
          newCustomers: sql`excluded.new_customers`,
          activeCustomers: sql`excluded.active_customers`,
          churnedCustomers: sql`excluded.churned_customers`,
          avgTicket: sql`excluded.avg_ticket`,
          source: sql`'csv'`,
          updatedAt: new Date(),
        },
      });

    await writeAudit({
      entityType: "monthly_sale",
      entityId: productId,
      productId,
      action: "update",
      actorId: guard.actor.id,
      changes: [
        { field: "import", to: `CSV: ${inserted} incluídas, ${updated} atualizadas` },
      ],
    });

    revalidatePath(`/produtos/${productId}/financeiro`);
    revalidatePath(`/produtos/${productId}/visao-geral`);
    return ok(
      { inserted, updated },
      `Importação concluída: ${inserted} ${inserted === 1 ? "competência incluída" : "competências incluídas"} e ${updated} ${updated === 1 ? "atualizada" : "atualizadas"}.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}
