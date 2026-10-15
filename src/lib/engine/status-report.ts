/**
 * Status report — pure functions, no database.
 *
 * One model feeds three outputs: the table on screen, the PowerPoint deck and
 * the written update. They have to agree, and the only way to guarantee that
 * is to compute once and render three times.
 *
 * The vocabulary is the launch deck's: D0 is the launch event, and every
 * delivery is placed relative to it (D-52, D0, D+8). A product with no launch
 * date has no D — the functions say so instead of inventing a zero.
 */
import {
  addDaysToIso,
  businessDaysBetween,
  formatDate,
  formatDateShort,
} from "@/lib/format";

export type StatusKind = "done" | "doing" | "todo" | "overdue";

export type ReportTask = {
  id: string;
  name: string;
  assigneeName: string | null;
  categoryLabel: string | null;
  dueDate: string | null;
  status: string;
  /** Free text the import left behind — a Jira key, typically. */
  description: string | null;
};

export type ReportItem = {
  id: string;
  name: string;
  /** "D-52", "D0", "D+8" — null when the product has no launch date. */
  dLabel: string | null;
  /** Days between the deadline and D0, negative before. Null without D0. */
  dOffset: number | null;
  dueDate: string | null;
  dueLabel: string;
  assigneeName: string | null;
  categoryLabel: string | null;
  /** "Fulano · Marketing", or whichever half exists. */
  ownerLabel: string;
  /**
   * Who the deck names: the área, falling back to the person.
   *
   * The reference template puts the team on the card and never a name — a
   * card is 2,5 cm wide, and leadership asks which team owns it. The written
   * update names people, because that one asks for a reply.
   */
  deckOwnerLabel: string;
  kind: StatusKind;
  statusLabel: string;
  /** The source reference, when the description carries one (e.g. "DEMO-245"). */
  reference: string | null;
};

export type ReportBucket = {
  /** "D-60 a D-30", or "Sem prazo". */
  label: string;
  items: ReportItem[];
  done: number;
  total: number;
};

export type StatusReport = {
  productName: string;
  /** The launch date every offset is measured from. */
  d0: string | null;
  /** The delivery that defines D0, when one of them does. */
  d0TaskName: string | null;
  d0Label: string | null;
  /** Days from today to D0. Negative once the launch has passed. */
  daysToLaunch: number | null;
  counts: { total: number; done: number; doing: number; todo: number; overdue: number };
  buckets: ReportBucket[];
  items: ReportItem[];
  /** One factual sentence for the deck's headline. Meant to be edited. */
  headline: string;
};

export const STATUS_LABELS: Record<StatusKind, string> = {
  done: "Concluída",
  doing: "Em curso",
  todo: "A iniciar",
  overdue: "Vencida",
};

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which of the four buckets a task falls in.
 *
 * "Vencida" is not a column on the board — it is a deadline that passed on
 * something still open, which is exactly what a status report exists to
 * surface. A task with no deadline can never be late.
 */
export function classify(
  task: Pick<ReportTask, "status" | "dueDate">,
  doneColumns: Set<string>,
  doingColumns: Set<string>,
  today: string,
): StatusKind {
  if (doneColumns.has(task.status)) return "done";
  if (task.dueDate !== null && task.dueDate < today) return "overdue";
  if (doingColumns.has(task.status)) return "doing";
  return "todo";
}

/**
 * A tarefa que é o lançamento — o D0 do plano.
 *
 * O baralho de referência ancora em "evento de lançamento, DEMO-263", ou seja,
 * numa entrega, não numa data cadastrada no produto. É a leitura certa: o
 * plano gira em torno do dia em que a coisa sobe, e esse dia é uma tarefa que
 * alguém move no quadro. A data de lançamento prevista do produto fica como
 * alternativa, para quando nenhuma entrega se declara o evento.
 */
const LAUNCH_PATTERNS = [
  /evento de lan[çc]amento/i,
  /\bgo[-\s]?live\b/i,
  /realizar lan[çc]amento/i,
  /lan[çc]amento em produ[çc][ãa]o/i,
];

