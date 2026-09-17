import { listAllEnumValues } from "@/lib/queries/enums";
import type { EnumKind } from "@db/schema";
import { EnumManager } from "./enum-manager";

export const dynamic = "force-dynamic";

const KINDS: { kind: EnumKind; title: string; description: string }[] = [
  { kind: "goal_type", title: "Tipos de meta", description: "Alimentam o cadastro de metas do produto." },
  { kind: "task_category", title: "Categorias de tarefa", description: "Usadas no Gantt e no Kanban." },
  { kind: "kanban_column", title: "Colunas do Kanban", description: "A ordem aqui é a ordem das colunas no quadro." },
  { kind: "finance_entry_type", title: "Tipos de lançamento financeiro", description: "CAPEX, OPEX e os demais tipos de custo." },
  { kind: "comment_category", title: "Categorias de comentário", description: "Insumo do motor de sugestões do painel." },
  { kind: "product_category", title: "Categorias / linhas de produto", description: "" },
  { kind: "insight_origin", title: "Origens de insight", description: "" },
];

export default async function DomainsPage() {
  const byKind = await listAllEnumValues(true);

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Valores marcados como <strong>do sistema</strong> podem ser renomeados e reordenados, mas
        não excluídos: o motor de cálculo se refere a eles pelo código.
      </p>

      {KINDS.map((group) => (
        <EnumManager
          key={group.kind}
          kind={group.kind}
          title={group.title}
          description={group.description}
          values={(byKind.get(group.kind) ?? []).map((value) => ({
            id: value.id,
            code: value.code,
            label: value.label,
            color: value.color,
            active: value.active,
            isSystem: value.isSystem,
            sortOrder: value.sortOrder,
          }))}
        />
      ))}
    </div>
  );
}
