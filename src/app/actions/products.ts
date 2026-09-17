"use server";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import {
  productGoals,
  productPhaseHistory,
  products,
  taskDependencies,
  taskTemplateDependencies,
  taskTemplates,
  tasks,
  type LifecyclePhase,
} from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canCreateProduct, canDeleteProduct, canEditProduct } from "@/lib/auth/policy";
import { planTasksFromPackage, findDuplicateNames, type TemplateInput } from "@/lib/engine/schedule";
import { todayIso } from "@/lib/format";
import { getProductRef } from "@/lib/queries/products";
import {
  applyPackageSchema,
  createProductSchema,
  deleteProductSchema,
  updateProductSchema,
  type GoalInput,
} from "@/lib/schemas/product";

/* -------------------------------------------------------------------------- */
/* Package replication                                                        */
/* -------------------------------------------------------------------------- */

async function loadTemplates(packageId: string): Promise<TemplateInput[]> {
  const rows = await db
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.packageId, packageId))
    .orderBy(asc(taskTemplates.orderIndex));

  if (rows.length === 0) return [];

  const deps = await db
    .select()
    .from(taskTemplateDependencies)
    .where(
      inArray(
        taskTemplateDependencies.templateId,
        rows.map((row) => row.id),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId,
    defaultAssigneeId: row.defaultAssigneeId,
    priority: row.priority,
    initialStatus: row.initialStatus,
    estimatedHours: row.estimatedHours,
    anchor: row.anchor,
    startOffsetDays: row.startOffsetDays,
    endOffsetDays: row.endOffsetDays,
    orderIndex: row.orderIndex,
    parentTemplateId: row.parentTemplateId,
    dependsOn: deps
      .filter((dep) => dep.templateId === row.id)
      .map((dep) => dep.dependsOnTemplateId),
  }));
}

/**
 * Writes the planned tasks, then rebuilds parent links and dependencies using
 * the template-id → task-id map, so the structure of the package survives.
 */
