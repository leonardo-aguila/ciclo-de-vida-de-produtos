"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { HealthResult } from "@/lib/engine/health";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEMAPHORE = {
  green: { label: "Verde", tone: "green", bar: "bg-green", text: "text-green" },
  amber: { label: "Amarelo", tone: "amber", bar: "bg-amber", text: "text-amber" },
  red: { label: "Vermelho", tone: "red", bar: "bg-red", text: "text-red" },
} as const;

/**
 * Health Score with its decomposition.
 *
 * The number alone is useless for acting: what the user needs is which
 * component dropped, so every row shows its raw value, its weight, what it
 * contributed, and one sentence explaining it.
 */
export function HealthCard({
  health,
  delta,
  thresholds,
}: {
  health: HealthResult;
  /** Points gained or lost against last month's snapshot, null when there is none. */
  delta: number | null;
  thresholds: { green: number; amber: number };
}) {
  const semaphore = SEMAPHORE[health.semaphore];
  const DeltaIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;

  return (
    <Card>
      <CardHeader
        title="Saúde do produto"
        description={`Verde a partir de ${thresholds.green}, amarelo a partir de ${thresholds.amber}.`}
        action={
          health.measured ? (
            <Badge tone={semaphore.tone}>{semaphore.label}</Badge>
          ) : (
            <Badge tone="neutral">Sem medição</Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            {/* A score resting on less than half the weight is not a score: it
                would read as a verdict when it is an absence of data. */}
            <p
              className={cn(
                "text-4xl font-semibold tabular-nums",
                health.measured ? semaphore.text : "text-fg-muted",
              )}
            >
              {health.measured ? formatNumber(health.score, 0) : "—"}
            </p>
            <p className="text-[11px] text-fg-muted">
              {health.measured ? "de 100" : "ainda não há o que medir"}
            </p>
          </div>

          <div className="flex items-center gap-1.5 pb-1 text-sm">
            <DeltaIcon
              className={cn(
                "h-4 w-4",
                delta === null ? "text-fg-muted" : delta > 0 ? "text-green" : delta < 0 ? "text-red" : "text-fg-muted",
              )}
              aria-hidden
            />
            <span className={cn(delta === null ? "text-fg-muted" : delta > 0 ? "text-green" : delta < 0 ? "text-red" : "text-fg-muted")}>
              {delta === null
                ? "sem mês anterior para comparar"
                : `${delta > 0 ? "+" : ""}${formatNumber(delta, 1)} pontos vs. mês anterior`}
            </span>
          </div>
        </div>

        {!health.measured ? (
          <p className="rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11px]">
            Só {formatNumber(health.coverage, 0)} dos 100 pontos de peso puderam ser medidos — menos
            da metade. O número que sairia daí diria mais sobre a falta de dados do que sobre o
            produto, então ele não é exibido. Cadastre meta, lançamentos financeiros, tarefas ou um
            Business Plan para que a saúde passe a ser calculada.
          </p>
        ) : health.coverage < 100 ? (
          <p className="rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-[11px] text-fg-muted">
            {formatNumber(health.coverage, 0)} dos 100 pontos de peso puderam ser medidos. Os
            componentes sem dado ficaram de fora e os demais foram renormalizados — o produto não é
            penalizado por informação que ainda não existe.
          </p>
        ) : null}

        <div className="space-y-2">
          {health.components.map((component) => {
            const measurable = component.raw !== null;
            return (
              <div key={component.key}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium">{component.label}</span>
                  <span className="tabular-nums text-fg-muted">
                    {measurable ? (
                      <>
                        {formatNumber(component.raw!, 0)}/100 · peso {component.weight} ·{" "}
                        <strong className="text-fg">+{formatNumber(component.weighted, 1)}</strong>
                      </>
                    ) : (
                      "não medido"
                    )}
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"
                  role="progressbar"
                  aria-valuenow={measurable ? Math.round(component.raw!) : 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={component.label}
                >
                  <div
                    className={cn("h-full", measurable ? semaphore.bar : "bg-border")}
                    style={{ width: `${Math.min(100, measurable ? component.raw! : 0)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[11px] text-fg-muted">{component.detail}</p>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
