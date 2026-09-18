"use client";

import * as React from "react";
import { EmptyState } from "@/components/ui/states";
import {
  QUADRANT_DESCRIPTIONS,
  QUADRANT_LABELS,
  quadrantOf,
  type InsightRow,
} from "@/lib/engine/insights";
import { cn } from "@/lib/utils";

const PADDING = { top: 16, right: 16, bottom: 36, left: 44 };
const SIZE = 420;

const QUADRANT_STYLE = {
  quick_wins: { fill: "rgb(5 150 105 / 0.07)", label: "#059669" },
  big_bets: { fill: "rgb(37 99 235 / 0.07)", label: "#2563eb" },
  fill_ins: { fill: "rgb(100 116 139 / 0.06)", label: "#64748b" },
  avoid: { fill: "rgb(220 38 38 / 0.06)", label: "#dc2626" },
} as const;

const STATUS_COLOR: Record<InsightRow["status"], string> = {
  new: "#64748b",
  under_analysis: "#8b5cf6",
  approved: "#2563eb",
  in_progress: "#f59e0b",
  done: "#059669",
  discarded: "#94a3b8",
};

/**
 * Effort × impact matrix, drawn by hand in SVG.
 *
 * Clicking a point opens the insight; dragging it changes effort and impact,
 * snapping to the 1–10 grid. The drag is the whole point of the screen: moving
 * a dot is how a PM actually reprioritises, and typing two numbers in a form
 * is not the same gesture.
 */
