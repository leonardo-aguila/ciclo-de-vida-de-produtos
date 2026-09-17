"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarDays, MoveRight, User } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { PRIORITY_LABELS } from "@/lib/labels";
import type { TaskRow } from "@/lib/queries/tasks";
import { cn } from "@/lib/utils";

export type Column = { code: string; label: string; color: string | null; isDone: boolean };

const PRIORITY_TONE = {
  critical: "red",
  high: "amber",
  medium: "blue",
  low: "neutral",
} as const;

/**
 * Kanban board.
 *
 * Dragging is the fast path; every card also carries a "mover" menu with the
 * destination columns and up/down buttons, so the board is fully usable from
 * the keyboard — not as a fallback, as the same operation.
 */
export function KanbanBoard({
  tasks,
  columns,
  canEdit,
  today,
  onMove,
  onOpenTask,
}: {
  tasks: TaskRow[];
  columns: Column[];
  canEdit: boolean;
  today: string;
  onMove: (taskId: string, status: string, orderedIds: string[]) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byColumn = React.useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const column of columns) map.set(column.code, []);
    for (const task of tasks) {
      // A task whose column was deleted must still be visible somewhere.
      const key = map.has(task.status) ? task.status : (columns[0]?.code ?? task.status);
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    for (const [key, list] of map) {
      map.set(
        key,
        [...list].sort((a, b) => a.boardOrder - b.boardOrder),
      );
    }
    return map;
  }, [tasks, columns]);

  function columnOf(taskId: string): string | null {
    for (const [code, list] of byColumn) {
      if (list.some((task) => task.id === taskId)) return code;
    }
    return null;
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const from = columnOf(taskId);
    // `over` is either a card or the column's droppable area.
    const overId = String(over.id);
    const to = columns.some((column) => column.code === overId) ? overId : columnOf(overId);
    if (!from || !to) return;

    const destination = [...(byColumn.get(to) ?? [])].filter((task) => task.id !== taskId);
    const overIndex = destination.findIndex((task) => task.id === overId);
    const insertAt = overIndex >= 0 ? overIndex : destination.length;

    const orderedIds = [
      ...destination.slice(0, insertAt).map((task) => task.id),
      taskId,
      ...destination.slice(insertAt).map((task) => task.id),
    ];

    if (from === to && orderedIds.join() === (byColumn.get(to) ?? []).map((t) => t.id).join()) {
      return;
    }
    onMove(taskId, to, orderedIds);
  }

  function moveWithinColumn(taskId: string, direction: -1 | 1) {
    const status = columnOf(taskId);
    if (!status) return;
    const list = [...(byColumn.get(status) ?? [])];
    const index = list.findIndex((task) => task.id === taskId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const [moved] = list.splice(index, 1);
    list.splice(target, 0, moved!);
    onMove(taskId, status, list.map((task) => task.id));
  }

  function moveToColumn(taskId: string, status: string) {
    const destination = (byColumn.get(status) ?? []).filter((task) => task.id !== taskId);
    onMove(taskId, status, [...destination.map((task) => task.id), taskId]);
  }

  const activeTask = activeId ? tasks.find((task) => task.id === activeId) : null;

  return (
    <DndContext
      // A stable id keeps dnd-kit's generated aria ids identical on the server
      // and on the client; without it every card hydrates with a mismatch.
      id="kanban-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((column) => {
          const list = byColumn.get(column.code) ?? [];
          return (
            <ColumnArea key={column.code} column={column} count={list.length}>
              <SortableContext
                items={list.map((task) => task.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-2">
                  {list.map((task, index) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      today={today}
                      canEdit={canEdit}
                      columns={columns}
                      currentColumn={column.code}
                      isFirst={index === 0}
                      isLast={index === list.length - 1}
                      onOpen={() => onOpenTask(task.id)}
                      onMoveColumn={(status) => moveToColumn(task.id, status)}
                      onMoveWithin={(direction) => moveWithinColumn(task.id, direction)}
                    />
                  ))}
                  {list.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-border px-2 py-6 text-center text-[11px] text-fg-muted">
                      Nenhuma tarefa
                    </li>
                  ) : null}
                </ul>
              </SortableContext>
            </ColumnArea>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-64 rotate-1 rounded-lg border border-brand bg-surface p-2 shadow-lg">
            <p className="text-xs font-medium">{activeTask.name}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ColumnArea({
  column,
  count,
  children,
}: {
  column: Column;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.code });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label}, ${count} ${count === 1 ? "tarefa" : "tarefas"}`}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl border border-border bg-surface-muted/40 p-2",
        isOver && "ring-2 ring-brand/40",
      )}
    >
      <header className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          {column.color ? (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: column.color }}
              aria-hidden
            />
          ) : null}
          {column.label}
        </span>
        <span className="text-[11px] text-fg-muted">{count}</span>
      </header>
      {children}
    </section>
  );
}

function TaskCard({
  task,
  today,
  canEdit,
  columns,
  currentColumn,
  isFirst,
  isLast,
  onOpen,
  onMoveColumn,
  onMoveWithin,
}: {
  task: TaskRow;
  today: string;
  canEdit: boolean;
  columns: Column[];
  currentColumn: string;
  isFirst: boolean;
  isLast: boolean;
  onOpen: () => void;
  onMoveColumn: (status: string) => void;
  onMoveWithin: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canEdit,
  });
  const [menuOpen, setMenuOpen] = React.useState(false);

  const late = Boolean(task.dueDate && task.dueDate < today && task.progress < 100);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-lg border border-border bg-surface p-2 shadow-sm",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...(canEdit ? listeners : {})}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left text-xs font-medium hover:text-brand"
      >
        {task.name}
      </button>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge>
        {task.categoryLabel ? (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px]"
            style={{
              backgroundColor: `${task.categoryColor ?? "#64748b"}1a`,
              color: task.categoryColor ?? undefined,
            }}
          >
            {task.categoryLabel}
          </span>
        ) : null}
        {late ? (
          <Badge tone="red">
            <AlertTriangle className="h-3 w-3" />
            Atrasada
          </Badge>
        ) : null}
      </div>

      {task.progress > 0 ? (
        <div className="mt-2">
          <div
            className="h-1 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-valuenow={task.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${task.name}: ${task.progress}% concluído`}
          >
            <div className="h-full bg-brand" style={{ width: `${task.progress}%` }} />
          </div>
          <span className="mt-0.5 block text-[10px] text-fg-muted">{task.progress}%</span>
        </div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-fg-muted">
        {task.assigneeName ? (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {task.assigneeName.split(" ")[0]}
          </span>
        ) : null}
        {task.dueDate ? (
          <span className={cn("flex items-center gap-1", late && "text-red")}>
            <CalendarDays className="h-3 w-3" />
            {formatDate(task.dueDate)}
          </span>
        ) : null}
      </div>

      {canEdit ? (
        <div className="mt-2 flex items-center gap-1 border-t border-border pt-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={isFirst}
            aria-label={`Subir ${task.name} na coluna`}
            onClick={() => onMoveWithin(-1)}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={isLast}
            aria-label={`Descer ${task.name} na coluna`}
            onClick={() => onMoveWithin(1)}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>

          <div className="relative ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoveRight className="h-3 w-3" />
              Mover
            </Button>
            {menuOpen ? (
              <ul
                role="menu"
                aria-label={`Mover ${task.name} para`}
                className="absolute right-0 z-40 mt-1 w-40 rounded-lg border border-border bg-surface p-1 shadow-lg"
              >
                {columns.map((column) => (
                  <li key={column.code} role="none">
                    <button
                      role="menuitem"
                      type="button"
                      disabled={column.code === currentColumn}
                      className="block w-full rounded px-2 py-1 text-left text-[11px] hover:bg-surface-muted disabled:opacity-40"
                      onClick={() => {
                        setMenuOpen(false);
                        onMoveColumn(column.code);
                      }}
                    >
                      {column.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
