"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { actionPlans, businessPlanMonths, businessPlans, milestones } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canWriteBusinessPlan } from "@/lib/auth/policy";
import { getProductRef } from "@/lib/queries/products";
import {
  actionPlanSchema,
  deleteActionPlanSchema,
  deleteMilestoneSchema,
  importPlanSchema,
  milestoneSchema,
  newVersionSchema,
  planMonthsSchema,
  planSchema,
} from "@/lib/schemas/business-plan";

async function requirePlanWriter(productId: string) {
  const actor = await requireUserOrThrow();
  const product = await getProductRef(productId);
  if (!product) return { ok: false as const, error: fail("Produto não encontrado.") };
  authorize(
    canWriteBusinessPlan(actor, product),
    "Você só edita o Business Plan de produtos de que é responsável.",
  );
  return { ok: true as const, actor, product };
}

/** Resolves the product a plan belongs to, then checks permission. */
async function requirePlanWriterByPlan(planId: string) {
  const [plan] = await db.select().from(businessPlans).where(eq(businessPlans.id, planId)).limit(1);
  if (!plan) return { ok: false as const, error: fail("Business Plan não encontrado.") };
  const guard = await requirePlanWriter(plan.productId);
  if (!guard.ok) return guard;
  return { ok: true as const, actor: guard.actor, plan };
}

