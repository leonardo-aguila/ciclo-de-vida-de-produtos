"use client";

import { Copy, FileText, GitCompare, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { createVersionAction, savePlanAction } from "@/app/actions/business-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions";
import { formatCurrency, formatDate, formatSignedPercent } from "@/lib/format";
import { BUSINESS_PLAN_STATUS_LABELS } from "@/lib/labels";

export type VersionSummary = {
  id: string;
  version: number;
  status: "draft" | "active" | "superseded";
  approvedAt: string | null;
  assumptions: string | null;
  horizonMonths: number;
  authorName: string | null;
  monthCount: number;
  totalPlannedRevenue: number;
};

const STATUS_TONE = { draft: "neutral", active: "green", superseded: "neutral" } as const;

/**
 * Plan identity, versions and the comparison between them.
 *
 * A new version never overwrites the old one: the previous plan is what the
 * decisions of the time were based on, and losing it would erase the reason
 * anything was approved.
 */
export function PlanHeader({
  productId,
  versions,
  currentId,
  canEdit,
  currency,
}: {
  productId: string;
  versions: VersionSummary[];
  currentId: string | null;
  canEdit: boolean;
  currency: string;
}) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const current = versions.find((version) => version.id === currentId) ?? null;

  return (
    <div className="space-y-3">
      {notice ? <FormSuccess message={notice} /> : null}

      <Card>
        <CardHeader
          title={
            current ? (
              <span className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-fg-muted" />
                Business Plan — versão {current.version}
                <Badge tone={STATUS_TONE[current.status]}>
                  {BUSINESS_PLAN_STATUS_LABELS[current.status]}
                </Badge>
              </span>
            ) : (
              "Business Plan"
            )
          }
          description={
            current
              ? `${current.authorName ?? "autor não informado"} · horizonte de ${current.horizonMonths} meses${
                  current.approvedAt ? ` · aprovado em ${formatDate(current.approvedAt)}` : ""
                }`
              : "Nenhum plano cadastrado para este produto."
          }
          action={
            canEdit ? (
              <div className="flex flex-wrap gap-1">
                {current ? (
                  <>
                    <PlanDialog
                      productId={productId}
                      plan={current}
                      onDone={setNotice}
                    />
                    <NewVersionButton
                      productId={productId}
                      fromPlanId={current.id}
                      onDone={setNotice}
                    />
                  </>
                ) : (
                  <PlanDialog productId={productId} onDone={setNotice} />
                )}
              </div>
            ) : null
          }
        />
        {current ? (
          <CardBody className="space-y-3">
            <div>
              <p className="label">Premissas</p>
              <p className="whitespace-pre-line text-sm">
                {current.assumptions ?? "Nenhuma premissa registrada."}
              </p>
            </div>

            {versions.length > 1 ? (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                  <GitCompare className="h-3.5 w-3.5 text-fg-muted" />
                  Comparativo entre versões
                </p>
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Versão</th>
                        <th scope="col">Situação</th>
                        <th scope="col">Autor</th>
                        <th scope="col">Aprovada em</th>
                        <th scope="col" className="num">Meses</th>
                        <th scope="col" className="num">Receita planejada</th>
                        <th scope="col" className="num">Variação vs. anterior</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((version, index) => {
                        // Versions come newest first; the next row is the older one.
                        const previous = versions[index + 1];
                        const delta =
                          previous && previous.totalPlannedRevenue !== 0
                            ? ((version.totalPlannedRevenue - previous.totalPlannedRevenue) /
                                Math.abs(previous.totalPlannedRevenue)) *
                              100
                            : null;

                        return (
                          <tr key={version.id}>
                            <td className="font-medium">
                              v{version.version}
                              {version.id === currentId ? (
                                <span className="ml-1 text-[11px] text-fg-muted">(exibida)</span>
                              ) : null}
                            </td>
                            <td>
                              <Badge tone={STATUS_TONE[version.status]}>
                                {BUSINESS_PLAN_STATUS_LABELS[version.status]}
                              </Badge>
                            </td>
                            <td className="text-fg-muted">{version.authorName ?? "—"}</td>
                            <td>{formatDate(version.approvedAt)}</td>
                            <td className="num">{version.monthCount}</td>
                            <td className="num">
                              {formatCurrency(version.totalPlannedRevenue, currency)}
                            </td>
                            <td className="num">
                              {delta === null ? (
                                <span className="text-fg-muted">—</span>
                              ) : (
                                <span className={delta >= 0 ? "text-green" : "text-red"}>
                                  {formatSignedPercent(delta)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

function PlanDialog({
  productId,
  plan,
  onDone,
}: {
  productId: string;
  plan?: VersionSummary;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = React.useActionState<
    ActionResult<{ id: string } | null> | null,
    FormData
  >(savePlanAction, null);

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Salvo.");
      router.refresh();
    }
  }, [state, onDone, router]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {plan ? (
          <Button variant="ghost" size="sm">
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Criar Business Plan
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={plan ? `Editar versão ${plan.version}` : "Novo Business Plan"}>
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="productId" value={productId} />
          {plan ? <input type="hidden" name="id" value={plan.id} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Horizonte (meses)"
              name="horizonMonths"
              errors={errors?.horizonMonths}
              required
            >
              <input
                className="input num"
                type="number"
                min={1}
                max={120}
                defaultValue={plan?.horizonMonths ?? 12}
              />
            </Field>
            <Field label="Data de aprovação" name="approvedAt" errors={errors?.approvedAt}>
              <input className="input" type="date" defaultValue={plan?.approvedAt ?? ""} />
            </Field>
          </div>

          <Field label="Situação" name="status" errors={errors?.status} required>
            <select className="input" defaultValue={plan?.status ?? "active"}>
              <option value="active">Vigente</option>
              <option value="draft">Rascunho</option>
              <option value="superseded">Substituído</option>
            </select>
          </Field>

          <Field
            label="Premissas"
            name="assumptions"
            errors={errors?.assumptions}
            hint="O que este plano assume: preço, canal, capacidade, câmbio, o que for."
          >
            <textarea className="input" rows={6} defaultValue={plan?.assumptions ?? ""} />
          </Field>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm">Salvar</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewVersionButton({
  productId,
  fromPlanId,
  onDone,
}: {
  productId: string;
  fromPlanId: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = React.useActionState<
    ActionResult<{ id: string } | null> | null,
    FormData
  >(createVersionAction, null);

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Versão criada.");
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Copy className="h-4 w-4" />
          Nova versão
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Criar nova versão do plano"
        description="A versão atual é preservada e passa a constar como substituída. O comparativo entre versões continua acessível."
      >
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="fromPlanId" value={fromPlanId} />

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="copyContent" value="true" defaultChecked />
            Copiar projeções e marcos da versão atual como ponto de partida
          </label>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm">Criar versão</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
