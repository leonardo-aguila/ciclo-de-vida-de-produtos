"use client";

import { ArrowUpDown, ListChecks, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  convertInsightAction,
  createInsightAction,
  deleteInsightAction,
  moveInsightAction,
  updateInsightAction,
} from "@/app/actions/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { formatDate, formatNumber, todayIso } from "@/lib/format";
import { INSIGHT_STATUS_LABELS } from "@/lib/labels";
import { QUADRANT_LABELS, quadrantOf, type InsightRow } from "@/lib/engine/insights";
import { EffortImpactMatrix } from "./effort-impact-matrix";

type Option = { id: string; label: string };

const STATUS_TONE: Record<InsightRow["status"], "neutral" | "violet" | "blue" | "amber" | "green"> =
  {
    new: "neutral",
    under_analysis: "violet",
    approved: "blue",
    in_progress: "amber",
    done: "green",
    discarded: "neutral",
  };

export function InsightsClient({
  productId,
  insights: initial,
  origins,
  people,
  categories,
  canEdit,
  canManageProduct,
}: {
  productId: string;
  insights: InsightRow[];
  origins: Option[];
  people: Option[];
  categories: Option[];
  canEdit: boolean;
  canManageProduct: boolean;
}) {
  const router = useRouter();
  const [insights, setInsights] = React.useState(initial);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<"score" | "impact" | "effort" | "date">("score");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [editing, setEditing] = React.useState<InsightRow | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => setInsights(initial), [initial]);

  const visible = React.useMemo(() => {
    const filtered = insights.filter(
      (insight) => !statusFilter || insight.status === statusFilter,
    );
    return [...filtered].sort((a, b) => {
      if (sort === "score") return b.score - a.score;
      if (sort === "impact") return b.impact - a.impact;
      if (sort === "effort") return a.effort - b.effort;
      return b.insightDate.localeCompare(a.insightDate);
    });
  }, [insights, sort, statusFilter]);

  /** Dragging on the matrix: move first, tell the server after, revert on refusal. */
  async function handleMove(id: string, effort: number, impact: number) {
    const previous = insights;
    setInsights((current) =>
      current.map((insight) =>
        insight.id === id ? { ...insight, effort, impact, score: impact / effort } : insight,
      ),
    );
    setError(null);

    const form = new FormData();
    form.set("id", id);
    form.set("effort", String(effort));
    form.set("impact", String(impact));
    const result = await moveInsightAction(null, form);

    if (!result.ok) {
      setInsights(previous);
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function openInsight(id: string) {
    setEditing(insights.find((insight) => insight.id === id) ?? null);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      {notice ? <FormSuccess message={notice} /> : null}
      {error ? <FormError message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <Card>
          <CardHeader
            title="Matriz esforço × impacto"
            description="Onde vale a pena investir o próximo ciclo."
          />
          <CardBody>
            <EffortImpactMatrix
              insights={visible}
              canEdit={canEdit}
              onOpen={openInsight}
              onMove={handleMove}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Backlog priorizado"
            description="Ordenado por score — impacto dividido por esforço."
            action={
              canEdit ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Novo item
                </Button>
              ) : null
            }
          />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label" htmlFor="insight-sort">
                  Ordenar por
                </label>
                <select
                  id="insight-sort"
                  className="input"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                >
                  <option value="score">Score (impacto ÷ esforço)</option>
                  <option value="impact">Maior impacto</option>
                  <option value="effort">Menor esforço</option>
                  <option value="date">Mais recente</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="insight-status">
                  Status
                </label>
                <select
                  id="insight-status"
                  className="input"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">Todos</option>
                  {(Object.keys(INSIGHT_STATUS_LABELS) as InsightRow["status"][]).map((status) => (
                    <option key={status} value={status}>
                      {INSIGHT_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                title={insights.length === 0 ? "Nenhum item no backlog" : "Nenhum item com esse status"}
                description={
                  insights.length === 0
                    ? "Registre o que chega de clientes, vendas, suporte e pesquisa, e priorize pelo score."
                    : "Troque o filtro para ver os demais."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Origem</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="num">Esforço</th>
                      <th scope="col" className="num">Impacto</th>
                      <th scope="col" className="num">
                        <span className="inline-flex items-center gap-1">
                          Score
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      <th scope="col">Quadrante</th>
                      <th scope="col" className="text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((insight) => (
                      <tr key={insight.id}>
                        <td>
                          <button
                            type="button"
                            className="text-left font-medium hover:text-brand"
                            onClick={() => openInsight(insight.id)}
                          >
                            {insight.title}
                          </button>
                          <p className="text-[11px] text-fg-muted">
                            {formatDate(insight.insightDate)}
                            {insight.ownerName ? ` · ${insight.ownerName}` : ""}
                            {insight.taskCount > 0
                              ? ` · ${insight.taskCount} ${insight.taskCount === 1 ? "tarefa" : "tarefas"}`
                              : ""}
                          </p>
                        </td>
                        <td className="text-fg-muted">{insight.originLabel ?? "—"}</td>
                        <td>
                          <Badge tone={STATUS_TONE[insight.status]}>
                            {INSIGHT_STATUS_LABELS[insight.status]}
                          </Badge>
                        </td>
                        <td className="num">{insight.effort}</td>
                        <td className="num">{insight.impact}</td>
                        <td className="num font-medium">{formatNumber(insight.score, 1)}</td>
                        <td className="text-xs">
                          {QUADRANT_LABELS[quadrantOf(insight.effort, insight.impact)]}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {canManageProduct ? (
                              <ConvertDialog
                                insight={insight}
                                categories={categories}
                                people={people}
                                onDone={(message) => {
                                  setNotice(message);
                                  router.refresh();
                                }}
                              />
                            ) : null}
                            {canManageProduct ? (
                              <DeleteInsight
                                insight={insight}
                                onDone={(message) => {
                                  setNotice(message);
                                  router.refresh();
                                }}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <InsightDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productId={productId}
        insight={editing}
        origins={origins}
        people={people}
        canEdit={canEdit}
        onDone={(message) => {
          setNotice(message);
          router.refresh();
        }}
      />
    </div>
  );
}

function InsightDialog({
  open,
  onOpenChange,
  productId,
  insight,
  origins,
  people,
  canEdit,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  insight: InsightRow | null;
  origins: Option[];
  people: Option[];
  canEdit: boolean;
  onDone: (message: string) => void;
}) {
  const editing = Boolean(insight);
  const [state, formAction] = React.useActionState<
    ActionResult<{ id: string } | null> | null,
    FormData
  >(editing ? updateInsightAction : createInsightAction, null);

  React.useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      onDone(state.message ?? "Salvo.");
    }
  }, [state, onOpenChange, onDone]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? insight!.title : "Novo item do backlog"}>
        <form action={formAction} className="space-y-3" noValidate>
          {editing ? (
            <input type="hidden" name="id" value={insight!.id} />
          ) : (
            <input type="hidden" name="productId" value={productId} />
          )}

          <Field label="Título" name="title" errors={errors?.title} required>
            <input className="input" defaultValue={insight?.title} disabled={!canEdit} />
          </Field>

          <Field label="Descrição" name="description" errors={errors?.description}>
            <textarea
              className="input"
              rows={3}
              defaultValue={insight?.description ?? ""}
              disabled={!canEdit}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Origem" name="originId" errors={errors?.originId}>
              <select className="input" defaultValue={insight?.originId ?? ""} disabled={!canEdit}>
                <option value="">Não informada</option>
                {origins.map((origin) => (
                  <option key={origin.id} value={origin.id}>
                    {origin.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Responsável" name="ownerId" errors={errors?.ownerId}>
              <select className="input" defaultValue={insight?.ownerId ?? ""} disabled={!canEdit}>
                <option value="">Sem responsável</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Data" name="insightDate" errors={errors?.insightDate} required>
              <input
                className="input"
                type="date"
                defaultValue={insight?.insightDate ?? todayIso()}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Status" name="status" errors={errors?.status} required>
              <select className="input" defaultValue={insight?.status ?? "new"} disabled={!canEdit}>
                {(Object.keys(INSIGHT_STATUS_LABELS) as InsightRow["status"][]).map((status) => (
                  <option key={status} value={status}>
                    {INSIGHT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Esforço (1 a 10)"
              name="effort"
              errors={errors?.effort}
              hint="Quanto custa fazer."
              required
            >
              <input
                className="input num"
                type="number"
                min={1}
                max={10}
                defaultValue={insight?.effort ?? 5}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="Impacto (1 a 10)"
              name="impact"
              errors={errors?.impact}
              hint="Quanto muda o resultado."
              required
            >
              <input
                className="input num"
                type="number"
                min={1}
                max={10}
                defaultValue={insight?.impact ?? 5}
                disabled={!canEdit}
              />
            </Field>
          </div>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            {canEdit ? <SubmitButton size="sm">Salvar</SubmitButton> : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({
  insight,
  categories,
  people,
  onDone,
}: {
  insight: InsightRow;
  categories: Option[];
  people: Option[];
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = React.useActionState<
    ActionResult<{ created: number } | null> | null,
    FormData
  >(convertInsightAction, null);

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Convertido.");
    }
  }, [state, onDone]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Converter ${insight.title} em tarefa`}>
          <ListChecks className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Converter item em tarefa"
        description="Uma tarefa por linha. O item passa para Em execução e as tarefas ficam ligadas a ele."
      >
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="id" value={insight.id} />

          <Field
            label="Tarefas"
            name="taskNames"
            errors={state?.ok === false ? state.fieldErrors?.taskNames : undefined}
            required
          >
            <textarea className="input" rows={4} defaultValue={insight.title} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoria" name="categoryId">
              <select className="input" defaultValue="">
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Responsável" name="assigneeId">
              <select className="input" defaultValue={insight.ownerId ?? ""}>
                <option value="">Sem responsável</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Início" name="startDate">
              <input className="input" type="date" />
            </Field>
            <Field label="Prazo" name="dueDate">
              <input className="input" type="date" />
            </Field>
          </div>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm">Criar tarefas</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteInsight({
  insight,
  onDone,
}: {
  insight: InsightRow;
  onDone: (message: string) => void;
}) {
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    deleteInsightAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Excluído.");
  }, [state, onDone]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={insight.id} />
      <Button type="submit" variant="ghost" size="icon" aria-label={`Excluir ${insight.title}`}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}
