import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@db";
import {
  auditLogs,
  enumValues,
  financeEntries,
  monthlySales,
  products,
  type UserRole,
} from "@db/schema";
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

const { createEntryAction, deleteEntryAction, importSalesAction, saveSaleAction, updateEntryAction } =
  await import("@/app/actions/finance");
const { instalmentDates } = await import("@/lib/engine/finance");

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

async function signInAs(role: UserRole, login = `user_${role}`) {
  const user = await createUser({ login, role });
  const { token } = await createSession(db, user.id);
  jar.set(SESSION_COOKIE, token);
  return user;
}

async function seedTypes() {
  const rows = await db
    .insert(enumValues)
    .values([
      { kind: "finance_entry_type", code: "capex", label: "CAPEX", sortOrder: 1 },
      {
        kind: "finance_entry_type",
        code: "opex",
        label: "OPEX",
        sortOrder: 2,
        meta: { isVariable: true },
      },
    ])
    .returning();
  return { capex: rows[0]!, opex: rows[1]! };
}

async function seedProduct(ownerId: string | null) {
  const [product] = await db
    .insert(products)
    .values({
      code: "SKY-F",
      name: "Produto financeiro",
      phase: "growth",
      status: "active",
      startDate: "2026-01-01",
      ownerId,
    })
    .returning();
  return product!;
}

function entryForm(productId: string, entryTypeId: string, overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("productId", productId);
  form.set("entryTypeId", entryTypeId);
  form.set("description", "Licenças de banco de dados");
  form.set("amount", "1.500,50");
  form.set("competenceDate", "2026-01-15");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

beforeEach(async () => {
  jar.clear();
  await truncateAll();
});

describe("parcelas de recorrência", () => {
  it("gera as competências mensais até a data-fim", () => {
    expect(instalmentDates("2026-01-15", "monthly", "2026-04-30")).toEqual([
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
  });

  it("respeita periodicidade trimestral e anual", () => {
    expect(instalmentDates("2026-01-01", "quarterly", "2026-12-31")).toEqual([
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]);
    expect(instalmentDates("2026-01-01", "annual", "2028-06-30")).toEqual([
      "2027-01-01",
      "2028-01-01",
    ]);
  });

  it("não gera nada quando a data-fim é o próprio mês", () => {
    expect(instalmentDates("2026-01-15", "monthly", "2026-01-31")).toEqual([]);
  });
});

describe("lançamentos financeiros", () => {
  it("grava o valor digitado em português", async () => {
    const owner = await signInAs("product_manager");
    const product = await seedProduct(owner.id);
    const types = await seedTypes();

    const result = await createEntryAction(null, entryForm(product.id, types.capex.id));
    expect(result.ok).toBe(true);

    const [entry] = await db.select().from(financeEntries);
    expect(entry!.amount).toBe(1500.5);
    expect(entry!.competenceDate).toBe("2026-01-15");
  });

  it("cria as parcelas de um lançamento recorrente", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const types = await seedTypes();

    const result = await createEntryAction(
      null,
      entryForm(product.id, types.opex.id, {
        amount: "800,00",
        competenceDate: "2026-01-01",
        recurring: "true",
        recurrencePeriod: "monthly",
        recurrenceEnd: "2026-06-30",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.created).toBe(6);

    const rows = await db.select().from(financeEntries).orderBy(financeEntries.competenceDate);
    expect(rows).toHaveLength(6);
    // Only the parent carries the recurrence; the instalments point at it.
    expect(rows.filter((row) => row.recurring)).toHaveLength(1);
    expect(rows.filter((row) => row.parentEntryId !== null)).toHaveLength(5);
    expect(rows.every((row) => row.amount === 800)).toBe(true);
  });

  it("exige periodicidade e data-fim quando é recorrente", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const types = await seedTypes();

    const result = await createEntryAction(
      null,
      entryForm(product.id, types.opex.id, { recurring: "true" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.recurrencePeriod?.length).toBeGreaterThan(0);
    expect(result.fieldErrors?.recurrenceEnd?.length).toBeGreaterThan(0);
    expect(await db.select().from(financeEntries)).toHaveLength(0);
  });

  it("aplica a edição às parcelas só quando pedido", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const types = await seedTypes();

    await createEntryAction(
      null,
      entryForm(product.id, types.opex.id, {
        amount: "1000,00",
        competenceDate: "2026-01-01",
        recurring: "true",
        recurrencePeriod: "monthly",
        recurrenceEnd: "2026-03-31",
      }),
    );
    const [parent] = await db
      .select()
      .from(financeEntries)
      .where(eq(financeEntries.recurring, true));

    // Sem applyToSeries: só o lançamento-mãe muda.
    const soloForm = entryForm(product.id, types.opex.id, { amount: "2000,00" });
    soloForm.set("id", parent!.id);
    soloForm.delete("productId");
    soloForm.set("competenceDate", "2026-01-01");
    await updateEntryAction(null, soloForm);

    let rows = await db.select().from(financeEntries);
    expect(rows.filter((row) => row.amount === 2000)).toHaveLength(1);

    // Com applyToSeries: as parcelas acompanham.
    const seriesForm = entryForm(product.id, types.opex.id, { amount: "3000,00" });
    seriesForm.set("id", parent!.id);
    seriesForm.delete("productId");
    seriesForm.set("competenceDate", "2026-01-01");
    seriesForm.set("applyToSeries", "true");
    await updateEntryAction(null, seriesForm);

    rows = await db.select().from(financeEntries);
    expect(rows.every((row) => row.amount === 3000)).toBe(true);
  });

  it("exclui por marcação lógica, mantendo o rastro no log", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const types = await seedTypes();
    await createEntryAction(null, entryForm(product.id, types.capex.id));
    const [entry] = await db.select().from(financeEntries);

    const form = new FormData();
    form.set("id", entry!.id);
    const result = await deleteEntryAction(null, form);
    expect(result.ok).toBe(true);

    const live = await db
      .select()
      .from(financeEntries)
      .where(isNull(financeEntries.deletedAt));
    expect(live).toHaveLength(0);

    // A linha continua no banco, e o log aponta para ela.
    const all = await db.select().from(financeEntries);
    expect(all).toHaveLength(1);
    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, entry!.id), eq(auditLogs.action, "delete")));
    expect(logs.length).toBeGreaterThan(0);
  });

  it("grava um registro de auditoria por campo alterado", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const types = await seedTypes();
    await createEntryAction(null, entryForm(product.id, types.capex.id));
    const [entry] = await db.select().from(financeEntries);

    const form = entryForm(product.id, types.capex.id, {
      description: "Licenças renegociadas",
      amount: "900,00",
    });
    form.set("id", entry!.id);
    form.delete("productId");
    await updateEntryAction(null, form);

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, entry!.id), eq(auditLogs.action, "update")));

    const fields = logs.map((log) => log.field);
    expect(fields).toContain("description");
    expect(fields).toContain("amount");
    const amountLog = logs.find((log) => log.field === "amount")!;
    expect(amountLog.oldValue).toBe("1500.5");
    expect(amountLog.newValue).toBe("900");
  });

  it("recusa lançamento em produto de outro responsável", async () => {
    const other = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(other.id);
    const types = await seedTypes();
    await signInAs("product_manager", "intruso");

    const result = await createEntryAction(null, entryForm(product.id, types.capex.id));

    expect(result.ok).toBe(false);
    expect(await db.select().from(financeEntries)).toHaveLength(0);
  });

  it("recusa lançamento do executivo", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(owner.id);
    const types = await seedTypes();
    await signInAs("executive");

    const result = await createEntryAction(null, entryForm(product.id, types.capex.id));
    expect(result.ok).toBe(false);
  });
});

