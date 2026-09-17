/**
 * The two standard task packages a fresh database ships with.
 *
 * Offsets are in days from the anchor: `start_date` for discovery work that
 * begins with the product, `planned_launch_date` for everything that is counted
 * backwards from the launch, which is how launch plans are actually built.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

type TemplateSeed = {
  key: string;
  name: string;
  description?: string;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  initialStatus?: string;
  estimatedHours?: number;
  anchor: "start_date" | "planned_launch_date";
  start: number;
  end: number;
  dependsOn?: string[];
};

type PackageSeed = {
  name: string;
  description: string;
  targetPhase: schema.LifecyclePhase;
  templates: TemplateSeed[];
};

export const PACKAGE_SEEDS: PackageSeed[] = [
  {
    name: "Lançamento de produto SaaS",
    description:
      "Da preparação técnica ao go-live e ao acompanhamento das primeiras semanas. As datas são contadas a partir da data prevista de lançamento.",
    targetPhase: "launch",
    templates: [
      { key: "pricing", name: "Definir precificação e empacotamento", category: "finance", priority: "critical", anchor: "planned_launch_date", start: -120, end: -90, estimatedHours: 40 },
      { key: "positioning", name: "Fechar posicionamento e mensagem-chave", category: "marketing", priority: "high", anchor: "planned_launch_date", start: -110, end: -80, estimatedHours: 32, dependsOn: ["pricing"] },
      { key: "beta", name: "Rodar beta fechado com clientes-piloto", category: "development", priority: "critical", anchor: "planned_launch_date", start: -90, end: -45, estimatedHours: 120 },
      { key: "contract", name: "Revisar contrato, SLA e termos de uso", category: "legal", priority: "high", anchor: "planned_launch_date", start: -75, end: -45, estimatedHours: 24 },
      { key: "infra", name: "Provisionar infraestrutura de produção e monitoramento", category: "infrastructure", priority: "critical", anchor: "planned_launch_date", start: -60, end: -20, estimatedHours: 80, dependsOn: ["beta"] },
      { key: "sales_enable", name: "Capacitar time comercial e produzir material de venda", category: "sales", priority: "high", anchor: "planned_launch_date", start: -45, end: -15, estimatedHours: 48, dependsOn: ["positioning", "pricing"] },
      { key: "support", name: "Preparar base de conhecimento e roteiro de suporte", category: "support", priority: "medium", anchor: "planned_launch_date", start: -40, end: -10, estimatedHours: 32 },
      { key: "campaign", name: "Preparar campanha de lançamento", category: "marketing", priority: "high", anchor: "planned_launch_date", start: -30, end: -5, estimatedHours: 40, dependsOn: ["positioning"] },
      { key: "golive", name: "Go-live em produção", category: "development", priority: "critical", anchor: "planned_launch_date", start: 0, end: 1, estimatedHours: 16, dependsOn: ["infra", "contract"] },
      { key: "watch", name: "Acompanhar primeiras semanas e ajustar", category: "support", priority: "high", anchor: "planned_launch_date", start: 1, end: 30, estimatedHours: 40, dependsOn: ["golive"] },
      { key: "review", name: "Revisar metas do primeiro trimestre", category: "finance", priority: "medium", anchor: "planned_launch_date", start: 60, end: 90, estimatedHours: 16, dependsOn: ["watch"] },
    ],
  },
  {
    name: "Descoberta / validação",
    description:
      "Entender o problema antes de construir: entrevistas, dimensionamento de mercado, teste de disposição a pagar e a decisão de seguir ou parar.",
    targetPhase: "conception",
    templates: [
      { key: "hypothesis", name: "Escrever hipóteses e critérios de validação", category: "development", priority: "critical", anchor: "start_date", start: 0, end: 7, estimatedHours: 16 },
      { key: "interviews", name: "Entrevistar 10 clientes do segmento-alvo", category: "development", priority: "critical", anchor: "start_date", start: 7, end: 35, estimatedHours: 60, dependsOn: ["hypothesis"] },
      { key: "market", name: "Dimensionar mercado endereçável", category: "marketing", priority: "high", anchor: "start_date", start: 7, end: 28, estimatedHours: 32 },
      { key: "competition", name: "Mapear concorrentes e alternativas atuais", category: "marketing", priority: "medium", anchor: "start_date", start: 14, end: 35, estimatedHours: 24 },
      { key: "willingness", name: "Testar disposição a pagar", category: "sales", priority: "high", anchor: "start_date", start: 35, end: 56, estimatedHours: 32, dependsOn: ["interviews", "market"] },
      { key: "prototype", name: "Construir protótipo navegável", category: "development", priority: "high", anchor: "start_date", start: 35, end: 63, estimatedHours: 80, dependsOn: ["interviews"] },
      { key: "business_case", name: "Montar caso de negócio com custo estimado", category: "finance", priority: "critical", anchor: "start_date", start: 56, end: 77, estimatedHours: 40, dependsOn: ["willingness", "competition"] },
      { key: "gate", name: "Decisão de seguir, pivotar ou parar", category: "finance", priority: "critical", anchor: "start_date", start: 77, end: 84, estimatedHours: 8, dependsOn: ["business_case", "prototype"] },
    ],
  },
];

export async function seedPackages(db: Database): Promise<void> {
  const categories = await db
    .select()
    .from(schema.enumValues)
    .where(eq(schema.enumValues.kind, "task_category"));
  const categoryByCode = new Map(categories.map((row) => [row.code, row.id]));

  for (const seed of PACKAGE_SEEDS) {
    const [pkg] = await db
      .insert(schema.taskPackages)
      .values({
        name: seed.name,
        description: seed.description,
        targetPhase: seed.targetPhase,
        active: true,
      })
      .returning({ id: schema.taskPackages.id });

    const inserted = await db
      .insert(schema.taskTemplates)
      .values(
        seed.templates.map((template, index) => ({
          packageId: pkg!.id,
          name: template.name,
          description: template.description ?? null,
          categoryId: categoryByCode.get(template.category) ?? null,
          priority: template.priority,
          initialStatus: template.initialStatus ?? "backlog",
          estimatedHours: template.estimatedHours ?? null,
          anchor: template.anchor,
          startOffsetDays: template.start,
          endOffsetDays: template.end,
          orderIndex: index + 1,
        })),
      )
      .returning({ id: schema.taskTemplates.id });

    const idByKey = new Map(seed.templates.map((template, index) => [template.key, inserted[index]!.id]));

    const dependencies = seed.templates.flatMap((template) =>
      (template.dependsOn ?? [])
        .map((key) => ({
          templateId: idByKey.get(template.key),
          dependsOnTemplateId: idByKey.get(key),
        }))
        .filter((dep) => dep.templateId && dep.dependsOnTemplateId)
        .map((dep) => ({
          templateId: dep.templateId!,
          dependsOnTemplateId: dep.dependsOnTemplateId!,
        })),
    );

    if (dependencies.length > 0) {
      await db.insert(schema.taskTemplateDependencies).values(dependencies);
    }

    console.log(`  pacote "${seed.name}": ${seed.templates.length} tarefas-modelo`);
  }
}