async function insertPlannedTasks(
  productId: string,
  templates: TemplateInput[],
  anchors: { startDate: string; plannedLaunchDate: string | null },
  actorId: string,
  startingOrder = 0,
) {
  const { tasks: planned, warnings } = planTasksFromPackage(templates, anchors);
  if (planned.length === 0) return { created: 0, warnings };

  const inserted = await db
    .insert(tasks)
    .values(
      planned.map((task, index) => ({
        productId,
        name: task.name,
        description: task.description,
        categoryId: task.categoryId,
        assigneeId: task.assigneeId,
        status: task.status,
        priority: task.priority,
        startDate: task.startDate,
        dueDate: task.dueDate,
        estimatedHours: task.estimatedHours,
        boardOrder: startingOrder + index,
        originTemplateId: task.templateId,
      })),
    )
    .returning({ id: tasks.id, originTemplateId: tasks.originTemplateId });

  const taskIdByTemplate = new Map(
    inserted
      .filter((row) => row.originTemplateId)
      .map((row) => [row.originTemplateId!, row.id]),
  );

  const parentUpdates = planned
    .filter((task) => task.parentTemplateId)
    .map((task) => ({
      taskId: taskIdByTemplate.get(task.templateId),
      parentId: taskIdByTemplate.get(task.parentTemplateId!),
    }))
    .filter((row) => row.taskId && row.parentId);

  for (const update of parentUpdates) {
    await db
      .update(tasks)
      .set({ parentTaskId: update.parentId! })
      .where(eq(tasks.id, update.taskId!));
  }

  const dependencyRows = planned.flatMap((task) =>
    task.dependsOn
      .map((templateId) => ({
        taskId: taskIdByTemplate.get(task.templateId),
        dependsOnTaskId: taskIdByTemplate.get(templateId),
      }))
      .filter((row) => row.taskId && row.dependsOnTaskId)
      .map((row) => ({ taskId: row.taskId!, dependsOnTaskId: row.dependsOnTaskId! })),
  );

  if (dependencyRows.length > 0) {
    await db.insert(taskDependencies).values(dependencyRows);
  }

  await writeAudit({
    entityType: "product",
    entityId: productId,
    productId,
    action: "update",
    actorId,
    changes: [{ field: "tasks", to: `${planned.length} tarefas criadas a partir de pacote` }],
  });

  return { created: planned.length, warnings };
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                      */
/* -------------------------------------------------------------------------- */

async function writeGoals(productId: string, goals: GoalInput[]) {
  // Replace wholesale: the form always sends the complete list, and a partial
  // update would leave orphan goals the user thinks they deleted.
  await db.delete(productGoals).where(eq(productGoals.productId, productId));
  if (goals.length === 0) return;

  await db.insert(productGoals).values(
    goals.map((goal) => ({
      productId,
      goalTypeId: goal.goalTypeId,
      targetValue: goal.targetValue,
      unit: goal.unit,
      period: goal.period,
      deadline: goal.deadline,
      isPrimary: goal.isPrimary,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

export async function createProductAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const actor = await requireUserOrThrow();
    authorize(canCreateProduct(actor), "Seu perfil não pode criar produtos.");

    const parsed = parseForm(createProductSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(sql`lower(${products.code}) = ${input.code.toLowerCase()}`)
      .limit(1);
    if (existing) {
      return fail("Já existe um produto com esse código.", {
        code: ["Já existe um produto com esse código."],
      });
    }

    const [created] = await db
      .insert(products)
      .values({
        code: input.code,
        name: input.name,
        shortDescription: input.shortDescription,
        ownerId: input.ownerId,
        team: input.team,
        categoryId: input.categoryId,
        phase: input.phase,
        status: input.status,
        startDate: input.startDate,
        plannedLaunchDate: input.plannedLaunchDate,
        actualLaunchDate: input.actualLaunchDate,
        segment: input.segment,
        pricingModel: input.pricingModel,
        competitors: input.competitors,
        tags: input.tags,
        createdBy: actor.id,
      })
      .returning({ id: products.id });

    const productId = created!.id;

    // The phase timeline starts when the product does, not when it was typed in.
    await db.insert(productPhaseHistory).values({
      productId,
      phase: input.phase,
      startedAt: input.startDate,
      changedBy: actor.id,
    });

    await writeGoals(productId, input.goals);

    let message = `Produto ${input.name} criado.`;
    if (input.packageId) {
      const templates = await loadTemplates(input.packageId);
      const { created: count, warnings } = await insertPlannedTasks(
        productId,
        templates,
        { startDate: input.startDate, plannedLaunchDate: input.plannedLaunchDate },
        actor.id,
      );
      message = `Produto ${input.name} criado com ${count} ${count === 1 ? "tarefa" : "tarefas"} do pacote.`;
      if (warnings.length > 0) message += ` ${warnings[0]}`;
    }

    await writeAudit({
      entityType: "product",
      entityId: productId,
      productId,
      action: "create",
      actorId: actor.id,
      changes: [
        { field: "name", to: input.name },
        { field: "code", to: input.code },
        { field: "phase", to: input.phase },
      ],
    });

    revalidatePath("/produtos");
    return ok({ id: productId }, message);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateProductAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(updateProductSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const [current] = await db.select().from(products).where(eq(products.id, input.id)).limit(1);
    if (!current) return fail("Produto não encontrado.");
    authorize(
      canEditProduct(actor, current),
      "Você só edita produtos de que é responsável.",
    );

    const [clash] = await db
      .select({ id: products.id })
      .from(products)
      .where(sql`lower(${products.code}) = ${input.code.toLowerCase()}`)
      .limit(1);
    if (clash && clash.id !== input.id) {
      return fail("Já existe um produto com esse código.", {
        code: ["Já existe um produto com esse código."],
      });
    }

    await db
      .update(products)
      .set({
        code: input.code,
        name: input.name,
        shortDescription: input.shortDescription,
        ownerId: input.ownerId,
        team: input.team,
        categoryId: input.categoryId,
        phase: input.phase,
        status: input.status,
        startDate: input.startDate,
        plannedLaunchDate: input.plannedLaunchDate,
        actualLaunchDate: input.actualLaunchDate,
        segment: input.segment,
        pricingModel: input.pricingModel,
        competitors: input.competitors,
        tags: input.tags,
        updatedAt: new Date(),
      })
      .where(eq(products.id, input.id));

    if (current.phase !== input.phase) {
      await recordPhaseChange(input.id, input.phase, actor.id);
    }

    await writeGoals(input.id, input.goals);

    await writeAudit({
      entityType: "product",
      entityId: input.id,
      productId: input.id,
      action: "update",
      actorId: actor.id,
      changes: [
        { field: "name", from: current.name, to: input.name },
        { field: "code", from: current.code, to: input.code },
        { field: "phase", from: current.phase, to: input.phase },
        { field: "status", from: current.status, to: input.status },
        { field: "ownerId", from: current.ownerId, to: input.ownerId },
        { field: "startDate", from: current.startDate, to: input.startDate },
        { field: "plannedLaunchDate", from: current.plannedLaunchDate, to: input.plannedLaunchDate },
        { field: "actualLaunchDate", from: current.actualLaunchDate, to: input.actualLaunchDate },
      ],
    });

    revalidatePath("/produtos");
    revalidatePath(`/produtos/${input.id}`);
    return ok({ id: input.id }, "Produto atualizado.");
  } catch (error) {
    return toActionError(error);
  }
}

/** Closes the phase row that is still open and opens the next one. */
async function recordPhaseChange(productId: string, to: LifecyclePhase, actorId: string) {
  const today = todayIso();

  await db
    .update(productPhaseHistory)
    .set({ endedAt: today })
    .where(
      and(eq(productPhaseHistory.productId, productId), isNull(productPhaseHistory.endedAt)),
    );

  await db.insert(productPhaseHistory).values({
    productId,
    phase: to,
    startedAt: today,
    changedBy: actorId,
  });
}

export async function applyPackageAction(
  _prev: ActionResult<{ created: number } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ created: number } | null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(applyPackageSchema, formData);
    if (!parsed.ok) return parsed.result;

    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, parsed.data.productId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!product) return fail("Produto não encontrado.");
    authorize(canEditProduct(actor, product), "Você só edita produtos de que é responsável.");

    const templates = await loadTemplates(parsed.data.packageId);
    if (templates.length === 0) return fail("Este pacote não tem tarefas.");

    const existing = await db
      .select({ name: tasks.name })
      .from(tasks)
      .where(eq(tasks.productId, product.id));

    const { tasks: planned } = planTasksFromPackage(templates, {
      startDate: product.startDate,
      plannedLaunchDate: product.plannedLaunchDate,
    });
    const duplicates = findDuplicateNames(
      existing.map((row) => row.name),
      planned,
    );

    if (duplicates.length > 0 && !parsed.data.confirmDuplicates) {
      return fail(
        `O produto já tem ${duplicates.length === 1 ? "uma tarefa" : `${duplicates.length} tarefas`} com o mesmo nome: ${duplicates
          .slice(0, 3)
          .join(", ")}${duplicates.length > 3 ? "…" : ""}. Confirme para aplicar mesmo assim.`,
        { confirmDuplicates: ["Confirme para aplicar mesmo assim."] },
      );
    }

    const { created, warnings } = await insertPlannedTasks(
      product.id,
      templates,
      { startDate: product.startDate, plannedLaunchDate: product.plannedLaunchDate },
      actor.id,
      existing.length,
    );

    revalidatePath(`/produtos/${product.id}`);
    return ok(
      { created },
      `${created} ${created === 1 ? "tarefa acrescentada" : "tarefas acrescentadas"}.${
        warnings.length > 0 ? ` ${warnings[0]}` : ""
      }`,
    );
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteProductAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(deleteProductSchema, formData);
    if (!parsed.ok) return parsed.result;

    const product = await getProductRef(parsed.data.id);
    if (!product) return fail("Produto não encontrado.");
    authorize(canDeleteProduct(actor, product), "Você só exclui produtos de que é responsável.");

    const [full] = await db.select().from(products).where(eq(products.id, product.id)).limit(1);
    if (full!.code.toLowerCase() !== parsed.data.confirmCode.trim().toLowerCase()) {
      return fail("O código digitado não confere.", {
        confirmCode: ["O código digitado não confere."],
      });
    }

    // The audit row is written before the delete: afterwards there would be no
    // product left to describe.
    await writeAudit({
      entityType: "product",
      entityId: product.id,
      productId: product.id,
      action: "delete",
      actorId: actor.id,
      changes: [{ field: "name", from: full!.name, to: null }],
    });

    await db.delete(products).where(eq(products.id, product.id));

    revalidatePath("/produtos");
    return ok(null, `Produto ${full!.name} excluído.`);
  } catch (error) {
    return toActionError(error);
  }
}
