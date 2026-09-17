import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@db";
import {
  enumValues,
  products,
  taskDependencies,
  tasks,
  users,
  type UserRole,
} from "@db/schema";
import { createSession } from "@/lib/auth/service";
import { todayIso } from "@/lib/format";
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
  createTaskAction,
  deleteTaskAction,
  moveTaskAction,
  rescheduleTaskAction,
  setProgressAction,
  updateTaskAction,
} = await import("@/app/actions/tasks");

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

async function signInAs(role: UserRole, login = `user_${role}`) {
  const user = await createUser({ login, role });
  const { token } = await createSession(db, user.id);
  jar.set(SESSION_COOKIE, token);
  return user;
}

/** The kanban columns the actions look for, including the one flagged as done. */
async function seedColumns() {
  await db.insert(enumValues).values([
    { kind: "kanban_column", code: "backlog", label: "Backlog", sortOrder: 1 },
    { kind: "kanban_column", code: "doing", label: "Em andamento", sortOrder: 2 },
    { kind: "kanban_column", code: "done", label: "Concluído", sortOrder: 3, meta: { isDone: true } },
  ]);
}

async function seedProduct(ownerId: string | null) {
  const [product] = await db
    .insert(products)
    .values({
      code: "SKY-T",
      name: "Produto de teste",
      phase: "development",
      status: "active",
      startDate: "2026-01-01",
      plannedLaunchDate: "2026-06-01",
      ownerId,
    })
    .returning();
  return product!;
}

function taskForm(productId: string, overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("productId", productId);
  form.set("name", "Implementar API");
  form.set("status", "backlog");
  form.set("priority", "high");
  form.set("progress", "0");
  form.set("startDate", "2026-02-01");
  form.set("dueDate", "2026-02-20");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

beforeEach(async () => {
  jar.clear();
  await truncateAll();
  await seedColumns();
});

describe("CRUD de tarefa", () => {
  it("cria a tarefa com dependências dentro do mesmo produto", async () => {
    const owner = await signInAs("product_manager");
    const product = await seedProduct(owner.id);

    const first = await createTaskAction(null, taskForm(product.id, { name: "Modelar dados" }));
    expect(first.ok).toBe(true);
    if (!first.ok || !first.data) return;

    const second = await createTaskAction(
      null,
      taskForm(product.id, { name: "Implementar API", dependsOn: JSON.stringify([first.data.id]) }),
    );
    expect(second.ok).toBe(true);

    const deps = await db.select().from(taskDependencies);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.dependsOnTaskId).toBe(first.data.id);
  });

  it("ignora dependência de tarefa de outro produto", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const [other] = await db
      .insert(products)
      .values({ code: "SKY-O", name: "Outro", phase: "growth", status: "active", startDate: "2026-01-01" })
      .returning();
    const [foreignTask] = await db
      .insert(tasks)
      .values({ productId: other!.id, name: "De outro produto", status: "backlog" })
      .returning();

    const result = await createTaskAction(
      null,
      taskForm(product.id, { dependsOn: JSON.stringify([foreignTask!.id]) }),
    );

    expect(result.ok).toBe(true);
    expect(await db.select().from(taskDependencies)).toHaveLength(0);
  });

  it("recusa prazo anterior ao início", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);

    const result = await createTaskAction(
      null,
      taskForm(product.id, { startDate: "2026-03-01", dueDate: "2026-02-01" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.dueDate?.[0]).toMatch(/anterior/i);
  });

  it("recusa criação por quem não é responsável pelo produto", async () => {
    const other = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(other.id);
    await signInAs("product_manager", "intruso");

    const result = await createTaskAction(null, taskForm(product.id));

    expect(result.ok).toBe(false);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("deixa só o responsável pelo produto excluir a tarefa", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(owner.id);
    const assignee = await signInAs("collaborator", "colaborador");
    const [task] = await db
      .insert(tasks)
      .values({ productId: product.id, name: "Minha tarefa", status: "backlog", assigneeId: assignee.id })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    const denied = await deleteTaskAction(null, form);

    expect(denied.ok).toBe(false);
    expect(await db.select().from(tasks)).toHaveLength(1);
  });
});

