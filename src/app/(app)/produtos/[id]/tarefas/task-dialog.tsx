"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { createTaskAction, deleteTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FormError, SubmitButton } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions";
import { PRIORITY_LABELS } from "@/lib/labels";
import type { TaskRow } from "@/lib/queries/tasks";
import type { Column } from "./kanban-board";

type Option = { id: string; label: string };

export function TaskDialog({
  open,
  onOpenChange,
  productId,
  task,
  tasks,
  columns,
  categories,
  assignees,
  canEdit,
  canDelete,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  task: TaskRow | null;
  tasks: TaskRow[];
  columns: Column[];
  categories: Option[];
  assignees: Option[];
  canEdit: boolean;
  canDelete: boolean;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(task);
  const [state, formAction] = useActionState<ActionResult<{ id: string } | null> | null, FormData>(
    editing ? updateTaskAction : createTaskAction,
    null,
  );
  const [dependsOn, setDependsOn] = useState<string[]>(task?.dependsOn ?? []);

  useEffect(() => setDependsOn(task?.dependsOn ?? []), [task]);

  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      onSaved(state.message ?? "Salvo.");
    }
  }, [state, onOpenChange, onSaved]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;
  const candidates = tasks.filter((other) => other.id !== task?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? task!.name : "Nova tarefa"}
        description={
          canEdit ? undefined : "Você tem acesso somente de leitura a esta tarefa."
        }
      >
        <form action={formAction} className="space-y-3" noValidate>
          {editing ? (
            <input type="hidden" name="id" value={task!.id} />
          ) : (
            <input type="hidden" name="productId" value={productId} />
          )}
          <input type="hidden" name="dependsOn" value={JSON.stringify(dependsOn)} />

          <Field label="Nome" name="name" errors={errors?.name} required>
            <input className="input" defaultValue={task?.name} disabled={!canEdit} />
          </Field>

          <Field label="Descrição" name="description" errors={errors?.description}>
            <textarea
              className="input"
              rows={2}
              defaultValue={task?.description ?? ""}
              disabled={!canEdit}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria" name="categoryId" errors={errors?.categoryId}>
              <select className="input" defaultValue={task?.categoryId ?? ""} disabled={!canEdit}>
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Responsável" name="assigneeId" errors={errors?.assigneeId}>
              <select className="input" defaultValue={task?.assigneeId ?? ""} disabled={!canEdit}>
                <option value="">Sem responsável</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Situação" name="status" errors={errors?.status} required>
              <select
                className="input"
                defaultValue={task?.status ?? columns[0]?.code ?? "backlog"}
                disabled={!canEdit}
              >
                {columns.map((column) => (
                  <option key={column.code} value={column.code}>
                    {column.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Prioridade" name="priority" errors={errors?.priority} required>
              <select className="input" defaultValue={task?.priority ?? "medium"} disabled={!canEdit}>
                {(["low", "medium", "high", "critical"] as const).map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="% de conclusão"
              name="progress"
              errors={errors?.progress}
              hint="Ao chegar a 100%, a tarefa vai para a coluna de concluído."
              required
            >
              <input
                className="input num"
                type="number"
                min={0}
                max={100}
                defaultValue={task?.progress ?? 0}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Estimativa (horas)" name="estimatedHours" errors={errors?.estimatedHours}>
              <input
                className="input num"
                inputMode="decimal"
                defaultValue={task?.estimatedHours ?? ""}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Data de início" name="startDate" errors={errors?.startDate}>
              <input
                className="input"
                type="date"
                defaultValue={task?.startDate ?? ""}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Prazo de conclusão" name="dueDate" errors={errors?.dueDate}>
              <input
                className="input"
                type="date"
                defaultValue={task?.dueDate ?? ""}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="Data real de conclusão"
              name="doneDate"
              errors={errors?.doneDate}
              hint="Preenchida sozinha ao concluir."
            >
              <input
                className="input"
                type="date"
                defaultValue={task?.doneDate ?? ""}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Tarefa-mãe" name="parentTaskId" errors={errors?.parentTaskId}>
              <select className="input" defaultValue={task?.parentTaskId ?? ""} disabled={!canEdit}>
                <option value="">Nenhuma</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="isMilestone"
              value="true"
              defaultChecked={task?.isMilestone}
              disabled={!canEdit}
            />
            É um marco (aparece como losango no Gantt)
          </label>

          {candidates.length > 0 ? (
            <fieldset>
              <legend className="label">Depende de</legend>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border p-2">
                <div className="flex flex-wrap gap-2">
                  {candidates.map((candidate) => (
                    <label
                      key={candidate.id}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={dependsOn.includes(candidate.id)}
                        disabled={!canEdit}
                        onChange={(event) =>
                          setDependsOn((current) =>
                            event.target.checked
                              ? [...current, candidate.id]
                              : current.filter((id) => id !== candidate.id),
                          )
                        }
                      />
                      {candidate.name}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>
          ) : null}

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex items-center justify-between gap-2 pt-1">
            {editing && canDelete ? (
              <DeleteTask taskId={task!.id} onDeleted={onSaved} onClose={() => onOpenChange(false)} />
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              {canEdit ? <SubmitButton size="sm">Salvar</SubmitButton> : null}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTask({
  taskId,
  onDeleted,
  onClose,
}: {
  taskId: string;
  onDeleted: (message: string) => void;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    deleteTaskAction,
    null,
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      onClose();
      onDeleted(state.message ?? "Tarefa excluída.");
    }
  }, [state, onClose, onDeleted]);

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="h-4 w-4" />
        Excluir
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span className="text-[11px] text-fg-muted">Confirma?</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Não
      </Button>
      <Button
        type="button"
        variant="danger"
        size="sm"
        onClick={() => {
          const form = new FormData();
          form.set("id", taskId);
          // The delete lives outside the edit form, so it cannot submit it.
          void formAction(form);
        }}
      >
        Excluir
      </Button>
    </span>
  );
}
