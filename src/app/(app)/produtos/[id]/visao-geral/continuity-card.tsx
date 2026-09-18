"use client";

import { Check, History, Lightbulb, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { registerDecisionAction } from "@/app/actions/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions";
import { CONFIDENCE_LABELS } from "@/lib/engine/projection";
import { RECOMMENDATION_TONES } from "@/lib/engine/recommendation";
import {
  formatCompetence,
  formatCurrency,
  formatDateTime,
  formatMonths,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { DECISION_OUTCOME_LABELS, RECOMMENDATION_LABELS } from "@/lib/labels";
import type { ProductMetrics } from "@/lib/queries/metrics";
import { cn } from "@/lib/utils";
import type { RecommendationValue } from "@db/schema";

type Decision = {
  id: string;
  recommended: RecommendationValue;
  outcome: "accepted" | "rejected";
  justification: string;
  createdAt: Date;
  decidedByName: string | null;
};

/**
 * Block D — does it still make sense to keep this product?
 *
 * The recommendation is a suggestion and never acts on its own: accepting
 * "discontinue" records that the call was made, it does not discontinue
 * anything. What the card owes the reader is the numbers behind the sentence.
 */
export function ContinuityCard({
  metrics,
  decisions,
  canDecide,
  currency,
}: {
  metrics: ProductMetrics;
  decisions: Decision[];
  canDecide: boolean;
  currency: string;
}) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const recommendation = metrics.recommendation;
  const tone = RECOMMENDATION_TONES[recommendation.kind];

  const lastDecision = decisions[0] ?? null;
  const decidedOnCurrent =
    lastDecision !== null && lastDecision.recommended === recommendation.kind;

  const paybackText =
    metrics.payback.status === "reached"
      ? `Atingido em ${formatCompetence(metrics.payback.competence)}`
      : metrics.payback.status === "estimated"
        ? `Estimado para ${formatCompetence(metrics.payback.competence)}`
        : metrics.payback.status === "unreachable"
          ? "Não alcançado no ritmo atual"
          : "Histórico insuficiente";

  return (
    <div className="space-y-4">
      {notice ? <FormSuccess message={notice} /> : null}

      <Card>
        <CardHeader
          title="Inteligência de continuidade"
          description="Receita, custo e retorno acumulados, e o que a tendência indica."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Receita acumulada"
              value={formatCurrency(metrics.summary.accumulatedRevenue, currency)}
            />
            <Metric
              label="Custo total"
              value={formatCurrency(metrics.summary.accumulatedCost, currency)}
              hint={metrics.costs.byType
                .slice(0, 3)
                .map((type) => `${type.label} ${formatCurrency(type.total, currency)}`)
                .join(" · ")}
            />
            <Metric
              label="ROI acumulado"
              value={
                metrics.summary.roi === null ? "sem custo lançado" : formatPercent(metrics.summary.roi)
              }
              tone={
                metrics.summary.roi === null ? "neutral" : metrics.summary.roi >= 0 ? "ok" : "bad"
              }
            />
            <Metric
              label="ROI projetado 12M"
              value={
                metrics.projection?.projectedRoi === undefined ||
                metrics.projection?.projectedRoi === null
                  ? "não projetável"
                  : formatPercent(metrics.projection.projectedRoi)
              }
              tone={
                !metrics.projection || metrics.projection.projectedRoi === null
                  ? "neutral"
                  : metrics.projection.projectedRoi >= 0
                    ? "ok"
                    : "bad"
              }
              hint={
                metrics.projection
                  ? `Projeção sobre ${metrics.projection.basis.windowMonths} meses, confiança ${CONFIDENCE_LABELS[metrics.projection.confidence]}.`
                  : "Faltam meses de histórico."
              }
            />
            <Metric label="Payback" value={paybackText} />
            <Metric
              label="Margem de contribuição do mês"
              value={formatCurrency(metrics.summary.lastMargin, currency)}
              tone={
                metrics.summary.lastMargin === null
                  ? "neutral"
                  : metrics.summary.lastMargin >= 0
                    ? "ok"
                    : "bad"
              }
            />
            <Metric
              label="Burn mensal"
              value={
                metrics.summary.burn === null
                  ? "sem meses negativos"
                  : formatCurrency(metrics.summary.burn, currency)
              }
              hint={
                metrics.summary.burn !== null && metrics.summary.accumulatedRevenue > 0
                  ? `Runway de ${formatMonths(metrics.summary.accumulatedRevenue / metrics.summary.burn)} sobre a receita acumulada.`
                  : undefined
              }
              tone={metrics.summary.burn === null ? "ok" : "bad"}
            />
            <Metric
              label="Manutenção vs. receita (anualizado)"
              value={
                metrics.trend.annualizedRevenue > 0
                  ? formatNumber(
                      metrics.trend.annualizedMaintenanceCost / metrics.trend.annualizedRevenue,
                      2,
                    )
                  : "—"
              }
              hint={`${formatCurrency(metrics.trend.annualizedMaintenanceCost, currency)} para ${formatCurrency(metrics.trend.annualizedRevenue, currency)}.`}
            />
          </div>

          {metrics.projection ? (
            <p className="rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-[11px] text-fg-muted">
              O ROI projetado é <strong>projeção</strong>, não fato: regressão linear sobre a receita
              dos últimos {metrics.projection.basis.windowMonths} meses (r² de{" "}
              {formatNumber(metrics.projection.basis.rSquared, 2)}) com média móvel do custo
              recorrente, estendida por {metrics.projection.basis.horizonMonths} meses.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card className={cn("border-l-4", {
        "border-l-green": tone === "green",
        "border-l-blue": tone === "blue",
        "border-l-amber": tone === "amber",
        "border-l-red": tone === "red",
      })}>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-fg-muted" />
              Recomendação: {RECOMMENDATION_LABELS[recommendation.kind]}
            </span>
          }
          description="Sugestão do sistema. Quem decide é você, e a decisão fica no histórico."
          action={<Badge tone={tone}>{RECOMMENDATION_LABELS[recommendation.kind]}</Badge>}
        />
        <CardBody className="space-y-4">
          <ul className="space-y-1.5">
            {recommendation.rationale.map((sentence, index) => (
              <li key={index} className="flex gap-2 text-sm">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
                <span>{sentence}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-surface-muted/60 px-3 py-2">
            {recommendation.evidence.map((item) => (
              <span key={item.label} className="text-[11px] text-fg-muted">
                {item.label}: <strong className="tabular-nums text-fg">{item.value}</strong>
              </span>
            ))}
          </div>

          {decidedOnCurrent ? (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs">
                <Badge tone={lastDecision!.outcome === "accepted" ? "green" : "neutral"}>
                  {DECISION_OUTCOME_LABELS[lastDecision!.outcome]}
                </Badge>{" "}
                <span className="text-fg-muted">
                  por {lastDecision!.decidedByName ?? "—"} em{" "}
                  {formatDateTime(lastDecision!.createdAt)}
                </span>
              </p>
              <p className="mt-1 text-xs">{lastDecision!.justification}</p>
            </div>
          ) : null}

          {canDecide ? (
            <div className="flex flex-wrap gap-2">
              <DecisionDialog
                metrics={metrics}
                outcome="accepted"
                onDone={setNotice}
              />
              <DecisionDialog
                metrics={metrics}
                outcome="rejected"
                onDone={setNotice}
              />
            </div>
          ) : (
            <p className="text-[11px] text-fg-muted">
              Só o responsável pelo produto (ou um administrador) registra a decisão.
            </p>
          )}
        </CardBody>
      </Card>

      {decisions.length > 0 ? (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-fg-muted" />
                Histórico de decisões
              </span>
            }
          />
          <CardBody>
            <ul className="space-y-3">
              {decisions.map((decision) => (
                <li key={decision.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={RECOMMENDATION_TONES[decision.recommended]}>
                      {RECOMMENDATION_LABELS[decision.recommended]}
                    </Badge>
                    <Badge tone={decision.outcome === "accepted" ? "green" : "neutral"}>
                      {DECISION_OUTCOME_LABELS[decision.outcome]}
                    </Badge>
                    <span className="text-fg-muted">
                      {decision.decidedByName ?? "—"} · {formatDateTime(decision.createdAt)}
                    </span>
                  </p>
                  <p className="mt-1 text-sm">{decision.justification}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function DecisionDialog({
  metrics,
  outcome,
  onDone,
}: {
  metrics: ProductMetrics;
  outcome: "accepted" | "rejected";
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    registerDecisionAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Decisão registrada.");
      router.refresh();
    }
  }, [state, onDone, router]);

  // The numbers that were on screen when the call was made travel with it.
  const snapshot = JSON.stringify({
    health: metrics.health.score,
    roi: metrics.summary.roi,
    projectedRoi: metrics.projection?.projectedRoi ?? null,
    momGrowth: metrics.trend.momGrowth,
    decliningMonths: metrics.trend.decliningMonths,
    accumulatedRevenue: metrics.summary.accumulatedRevenue,
    accumulatedCost: metrics.summary.accumulatedCost,
    evidence: metrics.recommendation.evidence,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={outcome === "accepted" ? "primary" : "secondary"} size="sm">
          {outcome === "accepted" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {outcome === "accepted" ? "Aceitar recomendação" : "Rejeitar recomendação"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={
          outcome === "accepted"
            ? `Aceitar: ${RECOMMENDATION_LABELS[metrics.recommendation.kind]}`
            : `Rejeitar: ${RECOMMENDATION_LABELS[metrics.recommendation.kind]}`
        }
        description="Nada é executado automaticamente. O registro fica no histórico do produto, com os números desta tela."
      >
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="productId" value={metrics.productId} />
          <input type="hidden" name="recommended" value={metrics.recommendation.kind} />
          <input type="hidden" name="outcome" value={outcome} />
          <input type="hidden" name="metricsSnapshot" value={snapshot} />

          <Field
            label="Justificativa"
            name="justification"
            errors={state?.ok === false ? state.fieldErrors?.justification : undefined}
            hint="O que sustentou a decisão, para quem ler isto daqui a seis meses."
            required
          >
            <textarea
              className="input"
              rows={4}
              placeholder={
                outcome === "accepted"
                  ? "Concordamos com a leitura porque..."
                  : "Discordamos da recomendação porque..."
              }
            />
          </Field>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm">Registrar decisão</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Metric({
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
        className={cn(
          "mt-0.5 text-base font-semibold tabular-nums",
          tone === "ok" && "text-green",
          tone === "bad" && "text-red",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-fg-muted">{hint}</p> : null}
    </div>
  );
}
