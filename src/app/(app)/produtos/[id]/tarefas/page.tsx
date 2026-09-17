import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@db";
import { enumValues, tasks, users } from "@db/schema";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/lib/auth/guard";
import { canEditProduct } from "@/lib/auth/policy";
import { formatDate, formatPercent } from "@/lib/format";
import { PRIORITY_LABELS } from "@/lib/labels";
import { listEnumValues } from "@/lib/queries/enums";
import { listPackages } from "@/lib/queries/packages";
import { getProduct } from "@/lib/queries/products";
import { ApplyPackage } from "./apply-package";

export const dynamic = "force-dynamic";

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();

  const [rows, packages, columns] = await Promise.all([
    db
      .select({
        id: tasks.id,
        name: tasks.name,
        status: tasks.status,
        priority: tasks.priority,
        progress: tasks.progress,
        startDate: tasks.startDate,
        dueDate: tasks.dueDate,
        assigneeName: users.name,
        categoryLabel: enumValues.label,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .leftJoin(enumValues, eq(enumValues.id, tasks.categoryId))
      .where(eq(tasks.productId, id))
      .orderBy(asc(tasks.boardOrder)),
    listPackages(),
    listEnumValues("kanban_column"),
  ]);

  const columnLabel = (code: string) =>
    columns.find((column) => column.code === code)?.label ?? code;

  return (
    <div className="space-y-4">
      {canEditProduct(user, product) ? (
        <ApplyPackage
          productId={product.id}
          packages={packages.map((p) => ({ id: p.id, name: p.name, taskCount: p.taskCount }))}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Tarefas"
          description="Gantt e Kanban entram na fase 4; por ora, a lista do que já foi replicado."
        />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              title="Nenhuma tarefa"
              description="Aplique um pacote padrão acima para criar o cronograma inicial deste produto."
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Tarefa</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Responsável</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Prioridade</th>
                  <th scope="col" className="num">
                    Conclusão
                  </th>
                  <th scope="col">Início</th>
                  <th scope="col">Prazo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <tr key={task.id}>
                    <td className="font-medium">{task.name}</td>
                    <td className="text-fg-muted">{task.categoryLabel ?? "—"}</td>
                    <td className="text-fg-muted">{task.assigneeName ?? "—"}</td>
                    <td>{columnLabel(task.status)}</td>
                    <td>{PRIORITY_LABELS[task.priority]}</td>
                    <td className="num">{formatPercent(task.progress, 0)}</td>
                    <td>{formatDate(task.startDate)}</td>
                    <td>{formatDate(task.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
