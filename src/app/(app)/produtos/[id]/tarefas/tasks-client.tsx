"use client";

import { GanttChartSquare, KanbanSquare, Plus, Table2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { moveTaskAction, rescheduleTaskAction } from "@/app/actions/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FormError, FormSuccess } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { countLateTasks, overallProgress } from "@/lib/engine/schedule";
import { formatPercent, todayIso } from "@/lib/format";
import { PRIORITY_LABELS } from "@/lib/labels";
import type { TaskRow } from "@/lib/queries/tasks";
import { cn } from "@/lib/utils";
import { buildStatusReport } from "@/lib/engine/status-report";
import { GanttChart, type GroupBy, type Zoom } from "./gantt-chart";
import { KanbanBoard, type Column } from "./kanban-board";
import { StatusExport } from "./status-export";
import { TasksTable } from "./tasks-table";
import { TaskDialog } from "./task-dialog";

type Option = { id: string; label: string };

/**
 * Holds the task list for both views.
 *
 * Every mutation is optimistic: the board moves first and the server is told
 * afterwards. A refusal puts the previous list back and says why — the screen
 * must never keep showing a change the database rejected.
 */
export function TasksClient({
  productId,
  productName,
  tasks: initial,
  columns,
  categories,
  assignees,
  launchDate,
  canEdit,
  canManage,
  currentUserId,
}: {
  productId: string;
  productName: string;
  tasks: TaskRow[];
  columns: Column[];
  categories: Option[];
  assignees: Option[];
  launchDate: string | null;
  canEdit: boolean;
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [tasks, setTasks] = React.useState(initial);
  const [view, setView] = React.useState<"kanban" | "gantt" | "tabela">("kanban");
  const [zoom, setZoom] = React.useState<Zoom>("week");
  const [groupBy, setGroupBy] = React.useState<GroupBy>("none");
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dialogTask, setDialogTask] = React.useState<TaskRow | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const [filters, setFilters] = React.useState({
    assignee: "",
    category: "",
    priority: "",
    late: false,
  });

  React.useEffect(() => setTasks(initial), [initial]);

  const today = todayIso();

  const visible = React.useMemo(
    () =>
      tasks.filter((task) => {
        if (filters.assignee && task.assigneeId !== filters.assignee) return false;
        if (filters.category && task.categoryId !== filters.category) return false;
        if (filters.priority && task.priority !== filters.priority) return false;
        if (filters.late) {
          const late = Boolean(task.dueDate && task.dueDate < today && task.progress < 100);
          if (!late) return false;
        }
        return true;
      }),
    [tasks, filters, today],
  );

  // O mesmo relatório alimenta a tabela, o PowerPoint e o texto. Ele segue os
  // filtros da tela: exportar um recorte diferente do que está à vista seria
  // entregar um status que ninguém conferiu.
  const doneColumns = React.useMemo(
    () => columns.filter((column) => column.isDone).map((column) => column.code),
    [columns],
  );
  const doingColumns = React.useMemo(
    () =>
      columns
        .filter((column) => !column.isDone && !["backlog", "todo"].includes(column.code))
        .map((column) => column.code),
    [columns],
  );

  const report = React.useMemo(
    () =>
      buildStatusReport({
        productName,
        launchDate,
        today,
        tasks: visible.map((task) => ({
          id: task.id,
          name: task.name,
          assigneeName: task.assigneeName,
          categoryLabel: task.categoryLabel,
          dueDate: task.dueDate,
          status: task.status,
          description: task.description,
        })),
        doneColumns,
        doingColumns,
      }),
    [productName, launchDate, today, visible, doneColumns, doingColumns],
  );

  /** Applies the change locally, then asks the server; reverts on refusal. */
  async function optimistic(next: TaskRow[], run: () => Promise<{ ok: boolean; error?: string }>) {
    const previous = tasks;
    setTasks(next);
    setError(null);
    const result = await run();
    if (!result.ok) {
      setTasks(previous);
      setError(result.error ?? "Não foi possível salvar a alteração.");
      return;
    }
    router.refresh();
  }

  function handleMove(taskId: string, status: string, orderedIds: string[]) {
    const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
    const doneColumn = columns.find((column) => column.isDone);
    const isDone = doneColumn?.code === status;

    const next = tasks.map((task) => {
      if (task.id === taskId) {
        return {
          ...task,
          status,
          boardOrder: orderIndex.get(task.id) ?? task.boardOrder,
          progress: isDone ? 100 : task.progress >= 100 ? 99 : task.progress,
          doneDate: isDone ? (task.doneDate ?? today) : null,
        };
      }
      return orderIndex.has(task.id)
        ? { ...task, boardOrder: orderIndex.get(task.id)! }
        : task;
    });

    void optimistic(next, async () => {
      const form = new FormData();
      form.set("id", taskId);
      form.set("status", status);
      form.set("order", JSON.stringify(orderedIds));
      const result = await moveTaskAction(null, form);
      return { ok: result.ok, error: result.ok ? undefined : result.error };
    });
  }

  function handleReschedule(taskId: string, startDate: string, dueDate: string) {
    const next = tasks.map((task) =>
      task.id === taskId ? { ...task, startDate, dueDate } : task,
    );

    void optimistic(next, async () => {
      const form = new FormData();
      form.set("id", taskId);
      form.set("startDate", startDate);
      form.set("dueDate", dueDate);
      const result = await rescheduleTaskAction(null, form);
      return { ok: result.ok, error: result.ok ? undefined : result.error };
    });
  }

  function openTask(taskId: string) {
    setDialogTask(tasks.find((task) => task.id === taskId) ?? null);
    setDialogOpen(true);
  }

  const progress = overallProgress(visible);
  const lateCount = countLateTasks(visible, today);
  const hasFilters = Boolean(
    filters.assignee || filters.category || filters.priority || filters.late,
  );

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="Visualização"
              className="flex rounded-lg border border-border p-0.5"
            >
              <button
                type="button"
                aria-pressed={view === "kanban"}
                onClick={() => setView("kanban")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                  view === "kanban" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <KanbanSquare className="h-3.5 w-3.5" />
                Kanban
              </button>
              <button
                type="button"
                aria-pressed={view === "gantt"}
                onClick={() => setView("gantt")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                  view === "gantt" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <GanttChartSquare className="h-3.5 w-3.5" />
                Gantt
              </button>
              <button
                type="button"
                aria-pressed={view === "tabela"}
                onClick={() => setView("tabela")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs",
                  view === "tabela" ? "bg-brand text-brand-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <Table2 className="h-3.5 w-3.5" />
                Tabela
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span>
                {visible.length} {visible.length === 1 ? "tarefa" : "tarefas"}
              </span>
              <span>·</span>
              <span>{formatPercent(progress, 0)} concluído</span>
              {lateCount > 0 ? (
                <Badge tone="red">
                  {lateCount} {lateCount === 1 ? "atrasada" : "atrasadas"}
                </Badge>
              ) : null}
              <StatusExport productId={productId} report={report} today={today} />
              {canManage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setDialogTask(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Nova tarefa
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="filter-assignee">
                Responsável
              </label>
              <select
                id="filter-assignee"
                className="input"
                value={filters.assignee}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, assignee: event.target.value }))
                }
              >
                <option value="">Todos</option>
                <option value={currentUserId}>Minhas tarefas</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="filter-category">
                Categoria
              </label>
              <select
                id="filter-category"
                className="input"
                value={filters.category}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, category: event.target.value }))
                }
              >
                <option value="">Todas</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="filter-priority">
                Prioridade
              </label>
              <select
                id="filter-priority"
                className="input"
                value={filters.priority}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, priority: event.target.value }))
                }
              >
                <option value="">Todas</option>
                {(["critical", "high", "medium", "low"] as const).map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex h-9 items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={filters.late}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, late: event.target.checked }))
                }
              />
              Só atrasadas
            </label>

            {view === "gantt" ? (
              <>
                <div>
                  <label className="label" htmlFor="gantt-zoom">
                    Zoom
                  </label>
                  <select
                    id="gantt-zoom"
                    className="input"
                    value={zoom}
                    onChange={(event) => setZoom(event.target.value as Zoom)}
                  >
                    <option value="day">Dia</option>
                    <option value="week">Semana</option>
                    <option value="month">Mês</option>
                    <option value="quarter">Trimestre</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="gantt-group">
                    Agrupar por
                  </label>
                  <select
                    id="gantt-group"
                    className="input"
                    value={groupBy}
                    onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                  >
                    <option value="none">Sem agrupamento</option>
                    <option value="category">Categoria</option>
                    <option value="assignee">Responsável</option>
                  </select>
                </div>
              </>
            ) : null}

            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setFilters({ assignee: "", category: "", priority: "", late: false })
                }
              >
                <X className="h-4 w-4" />
                Limpar filtros
              </Button>
            ) : null}
          </div>

          {error ? <FormError message={error} /> : null}
          {notice ? <FormSuccess message={notice} /> : null}
        </CardBody>
      </Card>

      {tasks.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma tarefa"
            description="Crie a primeira tarefa ou aplique um pacote padrão para montar o cronograma deste produto."
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma tarefa com esses filtros"
            description="Ajuste ou limpe os filtros para ver o quadro inteiro."
          />
        </Card>
      ) : view === "tabela" ? (
        <Card>
          <CardBody>
            <TasksTable items={report.items} />
          </CardBody>
        </Card>
      ) : view === "kanban" ? (
        <KanbanBoard
          tasks={visible}
          columns={columns}
          canEdit={canEdit}
          today={today}
          onMove={handleMove}
          onOpenTask={openTask}
        />
      ) : (
        <GanttChart
          tasks={visible}
          launchDate={launchDate}
          zoom={zoom}
          groupBy={groupBy}
          canEdit={canManage}
          onReschedule={handleReschedule}
          onOpenTask={openTask}
        />
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productId={productId}
        task={dialogTask}
        tasks={tasks}
        columns={columns}
        categories={categories}
        assignees={assignees}
        canEdit={
          canManage || (dialogTask !== null && dialogTask.assigneeId === currentUserId && canEdit)
        }
        canDelete={canManage}
        onSaved={(message) => {
          setNotice(message);
          router.refresh();
        }}
      />
    </div>
  );
}
