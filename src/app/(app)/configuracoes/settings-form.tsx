"use client";

import { useActionState, useState } from "react";
import { saveSettingsAction } from "@/app/actions/config";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { formatNumber } from "@/lib/format";
import type { AppSettings } from "@db/schema";

const WEIGHT_FIELDS = [
  { name: "weightGoal", key: "goal", label: "Atingimento da meta", detail: "min(realizado / alvo, 1,2) × 100" },
  { name: "weightFinancial", key: "financial", label: "Saúde financeira", detail: "ROI acumulado e margem de contribuição normalizados" },
  { name: "weightExecution", key: "execution", label: "Execução / cronograma", detail: "% concluído realizado sobre o esperado, com penalidade por atraso" },
  { name: "weightBusinessPlan", key: "businessPlan", label: "Aderência ao Business Plan", detail: "1 − |desvio acumulado|" },
  { name: "weightRisk", key: "risk", label: "Risco em aberto", detail: "penalidade por planos de ação vencidos e insights críticos sem tratamento" },
] as const;

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const [state, formAction] = useActionState(saveSettingsAction, null);
  const [weights, setWeights] = useState(settings.healthWeights);

  const total =
    weights.goal + weights.financial + weights.execution + weights.businessPlan + weights.risk;
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Card>
        <CardHeader
          title="Pesos do Health Score"
          description="Precisam somar 100 — é o que faz os limites do semáforo significarem alguma coisa."
          action={
            <span
              className={`text-xs font-medium ${Math.abs(total - 100) < 0.01 ? "text-green" : "text-red"}`}
            >
              Soma: {formatNumber(total)}
            </span>
          }
        />
        <CardBody className="space-y-3">
          {WEIGHT_FIELDS.map((field) => (
            <div key={field.name} className="grid items-center gap-2 sm:grid-cols-[1fr_6rem]">
              <div>
                <label className="text-sm font-medium" htmlFor={field.name}>
                  {field.label}
                </label>
                <p className="text-[11px] text-fg-muted">{field.detail}</p>
              </div>
              <input
                id={field.name}
                name={field.name}
                className="input num"
                inputMode="decimal"
                value={weights[field.key]}
                onChange={(event) =>
                  setWeights((current) => ({
                    ...current,
                    [field.key]: Number(event.target.value.replace(",", ".")) || 0,
                  }))
                }
              />
            </div>
          ))}
          {errors?.weightGoal ? <p className="field-error">{errors.weightGoal[0]}</p> : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Semáforo" description="Faixas do Health Score." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Verde a partir de"
              name="semaphoreGreen"
              errors={errors?.semaphoreGreen}
              required
            >
              <input
                className="input num"
                inputMode="decimal"
                defaultValue={settings.semaphoreThresholds.green}
              />
            </Field>
            <Field
              label="Amarelo a partir de"
              name="semaphoreAmber"
              errors={errors?.semaphoreAmber}
              hint="Abaixo disso, vermelho."
              required
            >
              <input
                className="input num"
                inputMode="decimal"
                defaultValue={settings.semaphoreThresholds.amber}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Projeção e Business Plan" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Janela da projeção (meses)"
              name="projectionWindowMonths"
              errors={errors?.projectionWindowMonths}
              hint="Histórico usado na regressão da receita."
              required
            >
              <input
                className="input num"
                type="number"
                min={2}
                max={24}
                defaultValue={settings.projectionSettings.windowMonths}
              />
            </Field>
            <Field
              label="Horizonte da projeção (meses)"
              name="projectionHorizonMonths"
              errors={errors?.projectionHorizonMonths}
              required
            >
              <input
                className="input num"
                type="number"
                min={1}
                max={60}
                defaultValue={settings.projectionSettings.horizonMonths}
              />
            </Field>
            <Field
              label="Desvio que dispara plano de ação (%)"
              name="bpDeviationLimit"
              errors={errors?.bpDeviationLimit}
              hint="Negativo, por exemplo -15."
              required
              className="sm:col-span-2"
            >
              <input
                className="input num"
                inputMode="decimal"
                defaultValue={settings.bpDeviationLimit}
              />
            </Field>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Regras de recomendação de continuidade"
          description="A recomendação é sempre sugestão: quem decide é você, e a decisão fica no histórico do produto."
        />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Escalar — Health mínimo" name="scaleMinHealth" errors={errors?.scaleMinHealth} required>
            <input className="input num" inputMode="decimal" defaultValue={settings.recommendationRules.scale.minHealth} />
          </Field>
          <Field label="Escalar — ROI acumulado maior que (%)" name="scaleMinRoi" errors={errors?.scaleMinRoi} required>
            <input className="input num" inputMode="decimal" defaultValue={settings.recommendationRules.scale.minRoi} />
          </Field>
          <Field
            label="Escalar — crescimento MoM médio 3M maior que (%)"
            name="scaleMinMomGrowth"
            errors={errors?.scaleMinMomGrowth}
            required
          >
            <input className="input num" inputMode="decimal" defaultValue={settings.recommendationRules.scale.minMomGrowth} />
          </Field>
          <Field
            label="Manter — ROI projetado 12M maior que (%)"
            name="keepMinProjectedRoi"
            errors={errors?.keepMinProjectedRoi}
            required
          >
            <input className="input num" inputMode="decimal" defaultValue={settings.recommendationRules.keep.minProjectedRoi} />
          </Field>
          <Field
            label="Pivotar — meses seguidos de margem negativa"
            name="pivotMinNegativeMarginMonths"
            errors={errors?.pivotMinNegativeMarginMonths}
            required
          >
            <input
              className="input num"
              type="number"
              min={1}
              max={24}
              defaultValue={settings.recommendationRules.pivot.minNegativeMarginMonths}
            />
          </Field>
          <Field
            label="Descontinuar — ROI acumulado abaixo de (%)"
            name="discontinueMaxRoi"
            errors={errors?.discontinueMaxRoi}
            required
          >
            <input className="input num" inputMode="decimal" defaultValue={settings.recommendationRules.discontinue.maxRoi} />
          </Field>
          <Field
            label="Descontinuar — ROI projetado abaixo de (%)"
            name="discontinueMaxProjectedRoi"
            errors={errors?.discontinueMaxProjectedRoi}
            required
          >
            <input
              className="input num"
              inputMode="decimal"
              defaultValue={settings.recommendationRules.discontinue.maxProjectedRoi}
            />
          </Field>
          <Field
            label="Descontinuar — meses seguidos de queda"
            name="discontinueMinDecliningMonths"
            errors={errors?.discontinueMinDecliningMonths}
            required
          >
            <input
              className="input num"
              type="number"
              min={1}
              max={24}
              defaultValue={settings.recommendationRules.discontinue.minDecliningMonths}
            />
          </Field>
          <Field label="Moeda padrão" name="defaultCurrency" errors={errors?.defaultCurrency} required>
            <input className="input" maxLength={3} defaultValue={settings.defaultCurrency} />
          </Field>
        </CardBody>
      </Card>

      {state?.ok === false ? <FormError message={state.error} /> : null}
      {state?.ok ? <FormSuccess message={state.message} /> : null}

      <div className="flex justify-end">
        <SubmitButton>Salvar configurações</SubmitButton>
      </div>
    </form>
  );
}
