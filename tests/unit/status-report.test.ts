import { describe, expect, it } from "vitest";
import {
  bucketize,
  compactPerson,
  deliveryName,
  buildStatusReport,
  buildWrittenUpdate,
  classify,
  countsLine,
  dLabelOf,
  type ReportTask,
} from "@/lib/engine/status-report";

const DONE = ["done"];
const DOING = ["doing", "review"];
const TODAY = "2026-10-08";
const LAUNCH = "2026-11-04";

function task(overrides: Partial<ReportTask> & { id: string; name: string }): ReportTask {
  return {
    assigneeName: null,
    categoryLabel: null,
    dueDate: null,
    status: "backlog",
    description: null,
    ...overrides,
  };
}

function report(tasks: ReportTask[], launchDate: string | null = LAUNCH) {
  return buildStatusReport({
    productName: "Nimbus Astro",
    launchDate,
    today: TODAY,
    tasks,
    doneColumns: DONE,
    doingColumns: DOING,
  });
}

describe("classificação de status", () => {
  const done = new Set(DONE);
  const doing = new Set(DOING);

  it("conclui pela coluna, não pelo prazo", () => {
    // Prazo vencido não desfaz uma entrega concluída.
    expect(classify({ status: "done", dueDate: "2026-01-01" }, done, doing, TODAY)).toBe("done");
  });

  it("marca como vencida a tarefa aberta com prazo no passado", () => {
    expect(classify({ status: "doing", dueDate: "2026-10-07" }, done, doing, TODAY)).toBe("overdue");
    expect(classify({ status: "backlog", dueDate: "2026-10-07" }, done, doing, TODAY)).toBe("overdue");
  });

  it("não chama de vencida a tarefa que vence hoje", () => {
    expect(classify({ status: "doing", dueDate: TODAY }, done, doing, TODAY)).toBe("doing");
  });

  it("tarefa sem prazo nunca vence", () => {
    // Não há data para ter passado: dizer "vencida" seria inventar o atraso.
    expect(classify({ status: "backlog", dueDate: null }, done, doing, TODAY)).toBe("todo");
  });
});

describe("rótulo D", () => {
  it("usa D0 no dia do lançamento e sinal nos demais", () => {
    expect(dLabelOf(0)).toBe("D0");
    expect(dLabelOf(-52)).toBe("D-52");
    expect(dLabelOf(8)).toBe("D+8");
  });

  it("mede o deslocamento contra a data de lançamento", () => {
    const r = report([
      task({ id: "a", name: "Tese", dueDate: "2026-09-13" }),
      task({ id: "b", name: "Evento", dueDate: LAUNCH }),
      task({ id: "c", name: "Plantão", dueDate: "2026-11-12" }),
    ]);
    // Dias úteis: 13/09 a 04/11 são 38 dias de trabalho (52 corridos), e
    // 04/11 a 12/11 são 6 (8 corridos).
    expect(r.items.map((i) => i.dLabel)).toEqual(["D-38", "D0", "D+6"]);
  });

  it("devolve nulo quando o produto não tem data de lançamento", () => {
    // Sem D0 não existe D: um zero ali fingiria que o lançamento é hoje.
    const r = report([task({ id: "a", name: "Tese", dueDate: "2026-09-13" })], null);
    expect(r.items[0]!.dLabel).toBeNull();
    expect(r.items[0]!.dOffset).toBeNull();
    expect(r.daysToLaunch).toBeNull();
    expect(r.d0Label).toBeNull();
  });
});

