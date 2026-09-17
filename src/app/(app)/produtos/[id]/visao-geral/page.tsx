import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/lib/auth/guard";
import { daysBetween, formatCurrency, formatDate, formatDays, formatNumber, todayIso } from "@/lib/format";
import { GOAL_PERIOD_LABELS, PHASE_LABELS } from "@/lib/labels";
import { getPhaseHistory, getProduct, getProductGoals } from "@/lib/queries/products";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();

  const product = await getProduct(id);
  if (!product) notFound();

  const [goals, history] = await Promise.all([getProductGoals(id), getPhaseHistory(id)]);
  const today = todayIso();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Metas" description="A principal alimenta o painel executivo." />
          <CardBody>
            {goals.length === 0 ? (
              <EmptyState
                title="Nenhuma meta cadastrada"
                description="Cadastre ao menos uma meta e marque-a como principal, para que a saúde do produto possa ser medida."
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col" className="num">
                      Alvo
                    </th>
                    <th scope="col">Apuração</th>
                    <th scope="col">Data-limite</th>
                  </tr>
                </thead>
                <tbody>
                  {goals.map((goal) => (
                    <tr key={goal.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          {goal.goalTypeLabel ?? "—"}
                          {goal.isPrimary ? <Badge tone="blue">Principal</Badge> : null}
                        </span>
                      </td>
                      <td className="num">
                        {goal.unit === "R$"
                          ? formatCurrency(goal.targetValue)
                          : `${formatNumber(goal.targetValue)}${goal.unit ? ` ${goal.unit}` : ""}`}
                      </td>
                      <td>{GOAL_PERIOD_LABELS[goal.period]}</td>
                      <td>{formatDate(goal.deadline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tempo em cada fase" />
          <CardBody>
            {history.length === 0 ? (
              <EmptyState title="Sem histórico de fase" />
            ) : (
              <ol className="space-y-3">
                {history.map((entry) => {
                  const end = entry.endedAt ?? today;
                  const days = daysBetween(entry.startedAt, end);
                  return (
                    <li key={entry.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1 h-2 w-2 rounded-full ${entry.endedAt ? "bg-fg-muted/40" : "bg-brand"}`}
                        />
                        <span className="w-px flex-1 bg-border" />
                      </div>
                      <div className="pb-1">
                        <p className="text-sm font-medium">{PHASE_LABELS[entry.phase]}</p>
                        <p className="text-xs text-fg-muted">
                          {formatDate(entry.startedAt)} →{" "}
                          {entry.endedAt ? formatDate(entry.endedAt) : "atual"} ·{" "}
                          {formatDays(days)}
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

      <Card>
        <CardHeader title="Governança" />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Segmento / mercado-alvo" value={product.segment} />
          <Info label="Modelo de precificação" value={product.pricingModel} />
          <Info label="Time" value={product.team} />
          <Info label="Tags" value={product.tags.length > 0 ? product.tags.join(", ") : null} />
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="label">Principais concorrentes</p>
            <p className="whitespace-pre-line text-sm">{product.competitors ?? "—"}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Indicadores de ciclo de vida, evolução, saúde e continuidade"
          description="Entram na fase 7, quando o motor de cálculo já estiver pronto."
        />
        <CardBody>
          <EmptyState
            title="Indicadores em construção"
            description="Health Score, ROI, payback, projeção e recomendação de continuidade aparecem aqui."
          />
        </CardBody>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}
