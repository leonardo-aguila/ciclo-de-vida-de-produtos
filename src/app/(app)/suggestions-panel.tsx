"use client";

import { ChevronDown, Lightbulb, ListChecks, TrendingDown, TrendingUp, Minus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatDate, formatNumber, formatSignedPercent } from "@/lib/format";
import type { Suggestion } from "@/lib/insights-engine";
import { cn } from "@/lib/utils";

type SourceComment = {
  id: string;
  productId: string;
  productName: string;
  body: string;
  commentDate: string;
  categoryLabel: string | null;
  authorName: string | null;
};

const TREND_ICON = { rising: TrendingUp, cooling: TrendingDown, steady: Minus };
const TREND_LABEL = { rising: "Crescendo", cooling: "Esfriando", steady: "Estável" };

/**
 * Suggestions distilled from the comments.
 *
 * Every card can be opened to show the exact comments behind it. That is the
 * point: a suggestion the reader cannot trace back is a suggestion they have
 * to take on faith, and nobody should act on a theme they cannot check.
 */
export function SuggestionsPanel({
  suggestions,
  comments,
  engineName,
}: {
  suggestions: Suggestion[];
  comments: SourceComment[];
  engineName: string;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const byId = React.useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments],
  );

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-fg-muted" />
            Sugestões a partir dos comentários
          </span>
        }
        description={`Temas recorrentes nos ${comments.length} ${comments.length === 1 ? "comentário registrado" : "comentários registrados"}, agrupados por similaridade.`}
        action={<Badge tone="neutral">motor: {engineName}</Badge>}
      />
      <CardBody>
        {suggestions.length === 0 ? (
          <EmptyState
            title={
              comments.length === 0
                ? "Nenhum comentário para analisar"
                : "Nenhum tema recorrente ainda"
            }
            description={
              comments.length === 0
                ? "Registre comentários nos produtos — risco, oportunidade, feedback de cliente — e eles viram sugestões aqui."
                : "Os comentários existentes não se repetem o suficiente para formar um tema. O motor só reporta o que aparece mais de uma vez."
            }
          />
        ) : (
          <ul className="space-y-3">
            {suggestions.map((suggestion) => {
              const TrendIcon = TREND_ICON[suggestion.trend];
              const isOpen = expanded === suggestion.id;

              return (
                <li
                  key={suggestion.id}
                  className={cn(
                    "rounded-lg border p-3",
                    suggestion.kind === "risk" ? "border-red/30 bg-red/5" : "border-green/30 bg-green/5",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {suggestion.title}
                        <Badge tone={suggestion.kind === "risk" ? "red" : "green"}>
                          {suggestion.kind === "risk" ? "Risco" : "Oportunidade"}
                        </Badge>
                        <Badge tone="neutral">
                          <TrendIcon className="h-3 w-3" />
                          {TREND_LABEL[suggestion.trend]}
                        </Badge>
                      </p>
                      <p className="mt-1 text-xs">{suggestion.recommendation}</p>
                    </div>
                    <Badge tone="neutral">
                      {suggestion.frequency}{" "}
                      {suggestion.frequency === 1 ? "menção" : "menções"}
                    </Badge>
                  </div>

                  <dl className="mt-2 grid gap-2 text-[11px] sm:grid-cols-3">
                    <div>
                      <dt className="text-fg-muted">Produtos afetados</dt>
                      <dd className="flex flex-wrap gap-1">
                        {suggestion.products.map((product) => (
                          <Link
                            key={product.id}
                            href={`/produtos/${product.id}`}
                            className="text-brand hover:underline"
                          >
                            {product.name} ({product.mentions})
                          </Link>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Tendência</dt>
                      <dd>{suggestion.trendDetail}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Saúde dos produtos citados</dt>
                      <dd>
                        {suggestion.affectedHealth.average === null
                          ? "—"
                          : `${formatNumber(suggestion.affectedHealth.average, 0)} de Health`}
                        {suggestion.affectedHealth.averageDelta !== null ? (
                          <span
                            className={
                              suggestion.affectedHealth.averageDelta < 0 ? "text-red" : "text-green"
                            }
                          >
                            {" "}
                            ({formatSignedPercent(suggestion.affectedHealth.averageDelta, 1)
                              .replace("%", " pts")}
                            )
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-fg-muted">
                      Termos: {suggestion.terms.join(", ")}
                    </span>
                    <span className="text-[11px] text-fg-muted">
                      · confiança {formatNumber(suggestion.confidence * 100, 0)}%
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : suggestion.id)}
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
                      />
                      {isOpen ? "Ocultar" : "Ver"} os {suggestion.sourceCommentIds.length}{" "}
                      comentários de origem
                    </Button>
                    <Button asChild variant="secondary" size="sm">
                      <Link
                        href={`/produtos/${suggestion.products[0]?.id ?? ""}/insights`}
                      >
                        <ListChecks className="h-4 w-4" />
                        Virar insight
                      </Link>
                    </Button>
                  </div>

                  {isOpen ? (
                    <ul className="mt-2 space-y-2 border-t border-border pt-2">
                      {suggestion.sourceCommentIds.map((commentId) => {
                        const comment = byId.get(commentId);
                        if (!comment) return null;
                        return (
                          <li key={commentId} className="text-xs">
                            <p className="text-[11px] text-fg-muted">
                              {comment.productName} · {formatDate(comment.commentDate)}
                              {comment.authorName ? ` · ${comment.authorName}` : ""}
                              {comment.categoryLabel ? ` · ${comment.categoryLabel}` : ""}
                            </p>
                            <p className="mt-0.5">{comment.body}</p>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
