"use client";

import { Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteMilestoneAction, saveMilestoneAction } from "@/app/actions/business-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { formatDate, formatPercent, todayIso } from "@/lib/format";
import { MILESTONE_STATUS_LABELS } from "@/lib/labels";
import type { Milestone } from "@db/schema";
import { cn } from "@/lib/utils";

const STATUS_TONE = { pending: "neutral", in_progress: "blue", done: "green" } as const;

export function MilestonesSection({
  planId,
  milestones,
  canEdit,
}: {
  planId: string;
  milestones: Milestone[];
  canEdit: boolean;
}) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const today = todayIso();

  const done = milestones.filter((milestone) => milestone.status === "done").length;
  const late = milestones.filter(
    (milestone) => milestone.status !== "done" && milestone.targetDate < today,
  ).length;

  return (
    <Card>
      <CardHeader
        title="Marcos"
        description={
          milestones.length > 0
            ? `${done} de ${milestones.length} concluídos (${formatPercent((done / milestones.length) * 100, 0)})${late > 0 ? ` · ${late} atrasado${late === 1 ? "" : "s"}` : ""}`
            : "Pontos de controle do plano, com critério de aceite."
        }
        action={
          canEdit ? <MilestoneDialog planId={planId} onDone={setNotice} /> : null
        }
      />
      <CardBody className="space-y-3">
        {notice ? <FormSuccess message={notice} /> : null}

        {milestones.length === 0 ? (
          <EmptyState
            title="Nenhum marco cadastrado"
            description="Marcos com critério de aceite deixam claro o que precisa estar pronto, e quando."
          />
        ) : (
          <ol className="space-y-2">
            {milestones.map((milestone) => {
              const isLate = milestone.status !== "done" && milestone.targetDate < today;
              return (
                <li
                  key={milestone.id}
                  className={cn(
                    "flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3",
                    isLate ? "border-amber/40 bg-amber/5" : "border-border",
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <Flag className="h-3.5 w-3.5 text-fg-muted" />
                      {milestone.name}
                      <Badge tone={STATUS_TONE[milestone.status]}>
                        {MILESTONE_STATUS_LABELS[milestone.status]}
                      </Badge>
                      {isLate ? <Badge tone="amber">Atrasado</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-fg-muted">
                      Alvo {formatDate(milestone.targetDate)}
                      {milestone.doneDate ? ` · concluído em ${formatDate(milestone.doneDate)}` : ""}
                    </p>
                    {milestone.acceptanceCriteria ? (
                      <p className="mt-1 whitespace-pre-line text-xs">
                        <span className="text-fg-muted">Critério de aceite: </span>
                        {milestone.acceptanceCriteria}
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex gap-1">
                      <MilestoneDialog planId={planId} milestone={milestone} onDone={setNotice} />
                      <DeleteMilestone milestone={milestone} onDone={setNotice} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

function MilestoneDialog({
  planId,
  milestone,
  onDone,
}: {
  planId: string;
  milestone?: Milestone;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    saveMilestoneAction,
    null,
  );

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
        {milestone ? (
          <Button variant="ghost" size="icon" aria-label={`Editar ${milestone.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Novo marco
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={milestone ? `Editar ${milestone.name}` : "Novo marco"}>
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="planId" value={planId} />
          {milestone ? <input type="hidden" name="id" value={milestone.id} /> : null}

          <Field label="Nome" name="name" errors={errors?.name} required>
            <input className="input" defaultValue={milestone?.name} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data-alvo" name="targetDate" errors={errors?.targetDate} required>
              <input
                className="input"
                type="date"
                defaultValue={milestone?.targetDate ?? todayIso()}
              />
            </Field>
            <Field label="Situação" name="status" errors={errors?.status} required>
              <select className="input" defaultValue={milestone?.status ?? "pending"}>
                {(["pending", "in_progress", "done"] as const).map((status) => (
                  <option key={status} value={status}>
                    {MILESTONE_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Critério de aceite"
            name="acceptanceCriteria"
            errors={errors?.acceptanceCriteria}
            hint="Como saber que o marco foi de fato atingido."
          >
            <textarea className="input" rows={3} defaultValue={milestone?.acceptanceCriteria ?? ""} />
          </Field>

          <Field
            label="Data de conclusão"
            name="doneDate"
            errors={errors?.doneDate}
            hint="Preenchida sozinha ao marcar como concluído."
          >
            <input className="input" type="date" defaultValue={milestone?.doneDate ?? ""} />
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

function DeleteMilestone({
  milestone,
  onDone,
}: {
  milestone: Milestone;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    deleteMilestoneAction,
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
      <input type="hidden" name="id" value={milestone.id} />
      <Button type="submit" variant="ghost" size="icon" aria-label={`Excluir ${milestone.name}`}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}
