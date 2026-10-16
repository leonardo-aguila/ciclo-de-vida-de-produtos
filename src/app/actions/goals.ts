"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { enumValues, goalMeasurements, productGoals } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canEditProduct } from "@/lib/auth/policy";
import { MEASURABLE_GOAL_TYPES } from "@/lib/engine/goals";
import { getProductRef } from "@/lib/queries/products";
import { deleteGoalMeasurementSchema, goalMeasurementSchema } from "@/lib/schemas/goal";

/**
 * Quem pode apurar uma meta é quem pode editar o produto dela.
 *
 * Também recusa apurar um tipo que a aplicação já deriva das vendas e dos
 * lançamentos: aceitar os dois criaria dois realizados para a mesma meta, e a
 * tela teria de escolher um sem ter como justificar a escolha. A recusa vem
 * do servidor, não de esconder o botão.
 */
async function requireGoalWriter(goalId: string) {
  const actor = await requireUserOrThrow();

  const [goal] = await db
    .select({
      id: productGoals.id,
      productId: productGoals.productId,
      typeCode: enumValues.code,
      typeLabel: enumValues.label,
    })
    .from(productGoals)
    .leftJoin(enumValues, eq(enumValues.id, productGoals.goalTypeId))
    .where(eq(productGoals.id, goalId))
    .limit(1);
  if (!goal) return { ok: false as const, error: fail("Meta não encontrada.") };

  const product = await getProductRef(goal.productId);
  if (!product) return { ok: false as const, error: fail("Produto não encontrado.") };

  authorize(
    canEditProduct(actor, product),
    "Você só apura metas de produtos de que é responsável.",
  );

  if (MEASURABLE_GOAL_TYPES.has(goal.typeCode ?? "")) {
    return {
      ok: false as const,
      error: fail(
        `${goal.typeLabel ?? "Esta meta"} é apurada automaticamente a partir das vendas mensais ` +
          "e dos lançamentos. Registre os dados no Financeiro em vez de digitar o realizado.",
      ),
    };
  }

  return { ok: true as const, actor, goal };
}

export async function saveGoalMeasurementAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(goalMeasurementSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const guard = await requireGoalWriter(input.goalId);
    if (!guard.ok) return guard.error;

    const [existing] = await db
      .select()
      .from(goalMeasurements)
      .where(
        and(
          eq(goalMeasurements.goalId, input.goalId),
          eq(goalMeasurements.competence, input.competence),
        ),
      )
      .limit(1);

    const values = { value: input.value, note: input.note, updatedAt: new Date() };

    if (existing) {
      await db.update(goalMeasurements).set(values).where(eq(goalMeasurements.id, existing.id));
      await writeAudit({
        entityType: "goal_measurement",
        entityId: existing.id,
        productId: guard.goal.productId,
        action: "update",
        actorId: guard.actor.id,
        changes: [
          { field: "value", from: existing.value, to: input.value },
          { field: "note", from: existing.note, to: input.note },
        ],
      });
    } else {
      const [created] = await db
        .insert(goalMeasurements)
        .values({ goalId: input.goalId, competence: input.competence, ...values })
        .returning({ id: goalMeasurements.id });
      await writeAudit({
        entityType: "goal_measurement",
        entityId: created!.id,
        productId: guard.goal.productId,
        action: "create",
        actorId: guard.actor.id,
        changes: [
          { field: "competence", to: input.competence },
          { field: "value", to: input.value },
        ],
      });
    }

    revalidatePath(`/produtos/${guard.goal.productId}/visao-geral`);
    revalidatePath("/");
    return ok(null, "Apuração salva.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteGoalMeasurementAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const parsed = parseForm(deleteGoalMeasurementSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [current] = await db
      .select()
      .from(goalMeasurements)
      .where(eq(goalMeasurements.id, parsed.data.id))
      .limit(1);
    if (!current) return fail("Apuração não encontrada.");

    const guard = await requireGoalWriter(current.goalId);
    if (!guard.ok) return guard.error;

    await writeAudit({
      entityType: "goal_measurement",
      entityId: current.id,
      productId: guard.goal.productId,
      action: "delete",
      actorId: guard.actor.id,
      changes: [
        { field: "competence", from: current.competence, to: null },
        { field: "value", from: current.value, to: null },
      ],
    });

    await db.delete(goalMeasurements).where(eq(goalMeasurements.id, current.id));

    revalidatePath(`/produtos/${guard.goal.productId}/visao-geral`);
    revalidatePath("/");
    return ok(null, "Apuração excluída.");
  } catch (error) {
    return toActionError(error);
  }
}
