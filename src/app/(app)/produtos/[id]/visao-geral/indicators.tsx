import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ProductMetrics } from "@/lib/queries/metrics";
import {
  formatCurrency,
  formatDays,
  formatInteger,
  formatMonths,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  daysBetween,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LifecyclePhase } from "@db/schema";

export type Indicator = {
  label: string;
  value: string;
  hint?: string;
  /** `warn` and `bad` are what "fora do esperado" means on screen. */
  status?: "ok" | "warn" | "bad" | "neutral";
  trend?: "up" | "down" | "flat";
};

/**
 * The indicators that matter in each phase.
 *
 * A product in conception is judged by how much it has learned; one in decline,
 * by whether it still pays for itself. Showing the same six numbers everywhere
 * would bury the one that matters now.
 */
export function phaseIndicators(
  metrics: ProductMetrics,
  phase: LifecyclePhase,
  product: { plannedLaunchDate: string | null; actualLaunchDate: string | null },
): Indicator[] {
  const currentPhase = metrics.phases.find((entry) => entry.current);
  const timeInPhase: Indicator = {
    label: "Tempo na fase atual",
    value: currentPhase ? formatDays(currentPhase.days) : "—",
    status: "neutral",
  };

  switch (phase) {
    case "conception":
      return [
        {
          label: "Insights validados",
          value: `${formatInteger(metrics.insights.validated)} de ${formatInteger(metrics.insights.total)}`,
          hint: "Aprovados, em execução ou concluídos.",
          status: metrics.insights.total === 0 ? "warn" : "ok",
        },
        {
          label: "Esforço estimado acumulado",
          value: metrics.effort.estimatedHours > 0 ? `${formatNumber(metrics.effort.estimatedHours, 0)} h` : "—",
          hint: "Soma das horas estimadas nas tarefas.",
          status: "neutral",
        },
        {
          label: "Investimento comprometido",
          value: formatCurrency(metrics.costs.capex + metrics.costs.investment),
          hint: "CAPEX e investimentos lançados.",
          status: "neutral",
        },
        timeInPhase,
      ];

    case "development": {
      const deviation = metrics.tasks.scheduleDeviationDays;
      return [
        {
          label: "Conclusão do pacote de tarefas",
          value: formatPercent(metrics.tasks.progress, 0),
          hint: `Esperado ${formatPercent(metrics.tasks.expected, 0)} a esta altura.`,
          status:
            metrics.tasks.total === 0
              ? "neutral"
              : metrics.tasks.progress >= metrics.tasks.expected
                ? "ok"
                : metrics.tasks.progress >= metrics.tasks.expected * 0.8
                  ? "warn"
                  : "bad",
        },
        {
          label: "Burn de CAPEX",
          value: formatCurrency(metrics.costs.capex),
          hint: "Total de CAPEX lançado até aqui.",
          status: "neutral",
        },
        {
          label: "Desvio do prazo de lançamento",
          value: deviation === null ? "—" : formatDays(Math.abs(deviation)),
          hint:
            deviation === null
              ? "Sem data prevista de lançamento ou sem tarefas datadas."
              : deviation > 0
                ? "O cronograma termina depois do lançamento previsto."
                : "O cronograma cabe dentro do prazo previsto.",
          status: deviation === null ? "neutral" : deviation > 30 ? "bad" : deviation > 0 ? "warn" : "ok",
        },
        {
          label: "Tarefas atrasadas",
          value: formatInteger(metrics.tasks.late),
          status: metrics.tasks.late === 0 ? "ok" : metrics.tasks.late > 3 ? "bad" : "warn",
        },
      ];
    }

    case "launch": {
      const reference = product.actualLaunchDate ?? product.plannedLaunchDate;
      const days = reference ? daysBetween(metrics.today, reference) : null;
      const firstSales = metrics.series.slice(-3).reduce((sum, point) => sum + point.revenue, 0);
      const plannedFirstSales = metrics.plan.rows
        .slice(-3)
        .reduce((sum, row) => sum + row.plannedRevenue, 0);

      return [
        {
          label: product.actualLaunchDate ? "Dias desde o lançamento" : "Dias para o lançamento",
          value: days === null ? "—" : formatDays(Math.abs(days)),
          hint: product.actualLaunchDate ? undefined : days !== null && days < 0 ? "A data prevista já passou." : undefined,
          status: days === null ? "neutral" : !product.actualLaunchDate && days < 0 ? "bad" : "ok",
        },
        {
          label: "Marcos do Business Plan",
          value:
            metrics.plan.milestones.total === 0
              ? "sem plano"
              : `${formatPercent(metrics.plan.milestones.percent, 0)} (${metrics.plan.milestones.done}/${metrics.plan.milestones.total})`,
          hint:
            metrics.plan.milestones.late > 0
              ? `${metrics.plan.milestones.late} ${metrics.plan.milestones.late === 1 ? "marco atrasado" : "marcos atrasados"}.`
              : undefined,
          status:
            metrics.plan.milestones.total === 0
              ? "neutral"
              : metrics.plan.milestones.late > 0
                ? "warn"
                : "ok",
        },
        {
          label: "Primeiras vendas vs. plano",
          value: firstSales > 0 ? formatCurrency(firstSales) : "—",
          hint:
            plannedFirstSales > 0
              ? `Plano para o período: ${formatCurrency(plannedFirstSales)}.`
              : "Sem plano para comparar.",
          status:
            plannedFirstSales === 0
              ? "neutral"
              : firstSales >= plannedFirstSales
                ? "ok"
                : firstSales >= plannedFirstSales * 0.85
                  ? "warn"
                  : "bad",
        },
        timeInPhase,
      ];
    }

    case "growth": {
      const attainment = metrics.primaryGoal?.attainmentPct ?? null;
      const accumulatedPlanned =
        metrics.plan.rows.length > 0
          ? metrics.plan.rows[metrics.plan.rows.length - 1]!.accumulatedPlannedRevenue
          : 0;

      return [
        {
          label: "Crescimento MoM (3M)",
          value: formatSignedPercent(metrics.trend.momGrowth),
          status:
            metrics.trend.momGrowth === null
              ? "neutral"
              : metrics.trend.momGrowth > 0
                ? "ok"
                : "bad",
          trend:
            metrics.trend.momGrowth === null
              ? "flat"
              : metrics.trend.momGrowth > 0
                ? "up"
                : metrics.trend.momGrowth < 0
                  ? "down"
                  : "flat",
        },
        {
          label: "Atingimento da meta principal",
          value: attainment === null ? "não medível" : formatPercent(attainment, 0),
          hint: metrics.primaryGoal ? metrics.primaryGoal.typeLabel : "Sem meta principal.",
          status:
            attainment === null ? "neutral" : attainment >= 100 ? "ok" : attainment >= 80 ? "warn" : "bad",
        },
        {
          label: "CAC / payback",
          value: metrics.cac === null ? "sem dado de aquisição" : formatCurrency(metrics.cac),
          hint:
            metrics.payback.status === "reached"
              ? "Payback já atingido."
              : metrics.payback.months !== null
                ? `Payback em ${formatMonths(metrics.payback.months)} desde o início.`
                : "Payback não estimável.",
          status: metrics.cac === null ? "neutral" : "ok",
        },
        {
          label: "Receita acumulada vs. plano",
          value: formatCurrency(metrics.summary.accumulatedRevenue),
          hint:
            accumulatedPlanned > 0
              ? `Plano: ${formatCurrency(accumulatedPlanned)}.`
              : "Sem Business Plan para comparar.",
          status:
            accumulatedPlanned === 0
              ? "neutral"
              : metrics.summary.accumulatedRevenue >= accumulatedPlanned
                ? "ok"
                : "bad",
        },
      ];
    }

    case "maturity": {
      const opexPerRevenue =
        metrics.trend.annualizedRevenue > 0
          ? metrics.trend.annualizedMaintenanceCost / metrics.trend.annualizedRevenue
          : null;

      return [
        {
          label: "Margem de contribuição",
          value: formatCurrency(metrics.summary.lastMargin),
          hint: "Último mês fechado.",
          status:
            metrics.summary.lastMargin === null
              ? "neutral"
              : metrics.summary.lastMargin > 0
                ? "ok"
                : "bad",
        },
        {
          label: "ROI acumulado",
          value: metrics.summary.roi === null ? "sem custo lançado" : formatPercent(metrics.summary.roi),
          status:
            metrics.summary.roi === null ? "neutral" : metrics.summary.roi > 0 ? "ok" : "bad",
        },
        {
          label: "Estabilidade da receita (3M)",
          value: metrics.trend.stability3m === null ? "—" : formatPercent(metrics.trend.stability3m),
          hint: "Variação da receita; quanto menor, mais estável.",
          status:
            metrics.trend.stability3m === null
              ? "neutral"
              : metrics.trend.stability3m <= 10
                ? "ok"
                : metrics.trend.stability3m <= 25
                  ? "warn"
                  : "bad",
        },
        {
          label: "OPEX por real de receita",
          value: opexPerRevenue === null ? "—" : formatNumber(opexPerRevenue, 2),
          hint: "Custo de manutenção dividido pela receita, ambos anualizados.",
          status:
            opexPerRevenue === null ? "neutral" : opexPerRevenue < 0.5 ? "ok" : opexPerRevenue < 0.8 ? "warn" : "bad",
        },
      ];
    }

    case "decline":
    case "discontinued": {
      const maintenanceRatio =
        metrics.trend.annualizedRevenue > 0
          ? metrics.trend.annualizedMaintenanceCost / metrics.trend.annualizedRevenue
          : null;

      return [
        {
          label: "Queda MoM (3M)",
          value: formatSignedPercent(metrics.trend.momGrowth),
          status:
            metrics.trend.momGrowth === null ? "neutral" : metrics.trend.momGrowth < 0 ? "bad" : "ok",
          trend: (metrics.trend.momGrowth ?? 0) < 0 ? "down" : "flat",
        },
        {
          label: "Meses consecutivos em queda",
          value: formatInteger(metrics.trend.decliningMonths),
          status:
            metrics.trend.decliningMonths >= 3
              ? "bad"
              : metrics.trend.decliningMonths > 0
                ? "warn"
                : "ok",
        },
        {
          label: "ROI marginal (12M)",
          value:
            metrics.projection?.projectedRoi === undefined || metrics.projection?.projectedRoi === null
              ? "não projetável"
              : formatPercent(metrics.projection.projectedRoi),
          hint: metrics.projection
            ? `Projeção sobre ${metrics.projection.basis.windowMonths} meses de histórico.`
            : "Histórico insuficiente.",
          status:
            !metrics.projection || metrics.projection.projectedRoi === null
              ? "neutral"
              : metrics.projection.projectedRoi > 0
                ? "ok"
                : "bad",
        },
        {
          label: "Custo de manutenção vs. receita",
          value:
            maintenanceRatio === null
              ? formatCurrency(metrics.trend.annualizedMaintenanceCost)
              : formatNumber(maintenanceRatio, 2),
          hint:
            maintenanceRatio === null
              ? "Sem receita anualizada para comparar."
              : `${formatCurrency(metrics.trend.annualizedMaintenanceCost)} de manutenção para ${formatCurrency(metrics.trend.annualizedRevenue)} de receita.`,
          status:
            maintenanceRatio === null ? "neutral" : maintenanceRatio < 0.7 ? "ok" : maintenanceRatio < 1 ? "warn" : "bad",
        },
      ];
    }

    default:
      return [timeInPhase];
  }
}

