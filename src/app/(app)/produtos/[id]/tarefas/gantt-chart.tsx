"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { criticalPath } from "@/lib/engine/schedule";
import { addDaysToIso, daysBetween, formatDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskRow } from "@/lib/queries/tasks";

export type Zoom = "day" | "week" | "month" | "quarter";
export type GroupBy = "none" | "category" | "assignee";

const DAY_WIDTH: Record<Zoom, number> = { day: 28, week: 9, month: 3.2, quarter: 1.3 };
const ROW_HEIGHT = 34;
const LABEL_WIDTH = 240;

const ZOOM_LABELS: Record<Zoom, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
  quarter: "Trimestre",
};

type Drag =
  | { taskId: string; mode: "move" | "start" | "end"; originX: number; deltaDays: number }
  | null;

/**
 * Gantt chart.
 *
 * Hand-built because no free React chart draws dependency arrows, a critical
 * path and draggable bars at once. Positions are pure arithmetic on day
 * offsets: `left = daysFromOrigin * dayWidth`, which keeps the bars, the grid,
 * the today line and the arrows on the same coordinate system.
 */
export function GanttChart({
  tasks,
  launchDate,
  zoom,
  groupBy,
  canEdit,
  onReschedule,
  onOpenTask,
}: {
  tasks: TaskRow[];
  launchDate: string | null;
  zoom: Zoom;
  groupBy: GroupBy;
  canEdit: boolean;
  onReschedule: (taskId: string, startDate: string, dueDate: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [drag, setDrag] = React.useState<Drag>(null);
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const dayWidth = DAY_WIDTH[zoom];
  const today = todayIso();

  const dated = tasks.filter((task) => task.startDate && task.dueDate);
  const undated = tasks.filter((task) => !task.startDate || !task.dueDate);

  const { criticalIds } = React.useMemo(
    () =>
      criticalPath(
        dated.map((task) => ({
          id: task.id,
          startDate: task.startDate,
          dueDate: task.dueDate,
          dependsOn: task.dependsOn,
        })),
      ),
    [dated],
  );

  // Timeline bounds, padded so bars never touch the edges.
  const bounds = React.useMemo(() => {
    const dates = dated.flatMap((task) => [task.startDate!, task.dueDate!]);
    if (launchDate) dates.push(launchDate);
    dates.push(today);
    if (dates.length === 0) return null;

    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const pad = zoom === "day" ? 3 : zoom === "week" ? 7 : 20;
    return { origin: addDaysToIso(min, -pad), end: addDaysToIso(max, pad) };
  }, [dated, launchDate, today, zoom]);

  const totalDays = bounds ? daysBetween(bounds.origin, bounds.end) + 1 : 0;
  const timelineWidth = Math.max(totalDays * dayWidth, 600);

  const rows = React.useMemo(() => buildRows(tasks, groupBy), [tasks, groupBy]);

  // Row index of each task, so the arrows know where the bars are.
  const rowIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.kind === "task") map.set(row.task.id, index);
    });
    return map;
  }, [rows]);

  const x = React.useCallback(
    (date: string) => (bounds ? daysBetween(bounds.origin, date) * dayWidth : 0),
    [bounds, dayWidth],
  );

  /** The dates a bar is showing right now, drag preview included. */
  const previewDates = React.useCallback(
    (task: TaskRow) => {
      const start = task.startDate!;
      const end = task.dueDate!;
      if (!drag || drag.taskId !== task.id || drag.deltaDays === 0) return { start, end };

      if (drag.mode === "move") {
        return {
          start: addDaysToIso(start, drag.deltaDays),
          end: addDaysToIso(end, drag.deltaDays),
        };
      }
      if (drag.mode === "start") {
        const next = addDaysToIso(start, drag.deltaDays);
        // Resizing past the other edge would invert the bar.
        return { start: next > end ? end : next, end };
      }
      const next = addDaysToIso(end, drag.deltaDays);
      return { start, end: next < start ? start : next };
    },
    [drag],
  );

  function startDrag(event: React.PointerEvent, task: TaskRow, mode: "move" | "start" | "end") {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({ taskId: task.id, mode, originX: event.clientX, deltaDays: 0 });
    try {
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Without capture the move events still reach the timeline container.
    }
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag) return;
    const deltaDays = Math.round((event.clientX - drag.originX) / dayWidth);
    if (deltaDays !== drag.deltaDays) setDrag({ ...drag, deltaDays });
  }

  function endDrag() {
    if (!drag) return;
    const task = tasks.find((row) => row.id === drag.taskId);
    if (task && drag.deltaDays !== 0) {
      const { start, end } = previewDates(task);
      if (start !== task.startDate || end !== task.dueDate) onReschedule(task.id, start, end);
    }
    setDrag(null);
  }

  if (tasks.length === 0 || !bounds) {
    return (
      <EmptyState
        title="Nada para exibir no cronograma"
        description="Cadastre tarefas com data de início e prazo para que elas apareçam na linha do tempo."
      />
    );
  }

  const ticks = buildTicks(bounds.origin, totalDays, zoom);
  const chartHeight = rows.length * ROW_HEIGHT;

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex">
        {/* Fixed task names. */}
        <div className="shrink-0 border-r border-border" style={{ width: LABEL_WIDTH }}>
          <div className="h-10 border-b border-border bg-surface-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            Tarefa
          </div>
          {rows.map((row, index) =>
            row.kind === "group" ? (
              <div
                key={`group-${row.label}-${index}`}
                className="flex items-center border-b border-border bg-surface-muted/40 px-3 text-xs font-semibold"
                style={{ height: ROW_HEIGHT }}
              >
                {row.label}
              </div>
            ) : (
              <button
                key={row.task.id}
                type="button"
                onClick={() => onOpenTask(row.task.id)}
                className="flex w-full items-center gap-1.5 border-b border-border px-3 text-left text-xs hover:bg-surface-muted/60"
                style={{ height: ROW_HEIGHT }}
              >
                {criticalIds.has(row.task.id) ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-red"
                    title="Caminho crítico"
                    aria-label="Caminho crítico"
                  />
                ) : null}
                <span className="truncate">{row.task.name}</span>
              </button>
            ),
          )}
        </div>

        {/* Scrollable timeline. */}
        <div className="min-w-0 flex-1 overflow-x-auto" ref={timelineRef}>
          <div style={{ width: timelineWidth }}>
            <div className="relative h-10 border-b border-border bg-surface-muted/60">
              {ticks.map((tick) => (
                <div
                  key={tick.date}
                  className="absolute top-0 h-full border-l border-border/70 px-1 pt-2 text-[10px] text-fg-muted"
                  style={{ left: x(tick.date) }}
                >
                  <span className="whitespace-nowrap">{tick.label}</span>
                </div>
              ))}
            </div>

            <div
              className="relative select-none"
              style={{ height: chartHeight }}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {/* Grid. */}
              {ticks.map((tick) => (
                <div
                  key={`grid-${tick.date}`}
                  className="absolute top-0 border-l border-border/40"
                  style={{ left: x(tick.date), height: chartHeight }}
                />
              ))}

              {/* Row separators. */}
              {rows.map((row, index) => (
                <div
                  key={`row-${index}`}
                  className={cn(
                    "absolute left-0 right-0 border-b border-border/60",
                    row.kind === "group" && "bg-surface-muted/40",
                  )}
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                />
              ))}

              {/* Launch milestone. */}
              {launchDate ? (
                <div
                  className="absolute top-0 z-10 border-l-2 border-dashed border-violet"
                  style={{ left: x(launchDate), height: chartHeight }}
                  title={`Lançamento previsto: ${formatDate(launchDate)}`}
                >
                  <span className="absolute -top-0 left-1 whitespace-nowrap rounded bg-violet px-1 py-0.5 text-[9px] font-medium text-white">
                    Lançamento
                  </span>
                </div>
              ) : null}

              {/* Today. */}
              <div
                className="absolute top-0 z-10 border-l-2 border-red"
                style={{ left: x(today), height: chartHeight }}
                title={`Hoje: ${formatDate(today)}`}
              />

              {/* Dependency arrows. */}
              <svg
                className="pointer-events-none absolute inset-0 z-20"
                width={timelineWidth}
                height={chartHeight}
                aria-hidden
              >
                <defs>
                  <marker
                    id="gantt-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 z" fill="rgb(var(--fg-muted))" />
                  </marker>
                </defs>
                {dated.flatMap((task) =>
                  task.dependsOn
                    .map((depId) => {
                      const dep = dated.find((row) => row.id === depId);
                      const fromRow = rowIndexById.get(depId);
                      const toRow = rowIndexById.get(task.id);
                      if (!dep || fromRow === undefined || toRow === undefined) return null;

                      const fromX = x(previewDates(dep).end) + dayWidth;
                      const fromY = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
                      const toX = x(previewDates(task).start);
                      const toY = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
                      const isCritical = criticalIds.has(depId) && criticalIds.has(task.id);
                      // Elbow: out of the predecessor, across, into the successor.
                      const midX = Math.max(fromX + 8, toX - 8);

                      return (
                        <polyline
                          key={`${depId}-${task.id}`}
                          points={`${fromX},${fromY} ${midX},${fromY} ${midX},${toY} ${toX},${toY}`}
                          fill="none"
                          stroke={isCritical ? "rgb(var(--red))" : "rgb(var(--fg-muted))"}
                          strokeWidth={isCritical ? 1.5 : 1}
                          strokeOpacity={isCritical ? 0.9 : 0.45}
                          markerEnd="url(#gantt-arrow)"
                        />
                      );
                    })
                    .filter(Boolean),
                )}
              </svg>

              {/* Bars. */}
              {rows.map((row, index) => {
                if (row.kind !== "task") return null;
                const task = row.task;
                if (!task.startDate || !task.dueDate) return null;

                const { start, end } = previewDates(task);
                const left = x(start);
                const width = Math.max((daysBetween(start, end) + 1) * dayWidth, 6);
                const isCritical = criticalIds.has(task.id);
                const late = task.dueDate < today && task.progress < 100;

                if (task.isMilestone) {
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpenTask(task.id)}
                      onPointerDown={(event) => startDrag(event, task, "move")}
                      className="absolute z-30 flex items-center justify-center"
                      style={{
                        left: left - 7,
                        top: index * ROW_HEIGHT + ROW_HEIGHT / 2 - 7,
                        width: 14,
                        height: 14,
                      }}
                      title={`${task.name} — ${formatDate(start)}`}
                    >
                      <span className="block h-3 w-3 rotate-45 bg-violet" />
                    </button>
                  );
                }

                return (
                  <div
                    key={task.id}
                    className={cn(
                      "group absolute z-30 rounded",
                      canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                    )}
                    style={{
                      left,
                      top: index * ROW_HEIGHT + 7,
                      width,
                      height: ROW_HEIGHT - 14,
                    }}
                    onPointerDown={(event) => startDrag(event, task, "move")}
                    onClick={() => drag === null && onOpenTask(task.id)}
                    title={`${task.name}\n${formatDate(start)} → ${formatDate(end)}\n${task.progress}% concluído`}
                  >
                    <div
                      className={cn(
                        "relative h-full w-full overflow-hidden rounded border",
                        isCritical
                          ? "border-red/60 bg-red/15"
                          : late
                            ? "border-amber/60 bg-amber/15"
                            : "border-brand/50 bg-brand/15",
                      )}
                    >
                      {/* Progress fill. */}
                      <div
                        className={cn(
                          "absolute inset-y-0 left-0",
                          isCritical ? "bg-red/50" : late ? "bg-amber/50" : "bg-brand/50",
                        )}
                        style={{ width: `${task.progress}%` }}
                      />
                      <span className="relative z-10 block truncate px-1.5 text-[10px] leading-5">
                        {width > 60 ? task.name : ""}
                      </span>
                    </div>

                    {canEdit ? (
                      <>
                        <span
                          role="presentation"
                          onPointerDown={(event) => startDrag(event, task, "start")}
                          className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
                        >
                          <span className="block h-full w-1 rounded bg-fg-muted/60" />
                        </span>
                        <span
                          role="presentation"
                          onPointerDown={(event) => startDrag(event, task, "end")}
                          className="absolute inset-y-0 -right-1 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
                        >
                          <span className="ml-1 block h-full w-1 rounded bg-fg-muted/60" />
                        </span>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-muted/40 px-3 py-2 text-[11px] text-fg-muted">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-brand/50" /> No prazo
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber/50" /> Atrasada
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red/50" /> Caminho crítico
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-0.5 bg-red" /> Hoje
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-0.5 border-l-2 border-dashed border-violet" /> Lançamento
        </span>
        <span className="ml-auto">Zoom: {ZOOM_LABELS[zoom]}</span>
        {undated.length > 0 ? (
          <Badge tone="amber">
            {undated.length} {undated.length === 1 ? "tarefa sem datas" : "tarefas sem datas"}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows and ticks                                                             */
/* -------------------------------------------------------------------------- */

type Row = { kind: "task"; task: TaskRow } | { kind: "group"; label: string };

function buildRows(tasks: TaskRow[], groupBy: GroupBy): Row[] {
  const ordered = [...tasks].sort((a, b) => {
    const aStart = a.startDate ?? "9999-12-31";
    const bStart = b.startDate ?? "9999-12-31";
    return aStart === bStart ? a.name.localeCompare(b.name, "pt-BR") : aStart < bStart ? -1 : 1;
  });

  if (groupBy === "none") return ordered.map((task) => ({ kind: "task" as const, task }));

  const key = (task: TaskRow) =>
    groupBy === "category" ? (task.categoryLabel ?? "Sem categoria") : (task.assigneeName ?? "Sem responsável");

  const groups = new Map<string, TaskRow[]>();
  for (const task of ordered) {
    const label = key(task);
    groups.set(label, [...(groups.get(label) ?? []), task]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .flatMap(([label, groupTasks]) => [
      { kind: "group" as const, label: `${label} (${groupTasks.length})` },
      ...groupTasks.map((task) => ({ kind: "task" as const, task })),
    ]);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function buildTicks(origin: string, totalDays: number, zoom: Zoom) {
  const ticks: { date: string; label: string }[] = [];

  for (let offset = 0; offset < totalDays; offset += 1) {
    const date = addDaysToIso(origin, offset);
    const parts = date.split("-").map(Number);
    const day = parts[2]!;
    const month = parts[1]!;
    const year = parts[0]!;
    const weekday = new Date(year, month - 1, day).getDay();

    if (zoom === "day") {
      ticks.push({ date, label: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}` });
    } else if (zoom === "week") {
      // Mondays.
      if (weekday === 1) {
        ticks.push({ date, label: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}` });
      }
    } else if (zoom === "month") {
      if (day === 1) ticks.push({ date, label: `${MONTHS[month - 1]}/${String(year).slice(2)}` });
    } else if (day === 1 && (month - 1) % 3 === 0) {
      ticks.push({ date, label: `T${Math.floor((month - 1) / 3) + 1}/${String(year).slice(2)}` });
    }
  }

  return ticks;
}
