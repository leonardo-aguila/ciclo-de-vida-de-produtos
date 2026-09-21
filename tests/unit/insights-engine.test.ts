import { describe, expect, it } from "vitest";
import { RuleBasedAnalyzer } from "@/lib/insights-engine";
import type { AnalyzedComment, ProductSignal } from "@/lib/insights-engine";
import {
  extractTerms,
  jaccard,
  normalize,
  polarityOf,
  singularize,
  tokenize,
} from "@/lib/insights-engine/text";

const analyzer = new RuleBasedAnalyzer();

function comment(
  id: string,
  body: string,
  overrides: Partial<AnalyzedComment> = {},
): AnalyzedComment {
  return {
    id,
    productId: "p1",
    productName: "Nimbus Data Lake",
    body,
    commentDate: "2026-08-01",
    categoryCode: null,
    categoryLabel: null,
    authorName: "Marina",
    ...overrides,
  };
}

const products: ProductSignal[] = [
  { productId: "p1", productName: "Nimbus Data Lake", health: 62, healthDelta: -8 },
  { productId: "p2", productName: "Nimbus Backup", health: 84, healthDelta: 3 },
];

describe("processamento de texto", () => {
  it("normaliza acentos e pontuação", () => {
    expect(normalize("Integração com SAP — está LENTA!")).toBe("integracao com sap esta lenta");
  });

  it("remove palavras sem sinal e termos curtos", () => {
    const tokens = tokenize("O cliente disse que a integração está muito lenta");
    expect(tokens).toContain("integracao");
    expect(tokens).toContain("lenta");
    expect(tokens).not.toContain("que");
    expect(tokens).not.toContain("cliente");
  });

  it("unifica plural regular sem estragar palavras curtas terminadas em s", () => {
    expect(singularize("relatorios")).toBe("relatorio");
    expect(singularize("contratos")).toBe("contrato");
    // Curtas demais para arriscar: "pais" não vira "pai".
    expect(singularize("pais")).toBe("pais");
    expect(singularize("mais")).toBe("mais");
    // "ss" no fim não é plural.
    expect(singularize("acesss")).toBe("acesss");
  });

  it("não deixa stopword escapar pela singularização", () => {
    // "demais" perdendo o "s" viraria "demai", que não está em lista nenhuma.
    expect(tokenize("custo alto demais")).not.toContain("demai");
    expect(tokenize("apenas isso")).not.toContain("apena");
  });

  it("trata singular e plural como a mesma palavra", () => {
    expect(tokenize("relatórios grandes")).toContain("relatorio");
    expect(tokenize("relatório grande")).toContain("relatorio");
  });

  it("extrai pares adjacentes além das palavras", () => {
    const terms = extractTerms("tempo resposta relatorio");
    expect(terms).toContain("tempo resposta");
    expect(terms).toContain("resposta relatorio");
  });

  it("mede sobreposição entre conjuntos de termos", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
  });

  it("classifica a polaridade pelas palavras, e a categoria do usuário tem precedência", () => {
    expect(polarityOf(["lentidao", "erro"], null)).toBe("risk");
    expect(polarityOf(["oportunidade", "expansao"], null)).toBe("opportunity");
    // A categoria escolhida na tela vence a inferência.
    expect(polarityOf(["oportunidade"], "risk")).toBe("risk");
    expect(polarityOf(["problema"], "opportunity")).toBe("opportunity");
  });
});

