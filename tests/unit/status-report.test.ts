import { describe, expect, it } from "vitest";
import {
  type ReportTask,
  bucketize,
  buildPlaybook,
  buildStatusReport,
  buildWrittenUpdate,
  classify,
  compactPerson,
  countsLine,
  dLabelOf,
  deliveryName,
} from "@/lib/engine/status-report";

const DONE = ["done"];
const DOING = ["doing", "review"];
const TODAY = "2026-10-08";
const LAUNCH = "2026-11-04";

function task(overrides: Partial<ReportTask> & { id: string; name: string }): ReportTask {
  return {
    assigneeName: null,
    categoryLabel: null,
    startDate: null,
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
    task({ id: "1", name: "Configurar ambientes para clientes", status: "done", dueDate: "2026-09-28",
      assigneeName: "Marina", categoryLabel: "Engenharia" }),
    task({ id: "2", name: "Aprovar mensagem e proposta de valor", status: "done", dueDate: "2026-10-02",
      assigneeName: "Felipe", categoryLabel: "Marketing" }),
    task({ id: "3", name: "Validar o Business Plan", status: "doing", dueDate: "2026-10-19",
      assigneeName: "Adriana", categoryLabel: "Finanças" }),
    task({ id: "4", name: "Concluir o mapa de riscos", status: "backlog", dueDate: "2026-10-13",
      assigneeName: "Severino", categoryLabel: "Produto" }),
    task({ id: "5", name: "Cadastrar proposta e SKU", status: "backlog", dueDate: "2026-10-05",
      assigneeName: "Severino", categoryLabel: "Sales Ops" }),
    task({ id: "6", name: "Treinamento de canais", status: "backlog", dueDate: "2026-11-30",
      assigneeName: "Inayan", categoryLabel: "Produto" }),
  ]);
  const texto = buildWrittenUpdate(r, TODAY);

  it("abre no tom do modelo, com a contagem em dias úteis", () => {
    expect(texto.startsWith("Olá, pessoal!")).toBe(true);
    expect(texto).toContain(
      "Faltam 19 dias úteis para o lançamento do Nimbus Astro (04/11). Compartilho os principais avanços",
    );
  });

  it("tem os três blocos numerados, nessa ordem", () => {
    const ordem = ["1. Avanços", "2. Entregas prioritárias", "3. Ação solicitada"];
    let cursor = -1;
    for (const bloco of ordem) {
      const pos = texto.indexOf(bloco);
      expect(pos).toBeGreaterThan(cursor);
      cursor = pos;
    }
  });

  it("lista os avanços do mais recente ao mais antigo e fecha com o total", () => {
    const avancos = texto.slice(texto.indexOf("1. Avanços"), texto.indexOf("2. Entregas"));
    expect(avancos.indexOf("Aprovar mensagem")).toBeLessThan(avancos.indexOf("Configurar ambientes"));
    expect(avancos).toContain("• Total: 2 entregas concluídas no cronograma.");
  });

  it("deixa os dois-pontos abertos, para o autor dizer o que cada avanço destravou", () => {
    // É a metade editorial do modelo: "ambiente pronto para a utilização".
    expect(texto).toContain("• Configurar ambientes para clientes — Marina · Engenharia:");
  });

  it("limita os avanços listados, mas conta todos no total", () => {
    const muitas = report(
      Array.from({ length: 9 }, (_, i) =>
        task({ id: String(i), name: `Entrega ${i}`, status: "done",
          dueDate: `2026-09-${String(i + 10).padStart(2, "0")}` }),
      ),
    );
    const t = buildWrittenUpdate(muitas, TODAY);
    expect((t.match(/^• Entrega /gm) ?? []).length).toBe(5);
    expect(t).toContain("• Total: 9 entregas concluídas no cronograma.");
  });

  it("escreve a prioritária no formato responsável | prazo: entrega. Status.", () => {
    expect(texto).toContain("• Severino · Produto | 13/10: Concluir o mapa de riscos. Status: A iniciar.");
    expect(texto).toContain("• Severino · Sales Ops | 05/10: Cadastrar proposta e SKU. Status: Vencida.");
  });

  it("fecha a janela no domingo da semana seguinte", () => {
    // Hoje é quinta 08/10; a janela vai até domingo 18/10. O Business Plan
    // vence em 19/10 e fica de fora — é prioridade da semana seguinte.
    expect(texto).not.toContain("Validar o Business Plan");
  });

  it("põe as vencidas antes das que ainda estão no prazo", () => {
    const bloco = texto.slice(texto.indexOf("2. Entregas"), texto.indexOf("3. Ação"));
    expect(bloco.indexOf("Cadastrar proposta e SKU")).toBeLessThan(bloco.indexOf("mapa de riscos"));
  });

  it("só escreve ponto de atenção onde o atraso é fato", () => {
    // 05/10 era segunda; hoje é quinta 08/10 — três dias úteis de atraso.
    expect(texto).toContain("Ponto de atenção: prazo vencido há 3 dias úteis.");
    // A que está no prazo não ganha ponto de atenção inventado.
    const emDia = texto.slice(texto.indexOf("Concluir o mapa de riscos"));
    expect(emDia.slice(0, 120)).not.toContain("Ponto de atenção");
  });

  it("não traz entrega fora da janela desta e da próxima semana", () => {
    expect(texto).not.toContain("Treinamento de canais");
  });

  it("pede confirmação citando o próximo prazo em aberto", () => {
    expect(texto).toContain(
      "confirmem a conclusão das entregas previstas para 13/10/2026 e sinalizem eventuais bloqueios",
    );
    expect(texto).toContain("Caso tenham dúvidas ou sugestões de ajustes, fico à disposição.");
  });

  it("avisa o autor do que o cronograma não sabe", () => {
    expect(texto).toContain("complete cada avanço com o que ele destravou");
    expect(texto).not.toMatch(/^Impacto:/m);
  });

  it("diz explicitamente quando um bloco está vazio", () => {
    const vazio = buildWrittenUpdate(
      report([task({ id: "1", name: "Futura", status: "backlog", dueDate: "2026-12-20" })]),
      TODAY,
    );
    expect(vazio).toContain("• Nenhuma entrega concluída até aqui.");
    expect(vazio).toContain("• Nenhuma entrega vencida, nesta semana ou na próxima.");
  });

  it("explica a falta de âncora em vez de omiti-la", () => {
    const sem = buildWrittenUpdate(report([task({ id: "1", name: "X" })], null), TODAY);
    expect(sem).toContain("Nenhuma entrega está marcada como o evento de lançamento");
  });
});

