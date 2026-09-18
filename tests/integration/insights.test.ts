import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@db";
import { insights, productDecisions, products, tasks, type UserRole } from "@db/schema";
import { createSession } from "@/lib/auth/service";
import { createUser, truncateAll } from "./helpers";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const {
  convertInsightAction,
  createInsightAction,
  moveInsightAction,
  registerDecisionAction,
} = await import("@/app/actions/insights");

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

async function signInAs(role: UserRole, login = `user_${role}`) {
  const user = await createUser({ login, role });
  const { token } = await createSession(db, user.id);
  jar.set(SESSION_COOKIE, token);
  return user;
}

async function seedProduct(ownerId: string | null) {
  const [product] = await db
    .insert(products)
    .values({
      code: "SKY-I",
      name: "Produto insights",
      phase: "growth",
      status: "active",
      startDate: "2026-01-01",
      ownerId,
    })
    .returning();
  return product!;
}

function insightForm(productId: string, overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("productId", productId);
  form.set("title", "Exportar relatório em XLSX");
  form.set("insightDate", "2026-03-10");
  form.set("status", "new");
  form.set("effort", "3");
  form.set("impact", "9");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

beforeEach(async () => {
  jar.clear();
  await truncateAll();
});

describe("insights", () => {
  it("cadastra com esforço e impacto na escala de 1 a 10", async () => {
    const owner = await signInAs("product_manager");
    const product = await seedProduct(owner.id);

    const result = await createInsightAction(null, insightForm(product.id));
    expect(result.ok).toBe(true);

    const [insight] = await db.select().from(insights);
    expect(insight!.effort).toBe(3);
    expect(insight!.impact).toBe(9);
  });

  it("recusa esforço e impacto fora da escala", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);

    const result = await createInsightAction(
      null,
      insightForm(product.id, { effort: "0", impact: "42" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.effort?.length).toBeGreaterThan(0);
    expect(result.fieldErrors?.impact?.length).toBeGreaterThan(0);
  });

  it("arrastar na matriz muda esforço e impacto", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await createInsightAction(null, insightForm(product.id));
    const [insight] = await db.select().from(insights);

    const form = new FormData();
    form.set("id", insight!.id);
    form.set("effort", "8");
    form.set("impact", "4");

    const result = await moveInsightAction(null, form);
    expect(result.ok).toBe(true);

    const [moved] = await db.select().from(insights).where(eq(insights.id, insight!.id));
    expect(moved!.effort).toBe(8);
    expect(moved!.impact).toBe(4);
  });

  it("o colaborador cadastra insight, mesmo sem ser dono do produto", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(owner.id);
    await signInAs("collaborator");

    const result = await createInsightAction(null, insightForm(product.id));
    expect(result.ok).toBe(true);
  });

  it("o executivo não cadastra insight", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(owner.id);
    await signInAs("executive");

    const result = await createInsightAction(null, insightForm(product.id));
    expect(result.ok).toBe(false);
    expect(await db.select().from(insights)).toHaveLength(0);
  });

  it("converte o insight em tarefas ligadas a ele e muda o status", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await createInsightAction(null, insightForm(product.id));
    const [insight] = await db.select().from(insights);

    const form = new FormData();
    form.set("id", insight!.id);
    form.set("taskNames", "Modelar exportação\nImplementar XLSX\nTestar com cliente-piloto");
    form.set("dueDate", "2026-05-30");

    const result = await convertInsightAction(null, form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.created).toBe(3);

    const created = await db.select().from(tasks);
    expect(created).toHaveLength(3);
    expect(created.every((task) => task.originInsightId === insight!.id)).toBe(true);
    // Impacto 9 sobe a prioridade.
    expect(created.every((task) => task.priority === "high")).toBe(true);

    const [updated] = await db.select().from(insights).where(eq(insights.id, insight!.id));
    expect(updated!.status).toBe("in_progress");
  });

  it("o colaborador não converte insight em tarefa", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(owner.id);
    await signInAs("collaborator");
    await createInsightAction(null, insightForm(product.id));
    const [insight] = await db.select().from(insights);

    const form = new FormData();
    form.set("id", insight!.id);
    form.set("taskNames", "Tarefa que não deveria nascer");

    const result = await convertInsightAction(null, form);
    expect(result.ok).toBe(false);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
});

describe("decisão sobre a recomendação", () => {
  it("registra a decisão com justificativa e os números da tela", async () => {
    const owner = await signInAs("product_manager");
    const product = await seedProduct(owner.id);

    const form = new FormData();
    form.set("productId", product.id);
    form.set("recommended", "discontinue");
    form.set("outcome", "rejected");
    form.set(
      "justification",
      "Há um contrato ativo até dezembro; o encerramento só pode ser discutido depois disso.",
    );
    form.set("metricsSnapshot", JSON.stringify({ health: 32, roi: -60 }));

    const result = await registerDecisionAction(null, form);
    expect(result.ok).toBe(true);

    const [decision] = await db.select().from(productDecisions);
    expect(decision!.recommended).toBe("discontinue");
    expect(decision!.outcome).toBe("rejected");
    expect(decision!.metricsSnapshot).toMatchObject({ health: 32, roi: -60 });
    expect(decision!.decidedBy).toBe(owner.id);
  });

  it("exige justificativa com conteúdo", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);

    const form = new FormData();
    form.set("productId", product.id);
    form.set("recommended", "keep");
    form.set("outcome", "accepted");
    form.set("justification", "ok");

    const result = await registerDecisionAction(null, form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.justification?.length).toBeGreaterThan(0);
    expect(await db.select().from(productDecisions)).toHaveLength(0);
  });

  it("aceitar 'descontinuar' não descontinua o produto — só registra a decisão", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);

    const form = new FormData();
    form.set("productId", product.id);
    form.set("recommended", "discontinue");
    form.set("outcome", "accepted");
    form.set("justification", "Concordamos com o encerramento e vamos preparar o plano de saída.");

    await registerDecisionAction(null, form);

    const [unchanged] = await db.select().from(products).where(eq(products.id, product.id));
    expect(unchanged!.status).toBe("active");
    expect(unchanged!.phase).toBe("growth");
  });

  it("o colaborador não registra decisão", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(owner.id);
    await signInAs("collaborator");

    const form = new FormData();
    form.set("productId", product.id);
    form.set("recommended", "keep");
    form.set("outcome", "accepted");
    form.set("justification", "Acho que devemos manter assim mesmo por enquanto.");

    const result = await registerDecisionAction(null, form);
    expect(result.ok).toBe(false);
    expect(await db.select().from(productDecisions)).toHaveLength(0);
  });
});
