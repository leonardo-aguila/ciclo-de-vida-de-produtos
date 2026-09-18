import { notFound } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/lib/auth/guard";
import { canWriteBusinessPlan } from "@/lib/auth/policy";
import {
  getPlanMonths,
  listActionPlans,
  listMilestones,
  listPlanVersions,
} from "@/lib/queries/business-plan";
import { getProductMetrics } from "@/lib/queries/metrics";
import { getProduct, listProductOwners } from "@/lib/queries/products";
import { getSettings } from "@/lib/queries/settings";
import { ActionPlansSection } from "./action-plans";
import { MilestonesSection } from "./milestones";
import { PlanHeader } from "./plan-header";
import { PlanVsActual } from "./plan-vs-actual";
import { ProjectionsTable } from "./projections-table";

export const dynamic = "force-dynamic";

export default async function BusinessPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();

  const [versions, actionPlans, people, settings, metrics] = await Promise.all([
    listPlanVersions(id),
    listActionPlans(id),
    listProductOwners(),
    getSettings(),
    getProductMetrics(id),
  ]);

  // The version being shown: the active one, or the newest.
  const current = versions.find((version) => version.status === "active") ?? versions[0] ?? null;

  const [months, planMilestones] = current
    ? await Promise.all([getPlanMonths(current.id), listMilestones(current.id)])
    : [[], []];

  // Each version's planned revenue, for the comparison table.
  const versionTotals = await Promise.all(
    versions.map(async (version) => {
      const rows = version.id === current?.id ? months : await getPlanMonths(version.id);
      return {
        id: version.id,
        total: rows.reduce((sum, row) => sum + row.plannedRevenue, 0),
      };
    }),
  );
  const totalById = new Map(versionTotals.map((row) => [row.id, row.total]));

  const canEdit = canWriteBusinessPlan(user, product);

  return (
    <div className="space-y-4">
      <PlanHeader
        productId={product.id}
        currentId={current?.id ?? null}
        canEdit={canEdit}
        currency={settings.defaultCurrency}
        versions={versions.map((version) => ({
          id: version.id,
          version: version.version,
          status: version.status,
          approvedAt: version.approvedAt,
          assumptions: version.assumptions,
          horizonMonths: version.horizonMonths,
          authorName: version.authorName,
          monthCount: version.monthCount,
          totalPlannedRevenue: totalById.get(version.id) ?? 0,
        }))}
      />

      {current ? (
        <>
          <ProjectionsTable
            planId={current.id}
            months={months.map((month) => ({
              competence: month.competence,
              plannedRevenue: month.plannedRevenue,
              plannedCost: month.plannedCost,
              plannedCustomers: month.plannedCustomers,
            }))}
            horizonMonths={current.horizonMonths}
            canEdit={canEdit}
            productCode={product.code}
            currency={settings.defaultCurrency}
          />

          <PlanVsActual rows={metrics.plan.rows} currency={settings.defaultCurrency} />

          <MilestonesSection
            planId={current.id}
            milestones={planMilestones}
            canEdit={canEdit}
          />
        </>
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              title="Nenhum Business Plan"
              description="Crie o plano para projetar receita, custo e clientes, e passar a comparar o realizado contra ele."
            />
          </CardBody>
        </Card>
      )}

      <ActionPlansSection
        productId={product.id}
        planId={current?.id ?? null}
        actionPlans={actionPlans}
        trigger={metrics.plan.trigger}
        people={people.map((person) => ({ id: person.id, label: person.name }))}
        canEdit={canEdit}
      />
    </div>
  );
}