describe("playbook: raias de área × janelas de prazo", () => {
  const base = (over: Partial<ReportTask> & { id: string; name: string }) =>
    task({ startDate: over.dueDate ?? null, ...over });

  const r = report([
    base({ id: "1", name: "Tese", dueDate: "2026-09-14", categoryLabel: "Produto", status: "done" }),
    base({ id: "2", name: "Preço", dueDate: "2026-09-28", categoryLabel: "Produto", status: "doing" }),
    base({ id: "3", name: "Sales kit", dueDate: "2026-10-19", categoryLabel: "Marketing" }),
    base({ id: "4", name: "Contrato", dueDate: "2026-10-01", categoryLabel: "Jurídico" }),
    base({ id: "5", name: "Evento", dueDate: LAUNCH, categoryLabel: "Marketing" }),
    base({ id: "6", name: "Balanço", dueDate: "2026-11-20", categoryLabel: "Produto" }),
  ]);
  const pb = buildPlaybook(r);

  it("sempre reserva uma coluna para o dia do lançamento", () => {
    const d0 = pb.columns.filter((c) => c.isLaunch);
    expect(d0).toHaveLength(1);
    expect(d0[0]!.period).toBe("D0");
  });

  it("cada entrega cai em exatamente uma coluna, mesmo com bordas repetidas", () => {
    const todas = pb.lanes.flatMap((l) => l.cards);
    expect(todas).toHaveLength(6);
    for (const card of todas) {
      expect(card.endColumn).toBeGreaterThanOrEqual(0);
      expect(card.endColumn).toBeLessThan(pb.columns.length);
      expect(card.startColumn).toBeLessThanOrEqual(card.endColumn);
    }
  });

  it("agrupa por área e ordena da raia mais cheia para a mais vazia", () => {
    expect(pb.lanes.map((l) => l.area)).toEqual(["Produto", "Marketing", "Jurídico"]);
    expect(pb.lanes[0]!.cards).toHaveLength(3);
  });

  it("cai para o responsável quando a entrega não tem área", () => {
    // É o caso das tarefas importadas de um quadro externo, que não trazem
    // categoria: uma raia única "Sem área" seria uma lista, não um playbook.
    const semArea = buildPlaybook(
      report([base({ id: "1", name: "X", dueDate: "2026-10-01", assigneeName: "Marina" })]),
    );
    expect(semArea.lanes[0]!.area).toBe("Marina");
  });

  it("empilha em linhas os cards da mesma raia que se encostam", () => {
    const mesmaJanela = buildPlaybook(
      report(
        Array.from({ length: 3 }, (_, i) =>
          base({ id: String(i), name: `T${i}`, dueDate: "2026-10-01", categoryLabel: "Produto" }),
        ),
      ),
    );
    expect(mesmaJanela.lanes[0]!.rows).toBe(3);
    expect(mesmaJanela.lanes[0]!.cards.map((c) => c.row)).toEqual([0, 1, 2]);
  });

  it("o card atravessa da coluna do início até a do prazo", () => {
    const largo = buildPlaybook(
      report([
        base({ id: "1", name: "Curto", dueDate: "2026-09-14", categoryLabel: "A" }),
        base({ id: "2", name: "Longo", dueDate: "2026-11-20", startDate: "2026-09-14",
          categoryLabel: "A" }),
      ]),
    );
    const longo = largo.lanes[0]!.cards.find((c) => c.item.name === "Longo")!;
    expect(longo.endColumn).toBeGreaterThan(longo.startColumn);
  });

  it("devolve grade vazia quando nenhuma entrega tem prazo", () => {
    expect(buildPlaybook(report([base({ id: "1", name: "X" })]))).toEqual({ columns: [], lanes: [] });
  });
});
