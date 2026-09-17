import { describe, expect, it } from "vitest";
import {
  countLateTasks,
  criticalPath,
  dueWithin,
  expectedProgress,
  findDuplicateNames,
  overallProgress,
  planTasksFromPackage,
  sCurve,
  scheduleDeviationDays,
  type TemplateInput,
} from "@/lib/engine/schedule";

function template(overrides: Partial<TemplateInput> & { id: string }): TemplateInput {
  return {
    name: `Tarefa ${overrides.id}`,
    priority: "medium",
    initialStatus: "backlog",
    anchor: "start_date",
    startOffsetDays: 0,
    endOffsetDays: 7,
    orderIndex: 0,
    ...overrides,
  };
}

describe("aplicação de pacote de tarefas", () => {
  it("calcula as datas a partir da data de início", () => {
    const result = planTasksFromPackage(
      [template({ id: "a", startOffsetDays: 0, endOffsetDays: 14 })],
      { startDate: "2024-03-01" },
    );

    expect(result.tasks[0]).toMatchObject({
      startDate: "2024-03-01",
      dueDate: "2024-03-15",
    });
    expect(result.warnings).toEqual([]);
  });

  it("calcula as datas a partir da data prevista de lançamento, inclusive com offset negativo", () => {
    const result = planTasksFromPackage(
      [
        template({
          id: "a",
          anchor: "planned_launch_date",
          startOffsetDays: -30,
          endOffsetDays: -7,
        }),
      ],
      { startDate: "2024-01-01", plannedLaunchDate: "2024-06-01" },
    );

    expect(result.tasks[0]).toMatchObject({
      startDate: "2024-05-02",
      dueDate: "2024-05-25",
    });
  });

  it("cai para a data de início quando não há data de lançamento, e avisa", () => {
    const result = planTasksFromPackage(
      [
        template({ id: "a", anchor: "planned_launch_date", startOffsetDays: 0, endOffsetDays: 5 }),
        template({ id: "b", anchor: "planned_launch_date", startOffsetDays: 2, endOffsetDays: 9 }),
      ],
      { startDate: "2024-03-01", plannedLaunchDate: null },
    );

    expect(result.tasks[0]!.startDate).toBe("2024-03-01");
    expect(result.warnings[0]).toContain("2 tarefas");
    expect(result.warnings[0]).toContain("data de início");
  });

  it("corrige conclusão anterior ao início e avisa", () => {
    const result = planTasksFromPackage(
      [template({ id: "a", name: "Invertida", startOffsetDays: 10, endOffsetDays: 3 })],
      { startDate: "2024-03-01" },
    );

    expect(result.tasks[0]!.startDate).toBe("2024-03-11");
    expect(result.tasks[0]!.dueDate).toBe("2024-03-11");
    expect(result.warnings[0]).toContain("Invertida");
  });

  it("respeita a ordem configurada no pacote", () => {
    const result = planTasksFromPackage(
      [
        template({ id: "c", orderIndex: 3 }),
        template({ id: "a", orderIndex: 1 }),
        template({ id: "b", orderIndex: 2 }),
      ],
      { startDate: "2024-03-01" },
    );

    expect(result.tasks.map((t) => t.templateId)).toEqual(["a", "b", "c"]);
    expect(result.tasks.map((t) => t.orderIndex)).toEqual([0, 1, 2]);
  });

  it("preserva responsável padrão, prioridade, status inicial e dependências", () => {
    const result = planTasksFromPackage(
      [
        template({
          id: "a",
          defaultAssigneeId: "user-1",
          priority: "critical",
          initialStatus: "todo",
          estimatedHours: 12,
          dependsOn: ["b"],
        }),
      ],
      { startDate: "2024-03-01" },
    );

    expect(result.tasks[0]).toMatchObject({
      assigneeId: "user-1",
      priority: "critical",
      status: "todo",
      estimatedHours: 12,
      dependsOn: ["b"],
    });
  });

  it("aceita um pacote vazio sem quebrar", () => {
    const result = planTasksFromPackage([], { startDate: "2024-03-01" });
    expect(result.tasks).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("aponta duplicidade por nome, ignorando caixa e espaços", () => {
    const { tasks } = planTasksFromPackage(
      [template({ id: "a", name: "Definir preço" }), template({ id: "b", name: "Beta fechado" })],
      { startDate: "2024-03-01" },
    );

    expect(findDuplicateNames(["  definir PREÇO "], tasks)).toEqual(["Definir preço"]);
    expect(findDuplicateNames([], tasks)).toEqual([]);
  });
});

describe("progresso e cronograma", () => {
  const today = "2024-03-15";

  it("pondera o progresso pelas horas estimadas", () => {
    const progress = overallProgress([
      { id: "a", progress: 100, estimatedHours: 90, status: "done" },
      { id: "b", progress: 0, estimatedHours: 10, status: "todo" },
    ]);
    expect(progress).toBe(90);
  });

  it("usa média simples quando não há estimativa nenhuma", () => {
    const progress = overallProgress([
      { id: "a", progress: 100, status: "done" },
      { id: "b", progress: 0, status: "todo" },
    ]);
    expect(progress).toBe(50);
  });

  it("devolve zero para um produto sem tarefas", () => {
    expect(overallProgress([])).toBe(0);
    expect(expectedProgress([], today)).toBe(0);
    expect(countLateTasks([], today)).toBe(0);
  });

  it("conta como atrasada só a tarefa vencida e não concluída", () => {
    const tasks = [
      { id: "a", progress: 50, dueDate: "2024-03-10", status: "doing" },
      { id: "b", progress: 100, dueDate: "2024-03-10", status: "done" },
      { id: "c", progress: 0, dueDate: "2024-03-20", status: "todo" },
      { id: "d", progress: 0, dueDate: null, status: "todo" },
    ];
    expect(countLateTasks(tasks, today)).toBe(1);
  });

  it("lista os próximos vencimentos na janela pedida", () => {
    const tasks = [
      { id: "a", progress: 0, dueDate: "2024-03-18", status: "todo" },
      { id: "b", progress: 0, dueDate: "2024-03-28", status: "todo" },
      { id: "c", progress: 100, dueDate: "2024-03-16", status: "done" },
      { id: "d", progress: 0, dueDate: "2024-03-01", status: "todo" },
    ];
    expect(dueWithin(tasks, today, 7).map((t) => t.id)).toEqual(["a"]);
    expect(dueWithin(tasks, today, 15).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("mede o progresso esperado pela fração de tempo decorrida", () => {
    const tasks = [
      { id: "a", progress: 0, startDate: "2024-03-01", dueDate: "2024-03-31", status: "todo" },
    ];
    expect(expectedProgress(tasks, "2024-03-16")).toBeCloseTo(50, 0);
    expect(expectedProgress(tasks, "2024-02-01")).toBe(0);
    expect(expectedProgress(tasks, "2024-12-01")).toBe(100);
  });

  it("mede o desvio de cronograma contra a data prevista de lançamento", () => {
    const tasks = [
      { id: "a", progress: 0, startDate: "2024-03-01", dueDate: "2024-06-15", status: "todo" },
    ];
    expect(scheduleDeviationDays("2024-06-01", tasks)).toBe(14);
    expect(scheduleDeviationDays("2024-07-01", tasks)).toBe(-16);
    expect(scheduleDeviationDays(null, tasks)).toBeNull();
    expect(scheduleDeviationDays("2024-06-01", [])).toBeNull();
  });

  it("monta a curva S de planejado e realizado", () => {
    const tasks = [
      {
        id: "a",
        progress: 100,
        estimatedHours: 1,
        startDate: "2024-01-01",
        dueDate: "2024-02-01",
        doneDate: "2024-01-15",
        status: "done",
      },
      {
        id: "b",
        progress: 0,
        estimatedHours: 1,
        startDate: "2024-02-01",
        dueDate: "2024-03-01",
        status: "todo",
      },
    ];

    const curve = sCurve(tasks, ["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect(curve[0]).toMatchObject({ planned: 0, actual: 0 });
    expect(curve[1]!.planned).toBeCloseTo(50, 0);
    expect(curve[1]!.actual).toBeCloseTo(50, 0);
    expect(curve[2]!.planned).toBeCloseTo(100, 0);
    // The second task is late: its planned share is full, the actual is not.
    expect(curve[2]!.actual).toBeCloseTo(50, 0);
  });
});

describe("caminho crítico", () => {
  it("marca a cadeia sem folga", () => {
    // a → b → d é a corrente longa; c é paralela e curta.
    const { criticalIds, slackByTask } = criticalPath([
      { id: "a", startDate: "2024-01-01", dueDate: "2024-01-10", dependsOn: [] },
      { id: "b", startDate: "2024-01-10", dueDate: "2024-01-25", dependsOn: ["a"] },
      { id: "c", startDate: "2024-01-10", dueDate: "2024-01-14", dependsOn: ["a"] },
      { id: "d", startDate: "2024-01-25", dueDate: "2024-01-31", dependsOn: ["b", "c"] },
    ]);

    expect(criticalIds.has("a")).toBe(true);
    expect(criticalIds.has("b")).toBe(true);
    expect(criticalIds.has("d")).toBe(true);
    expect(criticalIds.has("c")).toBe(false);
    expect(slackByTask.get("c")).toBeGreaterThan(0);
  });

  it("ignora tarefas sem data em vez de inventar uma posição", () => {
    const { criticalIds } = criticalPath([
      { id: "a", startDate: "2024-01-01", dueDate: "2024-01-10", dependsOn: [] },
      { id: "sem-data", startDate: null, dueDate: null, dependsOn: ["a"] },
    ]);

    expect(criticalIds.has("a")).toBe(true);
    expect(criticalIds.has("sem-data")).toBe(false);
  });

  it("não trava com dependência cíclica", () => {
    const { criticalIds } = criticalPath([
      { id: "a", startDate: "2024-01-01", dueDate: "2024-01-10", dependsOn: ["b"] },
      { id: "b", startDate: "2024-01-05", dueDate: "2024-01-15", dependsOn: ["a"] },
    ]);
    expect(criticalIds.size).toBeGreaterThan(0);
  });

  it("devolve vazio para lista vazia", () => {
    const { criticalIds, slackByTask } = criticalPath([]);
    expect(criticalIds.size).toBe(0);
    expect(slackByTask.size).toBe(0);
  });
});
