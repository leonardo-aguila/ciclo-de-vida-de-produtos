/**
 * Two standard task packages, derived from real launches in the Jira Roadmap.
 *
 *   "Novo Produto"  ← épico DEMO-160, Lançamento Nimbus Astra 2027
 *   "Nova Release"  ← épico DEMO-148, Lançamento Studio 2027
 *
 * The two epics are genuinely different plans, which is why they make two
 * packages instead of one: Astra is a full go-to-market for something that did
 * not exist (tese, ICP, pricing, sales kit, evento de lançamento, balanço do
 * D30), while Studio is the cycle an existing product goes through to ship a
 * version (release notes, roadshow, rollout em ondas, desligamento da versão
 * anterior).
 *
 * The dates become offsets, which is what makes a plan reusable. The anchor is
 * chosen per package, because the two plans are built from opposite ends:
 *
 * The anchor differs per package, because the two plans are built from
 * opposite ends:
 *
 *   Novo Produto — the product's start date, offsets forward. A product that
 *     does not exist yet has no launch date to count back from.
 *   Nova Release — the day the version goes live, offsets in both directions.
 *     The epic's own due date is not that day (it is when the whole initiative
 *     finishes, which put "war rooms dos primeiros dias" 92 days before the
 *     launch), so the anchor is taken from the item that *is* the go-live: the
 *     start of the rollout. That choice is named in `anchorIssueKey` rather
 *     than left implicit, because it is the one date the whole plan hangs from.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { deliveryName } from "../../src/lib/engine/status-report";
import { daysBetween } from "../../src/lib/format";
import * as schema from "../schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

type JiraIssue = {
  key: string;
  summary: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  parentKey: string | null;
};

type Source = {
  epicKey: string;
  packageName: string;
  description: string;
  targetPhase: schema.LifecyclePhase;
  anchor: "start_date" | "planned_launch_date";
  /**
   * The item whose start date is day zero. Only for launch-anchored packages,
   * where the epic's own dates do not mark the go-live.
   */
  anchorIssueKey?: string;
};

const SOURCES: Source[] = [
  {
    epicKey: "DEMO-160",
    packageName: "Novo Produto",
    description:
      "Da tese de uma página ao balanço do D30: o go-to-market completo de um produto que ainda não existe. Derivado do lançamento do Nimbus Astra (DEMO-160). As datas são contadas a partir da data de início do produto.",
    targetPhase: "conception",
    anchor: "start_date",
  },
  {
    epicKey: "DEMO-148",
    packageName: "Nova Release",
    description:
      "O ciclo de uma versão nova de um produto que já existe: documentação, habilitação, roadshow, rollout em ondas e desligamento da versão anterior. Derivado do lançamento do Forge (DEMO-148). O dia zero é a subida da versão — o início do rollout em ondas: o que vem antes tem deslocamento negativo, o que vem depois, positivo.",
    targetPhase: "growth",
    anchor: "planned_launch_date",
    anchorIssueKey: "DEMO-211",
  },
];

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Drops the product prefix the Jira items carry — "[Astra 2027 · Pocket] F1 ·
 * Definir pricing" becomes "F1 · Definir pricing". A template that still names
 * the product it came from is a template nobody reuses.
 *
 * Shared with the status report, which needs the same short name on a card.
 */
const templateName = deliveryName;

/** The F1..F4 phase marker the team writes into every item name. */
function phaseOf(name: string): string | null {
  return /^(F\d)\s*·/.exec(name)?.[1] ?? null;
}

/**
 * A task category guessed from the wording.
 *
 * Jira carries no category on these items, so this is a reading of the text,
 * not data that came across. It is a label the user administers and can change
 * in one click on the package screen — it feeds no calculation. Anything the
 * rules do not recognise is left blank rather than forced into a bucket.
 */
const CATEGORY_RULES: { code: string; patterns: RegExp }[] = [
  { code: "legal", patterns: /contrato|lgpd|retenç|segregaç/i },
  { code: "finance", patterns: /pricing|nota fiscal|meta numérica|tabela de preços/i },
  {
    code: "sales",
    patterns: /sales kit|proposta|objeç|habilitação comercial|clientes e conversas|primeiros clientes/i,
  },
  {
    code: "marketing",
    patterns: /roadshow|comunicaç|página de venda|evento de lançamento|case de cliente|redes e e-mail|vídeos|mensagem e valor|screenshots|slide|tese de uma página/i,
  },
  {
    code: "support",
    patterns: /suporte|faq|macros|runbook|plantão|documentaç|release notes|guia de migração|war room/i,
  },
  { code: "infrastructure", patterns: /ambientes|rollout|feature flag|kill switch|backup|rollback/i },
  { code: "development", patterns: /instrumentar|eventos no produto|painel de adoção|retrospectiva/i },
];

