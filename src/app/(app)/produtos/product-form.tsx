"use client";

import { Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { createProductAction, updateProductAction } from "@/app/actions/products";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError, SubmitButton } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions";
import { formatCurrency, formatNumber, parseDecimalInput } from "@/lib/format";
import { GOAL_PERIOD_LABELS, PHASE_LABELS, PHASE_ORDER, PRODUCT_STATUS_LABELS } from "@/lib/labels";
import type { LifecyclePhase } from "@db/schema";

type Option = { id: string; label: string; meta?: Record<string, unknown> | null };

export type ProductFormValues = {
  id?: string;
  name: string;
  code: string;
  shortDescription: string | null;
  ownerId: string | null;
  team: string | null;
  categoryId: string | null;
  phase: LifecyclePhase;
  status: "active" | "paused" | "discontinued";
  startDate: string;
  plannedLaunchDate: string | null;
  actualLaunchDate: string | null;
  segment: string | null;
  pricingModel: string | null;
  competitors: string | null;
  tags: string[];
};

type GoalRow = {
  key: string;
  goalTypeId: string;
  targetValue: string;
  unit: string;
  period: "monthly" | "quarterly" | "annual";
  deadline: string;
  isPrimary: boolean;
};

export function ProductForm({
  product,
  goals: initialGoals,
  goalTypes,
  categories,
  owners,
  packages,
}: {
  product?: ProductFormValues;
  goals?: {
    goalTypeId: string;
    targetValue: number;
    unit: string | null;
    period: "monthly" | "quarterly" | "annual";
    deadline: string | null;
    isPrimary: boolean;
  }[];
  goalTypes: Option[];
  categories: Option[];
  owners: { id: string; name: string }[];
  packages: { id: string; name: string; taskCount: number }[];
}) {
  const router = useRouter();
  const editing = Boolean(product?.id);

  const [state, formAction] = useActionState<ActionResult<{ id: string } | null> | null, FormData>(
    editing ? updateProductAction : createProductAction,
    null,
  );

  const [goals, setGoals] = useState<GoalRow[]>(() =>
    (initialGoals ?? []).map((goal, index) => ({
      key: `goal-${index}`,
      goalTypeId: goal.goalTypeId,
      targetValue: formatNumber(goal.targetValue),
      unit: goal.unit ?? "",
      period: goal.period,
      deadline: goal.deadline ?? "",
      isPrimary: goal.isPrimary,
    })),
  );

  useEffect(() => {
    if (state?.ok && state.data?.id) {
      router.push(`/produtos/${state.data.id}`);
      router.refresh();
    }
  }, [state, router]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;

  // Goals travel as JSON: a repeating fieldset does not survive a plain post.
  const goalsPayload = useMemo(
    () =>
      JSON.stringify(
        goals
          .filter((goal) => goal.goalTypeId)
          .map((goal) => ({
            goalTypeId: goal.goalTypeId,
            targetValue: goal.targetValue,
            unit: goal.unit || undefined,
            period: goal.period,
            deadline: goal.deadline || undefined,
            isPrimary: goal.isPrimary,
          })),
      ),
    [goals],
  );

  function addGoal() {
    setGoals((current) => [
      ...current,
      {
        key: `goal-${Date.now()}`,
        goalTypeId: goalTypes[0]?.id ?? "",
        targetValue: "",
        unit: (goalTypes[0]?.meta as { unit?: string } | null)?.unit ?? "",
        period: "monthly",
        deadline: "",
        // The first goal is the primary one by default; the dashboard needs one.
        isPrimary: current.length === 0,
      },
    ]);
  }

  function updateGoal(key: string, patch: Partial<GoalRow>) {
    setGoals((current) =>
      current.map((goal) => (goal.key === key ? { ...goal, ...patch } : goal)),
    );
  }

  function removeGoal(key: string) {
    setGoals((current) => {
      const next = current.filter((goal) => goal.key !== key);
      // Removing the primary goal must not leave the product without one.
      if (next.length > 0 && !next.some((goal) => goal.isPrimary)) {
        next[0] = { ...next[0]!, isPrimary: true };
      }
      return next;
    });
  }

  function setPrimary(key: string) {
    setGoals((current) => current.map((goal) => ({ ...goal, isPrimary: goal.key === key })));
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {editing ? <input type="hidden" name="id" value={product!.id} /> : null}
      <input type="hidden" name="goals" value={goalsPayload} />

      <Card>
        <CardHeader title="Identificação" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" name="name" errors={errors?.name} required className="sm:col-span-2">
            <input className="input" defaultValue={product?.name} required />
          </Field>

          <Field
            label="Código interno"
            name="code"
            errors={errors?.code}
            hint="Identificador curto e único, por exemplo SKY-CLOUD."
            required
          >
            <input className="input font-mono" defaultValue={product?.code} required />
          </Field>

          <Field label="Categoria / linha de produto" name="categoryId" errors={errors?.categoryId}>
            <select className="input" defaultValue={product?.categoryId ?? ""}>
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Descrição curta"
            name="shortDescription"
            errors={errors?.shortDescription}
            className="sm:col-span-2"
          >
            <textarea className="input" rows={2} defaultValue={product?.shortDescription ?? ""} />
          </Field>

          <Field label="Responsável (product owner)" name="ownerId" errors={errors?.ownerId}>
            <select className="input" defaultValue={product?.ownerId ?? ""}>
              <option value="">Sem responsável</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Time" name="team" errors={errors?.team}>
            <input className="input" defaultValue={product?.team ?? ""} />
          </Field>

          <Field label="Fase atual do ciclo de vida" name="phase" errors={errors?.phase} required>
            <select className="input" defaultValue={product?.phase ?? "conception"}>
              {PHASE_ORDER.map((phase) => (
                <option key={phase} value={phase}>
                  {PHASE_LABELS[phase]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status" name="status" errors={errors?.status} required>
            <select className="input" defaultValue={product?.status ?? "active"}>
              {(["active", "paused", "discontinued"] as const).map((status) => (
                <option key={status} value={status}>
                  {PRODUCT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Data de início" name="startDate" errors={errors?.startDate} required>
            <input
              className="input"
              type="date"
              defaultValue={product?.startDate ?? new Date().toISOString().slice(0, 10)}
              required
            />
          </Field>

          <Field
            label="Data prevista de lançamento"
            name="plannedLaunchDate"
            errors={errors?.plannedLaunchDate}
          >
            <input className="input" type="date" defaultValue={product?.plannedLaunchDate ?? ""} />
          </Field>

          <Field
            label="Data real de lançamento"
            name="actualLaunchDate"
            errors={errors?.actualLaunchDate}
            hint="Preencha quando o produto for efetivamente lançado."
          >
            <input className="input" type="date" defaultValue={product?.actualLaunchDate ?? ""} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Metas"
          description="A meta principal é a que alimenta o painel executivo."
          action={
            <Button type="button" variant="secondary" size="sm" onClick={addGoal}>
              <Plus className="h-4 w-4" />
              Adicionar meta
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {goals.length === 0 ? (
            <p className="rounded-lg bg-surface-muted/60 px-3 py-4 text-center text-xs text-fg-muted">
              Nenhuma meta cadastrada. Sem meta principal, o painel executivo não consegue medir o
              atingimento deste produto.
            </p>
          ) : null}

          {goals.map((goal) => {
            const unitFromType = (goalTypes.find((type) => type.id === goal.goalTypeId)?.meta as
              | { unit?: string }
              | null)?.unit;
            const parsed = parseDecimalInput(goal.targetValue);

            return (
              <div
                key={goal.key}
                className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-4">
                  <label className="label" htmlFor={`type-${goal.key}`}>
                    Tipo de meta
                  </label>
                  <select
                    id={`type-${goal.key}`}
                    className="input"
                    value={goal.goalTypeId}
                    onChange={(event) =>
                      updateGoal(goal.key, {
                        goalTypeId: event.target.value,
                        unit:
                          (goalTypes.find((type) => type.id === event.target.value)?.meta as
                            | { unit?: string }
                            | null)?.unit ?? goal.unit,
                      })
                    }
                  >
                    {goalTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor={`value-${goal.key}`}>
                    Valor-alvo
                  </label>
                  <input
                    id={`value-${goal.key}`}
                    className="input"
                    inputMode="decimal"
                    value={goal.targetValue}
                    placeholder="0,00"
                    onChange={(event) => updateGoal(goal.key, { targetValue: event.target.value })}
                  />
                  {unitFromType === "R$" && parsed !== null ? (
                    <p className="mt-1 text-[11px] text-fg-muted">{formatCurrency(parsed)}</p>
                  ) : null}
                </div>

                <div className="sm:col-span-1">
                  <label className="label" htmlFor={`unit-${goal.key}`}>
                    Unidade
                  </label>
                  <input
                    id={`unit-${goal.key}`}
                    className="input"
                    value={goal.unit}
                    onChange={(event) => updateGoal(goal.key, { unit: event.target.value })}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor={`period-${goal.key}`}>
                    Apuração
                  </label>
                  <select
                    id={`period-${goal.key}`}
                    className="input"
                    value={goal.period}
                    onChange={(event) =>
                      updateGoal(goal.key, { period: event.target.value as GoalRow["period"] })
                    }
                  >
                    {(["monthly", "quarterly", "annual"] as const).map((period) => (
                      <option key={period} value={period}>
                        {GOAL_PERIOD_LABELS[period]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor={`deadline-${goal.key}`}>
                    Data-limite
                  </label>
                  <input
                    id={`deadline-${goal.key}`}
                    className="input"
                    type="date"
                    value={goal.deadline}
                    onChange={(event) => updateGoal(goal.key, { deadline: event.target.value })}
                  />
                </div>

                <div className="flex items-end gap-1 sm:col-span-1">
                  <Button
                    type="button"
                    variant={goal.isPrimary ? "primary" : "ghost"}
                    size="icon"
                    aria-label={goal.isPrimary ? "Meta principal" : "Marcar como meta principal"}
                    aria-pressed={goal.isPrimary}
                    title={goal.isPrimary ? "Meta principal" : "Marcar como principal"}
                    onClick={() => setPrimary(goal.key)}
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover meta"
                    onClick={() => removeGoal(goal.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {errors?.goals ? <p className="field-error">{errors.goals[0]}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Governança" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Segmento / mercado-alvo" name="segment" errors={errors?.segment}>
            <input className="input" defaultValue={product?.segment ?? ""} />
          </Field>
          <Field label="Modelo de precificação" name="pricingModel" errors={errors?.pricingModel}>
            <input className="input" defaultValue={product?.pricingModel ?? ""} />
          </Field>
          <Field
            label="Principais concorrentes"
            name="competitors"
            errors={errors?.competitors}
            className="sm:col-span-2"
          >
            <textarea className="input" rows={2} defaultValue={product?.competitors ?? ""} />
          </Field>
          <Field
            label="Tags"
            name="tags"
            errors={errors?.tags}
            hint="Separadas por vírgula."
            className="sm:col-span-2"
          >
            <input className="input" defaultValue={product?.tags.join(", ") ?? ""} />
          </Field>

          {!editing ? (
            <Field
              label="Pacote padrão de tarefas"
              name="packageId"
              errors={errors?.packageId}
              hint="As tarefas do pacote são criadas junto com o produto, com as datas calculadas a partir das âncoras."
              className="sm:col-span-2"
            >
              <select className="input" defaultValue="">
                <option value="">Não aplicar pacote</option>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} ({pkg.taskCount} {pkg.taskCount === 1 ? "tarefa" : "tarefas"})
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="sm:col-span-2">
              <p className="label">Pacote padrão de tarefas</p>
              <p className="text-xs text-fg-muted">
                Para acrescentar um pacote a este produto, use{" "}
                <Badge tone="neutral">Aplicar pacote</Badge> na aba de tarefas.
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {state?.ok === false ? <FormError message={state.error} /> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
        <SubmitButton>{editing ? "Salvar alterações" : "Criar produto"}</SubmitButton>
      </div>
    </form>
  );
}
