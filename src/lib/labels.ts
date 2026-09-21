/**
 * pt-BR labels for the fixed domains. Domains the user administers come from
 * `enum_values` and are not listed here.
 */
import type {
  InsightStatusValue,
  LifecyclePhase,
  ProductStatusValue,
  RecommendationValue,
  TaskPriorityValue,
  UserRole,
} from "@db/schema";

export const PHASE_LABELS: Record<LifecyclePhase, string> = {
  conception: "Concepção",
  development: "Desenvolvimento",
  launch: "Lançamento",
  growth: "Crescimento",
  maturity: "Maturidade",
  decline: "Declínio",
  discontinued: "Descontinuado",
};

/** Lifecycle order, used by the funnel and by phase pickers. */
export const PHASE_ORDER: LifecyclePhase[] = [
  "conception",
  "development",
  "launch",
  "growth",
  "maturity",
  "decline",
  "discontinued",
];

/**
 * Phase colours, all at 3:1 or better against white.
 *
 * They are the legend of every chart in the application, so a phase nobody can
 * see is a phase nobody can read off the matrix. The bright originals
 * (#10b981, #f59e0b, #84cc16, #06b6d4) sat between 1,98:1 and 2,54:1.
 */
export const PHASE_COLORS: Record<LifecyclePhase, string> = {
  conception: "#8b5cf6",
  development: "#3b82f6",
  launch: "#0891b2",
  growth: "#059669",
  maturity: "#4d7c0f",
  decline: "#b45309",
  discontinued: "#6b7280",
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatusValue, string> = {
  active: "Ativo",
  paused: "Pausado",
  discontinued: "Descontinuado",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  product_manager: "Gestor de produto",
  collaborator: "Colaborador",
  executive: "Executivo",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: "Acesso total, inclusive usuários e configurações.",
  product_manager: "CRUD completo nos produtos de que é responsável; leitura nos demais.",
  collaborator: "Edita tarefas e comentários atribuídos a si; leitura no resto.",
  executive: "Somente leitura, com acesso ao painel executivo.",
};

export const PRIORITY_LABELS: Record<TaskPriorityValue, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export const PRIORITY_ORDER: TaskPriorityValue[] = ["critical", "high", "medium", "low"];

export const INSIGHT_STATUS_LABELS: Record<InsightStatusValue, string> = {
  new: "Novo",
  under_analysis: "Em análise",
  approved: "Aprovado",
  in_progress: "Em execução",
  done: "Concluído",
  discarded: "Descartado",
};

export const RECOMMENDATION_LABELS: Record<RecommendationValue, string> = {
  scale: "Escalar",
  keep: "Manter",
  watch: "Observar / revisar",
  pivot: "Pivotar",
  discontinue: "Descontinuar",
};

export const GOAL_PERIOD_LABELS: Record<"monthly" | "quarterly" | "annual", string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  annual: "Anual",
};

export const RECURRENCE_LABELS: Record<"monthly" | "quarterly" | "annual", string> = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  annual: "Anual",
};

export const BUSINESS_PLAN_STATUS_LABELS: Record<"draft" | "active" | "superseded", string> = {
  draft: "Rascunho",
  active: "Vigente",
  superseded: "Substituído",
};

export const MILESTONE_STATUS_LABELS: Record<"pending" | "in_progress" | "done", string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  done: "Concluído",
};

export const ACTION_PLAN_STATUS_LABELS: Record<
  "pending" | "in_progress" | "done" | "cancelled",
  string
> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  done: "Concluído",
  cancelled: "Cancelado",
};

export const AUDIT_ACTION_LABELS: Record<"create" | "update" | "delete", string> = {
  create: "Criação",
  update: "Edição",
  delete: "Exclusão",
};

export const TASK_ANCHOR_LABELS: Record<"start_date" | "planned_launch_date", string> = {
  start_date: "Data de início do produto",
  planned_launch_date: "Data prevista de lançamento",
};

export const DECISION_OUTCOME_LABELS: Record<"accepted" | "rejected", string> = {
  accepted: "Aceita",
  rejected: "Rejeitada",
};

/** Friendly names for the entities that show up in the audit trail. */
export const ENTITY_LABELS: Record<string, string> = {
  finance_entry: "Lançamento financeiro",
  monthly_sale: "Venda mensal",
  product: "Produto",
  task: "Tarefa",
  insight: "Insight",
  business_plan: "Business Plan",
  action_plan: "Plano de ação",
  user: "Usuário",
  product_goal: "Meta",
};
