/**
 * Import of the Jira Roadmap board into the portfolio.
 *
 * Source: project PRD ("Produtos"), board "Roadmap" (925), whose own filter is
 * `labels IN (lancamento-2027, lancamento-2028)`. The extract in
 * `jira-roadmap.json` is exactly what that board renders — eight launch epics
 * and the items under them — so the import is reproducible without Jira
 * access, and anyone can diff it against the board.
 *
 * What this import deliberately does NOT do: invent anything. Jira holds no
 * revenue, no cost, no goal and no business plan, so none is written. The
 * consequence is visible and intended — every product comes in with the health
 * score reported as "sem medição", because only the execution and risk
 * components have any input. A number made up to fill those screens would be
 * worse than an empty one.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { BCRYPT_ROUNDS } from "../../src/lib/defaults";
import * as schema from "../schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

type JiraIssue = {
  key: string;
  summary: string;
  type: string;
  status: string;
  statusCategory: string;
  priority: string | null;
  assignee: string | null;
  assigneeEmail: string | null;
  startDate: string | null;
  dueDate: string | null;
  created: string | null;
  labels: string[];
  parentKey: string | null;
  url: string;
};

type Extract = {
  source: Record<string, string>;
  issues: JiraIssue[];
};

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The product each launch epic is about.
 *
 * The board rows are initiatives ("Lançamento Nimbus Astra 2027"); the
 * portfolio tracks products. The epic key is the anchor rather than the text,
 * so renaming an epic in Jira does not silently create a second product here.
 */
const PRODUCTS: Record<string, { code: string; name: string }> = {
  "DEMO-6": { code: "STUDIO-CREATOR", name: "Nimbus Forge Creator" },
  "DEMO-131": { code: "AUTOSKY", name: "Atlas" },
  "DEMO-147": { code: "SKYONE-OS", name: "Nimbus OS" },
  "DEMO-148": { code: "STUDIO", name: "Forge" },
  "DEMO-151": { code: "PLATFORM-WEB", name: "Atlas Web" },
  "DEMO-154": { code: "CONSOLE", name: "Nimbus Console" },
  "DEMO-160": { code: "ASTRA", name: "Nimbus Astra" },
  "DEMO-227": { code: "EASYWEB", name: "QuickSite" },
};

/**
 * Lifecycle phase from the epic's status.
 *
 * Jira has no lifecycle phase, so this is a stated approximation, not data:
 * an epic still in the backlog is a launch not yet started, one in progress is
 * a launch being prepared, and a finished one is a launch that happened.
 */
function phaseOf(category: string): schema.LifecyclePhase {
  if (category === "done") return "launch";
  if (category === "indeterminate") return "development";
  return "conception";
}

/** Kanban column code, matching the `kanban_column` enum values by code. */
function columnOf(status: string, category: string): string {
  if (category === "done") return "done";
  switch (status) {
    case "On Hold":
    case "Cancelled":
      return "blocked";
    case "Selected for Development":
      return "todo";
    case "Em Progresso":
      return "doing";
    default:
      return "backlog";
  }
}

const PRIORITIES: Record<string, "low" | "medium" | "high" | "critical"> = {
  Crítica: "critical",
  Alta: "high",
  Média: "medium",
  Baixa: "low",
};

