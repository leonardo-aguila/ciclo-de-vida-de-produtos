"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import type { MonthlyPoint, Payback } from "@/lib/engine/finance";
import {
  formatCompetence,
  formatCompetenceShort,
  formatCurrency,
  formatCurrencyCompact,
} from "@/lib/format";

const COLORS = {
  revenue: "#2563eb",
  goal: "#7c3aed",
  plan: "#0891b2",
  cost: "#dc2626",
  accumulated: "#059669",
};

/**
 * Revenue realised against goal and plan, with accumulated cost and the payback
 * point marked. One chart, because the question it answers — when does this
 * product stop costing more than it brings — needs all four lines at once.
 */
export function RevenueChart({
  series,
  monthlyGoal,
  plannedByCompetence,
  payback: paybackResult,
}: {
  series: MonthlyPoint[];
  /** Primary goal converted to a monthly target, when there is one. */
  monthlyGoal: number | null;
  /** Business plan revenue by competence; empty until a plan exists. */
  plannedByCompetence: Record<string, number>;
  payback: Payback;
}) {
  if (series.length === 0) {
    return (
      <EmptyState
        title="Sem dados para o gráfico"
        description="Lance vendas mensais ou custos para ver a evolução da receita contra a meta e o custo acumulado."
      />
    );
  }

  const data = series.map((point) => ({
    competence: point.competence,
    label: formatCompetenceShort(point.competence),
    receita: point.revenue,
    meta: monthlyGoal,
    plano: plannedByCompetence[point.competence] ?? null,
    custoAcumulado: point.accumulatedCost,
    receitaAcumulada: point.accumulatedRevenue,
  }));

  const paybackLabel =
    paybackResult.competence && data.some((row) => row.competence === paybackResult.competence)
      ? formatCompetenceShort(paybackResult.competence)
      : null;

  const hasPlan = Object.keys(plannedByCompetence).length > 0;

  return (
    <div className="space-y-2">
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "rgb(var(--fg-muted))" }}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--border))" }}
            />
            <YAxis
              tickFormatter={(value: number) => formatCurrencyCompact(value)}
              tick={{ fontSize: 11, fill: "rgb(var(--fg-muted))" }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(typeof value === "number" ? value : null),
                name,
              ]}
              labelFormatter={(_label, payload) =>
                formatCompetence(payload?.[0]?.payload?.competence ?? null)
              }
              contentStyle={{
                borderRadius: 8,
                border: "1px solid rgb(var(--border))",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />

            <Bar dataKey="receita" name="Receita realizada" fill={COLORS.revenue} radius={[3, 3, 0, 0]} />
            {monthlyGoal !== null ? (
              <Line
                type="monotone"
                dataKey="meta"
                name="Meta"
                stroke={COLORS.goal}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            ) : null}
            {hasPlan ? (
              <Line
                type="monotone"
                dataKey="plano"
                name="Business Plan"
                stroke={COLORS.plan}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="custoAcumulado"
              name="Custo acumulado"
              stroke={COLORS.cost}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="receitaAcumulada"
              name="Receita acumulada"
              stroke={COLORS.accumulated}
              strokeWidth={2}
              dot={false}
            />

            {paybackLabel ? (
              <ReferenceLine
                x={paybackLabel}
                stroke={COLORS.accumulated}
                strokeDasharray="4 3"
                label={{
                  value: "Payback",
                  position: "top",
                  fontSize: 10,
                  fill: COLORS.accumulated,
                }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {paybackResult.status === "reached" ? (
          <Badge tone="green">
            Payback atingido em {formatCompetence(paybackResult.competence)}
          </Badge>
        ) : paybackResult.status === "estimated" ? (
          <Badge tone="amber">
            Payback estimado para {formatCompetence(paybackResult.competence)}
          </Badge>
        ) : paybackResult.status === "unreachable" ? (
          <Badge tone="red">
            No ritmo atual o custo recorrente supera a receita, e o payback não é alcançado
          </Badge>
        ) : (
          <Badge tone="neutral">Histórico insuficiente para estimar o payback</Badge>
        )}
        {paybackResult.status === "estimated" ? (
          <span>A data é projeção pelo ritmo recorrente dos últimos meses, não um fato.</span>
        ) : null}
        {!hasPlan ? <span>· A linha do Business Plan aparece quando houver um plano vigente.</span> : null}
      </div>
    </div>
  );
}