export async function savePlanAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const parsed = parseForm(planSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const guard = await requirePlanWriter(input.productId);
    if (!guard.ok) return guard.error;

    if (input.id) {
      await db
        .update(businessPlans)
        .set({
          approvedAt: input.approvedAt,
          assumptions: input.assumptions,
          horizonMonths: input.horizonMonths,
          status: input.status,
          updatedAt: new Date(),
        })
        .where(eq(businessPlans.id, input.id));

      // Only one plan can be the active one, or "plano vigente" means nothing.
      if (input.status === "active") {
        await db
          .update(businessPlans)
          .set({ status: "superseded" })
          .where(
            and(
              eq(businessPlans.productId, input.productId),
              ne(businessPlans.id, input.id),
              eq(businessPlans.status, "active"),
            ),
          );
      }

      await writeAudit({
        entityType: "business_plan",
        entityId: input.id,
        productId: input.productId,
        action: "update",
        actorId: guard.actor.id,
        changes: [
          { field: "horizonMonths", to: input.horizonMonths },
          { field: "status", to: input.status },
        ],
      });

      revalidatePath(`/produtos/${input.productId}/business-plan`);
      return ok({ id: input.id }, "Business Plan atualizado.");
    }

    const [maxVersion] = await db
      .select({ max: sql<number>`coalesce(max(${businessPlans.version}), 0)::int` })
      .from(businessPlans)
      .where(eq(businessPlans.productId, input.productId));

    const [created] = await db
      .insert(businessPlans)
      .values({
        productId: input.productId,
        version: (maxVersion?.max ?? 0) + 1,
        approvedAt: input.approvedAt,
        assumptions: input.assumptions,
        horizonMonths: input.horizonMonths,
        status: input.status,
        authorId: guard.actor.id,
      })
      .returning({ id: businessPlans.id });

    if (input.status === "active") {
      await db
        .update(businessPlans)
        .set({ status: "superseded" })
        .where(
          and(
            eq(businessPlans.productId, input.productId),
            ne(businessPlans.id, created!.id),
            eq(businessPlans.status, "active"),
          ),
        );
    }

    await writeAudit({
      entityType: "business_plan",
      entityId: created!.id,
      productId: input.productId,
      action: "create",
      actorId: guard.actor.id,
      changes: [{ field: "version", to: (maxVersion?.max ?? 0) + 1 }],
    });

    revalidatePath(`/produtos/${input.productId}/business-plan`);
    return ok({ id: created!.id }, "Business Plan criado.");
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * New version: the previous one is preserved and marked superseded, so the
 * comparison between versions stays available.
 */
export async function createVersionAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const parsed = parseForm(newVersionSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const guard = await requirePlanWriter(input.productId);
    if (!guard.ok) return guard.error;

    const [source] = await db
      .select()
      .from(businessPlans)
      .where(eq(businessPlans.id, input.fromPlanId))
      .limit(1);
    if (!source) return fail("Versão de origem não encontrada.");

    const [maxVersion] = await db
      .select({ max: sql<number>`coalesce(max(${businessPlans.version}), 0)::int` })
      .from(businessPlans)
      .where(eq(businessPlans.productId, input.productId));

    const [created] = await db
      .insert(businessPlans)
      .values({
        productId: input.productId,
        version: (maxVersion?.max ?? 0) + 1,
        assumptions: source.assumptions,
        horizonMonths: source.horizonMonths,
        status: "active",
        authorId: guard.actor.id,
      })
      .returning({ id: businessPlans.id });

    if (input.copyContent) {
      const months = await db
        .select()
        .from(businessPlanMonths)
        .where(eq(businessPlanMonths.planId, source.id));

      if (months.length > 0) {
        await db.insert(businessPlanMonths).values(
          months.map((month) => ({
            planId: created!.id,
            competence: month.competence,
            plannedRevenue: month.plannedRevenue,
            plannedCost: month.plannedCost,
            plannedCustomers: month.plannedCustomers,
            plannedMargin: month.plannedMargin,
          })),
        );
      }

      const sourceMilestones = await db
        .select()
        .from(milestones)
        .where(eq(milestones.planId, source.id));

      if (sourceMilestones.length > 0) {
        await db.insert(milestones).values(
          sourceMilestones.map((milestone) => ({
            planId: created!.id,
            name: milestone.name,
            targetDate: milestone.targetDate,
            acceptanceCriteria: milestone.acceptanceCriteria,
            status: milestone.status,
            doneDate: milestone.doneDate,
            orderIndex: milestone.orderIndex,
          })),
        );
      }
    }

    // The old version stays in the database; it only stops being the current one.
    await db
      .update(businessPlans)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(businessPlans.productId, input.productId),
          ne(businessPlans.id, created!.id),
          eq(businessPlans.status, "active"),
        ),
      );

    await writeAudit({
      entityType: "business_plan",
      entityId: created!.id,
      productId: input.productId,
      action: "create",
      actorId: guard.actor.id,
      changes: [
        { field: "version", to: (maxVersion?.max ?? 0) + 1 },
        { field: "origin", to: `versão ${source.version}` },
      ],
    });

    revalidatePath(`/produtos/${input.productId}/business-plan`);
    return ok(
      { id: created!.id },
      `Versão ${(maxVersion?.max ?? 0) + 1} criada. A versão ${source.version} foi preservada.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

/** Saves the whole projections table at once, replacing what was there. */
export async function savePlanMonthsAction(
  _prev: ActionResult<{ saved: number } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: number } | null>> {
  try {
    const parsed = parseForm(planMonthsSchema, formData);
    if (!parsed.ok) return parsed.result;

    const guard = await requirePlanWriterByPlan(parsed.data.planId);
    if (!guard.ok) return guard.error;

    await db.delete(businessPlanMonths).where(eq(businessPlanMonths.planId, guard.plan.id));

    if (parsed.data.rows.length > 0) {
      await db.insert(businessPlanMonths).values(
        parsed.data.rows.map((row) => ({
          planId: guard.plan.id,
          competence: `${row.competence.slice(0, 7)}-01`,
          plannedRevenue: row.plannedRevenue,
          plannedCost: row.plannedCost,
          plannedCustomers: row.plannedCustomers,
          plannedMargin: row.plannedMargin,
        })),
      );
    }

    await writeAudit({
      entityType: "business_plan",
      entityId: guard.plan.id,
      productId: guard.plan.productId,
      action: "update",
      actorId: guard.actor.id,
      changes: [{ field: "months", to: `${parsed.data.rows.length} meses gravados` }],
    });

    revalidatePath(`/produtos/${guard.plan.productId}/business-plan`);
    revalidatePath(`/produtos/${guard.plan.productId}/visao-geral`);
    revalidatePath(`/produtos/${guard.plan.productId}/financeiro`);
    return ok({ saved: parsed.data.rows.length }, "Projeções salvas.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function importPlanMonthsAction(
  _prev: ActionResult<{ saved: number } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: number } | null>> {
  try {
    const parsed = parseForm(importPlanSchema, formData);
    if (!parsed.ok) return parsed.result;

    const guard = await requirePlanWriterByPlan(parsed.data.planId);
    if (!guard.ok) return guard.error;
    if (parsed.data.rows.length === 0) return fail("Nenhuma linha válida para importar.");

    await db.delete(businessPlanMonths).where(eq(businessPlanMonths.planId, guard.plan.id));
    await db.insert(businessPlanMonths).values(
      parsed.data.rows.map((row) => ({
        planId: guard.plan.id,
        competence: row.competence,
        plannedRevenue: row.plannedRevenue,
        plannedCost: row.plannedCost,
        plannedCustomers: row.plannedCustomers,
        plannedMargin: row.plannedMargin,
      })),
    );

    await writeAudit({
      entityType: "business_plan",
      entityId: guard.plan.id,
      productId: guard.plan.productId,
      action: "update",
      actorId: guard.actor.id,
      changes: [{ field: "import", to: `CSV com ${parsed.data.rows.length} meses` }],
    });

    revalidatePath(`/produtos/${guard.plan.productId}/business-plan`);
    return ok(
      { saved: parsed.data.rows.length },
      `${parsed.data.rows.length} ${parsed.data.rows.length === 1 ? "mês importado" : "meses importados"}. As projeções anteriores desta versão foram substituídas.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Milestones                                                                 */
/* -------------------------------------------------------------------------- */

export async function saveMilestoneAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(milestoneSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const guard = await requirePlanWriterByPlan(input.planId);
    if (!guard.ok) return guard.error;

    // Marking a milestone done without a date leaves the timeline unreadable.
    const doneDate =
      input.status === "done" ? (input.doneDate ?? new Date().toISOString().slice(0, 10)) : null;

    if (input.id) {
      await db
        .update(milestones)
        .set({
          name: input.name,
          targetDate: input.targetDate,
          acceptanceCriteria: input.acceptanceCriteria,
          status: input.status,
          doneDate,
        })
        .where(eq(milestones.id, input.id));
    } else {
      const [maxOrder] = await db
        .select({ max: sql<number>`coalesce(max(${milestones.orderIndex}), 0)::int` })
        .from(milestones)
        .where(eq(milestones.planId, input.planId));

      await db.insert(milestones).values({
        planId: input.planId,
        name: input.name,
        targetDate: input.targetDate,
        acceptanceCriteria: input.acceptanceCriteria,
        status: input.status,
        doneDate,
        orderIndex: (maxOrder?.max ?? 0) + 1,
      });
    }

    await writeAudit({
      entityType: "business_plan",
      entityId: guard.plan.id,
      productId: guard.plan.productId,
      action: "update",
      actorId: guard.actor.id,
      changes: [{ field: "milestone", to: `${input.name} (${input.status})` }],
    });

    revalidatePath(`/produtos/${guard.plan.productId}/business-plan`);
    revalidatePath(`/produtos/${guard.plan.productId}/visao-geral`);
    return ok(null, input.id ? "Marco atualizado." : "Marco criado.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteMilestoneAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(deleteMilestoneSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [milestone] = await db
      .select()
      .from(milestones)
      .where(eq(milestones.id, parsed.data.id))
      .limit(1);
    if (!milestone) return fail("Marco não encontrado.");

    const guard = await requirePlanWriterByPlan(milestone.planId);
    if (!guard.ok) return guard.error;

    await db.delete(milestones).where(eq(milestones.id, milestone.id));

    revalidatePath(`/produtos/${guard.plan.productId}/business-plan`);
    return ok(null, `Marco "${milestone.name}" excluído.`);
  } catch (error) {
    return toActionError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Action plans                                                               */
/* -------------------------------------------------------------------------- */

export async function saveActionPlanAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(actionPlanSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const guard = await requirePlanWriter(input.productId);
    if (!guard.ok) return guard.error;

    const values = {
      planId: input.planId,
      name: input.name,
      description: input.description,
      rootCause: input.rootCause,
      ownerId: input.ownerId,
      dueDate: input.dueDate,
      status: input.status,
      expectedResult: input.expectedResult,
      actualResult: input.actualResult,
      triggerCompetence: input.triggerCompetence,
      triggerDeviation: input.triggerDeviation,
      updatedAt: new Date(),
    };

    if (input.id) {
      await db.update(actionPlans).set(values).where(eq(actionPlans.id, input.id));
    } else {
      await db.insert(actionPlans).values({ productId: input.productId, ...values });
    }

    await writeAudit({
      entityType: "action_plan",
      entityId: input.id ?? input.productId,
      productId: input.productId,
      action: input.id ? "update" : "create",
      actorId: guard.actor.id,
      changes: [
        { field: "name", to: input.name },
        { field: "status", to: input.status },
        { field: "dueDate", to: input.dueDate },
      ],
    });

    revalidatePath(`/produtos/${input.productId}/business-plan`);
    revalidatePath(`/produtos/${input.productId}/visao-geral`);
    return ok(null, input.id ? "Plano de ação atualizado." : "Plano de ação criado.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteActionPlanAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(deleteActionPlanSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [plan] = await db
      .select()
      .from(actionPlans)
      .where(eq(actionPlans.id, parsed.data.id))
      .limit(1);
    if (!plan) return fail("Plano de ação não encontrado.");

    const guard = await requirePlanWriter(plan.productId);
    if (!guard.ok) return guard.error;

    await writeAudit({
      entityType: "action_plan",
      entityId: plan.id,
      productId: plan.productId,
      action: "delete",
      actorId: guard.actor.id,
      changes: [{ field: "name", from: plan.name, to: null }],
    });

    await db.delete(actionPlans).where(eq(actionPlans.id, plan.id));

    revalidatePath(`/produtos/${plan.productId}/business-plan`);
    revalidatePath(`/produtos/${plan.productId}/visao-geral`);
    return ok(null, `Plano de ação "${plan.name}" excluído.`);
  } catch (error) {
    return toActionError(error);
  }
}
