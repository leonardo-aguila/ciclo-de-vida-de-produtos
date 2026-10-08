import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { canEditProduct, canEditTask } from "@/lib/auth/policy";
import { findDoneColumn, listEnumValues } from "@/lib/queries/enums";
import { listPackages } from "@/lib/queries/packages";
import { getProduct, listProductOwners } from "@/lib/queries/products";
import { listTasks } from "@/lib/queries/tasks";
import { ApplyPackage } from "./apply-package";
import { TasksClient } from "./tasks-client";

export const dynamic = "force-dynamic";

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();

  const [tasks, columnValues, categories, people, packages] = await Promise.all([
    listTasks(id),
    listEnumValues("kanban_column"),
    listEnumValues("task_category"),
    listProductOwners(),
    listPackages(),
  ]);

  const doneCode = findDoneColumn(columnValues)?.code ?? null;
  const canManage = canEditProduct(user, product);

  // A collaborator can act on the board when at least one card is theirs;
  // the server re-checks each individual move regardless.
  const canEdit =
    canManage ||
    tasks.some((task) => canEditTask(user, task, product));

  return (
    <div className="space-y-4">
      {canManage ? (
        <ApplyPackage
          productId={product.id}
          packages={packages.map((p) => ({ id: p.id, name: p.name, taskCount: p.taskCount }))}
        />
      ) : null}

      <TasksClient
        productId={product.id}
        productName={product.name}
        tasks={tasks}
        columns={columnValues.map((column) => ({
          code: column.code,
          label: column.label,
          color: column.color,
          isDone: column.code === doneCode,
        }))}
        categories={categories.map((category) => ({ id: category.id, label: category.label }))}
        assignees={people.map((person) => ({ id: person.id, label: person.name }))}
        // O D0 do status é o lançamento que aconteceu, quando aconteceu.
        launchDate={product.actualLaunchDate ?? product.plannedLaunchDate}
        canEdit={canEdit}
        canManage={canManage}
        currentUserId={user.id}
      />
    </div>
  );
}
