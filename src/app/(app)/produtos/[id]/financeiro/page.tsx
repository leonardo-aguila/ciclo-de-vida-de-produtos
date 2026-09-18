import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { canWriteFinance } from "@/lib/auth/policy";
import { buildMonthlySeries, payback, summarize } from "@/lib/engine/finance";
import { listEnumValues } from "@/lib/queries/enums";
import {
  listAuditTrail,
  listFinanceEntries,
  listMonthlySales,
} from "@/lib/queries/finance";
import { getPlannedRevenueByCompetence } from "@/lib/queries/business-plan";
import { getPrimaryGoal, getProduct } from "@/lib/queries/products";
import { getSettings } from "@/lib/queries/settings";
import { FinanceClient } from "./finance-client";

export const dynamic = "force-dynamic";

/** Goals are stated per period; the chart compares against a monthly target. */
function monthlyTarget(
  goal: { targetValue: number; period: "monthly" | "quarterly" | "annual" } | null,
): number | null {
  if (!goal) return null;
  const divisor = goal.period === "monthly" ? 1 : goal.period === "quarterly" ? 3 : 12;
  return goal.targetValue / divisor;
}

export default async function FinancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();

  const [entries, sales, auditRows, entryTypes, goal, settings, plannedByCompetence] =
    await Promise.all([
      listFinanceEntries(id),
      listMonthlySales(id),
      listAuditTrail(id),
      listEnumValues("finance_entry_type"),
      getPrimaryGoal(id),
      getSettings(),
      getPlannedRevenueByCompetence(id),
    ]);

  const series = buildMonthlySeries(
    sales.map((sale) => ({
      competence: sale.competence,
      newMrr: sale.newMrr,
      recurringRevenue: sale.recurringRevenue,
      oneTimeRevenue: sale.oneTimeRevenue,
      churnAmount: sale.churnAmount,
      activeCustomers: sale.activeCustomers,
    })),
    entries.map((entry) => ({
      competenceDate: entry.competenceDate,
      amount: entry.amount,
      isVariable: entry.isVariable,
      typeCode: entry.typeCode,
    })),
  );

  // Only revenue goals make sense as a line on a revenue chart.
  const goalIsMonetary = goal ? ["R$", "BRL", null].includes(goal.unit) : false;

  return (
    <FinanceClient
      productId={product.id}
      productCode={product.code}
      entries={entries}
      entryTypes={entryTypes.map((type) => ({
        id: type.id,
        code: type.code,
        label: type.label,
        color: type.color,
        isVariable: Boolean((type.meta as { isVariable?: boolean } | null)?.isVariable),
      }))}
      sales={sales}
      series={series}
      payback={payback(series, settings.projectionSettings.windowMonths)}
      monthlyGoal={goalIsMonetary ? monthlyTarget(goal) : null}
      plannedByCompetence={plannedByCompetence}
      auditRows={auditRows}
      currency={settings.defaultCurrency}
      canWrite={canWriteFinance(user, product)}
      summary={summarize(series)}
    />
  );
}
