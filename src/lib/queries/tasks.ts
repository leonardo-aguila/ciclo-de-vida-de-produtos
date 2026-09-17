import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@db";
import { enumValues, taskComments, taskDependencies, tasks, users } from "@db/schema";

export type TaskRow = {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  categoryColor: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  status: string;
  priority: "low" | "medium" | "high" | "critical";
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  doneDate: string | null;
  estimatedHours: number | null;
  parentTaskId: string | null;
  boardOrder: number;
  isMilestone: boolean;
  dependsOn: string[];
};

export async function listTasks(productId: string): Promise<TaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      productId: tasks.productId,
      name: tasks.name,
      description: tasks.description,
      categoryId: tasks.categoryId,
      categoryLabel: enumValues.label,
      categoryColor: enumValues.color,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
      status: tasks.status,
      priority: tasks.priority,
      progress: tasks.progress,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      doneDate: tasks.doneDate,
      estimatedHours: tasks.estimatedHours,
      parentTaskId: tasks.parentTaskId,
      boardOrder: tasks.boardOrder,
      isMilestone: tasks.isMilestone,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(enumValues, eq(enumValues.id, tasks.categoryId))
    .where(eq(tasks.productId, productId))
    .orderBy(asc(tasks.boardOrder), asc(tasks.name));

  if (rows.length === 0) return [];

  const dependencies = await db
    .select()
    .from(taskDependencies)
    .where(
      inArray(
        taskDependencies.taskId,
        rows.map((row) => row.id),
      ),
    );

  return rows.map((row) => ({
    ...row,
    dependsOn: dependencies
      .filter((dep) => dep.taskId === row.id)
      .map((dep) => dep.dependsOnTaskId),
  }));
}

/** Tasks of many products at once — the executive dashboard needs them. */
export async function listTasksFor(productIds: string[]) {
  if (productIds.length === 0) return [];
  return db
    .select({
      id: tasks.id,
      productId: tasks.productId,
      status: tasks.status,
      progress: tasks.progress,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      doneDate: tasks.doneDate,
      estimatedHours: tasks.estimatedHours,
    })
    .from(tasks)
    .where(inArray(tasks.productId, productIds));
}

export async function getTaskComments(taskId: string) {
  return db
    .select({
      id: taskComments.id,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
      authorName: users.name,
    })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.authorId))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));
}

/** Just enough of the task for the authorization check. */
export async function getTaskRef(id: string) {
  const [row] = await db
    .select({ id: tasks.id, productId: tasks.productId, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  return row ?? null;
}
