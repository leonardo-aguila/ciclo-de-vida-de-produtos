"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { EmptyState } from "@/components/ui/states";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { PHASE_COLORS, PHASE_LABELS } from "@/lib/labels";
import type { PortfolioProduct } from "@/lib/queries/dashboard";

const SIZE = { width: 640, height: 420 };
const PADDING = { top: 20, right: 20, bottom: 44, left: 56 };

const QUADRANTS = {
  stars: { label: "Estrelas", color: "#047857", fill: "rgb(4 120 87 / 0.06)" },
  bets: { label: "Apostas", color: "#2563eb", fill: "rgb(37 99 235 / 0.06)" },
  review: { label: "Revisar", color: "#854d0e", fill: "rgb(133 77 14 / 0.06)" },
  sunset: { label: "Candidatos a sunset", color: "#dc2626", fill: "rgb(220 38 38 / 0.06)" },
} as const;

/** The sentence shown when a bubble is hovered or focused, and its accessible name. */
function describe(product: PortfolioProduct, clamped: boolean): string {
  return (
    `${product.name} — Health ${formatNumber(product.health, 0)}, ` +
    `ROI ${formatPercent(product.roi)}, ` +
    `receita acumulada ${formatCurrency(product.accumulatedRevenue)}` +
    (clamped ? " (fora da escala, fixado na borda)" : "")
  );
}

/**
 * Portfolio matrix: ROI on X, Health on Y, bubble size by accumulated revenue,
 * colour by lifecycle phase.
 *
 * The X axis is clamped to a readable window, and products outside it are
 * pinned to the edge with a marker — a single product at 600% ROI would
 * otherwise squeeze every other one into a vertical line.
 */