export function findLaunchTask<T extends { name: string; dueDate: string | null }>(
  tasks: T[],
): T | null {
  const candidates = tasks.filter((task) => task.dueDate !== null);
  for (const pattern of LAUNCH_PATTERNS) {
    const match = candidates.find((task) => pattern.test(task.name));
    if (match) return match;
  }
  return null;
}

/** "D-52", "D0", "D+8". */
export function dLabelOf(offset: number): string {
  if (offset === 0) return "D0";
  return offset < 0 ? `D${offset}` : `D+${offset}`;
}

/* -------------------------------------------------------------------------- */
/* Buckets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Splits the deliveries into columns of at most `perBucket`, cutting only
 * between different deadlines.
 *
 * The reference deck groups by theme ("Tese e plano de negócio"), which is
 * editorial: nothing in the data says what a window is about. Grouping by the
 * deadline window is the part that can be derived, and the label states the
 * window rather than claiming a theme nobody wrote.
 */
export function bucketize(items: ReportItem[], perBucket = 6): ReportBucket[] {
  const dated = items.filter((item) => item.dueDate !== null);
  const undated = items.filter((item) => item.dueDate === null);

  const buckets: ReportBucket[] = [];
  let current: ReportItem[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    const label =
      first.dLabel && last.dLabel
        ? first.dLabel === last.dLabel
          ? `${first.dLabel} · ${first.dueLabel}`
          : `${first.dLabel} a ${last.dLabel}`
        : first.dueLabel === last.dueLabel
          ? first.dueLabel
          : `${first.dueLabel} a ${last.dueLabel}`;
    buckets.push({
      label,
      items: current,
      done: current.filter((item) => item.kind === "done").length,
      total: current.length,
    });
    current = [];
  };

  for (const item of dated) {
    // Never split a deadline across two columns: the reader compares columns,
    // and the same date on both sides of a break reads as two deadlines.
    if (current.length >= perBucket && current[current.length - 1]!.dueDate !== item.dueDate) {
      flush();
    }
    current.push(item);
  }
  flush();

  if (undated.length > 0) {
    buckets.push({
      label: "Sem prazo",
      items: undated,
      done: undated.filter((item) => item.kind === "done").length,
      total: undated.length,
    });
  }

  return buckets;
}

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Drops the product prefix an import left on the name.
 *
 * "[Astra 2027 · Pocket] F1 · Criar tese" becomes "F1 · Criar tese". The same
 * rule the task packages use, in one place rather than two: a card is narrow
 * and the prefix is the half that repeats on every single row.
 */
export function deliveryName(name: string): string {
  return name.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim() || name;
}

/**
 * "Ana Carolina Prado Lima" → "Ana Lima".
 *
 * Only for the deck: a card is 2,5 cm wide at 6pt, and a full corporate name
 * wraps over the row below it. The table and the written update keep the name
 * as it is registered — there is room, and a person named in a message people
 * reply to should be named in full.
 */