describe("contagens e manchete", () => {
  const r = report([
    task({ id: "1", name: "Feita", status: "done", dueDate: "2026-09-13" }),
    task({ id: "2", name: "Em curso", status: "doing", dueDate: "2026-10-20" }),
    task({ id: "3", name: "A iniciar", status: "backlog", dueDate: "2026-10-25" }),
    task({ id: "4", name: "Vencida", status: "doing", dueDate: "2026-10-01" }),
  ]);

  it("conta cada entrega em exatamente um balde", () => {
    expect(r.counts).toEqual({ total: 4, done: 1, doing: 1, todo: 1, overdue: 1 });
    expect(r.counts.done + r.counts.doing + r.counts.todo + r.counts.overdue).toBe(r.counts.total);
  });

  it("põe o vencido na manchete quando existe", () => {
    expect(r.headline).toContain("1 de 4 entregas concluídas");
    expect(r.headline).toContain("1 vencida");
    expect(r.headline).toContain("faltam 19 dias úteis");
  });

  it("monta a linha de contagens na ordem do baralho de referência", () => {
    expect(countsLine(r)).toBe(
      "4 entregas  ·  1 concluídas  ·  1 em curso  ·  1 a iniciar  ·  1 vencidas  ·  evento em 04/11 (faltam 19 dias úteis)",
    );
  });

  it("omite o evento da linha quando não há data de lançamento", () => {
    const sem = report([task({ id: "1", name: "X" })], null);
    expect(countsLine(sem)).not.toContain("evento");
  });
});

describe("agrupamento em blocos", () => {
  const item = (id: string, due: string) => task({ id, name: `T${id}`, dueDate: due });

  it("respeita o teto de cartões por bloco", () => {
    const r = report(Array.from({ length: 14 }, (_, i) =>
      item(String(i), `2026-10-${String(i + 1).padStart(2, "0")}`),
    ));
    for (const bucket of r.buckets) expect(bucket.items.length).toBeLessThanOrEqual(6);
    expect(r.buckets.reduce((sum, b) => sum + b.total, 0)).toBe(14);
  });

  it("não parte um mesmo prazo entre dois blocos", () => {
    // Oito entregas na mesma data: o bloco estoura o teto em vez de mostrar
    // a mesma data em duas colunas, que o leitor lê como dois prazos.
    const mesmoDia = Array.from({ length: 8 }, (_, i) => item(String(i), "2026-10-20"));
    const buckets = bucketize(report(mesmoDia).items, 6);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.items).toHaveLength(8);
  });

  it("separa as entregas sem prazo num bloco próprio", () => {
    const r = report([
      item("1", "2026-10-20"),
      task({ id: "2", name: "Sem prazo" }),
    ]);
    const semPrazo = r.buckets.find((b) => b.label === "Sem prazo");
    expect(semPrazo?.items).toHaveLength(1);
  });

  it("conta concluídas por bloco", () => {
    const r = report([
      task({ id: "1", name: "A", status: "done", dueDate: "2026-10-20" }),
      task({ id: "2", name: "B", status: "backlog", dueDate: "2026-10-21" }),
    ]);
    expect(r.buckets[0]).toMatchObject({ done: 1, total: 2 });
  });
});

describe("nome da entrega", () => {
  it("tira o prefixo do produto que a importação deixou", () => {
    expect(deliveryName("[Astra 2027 · Pocket] F1 · Criar tese")).toBe("F1 · Criar tese");
    expect(deliveryName("[Studio 2027]  F2 ·  Roadshow interno")).toBe("F2 · Roadshow interno");
  });

  it("não mexe em nome sem prefixo", () => {
    expect(deliveryName("Definir pricing")).toBe("Definir pricing");
  });

  it("devolve o original quando o prefixo é o nome inteiro", () => {
    // Melhor um nome estranho do que um card em branco.
    expect(deliveryName("[Só o prefixo]")).toBe("[Só o prefixo]");
  });

  it("aplica o corte ao montar o relatório", () => {
    const r = report([task({ id: "1", name: "[Astra 2027] F1 · Criar tese" })]);
    expect(r.items[0]!.name).toBe("F1 · Criar tese");
  });
});

