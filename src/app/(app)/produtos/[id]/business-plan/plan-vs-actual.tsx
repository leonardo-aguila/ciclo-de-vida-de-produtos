"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import type { PlanComparisonRow } from "@/lib/engine/business-plan";
import {
  formatCompetence,
  formatCompetenceShort,
  formatCurrency,
  formatCurrencyCompact,
  formatSignedPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_TONE = { green: "green", amber: "amber", red: "red" } as const;
const STATUS_LABEL = { green: "No plano", amber: "Atenção", red: "Fora do plano" } as const;

/**
 * Plan versus reality, month by month and accumulated.
 *
 * Months that have not happened yet are shown but marked, and they stay out of
 * the accumulated deviation — counting a future month as a shortfall would
 * make every plan look like a failure from day one.
 */
export function PlanVsActual({
  rows,
  currency,
}: {
  rows: PlanComparisonRow[];
  currency: string;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader title="Plano × realizado" />
        <CardBody>
          <EmptyState
            title="Sem projeções para comparar"
            description="Preencha as projeções mensais acima para acompanhar o desvio contra o realizado."
          />
        </CardBody>
      </Card>
    );
  }

  const data = rows.map((row) => ({
    competence: row.competence,
    label: formatCompetenceShort(row.competence),
    planejado: row.plannedRevenue,
    realizado: row.hasActual ? row.actualRevenue : null,
    desvioAcumulado: row.hasActual ? row.accumulatedDeviationPct : null,
  }));

  return (
    <Card>
      <CardHeader
        title="Plano × realizado"
        description="Receita planejada contra a realizada, com o desvio acumulado no eixo da direita."
      />
      <CardBody className="space-y-4">
        <div className="h-72 w-full">
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
                yAxisId="money"
                tickFormatter={(value: number) => formatCurrencyCompact(value)}
                tick={{ fontSize: 11, fill: "rgb(var(--fg-muted))" }}
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                tickFormatter={(value: number) => `${value}%`}
                tick={{ fontSize: 11, fill: "rgb(var(--fg-muted))" }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === "Desvio acumulado"
                    ? [formatSignedPercent(typeof value === "number" ? value : null), name]
                    : [formatCurrency(typeof value === "number" ? value : null, currency), name]
                }
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
              <Bar
                yAxisId="money"
                dataKey="planejado"
                name="Planejado"
                fill="#94a3b8"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                yAxisId="money"
                dataKey="realizado"
                name="Realizado"
                fill="#2563eb"
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="desvioAcumulado"
                name="Desvio acumulado"
                stroke="#dc2626"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Competência</th>
                <th scope="col" className="num">Planejado</th>
                <th scope="col" className="num">Realizado</th>
                <th scope="col" className="num">Desvio</th>
                <th scope="col" className="num">Desvio %</th>
                <th scope="col" className="num">Acumulado planejado</th>
                <th scope="col" className="num">Acumulado realizado</th>
                <th scope="col" className="num">Desvio acumulado</th>
                <th scope="col">Farol</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.competence} className={cn(!row.hasActual && "opacity-60")}>
                  <td className="whitespace-nowrap">{formatCompetence(row.competence)}</td>
                  <td className="num">{formatCurrency(row.plannedRevenue, currency)}</td>
                  <td className="num">
                    {row.hasActual ? (
                      formatCurrency(row.actualRevenue, currency)
                    ) : (
                      <span className="text-fg-muted">mês futuro</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "num",
                      row.hasActual && row.revenueDeviation < 0 && "text-red",
                      row.hasActual && row.revenueDeviation > 0 && "text-green",
                    )}
                  >
                    {row.hasActual ? formatCurrency(row.revenueDeviation, currency) : "—"}
                  </td>
                  <td className="num">
                    {row.hasActual ? formatSignedPercent(row.revenueDeviationPct) : "—"}
                  </td>
                  <td className="num text-fg-muted">
                    {formatCurrency(row.accumulatedPlannedRevenue, currency)}
                  </td>
                  <td className="num text-fg-muted">
                    {formatCurrency(row.accumulatedActualRevenue, currency)}
                  </td>
                  <td className="num">
                    {row.hasActual ? formatSignedPercent(row.accumulatedDeviationPct) : "—"}
                  </td>
                  <td>
                    {row.hasActual ? (
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    ) : (
                      <Badge tone="neutral">Futuro</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
