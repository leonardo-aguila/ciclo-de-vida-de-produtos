"use client";

import { Download, FileUp, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { importPlanMonthsAction, savePlanMonthsAction } from "@/app/actions/business-plan";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import {
  downloadCsv,
  parsePlanCsv,
  PLAN_CSV_TEMPLATE,
  toCsv,
  type CsvRowError,
  type PlanCsvRow,
} from "@/lib/csv";
import {
  addMonthsToCompetence,
  formatCompetence,
  formatCurrency,
  formatNumber,
  parseDecimalInput,
  toCompetence,
  todayIso,
} from "@/lib/format";

type Row = {
  competence: string;
  plannedRevenue: string;
  plannedCost: string;
  plannedCustomers: string;
};

/**
 * Spreadsheet-style editor for the monthly projections.
 *
 * Margin is not typed: it is revenue minus cost, computed as you type. A plan
 * whose margin disagrees with its own two columns is a plan nobody can defend
 * in a meeting.
 */
export function ProjectionsTable({
  planId,
  months,
  horizonMonths,
  canEdit,
  productCode,
  currency,
}: {
  planId: string;
  months: { competence: string; plannedRevenue: number; plannedCost: number; plannedCustomers: number }[];
  horizonMonths: number;
  canEdit: boolean;
  productCode: string;
  currency: string;
}) {
  const router = useRouter();
  const toRows = React.useCallback(
    () =>
      months.map((month) => ({
        competence: month.competence.slice(0, 7),
        plannedRevenue: String(month.plannedRevenue).replace(".", ","),
        plannedCost: String(month.plannedCost).replace(".", ","),
        plannedCustomers: String(month.plannedCustomers),
      })),
    [months],
  );

  const [rows, setRows] = React.useState<Row[]>(toRows);
  const [notice, setNotice] = React.useState<string | null>(null);

  // The table is an editable copy of server data, so it has to follow the
  // server when that data actually changes — after a save or a CSV import the
  // rows arrive rewritten, and a table that kept its first snapshot would show
  // the user an empty grid over data that exists.
  const signature = JSON.stringify(months);
  const lastSignature = React.useRef(signature);
  React.useEffect(() => {
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      setRows(toRows());
    }
  }, [signature, toRows]);

  const [state, formAction] = React.useActionState<
    ActionResult<{ saved: number } | null> | null,
    FormData
  >(savePlanMonthsAction, null);

  React.useEffect(() => {
    if (state?.ok) {
      setNotice(state.message ?? "Salvo.");
      router.refresh();
    }
  }, [state, router]);

  const parsed = React.useMemo(
    () =>
      rows.map((row) => {
        const revenue = parseDecimalInput(row.plannedRevenue) ?? 0;
        const cost = parseDecimalInput(row.plannedCost) ?? 0;
        return {
          competence: row.competence,
          plannedRevenue: revenue,
          plannedCost: cost,
          plannedCustomers: Math.round(parseDecimalInput(row.plannedCustomers) ?? 0),
          plannedMargin: revenue - cost,
        };
      }),
    [rows],
  );

  const totals = React.useMemo(
    () => ({
      revenue: parsed.reduce((sum, row) => sum + row.plannedRevenue, 0),
      cost: parsed.reduce((sum, row) => sum + row.plannedCost, 0),
      margin: parsed.reduce((sum, row) => sum + row.plannedMargin, 0),
    }),
    [parsed],
  );

  function addMonth() {
    const last = rows.length > 0 ? rows[rows.length - 1]!.competence : toCompetence(todayIso()).slice(0, 7);
    const next = addMonthsToCompetence(`${last}-01`, rows.length > 0 ? 1 : 0).slice(0, 7);
    setRows((current) => [
      ...current,
      { competence: next, plannedRevenue: "", plannedCost: "", plannedCustomers: "" },
    ]);
  }

  /** Fills the horizon in one go, starting from the current month. */
  function fillHorizon() {
    const start = toCompetence(todayIso());
    setRows(
      Array.from({ length: horizonMonths }, (_, index) => ({
        competence: addMonthsToCompetence(start, index).slice(0, 7),
        plannedRevenue: "",
        plannedCost: "",
        plannedCustomers: "",
      })),
    );
  }

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function exportCsv() {
    downloadCsv(
      `plano-${productCode}.csv`,
      toCsv(
        parsed.map((row) => ({
          competencia: formatCompetence(`${row.competence}-01`),
          receita_planejada: row.plannedRevenue,
          custo_planejado: row.plannedCost,
          clientes_planejados: row.plannedCustomers,
          margem_planejada: row.plannedMargin,
        })),
        [
          { key: "competencia", label: "Competência" },
          { key: "receita_planejada", label: "Receita planejada" },
          { key: "custo_planejado", label: "Custo planejado" },
          { key: "clientes_planejados", label: "Clientes planejados" },
          { key: "margem_planejada", label: "Margem planejada" },
        ],
      ),
    );
  }

  return (
    <Card>
      <CardHeader
        title="Projeções mensais"
        description="A margem é calculada: receita planejada menos custo planejado."
        action={
          <div className="flex flex-wrap gap-1">
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
            {canEdit ? (
              <ImportDialog planId={planId} onDone={setNotice} />
            ) : null}
          </div>
        }
      />
      <CardBody className="space-y-3">
        {notice ? <FormSuccess message={notice} /> : null}
        {state?.ok === false ? <FormError message={state.error} /> : null}

        {rows.length === 0 ? (
          <EmptyState
            title="Nenhuma projeção cadastrada"
            description="Preencha o horizonte do plano ou importe um CSV para comparar plano e realizado."
            action={
              canEdit ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={fillHorizon}>
                    Preencher {horizonMonths} meses
                  </Button>
                  <Button size="sm" variant="secondary" onClick={addMonth}>
                    Adicionar um mês
                  </Button>
                </div>
              ) : null
            }
          />
        ) : (
          <>
            <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
              <table className="table">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <th scope="col">Competência</th>
                    <th scope="col" className="num">Receita planejada</th>
                    <th scope="col" className="num">Custo planejado</th>
                    <th scope="col" className="num">Clientes</th>
                    <th scope="col" className="num">Margem</th>
                    {canEdit ? <th scope="col" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.competence}-${index}`}>
                      <td>
                        <input
                          type="month"
                          className="input py-1"
                          value={row.competence}
                          disabled={!canEdit}
                          aria-label={`Competência da linha ${index + 1}`}
                          onChange={(event) => update(index, { competence: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input num py-1"
                          inputMode="decimal"
                          value={row.plannedRevenue}
                          placeholder="0,00"
                          disabled={!canEdit}
                          aria-label={`Receita planejada de ${row.competence}`}
                          onChange={(event) => update(index, { plannedRevenue: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input num py-1"
                          inputMode="decimal"
                          value={row.plannedCost}
                          placeholder="0,00"
                          disabled={!canEdit}
                          aria-label={`Custo planejado de ${row.competence}`}
                          onChange={(event) => update(index, { plannedCost: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input num py-1"
                          inputMode="numeric"
                          value={row.plannedCustomers}
                          placeholder="0"
                          disabled={!canEdit}
                          aria-label={`Clientes planejados de ${row.competence}`}
                          onChange={(event) =>
                            update(index, { plannedCustomers: event.target.value })
                          }
                        />
                      </td>
                      <td className="num text-fg-muted">
                        {formatCurrency(parsed[index]?.plannedMargin ?? 0, currency)}
                      </td>
                      {canEdit ? (
                        <td>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remover a linha de ${row.competence}`}
                            onClick={() =>
                              setRows((current) => current.filter((_, i) => i !== index))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="text-xs font-medium">Total</td>
                    <td className="num font-semibold">{formatCurrency(totals.revenue, currency)}</td>
                    <td className="num font-semibold">{formatCurrency(totals.cost, currency)}</td>
                    <td />
                    <td className="num font-semibold">{formatCurrency(totals.margin, currency)}</td>
                    {canEdit ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>

            {canEdit ? (
              <form action={formAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="planId" value={planId} />
                <input type="hidden" name="rows" value={JSON.stringify(parsed)} />
                <Button type="button" variant="secondary" size="sm" onClick={addMonth}>
                  <Plus className="h-4 w-4" />
                  Adicionar mês
                </Button>
                <SubmitButton size="sm">
                  <Save className="h-4 w-4" />
                  Salvar projeções
                </SubmitButton>
                <span className="text-[11px] text-fg-muted">
                  {rows.length} {rows.length === 1 ? "mês" : "meses"} ·{" "}
                  {formatNumber(totals.revenue === 0 ? 0 : (totals.margin / totals.revenue) * 100, 1)}
                  % de margem planejada
                </span>
              </form>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ImportDialog({ planId, onDone }: { planId: string; onDone: (message: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<PlanCsvRow[]>([]);
  const [errors, setErrors] = React.useState<CsvRowError[]>([]);
  const [fileName, setFileName] = React.useState<string | null>(null);

  const [state, formAction] = React.useActionState<
    ActionResult<{ saved: number } | null> | null,
    FormData
  >(importPlanMonthsAction, null);

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setRows([]);
      setErrors([]);
      onDone(state.message ?? "Importado.");
      router.refresh();
    }
  }, [state, onDone, router]);

  async function handleFile(file: File) {
    const parsed = parsePlanCsv(await file.text());
    setRows(parsed.rows);
    setErrors(parsed.errors);
    setFileName(file.name);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <FileUp className="h-4 w-4" />
          Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Importar projeções"
        description="Substitui as projeções desta versão do plano. Para preservar as atuais, crie uma nova versão antes."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".csv,text/csv"
              className="input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => downloadCsv("modelo-plano.csv", `﻿${PLAN_CSV_TEMPLATE}`)}
            >
              <Download className="h-4 w-4" />
              Baixar modelo
            </Button>
          </div>

          {errors.length > 0 ? (
            <div className="rounded-lg border border-amber/40 bg-amber/10 p-2">
              <p className="text-xs font-medium text-amber">
                {errors.length} {errors.length === 1 ? "linha com problema" : "linhas com problema"}
              </p>
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-[11px] text-amber">
                {errors.slice(0, 20).map((error, index) => (
                  <li key={`${error.line}-${index}`}>
                    Linha {error.line}: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {fileName && rows.length > 0 ? (
            <div className="max-h-48 overflow-auto rounded-lg border border-border">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Competência</th>
                    <th scope="col" className="num">Receita</th>
                    <th scope="col" className="num">Custo</th>
                    <th scope="col" className="num">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 24).map((row) => (
                    <tr key={row.competence}>
                      <td>{formatCompetence(row.competence)}</td>
                      <td className="num">{formatCurrency(row.plannedRevenue)}</td>
                      <td className="num">{formatCurrency(row.plannedCost)}</td>
                      <td className="num">{formatCurrency(row.plannedMargin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <form action={formAction} className="flex justify-end gap-2">
            <input type="hidden" name="planId" value={planId} />
            <input type="hidden" name="rows" value={JSON.stringify(rows)} />
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm" disabled={rows.length === 0}>
              Importar {rows.length > 0 ? `${rows.length} ${rows.length === 1 ? "mês" : "meses"}` : ""}
            </SubmitButton>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
