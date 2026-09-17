"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import {
  appSettings,
  enumValues,
  financeEntries,
  insights,
  productComments,
  productGoals,
  products,
  tasks,
} from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canManageSettings } from "@/lib/auth/policy";
import {
  deleteEnumValueSchema,
  enumValueSchema,
  reorderEnumValuesSchema,
  settingsSchema,
} from "@/lib/schemas/config";

async function requireSettingsAdmin() {
  const actor = await requireUserOrThrow();
  authorize(canManageSettings(actor), "Apenas administradores alteram configurações.");
  return actor;
}

/* -------------------------------------------------------------------------- */
/* Administered domains                                                       */
/* -------------------------------------------------------------------------- */

export async function saveEnumValueAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireSettingsAdmin();
    const parsed = parseForm(enumValueSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const [clash] = await db
      .select({ id: enumValues.id })
      .from(enumValues)
      .where(and(eq(enumValues.kind, input.kind), eq(enumValues.code, input.code)))
      .limit(1);

    if (input.id) {
      if (clash && clash.id !== input.id) {
        return fail("Já existe um valor com esse código.", {
          code: ["Já existe um valor com esse código."],
        });
      }
      const [current] = await db.select().from(enumValues).where(eq(enumValues.id, input.id));
      if (!current) return fail("Valor não encontrado.");

      await db
        .update(enumValues)
        .set({
          // The code of a system value is referenced by the engine; only the
          // label, colour and ordering may change.
          code: current.isSystem ? current.code : input.code,
          label: input.label,
          color: input.color,
          sortOrder: input.sortOrder,
          active: input.active,
        })
        .where(eq(enumValues.id, input.id));

      await writeAudit({
        entityType: "enum_value",
        entityId: input.id,
        action: "update",
        actorId: actor.id,
        changes: [
          { field: "label", from: current.label, to: input.label },
          { field: "active", from: String(current.active), to: String(input.active) },
        ],
      });
      return ok(null, "Valor atualizado.");
    }

    if (clash) {
      return fail("Já existe um valor com esse código.", {
        code: ["Já existe um valor com esse código."],
      });
    }

    const [created] = await db
      .insert(enumValues)
      .values({
        kind: input.kind,
        code: input.code,
        label: input.label,
        color: input.color,
        sortOrder: input.sortOrder,
        active: input.active,
      })
      .returning({ id: enumValues.id });

    await writeAudit({
      entityType: "enum_value",
      entityId: created!.id,
      action: "create",
      actorId: actor.id,
      changes: [{ field: "label", to: input.label }],
    });

    revalidatePath("/configuracoes");
    return ok(null, "Valor criado.");
  } catch (error) {
    return toActionError(error);
  }
}

/** Counts what would break if a domain value disappeared. */
async function countEnumUsage(id: string, kind: string): Promise<number> {
  const count = async (query: Promise<{ total: number }[]>) => (await query)[0]?.total ?? 0;

  switch (kind) {
    case "goal_type":
      return count(
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(productGoals)
          .where(eq(productGoals.goalTypeId, id)),
      );
    case "task_category":
      return count(
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(tasks)
          .where(eq(tasks.categoryId, id)),
      );
    case "finance_entry_type":
      return count(
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(financeEntries)
          .where(eq(financeEntries.entryTypeId, id)),
      );
    case "comment_category":
      return count(
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(productComments)
          .where(eq(productComments.categoryId, id)),
      );
    case "product_category":
      return count(
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(products)
          .where(eq(products.categoryId, id)),
      );
    case "insight_origin":
      return count(
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(insights)
          .where(eq(insights.originId, id)),
      );
    default:
      return 0;
  }
}