export function compactPerson(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/** Pulls a "DEMO-245"-shaped reference out of whatever the import left behind. */
function referenceOf(description: string | null): string | null {
  if (!description) return null;
  return /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(description)?.[1] ?? null;
}

export function buildStatusReport(input: {
  productName: string;
  /** Fallback anchor: used only when no delivery declares itself the launch. */
  launchDate: string | null;
  today: string;
  tasks: ReportTask[];
  doneColumns: string[];
  doingColumns: string[];
  perBucket?: number;
}): StatusReport {
  const done = new Set(input.doneColumns);
  const doing = new Set(input.doingColumns);

  const launchTask = findLaunchTask(input.tasks);
  const d0 = launchTask?.dueDate ?? input.launchDate;

  const items: ReportItem[] = input.tasks
    .map((task) => {
      const kind = classify(task, done, doing, input.today);
      // Dias úteis, não corridos: "faltam 3 dias" tem de querer dizer três
      // dias de trabalho, senão um prazo numa segunda parece ter uma folga
      // que o fim de semana já consumiu.
      const dOffset = d0 && task.dueDate ? businessDaysBetween(d0, task.dueDate) : null;
      return {
        id: task.id,
        name: deliveryName(task.name),
        dOffset,
        dLabel: dOffset === null ? null : dLabelOf(dOffset),
        dueDate: task.dueDate,
        dueLabel: task.dueDate ? formatDateShort(task.dueDate) : "—",
        assigneeName: task.assigneeName,
        categoryLabel: task.categoryLabel,
        ownerLabel:
          [task.assigneeName, task.categoryLabel].filter(Boolean).join(" · ") || "—",
        deckOwnerLabel:
          task.categoryLabel ?? (task.assigneeName ? compactPerson(task.assigneeName) : "—"),
        kind,
        statusLabel: STATUS_LABELS[kind],
        reference: referenceOf(task.description),
      };
    })
    .sort((a, b) => {
      if (a.dueDate === null) return b.dueDate === null ? 0 : 1;
      if (b.dueDate === null) return -1;
      return a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name);
    });

  const counts = {
    total: items.length,
    done: items.filter((item) => item.kind === "done").length,
    doing: items.filter((item) => item.kind === "doing").length,
    todo: items.filter((item) => item.kind === "todo").length,
    overdue: items.filter((item) => item.kind === "overdue").length,
  };

  const daysToLaunch = d0 ? businessDaysBetween(input.today, d0) : null;

  const headline = buildHeadline(input.productName, counts, d0, daysToLaunch);

  return {
    productName: input.productName,
    d0,
    d0TaskName: launchTask ? deliveryName(launchTask.name) : null,
    d0Label: d0 ? formatDateShort(d0) : null,
    daysToLaunch,
    counts,
    buckets: bucketize(items, input.perBucket ?? 6),
    items,
    headline,
  };
}

/**
 * The deck's headline, stated as fact.
 *
 * The reference deck's headline carries a judgement ("os treinamentos de
 * liderança e PS ainda não começaram"). That judgement is the author's, so
 * what is generated here is the arithmetic, and the author edits it.
 */
function buildHeadline(
  productName: string,
  counts: StatusReport["counts"],
  launchDate: string | null,
  daysToLaunch: number | null,
): string {
  // A raia de uma área costuma ter uma entrega só, e "1 de 1 entregas
  // concluídas" é um erro que aparece no título em corpo 28.
  const singular = counts.total === 1;
  const parts = [
    `${productName}: ${counts.done} de ${counts.total} ` +
      (singular ? "entrega concluída" : "entregas concluídas"),
  ];
  if (counts.overdue > 0) {
    parts.push(
      `${counts.overdue} ${counts.overdue === 1 ? "vencida" : "vencidas"} exigindo ação`,
    );
  } else if (counts.doing > 0) {
    parts.push(`${counts.doing} em curso`);
  }
  if (launchDate && daysToLaunch !== null) {
    parts.push(
      daysToLaunch >= 0
        ? `evento em ${formatDateShort(launchDate)} (faltam ${daysToLaunch} dias úteis)`
        : `evento em ${formatDateShort(launchDate)} (há ${Math.abs(daysToLaunch)} dias úteis)`,
    );
  }
  return parts.join("; ");
}

/** The line under the headline: the counts, in the deck's own shorthand. */
export function countsLine(report: StatusReport): string {
  const parts = [
    `${report.counts.total} entregas`,
    `${report.counts.done} concluídas`,
    `${report.counts.doing} em curso`,
    `${report.counts.todo} a iniciar`,
    `${report.counts.overdue} vencidas`,
  ];
  if (report.d0Label && report.daysToLaunch !== null) {
    parts.push(
      report.daysToLaunch >= 0
        ? `evento em ${report.d0Label} (faltam ${report.daysToLaunch} dias úteis)`
        : `evento em ${report.d0Label} (há ${Math.abs(report.daysToLaunch)} dias úteis)`,
    );
  }
  return parts.join("  ·  ");
}

/* -------------------------------------------------------------------------- */
/* Written update                                                             */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Deck                                                                       */
/* -------------------------------------------------------------------------- */

export type DeckEntrega = {
  marco: string;
  data: string;
  texto: string;
  status: "concluida" | "em-curso" | "a-iniciar" | "atrasada";
  dono: string;
  chave?: string;
};

export type DeckColumn = {
  periodo: string;
  nome: string;
  entregas: DeckEntrega[];
  destaque?: boolean;
};