describe("vendas mensais", () => {
  it("substitui os valores ao salvar uma competência que já existe", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);

    const first = new FormData();
    first.set("productId", product.id);
    first.set("competence", "2026-03");
    first.set("recurringRevenue", "10.000,00");
    first.set("activeCustomers", "50");
    await saveSaleAction(null, first);

    const second = new FormData();
    second.set("productId", product.id);
    second.set("competence", "2026-03");
    second.set("recurringRevenue", "12.000,00");
    second.set("activeCustomers", "55");
    await saveSaleAction(null, second);

    const rows = await db.select().from(monthlySales);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recurringRevenue).toBe(12000);
    expect(rows[0]!.competence).toBe("2026-03-01");
  });

  it("importa o CSV incluindo e atualizando competências", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);

    const existing = new FormData();
    existing.set("productId", product.id);
    existing.set("competence", "2026-01");
    existing.set("recurringRevenue", "1,00");
    await saveSaleAction(null, existing);

    const rows = [
      {
        competence: "2026-01-01",
        newMrr: 0,
        recurringRevenue: 48000,
        oneTimeRevenue: 0,
        churnAmount: 0,
        churnRate: 0,
        newCustomers: 0,
        activeCustomers: 120,
        churnedCustomers: 0,
        avgTicket: 400,
      },
      {
        competence: "2026-02-01",
        newMrr: 0,
        recurringRevenue: 55500,
        oneTimeRevenue: 0,
        churnAmount: 0,
        churnRate: 0,
        newCustomers: 0,
        activeCustomers: 124,
        churnedCustomers: 0,
        avgTicket: 447,
      },
    ];

    const form = new FormData();
    form.set("productId", product.id);
    form.set("rows", JSON.stringify(rows));

    const result = await importSalesAction(null, form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ inserted: 1, updated: 1 });

    const saved = await db.select().from(monthlySales).orderBy(monthlySales.competence);
    expect(saved).toHaveLength(2);
    expect(saved[0]!.recurringRevenue).toBe(48000);
    expect(saved[0]!.source).toBe("csv");
  });

  it("recusa a importação de quem não pode escrever no produto", async () => {
    const other = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(other.id);
    await signInAs("collaborator");

    const form = new FormData();
    form.set("productId", product.id);
    form.set(
      "rows",
      JSON.stringify([
        {
          competence: "2026-01-01",
          newMrr: 0,
          recurringRevenue: 1,
          oneTimeRevenue: 0,
          churnAmount: 0,
          churnRate: 0,
          newCustomers: 0,
          activeCustomers: 0,
          churnedCustomers: 0,
          avgTicket: 0,
        },
      ]),
    );

    const result = await importSalesAction(null, form);
    expect(result.ok).toBe(false);
    expect(await db.select().from(monthlySales)).toHaveLength(0);
  });
});
