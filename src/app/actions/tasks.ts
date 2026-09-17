"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { enumValues, taskComments, taskDependencies, tasks, type Task } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import {
  canCreateTask,
  canEditProduct,
  canEditTask,
  type Actor,
  type ProductRef,
} from "@/lib/auth/policy";
import { todayIso } from "@/lib/format";
import { findDoneColumn, listEnumValues } from "@/lib/queries/enums";
import { getProductRef } from "@/lib/queries/products";
import {
  createTaskSchema,
  deleteTaskSchema,
  moveTaskSchema,
  rescheduleTaskSchema,
  setProgressSchema,
  taskCommentSchema,
  updateTaskSchema,
} from "@/lib/schemas/task";

type LoadedTask =
  | { ok: false; error: ActionResult<never> }
  | { ok: true; task: Task; product: ProductRef };

/** Loads the task and its product, and asserts the actor may write to it. */
async function loadWritableTask(actor: Actor, taskId: string): Promise<LoadedTask> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { ok: false, error: fail("Tarefa não encontrada.") };

  const product = await getProductRef(task.productId);
  if (!product) return { ok: false, error: fail("Produto não encontrado.") };

  authorize(
    canEditTask(actor, task, product),
    "Você só edita tarefas suas ou de produtos de que é responsável.",
  );
  return { ok: true, task, product };
}

/** The kanban column that completes a task, by its `isDone` flag. */
async function doneColumnCode(): Promise<string | null> {
  const columns = await listEnumValues("kanban_column");
  return findDoneColumn(columns)?.code ?? null;
}

/**
 * Moving to the done column fills progress and the completion date; moving out
 * of it clears the date, so a task dragged back does not keep claiming it is
 * finished. That is what keeps the two views and the indicators agreeing.
 */
function applyDoneRules(
  status: string,
  doneCode: string | null,
  current: { progress: number; doneDate: string | null },
  explicitProgress?: number,
) {
  const isDone = doneCode !== null && status === doneCode;
  if (isDone) {
    return { progress: 100, doneDate: current.doneDate ?? todayIso() };
  }
  const progress = explicitProgress ?? (current.progress >= 100 ? 99 : current.progress);
  return { progress, doneDate: null };
}

async function writeDependencies(taskId: string, dependsOn: string[], productId: string) {
  await db.delete(taskDependencies).where(eq(taskDependencies.taskId, taskId));
  if (dependsOn.length === 0) return;

  // Only tasks of the same product, and never the task itself.
  const valid = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.productId, productId), inArray(tasks.id, dependsOn), ne(tasks.id, taskId)),
    );

  if (valid.length > 0) {
    await db
      .insert(taskDependencies)
      .values(valid.map((row) => ({ taskId, dependsOnTaskId: row.id })));
  }
}

export async function createTaskAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(createTaskSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const product = await getProductRef(input.productId);
    if (!product) return fail("Produto não encontrado.");
    authorize(canCreateTask(actor, product), "Você só cria tarefas em produtos de que é responsável.");

    const doneCode = await doneColumnCode();
    const applied = applyDoneRules(
      input.status,
      doneCode,
      { progress: input.progress, doneDate: input.doneDate },
      input.progress,
    );

    const [maxOrder] = await db
      .select({ max: sql<number>`coalesce(max(${tasks.boardOrder}), 0)::int` })
      .from(tasks)
      .where(eq(tasks.productId, input.productId));

    const [created] = await db
      .insert(tasks)
      .values({
        productId: input.productId,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        assigneeId: input.assigneeId,
        status: input.status,
        priority: input.priority,
        progress: applied.progress,
        startDate: input.startDate,
        dueDate: input.dueDate,
        doneDate: input.doneDate ?? applied.doneDate,
        estimatedHours: input.estimatedHours,
        parentTaskId: input.parentTaskId,
        isMilestone: input.isMilestone,
        boardOrder: (maxOrder?.max ?? 0) + 1,
      })
      .returning({ id: tasks.id });

    await writeDependencies(created!.id, input.dependsOn, input.productId);

    await writeAudit({
      entityType: "task",
      entityId: created!.id,
      productId: input.productId,
      action: "create",
      actorId: actor.id,
      changes: [
        { field: "name", to: input.name },
        { field: "status", to: input.status },
      ],
    });

    revalidatePath(`/produtos/${input.productId}/tarefas`);
    return ok({ id: created!.id }, "Tarefa criada.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateTaskAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(updateTaskSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const loaded = await loadWritableTask(actor, input.id);
    if (!loaded.ok) return loaded.error;
    const { task, product } = loaded;

    // A collaborator edits the task they own, but not who owns it next.
    const canReassign = canEditProduct(actor, product);
    const assigneeId = canReassign ? input.assigneeId : task.assigneeId;

    const doneCode = await doneColumnCode();
    const applied = applyDoneRules(
      input.status,
      doneCode,
      { progress: input.progress, doneDate: task.doneDate },
      input.progress,
    );

    await db
      .update(tasks)
      .set({
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        assigneeId,
        status: input.status,
        priority: input.priority,
        progress: applied.progress,
        startDate: input.startDate,
        dueDate: input.dueDate,
        doneDate: input.doneDate ?? applied.doneDate,
        estimatedHours: input.estimatedHours,
        parentTaskId: input.parentTaskId === input.id ? null : input.parentTaskId,
        isMilestone: input.isMilestone,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, input.id));

    if (canReassign) await writeDependencies(input.id, input.dependsOn, task.productId);

    await writeAudit({
      entityType: "task",
      entityId: input.id,
      productId: task.productId,
      action: "update",
      actorId: actor.id,
      changes: [
        { field: "name", from: task.name, to: input.name },
        { field: "status", from: task.status, to: input.status },
        { field: "progress", from: task.progress, to: applied.progress },
        { field: "assigneeId", from: task.assigneeId, to: assigneeId },
        { field: "startDate", from: task.startDate, to: input.startDate },
        { field: "dueDate", from: task.dueDate, to: input.dueDate },
      ],
    });

    revalidatePath(`/produtos/${task.productId}/tarefas`);
    revalidatePath(`/produtos/${task.productId}/visao-geral`);
    return ok({ id: input.id }, "Tarefa atualizada.");
  } catch (error) {
    return toActionError(error);
  }
}

