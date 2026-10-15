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
  startDate: string | null;
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
  /** O mesmo, para a data de início: é o que dá largura ao card no playbook. */
  startOffset: number | null;
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
      const startOffset = d0 && task.startDate ? businessDaysBetween(d0, task.startDate) : null;
      return {
        id: task.id,
        name: deliveryName(task.name),
        dOffset,
        startOffset,
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
  const parts = [`${productName}: ${counts.done} de ${counts.total} entregas concluídas`];
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
  const columns: DeckColumn[] = [];

  for (const bucket of report.buckets) {
    // A bucket above the card limit is split rather than overflowed.
    for (let start = 0; start < bucket.items.length; start += DECK.cardsPerColumn) {
      const slice = bucket.items.slice(start, start + DECK.cardsPerColumn);
      const atLaunch = slice.every((item) => item.dOffset === 0);
      columns.push({
        periodo: bucket.label,
        nome: columnName(slice),
        destaque: atLaunch || undefined,
        entregas: slice.map((item) => ({
          marco: item.dLabel ?? "—",
          data: item.dueLabel,
          texto: deckText(item.name),
          status: DECK_STATUS[item.kind],
          dono: item.deckOwnerLabel,
          ...(item.reference ? { chave: item.reference } : {}),
        })),
      });
    }
  }

  const pages: DeckColumn[][] = [];
  for (let index = 0; index < columns.length; index += DECK.columnsPerSlide) {
    pages.push(columns.slice(index, index + DECK.columnsPerSlide));
  }
  return pages.length > 0 ? pages : [[]];
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
/* Playbook: raias de área × janelas de prazo                                 */
/* -------------------------------------------------------------------------- */

export type PlaybookColumn = {
  /** "D-90 a D-21", "D0", "D+1 a D+33". */
  period: string;
  /** Janela em dias úteis, fechada nas duas pontas. */
  from: number;
  to: number;
  /** A coluna do evento. Ganha destaque no slide. */
  isLaunch: boolean;
  /** "13/09 a 02/10" — a janela em datas, que é o que o leitor confere. */
  dateRange: string;
};

export type PlaybookCard = {
  item: ReportItem;
  /** Índices de coluna que o card atravessa, do início ao prazo. */
  startColumn: number;
  endColumn: number;
  /** Linha dentro da raia, para dois cards não se sobreporem. */
  row: number;
};

export type PlaybookLane = {
  area: string;
  cards: PlaybookCard[];
  /** Quantas linhas a raia precisa para caber sem sobreposição. */
  rows: number;
};

export type Playbook = { columns: PlaybookColumn[]; lanes: PlaybookLane[] };

/**
 * A área que dá nome à raia.
 *
 * A categoria da tarefa é a área. Quando não há — e não há nas tarefas
 * importadas de um quadro externo, que não trazem categoria — a raia cai para
 * o responsável, porque uma única faixa "Sem área" com tudo dentro não é um
 * playbook, é uma lista.
 */
function laneOf(item: ReportItem): string {
  return item.categoryLabel ?? item.assigneeName ?? "Sem área";
}

/** "13/09 a 02/10", ou só a data quando a janela tem um dia. */
function rangeLabel(from: string, to: string): string {
  return from === to ? from : `${from} a ${to}`;
}

/** Rótulo de uma janela: "D-90 a D-21", ou "D0" quando é um dia só. */
function periodLabel(from: number, to: number): string {
  return from === to ? dLabelOf(from) : `${dLabelOf(from)} a ${dLabelOf(to)}`;
}

/**
 * Divide o eixo do tempo em janelas, isolando o dia do lançamento.
 *
 * O D0 fica numa coluna própria mesmo que nenhuma entrega caia nele: é a
 * referência que organiza a leitura do slide inteiro, e uma coluna ausente
 * faria o "antes" e o "depois" se encostarem.
 */
export type PlaybookAxis = {
  columns: PlaybookColumn[];
  /** Id da entrega → índice da coluna. A fatia manda, não o intervalo. */
  columnOf: Map<string, number>;
};

export function playbookColumns(items: ReportItem[], maxBefore = 5): PlaybookAxis {
  const comPrazo = items.filter((i) => i.dOffset !== null);
  if (comPrazo.length === 0) return { columns: [], columnOf: new Map() };

  const antes = comPrazo.filter((i) => i.dOffset! < 0).sort((a, b) => a.dOffset! - b.dOffset!);
  const depois = comPrazo.filter((i) => i.dOffset! > 0).sort((a, b) => a.dOffset! - b.dOffset!);
  const colunas: PlaybookColumn[] = [];
  const columnOf = new Map<string, number>();

  const janela = (fatia: ReportItem[]): PlaybookColumn => {
    const from = fatia[0]!.dOffset!;
    const to = fatia[fatia.length - 1]!.dOffset!;
    return {
      period: periodLabel(from, to),
      from,
      to,
      isLaunch: false,
      dateRange: rangeLabel(fatia[0]!.dueLabel, fatia[fatia.length - 1]!.dueLabel),
    };
  };

  if (antes.length > 0) {
    // Fatias por quantidade de entregas, não por largura de tempo: o trabalho
    // se concentra perto do lançamento, e faixas de tempo iguais deixariam
    // metade das colunas vazias.
    const n = Math.min(maxBefore, antes.length);
    for (let k = 0; k < n; k += 1) {
      const inicio = Math.floor((k * antes.length) / n);
      const fim = Math.floor(((k + 1) * antes.length) / n);
      const fatia = antes.slice(inicio, fim);
      if (fatia.length === 0) continue;
      for (const item of fatia) columnOf.set(item.id, colunas.length);
      colunas.push(janela(fatia));
    }
  }

  for (const item of comPrazo.filter((i) => i.dOffset === 0)) columnOf.set(item.id, colunas.length);
  colunas.push({
    period: "D0",
    from: 0,
    to: 0,
    isLaunch: true,
    dateRange: comPrazo.find((i) => i.dOffset === 0)?.dueLabel ?? "",
  });

  if (depois.length > 0) {
    for (const item of depois) columnOf.set(item.id, colunas.length);
    colunas.push(janela(depois));
  }
  return { columns: colunas, columnOf };
}

const columnOfOffset = (columns: PlaybookColumn[], offset: number): number => {
  const exato = columns.findIndex((c) => offset >= c.from && offset <= c.to);
  if (exato >= 0) return exato;
  // Fora de qualquer janela: encosta na borda mais próxima em vez de sumir.
  return offset < columns[0]!.from ? 0 : columns.length - 1;
};

/**
 * Monta a grade: uma raia por área, um card por entrega.
 *
 * O card começa na coluna da data de início e termina na do prazo, como no
 * playbook de referência — uma entrega de três semanas é uma barra de três
 * semanas, não um ponto no fim.
 */
export function buildPlaybook(report: StatusReport): Playbook {
  const { columns, columnOf } = playbookColumns(report.items);
  if (columns.length === 0) return { columns: [], lanes: [] };

  const porArea = new Map<string, ReportItem[]>();
  for (const item of report.items) {
    if (item.dOffset === null) continue;
    const area = laneOf(item);
    porArea.set(area, [...(porArea.get(area) ?? []), item]);
  }

  const lanes: PlaybookLane[] = [];
  for (const [area, itens] of porArea) {
    const ordenados = [...itens].sort(
      (a, b) => (a.dOffset ?? 0) - (b.dOffset ?? 0) || a.name.localeCompare(b.name),
    );
    // Empacota em linhas: um card só divide a linha com quem não o encosta.
    const ocupacao: number[] = [];
    const cards: PlaybookCard[] = [];
    for (const item of ordenados) {
      const end = columnOf.get(item.id) ?? columnOfOffset(columns, item.dOffset!);
      const start = item.startOffset === null ? end : columnOfOffset(columns, item.startOffset);
      const startColumn = Math.min(start, end);
      let row = ocupacao.findIndex((ocupadoAte) => ocupadoAte < startColumn);
      if (row === -1) {
        row = ocupacao.length;
        ocupacao.push(end);
      } else {
        ocupacao[row] = end;
      }
      cards.push({ item, startColumn, endColumn: end, row });
    }
    lanes.push({ area, cards, rows: Math.max(1, ocupacao.length) });
  }

  // Raia mais cheia primeiro: o leitor começa por onde há mais trabalho.
  lanes.sort((a, b) => b.cards.length - a.cards.length || a.area.localeCompare(b.area));
  return { columns, lanes };
}
