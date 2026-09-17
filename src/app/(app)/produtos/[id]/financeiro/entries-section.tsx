"use client";

import { Download, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  createEntryAction,
  deleteEntryAction,
  updateEntryAction,
} from "@/app/actions/finance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { RECURRENCE_LABELS } from "@/lib/labels";
import type { FinanceEntryRow } from "@/lib/queries/finance";

export type EntryType = {
  id: string;
  code: string;
  label: string;
  color: string | null;
  isVariable: boolean;
};

export function EntriesSection({
  productId,
  productCode,
  entries,
  entryTypes,
  currency,
  canWrite,
}: {
  productId: string;
  productCode: string;
  entries: FinanceEntryRow[];
  entryTypes: EntryType[];
  currency: string;
  canWrite: boolean;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (typeFilter && entry.entryTypeId !== typeFilter) return false;
        if (search) {
          const term = search.toLowerCase();
          const haystack = [entry.description, entry.category, entry.supplier, entry.costCenter]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      }),
    [entries, typeFilter, search],
  );

  const totals = useMemo(() => {
    const byType = new Map<string, number>();
    let total = 0;
    for (const entry of visible) {
      byType.set(entry.typeLabel, (byType.get(entry.typeLabel) ?? 0) + entry.amount);
      total += entry.amount;
    }
    return { byType: Array.from(byType.entries()).sort((a, b) => b[1] - a[1]), total };
  }, [visible]);

  function exportCsv() {
    const content = toCsv(
      visible.map((entry) => ({
        competencia: formatCompetence(entry.competenceDate),
        tipo: entry.typeLabel,
        categoria: entry.category,
        descricao: entry.description,
        valor: entry.amount,
        moeda: entry.currency,
        variavel: entry.isVariable ? "sim" : "não",
        centro_de_custo: entry.costCenter,
        fornecedor: entry.supplier,
      })),
      [
        { key: "competencia", label: "Competência" },
        { key: "tipo", label: "Tipo" },
        { key: "categoria", label: "Categoria" },
        { key: "descricao", label: "Descrição" },
        { key: "valor", label: "Valor" },
        { key: "moeda", label: "Moeda" },
        { key: "variavel", label: "Custo variável" },
        { key: "centro_de_custo", label: "Centro de custo" },
        { key: "fornecedor", label: "Fornecedor" },
      ],
    );
    downloadCsv(`lancamentos-${productCode}.csv`, content);
  }

  return (
    <div className="space-y-3">
      {notice ? <FormSuccess message={notice} /> : null}

      <Card>
        <CardHeader
          title="Lançamentos"
          description="CAPEX, OPEX, investimentos e custos. Lançamentos recorrentes geram as parcelas automaticamente."
          action={
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={visible.length === 0}>
                <Download className="h-4 w-4" />
                CSV
              </Button>
              {canWrite ? (
                <EntryDialog
                  productId={productId}
                  entryTypes={entryTypes}
                  currency={currency}
                  onDone={setNotice}
                />
              ) : null}
            </div>
          }
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <label className="label" htmlFor="entry-search">
                Buscar
              </label>
              <input
                id="entry-search"
                className="input"
                placeholder="Descrição, fornecedor, centro de custo"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="entry-type-filter">
                Tipo
              </label>
              <select
                id="entry-type-filter"
                className="input"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="">Todos</option>
                {entryTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={entries.length === 0 ? "Nenhum lançamento" : "Nenhum lançamento com esses filtros"}
              description={
                entries.length === 0
                  ? "Registre CAPEX, OPEX e demais custos para que ROI, payback e margem possam ser calculados."
                  : "Ajuste a busca ou o tipo."
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Competência</th>
                      <th scope="col">Tipo</th>
                      <th scope="col">Descrição</th>
                      <th scope="col">Categoria</th>
                      <th scope="col">Fornecedor</th>
                      <th scope="col" className="num">
                        Valor
                      </th>
                      {canWrite ? <th scope="col" className="text-right">Ações</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => (
                      <tr key={entry.id}>
                        <td className="whitespace-nowrap">{formatCompetence(entry.competenceDate)}</td>
                        <td>
                          <span
                            className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px]"
                            style={{
                              backgroundColor: `${entry.typeColor ?? "#64748b"}1a`,
                              color: entry.typeColor ?? undefined,
                            }}
                          >
                            {entry.typeLabel}
                          </span>
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            {entry.description}
                            {entry.recurring ? (
                              <Badge tone="blue">
                                <Repeat className="h-3 w-3" />
                                {entry.recurrencePeriod
                                  ? RECURRENCE_LABELS[entry.recurrencePeriod]
                                  : "Recorrente"}
                              </Badge>
                            ) : null}
                            {entry.parentEntryId ? (
                              <span className="text-[10px] text-fg-muted">parcela</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="text-fg-muted">{entry.category ?? "—"}</td>
                        <td className="text-fg-muted">{entry.supplier ?? "—"}</td>
                        <td className="num">{formatCurrency(entry.amount, entry.currency)}</td>
                        {canWrite ? (
                          <td>
                            <div className="flex justify-end gap-1">
                              <EntryDialog
                                productId={productId}
                                entry={entry}
                                entryTypes={entryTypes}
                                currency={currency}
                                onDone={setNotice}
                              />
                              <DeleteEntry entry={entry} onDone={setNotice} />
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="text-right text-xs font-medium">
                        Total
                      </td>
                      <td className="num font-semibold">{formatCurrency(totals.total, currency)}</td>
                      {canWrite ? <td /> : null}
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                {totals.byType.map(([label, amount]) => (
                  <span key={label} className="text-[11px] text-fg-muted">
                    {label}: <strong className="text-fg">{formatCurrency(amount, currency)}</strong>
                  </span>
                ))}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function EntryDialog({
  productId,
  entry,
  entryTypes,
  currency,
  onDone,
}: {
  productId: string;
  entry?: FinanceEntryRow;
  entryTypes: EntryType[];
  currency: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const editing = Boolean(entry);
  const [state, formAction] = useActionState<ActionResult<{ created: number } | null> | null, FormData>(
    // Both actions share the result shape the dialog needs.
    editing
      ? (updateEntryAction as unknown as typeof createEntryAction)
      : createEntryAction,
    null,
  );
  const [recurring, setRecurring] = useState(entry?.recurring ?? false);
  const [typeId, setTypeId] = useState(entry?.entryTypeId ?? entryTypes[0]?.id ?? "");

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Salvo.");
      router.refresh();
    }
  }, [state, onDone, router]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;
  const selectedType = entryTypes.find((type) => type.id === typeId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="icon" aria-label={`Editar ${entry!.description}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Novo lançamento
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={editing ? "Editar lançamento" : "Novo lançamento"}>
        <form action={formAction} className="space-y-3" noValidate>
          {editing ? (
            <input type="hidden" name="id" value={entry!.id} />
          ) : (
            <input type="hidden" name="productId" value={productId} />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo" name="entryTypeId" errors={errors?.entryTypeId} required>
              <select
                className="input"
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
              >
                {entryTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Categoria" name="category" errors={errors?.category} hint="Infraestrutura, Pessoal, Licenças...">
              <input className="input" defaultValue={entry?.category ?? ""} />
            </Field>

            <Field
              label="Descrição"
              name="description"
              errors={errors?.description}
              required
              className="sm:col-span-2"
            >
              <input className="input" defaultValue={entry?.description} />
            </Field>

            <Field label="Valor" name="amount" errors={errors?.amount} required>
              <input
                className="input num"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={entry ? String(entry.amount).replace(".", ",") : ""}
              />
            </Field>

            <Field label="Moeda" name="currency" errors={errors?.currency}>
              <input className="input" maxLength={3} defaultValue={entry?.currency ?? currency} />
            </Field>

            <Field
              label="Data de competência"
              name="competenceDate"
              errors={errors?.competenceDate}
              required
            >
              <input
                className="input"
                type="date"
                defaultValue={entry?.competenceDate ?? new Date().toISOString().slice(0, 10)}
              />
            </Field>

            <Field label="Centro de custo" name="costCenter" errors={errors?.costCenter}>
              <input className="input" defaultValue={entry?.costCenter ?? ""} />
            </Field>

            <Field label="Fornecedor" name="supplier" errors={errors?.supplier}>
              <input className="input" defaultValue={entry?.supplier ?? ""} />
            </Field>

            <Field
              label="Comprovante (URL)"
              name="receiptUrl"
              errors={errors?.receiptUrl}
              hint="Link para a nota ou o contrato."
            >
              <input className="input" defaultValue={entry?.receiptUrl ?? ""} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="isVariable"
              value="true"
              defaultChecked={entry?.isVariable ?? selectedType?.isVariable ?? false}
            />
            Custo variável (entra na margem de contribuição)
          </label>

          {!editing ? (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="recurring"
                  value="true"
                  checked={recurring}
                  onChange={(event) => setRecurring(event.target.checked)}
                />
                Lançamento recorrente
              </label>

              {recurring ? (
                <div className="grid gap-3 rounded-lg bg-surface-muted/50 p-3 sm:grid-cols-2">
                  <Field
                    label="Periodicidade"
                    name="recurrencePeriod"
                    errors={errors?.recurrencePeriod}
                    required
                  >
                    <select className="input" defaultValue="monthly">
                      {(["monthly", "quarterly", "annual"] as const).map((period) => (
                        <option key={period} value={period}>
                          {RECURRENCE_LABELS[period]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Repetir até"
                    name="recurrenceEnd"
                    errors={errors?.recurrenceEnd}
                    hint="As parcelas são criadas agora, uma por período."
                    required
                  >
                    <input className="input" type="date" />
                  </Field>
                </div>
              ) : null}
            </>
          ) : entry?.recurring ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="applyToSeries" value="true" />
              Aplicar também às parcelas já geradas
            </label>
          ) : null}

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2 pt-1">
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

function DeleteEntry({
  entry,
  onDone,
}: {
  entry: FinanceEntryRow;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    deleteEntryAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Excluído.");
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Excluir ${entry.description}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Excluir lançamento"
        description={`${entry.description} — ${formatCurrency(entry.amount, entry.currency)} em ${formatDate(entry.competenceDate)}. O registro sai dos totais, mas continua no log de auditoria.`}
      >
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="id" value={entry.id} />
          {entry.recurring ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="deleteSeries" value="true" defaultChecked />
              Excluir também as parcelas geradas
            </label>
          ) : null}
          {state?.ok === false ? <FormError message={state.error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm" variant="danger">
              Excluir
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