export async function deleteEnumValueAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireSettingsAdmin();
    const parsed = parseForm(deleteEnumValueSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [current] = await db.select().from(enumValues).where(eq(enumValues.id, parsed.data.id));
    if (!current) return fail("Valor não encontrado.");
    if (current.isSystem) {
      return fail(
        "Este valor é usado pelo próprio sistema e não pode ser excluído. Desative-o, se não quiser mais usá-lo.",
      );
    }

    // Kanban columns live in tasks.status as a code, not a foreign key.
    const usage =
      current.kind === "kanban_column"
        ? (
            await db
              .select({ total: sql<number>`count(*)::int` })
              .from(tasks)
              .where(eq(tasks.status, current.code))
          )[0]?.total ?? 0
        : await countEnumUsage(current.id, current.kind);

    if (usage > 0) {
      return fail(
        `Este valor está em uso em ${usage} ${usage === 1 ? "registro" : "registros"}. Desative-o em vez de excluir, para não perder o histórico.`,
      );
    }

    await db.delete(enumValues).where(eq(enumValues.id, current.id));
    await writeAudit({
      entityType: "enum_value",
      entityId: current.id,
      action: "delete",
      actorId: actor.id,
      changes: [{ field: "label", from: current.label, to: null }],
    });

    revalidatePath("/configuracoes");
    return ok(null, `"${current.label}" excluído.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function reorderEnumValuesAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    await requireSettingsAdmin();
    const parsed = parseForm(reorderEnumValuesSchema, formData);
    if (!parsed.ok) return parsed.result;

    await Promise.all(
      parsed.data.order.map((id, index) =>
        db.update(enumValues).set({ sortOrder: index + 1 }).where(eq(enumValues.id, id)),
      ),
    );

    revalidatePath("/configuracoes");
    return ok(null, "Ordem salva.");
  } catch (error) {
    return toActionError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* General settings                                                           */
/* -------------------------------------------------------------------------- */

export async function saveSettingsAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireSettingsAdmin();
    const parsed = parseForm(settingsSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const values = {
      healthWeights: {
        goal: input.weightGoal,
        financial: input.weightFinancial,
        execution: input.weightExecution,
        businessPlan: input.weightBusinessPlan,
        risk: input.weightRisk,
      },
      semaphoreThresholds: { green: input.semaphoreGreen, amber: input.semaphoreAmber },
      recommendationRules: {
        scale: {
          minHealth: input.scaleMinHealth,
          minRoi: input.scaleMinRoi,
          minMomGrowth: input.scaleMinMomGrowth,
        },
        keep: {
          minHealth: input.semaphoreAmber,
          maxHealth: input.semaphoreGreen - 1,
          minProjectedRoi: input.keepMinProjectedRoi,
        },
        watch: { minHealth: input.semaphoreAmber, maxHealth: input.semaphoreGreen - 1 },
        pivot: { minNegativeMarginMonths: input.pivotMinNegativeMarginMonths },
        discontinue: {
          maxRoi: input.discontinueMaxRoi,
          maxProjectedRoi: input.discontinueMaxProjectedRoi,
          minDecliningMonths: input.discontinueMinDecliningMonths,
        },
      },
      projectionSettings: {
        windowMonths: input.projectionWindowMonths,
        horizonMonths: input.projectionHorizonMonths,
      },
      bpDeviationLimit: input.bpDeviationLimit,
      defaultCurrency: input.defaultCurrency.toUpperCase(),
      updatedAt: new Date(),
      updatedBy: actor.id,
    };

    await db
      .insert(appSettings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: appSettings.id, set: values });

    await writeAudit({
      entityType: "app_settings",
      entityId: "00000000-0000-0000-0000-000000000000",
      action: "update",
      actorId: actor.id,
      changes: [
        { field: "healthWeights", to: JSON.stringify(values.healthWeights) },
        { field: "semaphoreThresholds", to: JSON.stringify(values.semaphoreThresholds) },
        { field: "bpDeviationLimit", to: String(values.bpDeviationLimit) },
      ],
    });

    revalidatePath("/configuracoes");
    revalidatePath("/");
    return ok(null, "Configurações salvas.");
  } catch (error) {
    return toActionError(error);
  }
}