describe("dono no baralho × dono no texto", () => {
  it("o card mostra a área; o texto, a pessoa e a área", () => {
    const r = report([
      task({ id: "1", name: "A", assigneeName: "Marina", categoryLabel: "Marketing" }),
    ]);
    expect(r.items[0]!.deckOwnerLabel).toBe("Marketing");
    expect(r.items[0]!.ownerLabel).toBe("Marina · Marketing");
  });

  it("sem área, o card cai para a pessoa", () => {
    const r = report([task({ id: "1", name: "A", assigneeName: "Marina" })]);
    expect(r.items[0]!.deckOwnerLabel).toBe("Marina");
  });

  it("encurta nome longo no card, e só nele", () => {
    expect(compactPerson("Ana Carolina Prado Lima")).toBe("Ana Lima");
    expect(compactPerson("Marina Duarte")).toBe("Marina Duarte");
    expect(compactPerson("Marina")).toBe("Marina");

    const r = report([task({ id: "1", name: "A", assigneeName: "Ana Carolina Prado Lima" })]);
    expect(r.items[0]!.deckOwnerLabel).toBe("Ana Lima");
    // Na tabela e no texto, o nome continua inteiro.
    expect(r.items[0]!.ownerLabel).toBe("Ana Carolina Prado Lima");
  });
});

describe("referência da origem", () => {
  it("extrai a chave do Jira da descrição, quando existe", () => {
    const r = report([
      task({ id: "1", name: "A", description: "DEMO-245 · História · https://x/browse/DEMO-245" }),
      task({ id: "2", name: "B", description: "Derivado de DEMO-311" }),
      task({ id: "3", name: "C", description: "texto solto sem chave" }),
      task({ id: "4", name: "D", description: null }),
    ]);
    expect(r.items.map((i) => i.reference)).toEqual(["DEMO-245", "DEMO-311", null, null]);
  });
});

describe("responsável e área", () => {
  it("junta as duas metades, e sobrevive à falta de qualquer uma", () => {
    const r = report([
      task({ id: "1", name: "A", assigneeName: "Marina", categoryLabel: "Marketing" }),
      task({ id: "2", name: "B", assigneeName: "Rafael" }),
      task({ id: "3", name: "C", categoryLabel: "Jurídico" }),
      task({ id: "4", name: "D" }),
    ]);
    expect(r.items.map((i) => i.ownerLabel)).toEqual([
      "Marina · Marketing",
      "Rafael",
      "Jurídico",
      "—",
    ]);
  });
});

describe("D0 na tarefa de lançamento", () => {
  it("ancora na entrega que é o evento, não na data do produto", () => {
    const r = buildStatusReport({
      productName: "Astro",
      // A data cadastrada no produto é outra de propósito: quem manda é a tarefa.
      launchDate: "2026-12-31",
      today: TODAY,
      tasks: [
        task({ id: "1", name: "F4 · Realizar evento de Lançamento", dueDate: "2026-11-04" }),
        task({ id: "2", name: "F1 · Criar tese", dueDate: "2026-11-03" }),
      ],
      doneColumns: DONE,
      doingColumns: DOING,
    });
    expect(r.d0).toBe("2026-11-04");
    expect(r.d0TaskName).toBe("F4 · Realizar evento de Lançamento");
    // 03/11 é a terça anterior ao evento na quarta: um dia útil antes.
    expect(r.items.find((i) => i.id === "2")!.dLabel).toBe("D-1");
    expect(r.items.find((i) => i.id === "1")!.dLabel).toBe("D0");
  });

  it("cai para a data do produto quando nenhuma entrega é o lançamento", () => {
    const r = report([task({ id: "1", name: "F1 · Criar tese", dueDate: "2026-11-03" })]);
    expect(r.d0).toBe(LAUNCH);
    expect(r.d0TaskName).toBeNull();
  });

  it("reconhece go-live além de evento de lançamento", () => {
    const r = buildStatusReport({
      productName: "X", launchDate: null, today: TODAY,
      tasks: [task({ id: "1", name: "Go-live em produção", dueDate: "2026-11-04" })],
      doneColumns: DONE, doingColumns: DOING,
    });
    expect(r.d0).toBe("2026-11-04");
  });

  it("conta a distância em dias úteis", () => {
    // 08/10 quinta → 04/11 quarta: 19 dias úteis, 27 corridos.
    const r = report([task({ id: "1", name: "A", dueDate: LAUNCH })]);
    expect(r.daysToLaunch).toBe(19);
    expect(countsLine(r)).toContain("faltam 19 dias úteis");
  });
});