export function EffortImpactMatrix({
  insights,
  canEdit,
  onOpen,
  onMove,
}: {
  insights: InsightRow[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, effort: number, impact: number) => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [drag, setDrag] = React.useState<{ id: string; effort: number; impact: number } | null>(
    null,
  );

  const plotWidth = SIZE - PADDING.left - PADDING.right;
  const plotHeight = SIZE - PADDING.top - PADDING.bottom;

  // Effort grows to the right, impact grows upwards.
  const toX = (effort: number) => PADDING.left + ((effort - 1) / 9) * plotWidth;
  const toY = (impact: number) => PADDING.top + plotHeight - ((impact - 1) / 9) * plotHeight;

  const fromPointer = (event: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    // The SVG scales with the container; map back through the viewBox.
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    const effort = Math.round(((x - PADDING.left) / plotWidth) * 9 + 1);
    const impact = Math.round(((PADDING.top + plotHeight - y) / plotHeight) * 9 + 1);
    return {
      effort: Math.max(1, Math.min(10, effort)),
      impact: Math.max(1, Math.min(10, impact)),
    };
  };

  function onPointerMove(event: React.PointerEvent) {
    if (!drag) return;
    const position = fromPointer(event);
    if (!position) return;
    if (position.effort !== drag.effort || position.impact !== drag.impact) {
      setDrag({ ...drag, ...position });
    }
  }

  function endDrag() {
    if (!drag) return;
    const original = insights.find((insight) => insight.id === drag.id);
    if (original && (original.effort !== drag.effort || original.impact !== drag.impact)) {
      onMove(drag.id, drag.effort, drag.impact);
    }
    setDrag(null);
  }

  if (insights.length === 0) {
    return (
      <EmptyState
        title="Nenhum insight na matriz"
        description="Cadastre insights com esforço e impacto de 1 a 10 para priorizá-los visualmente."
      />
    );
  }

  const midX = toX(5.5);
  const midY = toY(5.5);

  return (
    <div className="space-y-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-xl touch-none select-none"
        role="img"
        aria-label={`Matriz de esforço por impacto com ${insights.length} insights`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {/* Quadrants. */}
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={midX - PADDING.left}
          height={midY - PADDING.top}
          fill={QUADRANT_STYLE.quick_wins.fill}
        />
        <rect
          x={midX}
          y={PADDING.top}
          width={SIZE - PADDING.right - midX}
          height={midY - PADDING.top}
          fill={QUADRANT_STYLE.big_bets.fill}
        />
        <rect
          x={PADDING.left}
          y={midY}
          width={midX - PADDING.left}
          height={PADDING.top + plotHeight - midY}
          fill={QUADRANT_STYLE.fill_ins.fill}
        />
        <rect
          x={midX}
          y={midY}
          width={SIZE - PADDING.right - midX}
          height={PADDING.top + plotHeight - midY}
          fill={QUADRANT_STYLE.avoid.fill}
        />

        {/* Quadrant names. */}
        <text x={PADDING.left + 8} y={PADDING.top + 16} fontSize="11" fill={QUADRANT_STYLE.quick_wins.label} fontWeight="600">
          {QUADRANT_LABELS.quick_wins}
        </text>
        <text x={SIZE - PADDING.right - 8} y={PADDING.top + 16} fontSize="11" fill={QUADRANT_STYLE.big_bets.label} fontWeight="600" textAnchor="end">
          {QUADRANT_LABELS.big_bets}
        </text>
        <text x={PADDING.left + 8} y={PADDING.top + plotHeight - 8} fontSize="11" fill={QUADRANT_STYLE.fill_ins.label} fontWeight="600">
          {QUADRANT_LABELS.fill_ins}
        </text>
        <text x={SIZE - PADDING.right - 8} y={PADDING.top + plotHeight - 8} fontSize="11" fill={QUADRANT_STYLE.avoid.label} fontWeight="600" textAnchor="end">
          {QUADRANT_LABELS.avoid}
        </text>

        {/* Grid. */}
        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
          <g key={value}>
            <line
              x1={toX(value)}
              y1={PADDING.top}
              x2={toX(value)}
              y2={PADDING.top + plotHeight}
              stroke="rgb(var(--border))"
              strokeWidth={value === 1 || value === 10 ? 0 : 0.5}
              opacity={0.5}
            />
            <line
              x1={PADDING.left}
              y1={toY(value)}
              x2={PADDING.left + plotWidth}
              y2={toY(value)}
              stroke="rgb(var(--border))"
              strokeWidth={value === 1 || value === 10 ? 0 : 0.5}
              opacity={0.5}
            />
            <text x={toX(value)} y={SIZE - PADDING.bottom + 16} fontSize="9" fill="rgb(var(--fg-muted))" textAnchor="middle">
              {value}
            </text>
            <text x={PADDING.left - 8} y={toY(value) + 3} fontSize="9" fill="rgb(var(--fg-muted))" textAnchor="end">
              {value}
            </text>
          </g>
        ))}

        {/* Dividing lines. */}
        <line x1={midX} y1={PADDING.top} x2={midX} y2={PADDING.top + plotHeight} stroke="rgb(var(--border))" strokeWidth={1.5} />
        <line x1={PADDING.left} y1={midY} x2={PADDING.left + plotWidth} y2={midY} stroke="rgb(var(--border))" strokeWidth={1.5} />

        {/* Axis titles. */}
        <text x={PADDING.left + plotWidth / 2} y={SIZE - 6} fontSize="11" fill="rgb(var(--fg-muted))" textAnchor="middle">
          Esforço →
        </text>
        <text
          x={14}
          y={PADDING.top + plotHeight / 2}
          fontSize="11"
          fill="rgb(var(--fg-muted))"
          textAnchor="middle"
          transform={`rotate(-90 14 ${PADDING.top + plotHeight / 2})`}
        >
          Impacto →
        </text>

        {/* Points. */}
        {insights.map((insight) => {
          const position =
            drag?.id === insight.id
              ? { effort: drag.effort, impact: drag.impact }
              : { effort: insight.effort, impact: insight.impact };
          const dragging = drag?.id === insight.id;

          return (
            <g key={insight.id}>
              <circle
                cx={toX(position.effort)}
                cy={toY(position.impact)}
                r={dragging ? 11 : 8}
                fill={STATUS_COLOR[insight.status]}
                fillOpacity={insight.status === "discarded" ? 0.35 : 0.85}
                stroke="white"
                strokeWidth={2}
                className={cn(canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")}
                onPointerDown={(event) => {
                  if (!canEdit) return;
                  event.preventDefault();
                  // State first: capturing the pointer can throw (a pointer id
                  // that is no longer active), and losing the drag to that
                  // would be a silent failure.
                  setDrag({ id: insight.id, effort: insight.effort, impact: insight.impact });
                  try {
                    (event.target as SVGElement).setPointerCapture(event.pointerId);
                  } catch {
                    // Without capture the move events still reach the svg.
                  }
                }}
                onClick={() => {
                  if (!drag) onOpen(insight.id);
                }}
              >
                <title>
                  {insight.title} — esforço {position.effort}, impacto {position.impact}, score{" "}
                  {(position.impact / position.effort).toFixed(1).replace(".", ",")}
                </title>
              </circle>
              {dragging ? (
                <text
                  x={toX(position.effort)}
                  y={toY(position.impact) - 16}
                  fontSize="10"
                  textAnchor="middle"
                  fill="rgb(var(--fg))"
                  fontWeight="600"
                >
                  {position.effort} × {position.impact}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {(Object.keys(QUADRANT_LABELS) as (keyof typeof QUADRANT_LABELS)[]).map((quadrant) => {
          const count = insights.filter(
            (insight) => quadrantOf(insight.effort, insight.impact) === quadrant,
          ).length;
          return (
            <p key={quadrant} className="text-[11px] text-fg-muted">
              <strong style={{ color: QUADRANT_STYLE[quadrant].label }}>
                {QUADRANT_LABELS[quadrant]}
              </strong>{" "}
              ({count}) — {QUADRANT_DESCRIPTIONS[quadrant]}
            </p>
          );
        })}
      </div>

      {canEdit ? (
        <p className="text-[11px] text-fg-muted">
          Clique num ponto para abrir o insight; arraste para mudar esforço e impacto. Quem prefere
          teclado pode editar os dois campos no formulário.
        </p>
      ) : null}
    </div>
  );
}