/** Kanban drop: new column plus the new order of that column. */
export async function moveTaskAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(moveTaskSchema, formData);
    if (!parsed.ok) return parsed.result;

    const loaded = await loadWritableTask(actor, parsed.data.id);
    if (!loaded.ok) return loaded.error;
    const { task } = loaded;

    const [column] = await db
      .select({ code: enumValues.code })
      .from(enumValues)
      .where(and(eq(enumValues.kind, "kanban_column"), eq(enumValues.code, parsed.data.status)))
      .limit(1);
    if (!column) return fail("Coluna inválida.");

    const doneCode = await doneColumnCode();
    const applied = applyDoneRules(parsed.data.status, doneCode, task);

    await db
      .update(tasks)
      .set({
        status: parsed.data.status,
        progress: applied.progress,
        doneDate: applied.doneDate,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));

    // Renumber the destination column so the order the user sees is the order
    // that is stored.
    await Promise.all(
      parsed.data.order.map((id, index) =>
        db
          .update(tasks)
          .set({ boardOrder: index })
          .where(and(eq(tasks.id, id), eq(tasks.productId, task.productId))),
      ),
    );

    await writeAudit({
      entityType: "task",
      entityId: task.id,
      productId: task.productId,
      action: "update",
      actorId: actor.id,
      changes: [
        { field: "status", from: task.status, to: parsed.data.status },
        { field: "progress", from: task.progress, to: applied.progress },
      ],
    });

    revalidatePath(`/produtos/${task.productId}/tarefas`);
    revalidatePath(`/produtos/${task.productId}/visao-geral`);
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

/** Gantt drag and resize. */
export async function rescheduleTaskAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(rescheduleTaskSchema, formData);
    if (!parsed.ok) return parsed.result;

    const loaded = await loadWritableTask(actor, parsed.data.id);
    if (!loaded.ok) return loaded.error;
    const { task } = loaded;

    await db
      .update(tasks)
      .set({
        startDate: parsed.data.startDate,
        dueDate: parsed.data.dueDate,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));

    await writeAudit({
      entityType: "task",
      entityId: task.id,
      productId: task.productId,
      action: "update",
      actorId: actor.id,
      changes: [
        { field: "startDate", from: task.startDate, to: parsed.data.startDate },
        { field: "dueDate", from: task.dueDate, to: parsed.data.dueDate },
      ],
    });

    revalidatePath(`/produtos/${task.productId}/tarefas`);
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function setProgressAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(setProgressSchema, formData);
    if (!parsed.ok) return parsed.result;

    const loaded = await loadWritableTask(actor, parsed.data.id);
    if (!loaded.ok) return loaded.error;
    const { task } = loaded;

    const doneCode = await doneColumnCode();
    // Reaching 100% moves the task to the done column, so the board and the
    // percentage never contradict each other.
    const status = parsed.data.progress >= 100 && doneCode ? doneCode : task.status;
    const doneDate =
      parsed.data.progress >= 100 ? (task.doneDate ?? todayIso()) : null;

    await db
      .update(tasks)
      .set({ progress: parsed.data.progress, status, doneDate, updatedAt: new Date() })
      .where(eq(tasks.id, task.id));

    await writeAudit({
      entityType: "task",
      entityId: task.id,
      productId: task.productId,
      action: "update",
      actorId: actor.id,
      changes: [{ field: "progress", from: task.progress, to: parsed.data.progress }],
    });

    revalidatePath(`/produtos/${task.productId}/tarefas`);
    revalidatePath(`/produtos/${task.productId}/visao-geral`);
    return ok(null);
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteTaskAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(deleteTaskSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [task] = await db.select().from(tasks).where(eq(tasks.id, parsed.data.id)).limit(1);
    if (!task) return fail("Tarefa não encontrada.");

    const product = await getProductRef(task.productId);
    if (!product) return fail("Produto não encontrado.");
    // Deleting is the product owner's call, not the assignee's.
    authorize(canEditProduct(actor, product), "Você só exclui tarefas de produtos de que é responsável.");

    await writeAudit({
      entityType: "task",
      entityId: task.id,
      productId: task.productId,
      action: "delete",
      actorId: actor.id,
      changes: [{ field: "name", from: task.name, to: null }],
    });

    await db.delete(tasks).where(eq(tasks.id, task.id));

    revalidatePath(`/produtos/${task.productId}/tarefas`);
    return ok(null, `Tarefa "${task.name}" excluída.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function addTaskCommentAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(taskCommentSchema, formData);
    if (!parsed.ok) return parsed.result;

    const loaded = await loadWritableTask(actor, parsed.data.taskId);
    if (!loaded.ok) return loaded.error;

    await db.insert(taskComments).values({
      taskId: parsed.data.taskId,
      authorId: actor.id,
      body: parsed.data.body,
    });

    revalidatePath(`/produtos/${loaded.task.productId}/tarefas`);
    return ok(null, "Comentário adicionado.");
  } catch (error) {
    return toActionError(error);
  }
}
