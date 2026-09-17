"use client";

import { CalendarRange, Check, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  deleteTemplateAction,
  reorderTemplatesAction,
  saveTemplateAction,
} from "@/app/actions/packages";
import { SortableList } from "@/components/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormSuccess } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { planTasksFromPackage } from "@/lib/engine/schedule";
import { formatDate, formatDays, todayIso } from "@/lib/format";
import { PRIORITY_LABELS, TASK_ANCHOR_LABELS } from "@/lib/labels";

type Template = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  defaultAssigneeId: string | null;
  priority: "low" | "medium" | "high" | "critical";
  initialStatus: string;
  estimatedHours: number | null;
  anchor: "start_date" | "planned_launch_date";
  startOffsetDays: number;
  endOffsetDays: number;
  orderIndex: number;
  dependsOn: string[];
};

type Option = { id: string; label: string };

export function TemplateEditor({
  packageId,
  templates: initial,
  categories,
  columns,
  owners,
}: {
  packageId: string;
  templates: Template[];
  categories: Option[];
  columns: { code: string; label: string }[];
  owners: Option[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setTemplates(initial), [initial]);

  async function persistOrder(ordered: Template[]) {
    setTemplates(ordered);
    const form = new FormData();
    form.set("packageId", packageId);
    form.set("order", JSON.stringify(ordered.map((template) => template.id)));
    const result = await reorderTemplatesAction(null, form);
    if (!result.ok) setTemplates(initial);
    else router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        {notice ? <FormSuccess message={notice} /> : null}

        <Card>
          <CardHeader
            title="Tarefas-modelo"
            description="A ordem define a sequência criada no produto. Os offsets são contados em dias a partir da âncora."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(editing === "new" ? null : "new")}
              >
                <Plus className="h-4 w-4" />
                Nova tarefa
              </Button>
            }
          />
          <CardBody className="space-y-2">
            {editing === "new" ? (
              <TemplateForm
                packageId={packageId}
                templates={templates}
                categories={categories}
                columns={columns}
                owners={owners}
                onDone={(message) => {
                  setEditing(null);
                  setNotice(message);
                  router.refresh();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : null}

            {templates.length === 0 ? (
              <EmptyState
                title="Pacote sem tarefas"
                description="Acrescente a primeira tarefa-modelo. Ela vira uma tarefa real, já datada, sempre que o pacote for aplicado a um produto."
              />
            ) : (
              <SortableList
                items={templates}
                onReorder={persistOrder}
                renderItem={(template) =>
                  editing === template.id ? (
                    <TemplateForm
                      packageId={packageId}
                      template={template}
                      templates={templates}
                      categories={categories}
                      columns={columns}
                      owners={owners}
                      onDone={(message) => {
                        setEditing(null);
                        setNotice(message);
                        router.refresh();
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{template.name}</p>
                        <p className="text-[11px] text-fg-muted">
                          {TASK_ANCHOR_LABELS[template.anchor]} · {template.startOffsetDays >= 0 ? "+" : ""}
                          {template.startOffsetDays}d a {template.endOffsetDays >= 0 ? "+" : ""}
                          {template.endOffsetDays}d · {PRIORITY_LABELS[template.priority]}
                          {template.dependsOn.length > 0
                            ? ` · depende de ${template.dependsOn.length}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(template.id)}>
                          Editar
                        </Button>
                        <DeleteTemplate
                          template={template}
                          onDone={(message) => {
                            setNotice(message);
                            router.refresh();
                          }}
                        />
                      </div>
                    </div>
                  )
                }
              />
            )}
          </CardBody>
        </Card>
      </div>

      <SchedulePreview templates={templates} />
    </div>
  );
}

/** Shows the dates the package would produce for an anchor the user picks. */
function SchedulePreview({ templates }: { templates: Template[] }) {
  const [startDate, setStartDate] = useState(todayIso());
  const [launchDate, setLaunchDate] = useState("");

  const preview = useMemo(
    () =>
      planTasksFromPackage(
        templates.map((template) => ({
          id: template.id,
          name: template.name,
          priority: template.priority,
          initialStatus: template.initialStatus,
          anchor: template.anchor,
          startOffsetDays: template.startOffsetDays,
          endOffsetDays: template.endOffsetDays,
          orderIndex: template.orderIndex,
        })),
        { startDate, plannedLaunchDate: launchDate || null },
      ),
    [templates, startDate, launchDate],
  );

  const span =
    preview.tasks.length > 0
      ? {
          first: preview.tasks.reduce(
            (min, task) => (task.startDate < min ? task.startDate : min),
            preview.tasks[0]!.startDate,
          ),
          last: preview.tasks.reduce(
            (max, task) => (task.dueDate > max ? task.dueDate : max),
            preview.tasks[0]!.dueDate,
          ),
        }
      : null;

  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardHeader
        title="Pré-visualizar cronograma"
        description="Informe as datas-âncora para ver as datas que o pacote geraria."
      />
      <CardBody className="space-y-3">
        <div>
          <label className="label" htmlFor="preview-start">
            Data de início do produto
          </label>
          <input
            id="preview-start"
            type="date"
            className="input"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="preview-launch">
            Data prevista de lançamento
          </label>
          <input
            id="preview-launch"
            type="date"
            className="input"
            value={launchDate}
            onChange={(event) => setLaunchDate(event.target.value)}
          />
        </div>

        {preview.warnings.map((warning) => (
          <p
            key={warning}
            className="rounded-lg border border-amber/40 bg-amber/10 px-2 py-1.5 text-[11px] text-amber"
          >
            {warning}
          </p>
        ))}

        {preview.tasks.length === 0 ? (
          <p className="text-xs text-fg-muted">Sem tarefas para prever.</p>
        ) : (
          <>
            {span ? (
              <p className="flex items-center gap-1.5 text-xs text-fg-muted">
                <CalendarRange className="h-3.5 w-3.5" />
                {formatDate(span.first)} a {formatDate(span.last)}
                <Badge tone="neutral">
                  {formatDays(
                    (new Date(span.last).getTime() - new Date(span.first).getTime()) / 86_400_000,
                  )}
                </Badge>
              </p>
            ) : null}
            <ol className="space-y-1.5">
              {preview.tasks.map((task) => (
                <li key={task.templateId} className="text-xs">
                  <p className="truncate font-medium">{task.name}</p>
                  <p className="text-fg-muted">
                    {formatDate(task.startDate)} → {formatDate(task.dueDate)}
                  </p>
                </li>
              ))}
            </ol>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function TemplateForm({
  packageId,
  template,
  templates,
  categories,
  columns,
  owners,
  onDone,
  onCancel,
}: {
  packageId: string;
  template?: Template;
  templates: Template[];
  categories: Option[];
  columns: { code: string; label: string }[];
  owners: Option[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    saveTemplateAction,
    null,
  );
  const [dependsOn, setDependsOn] = useState<string[]>(template?.dependsOn ?? []);

  useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Salvo.");
  }, [state, onDone]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;
  const candidates = templates.filter((other) => other.id !== template?.id);
  const id = template?.id ?? "new";

  return (
    <form action={formAction} className="space-y-3 rounded-lg bg-surface-muted/40 p-3" noValidate>
      <input type="hidden" name="packageId" value={packageId} />
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <input type="hidden" name="dependsOn" value={JSON.stringify(dependsOn)} />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`name-${id}`}>
            Nome da tarefa
          </label>
          <input id={`name-${id}`} name="name" className="input" defaultValue={template?.name} autoFocus />
          {errors?.name ? <p className="field-error">{errors.name[0]}</p> : null}
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor={`description-${id}`}>
            Descrição
          </label>
          <textarea
            id={`description-${id}`}
            name="description"
            className="input"
            rows={2}
            defaultValue={template?.description ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor={`categoryId-${id}`}>
            Categoria
          </label>
          <select
            id={`categoryId-${id}`}
            name="categoryId"
            className="input"
            defaultValue={template?.categoryId ?? ""}
          >
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`defaultAssigneeId-${id}`}>
            Responsável padrão
          </label>
          <select
            id={`defaultAssigneeId-${id}`}
            name="defaultAssigneeId"
            className="input"
            defaultValue={template?.defaultAssigneeId ?? ""}
          >
            <option value="">Preencher na aplicação</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`priority-${id}`}>
            Prioridade
          </label>
          <select
            id={`priority-${id}`}
            name="priority"
            className="input"
            defaultValue={template?.priority ?? "medium"}
          >
            {(["low", "medium", "high", "critical"] as const).map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`initialStatus-${id}`}>
            Status inicial
          </label>
          <select
            id={`initialStatus-${id}`}
            name="initialStatus"
            className="input"
            defaultValue={template?.initialStatus ?? columns[0]?.code ?? "backlog"}
          >
            {columns.map((column) => (
              <option key={column.code} value={column.code}>
                {column.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`estimatedHours-${id}`}>
            Estimativa (horas)
          </label>
          <input
            id={`estimatedHours-${id}`}
            name="estimatedHours"
            className="input num"
            inputMode="decimal"
            defaultValue={template?.estimatedHours ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor={`anchor-${id}`}>
            Âncora
          </label>
          <select
            id={`anchor-${id}`}
            name="anchor"
            className="input"
            defaultValue={template?.anchor ?? "start_date"}
          >
            {(["start_date", "planned_launch_date"] as const).map((anchor) => (
              <option key={anchor} value={anchor}>
                {TASK_ANCHOR_LABELS[anchor]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={`startOffsetDays-${id}`}>
            Offset de início (dias)
          </label>
          <input
            id={`startOffsetDays-${id}`}
            name="startOffsetDays"
            type="number"
            className="input num"
            defaultValue={template?.startOffsetDays ?? 0}
          />
          {errors?.startOffsetDays ? (
            <p className="field-error">{errors.startOffsetDays[0]}</p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor={`endOffsetDays-${id}`}>
            Offset de conclusão (dias)
          </label>
          <input
            id={`endOffsetDays-${id}`}
            name="endOffsetDays"
            type="number"
            className="input num"
            defaultValue={template?.endOffsetDays ?? 7}
          />
          {errors?.endOffsetDays ? <p className="field-error">{errors.endOffsetDays[0]}</p> : null}
        </div>

        {candidates.length > 0 ? (
          <fieldset className="sm:col-span-2">
            <legend className="label">Depende de</legend>
            <div className="flex flex-wrap gap-2">
              {candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={dependsOn.includes(candidate.id)}
                    onChange={(event) =>
                      setDependsOn((current) =>
                        event.target.checked
                          ? [...current, candidate.id]
                          : current.filter((dep) => dep !== candidate.id),
                      )
                    }
                  />
                  {candidate.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      {state?.ok === false ? <FormError message={state.error} /> : null}

      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" />
          Cancelar
        </Button>
        <Button type="submit" size="sm">
          <Check className="h-4 w-4" />
          Salvar tarefa
        </Button>
      </div>
    </form>
  );
}

function DeleteTemplate({
  template,
  onDone,
}: {
  template: Template;
  onDone: (message: string) => void;
}) {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    deleteTemplateAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Removida.");
  }, [state, onDone]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={template.id} />
      <Button type="submit" variant="ghost" size="icon" aria-label={`Remover ${template.name}`}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}