const STATUS_STYLE = {
  ok: "border-green/30 bg-green/5",
  warn: "border-amber/40 bg-amber/5",
  bad: "border-red/40 bg-red/5",
  neutral: "border-border bg-surface",
} as const;

const STATUS_TEXT = {
  ok: "text-fg",
  warn: "text-amber",
  bad: "text-red",
  neutral: "text-fg",
} as const;

export function IndicatorTile({ indicator }: { indicator: Indicator }) {
  const status = indicator.status ?? "neutral";
  const TrendIcon =
    indicator.trend === "up" ? TrendingUp : indicator.trend === "down" ? TrendingDown : Minus;

  return (
    <div className={cn("rounded-xl border p-3", STATUS_STYLE[status])}>
      <p className="flex items-center gap-1 text-[11px] text-fg-muted">
        {indicator.label}
        {status === "bad" || status === "warn" ? (
          <AlertTriangle
            className={cn("h-3 w-3", status === "bad" ? "text-red" : "text-amber")}
            aria-label="Fora do esperado"
          />
        ) : null}
      </p>
      <p className={cn("mt-1 flex items-center gap-1.5 text-lg font-semibold tabular-nums", STATUS_TEXT[status])}>
        {indicator.value}
        {indicator.trend ? <TrendIcon className="h-4 w-4 opacity-70" aria-hidden /> : null}
      </p>
      {indicator.hint ? <p className="mt-0.5 text-[11px] text-fg-muted">{indicator.hint}</p> : null}
    </div>
  );
}
