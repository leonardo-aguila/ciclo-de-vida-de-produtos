"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { MonthlyPoint, Payback } from "@/lib/engine/finance";
import { formatCurrency, formatMonths, formatPercent } from "@/lib/format";
import type { AuditRow, FinanceEntryRow } from "@/lib/queries/finance";
import { cn } from "@/lib/utils";
import type { MonthlySale } from "@db/schema";
import { AuditSection } from "./audit-section";
import { EntriesSection, type EntryType } from "./entries-section";
import { RevenueChart } from "./revenue-chart";
import { SalesSection } from "./sales-section";

type Section = "lancamentos" | "vendas" | "evolucao" | "auditoria";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "lancamentos", label: "Lançamentos" },
  { id: "vendas", label: "Vendas mensais" },
  { id: "evolucao", label: "Evolução" },
  { id: "auditoria", label: "Auditoria" },
];

export function FinanceClient({
  productId,
  productCode,
  entries,
  entryTypes,
  sales,
  series,
  payback,
  monthlyGoal,
  plannedByCompetence,
  auditRows,
  currency,
  canWrite,
  summary,
}: {
  productId: string;
  productCode: string;
  entries: FinanceEntryRow[];
  entryTypes: EntryType[];
  sales: MonthlySale[];
  series: MonthlyPoint[];
  payback: Payback;
  monthlyGoal: number | null;
  plannedByCompetence: Record<string, number>;
  auditRows: AuditRow[];
  currency: string;
  canWrite: boolean;
  summary: {
    accumulatedRevenue: number;
    accumulatedCost: number;
    roi: number | null;
    lastMargin: number | null;
    burn: number | null;
    months: number;
  };
}) {
  const [section, setSection] = useState<Section>("lancamentos");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Receita acumulada" value={formatCurrency(summary.accumulatedRevenue, currency)} />
        <Tile label="Custo total" value={formatCurrency(summary.accumulatedCost, currency)} />
        <Tile
          label="ROI acumulado"
          value={summary.roi === null ? "sem custo lançado" : formatPercent(summary.roi)}
          tone={summary.roi === null ? "neutral" : summary.roi >= 0 ? "green" : "red"}
        />
        <Tile
          label="Margem de contribuição do mês"
          value={summary.lastMargin === null ? "—" : formatCurrency(summary.lastMargin, currency)}
          tone={
            summary.lastMargin === null ? "neutral" : summary.lastMargin >= 0 ? "green" : "red"
          }
          hint={
            summary.burn !== null && (summary.lastMargin ?? 0) < 0
              ? `Burn médio de ${formatCurrency(summary.burn, currency)} por mês`
              : summary.months > 0
                ? `${formatMonths(summary.months)} de histórico`
                : undefined
          }
        />
      </div>

      <nav aria-label="Seções do financeiro" className="border-b border-border">
        <ul className="-mb-px flex flex-wrap gap-1">
          {SECTIONS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => setSection(item.id)}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 text-sm transition-colors",
                  section === item.id
                    ? "border-brand font-medium text-brand"
                    : "border-transparent text-fg-muted hover:border-border hover:text-fg",
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {section === "lancamentos" ? (
        <EntriesSection
          productId={productId}
          productCode={productCode}
          entries={entries}
          entryTypes={entryTypes}
          currency={currency}
          canWrite={canWrite}
        />
      ) : null}

      {section === "vendas" ? (
        <SalesSection
          productId={productId}
          productCode={productCode}
          sales={sales}
          currency={currency}
          canWrite={canWrite}
        />
      ) : null}

      {section === "evolucao" ? (
        <Card>
          <CardHeader
            title="Receita realizada × meta × plano"
            description="Com o custo acumulado e o ponto de payback marcado."
          />
          <CardBody>
            <RevenueChart
              series={series}
              monthlyGoal={monthlyGoal}
              plannedByCompetence={plannedByCompetence}
              payback={payback}
            />
          </CardBody>
        </Card>
      ) : null}

      {section === "auditoria" ? <AuditSection rows={auditRows} /> : null}
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
  tone?: "neutral" | "green" | "red";
}) {
  return (
    <Card className="p-3">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "green" && "text-green",
          tone === "red" && "text-red",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-fg-muted">{hint}</p> : null}
    </Card>
  );
}
