"use client";

import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/format";
import { AUDIT_ACTION_LABELS, ENTITY_LABELS } from "@/lib/labels";
import type { AuditRow } from "@/lib/queries/finance";

const ACTION_TONE = { create: "green", update: "blue", delete: "red" } as const;

/** Field names as the user knows them, not as the database spells them. */
const FIELD_LABELS: Record<string, string> = {
  amount: "Valor",
  description: "Descrição",
  competenceDate: "Competência",
  competence: "Competência",
  category: "Categoria",
  supplier: "Fornecedor",
  costCenter: "Centro de custo",
  isVariable: "Custo variável",
  recurrence: "Recorrência",
  series: "Série",
  import: "Importação",
  recurringRevenue: "Receita recorrente",
  oneTimeRevenue: "Receita única",
  churnAmount: "Churn",
  activeCustomers: "Clientes ativos",
  name: "Nome",
  status: "Situação",
  progress: "% de conclusão",
  phase: "Fase",
  startDate: "Data de início",
  dueDate: "Prazo",
  assigneeId: "Responsável",
  ownerId: "Responsável",
  tasks: "Tarefas",
};

export function AuditSection({ rows }: { rows: AuditRow[] }) {
  const [entityFilter, setEntityFilter] = useState("");

  const entityTypes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.entityType))).sort(),
    [rows],
  );

  const visible = useMemo(
    () => rows.filter((row) => !entityFilter || row.entityType === entityFilter),
    [rows, entityFilter],
  );

  return (
    <Card>
      <CardHeader
        title="Log de auditoria"
        description="Toda criação, edição e exclusão, com quem fez, quando, o valor anterior e o novo."
        action={
          <Badge tone="violet">
            <Lock className="h-3 w-3" />
            Somente leitura
          </Badge>
        }
      />
      <CardBody className="space-y-3">
        <p className="rounded-lg bg-surface-muted/60 px-3 py-2 text-[11px] text-fg-muted">
          O log não pode ser editado nem apagado por ninguém pela aplicação: o papel de banco usado
          por ela tem apenas permissão de inserir e ler nesta tabela.
        </p>

        {entityTypes.length > 1 ? (
          <div className="max-w-xs">
            <label className="label" htmlFor="audit-entity">
              Filtrar por registro
            </label>
            <select
              id="audit-entity"
              className="input"
              value={entityFilter}
              onChange={(event) => setEntityFilter(event.target.value)}
            >
              <option value="">Todos</option>
              {entityTypes.map((type) => (
                <option key={type} value={type}>
                  {ENTITY_LABELS[type] ?? type}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            title="Nenhum registro no log"
            description="As alterações de lançamentos, vendas, tarefas e do próprio produto aparecem aqui assim que acontecerem."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Quem</th>
                  <th scope="col">Registro</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Campo</th>
                  <th scope="col">De</th>
                  <th scope="col">Para</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(row.createdAt)}</td>
                    <td className="text-xs">{row.actorName ?? "sistema"}</td>
                    <td className="text-xs">{ENTITY_LABELS[row.entityType] ?? row.entityType}</td>
                    <td>
                      <Badge tone={ACTION_TONE[row.action]}>{AUDIT_ACTION_LABELS[row.action]}</Badge>
                    </td>
                    <td className="text-xs">{row.field ? (FIELD_LABELS[row.field] ?? row.field) : "—"}</td>
                    <td className="max-w-[12rem] truncate text-xs text-fg-muted">
                      {row.oldValue ?? "—"}
                    </td>
                    <td className="max-w-[12rem] truncate text-xs">{row.newValue ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