/**
 * O texto que cabe num card do Master: duas linhas, cerca de 45 caracteres
 * com seis colunas.
 *
 * Primeiro tira o marcador de fase, que já é o nome da coluna e repetiria em
 * todo card. Só então corta, e corta em palavra inteira. O nome completo
 * continua na tabela e no status em texto — o card é a vitrine, não o
 * registro.
 */
export function deckText(name: string, limit = 45): string {
  const withoutPhase = name.replace(/^F\d\s*·\s*/, "");
  if (withoutPhase.length <= limit + 1) return withoutPhase;
  const cut = withoutPhase.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const DECK_STATUS: Record<StatusKind, DeckEntrega["status"]> = {
  done: "concluida",
  doing: "em-curso",
  todo: "a-iniciar",
  overdue: "atrasada",
};

/** Limits of the Master's grid: six columns of six cards per slide. */
const DECK = { columnsPerSlide: 6, cardsPerColumn: 6 };

/**
 * Names a column by where it sits around the launch, not by a theme.
 *
 * The reference deck titles its columns editorially ("Oferta, preço e riscos").
 * Nothing in the data says what a window is about, so the name states the only
 * thing that is true of every card in it: which side of the launch it falls on.
 * When the deliveries carry the team's own phase marker (F1…F4), that is a
 * better name and it wins.
 */
function columnName(items: ReportItem[]): string {
  const phases = new Set(
    items.map((item) => /^(F\d)\s*·/.exec(item.name)?.[1]).filter(Boolean) as string[],
  );
  if (phases.size === 1) return `Fase ${[...phases][0]!.slice(1)}`;

  const offsets = items.map((item) => item.dOffset).filter((o): o is number => o !== null);
  if (offsets.length === 0) return "Sem prazo";
  if (offsets.every((o) => o === 0)) return "Evento de lançamento";
  if (offsets.every((o) => o < 0)) return "Preparação";
  if (offsets.every((o) => o > 0)) return "Pós-lançamento";
  // "Transição do lançamento" estoura a linha do cabeçalho no Master.
  return "Lançamento";
}

/**
 * The report's buckets as deck columns, paginated to the Master's grid.
 *
 * Returns one array of columns per slide. Nothing is dropped: a plan with
 * fifty deliveries becomes two slides rather than a slide missing twenty of
 * them, because the deliveries that fall off the end are the late ones.
 */
export function buildDeckColumns(report: StatusReport): DeckColumn[][] {
  return paginate(planColumns(report.buckets)).map((page) =>
    page.map((plan) => renderColumn(plan, plan.items, (item) => item.deckOwnerLabel)),
  );
}

/**
 * Uma coluna antes de virar cards: o cabeçalho e as entregas que caem nela.
 *
 * O plano existe separado da renderização porque a raia de cada área reusa
 * exatamente estas colunas, só com menos cards dentro.
 */
type ColumnPlan = {
  periodo: string;
  nome: string;
  destaque?: boolean;
  items: ReportItem[];
};

function planColumns(buckets: ReportBucket[]): ColumnPlan[] {
  const plans: ColumnPlan[] = [];
  for (const bucket of buckets) {
    // A bucket above the card limit is split rather than overflowed.
    for (let start = 0; start < bucket.items.length; start += DECK.cardsPerColumn) {
      const slice = bucket.items.slice(start, start + DECK.cardsPerColumn);
      const atLaunch = slice.every((item) => item.dOffset === 0);
      plans.push({
        periodo: bucket.label,
        nome: columnName(slice),
        destaque: atLaunch || undefined,
        items: slice,
      });
    }
  }
  return plans;
}

function renderColumn(
  plan: ColumnPlan,
  items: ReportItem[],
  ownerOf: (item: ReportItem) => string,
): DeckColumn {
  return {
    periodo: plan.periodo,
    nome: plan.nome,
    ...(plan.destaque ? { destaque: true } : {}),
    entregas: items.map((item) => ({
      marco: item.dLabel ?? "—",
      data: item.dueLabel,
      texto: deckText(item.name),
      status: DECK_STATUS[item.kind],
      dono: ownerOf(item),
      ...(item.reference ? { chave: item.reference } : {}),
    })),
  };
}

function paginate<T>(columns: T[]): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < columns.length; index += DECK.columnsPerSlide) {
    pages.push(columns.slice(index, index + DECK.columnsPerSlide));
  }
  return pages.length > 0 ? pages : [[]];
}

