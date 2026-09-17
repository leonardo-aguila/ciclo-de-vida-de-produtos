"use client";

import { Download, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { deleteSaleAction, importSalesAction, saveSaleAction } from "@/app/actions/finance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import {
  downloadCsv,
  parseSalesCsv,
  SALES_CSV_TEMPLATE,
  toCsv,
  type CsvRowError,
  type SalesCsvRow,
} from "@/lib/csv";
import { formatCompetence, formatCurrency, formatInteger, formatPercent } from "@/lib/format";
import type { MonthlySale } from "@db/schema";

export function SalesSection({
  productId,
  productCode,
  sales,
  currency,
  canWrite,
}: {
  productId: string;
  productCode: string;
  sales: MonthlySale[];
  currency: string;
  canWrite: boolean;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  function exportCsv() {
    const content = toCsv(
      sales.map((sale) => ({
        competencia: formatCompetence(sale.competence),
        novo_mrr: sale.newMrr,
        receita_recorrente: sale.recurringRevenue,
        receita_unica: sale.oneTimeRevenue,
        churn: sale.churnAmount,
        churn_percentual: sale.churnRate,
        clientes_novos: sale.newCustomers,
        clientes_ativos: sale.activeCustomers,
        clientes_cancelados: sale.churnedCustomers,
        ticket_medio: sale.avgTicket,
      })),
      [
        { key: "competencia", label: "Competência" },
        { key: "novo_mrr", label: "Novo MRR" },
        { key: "receita_recorrente", label: "Receita recorrente" },
        { key: "receita_unica", label: "Receita única" },
        { key: "churn", label: "Churn" },
        { key: "churn_percentual", label: "Churn %" },
        { key: "clientes_novos", label: "Clientes novos" },
        { key: "clientes_ativos", label: "Clientes ativos" },
        { key: "clientes_cancelados", label: "Clientes cancelados" },
        { key: "ticket_medio", label: "Ticket médio" },
      ],
    );
    downloadCsv(`vendas-${productCode}.csv`, content);
  }

  return (
    <div className="space-y-3">
      {notice ? <FormSuccess message={notice} /> : null}

      <Card>
        <CardHeader
          title="Vendas mensais"
          description="Uma linha por competência. A receita do mês é recorrente + única − churn."
          action={
            <div className="flex flex-wrap gap-1">
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={sales.length === 0}>
                <Download className="h-4 w-4" />
                CSV
              </Button>
              {canWrite ? (
                <>
                  <ImportDialog productId={productId} onDone={setNotice} />
                  <SaleDialog
                    productId={productId}
                    currency={currency}
                    onDone={setNotice}
                  />
                </>
              ) : null}
            </div>
          }
        />
        <CardBody>
          {sales.length === 0 ? (
            <EmptyState
              title="Nenhuma venda registrada"
              description="Lance a primeira competência ou importe um CSV para que receita, ROI e payback comecem a aparecer."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Competência</th>
                    <th scope="col" className="num">Novo MRR</th>
                    <th scope="col" className="num">Recorrente</th>
                    <th scope="col" className="num">Única</th>
                    <th scope="col" className="num">Churn</th>
                    <th scope="col" className="num">Churn %</th>
                    <th scope="col" className="num">Ativos</th>
                    <th scope="col" className="num">Ticket médio</th>
                    <th scope="col">Origem</th>
                    {canWrite ? <th scope="col" className="text-right">Ações</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td className="whitespace-nowrap">{formatCompetence(sale.competence)}</td>
                      <td className="num">{formatCurrency(sale.newMrr, currency)}</td>
                      <td className="num">{formatCurrency(sale.recurringRevenue, currency)}</td>
                      <td className="num">{formatCurrency(sale.oneTimeRevenue, currency)}</td>
                      <td className="num">{formatCurrency(sale.churnAmount, currency)}</td>
                      <td className="num">{formatPercent(sale.churnRate)}</td>
                      <td className="num">{formatInteger(sale.activeCustomers)}</td>
                      <td className="num">{formatCurrency(sale.avgTicket, currency)}</td>
                      <td>
                        <Badge tone={sale.source === "csv" ? "blue" : "neutral"}>
                          {sale.source === "csv" ? "CSV" : "Manual"}
                        </Badge>
                      </td>
                      {canWrite ? (
                        <td>
                          <div className="flex justify-end gap-1">
                            <SaleDialog
                              productId={productId}
                              sale={sale}
                              currency={currency}
                              onDone={setNotice}
                            />
                            <DeleteSale sale={sale} onDone={setNotice} />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function SaleDialog({
  productId,
  sale,
  currency,
  onDone,
}: {
  productId: string;
  sale?: MonthlySale;
  currency: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    saveSaleAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Salvo.");
      router.refresh();
    }
  }, [state, onDone, router]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;
  const money = (value: number | undefined) =>
    value === undefined ? "" : String(value).replace(".", ",");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {sale ? (
          <Button variant="ghost" size="icon" aria-label={`Editar ${formatCompetence(sale.competence)}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Nova competência
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={sale ? `Editar ${formatCompetence(sale.competence)}` : "Nova competência"}
        description={sale ? undefined : "Informar uma competência que já existe substitui os valores dela."}
      >
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="productId" value={productId} />

          <Field label="Competência" name="competence" errors={errors?.competence} required>
            <input
              className="input"
              type="month"
              defaultValue={sale?.competence.slice(0, 7) ?? new Date().toISOString().slice(0, 7)}
              disabled={Boolean(sale)}
            />
          </Field>
          {sale ? <input type="hidden" name="competence" value={sale.competence} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Novo MRR (${currency})`} name="newMrr" errors={errors?.newMrr}>
              <input className="input num" inputMode="decimal" defaultValue={money(sale?.newMrr)} />
            </Field>
            <Field
              label={`Receita recorrente (${currency})`}
              name="recurringRevenue"
              errors={errors?.recurringRevenue}
            >
              <input
                className="input num"
                inputMode="decimal"
                defaultValue={money(sale?.recurringRevenue)}
              />
            </Field>
            <Field
              label={`Receita única (${currency})`}
              name="oneTimeRevenue"
              errors={errors?.oneTimeRevenue}
            >
              <input
                className="input num"
                inputMode="decimal"
                defaultValue={money(sale?.oneTimeRevenue)}
              />
            </Field>
            <Field label={`Churn (${currency})`} name="churnAmount" errors={errors?.churnAmount}>
              <input className="input num" inputMode="decimal" defaultValue={money(sale?.churnAmount)} />
            </Field>
            <Field label="Churn (%)" name="churnRate" errors={errors?.churnRate}>
              <input className="input num" inputMode="decimal" defaultValue={money(sale?.churnRate)} />
            </Field>
            <Field label="Ticket médio" name="avgTicket" errors={errors?.avgTicket}>
              <input className="input num" inputMode="decimal" defaultValue={money(sale?.avgTicket)} />
            </Field>
            <Field label="Clientes novos" name="newCustomers" errors={errors?.newCustomers}>
              <input className="input num" type="number" min={0} defaultValue={sale?.newCustomers ?? 0} />
            </Field>
            <Field label="Clientes ativos" name="activeCustomers" errors={errors?.activeCustomers}>
              <input
                className="input num"
                type="number"
                min={0}
                defaultValue={sale?.activeCustomers ?? 0}
              />
            </Field>
            <Field
              label="Clientes cancelados"
              name="churnedCustomers"
              errors={errors?.churnedCustomers}
            >
              <input
                className="input num"
                type="number"
                min={0}
                defaultValue={sale?.churnedCustomers ?? 0}
              />
            </Field>
          </div>

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

/** CSV import with a preview and a per-line error report before anything is written. */
function ImportDialog({
  productId,
  onDone,
}: {
  productId: string;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SalesCsvRow[]>([]);
  const [errors, setErrors] = useState<CsvRowError[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [state, formAction] = useActionState<
    ActionResult<{ inserted: number; updated: number } | null> | null,
    FormData
  >(importSalesAction, null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setRows([]);
      setErrors([]);
      setFileName(null);
      onDone(state.message ?? "Importado.");
      router.refresh();
    }
  }, [state, onDone, router]);

  async function handleFile(file: File) {
    const text = await file.text();
    const parsed = parseSalesCsv(text);
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
        title="Importar vendas mensais"
        description="Separador ponto e vírgula, valores no padrão brasileiro. Competências já existentes são substituídas."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
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
              onClick={() => downloadCsv("modelo-vendas.csv", `﻿${SALES_CSV_TEMPLATE}`)}
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
                  <li key={`${error.line}-${index}`}>Linha {error.line}: {error.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {fileName && rows.length > 0 ? (
            <div>
              <p className="mb-1 text-xs text-fg-muted">
                Pré-visualização de {rows.length} {rows.length === 1 ? "competência" : "competências"} em{" "}
                <strong>{fileName}</strong>:
              </p>
              <div className="max-h-48 overflow-auto rounded-lg border border-border">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Competência</th>
                      <th scope="col" className="num">Recorrente</th>
                      <th scope="col" className="num">Única</th>
                      <th scope="col" className="num">Churn</th>
                      <th scope="col" className="num">Ativos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 24).map((row) => (
                      <tr key={row.competence}>
                        <td>{formatCompetence(row.competence)}</td>
                        <td className="num">{formatCurrency(row.recurringRevenue)}</td>
                        <td className="num">{formatCurrency(row.oneTimeRevenue)}</td>
                        <td className="num">{formatCurrency(row.churnAmount)}</td>
                        <td className="num">{formatInteger(row.activeCustomers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : fileName ? (
            <p className="text-xs text-red">Nenhuma linha válida encontrada no arquivo.</p>
          ) : null}

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <form action={formAction} className="flex justify-end gap-2">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="rows" value={JSON.stringify(rows)} />
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm" disabled={rows.length === 0}>
              Importar {rows.length > 0 ? `${rows.length} ${rows.length === 1 ? "linha" : "linhas"}` : ""}
            </SubmitButton>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSale({ sale, onDone }: { sale: MonthlySale; onDone: (message: string) => void }) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    deleteSaleAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      onDone(state.message ?? "Excluído.");
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={sale.id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        aria-label={`Excluir ${formatCompetence(sale.competence)}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}
