import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/lib/auth/guard";
import { canRegisterDecision } from "@/lib/auth/policy";
import { formatCurrency, formatDate, formatDays, formatNumber, formatPercent } from "@/lib/format";
import { GOAL_PERIOD_LABELS, PHASE_LABELS } from "@/lib/labels";
import { listEnumValues } from "@/lib/queries/enums";
import { getProductMetrics } from "@/lib/queries/metrics";
import { getPortfolioPhaseAverages, listProductDecisions } from "@/lib/queries/portfolio";
import { getProduct } from "@/lib/queries/products";
import { getSettings } from "@/lib/queries/settings";
import { getHealthDelta } from "@/lib/snapshots";
import { ContinuityCard } from "./continuity-card";
import { EvolutionCard } from "./evolution-card";
import { HealthCard } from "./health-card";
import { IndicatorTile, phaseIndicators } from "./indicators";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const product = await getProduct(id);
  if (!product) notFound();

  const [metrics, settings, decisions, phaseAverages, columns] = await Promise.all([
    getProductMetrics(id),
    getSettings(),
    listProductDecisions(id),
    getPortfolioPhaseAverages(),
    listEnumValues("kanban_column"),
  ]);

  const healthDelta = await getHealthDelta(id, metrics.health.score);

  const indicators = phaseIndicators(metrics, product.phase, {
    plannedLaunchDate: product.plannedLaunchDate,
    actualLaunchDate: product.actualLaunchDate,
  });

  const columnLabels = Object.fromEntries(columns.map((column) => [column.code, column.label]));

  const alerts: { text: string; tone: "red" | "amber" }[] = [];
  if (metrics.plan.trigger.triggered) {
    alerts.push({ text: metrics.plan.trigger.message, tone: "red" });
  }
  if (metrics.risk.overdueActionPlans > 0) {
    alerts.push({
      text: `${metrics.risk.overdueActionPlans} ${
        metrics.risk.overdueActionPlans === 1
          ? "plano de ação vencido e não concluído"
          : "planos de ação vencidos e não concluídos"
      }, penalizando o Health Score.`,
      tone: "red",
    });
  }
  if (metrics.plan.milestones.late > 0) {
    alerts.push({
      text: `${metrics.plan.milestones.late} ${
        metrics.plan.milestones.late === 1 ? "marco atrasado" : "marcos atrasados"
      } no Business Plan.`,
      tone: "amber",
    });
  }
  if (metrics.tasks.late > 0) {
    alerts.push({
      text: `${metrics.tasks.late} ${
        metrics.tasks.late === 1 ? "tarefa atrasada" : "tarefas atrasadas"
      } no cronograma.`,
      tone: "amber",
    });
  }

  return (
    <div className="space-y-4">
      {alerts.length > 0 ? (
        <div className="rounded-xl border border-amber/40 bg-amber/5 px-4 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber">
            <AlertTriangle className="h-4 w-4" />
            {alerts.length === 1 ? "1 alerta" : `${alerts.length} alertas`}
          </p>
          <ul className="mt-1.5 space-y-1">
            {alerts.map((alert) => (
              <li
                key={alert.text}
                className={`text-xs ${alert.tone === "red" ? "text-red" : "text-fg-muted"}`}
              >
                · {alert.text}
              </li>
            ))}
          </ul>
          <Button asChild variant="secondary" size="sm" className="mt-2">
            <Link href={`/produtos/${product.id}/business-plan`}>Ver Business Plan</Link>
          </Button>
        </div>
      ) : null}

      {/* Bloco A — indicadores da fase atual. */}
      <Card>
        <CardHeader
          title={`Indicadores de ${PHASE_LABELS[product.phase].toLowerCase()}`}
          description="O que importa acompanhar nesta fase; o que está fora do esperado aparece destacado."
        />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {indicators.map((indicator) => (
            <IndicatorTile key={indicator.label} indicator={indicator} />
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Bloco C — saúde. */}
        <div className="lg:col-span-2">
          <HealthCard
            health={metrics.health}
            delta={healthDelta}
            thresholds={settings.semaphoreThresholds}
          />
        </div>

        {/* Tempo em cada fase, contra a média do portfólio. */}
        <Card>
          <CardHeader title="Tempo em cada fase" description="Comparado à média do portfólio." />
          <CardBody>
            {metrics.phases.length === 0 ? (
              <EmptyState title="Sem histórico de fase" />
            ) : (
              <ol className="space-y-3">
                {metrics.phases.map((entry, index) => {
                  const average = phaseAverages[entry.phase];
                  const slower = average !== undefined && entry.days > average * 1.25;

                  return (
                    <li key={`${entry.phase}-${index}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1 h-2 w-2 rounded-full ${entry.current ? "bg-brand" : "bg-fg-muted/40"}`}
                        />
                        {index < metrics.phases.length - 1 ? (
                          <span className="w-px flex-1 bg-border" />
                        ) : null}
                      </div>
                      <div className="pb-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {PHASE_LABELS[entry.phase]}
                          {entry.current ? <Badge tone="blue">atual</Badge> : null}
                        </p>
                        <p className="text-xs text-fg-muted">
                          {formatDays(entry.days)}
                          {average !== undefined ? (
                            <>
                              {" · média do portfólio: "}
                              {formatDays(average)}
                              {slower ? (
                                <span className="text-amber"> (acima da média)</span>
                              ) : null}
                            </>
                          ) : (
                            " · sem média de portfólio ainda"
                          )}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Bloco B — evolução. */}
      <EvolutionCard metrics={metrics} columnLabels={columnLabels} />

      {/* Bloco D — continuidade. */}
      <ContinuityCard
        metrics={metrics}
        decisions={decisions.map((decision) => ({
          id: decision.id,
          recommended: decision.recommended,
          outcome: decision.outcome,
          justification: decision.justification,
          createdAt: decision.createdAt,
          decidedByName: decision.decidedByName,
        }))}
        canDecide={canRegisterDecision(user, product)}
        currency={settings.defaultCurrency}
      />

      {/* Metas e governança. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Metas" description="A principal alimenta o painel executivo." />
          <CardBody>
            {metrics.goals.length === 0 ? (
              <EmptyState
                title="Nenhuma meta cadastrada"
                description="Sem meta principal, o componente de atingimento fica de fora do Health Score."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Tipo</th>
                      <th scope="col" className="num">Alvo</th>
                      <th scope="col" className="num">Realizado</th>
                      <th scope="col" className="num">Atingimento</th>
                      <th scope="col">Apuração</th>
                      <th scope="col">Data-limite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.goals.map((goal) => {
                      const money = goal.unit === "R$";
                      const format = (value: number | null) =>
                        value === null
                          ? "—"
                          : money
                            ? formatCurrency(value)
                            : `${formatNumber(value)}${goal.unit ? ` ${goal.unit}` : ""}`;

                      return (
                        <tr key={goal.id}>
                          <td>
                            <span className="flex items-center gap-2">
                              {goal.typeLabel}
                              {metrics.primaryGoal?.id === goal.id ? (
                                <Badge tone="blue">Principal</Badge>
                              ) : null}
                            </span>
                          </td>
                          <td className="num">{format(goal.target)}</td>
                          <td className="num">
                            {goal.realized === null ? (
                              <span className="text-fg-muted">não medível</span>
                            ) : (
                              format(goal.realized)
                            )}
                          </td>
                          <td className="num">
                            {goal.attainmentPct === null ? (
                              "—"
                            ) : (
                              <span
                                className={
                                  goal.attainmentPct >= 100
                                    ? "text-green"
                                    : goal.attainmentPct >= 80
                                      ? "text-amber"
                                      : "text-red"
                                }
                              >
                                {formatPercent(goal.attainmentPct, 0)}
                              </span>
                            )}
                          </td>
                          <td>{GOAL_PERIOD_LABELS[goal.period]}</td>
                          <td>{formatDate(goal.deadline)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Governança" />
          <CardBody className="space-y-3">
            <Info label="Segmento / mercado-alvo" value={product.segment} />
            <Info label="Modelo de precificação" value={product.pricingModel} />
            <Info label="Time" value={product.team} />
            <Info
              label="Tags"
              value={product.tags.length > 0 ? product.tags.join(", ") : null}
            />
            <Info label="Principais concorrentes" value={product.competitors} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="whitespace-pre-line text-sm">{value ?? "—"}</p>
    </div>
  );
}
