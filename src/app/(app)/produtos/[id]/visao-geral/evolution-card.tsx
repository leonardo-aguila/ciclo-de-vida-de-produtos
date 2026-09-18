"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatCompetence, formatCompetenceShort, formatDays, formatPercent } from "@/lib/format";
import type { ProductMetrics } from "@/lib/queries/metrics";

/**
 * Block B — how the project is moving.
 *
 * The S-curve compares planned accrual against what was actually finished. The
 * gap between the two lines is the schedule story in one picture.
 */
export function EvolutionCard({
  metrics,
  columnLabels,
}: {
  metrics: ProductMetrics;
  columnLabels: Record<string, string>;
}) {
  const deviation = metrics.tasks.scheduleDeviationDays;
  const curve = metrics.tasks.curve.map((point) => ({
    ...point,
    label: formatCompetenceShort(point.date),
  }));

  return (
    <Card>
      <CardHeader
        title="Evolução do projeto"
        description="Conclusão ponderada pelas horas estimadas de cada tarefa."
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Conclusão geral"
            value={formatPercent(metrics.tasks.progress, 0)}
            hint={`Esperado ${formatPercent(metrics.tasks.expected, 0)} a esta altura.`}
          />
          <Stat
            label="Tarefas atrasadas"
            value={String(metrics.tasks.late)}
            hint={`de ${metrics.tasks.total} ${metrics.tasks.total === 1 ? "tarefa" : "tarefas"}`}
            tone={metrics.tasks.late > 0 ? "bad" : "ok"}
          />
          <Stat
            label="Desvio de cronograma"
            value={deviation === null ? "—" : formatDays(Math.abs(deviation))}
            hint={
              deviation === null
                ? "Sem data prevista de lançamento."
                : deviation > 0
                  ? "além do lançamento previsto"
                  : "dentro do lançamento previsto"
            }
            tone={deviation === null ? "neutral" : deviation > 0 ? "bad" : "ok"}
          />
          <Stat
            label="Próximos vencimentos"
            value={`${metrics.tasks.dueIn7} / ${metrics.tasks.dueIn15} / ${metrics.tasks.dueIn30}`}
            hint="em 7 / 15 / 30 dias"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(metrics.tasks.byStatus).map(([status, count]) => (
            <Badge key={status} tone="neutral">
              {columnLabels[status] ?? status}: {count}
            </Badge>
          ))}
        </div>

        {curve.length < 2 ? (
          <EmptyState
            title="Curva S indisponível"
            description="A curva aparece quando houver ao menos dois meses de histórico financeiro ou de execução."
          />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={curve} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="curve-actual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "rgb(var(--fg-muted))" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgb(var(--border))" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(value: number) => `${value}%`}
                  tick={{ fontSize: 11, fill: "rgb(var(--fg-muted))" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  formatter={(value) => [
                    formatPercent(typeof value === "number" ? value : null, 0),
                    "",
                  ]}
                  labelFormatter={(_label, payload) =>
                    formatCompetence(payload?.[0]?.payload?.date ?? null)
                  }
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid rgb(var(--border))",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="planned"
                  name="Planejado"
                  stroke="#94a3b8"
                  strokeDasharray="5 4"
                  fill="none"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Realizado"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="url(#curve-actual)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "ok" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "bad" ? "text-red" : tone === "ok" ? "text-green" : "text-fg"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-[11px] text-fg-muted">{hint}</p> : null}
    </div>
  );
}
