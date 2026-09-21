"use client";

import { AlertTriangle, Download, FileText, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { downloadCsv, toCsv } from "@/lib/csv";
import { RECOMMENDATION_TONES } from "@/lib/engine/recommendation";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDays,
  formatInteger,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { PHASE_COLORS, PHASE_LABELS, PHASE_ORDER, RECOMMENDATION_LABELS } from "@/lib/labels";
import type { PortfolioOverview } from "@/lib/queries/dashboard";
import type { Suggestion } from "@/lib/insights-engine";
import { cn } from "@/lib/utils";
import { PortfolioMatrix } from "./portfolio-matrix";
import { SuggestionsPanel } from "./suggestions-panel";

type Option = { id: string; label: string };

export function DashboardClient({
  overview,
  suggestions,
  comments,
  engineName,
  owners,
  categories,
  healthThreshold,
  currency,
}: {
  overview: PortfolioOverview;
  suggestions: Suggestion[];
  comments: {
    id: string;
    productId: string;
    productName: string;
    body: string;
    commentDate: string;
    categoryLabel: string | null;
    authorName: string | null;
  }[];
  engineName: string;
  owners: Option[];
  categories: Option[];
  healthThreshold: number;
  currency: string;
}) {
  const { products, totals, phases } = overview;

  const ranking = React.useMemo(
    () => [...products].sort((a, b) => b.health - a.health),
    [products],
  );

  const alerts = React.useMemo(() => {
    const items: { productId: string; productName: string; text: string; severity: number }[] = [];
    for (const product of products) {
      if (product.recommendation === "discontinue" || product.recommendation === "pivot") {
        items.push({
          productId: product.id,
          productName: product.name,
          text: `Recomendação: ${RECOMMENDATION_LABELS[product.recommendation].toLowerCase()}${
            product.decisionRegistered ? " (decisão já registrada)" : ""
          }.`,
          severity: product.recommendation === "discontinue" ? 5 : 4,
        });
      }
      if (product.overdueActionPlans > 0) {
        items.push({
          productId: product.id,
          productName: product.name,
          text: `${product.overdueActionPlans} ${product.overdueActionPlans === 1 ? "plano de ação vencido" : "planos de ação vencidos"}.`,
          severity: 3,
        });
      }
      if (product.lateMilestones > 0) {
        items.push({
          productId: product.id,
          productName: product.name,
          text: `${product.lateMilestones} ${product.lateMilestones === 1 ? "marco atrasado" : "marcos atrasados"}.`,
          severity: 2,
        });
      }
      if (product.planDeviation !== null && product.planDeviation <= -15) {
        items.push({
          productId: product.id,
          productName: product.name,
          text: `Desvio de ${formatPercent(product.planDeviation)} contra o Business Plan.`,
          severity: 4,
        });
      }
    }
    return items.sort((a, b) => b.severity - a.severity);
  }, [products]);

  function exportCsv() {
    downloadCsv(
      "portfolio.csv",
      toCsv(
        ranking.map((product) => ({
          codigo: product.code,
          nome: product.name,
          fase: PHASE_LABELS[product.phase],
          responsavel: product.ownerName,
          health: Math.round(product.health),
          semaforo: product.semaphore,
          roi: product.roi,
          roi_projetado: product.projectedRoi,
          receita_acumulada: product.accumulatedRevenue,
          custo_acumulado: product.accumulatedCost,
          atingimento_meta: product.goalAttainment,
          recomendacao: RECOMMENDATION_LABELS[product.recommendation],
          tarefas_atrasadas: product.lateTasks,
        })),
        [
          { key: "codigo", label: "Código" },
          { key: "nome", label: "Produto" },
          { key: "fase", label: "Fase" },
          { key: "responsavel", label: "Responsável" },
          { key: "health", label: "Health Score" },
          { key: "semaforo", label: "Semáforo" },
          { key: "roi", label: "ROI %" },
          { key: "roi_projetado", label: "ROI projetado 12M %" },
          { key: "receita_acumulada", label: "Receita acumulada" },
          { key: "custo_acumulado", label: "Custo acumulado" },
          { key: "atingimento_meta", label: "Atingimento da meta %" },
          { key: "recomendacao", label: "Recomendação" },
          { key: "tarefas_atrasadas", label: "Tarefas atrasadas" },
        ],
      ),
    );
  }

  return (
    <div className="space-y-4">
      <header className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Painel executivo</h1>
          <p className="text-sm text-fg-muted">
            {totals.products === 1 ? "1 produto" : `${totals.products} produtos`} no recorte atual.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={products.length === 0}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <FileText className="h-4 w-4" />
            PDF
          </Button>
        </div>
      </header>

      <Filters owners={owners} categories={categories} />

      {products.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum produto no recorte"
            description="Ajuste ou limpe os filtros, ou cadastre o primeiro produto do portfólio."
            action={
              <Button asChild size="sm">
                <Link href="/produtos/novo">Cadastrar produto</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Tile label="Produtos" value={formatInteger(totals.products)} />
            <Tile label="Receita do portfólio" value={formatCurrencyCompact(totals.revenue)} hint={formatCurrency(totals.revenue, currency)} />
            <Tile label="Custo total" value={formatCurrencyCompact(totals.cost)} hint={formatCurrency(totals.cost, currency)} />
            <Tile
              label="ROI consolidado"
              value={totals.roi === null ? "sem custo" : formatPercent(totals.roi)}
              tone={totals.roi === null ? "neutral" : totals.roi >= 0 ? "green" : "red"}
              hint="Calculado sobre os totais, não como média dos ROIs."
            />
            <Tile
              label="Produtos em vermelho"
              value={formatInteger(totals.red)}
              tone={totals.red > 0 ? "red" : "green"}
            />
            <Tile
              label="Meta agregada"
              value={totals.goalAttainment === null ? "—" : formatPercent(totals.goalAttainment, 0)}
              hint={
                totals.goalTarget > 0
                  ? `${formatNumber(totals.goalRealized, 0)} de ${formatNumber(totals.goalTarget, 0)}`
                  : "sem metas principais comparáveis"
              }
              tone={
                totals.goalAttainment === null
                  ? "neutral"
                  : totals.goalAttainment >= 100
                    ? "green"
                    : totals.goalAttainment >= 80
                      ? "amber"
                      : "red"
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader
                title="Matriz de portfólio"
                description="ROI no eixo horizontal, Health Score no vertical, tamanho pela receita acumulada e cor pela fase."
              />
              <CardBody>
                <PortfolioMatrix products={products} healthThreshold={healthThreshold} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Funil de ciclo de vida"
                description="Quantos produtos e quanta receita em cada fase."
              />
              <CardBody>
                <ul className="space-y-2">
                  {PHASE_ORDER.filter((phase) => phases.some((row) => row.phase === phase)).map(
                    (phase) => {
                      const row = phases.find((item) => item.phase === phase)!;
                      const share = totals.products > 0 ? (row.count / totals.products) * 100 : 0;
                      return (
                        <li key={phase}>
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="flex items-center gap-1.5 font-medium">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: PHASE_COLORS[phase] }}
                              />
                              {PHASE_LABELS[phase]}
                            </span>
                            <span className="text-fg-muted">
                              {row.count} · {formatCurrencyCompact(row.revenue)}
                            </span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                            <div
                              className="h-full"
                              style={{ width: `${share}%`, backgroundColor: PHASE_COLORS[phase] }}
                            />
                          </div>
                          <p className="mt-0.5 text-[11px] text-fg-muted">
                            {row.averageDays === null
                              ? "sem passagens concluídas para medir o tempo médio"
                              : `tempo médio nesta fase: ${formatDays(row.averageDays)}`}
                          </p>
                        </li>
                      );
                    },
                  )}
                </ul>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Ranking por Health Score"
              description="Do mais saudável ao mais frágil."
            />
            <CardBody className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Produto</th>
                    <th scope="col">Fase</th>
                    <th scope="col" className="num">Health</th>
                    <th scope="col" className="num">vs. mês anterior</th>
                    <th scope="col" className="num">ROI</th>
                    <th scope="col" className="num">Meta</th>
                    <th scope="col">Recomendação</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((product) => {
                    const DeltaIcon =
                      product.healthDelta === null
                        ? Minus
                        : product.healthDelta > 0
                          ? TrendingUp
                          : product.healthDelta < 0
                            ? TrendingDown
                            : Minus;

                    return (
                      <tr key={product.id}>
                        <td>
                          <Link
                            href={`/produtos/${product.id}`}
                            className="font-medium hover:text-brand"
                          >
                            {product.name}
                          </Link>
                          <p className="font-mono text-[11px] text-fg-muted">{product.code}</p>
                        </td>
                        <td>
                          <Badge tone="neutral">{PHASE_LABELS[product.phase]}</Badge>
                        </td>
                        <td className="num">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 font-semibold",
                              product.semaphore === "green" && "text-green",
                              product.semaphore === "amber" && "text-amber",
                              product.semaphore === "red" && "text-red",
                            )}
                          >
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                product.semaphore === "green" && "bg-green",
                                product.semaphore === "amber" && "bg-amber",
                                product.semaphore === "red" && "bg-red",
                              )}
                              aria-hidden
                            />
                            {formatNumber(product.health, 0)}
                          </span>
                        </td>
                        <td className="num">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1",
                              product.healthDelta === null
                                ? "text-fg-muted"
                                : product.healthDelta > 0
                                  ? "text-green"
                                  : product.healthDelta < 0
                                    ? "text-red"
                                    : "text-fg-muted",
                            )}
                          >
                            <DeltaIcon className="h-3 w-3" aria-hidden />
                            {product.healthDelta === null
                              ? "—"
                              : `${product.healthDelta > 0 ? "+" : ""}${formatNumber(product.healthDelta, 1)}`}
                          </span>
                        </td>
                        <td className="num">
                          {product.roi === null ? (
                            <span className="text-fg-muted">sem custo</span>
                          ) : (
                            <span className={product.roi >= 0 ? "text-green" : "text-red"}>
                              {formatPercent(product.roi)}
                            </span>
                          )}
                        </td>
                        <td className="num">
                          {product.goalAttainment === null
                            ? "—"
                            : formatPercent(product.goalAttainment, 0)}
                        </td>
                        <td>
                          <Badge tone={RECOMMENDATION_TONES[product.recommendation]}>
                            {RECOMMENDATION_LABELS[product.recommendation]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-fg-muted" />
                  Alertas consolidados
                </span>
              }
              description="O que precisa de decisão, do mais grave ao menos."
            />
            <CardBody>
              {alerts.length === 0 ? (
                <EmptyState
                  title="Nenhum alerta"
                  description="Nenhum produto com recomendação de descontinuar ou pivotar, plano vencido, marco atrasado ou desvio acima do limite."
                />
              ) : (
                <ul className="space-y-1.5">
                  {alerts.map((alert, index) => (
                    <li
                      key={`${alert.productId}-${index}`}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          alert.severity >= 4 ? "bg-red" : "bg-amber",
                        )}
                        aria-hidden
                      />
                      <Link
                        href={`/produtos/${alert.productId}`}
                        className="font-medium hover:text-brand"
                      >
                        {alert.productName}
                      </Link>
                      <span className={alert.severity >= 4 ? "text-red" : "text-fg-muted"}>
                        {alert.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <SuggestionsPanel
            suggestions={suggestions}
            comments={comments}
            engineName={engineName}
          />
        </>
      )}
    </div>
  );
}

/** Global filters, kept in the URL so a view can be linked and reloaded. */
function Filters({ owners, categories }: { owners: Option[]; categories: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  const hasFilters = Array.from(params.keys()).length > 0;

  return (
    <div className="no-print flex flex-wrap items-end gap-2">
      <div>
        <label className="label" htmlFor="filter-phase">
          Fase
        </label>
        <select
          id="filter-phase"
          className="input"
          value={params.get("fase") ?? ""}
          onChange={(event) => apply("fase", event.target.value)}
        >
          <option value="">Todas</option>
          {PHASE_ORDER.map((phase) => (
            <option key={phase} value={phase}>
              {PHASE_LABELS[phase]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="filter-owner">
          Responsável
        </label>
        <select
          id="filter-owner"
          className="input"
          value={params.get("responsavel") ?? ""}
          onChange={(event) => apply("responsavel", event.target.value)}
        >
          <option value="">Todos</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="filter-category">
          Categoria
        </label>
        <select
          id="filter-category"
          className="input"
          value={params.get("categoria") ?? ""}
          onChange={(event) => apply("categoria", event.target.value)}
        >
          <option value="">Todas</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="filter-from">
          Período de
        </label>
        <input
          id="filter-from"
          type="month"
          className="input"
          value={(params.get("de") ?? "").slice(0, 7)}
          onChange={(event) => apply("de", event.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="filter-to">
          até
        </label>
        <input
          id="filter-to"
          type="month"
          className="input"
          value={(params.get("ate") ?? "").slice(0, 7)}
          onChange={(event) => apply("ate", event.target.value)}
        />
      </div>

      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={() => router.replace(pathname)}>
          <X className="h-4 w-4" />
          Limpar
        </Button>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  return (
    <Card className="p-3">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "green" && "text-green",
          tone === "amber" && "text-amber",
          tone === "red" && "text-red",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-fg-muted">{hint}</p> : null}
    </Card>
  );
}