describe("motor de sugestões por regras", () => {
  it("devolve vazio sem comentários", async () => {
    expect(await analyzer.analyze({ comments: [], products, today: "2026-09-18" })).toEqual([]);
  });

  it("agrupa comentários sobre o mesmo tema", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "A integração com SAP está muito lenta e trava nos relatórios grandes."),
        comment("c2", "Cliente reclamou de lentidão na integração com SAP outra vez."),
        comment("c3", "A integração SAP demora demais para sincronizar."),
      ],
      products,
      today: "2026-09-18",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.frequency).toBe(3);
    expect(suggestions[0]!.terms.join(" ")).toMatch(/integração|sap/);
    expect(suggestions[0]!.kind).toBe("risk");
  });

  it("mantém temas distintos separados", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "A integração com SAP está lenta e trava nos relatórios."),
        comment("c2", "Integração SAP demora para sincronizar, de novo."),
        comment("c3", "Pediram exportação em planilha para o time financeiro fechar o mês."),
        comment("c4", "Outro pedido de exportação em planilha, agora do time financeiro."),
      ],
      products,
      today: "2026-09-18",
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    const titles = suggestions.map((suggestion) => suggestion.terms.join(" ")).join(" | ");
    expect(titles).toMatch(/integração|sap/);
    expect(titles).toMatch(/exportação|planilha/);
  });

  it("não funde temas distintos por causa de uma palavra genérica compartilhada", async () => {
    // "time" apareceu nos dois textos e, antes, bastava para juntá-los.
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "Pediram exportação em planilha para o time financeiro fechar o mês."),
        comment("c2", "Novo pedido de exportação em planilha, agora do time financeiro."),
        comment("c3", "Manutenção do legado consumindo time caro sem receita que justifique.", {
          productId: "p2",
          productName: "Nimbus Backup",
        }),
        comment("c4", "Custo de manutenção alto demais para a receita que o legado gera.", {
          productId: "p2",
          productName: "Nimbus Backup",
        }),
      ],
      products,
      today: "2026-09-18",
    });

    const exportTheme = suggestions.find((s) => s.terms.join(" ").includes("planilha"))!;
    expect(exportTheme).toBeDefined();
    expect(exportTheme.sourceCommentIds.sort()).toEqual(["c1", "c2"]);
    expect(exportTheme.products).toHaveLength(1);

    const maintenanceTheme = suggestions.find((s) => s.terms.join(" ").includes("manutenção"));
    expect(maintenanceTheme?.sourceCommentIds.sort()).toEqual(["c3", "c4"]);
  });

  it("devolve os termos com a grafia original, acentos inclusive", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "Manutenção do legado consumindo orçamento sem retorno."),
        comment("c2", "Orçamento de manutenção do legado segue sem retorno."),
      ],
      products,
      today: "2026-09-18",
    });

    const label = `${suggestions[0]!.title} ${suggestions[0]!.terms.join(" ")}`;
    expect(label).toMatch(/manutenção/i);
    expect(label).not.toMatch(/manutencao/i);
  });

  it("ignora tema mencionado uma vez só", async () => {
    const suggestions = await analyzer.analyze({
      comments: [comment("c1", "Uma observação isolada sobre exportação em planilha.")],
      products,
      today: "2026-09-18",
    });
    expect(suggestions).toEqual([]);
  });

  it("guarda os comentários de origem, para rastreabilidade", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "A integração com SAP está lenta nos relatórios grandes."),
        comment("c2", "Lentidão na integração SAP travando relatórios."),
      ],
      products,
      today: "2026-09-18",
    });

    expect(suggestions[0]!.sourceCommentIds.sort()).toEqual(["c1", "c2"]);
  });

  it("marca tendência de alta quando o tema é recente", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "Integração SAP lenta travando relatórios.", { commentDate: "2026-09-01" }),
        comment("c2", "Lentidão na integração SAP nos relatórios.", { commentDate: "2026-08-20" }),
        comment("c3", "Integração SAP lenta nos relatórios de novo.", { commentDate: "2026-02-01" }),
      ],
      products,
      today: "2026-09-18",
      recentWindowMonths: 3,
    });

    expect(suggestions[0]!.trend).toBe("rising");
    expect(suggestions[0]!.trendDetail).toContain("2 comentários");
  });

  it("marca tendência de esfriamento quando o tema é antigo", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "Integração SAP lenta travando relatórios.", { commentDate: "2026-01-10" }),
        comment("c2", "Lentidão na integração SAP nos relatórios.", { commentDate: "2026-02-15" }),
        comment("c3", "Integração SAP lenta nos relatórios.", { commentDate: "2026-03-01" }),
        comment("c4", "Integração SAP ainda lenta nos relatórios.", { commentDate: "2026-09-10" }),
      ],
      products,
      today: "2026-09-18",
      recentWindowMonths: 3,
    });

    expect(suggestions[0]!.trend).toBe("cooling");
  });

  it("agrupa entre produtos e correlaciona com a saúde de quem foi citado", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "Integração SAP lenta travando relatórios."),
        comment("c2", "Lentidão na integração SAP nos relatórios.", {
          productId: "p2",
          productName: "Nimbus Backup",
        }),
        comment("c3", "Integração SAP demora nos relatórios grandes.", {
          productId: "p2",
          productName: "Nimbus Backup",
        }),
      ],
      products,
      today: "2026-09-18",
    });

    const suggestion = suggestions[0]!;
    expect(suggestion.products).toHaveLength(2);
    expect(suggestion.products.find((p) => p.id === "p2")!.mentions).toBe(2);
    // Média de 62 e 84.
    expect(suggestion.affectedHealth.average).toBe(73);
    expect(suggestion.affectedHealth.averageDelta).toBeCloseTo(-2.5, 5);
    // Aparecer em mais de um produto aumenta a confiança.
    expect(suggestion.confidence).toBeGreaterThan(0.5);
  });

  it("classifica oportunidade quando o texto pede algo novo", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("c1", "Pediram integração nativa com Power BI, seria oportunidade de expansão."),
        comment("c2", "Outro pedido de integração nativa com Power BI, com interesse de expansão."),
      ],
      products,
      today: "2026-09-18",
    });

    expect(suggestions[0]!.kind).toBe("opportunity");
    expect(suggestions[0]!.recommendation).toMatch(/insight|roadmap/i);
  });

  it("ordena riscos antes de oportunidades", async () => {
    const suggestions = await analyzer.analyze({
      comments: [
        comment("o1", "Pediram integração nativa com Power BI, oportunidade de expansão."),
        comment("o2", "Novo pedido de integração nativa com Power BI, interesse de expansão."),
        comment("o3", "Mais um pedido de integração nativa Power BI, com interesse."),
        comment("r1", "Instabilidade no processamento derrubou a carga noturna."),
        comment("r2", "Instabilidade no processamento outra vez, carga noturna caiu."),
      ],
      products,
      today: "2026-09-18",
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions[0]!.kind).toBe("risk");
  });

  it("respeita a frequência mínima configurada", async () => {
    const comments = [
      comment("c1", "Integração SAP lenta nos relatórios."),
      comment("c2", "Lentidão na integração SAP nos relatórios."),
    ];

    expect(
      await analyzer.analyze({ comments, products, today: "2026-09-18", minFrequency: 3 }),
    ).toEqual([]);
    expect(
      (await analyzer.analyze({ comments, products, today: "2026-09-18", minFrequency: 2 })).length,
    ).toBe(1);
  });

  it("não quebra com comentário sem termo aproveitável", async () => {
    const suggestions = await analyzer.analyze({
      comments: [comment("c1", "ok"), comment("c2", "sim")],
      products,
      today: "2026-09-18",
    });
    expect(suggestions).toEqual([]);
  });
});
