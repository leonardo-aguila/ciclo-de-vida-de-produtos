/**
 * The user-administered domains a fresh database starts with.
 * `isSystem` rows can be renamed or deactivated but never deleted, because the
 * engine refers to some of them by code (e.g. the `done` kanban column).
 */
import type { EnumKind } from "../schema";

export type EnumSeed = {
  kind: EnumKind;
  code: string;
  label: string;
  sortOrder: number;
  color?: string;
  isSystem?: boolean;
  meta?: Record<string, unknown>;
};

export const ENUM_SEEDS: EnumSeed[] = [
  // Goal types — the initial values named in the brief.
  { kind: "goal_type", code: "new_mrr", label: "Novo MRR", sortOrder: 1, isSystem: true, meta: { unit: "R$" } },
  { kind: "goal_type", code: "arr", label: "ARR", sortOrder: 2, isSystem: true, meta: { unit: "R$" } },
  { kind: "goal_type", code: "one_time_revenue", label: "Receita única", sortOrder: 3, meta: { unit: "R$" } },
  { kind: "goal_type", code: "customers", label: "Nº de clientes", sortOrder: 4, meta: { unit: "clientes" } },
  { kind: "goal_type", code: "cost_reduction", label: "Redução de custo", sortOrder: 5, meta: { unit: "R$" } },
  { kind: "goal_type", code: "market_share", label: "Market share", sortOrder: 6, meta: { unit: "%" } },
  { kind: "goal_type", code: "nps", label: "NPS", sortOrder: 7, meta: { unit: "pontos" } },
  { kind: "goal_type", code: "adoption", label: "Adoção (%)", sortOrder: 8, meta: { unit: "%" } },

  // Task categories.
  { kind: "task_category", code: "development", label: "Desenvolvimento", sortOrder: 1, color: "#3b82f6" },
  { kind: "task_category", code: "marketing", label: "Marketing", sortOrder: 2, color: "#8b5cf6" },
  { kind: "task_category", code: "sales", label: "Comercial", sortOrder: 3, color: "#10b981" },
  { kind: "task_category", code: "legal", label: "Jurídico", sortOrder: 4, color: "#f59e0b" },
  { kind: "task_category", code: "finance", label: "Financeiro", sortOrder: 5, color: "#06b6d4" },
  { kind: "task_category", code: "support", label: "Suporte", sortOrder: 6, color: "#ec4899" },
  { kind: "task_category", code: "infrastructure", label: "Infraestrutura", sortOrder: 7, color: "#6366f1" },

  // Kanban columns. `isDone` tells the app which column completes a task.
  { kind: "kanban_column", code: "backlog", label: "Backlog", sortOrder: 1, isSystem: true, color: "#94a3b8" },
  { kind: "kanban_column", code: "todo", label: "A fazer", sortOrder: 2, isSystem: true, color: "#64748b" },
  { kind: "kanban_column", code: "doing", label: "Em andamento", sortOrder: 3, isSystem: true, color: "#3b82f6" },
  { kind: "kanban_column", code: "review", label: "Em revisão", sortOrder: 4, color: "#8b5cf6" },
  { kind: "kanban_column", code: "done", label: "Concluído", sortOrder: 5, isSystem: true, color: "#10b981", meta: { isDone: true } },
  { kind: "kanban_column", code: "blocked", label: "Bloqueado", sortOrder: 6, color: "#dc2626", meta: { isBlocked: true } },

  // Finance entry types. `isVariable` marks what the contribution margin subtracts.
  { kind: "finance_entry_type", code: "capex", label: "CAPEX", sortOrder: 1, isSystem: true, color: "#6366f1", meta: { isVariable: false, isCapex: true } },
  { kind: "finance_entry_type", code: "opex", label: "OPEX", sortOrder: 2, isSystem: true, color: "#f59e0b", meta: { isVariable: true, isOpex: true } },
  { kind: "finance_entry_type", code: "investment", label: "Investimento", sortOrder: 3, color: "#8b5cf6", meta: { isVariable: false } },
  { kind: "finance_entry_type", code: "direct_cost", label: "Custo direto", sortOrder: 4, color: "#dc2626", meta: { isVariable: true } },
  { kind: "finance_entry_type", code: "indirect_cost", label: "Custo indireto", sortOrder: 5, color: "#64748b", meta: { isVariable: false } },
  { kind: "finance_entry_type", code: "other", label: "Outros", sortOrder: 6, color: "#94a3b8", meta: { isVariable: false } },

  // Comment categories — the input for the suggestion engine.
  { kind: "comment_category", code: "risk", label: "Risco", sortOrder: 1, color: "#dc2626", meta: { polarity: "risk" } },
  { kind: "comment_category", code: "opportunity", label: "Oportunidade", sortOrder: 2, color: "#10b981", meta: { polarity: "opportunity" } },
  { kind: "comment_category", code: "customer_feedback", label: "Feedback de cliente", sortOrder: 3, color: "#3b82f6" },
  { kind: "comment_category", code: "competition", label: "Concorrência", sortOrder: 4, color: "#f59e0b" },
  { kind: "comment_category", code: "operational", label: "Operacional", sortOrder: 5, color: "#8b5cf6" },
  { kind: "comment_category", code: "other", label: "Outro", sortOrder: 6, color: "#94a3b8" },

  // Product categories / product lines.
  { kind: "product_category", code: "cloud", label: "Cloud & Infraestrutura", sortOrder: 1 },
  { kind: "product_category", code: "data", label: "Dados & Analytics", sortOrder: 2 },
  { kind: "product_category", code: "integration", label: "Integração", sortOrder: 3 },
  { kind: "product_category", code: "security", label: "Segurança", sortOrder: 4 },
  { kind: "product_category", code: "ai", label: "Inteligência artificial", sortOrder: 5 },

  // Insight origins.
  { kind: "insight_origin", code: "customer", label: "Cliente", sortOrder: 1 },
  { kind: "insight_origin", code: "sales", label: "Vendas", sortOrder: 2 },
  { kind: "insight_origin", code: "support", label: "Suporte", sortOrder: 3 },
  { kind: "insight_origin", code: "research", label: "Pesquisa", sortOrder: 4 },
  { kind: "insight_origin", code: "competition", label: "Concorrência", sortOrder: 5 },
  { kind: "insight_origin", code: "internal", label: "Interno", sortOrder: 6 },
];
