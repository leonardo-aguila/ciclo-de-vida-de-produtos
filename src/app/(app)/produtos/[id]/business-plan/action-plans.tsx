"use client";

import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteActionPlanAction, saveActionPlanAction } from "@/app/actions/business-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import type { DeviationTrigger } from "@/lib/engine/business-plan";
import { addDaysToIso, formatCompetence, formatDate, formatSignedPercent, todayIso } from "@/lib/format";
import { ACTION_PLAN_STATUS_LABELS } from "@/lib/labels";
import type { ActionPlanRow } from "@/lib/queries/business-plan";
import { cn } from "@/lib/utils";

type Option = { id: string; label: string };

const STATUS_TONE = {
  pending: "neutral",
  in_progress: "blue",
  done: "green",
  cancelled: "neutral",
} as const;

/**
 * Action plans, and the deviation that calls for one.
 *
 * The trigger never creates anything by itself: it flags the situation and
 * offers a pre-filled form. An action plan that appears without anyone
 * deciding to write it is an action plan nobody owns.
 */
export function ActionPlansSection({
  productId,
  planId,
  actionPlans,
  trigger,
  people,
  canEdit,
}: {
  productId: string;
  planId: string | null;
  actionPlans: ActionPlanRow[];
  trigger: DeviationTrigger;
  people: Option[];
  canEdit: boolean;
}) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const today = todayIso();

  const overdue = actionPlans.filter(
    (plan) => plan.dueDate < today && plan.status !== "done" && plan.status !== "cancelled",
  );

  // A plan already linked to this deviation means the trigger was handled.
  const answered = trigger.competence
    ? actionPlans.some((plan) => plan.triggerCompetence === trigger.competence)
    : false;

  return (
    <div className="space-y-3">
      {notice ? <FormSuccess message={notice} /> : null}

      {trigger.triggered && !answered ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red/40 bg-red/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" />
            <div>
              <p className="text-sm font-medium text-red">Desvio acima do limite</p>
              <p className="text-xs text-fg-muted">{trigger.message}</p>
            </div>
          </div>
          {canEdit ? (
            <ActionPlanDialog
              productId={productId}
              planId={planId}
              people={people}
              trigger={trigger}
              onDone={setNotice}
              triggerLabel="Criar plano de ação"
              variant="danger"
            />
          ) : null}
        </div>
      ) : trigger.triggered && answered ? (
        <p className="rounded-xl border border-amber/40 bg-amber/5 px-4 py-2 text-xs text-amber">
          {trigger.message} Já existe um plano de ação vinculado a{" "}
          {formatCompetence(trigger.competence)}.
        </p>
      ) : (
        <p className="rounded-xl border border-border bg-surface-muted/60 px-4 py-2 text-xs text-fg-muted">
          {trigger.message}
        </p>
      )}

      <Card>
        <CardHeader
          title="Planos de ação"
          description="Planos vencidos e não concluídos penalizam o Health Score e aparecem como alerta."
          action={
            canEdit ? (
              <ActionPlanDialog
                productId={productId}
                planId={planId}
                people={people}
                onDone={setNotice}
              />
            ) : null
          }
        />
        <CardBody>
          {overdue.length > 0 ? (
            <p className="mb-3 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-xs text-red">
              {overdue.length}{" "}
              {overdue.length === 1
                ? "plano de ação vencido e não concluído"
                : "planos de ação vencidos e não concluídos"}
              .
            </p>
          ) : null}

          {actionPlans.length === 0 ? (
            <EmptyState
              title="Nenhum plano de ação"
              description="Quando o desvio acumulado passar do limite, registre aqui a causa-raiz, o responsável e o prazo."
            />
          ) : (
            <ul className="space-y-3">
              {actionPlans.map((plan) => {
                const isOverdue =
                  plan.dueDate < today && plan.status !== "done" && plan.status !== "cancelled";

                return (
                  <li
                    key={plan.id}
                    className={cn(
                      "rounded-lg border p-3",
                      isOverdue ? "border-red/40 bg-red/5" : "border-border",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {plan.name}
                          <Badge tone={STATUS_TONE[plan.status]}>
                            {ACTION_PLAN_STATUS_LABELS[plan.status]}
                          </Badge>
                          {isOverdue ? <Badge tone="red">Vencido</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-fg-muted">
                          Prazo {formatDate(plan.dueDate)}
                          {plan.ownerName ? ` · ${plan.ownerName}` : " · sem responsável"}
                          {plan.triggerDeviation !== null
                            ? ` · desvio de ${formatSignedPercent(plan.triggerDeviation)} em ${formatCompetence(plan.triggerCompetence)}`
                            : ""}
                        </p>
                      </div>
                      {canEdit ? (
                        <div className="flex gap-1">
                          <ActionPlanDialog
                            productId={productId}
                            planId={planId}
                            actionPlan={plan}
                            people={people}
                            onDone={setNotice}
                          />
                          <DeleteActionPlan plan={plan} onDone={setNotice} />
                        </div>
                      ) : null}
                    </div>

                    {plan.description ? (
                      <p className="mt-2 whitespace-pre-line text-xs">{plan.description}</p>
                    ) : null}

                    <dl className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Detail label="Causa-raiz" value={plan.rootCause} />
                      <Detail label="Resultado esperado" value={plan.expectedResult} />
                      <Detail label="Resultado obtido" value={plan.actualResult} />
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className="text-xs">{value ?? "—"}</dd>
    </div>
  );
}

function ActionPlanDialog({
  productId,
  planId,
  actionPlan,
  people,
  trigger,
  onDone,
  triggerLabel,
  variant,
}: {
  productId: string;
  planId: string | null;
  actionPlan?: ActionPlanRow;
  people: Option[];
  trigger?: DeviationTrigger;
  onDone: (message: string) => void;
  triggerLabel?: string;
  variant?: "danger";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    saveActionPlanAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Salvo.");
      router.refresh();
    }
  }, [state, onDone, router]);

  const editing = Boolean(actionPlan);
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="icon" aria-label={`Editar ${actionPlan!.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm" variant={variant === "danger" ? "danger" : "primary"}>
            <Plus className="h-4 w-4" />
            {triggerLabel ?? "Novo plano de ação"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={editing ? `Editar ${actionPlan!.name}` : "Novo plano de ação"}
        description={
          trigger?.triggered
            ? `Vinculado ao desvio acumulado de ${formatSignedPercent(trigger.deviation)} em ${formatCompetence(trigger.competence)}.`
            : undefined
        }
      >
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="productId" value={productId} />
          {editing ? <input type="hidden" name="id" value={actionPlan!.id} /> : null}
          {planId ? <input type="hidden" name="planId" value={planId} /> : null}
          {trigger?.triggered ? (
            <>
              <input type="hidden" name="triggerCompetence" value={trigger.competence ?? ""} />
              <input type="hidden" name="triggerDeviation" value={String(trigger.deviation ?? "")} />
            </>
          ) : actionPlan?.triggerCompetence ? (
            <>
              <input type="hidden" name="triggerCompetence" value={actionPlan.triggerCompetence} />
              <input
                type="hidden"
                name="triggerDeviation"
                value={String(actionPlan.triggerDeviation ?? "")}
              />
            </>
          ) : null}

          <Field label="Nome" name="name" errors={errors?.name} required>
            <input
              className="input"
              defaultValue={
                actionPlan?.name ??
                (trigger?.triggered
                  ? `Recuperar desvio de ${formatCompetence(trigger.competence)}`
                  : "")
              }
            />
          </Field>

          <Field label="Descrição" name="description" errors={errors?.description}>
            <textarea className="input" rows={2} defaultValue={actionPlan?.description ?? ""} />
          </Field>

          <Field
            label="Causa-raiz identificada"
            name="rootCause"
            errors={errors?.rootCause}
            hint="O que, de fato, produziu o desvio."
          >
            <textarea className="input" rows={2} defaultValue={actionPlan?.rootCause ?? ""} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Responsável" name="ownerId" errors={errors?.ownerId}>
              <select className="input" defaultValue={actionPlan?.ownerId ?? ""}>
                <option value="">Sem responsável</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Prazo" name="dueDate" errors={errors?.dueDate} required>
              <input
                className="input"
                type="date"
                defaultValue={actionPlan?.dueDate ?? addDaysToIso(todayIso(), 30)}
              />
            </Field>

            <Field label="Situação" name="status" errors={errors?.status} required>
              <select className="input" defaultValue={actionPlan?.status ?? "pending"}>
                {(["pending", "in_progress", "done", "cancelled"] as const).map((status) => (
                  <option key={status} value={status}>
                    {ACTION_PLAN_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Resultado esperado" name="expectedResult" errors={errors?.expectedResult}>
            <textarea className="input" rows={2} defaultValue={actionPlan?.expectedResult ?? ""} />
          </Field>

          <Field
            label="Resultado obtido"
            name="actualResult"
            errors={errors?.actualResult}
            hint="Preencha ao concluir, para o plano servir de aprendizado."
          >
            <textarea className="input" rows={2} defaultValue={actionPlan?.actualResult ?? ""} />
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

function DeleteActionPlan({
  plan,
  onDone,
}: {
  plan: ActionPlanRow;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    deleteActionPlanAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) {
      onDone(state.message ?? "Excluído.");
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={plan.id} />
      <Button type="submit" variant="ghost" size="icon" aria-label={`Excluir ${plan.name}`}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}