export function PortfolioMatrix({
  products,
  healthThreshold,
}: {
  products: PortfolioProduct[];
  /** Health above this is the top half of the matrix. */
  healthThreshold: number;
}) {
  const router = useRouter();
  const [hovered, setHovered] = React.useState<string | null>(null);

  const plotWidth = SIZE.width - PADDING.left - PADDING.right;
  const plotHeight = SIZE.height - PADDING.top - PADDING.bottom;

  const measurable = products.filter((product) => product.roi !== null);
  if (measurable.length === 0) {
    return (
      <EmptyState
        title="Sem produtos para posicionar"
        description="A matriz precisa de ROI, que só existe quando há custo lançado. Registre lançamentos financeiros para ver o portfólio aqui."
      />
    );
  }

  // Clamp the ROI axis to something a person can read.
  const rois = measurable.map((product) => product.roi!);
  const rawMin = Math.min(...rois, 0);
  const rawMax = Math.max(...rois, 0);
  const min = Math.max(rawMin, -120);
  const max = Math.min(Math.max(rawMax, 40), 300);
  const span = max - min || 1;

  const toX = (roi: number) =>
    PADDING.left + ((Math.max(min, Math.min(max, roi)) - min) / span) * plotWidth;
  const toY = (health: number) =>
    PADDING.top + plotHeight - (Math.max(0, Math.min(100, health)) / 100) * plotHeight;

  const maxRevenue = Math.max(...measurable.map((product) => product.accumulatedRevenue), 1);
  const radius = (revenue: number) => 6 + Math.sqrt(Math.max(0, revenue) / maxRevenue) * 18;

  const zeroX = toX(0);
  const thresholdY = toY(healthThreshold);
  const ticks = [min, min + span / 4, min + span / 2, min + (span * 3) / 4, max];
  const hoveredProduct = measurable.find((product) => product.id === hovered) ?? null;

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        className="w-full"
        role="img"
        aria-label={`Matriz de portfólio com ${measurable.length} produtos posicionados por ROI e Health Score`}
      >
        <rect x={zeroX} y={PADDING.top} width={SIZE.width - PADDING.right - zeroX} height={thresholdY - PADDING.top} fill={QUADRANTS.stars.fill} />
        <rect x={PADDING.left} y={PADDING.top} width={zeroX - PADDING.left} height={thresholdY - PADDING.top} fill={QUADRANTS.bets.fill} />
        <rect x={zeroX} y={thresholdY} width={SIZE.width - PADDING.right - zeroX} height={PADDING.top + plotHeight - thresholdY} fill={QUADRANTS.review.fill} />
        <rect x={PADDING.left} y={thresholdY} width={zeroX - PADDING.left} height={PADDING.top + plotHeight - thresholdY} fill={QUADRANTS.sunset.fill} />

        <text x={SIZE.width - PADDING.right - 6} y={PADDING.top + 14} fontSize="11" fontWeight="600" fill={QUADRANTS.stars.color} textAnchor="end">
          {QUADRANTS.stars.label}
        </text>
        <text x={PADDING.left + 6} y={PADDING.top + 14} fontSize="11" fontWeight="600" fill={QUADRANTS.bets.color}>
          {QUADRANTS.bets.label}
        </text>
        <text x={SIZE.width - PADDING.right - 6} y={PADDING.top + plotHeight - 6} fontSize="11" fontWeight="600" fill={QUADRANTS.review.color} textAnchor="end">
          {QUADRANTS.review.label}
        </text>
        <text x={PADDING.left + 6} y={PADDING.top + plotHeight - 6} fontSize="11" fontWeight="600" fill={QUADRANTS.sunset.color}>
          {QUADRANTS.sunset.label}
        </text>

        {/* Axes and grid. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={toX(tick)} y1={PADDING.top} x2={toX(tick)} y2={PADDING.top + plotHeight} stroke="rgb(var(--border))" strokeWidth={0.5} opacity={0.6} />
            <text x={toX(tick)} y={SIZE.height - PADDING.bottom + 16} fontSize="10" fill="rgb(var(--fg-muted))" textAnchor="middle">
              {formatNumber(tick, 0)}%
            </text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line x1={PADDING.left} y1={toY(value)} x2={PADDING.left + plotWidth} y2={toY(value)} stroke="rgb(var(--border))" strokeWidth={0.5} opacity={0.6} />
            <text x={PADDING.left - 8} y={toY(value) + 3} fontSize="10" fill="rgb(var(--fg-muted))" textAnchor="end">
              {value}
            </text>
          </g>
        ))}

        <line x1={zeroX} y1={PADDING.top} x2={zeroX} y2={PADDING.top + plotHeight} stroke="rgb(var(--border))" strokeWidth={1.5} />
        <line x1={PADDING.left} y1={thresholdY} x2={PADDING.left + plotWidth} y2={thresholdY} stroke="rgb(var(--border))" strokeWidth={1.5} />

        <text x={PADDING.left + plotWidth / 2} y={SIZE.height - 8} fontSize="11" fill="rgb(var(--fg-muted))" textAnchor="middle">
          ROI acumulado →
        </text>
        <text x={16} y={PADDING.top + plotHeight / 2} fontSize="11" fill="rgb(var(--fg-muted))" textAnchor="middle" transform={`rotate(-90 16 ${PADDING.top + plotHeight / 2})`}>
          Health Score →
        </text>

        {measurable.map((product) => {
          const clamped = product.roi! < min || product.roi! > max;
          const x = toX(product.roi!);
          const y = toY(product.health);
          const isHovered = hovered === product.id;

          return (
            <g key={product.id}>
              <circle
                cx={x}
                cy={y}
                r={radius(product.accumulatedRevenue)}
                fill={PHASE_COLORS[product.phase]}
                fillOpacity={isHovered ? 0.55 : 0.32}
                stroke={PHASE_COLORS[product.phase]}
                strokeWidth={isHovered ? 2.5 : 1.5}
                strokeDasharray={clamped ? "3 2" : undefined}
                className="cursor-pointer focus:outline-none focus-visible:stroke-[3]"
                tabIndex={0}
                role="button"
                // Not an SVG <title>: React 19 hoists <title> as document
                // metadata, so the server renders it empty and hydration
                // breaks. The description below carries the same numbers,
                // for the mouse and for the keyboard alike.
                aria-label={describe(product, clamped)}
                onMouseEnter={() => setHovered(product.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(product.id)}
                onBlur={() => setHovered(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`/produtos/${product.id}`);
                  }
                }}
                onClick={() => router.push(`/produtos/${product.id}`)}
              />
              <text
                x={x}
                y={y - radius(product.accumulatedRevenue) - 4}
                fontSize="10"
                fill="rgb(var(--fg))"
                textAnchor="middle"
                className="pointer-events-none"
              >
                {product.code}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="min-h-[1.25rem] text-xs" aria-live="polite">
        {hoveredProduct ? (
          <span>
            <span className="font-medium">{hoveredProduct.name}</span>
            {" — "}
            Health {formatNumber(hoveredProduct.health, 0)} · ROI {formatPercent(hoveredProduct.roi)}{" "}
            · receita acumulada {formatCurrency(hoveredProduct.accumulatedRevenue)}
            {hoveredProduct.roi! < min || hoveredProduct.roi! > max
              ? " · fora da escala, fixado na borda"
              : ""}
          </span>
        ) : (
          <span className="text-fg-muted">
            Passe o mouse ou navegue com Tab pelas bolhas para ver os números; clique ou tecle Enter
            para abrir o produto.
          </span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
        {Array.from(new Set(measurable.map((product) => product.phase))).map((phase) => (
          <span key={phase} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PHASE_COLORS[phase] }} />
            {PHASE_LABELS[phase]}
          </span>
        ))}
        <span className="ml-auto">
          Tamanho da bolha: receita acumulada · linha do meio: Health {healthThreshold}
        </span>
      </div>

      {products.length > measurable.length ? (
        <p className="text-[11px] text-fg-muted">
          {products.length - measurable.length}{" "}
          {products.length - measurable.length === 1
            ? "produto ficou de fora por não ter custo lançado"
            : "produtos ficaram de fora por não terem custo lançado"}{" "}
          — sem custo não há ROI para posicionar.
        </p>
      ) : null}
    </div>
  );
}