describe("regras de conclusão", () => {
  it("mover para a coluna de concluído preenche 100% e a data real", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const [task] = await db
      .insert(tasks)
      .values({ productId: product.id, name: "Tarefa", status: "doing", progress: 40 })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("status", "done");
    form.set("order", JSON.stringify([task!.id]));

    const result = await moveTaskAction(null, form);
    expect(result.ok).toBe(true);

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(updated!.progress).toBe(100);
    expect(updated!.doneDate).toBe(todayIso());
    expect(updated!.status).toBe("done");
  });

  it("tirar da coluna de concluído limpa a data real", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const [task] = await db
      .insert(tasks)
      .values({
        productId: product.id,
        name: "Tarefa",
        status: "done",
        progress: 100,
        doneDate: "2026-02-10",
      })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("status", "doing");
    form.set("order", JSON.stringify([task!.id]));

    await moveTaskAction(null, form);

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(updated!.doneDate).toBeNull();
    // It cannot stay at 100% outside the done column, or the board and the
    // indicators would disagree.
    expect(updated!.progress).toBeLessThan(100);
  });

  it("chegar a 100% move a tarefa para a coluna de concluído", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const [task] = await db
      .insert(tasks)
      .values({ productId: product.id, name: "Tarefa", status: "doing", progress: 50 })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("progress", "100");

    const result = await setProgressAction(null, form);
    expect(result.ok).toBe(true);

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(updated!.status).toBe("done");
    expect(updated!.doneDate).toBe(todayIso());
  });

  it("renumera a coluna de destino na ordem recebida", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const inserted = await db
      .insert(tasks)
      .values([
        { productId: product.id, name: "A", status: "backlog", boardOrder: 0 },
        { productId: product.id, name: "B", status: "backlog", boardOrder: 1 },
        { productId: product.id, name: "C", status: "backlog", boardOrder: 2 },
      ])
      .returning();

    const reversed = [inserted[2]!.id, inserted[1]!.id, inserted[0]!.id];
    const form = new FormData();
    form.set("id", inserted[2]!.id);
    form.set("status", "backlog");
    form.set("order", JSON.stringify(reversed));

    await moveTaskAction(null, form);

    const rows = await db.select().from(tasks).orderBy(tasks.boardOrder);
    expect(rows.map((row) => row.name)).toEqual(["C", "B", "A"]);
  });

  it("recusa coluna inexistente", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const [task] = await db
      .insert(tasks)
      .values({ productId: product.id, name: "Tarefa", status: "backlog" })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("status", "coluna_que_nao_existe");
    form.set("order", JSON.stringify([task!.id]));

    const result = await moveTaskAction(null, form);
    expect(result.ok).toBe(false);

    const [unchanged] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(unchanged!.status).toBe("backlog");
  });
});

describe("autorização sobre tarefas", () => {
  it("o colaborador move a tarefa atribuída a ele", async () => {
    const productOwner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(productOwner.id);
    const collaborator = await signInAs("collaborator", "colaborador");
    const [task] = await db
      .insert(tasks)
      .values({
        productId: product.id,
        name: "Minha",
        status: "backlog",
        assigneeId: collaborator.id,
      })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("status", "doing");
    form.set("order", JSON.stringify([task!.id]));

    const result = await moveTaskAction(null, form);
    expect(result.ok).toBe(true);
  });

  it("o colaborador não move a tarefa de outra pessoa", async () => {
    const productOwner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(productOwner.id);
    const someoneElse = await createUser({ login: "terceiro", role: "collaborator" });
    await signInAs("collaborator", "colaborador");
    const [task] = await db
      .insert(tasks)
      .values({
        productId: product.id,
        name: "De outro",
        status: "backlog",
        assigneeId: someoneElse.id,
      })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("status", "doing");
    form.set("order", JSON.stringify([task!.id]));

    const result = await moveTaskAction(null, form);
    expect(result.ok).toBe(false);

    const [unchanged] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(unchanged!.status).toBe("backlog");
  });

  it("o colaborador não troca o responsável da própria tarefa", async () => {
    const productOwner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(productOwner.id);
    const collaborator = await signInAs("collaborator", "colaborador");
    const target = await createUser({ login: "alvo", role: "collaborator" });
    const [task] = await db
      .insert(tasks)
      .values({
        productId: product.id,
        name: "Minha",
        status: "backlog",
        assigneeId: collaborator.id,
        progress: 10,
      })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("name", "Minha");
    form.set("status", "doing");
    form.set("priority", "medium");
    form.set("progress", "60");
    form.set("assigneeId", target.id);

    const result = await updateTaskAction(null, form);
    expect(result.ok).toBe(true);

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    // The progress change went through; the reassignment did not.
    expect(updated!.progress).toBe(60);
    expect(updated!.assigneeId).toBe(collaborator.id);
  });

  it("o executivo não reprograma tarefa nenhuma", async () => {
    const productOwner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(productOwner.id);
    await signInAs("executive");
    const [task] = await db
      .insert(tasks)
      .values({
        productId: product.id,
        name: "Tarefa",
        status: "backlog",
        startDate: "2026-02-01",
        dueDate: "2026-02-10",
      })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("startDate", "2026-03-01");
    form.set("dueDate", "2026-03-10");

    const result = await rescheduleTaskAction(null, form);
    expect(result.ok).toBe(false);

    const [unchanged] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(unchanged!.startDate).toBe("2026-02-01");
  });

  it("reprogramar pelo Gantt grava as duas datas", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    const [task] = await db
      .insert(tasks)
      .values({
        productId: product.id,
        name: "Tarefa",
        status: "backlog",
        startDate: "2026-02-01",
        dueDate: "2026-02-10",
      })
      .returning();

    const form = new FormData();
    form.set("id", task!.id);
    form.set("startDate", "2026-02-08");
    form.set("dueDate", "2026-02-17");

    const result = await rescheduleTaskAction(null, form);
    expect(result.ok).toBe(true);

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(updated!.startDate).toBe("2026-02-08");
    expect(updated!.dueDate).toBe("2026-02-17");
  });
});

describe("usuários carregados", () => {
  it("mantém o vínculo de responsável ao listar", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await createTaskAction(null, taskForm(product.id, { assigneeId: owner.id }));

    const { listTasks } = await import("@/lib/queries/tasks");
    const rows = await listTasks(product.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.assigneeId).toBe(owner.id);
    expect(rows[0]!.assigneeName).toBe((await db.select().from(users).limit(1))[0]!.name);
  });
});