/* -------------------------------------------------------------------------- */
/* Raias por área                                                             */
/* -------------------------------------------------------------------------- */

/** Uma célula da grade: as entregas de uma área numa janela de prazo. */
export type GridCell = {
  texto: string;
  /** A cor do ponto: o pior estado das entregas da célula. */
  status: "verde" | "amarelo" | "vermelho" | "cinza";
} | "";

export type AreaGrid = {
  /** Cabeçalho: "Área" e as janelas de prazo. */
  colunas: string[];
  /** Uma linha por área: o nome e uma célula por janela. */
  linhas: (string | GridCell)[][];
  legenda: string;
};

/** O rótulo das entregas que ninguém classificou. */
const NO_AREA = "Sem área";

/**
 * Limites da tabela do Master: acima disso ele avisa que não se lê.
 *
 * A altura de uma linha é a da célula mais cheia dela, então é uma célula
 * sobrecarregada que estoura a página inteira — daí o teto por célula. Quem
 * mede de verdade é o gerador: ele avisa (`AVISO: tabela com X" de altura`)
 * quando não coube, e nenhum aviso é aceitável na entrega.
 */
const GRID = { columns: 6, rows: 10, chars: 28, perCell: 5 };

/** Pior primeiro: é o que decide a cor do ponto da célula. */
const GRID_SEVERITY: StatusKind[] = ["overdue", "doing", "todo", "done"];

const GRID_STATUS: Record<StatusKind, Exclude<GridCell, "">["status"]> = {
  overdue: "vermelho",
  doing: "amarelo",
  todo: "cinza",
  done: "verde",
};

/**
 * Reparte as entregas em no máximo seis janelas de prazo.
 *
 * `bucketize` corta por número de cards, que é o limite do slide de cards;
 * aqui o limite é de **colunas**, porque a grade inteira tem de caber numa
 * página. Começa pelo tamanho que daria seis janelas e afrouxa até caber —
 * a regra de nunca partir um mesmo prazo em duas colunas continua valendo, e
 * é ela que às vezes devolve uma janela a mais.
 */
function gridBuckets(items: ReportItem[]): ReportBucket[] {
  let perBucket = Math.max(1, Math.ceil(items.length / GRID.columns));
  let buckets = bucketize(items, perBucket);
  while (buckets.length > GRID.columns && perBucket < items.length) {
    perBucket += 1;
    buckets = bucketize(items, perBucket);
  }
  return buckets.slice(0, GRID.columns);
}

/** O nome que cabe numa célula estreita. */
function gridText(name: string): string {
  return deckText(name, GRID.chars);
}

/**
 * O plano inteiro numa página: prazos em cima, áreas à esquerda.
 *
 * Esta é a grade que o layout de cards não sabe fazer — e desenhá-la à mão já
 * foi tentado uma vez (revertido): sai com fonte, margem e paleta trocadas.
 * O Master tem a própria grade, a `tabela`, e é ela que é usada aqui: a
 * linha é a raia da área, a coluna é a janela de prazo.
 *
 * Duas limitações da célula, e o que foi feito com elas:
 *
 * - **Não há quebra de linha dentro da célula** (o gerador escreve a célula
 *   num parágrafo só), então as entregas vêm separadas por " · " em vez de
 *   empilhadas.
 * - **O ponto colorido é um por célula**, não um por entrega. Ele mostra o
 *   pior estado da célula, e a entrega vencida sai em negrito — assim uma
 *   célula com uma concluída e uma vencida não esconde nenhuma das duas. A
 *   legenda diz as duas coisas.
 *
 * Com uma área só (ou nenhuma), a grade teria uma linha e repetiria o slide
 * consolidado: não sai nada.
 */
