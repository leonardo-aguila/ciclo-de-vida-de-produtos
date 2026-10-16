"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  deleteGoalMeasurementAction,
  saveGoalMeasurementAction,
} from "@/app/actions/goals";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { formatCompetence, formatCurrency, formatNumber, todayIso } from "@/lib/format";

export type Measurement = {
  id: string;
  competence: string;
  value: number;
  note: string | null;
};

/**
 * A apuração manual de uma meta, mês a mês.
 *
 * Só aparece nos tipos que a aplicação não deriva. Para Novo MRR e companhia
 * o realizado sai das vendas mensais, e um segundo lugar para digitá-lo seria
 * um segundo número para discordar do primeiro — o servidor recusa, não é só
 * o botão que some.
 */
export function GoalMeasurements({
  goalId,
  goalLabel,
  unit,
  measurements,
  canEdit,
}: {
  goalId: string;
  goalLabel: string;
  unit: string | null;
  measurements: Measurement[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const format = (value: number) =>
    unit === "R$" ? formatCurrency(value) : `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;

  const latest = measurements[measurements.length - 1];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {measurements.length === 0
            ? "Apurar"
            : `${measurements.length} apuraç${measurements.length === 1 ? "ão" : "ões"}`}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Apurações — ${goalLabel}`}
        description="Uma por competência. A mais recente dentro da janela do período é o realizado da meta."
      >
        <div className="space-y-4">
          {canEdit ? (
            <MeasurementForm
              goalId={goalId}
              unit={unit}
              defaultCompetence={nextCompetence(latest?.competence)}
              onSaved={() => router.refresh()}
            />
          ) : null}

          {measurements.length === 0 ? (
            <EmptyState
              title="Nenhuma apuração registrada"
              description={
                canEdit
                  ? "Enquanto não houver apuração, a meta aparece como não medida — e fica de fora do Health Score."
                  : "Quem é responsável pelo produto pode registrar a apuração."
              }
            />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Competência</th>
                    <th scope="col" className="num">Valor</th>
                    <th scope="col">Observação</th>
                    {canEdit ? <th scope="col" className="sr-only">Ações</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {[...measurements].reverse().map((measurement) => (
                    <tr key={measurement.id}>
                      <td>{formatCompetence(measurement.competence)}</td>
                      <td className="num">{format(measurement.value)}</td>
                      <td className="text-xs text-fg-muted">{measurement.note ?? "—"}</td>
                      {canEdit ? (
                        <td>
                          <DeleteMeasurement
                            measurement={measurement}
                            onDeleted={() => router.refresh()}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** O mês seguinte à última apuração, ou o atual quando não há nenhuma. */
function nextCompetence(latest: string | undefined): string {
  const current = todayIso().slice(0, 7);
  if (!latest) return current;
  const year = Number(latest.slice(0, 4));
  const month = Number(latest.slice(5, 7));
  const next = new Date(Date.UTC(year, month, 1));
  const candidate = next.toISOString().slice(0, 7);
  // Nunca sugere um mês à frente do atual: a apuração do mês que vem não
  // existe, e sugeri-la faria a pessoa gravar no lugar errado sem perceber.
  return candidate > current ? current : candidate;
}

function MeasurementForm({
  goalId,
  unit,
  defaultCompetence,
  onSaved,
}: {
  goalId: string;
  unit: string | null;
  defaultCompetence: string;
  onSaved: () => void;
}) {
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    saveGoalMeasurementAction,
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      onSaved();
    }
  }, [state, onSaved]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="goalId" value={goalId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Competência" name="competence" errors={errors?.competence} required>
          <input className="input" type="month" defaultValue={defaultCompetence} />
        </Field>
        <Field
          label={`Valor apurado${unit ? ` (${unit})` : ""}`}
          name="value"
          errors={errors?.value}
          required
        >
          <input className="input num" inputMode="decimal" />
        </Field>
      </div>

      <Field label="Observação" name="note" errors={errors?.note}>
        <input className="input" placeholder="De onde veio o número, se ajudar depois" />
      </Field>

      {state?.ok === false && state.error ? <FormError message={state.error} /> : null}

      <div className="flex justify-end">
        <SubmitButton size="sm">
          <Plus className="h-4 w-4" />
          Registrar apuração
        </SubmitButton>
      </div>
      <p className="text-[11px] text-fg-muted">
        Registrar uma competência que já existe substitui o valor dela.
      </p>
    </form>
  );
}

function DeleteMeasurement({
  measurement,
  onDeleted,
}: {
  measurement: Measurement;
  onDeleted: () => void;
}) {
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    deleteGoalMeasurementAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) onDeleted();
  }, [state, onDeleted]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={measurement.id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        aria-label={`Excluir a apuração de ${formatCompetence(measurement.competence)}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}