describe("status escrito", () => {
  const r = report([
    task({ id: "1", name: "Feita", status: "done", dueDate: "2026-09-13",
      assigneeName: "Marina", categoryLabel: "Produto" }),
    task({ id: "2", name: "Validar BP", status: "doing", dueDate: "2026-10-20",
      assigneeName: "Adriana", categoryLabel: "Finanças" }),
    task({ id: "3", name: "Cadastrar SKU", status: "backlog", dueDate: "2026-10-01",
      assigneeName: "Severino", categoryLabel: "Sales Ops" }),
    task({ id: "4", name: "Sales kit", status: "backlog", dueDate: "2026-10-13",
      assigneeName: "Felipe", categoryLabel: "Marketing" }),
    task({ id: "5", name: "Treinamento", status: "backlog", dueDate: "2026-11-30",
      assigneeName: "Inayan", categoryLabel: "Produto" }),
  ]);
  const texto = buildWrittenUpdate(r, TODAY);

  it("abre com a contagem regressiva em dias úteis", () => {
    expect(texto).toContain("Faltam 19 dias úteis para o lançamento do Nimbus Astro (04/11)");
  });

  it("tem os três blocos pedidos, nessa ordem", () => {
    const ordem = ["ATRASADAS (1)", "EM ANDAMENTO (1)", "PRIORIDADES"];
    let cursor = -1;
    for (const bloco of ordem) {
      const pos = texto.indexOf(bloco);
      expect(pos).toBeGreaterThan(cursor);
      cursor = pos;
    }
  });

  it("dá prazo e responsável em cada linha", () => {
    expect(texto).toContain("• Cadastrar SKU — 01/10/2026 (D-24) — Severino · Sales Ops");
    expect(texto).toContain("• Validar BP — 20/10/2026 (D-11) — Adriana · Finanças");
  });

  it("limita as prioridades a esta e à próxima semana", () => {
    // Hoje é quinta 08/10; a janela fecha no domingo 18/10.
    expect(texto).toContain("PRIORIDADES — entregas até 18/10/2026 (1)");
    expect(texto).toContain("• Sales kit — 13/10/2026");
    // 30/11 está fora da janela; 01/10 já venceu e está em ATRASADAS.
    expect(texto).not.toContain("Treinamento — 30/11");
  });

  it("não lista o que já foi concluído", () => {
    // Ninguém age sobre o que está pronto.
    expect(texto).not.toContain("Feita");
  });

  it("diz explicitamente quando um bloco está vazio", () => {
    const limpo = buildWrittenUpdate(
      report([task({ id: "1", name: "A", status: "done", dueDate: "2026-09-13" })]),
      TODAY,
    );
    expect(limpo).toContain("Nenhuma entrega com prazo vencido.");
    expect(limpo).toContain("Nenhuma entrega em andamento.");
    expect(limpo).toContain("Nenhuma entrega vence nesta nem na próxima semana.");
  });

  it("não inventa a linha de impacto", () => {
    expect(texto).not.toMatch(/^Impacto:/m);
    expect(texto).toContain("por que ele importa é leitura sua");
  });

  it("explica a falta de âncora em vez de omiti-la", () => {
    const sem = buildWrittenUpdate(report([task({ id: "1", name: "X" })], null), TODAY);
    expect(sem).toContain("Nenhuma entrega está marcada como o evento de lançamento");
  });
});