export function buildAreaGrid(report: StatusReport): AreaGrid | null {
  const areaOf = (item: ReportItem) => item.categoryLabel?.trim() || NO_AREA;

  // `report.items` já vem por prazo, então a ordem de aparição é a ordem em
  // que cada área entra no plano. "Sem área" fecha a lista.
  const areas = [...new Set(report.items.map(areaOf))].sort((a, b) =>
    a === NO_AREA ? 1 : b === NO_AREA ? -1 : 0,
  );
  if (areas.length < 2) return null;

  const buckets = gridBuckets(report.items);
  const rows = groupRows(areas, areaOf, report);

  return {
    colunas: ["Área", ...buckets.map((bucket) => bucket.label)],
    linhas: rows.map(({ label, items }) => [
      label,
      ...buckets.map((bucket): GridCell => {
        const inCell = bucket.items.filter((item) => items.has(item.id));
        if (inCell.length === 0) return "";
        const worst = GRID_SEVERITY.find((kind) =>
          inCell.some((item) => item.kind === kind),
        )!;
        // A vencida primeiro: se a célula não couber inteira, o que sobra na
        // página é o que precisa de decisão.
        const ordered = [...inCell].sort(
          (a, b) => GRID_SEVERITY.indexOf(a.kind) - GRID_SEVERITY.indexOf(b.kind),
        );
        const shown = ordered.slice(0, GRID.perCell);
        const hidden = ordered.length - shown.length;
        return {
          // A vencida em negrito: o ponto da célula já é o pior estado, mas
          // sem isso uma célula vermelha não diz *qual* entrega está vencida.
          texto:
            shown
              .map((item) =>
                item.kind === "overdue" ? `**${gridText(item.name)}**` : gridText(item.name),
              )
              .join(" · ") + (hidden > 0 ? ` · +${hidden}` : ""),
          status: GRID_STATUS[worst],
        };
      }),
    ]),
    legenda:
      "● verde = concluída · amarelo = em curso · vermelho = vencida · cinza = a iniciar. " +
      "O ponto é o pior estado da célula; a vencida vem primeiro e em negrito, e \"+N\" é o que não coube.",
  };
}

/**
 * As linhas da grade, com as áreas excedentes reunidas na última.
 *
 * Acima de dez linhas o Master avisa que a tabela não se lê, e ele tem razão.
 * As que saem são as **menores**: juntar duas áreas de uma entrega cada custa
 * menos do que esconder a área que carrega metade do plano.
 */
function groupRows(
  areas: string[],
  areaOf: (item: ReportItem) => string,
  report: StatusReport,
): { label: string; items: Set<string> }[] {
  const idsOf = (names: string[]) =>
    new Set(report.items.filter((item) => names.includes(areaOf(item))).map((item) => item.id));

  if (areas.length <= GRID.rows) {
    return areas.map((area) => ({ label: area, items: idsOf([area]) }));
  }

  const size = (area: string) => report.items.filter((item) => areaOf(item) === area).length;
  const smallest = [...areas].sort((a, b) => size(a) - size(b));
  const merged = new Set(smallest.slice(0, areas.length - GRID.rows + 1));
  const kept = areas.filter((area) => !merged.has(area));

  return [
    ...kept.map((area) => ({ label: area, items: idsOf([area]) })),
    { label: `Demais áreas (${merged.size})`, items: idsOf([...merged]) },
  ];
}

/** Domingo que fecha a semana da data, para "esta e a próxima semana". */
function endOfNextWeek(today: string): string {
  const weekday = new Date(`${today}T00:00:00`).getDay();
  // getDay(): 0 = domingo. Faltam (7 - dia) % 7 dias até o próximo domingo.
  const toSunday = (7 - weekday) % 7;
  return addDaysToIso(today, toSunday + 7);
}

/** Quantos avanços o bloco 1 lista antes de fechar com o total. */
const MAX_AVANCOS = 5;

/**
 * O status executivo, em três blocos: avanços, entregas prioritárias e ação
 * solicitada.
 *
 * O formato é o da mensagem que o time já envia. O que muda é a origem: cada
 * linha sai de uma tarefa cadastrada, com o responsável e o prazo que estão
 * no quadro, em vez de serem recopiados à mão toda semana.
 *
 * Três coisas do modelo original NÃO são geradas, porque nenhuma delas está
 * nos dados:
 *
 *   1. o que cada avanço significou ("ambiente pronto para a utilização");
 *   2. o ponto de atenção de uma entrega que ainda está no prazo;
 *   3. qualquer juízo sobre risco de não entregar.
 *
 * As três são leitura de quem assina. A única exceção é o ponto de atenção de
 * uma entrega **vencida**: ali o atraso é fato, e o fato é escrito.
 */
