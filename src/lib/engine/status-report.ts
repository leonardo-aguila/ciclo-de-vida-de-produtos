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
import { daysBetween, formatDate, formatDateShort } from "@/lib/format";

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
  /** The launch event: actual date if it happened, planned otherwise. */
  launchDate: string | null;
  today: string;
  tasks: ReportTask[];
  doneColumns: string[];
  doingColumns: string[];
  perBucket?: number;
}): StatusReport {
  const done = new Set(input.doneColumns);
  const doing = new Set(input.doingColumns);

  const items: ReportItem[] = input.tasks
    .map((task) => {
      const kind = classify(task, done, doing, input.today);
      const dOffset =
        input.launchDate && task.dueDate ? daysBetween(input.launchDate, task.dueDate) : null;
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

  const daysToLaunch = input.launchDate ? daysBetween(input.today, input.launchDate) : null;

  const headline = buildHeadline(input.productName, counts, input.launchDate, daysToLaunch);

  return {
    productName: input.productName,
    d0: input.launchDate,
    d0Label: input.launchDate ? formatDateShort(input.launchDate) : null,
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
        ? `evento em ${formatDateShort(launchDate)} (faltam ${daysToLaunch} dias)`
        : `evento em ${formatDateShort(launchDate)} (há ${Math.abs(daysToLaunch)} dias)`,
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
        ? `evento em ${report.d0Label} (faltam ${report.daysToLaunch} dias)`
        : `evento em ${report.d0Label} (há ${Math.abs(report.daysToLaunch)} dias)`,
    );
  }
  return parts.join("  ·  ");
}

/* -------------------------------------------------------------------------- */
/* Written update                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The Rolling Status Update, as text.
 *
 * It generates what the data knows: how long to the launch, what closed, what
 * is open grouped by deadline, who owns each item and what is late. It does
 * NOT write the "Impacto:" lines of the reference message — those are the
 * author's reading of why an item matters, and a generated sentence there
 * would be a confident guess in a message people act on. The closing note says
 * so, so nobody sends the draft believing it is complete.
 */
export function buildWrittenUpdate(report: StatusReport, today: string): string {
  const lines: string[] = ["Prezados, boa tarde.", ""];

  if (report.d0Label && report.daysToLaunch !== null && report.daysToLaunch >= 0) {
    lines.push(
      `Faltam ${report.daysToLaunch} dias para o evento de lançamento do ${report.productName} (${report.d0Label}). ` +
        "Segue o status desta semana, com os pontos que exigem ação dos responsáveis.",
    );
  } else if (report.d0Label && report.daysToLaunch !== null) {
    lines.push(
      `O lançamento do ${report.productName} foi em ${report.d0Label}, há ${Math.abs(report.daysToLaunch)} dias. ` +
        "Segue o status desta semana.",
    );
  } else {
    lines.push(
      `Segue o status das entregas do ${report.productName}. ` +
        "O produto ainda não tem data de lançamento definida, então as entregas estão listadas por prazo.",
    );
  }
  lines.push("");

  const concluded = report.items.filter((item) => item.kind === "done");
  if (concluded.length > 0) {
    lines.push(`TÓPICO — Decisões & Avanços (${concluded.length} de ${report.counts.total})`);
    for (const item of concluded) {
      lines.push(`• ${item.name}${item.ownerLabel !== "—" ? ` — ${item.ownerLabel}` : ""}`);
    }
    lines.push("");
  }

  const open = report.items.filter((item) => item.kind !== "done");
  if (open.length > 0) {
    lines.push("TÓPICO — Caminho Crítico");
    lines.push("");

    // Grouped by deadline, which is the order the reader acts in.
    const byDue = new Map<string, ReportItem[]>();
    for (const item of open) {
      const key = item.dueDate ?? "sem-prazo";
      byDue.set(key, [...(byDue.get(key) ?? []), item]);
    }

    let index = 1;
    for (const [key, group] of byDue) {
      const header =
        key === "sem-prazo"
          ? "Sem prazo definido"
          : `Prazo ${formatDate(key)}${group[0]!.dLabel ? ` (${group[0]!.dLabel})` : ""}` +
            (key < today ? " — VENCIDO" : "");
      lines.push(`${index}. ${header}`);
      for (const item of group) {
        const owner = item.ownerLabel !== "—" ? ` | Responsável: ${item.ownerLabel}` : "";
        lines.push(`   · ${item.name}${owner} | ${item.statusLabel.toUpperCase()}`);
      }
      lines.push("");
      index += 1;
    }
  }

  const nextDeadline = open.find((item) => item.dueDate !== null && item.dueDate >= today);
  lines.push(
    "Ação solicitada: peço que cada responsável dos itens em aberto confirme o prazo, " +
      `ou sinalize um bloqueio${nextDeadline?.dueDate ? `, até ${formatDate(nextDeadline.dueDate)}` : ""}.`,
  );
  lines.push("");
  lines.push("Fico à disposição para detalhar qualquer ponto.");
  lines.push("");
  lines.push(
    "— Rascunho gerado a partir das entregas cadastradas. Acrescente o impacto de cada " +
      "item antes de enviar: por que ele importa é leitura sua, não do sistema.",
  );

  return lines.join("\n");
}
