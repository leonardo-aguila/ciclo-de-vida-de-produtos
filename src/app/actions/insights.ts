"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { insights, productDecisions, tasks } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canEditProduct, canManageInsights, canRegisterDecision } from "@/lib/auth/policy";
import { getProductRef } from "@/lib/queries/products";
import {
  convertInsightSchema,
  createInsightSchema,
  deleteInsightSchema,
  moveInsightSchema,
  registerDecisionSchema,
  updateInsightSchema,
} from "@/lib/schemas/insight";

async function loadWritableInsight(insightId: string) {
  const actor = await requireUserOrThrow();
  const [insight] = await db.select().from(insights).where(eq(insights.id, insightId)).limit(1);
  if (!insight) return { ok: false as const, error: fail("Insight não encontrado.") };

  const product = await getProductRef(insight.productId);
  if (!product) return { ok: false as const, error: fail("Produto não encontrado.") };

  authorize(canManageInsights(actor, product), "Seu perfil não pode editar insights.");
  return { ok: true as const, actor, insight, product };
}

export async function createInsightAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(createInsightSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const product = await getProductRef(input.productId);
    if (!product) return fail("Produto não encontrado.");
    authorize(canManageInsights(actor, product), "Seu perfil não pode cadastrar insights.");

    const [created] = await db
      .insert(insights)
      .values({
        productId: input.productId,
        title: input.title,
        description: input.description,
        originId: input.originId,
        ownerId: input.ownerId,
        insightDate: input.insightDate,
        status: input.status,
        effort: input.effort,
        impact: input.impact,
      })
      .returning({ id: insights.id });

    await writeAudit({
      entityType: "insight",
      entityId: created!.id,
      productId: input.productId,
      action: "create",
      actorId: actor.id,
      changes: [
        { field: "title", to: input.title },
        { field: "effort", to: input.effort },
        { field: "impact", to: input.impact },
      ],
    });

    revalidatePath(`/produtos/${input.productId}/insights`);
    return ok({ id: created!.id }, "Insight cadastrado.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateInsightAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const parsed = parseForm(updateInsightSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const loaded = await loadWritableInsight(input.id);
    if (!loaded.ok) return loaded.error;

    await db
      .update(insights)
      .set({
        title: input.title,
        description: input.description,
        originId: input.originId,
        ownerId: input.ownerId,
        insightDate: input.insightDate,
        status: input.status,
        effort: input.effort,
        impact: input.impact,
        updatedAt: new Date(),
      })
      .where(eq(insights.id, input.id));

    await writeAudit({
      entityType: "insight",
      entityId: input.id,
      productId: loaded.insight.productId,
      action: "update",
      actorId: loaded.actor.id,
      changes: [
        { field: "title", from: loaded.insight.title, to: input.title },
        { field: "status", from: loaded.insight.status, to: input.status },
        { field: "effort", from: loaded.insight.effort, to: input.effort },
        { field: "impact", from: loaded.insight.impact, to: input.impact },
      ],
    });

    revalidatePath(`/produtos/${loaded.insight.productId}/insights`);
    return ok({ id: input.id }, "Insight atualizado.");
  } catch (error) {
    return toActionError(error);
  }
}

/** Dragging a point on the effort × impact matrix. */
export async function moveInsightAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(moveInsightSchema, formData);
    if (!parsed.ok) return parsed.result;

    const loaded = await loadWritableInsight(parsed.data.id);
    if (!loaded.ok) return loaded.error;

    await db
      .update(insights)
      .set({ effort: parsed.data.effort, impact: parsed.data.impact, updatedAt: new Date() })
      .where(eq(insights.id, parsed.data.id));

    await writeAudit({
      entityType: "insight",
      entityId: parsed.data.id,
      productId: loaded.insight.productId,
      action: "update",
      actorId: loaded.actor.id,
      changes: [
        { field: "effort", from: loaded.insight.effort, to: parsed.data.effort },
        { field: "impact", from: loaded.insight.impact, to: parsed.data.impact },
      ],
    });

    revalidatePath(`/produtos/${loaded.insight.productId}/insights`);
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteInsightAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(deleteInsightSchema, formData);
    if (!parsed.ok) return parsed.result;

    const loaded = await loadWritableInsight(parsed.data.id);
    if (!loaded.ok) return loaded.error;
    // Deleting is the product owner's call, not every collaborator's.
    authorize(
      canEditProduct(loaded.actor, loaded.product),
      "Você só exclui insights de produtos de que é responsável.",
    );

    await writeAudit({
      entityType: "insight",
      entityId: loaded.insight.id,
      productId: loaded.insight.productId,
      action: "delete",
      actorId: loaded.actor.id,
      changes: [{ field: "title", from: loaded.insight.title, to: null }],
    });

    await db.delete(insights).where(eq(insights.id, loaded.insight.id));

    revalidatePath(`/produtos/${loaded.insight.productId}/insights`);
    return ok(null, "Insight excluído.");
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Turns an insight into one or more tasks, keeping the link back to it, and
 * moves the insight to "in progress" — converting something and leaving it
 * marked "new" would make the board lie.
 */