export function buildWrittenUpdate(report: StatusReport, today: string): string {
  const linhas: string[] = ["Olá, pessoal!", ""];

  if (report.d0Label && report.daysToLaunch !== null && report.daysToLaunch > 0) {
    linhas.push(
      `Faltam ${report.daysToLaunch} dias úteis para o lançamento do ${report.productName} ` +
        `(${report.d0Label}). Compartilho os principais avanços, entregas prioritárias e ` +
        "pontos de atenção, conforme o cronograma atualizado.",
    );
  } else if (report.d0Label && report.daysToLaunch !== null) {
    linhas.push(
      `O lançamento do ${report.productName} foi em ${report.d0Label}. Compartilho os ` +
        "principais avanços, entregas prioritárias e pontos de atenção, conforme o " +
        "cronograma atualizado.",
    );
  } else {
    linhas.push(
      `Compartilho o status das entregas do ${report.productName}. Nenhuma entrega está ` +
        "marcada como o evento de lançamento, então não há contagem regressiva.",
    );
  }
  linhas.push("");

  /* --- 1. Avanços ------------------------------------------------------- */

  const concluidas = report.items.filter((item) => item.kind === "done");
  // Os mais recentes primeiro: num cronograma longo, o que fechou em janeiro
  // não é avanço desta semana.
  const recentes = [...concluidas]
    .sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? ""))
    .slice(0, MAX_AVANCOS);

  linhas.push("1. Avanços");
  linhas.push("");
  if (concluidas.length === 0) {
    linhas.push("• Nenhuma entrega concluída até aqui.");
  } else {
    for (const item of recentes) {
      linhas.push(`• ${item.name}${item.ownerLabel !== "—" ? ` — ${item.ownerLabel}` : ""}:`);
    }
    linhas.push(
      `• Total: ${concluidas.length} ${concluidas.length === 1 ? "entrega concluída" : "entregas concluídas"} no cronograma.`,
    );
  }
  linhas.push("");

  /* --- 2. Entregas prioritárias ----------------------------------------- */

  const limite = endOfNextWeek(today);
  const atrasadas = report.items.filter((item) => item.kind === "overdue");
  const proximas = report.items.filter(
    (item) =>
      item.kind !== "done" &&
      item.kind !== "overdue" &&
      item.dueDate !== null &&
      item.dueDate >= today &&
      item.dueDate <= limite,
  );
  // Vencidas primeiro: é o que o leitor precisa ver antes de rolar a tela.
  const prioritarias = [...atrasadas, ...proximas];

  linhas.push("2. Entregas prioritárias");
  linhas.push("");
  if (prioritarias.length === 0) {
    linhas.push("• Nenhuma entrega vencida, nesta semana ou na próxima.");
  } else {
    for (const item of prioritarias) {
      const dono = item.ownerLabel !== "—" ? item.ownerLabel : "sem responsável";
      const prazo = item.dueDate ? formatDateShort(item.dueDate) : "sem prazo";
      linhas.push(`• ${dono} | ${prazo}: ${item.name}. Status: ${item.statusLabel}.`);
      if (item.kind === "overdue" && item.dueDate) {
        const atraso = Math.abs(businessDaysBetween(item.dueDate, today));
        linhas.push(
          `  Ponto de atenção: prazo vencido há ${atraso} ${atraso === 1 ? "dia útil" : "dias úteis"}.`,
        );
      }
    }
  }
  linhas.push("");

  /* --- 3. Ação solicitada ----------------------------------------------- */

  const proximoPrazo =
    proximas.find((item) => item.dueDate !== null)?.dueDate ??
    atrasadas.find((item) => item.dueDate !== null)?.dueDate ??
    null;

  linhas.push("3. Ação solicitada");
  linhas.push("");
  linhas.push(
    "Peço que os responsáveis confirmem a conclusão das entregas previstas" +
      (proximoPrazo ? ` para ${formatDate(proximoPrazo)}` : "") +
      " e sinalizem eventuais bloqueios nas demais atividades, para anteciparmos riscos e " +
      "garantirmos a prontidão do lançamento.",
  );
  linhas.push("");
  linhas.push("Caso tenham dúvidas ou sugestões de ajustes, fico à disposição.");
  linhas.push("");
  linhas.push("---");
  linhas.push(
    "Rascunho montado a partir do cronograma; prazos em dias úteis. Antes de enviar, " +
      "complete cada avanço com o que ele destravou e acrescente os pontos de atenção das " +
      "entregas que ainda estão no prazo — isso o cronograma não sabe.",
  );

  return linhas.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Spec do gerador                                                            */