/** A login derived from the corporate e-mail, so the rows are recognisable. */
const loginFor = (email: string) => email.split("@")[0]!.toLowerCase();

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export async function importJiraRoadmap(db: Database): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const extract: Extract = JSON.parse(
    readFileSync(join(here, "jira-roadmap.json"), "utf8"),
  );

  const epics = extract.issues.filter((issue) => issue.parentKey === null);
  const children = extract.issues.filter((issue) => issue.parentKey !== null);

  console.log(`origem: ${extract.source.board} · filtro ${extract.source.boardFilter}`);
  console.log(`extrato de ${extract.source.extractedAt}: ${epics.length} épicos, ${children.length} itens filhos`);

  /* --- People ----------------------------------------------------------- */

  // Everyone the board assigns work to, as a user row. They exist to be named
  // as owner and assignee — not to sign in: the password is random bytes
  // nobody has, and the account is inactive. Creating real colleagues' logins
  // with a known password would be handing out accounts they never asked for.
  const people = new Map<string, string>();
  for (const issue of extract.issues) {
    if (issue.assigneeEmail && issue.assignee) people.set(issue.assigneeEmail, issue.assignee);
  }

  const userIdByEmail = new Map<string, string>();
  for (const [email, name] of people) {
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
      .limit(1);

    if (existing) {
      userIdByEmail.set(email, existing.id);
      await db
        .update(schema.users)
        .set({ name, updatedAt: new Date() })
        .where(eq(schema.users.id, existing.id));
      continue;
    }

    const [created] = await db
      .insert(schema.users)
      .values({
        name,
        email,
        login: loginFor(email),
        passwordHash: bcrypt.hashSync(randomBytes(32).toString("base64"), BCRYPT_ROUNDS),
        role: "product_manager",
        active: false,
      })
      .returning({ id: schema.users.id });
    userIdByEmail.set(email, created!.id);
  }
  console.log(`responsáveis do Jira: ${people.size} (inativos, apenas como referência)`);

  const [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.login, "admin"))
    .limit(1);

  /* --- Enum lookups ----------------------------------------------------- */

  const enumRows = await db
    .select({ id: schema.enumValues.id, kind: schema.enumValues.kind, code: schema.enumValues.code })
    .from(schema.enumValues);
  const enumId = (kind: string, code: string) =>
    enumRows.find((row) => row.kind === kind && row.code === code)?.id ?? null;

  /* --- Products --------------------------------------------------------- */

  const productIdByEpic = new Map<string, string>();

  for (const epic of epics) {
    const meta = PRODUCTS[epic.key];
    if (!meta) {
      console.log(`  aviso: épico ${epic.key} sem produto mapeado — ignorado`);
      continue;
    }

    const ownerId = epic.assigneeEmail ? (userIdByEmail.get(epic.assigneeEmail) ?? null) : null;
    // Without a start date on the epic, the day it was created is the only
    // date Jira offers, and the product page needs one.
    const startDate = epic.startDate ?? epic.created!;

    const [product] = await db
      .insert(schema.products)
      .values({
        code: meta.code,
        name: meta.name,
        shortDescription: `${epic.summary} · ${epic.key} — ${epic.url}`,
        ownerId,
        team: "Produtos",
        categoryId: null,
        phase: phaseOf(epic.statusCategory),
        status: "active",
        startDate,
        plannedLaunchDate: epic.dueDate,
        actualLaunchDate: null,
        segment: null,
        pricingModel: null,
        competitors: null,
        tags: epic.labels,
        createdBy: admin?.id ?? null,
      })
      .returning({ id: schema.products.id });

    productIdByEpic.set(epic.key, product!.id);

    await db.insert(schema.productPhaseHistory).values({
      productId: product!.id,
      phase: phaseOf(epic.statusCategory),
      startedAt: startDate,
      endedAt: null,
      changedBy: admin?.id ?? null,
    });
  }

  /* --- Tasks ------------------------------------------------------------ */

  let taskCount = 0;
  for (const [epicKey, productId] of productIdByEpic) {
    const items = children
      .filter((issue) => issue.parentKey === epicKey)
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

    if (items.length === 0) continue;

    await db.insert(schema.tasks).values(
      items.map((issue, index) => {
        const done = issue.statusCategory === "done";
        return {
          productId,
          name: issue.summary,
          // The Jira key is the trail back to the source of every row.
          description: `${issue.key} · ${issue.type} · ${issue.url}`,
          categoryId: null,
          assigneeId: issue.assigneeEmail
            ? (userIdByEmail.get(issue.assigneeEmail) ?? null)
            : null,
          status: columnOf(issue.status, issue.statusCategory),
          priority: PRIORITIES[issue.priority ?? ""] ?? "medium",
          // Jira tracks no percentage: done is 100, everything else is 0.
          // Inventing a middle value would invent a schedule curve with it.
          progress: done ? 100 : 0,
          startDate: issue.startDate,
          dueDate: issue.dueDate,
          doneDate: null,
          estimatedHours: null,
          boardOrder: index,
        };
      }),
    );
    taskCount += items.length;
  }

  console.log(`produtos: ${productIdByEpic.size} · tarefas: ${taskCount}`);
  console.log(
    "\nsem meta, finanças ou Business Plan: o Jira não guarda esses dados, então\n" +
      "nenhum foi criado. Os produtos entram com a saúde \"sem medição\" — é o que\n" +
      "a aplicação deve dizer quando não há o que medir.",
  );
}