function categoryOf(name: string): string | null {
  return CATEGORY_RULES.find((rule) => rule.patterns.test(name))?.code ?? null;
}

const PRIORITIES: Record<string, "low" | "medium" | "high" | "critical"> = {
  Crítica: "critical",
  Alta: "high",
  Média: "medium",
  Baixa: "low",
};

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

export type BuiltTemplate = {
  jiraKey: string;
  name: string;
  phase: string | null;
  category: string | null;
  priority: "low" | "medium" | "high" | "critical";
  anchor: "start_date" | "planned_launch_date";
  start: number;
  end: number;
};

export type BuiltPackage = {
  name: string;
  description: string;
  targetPhase: schema.LifecyclePhase;
  epicKey: string;
  anchor: "start_date" | "planned_launch_date";
  anchorDate: string;
  templates: BuiltTemplate[];
};

export function buildPackagesFromRoadmap(): BuiltPackage[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const extract = JSON.parse(readFileSync(join(here, "jira-roadmap.json"), "utf8")) as {
    issues: JiraIssue[];
  };

  return SOURCES.map((source) => {
    const epic = extract.issues.find((issue) => issue.key === source.epicKey);
    if (!epic) throw new Error(`épico ${source.epicKey} não está no extrato`);

    // The date every offset is measured from.
    let anchorDate: string | null;
    if (source.anchorIssueKey) {
      const marker = extract.issues.find((issue) => issue.key === source.anchorIssueKey);
      if (!marker) throw new Error(`item âncora ${source.anchorIssueKey} não está no extrato`);
      anchorDate = marker.startDate;
    } else {
      anchorDate = source.anchor === "start_date" ? epic.startDate : epic.dueDate;
    }
    if (!anchorDate) {
      throw new Error(`pacote "${source.packageName}" não tem a data âncora que precisa`);
    }

    const children = extract.issues
      .filter((issue) => issue.parentKey === source.epicKey)
      .filter((issue) => issue.startDate && issue.dueDate)
      .sort((a, b) =>
        (a.startDate! + a.dueDate!).localeCompare(b.startDate! + b.dueDate!),
      );

    return {
      name: source.packageName,
      description: source.description,
      targetPhase: source.targetPhase,
      epicKey: source.epicKey,
      anchor: source.anchor,
      anchorDate,
      templates: children.map((issue) => {
        const name = templateName(issue.summary);
        return {
          jiraKey: issue.key,
          name,
          phase: phaseOf(name),
          category: categoryOf(name),
          priority: PRIORITIES[issue.priority ?? ""] ?? "medium",
          anchor: source.anchor,
          start: daysBetween(anchorDate, issue.startDate!),
          end: daysBetween(anchorDate, issue.dueDate!),
        };
      }),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Write                                                                      */
/* -------------------------------------------------------------------------- */

export async function seedJiraPackages(db: Database): Promise<BuiltPackage[]> {
  const packages = buildPackagesFromRoadmap();

  const categories = await db
    .select()
    .from(schema.enumValues)
    .where(eq(schema.enumValues.kind, "task_category"));
  const categoryByCode = new Map(categories.map((row) => [row.code, row.id]));

  // Re-runnable: a package of the same name is replaced, not duplicated.
  const names = packages.map((pkg) => pkg.name);
  const existing = await db
    .select({ id: schema.taskPackages.id, name: schema.taskPackages.name })
    .from(schema.taskPackages)
    .where(inArray(schema.taskPackages.name, names));
  if (existing.length > 0) {
    await db.delete(schema.taskPackages).where(
      inArray(
        schema.taskPackages.id,
        existing.map((row) => row.id),
      ),
    );
    console.log(`  substituindo ${existing.length} pacote(s) de mesmo nome`);
  }

  for (const pkg of packages) {
    const [row] = await db
      .insert(schema.taskPackages)
      .values({
        name: pkg.name,
        description: pkg.description,
        targetPhase: pkg.targetPhase,
        active: true,
      })
      .returning({ id: schema.taskPackages.id });

    await db.insert(schema.taskTemplates).values(
      pkg.templates.map((template, index) => ({
        packageId: row!.id,
        name: template.name,
        // The Jira item each model task came from, so the package can be
        // checked against the launch that produced it.
        description: `Derivado de ${template.jiraKey}`,
        categoryId: template.category ? (categoryByCode.get(template.category) ?? null) : null,
        defaultAssigneeId: null,
        priority: template.priority,
        initialStatus: "backlog",
        estimatedHours: null,
        anchor: template.anchor,
        startOffsetDays: template.start,
        endOffsetDays: template.end,
        orderIndex: index + 1,
      })),
    );

    console.log(
      `  pacote "${pkg.name}" (${pkg.epicKey}): ${pkg.templates.length} tarefas-modelo, ` +
        `âncora ${pkg.anchor === "start_date" ? "data de início" : "lançamento previsto"}`,
    );
  }

  return packages;
}
