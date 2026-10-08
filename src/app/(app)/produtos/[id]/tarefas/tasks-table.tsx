"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import type { ReportItem, StatusKind } from "@/lib/engine/status-report";
import { cn } from "@/lib/utils";

const TONE: Record<StatusKind, { badge: "green" | "amber" | "neutral" | "red"; dot: string }> = {
  done: { badge: "green", dot: "bg-green" },
  doing: { badge: "amber", dot: "bg-amber" },
  todo: { badge: "neutral", dot: "bg-fg-muted" },
  overdue: { badge: "red", dot: "bg-red" },
};

type SortKey = "due" | "name" | "owner" | "status";

/** The order each column sorts in, and how it reads out loud. */
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Entrega" },
  { key: "owner", label: "Responsável · Área" },
  { key: "due", label: "Prazo" },
  { key: "status", label: "Status" },
];

const STATUS_ORDER: Record<StatusKind, number> = { overdue: 0, doing: 1, todo: 2, done: 3 };

/**
 * The deliveries as a table.
 *
 * The third view, beside the board and the chart, over the same rows. It is
 * the one that answers "what is late and whose is it" without scrolling a
 * timeline, which is the question a status meeting opens with — so the
 * default order is by deadline, and the overdue ones carry their own tone.
 */
export function TasksTable({ items }: { items: ReportItem[] }) {
  const [sort, setSort] = React.useState<{ key: SortKey; asc: boolean }>({
    key: "due",
    asc: true,
  });

  const sorted = React.useMemo(() => {
    const direction = sort.asc ? 1 : -1;
    return [...items].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name, "pt-BR") * direction;
        case "owner":
          return a.ownerLabel.localeCompare(b.ownerLabel, "pt-BR") * direction;
        case "status":
          return (STATUS_ORDER[a.kind] - STATUS_ORDER[b.kind]) * direction;
        case "due":
        default:
          // Sem prazo vai sempre para o fim, independente da direção: é
          // ausência de data, não uma data muito grande ou muito pequena.
          if (a.dueDate === null) return b.dueDate === null ? 0 : 1;
          if (b.dueDate === null) return -1;
          return a.dueDate.localeCompare(b.dueDate) * direction;
      }
    });
  }, [items, sort]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhuma entrega no recorte atual"
        description="Ajuste os filtros acima, ou aplique um pacote de tarefas para montar o plano do produto."
      />
    );
  }

  function toggle(key: SortKey) {
    setSort((current) => ({ key, asc: current.key === key ? !current.asc : true }));
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-fg-muted">
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className="px-2 py-2 font-medium"
                  // O estado da ordenação precisa existir fora da setinha:
                  // quem usa leitor de tela não enxerga o triângulo.
                  aria-sort={active ? (sort.asc ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => toggle(column.key)}
                    aria-label={`Ordenar por ${column.label}`}
                    className="flex items-center gap-1 hover:text-fg"
                  >
                    {column.label}
                    <span aria-hidden className={cn("text-[10px]", active ? "" : "opacity-0")}>
                      {sort.asc ? "▲" : "▼"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const tone = TONE[item.kind];
            return (
              <tr key={item.id} className="border-b border-border/60 last:border-0">
                <td className="px-2 py-2">
                  <span className="font-medium">{item.name}</span>
                  {item.reference ? (
                    <span className="ml-1.5 font-mono text-[11px] text-fg-muted">
                      {item.reference}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-fg-muted">{item.ownerLabel}</td>
                <td className="px-2 py-2 tabular-nums">
                  {item.dueDate ? (
                    <>
                      {formatDate(item.dueDate)}
                      {item.dLabel ? (
                        <span className="ml-1.5 text-[11px] text-fg-muted">{item.dLabel}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-fg-muted">sem prazo</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <Badge tone={tone.badge}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
                    {item.statusLabel}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