/* -------------------------------------------------------------------------- */

/**
 * O spec que o gerador oficial lê: o plano em cards e, atrás dele, a grade de
 * raias numa página só.
 *
 * Mora no motor, não na rota, porque é cálculo puro — e porque um teste que
 * precisa subir banco para conferir o rodapé de um slide não é escrito.
 */
export function buildDeckSpec(productName: string, report: StatusReport, today: string) {
  const pages = buildDeckColumns(report);
  const grid = buildAreaGrid(report);
  const anchorNote = report.d0TaskName
    ? `D = dias úteis até o D0 (${report.d0TaskName}, ${report.d0Label}).`
    : report.d0Label
      ? `D = dias úteis até a data prevista de lançamento (${report.d0Label}).`
      : "Nenhuma entrega está marcada como o evento de lançamento, então não há D.";

  const nota =
    `${anchorNote} Feriados não são considerados. ` +
    `Card verde = concluída; vermelho = vencida. Gerado em ${formatDate(today)}.`;

  // Todas as raias numa página: prazos em cima, áreas à esquerda. É a
  // `tabela` do próprio Master, não uma grade redesenhada à mão.
  // Os dois layouts não têm os mesmos campos, e a mistura é a forma do JSON
  // que o gerador lê — não de um tipo nosso.
  type Slide = Record<string, unknown>;

  const gridSlide: Slide[] = grid
    ? [
        {
          layout: "tabela",
          eyebrow: `${productName} · Raias por área`,
          titulo: report.headline,
          colunas: grid.colunas,
          linhas: grid.linhas,
          // A primeira coluna é nome de área e precisa de mais largura que
          // uma janela de prazo.
          larguras: [0.9, ...grid.colunas.slice(1).map(() => 1)],
          fonte: 9,
          // A legenda vai pela nota do Master, não pelo campo `legenda`: esse
          // é desenhado rente à borda de baixo e encosta na última linha da
          // tabela quando ela ocupa a página inteira — que é o caso aqui.
          nota:
            `${grid.legenda} ${anchorNote} Feriados não são considerados. ` +
            `${productName} · Documento interno.`,
        },
      ]
    : [];

  const planSlides: Slide[] = pages.map((columns, index) => ({
      layout: "plano-entregas",
      eyebrow: `${productName} · Plano de entregas`,
      titulo:
        report.headline + (pages.length > 1 ? ` (${index + 1} de ${pages.length})` : ""),
      // O Master já escreve as contagens sozinho; `resumo_info` entra depois
      // delas. Mandar a linha inteira aqui duplicava tudo e estourava a linha.
      resumo_info: report.d0Label
        ? [
            report.daysToLaunch !== null && report.daysToLaunch > 0
              ? `evento em ${report.d0Label} (faltam ${report.daysToLaunch} dias úteis)`
              : `evento em ${report.d0Label}`,
          ]
        : [],
      // Only what is actually late gets the amber treatment. An alert that
      // fires on every deck is an alert nobody reads.
      alertas:
        report.counts.overdue > 0
          ? [
              `${report.counts.overdue} ${report.counts.overdue === 1 ? "entrega vencida" : "entregas vencidas"}`,
            ]
          : [],
    colunas: columns,
    nota,
  }));

  return {
    rodape: `${productName} · Documento interno`,
    slides: [...planSlides, ...gridSlide],
  };
}
