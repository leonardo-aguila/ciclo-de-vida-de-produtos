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
 * "Ana Carolina Prado Lima" → "Leonardo Aguila".
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

/** Uma linha de item: o que é, para quando e de quem. */
function line(item: ReportItem): string {
  const prazo = item.dueDate
    ? `${formatDate(item.dueDate)}${item.dLabel ? ` (${item.dLabel})` : ""}`
    : "sem prazo";
  return `• ${item.name} — ${prazo} — ${item.ownerLabel}`;
}

/**
 * O status escrito, em três blocos.
 *
 * Em andamento, atrasadas e as prioridades das próximas duas semanas — cada
 * item com prazo e responsável, que é o que um status precisa para alguém
 * agir. O que já fechou não entra: ninguém age sobre o que está pronto, e uma
 * lista de vinte concluídas enterra as três que travam o lançamento.
 *
 * O "por que isto importa" de cada item continua de fora. É leitura de quem
 * assina, e uma frase gerada ali seria um palpite confiante numa mensagem
 * sobre a qual as pessoas tomam decisão.
 */
export function buildWrittenUpdate(report: StatusReport, today: string): string {
  const lines: string[] = ["Prezados, boa tarde.", ""];

  if (report.d0Label && report.daysToLaunch !== null && report.daysToLaunch > 0) {
    lines.push(
      `Faltam ${report.daysToLaunch} dias úteis para o lançamento do ${report.productName} ` +
        `(${report.d0Label}). Segue o status das entregas.`,
    );
  } else if (report.d0Label && report.daysToLaunch !== null) {
    lines.push(
      `O lançamento do ${report.productName} foi em ${report.d0Label}. Segue o status das entregas.`,
    );
  } else {
    lines.push(
      `Segue o status das entregas do ${report.productName}. ` +
        "Nenhuma entrega está marcada como o evento de lançamento, então não há contagem regressiva.",
    );
  }
  lines.push("");

  const emAndamento = report.items.filter((item) => item.kind === "doing");
  const atrasadas = report.items.filter((item) => item.kind === "overdue");

  const limite = endOfNextWeek(today);
  const prioridades = report.items.filter(
    (item) =>
      item.kind !== "done" &&
      item.kind !== "overdue" &&
      item.dueDate !== null &&
      item.dueDate >= today &&
      item.dueDate <= limite,
  );

  lines.push(`ATRASADAS (${atrasadas.length})`);
  if (atrasadas.length === 0) {
    lines.push("• Nenhuma entrega com prazo vencido.");
  } else {
    for (const item of atrasadas) lines.push(line(item));
  }
  lines.push("");

  lines.push(`EM ANDAMENTO (${emAndamento.length})`);
  if (emAndamento.length === 0) {
    lines.push("• Nenhuma entrega em andamento.");
  } else {
    for (const item of emAndamento) lines.push(line(item));
  }
  lines.push("");

  lines.push(`PRIORIDADES — entregas até ${formatDate(limite)} (${prioridades.length})`);
  if (prioridades.length === 0) {
    lines.push("• Nenhuma entrega vence nesta nem na próxima semana.");
  } else {
    for (const item of prioridades) lines.push(line(item));
  }
  lines.push("");

  lines.push(
    "Ação solicitada: peço que cada responsável confirme o prazo dos itens acima, ou sinalize um bloqueio.",
  );
  lines.push("");
  lines.push("Fico à disposição para detalhar qualquer ponto.");
  lines.push("");
  lines.push(
    "— Rascunho gerado a partir das entregas cadastradas; prazos em dias úteis. " +
      "Acrescente o impacto de cada item antes de enviar: por que ele importa é leitura sua.",
  );

  return lines.join("\n");
}