export async function convertInsightAction(
  _prev: ActionResult<{ created: number } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ created: number } | null>> {
  try {
    const parsed = parseForm(convertInsightSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const loaded = await loadWritableInsight(input.id);
    if (!loaded.ok) return loaded.error;
    authorize(
      canEditProduct(loaded.actor, loaded.product),
      "Você só cria tarefas em produtos de que é responsável.",
    );

    const names = input.taskNames
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .slice(0, 20);

    if (names.length === 0) return fail("Informe ao menos um nome de tarefa.");

    const [maxOrder] = await db
      .select({ max: sql<number>`coalesce(max(${tasks.boardOrder}), 0)::int` })
      .from(tasks)
      .where(eq(tasks.productId, loaded.insight.productId));

    await db.insert(tasks).values(
      names.map((name, index) => ({
        productId: loaded.insight.productId,
        name,
        description: `Originada do insight "${loaded.insight.title}".`,
        categoryId: input.categoryId,
        assigneeId: input.assigneeId ?? loaded.insight.ownerId,
        status: "backlog",
        priority: loaded.insight.impact >= 8 ? ("high" as const) : ("medium" as const),
        startDate: input.startDate,
        dueDate: input.dueDate,
        boardOrder: (maxOrder?.max ?? 0) + index + 1,
        originInsightId: loaded.insight.id,
      })),
    );

    await db
      .update(insights)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(insights.id, loaded.insight.id));

    await writeAudit({
      entityType: "insight",
      entityId: loaded.insight.id,
      productId: loaded.insight.productId,
      action: "update",
      actorId: loaded.actor.id,
      changes: [
        { field: "status", from: loaded.insight.status, to: "in_progress" },
        { field: "tasks", to: `${names.length} tarefas criadas a partir do insight` },
      ],
    });

    revalidatePath(`/produtos/${loaded.insight.productId}/insights`);
    revalidatePath(`/produtos/${loaded.insight.productId}/tarefas`);
    return ok(
      { created: names.length },
      `${names.length} ${names.length === 1 ? "tarefa criada" : "tarefas criadas"} a partir do insight.`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Records what the user decided about a recommendation.
 *
 * Nothing is executed: accepting "discontinue" does not discontinue anything.
 * It writes down that the call was made, by whom, why, and against which
 * numbers — which is what makes the decision reviewable later.
 */
export async function registerDecisionAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(registerDecisionSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const product = await getProductRef(input.productId);
    if (!product) return fail("Produto não encontrado.");
    authorize(
      canRegisterDecision(actor, product),
      "Você só registra decisões de produtos de que é responsável.",
    );

    await db.insert(productDecisions).values({
      productId: input.productId,
      recommended: input.recommended,
      outcome: input.outcome,
      justification: input.justification,
      metricsSnapshot: input.metricsSnapshot,
      decidedBy: actor.id,
    });

    await writeAudit({
      entityType: "product",
      entityId: input.productId,
      productId: input.productId,
      action: "update",
      actorId: actor.id,
      changes: [
        {
          field: "decision",
          to: `${input.outcome === "accepted" ? "aceitou" : "rejeitou"} a recomendação "${input.recommended}"`,
        },
      ],
    });

    revalidatePath(`/produtos/${input.productId}/visao-geral`);
    return ok(
      null,
      input.outcome === "accepted"
        ? "Decisão registrada: recomendação aceita."
        : "Decisão registrada: recomendação rejeitada.",
    );
  } catch (error) {
    return toActionError(error);
  }
}
