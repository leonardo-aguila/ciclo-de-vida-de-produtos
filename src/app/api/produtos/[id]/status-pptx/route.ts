/**
 * The delivery plan as a PowerPoint deck.
 *
 * The layout reproduces the reference template `Template export status.pptx`:
 * same slide size, same palette, same geometry — a row of blocks across the
 * top, each a deadline window, with one card per delivery underneath. The deck
 * is rebuilt rather than filled in, because the template is a fixed grid of 30
 * cards and a product can have three or a hundred; a generator adapts, a
 * find-and-replace does not.
 *
 * Generated on the server: the library is about a megabyte, and shipping it to
 * every browser to be used by one button is a bad trade.
 */
import { notFound } from "next/navigation";
import PptxGenJS from "pptxgenjs";
import { requireUser } from "@/lib/auth/guard";
import {
  buildStatusReport,
  countsLine,
  type ReportBucket,
  type ReportItem,
  type StatusKind,
} from "@/lib/engine/status-report";
import { formatDate, todayIso } from "@/lib/format";
import { findDoneColumn, listEnumValues } from "@/lib/queries/enums";
import { getProduct } from "@/lib/queries/products";
import { listTasks } from "@/lib/queries/tasks";

export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/* Design tokens, read from the reference template                            */
/* -------------------------------------------------------------------------- */

const SLIDE = { w: 13.333, h: 7.5 };
const MARGIN = 0.88;
const FONT = "Inter";

const COLOR = {
  navy: "0B125B",
  blockFill: "C9D2FF",
  cardFill: "F3F5FB",
  cardLine: "E3E7F2",
  doneFill: "EAF5EF",
  doneLine: "B9DEC9",
  owner: "757575",
  reference: "B0B0B0",
  footnote: "9E9E9E",
} as const;

/** The template defines three; "vencida" had no card to colour, so it gets one. */
const STATUS_COLOR: Record<StatusKind, string> = {
  done: "0E7A4F",
  doing: "A66A00",
  todo: "9E9E9E",
  overdue: "B3261E",
};

const BLOCK = { y: 2.02, w: 1.571, h: 0.46, step: 1.6715, perSlide: 7 };
const CARD = { y: 2.56, w: 1.571, h: 0.6, step: 0.655 };

/* -------------------------------------------------------------------------- */
/* Drawing                                                                    */
/* -------------------------------------------------------------------------- */

function drawCard(slide: PptxGenJS.Slide, item: ReportItem, x: number, y: number) {
  const isDone = item.kind === "done";

  slide.addShape("roundRect", {
    x,
    y,
    w: CARD.w,
    h: CARD.h,
    rectRadius: 0.04,
    fill: { color: isDone ? COLOR.doneFill : COLOR.cardFill },
    line: { color: isDone ? COLOR.doneLine : COLOR.cardLine, width: 0.75 },
  });

  // Deadline on the first line, delivery name below — the reference keeps them
  // in one box so the name wraps under the date instead of beside it.
  slide.addText(
    [
      {
        text: [item.dLabel, item.dueLabel].filter(Boolean).join("   "),
        options: { fontSize: 6.5, color: COLOR.owner, bold: true, breakLine: true },
      },
      { text: item.name, options: { fontSize: 7.5, color: COLOR.navy } },
    ],
    {
      x: x + 0.08,
      y: y + 0.04,
      w: 1.411,
      h: 0.35,
      fontFace: FONT,
      valign: "top",
      lineSpacingMultiple: 0.9,
      margin: 0,
    },
  );

  slide.addText(`● ${item.statusLabel}`, {
    x: x + 0.715,
    y: y + 0.04,
    w: 0.776,
    h: 0.18,
    fontFace: FONT,
    fontSize: 6.5,
    color: STATUS_COLOR[item.kind],
    align: "right",
    valign: "top",
    margin: 0,
  });

  slide.addText(item.deckOwnerLabel, {
    x: x + 0.08,
    y: y + 0.39,
    w: 0.988,
    h: 0.17,
    fontFace: FONT,
    fontSize: 6,
    color: COLOR.owner,
    valign: "bottom",
    margin: 0,
  });

  if (item.reference) {
    slide.addText(item.reference, {
      x: x + 0.715,
      y: y + 0.39,
      w: 0.776,
      h: 0.17,
      fontFace: FONT,
      fontSize: 6,
      color: COLOR.reference,
      align: "right",
      valign: "bottom",
      margin: 0,
    });
  }
}

function drawBlock(slide: PptxGenJS.Slide, bucket: ReportBucket, column: number) {
  const x = MARGIN + column * BLOCK.step;

  slide.addShape("roundRect", {
    x,
    y: BLOCK.y,
    w: BLOCK.w,
    h: BLOCK.h,
    rectRadius: 0.04,
    fill: { color: COLOR.blockFill },
    line: { color: COLOR.blockFill, width: 0 },
  });

  slide.addText(
    [
      { text: bucket.label, options: { fontSize: 7.5, bold: true, color: COLOR.navy } },
      {
        text: `   ${bucket.done}/${bucket.total}`,
        options: { fontSize: 7.5, color: COLOR.navy },
      },
    ],
    {
      x: x + 0.08,
      y: BLOCK.y + 0.04,
      w: BLOCK.w - 0.16,
      h: BLOCK.h - 0.08,
      fontFace: FONT,
      valign: "middle",
      margin: 0,
    },
  );

  bucket.items.forEach((item, index) => {
    drawCard(slide, item, x, CARD.y + index * CARD.step);
  });
}

/* -------------------------------------------------------------------------- */
/* Route                                                                      */
/* -------------------------------------------------------------------------- */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Every role may read a product; the guard is what stops an anonymous
  // request from walking out with the launch plan.
  await requireUser();

  const product = await getProduct(id);
  if (!product) notFound();

  const [tasks, columnValues] = await Promise.all([listTasks(id), listEnumValues("kanban_column")]);
  const doneCode = findDoneColumn(columnValues)?.code ?? null;
  const doingCodes = columnValues
    .filter((column) => {
      const meta = column.meta as { isDone?: boolean; isBlocked?: boolean } | null;
      return !meta?.isDone && !meta?.isBlocked && column.code !== "backlog" && column.code !== "todo";
    })
    .map((column) => column.code);

  const today = todayIso();
  const report = buildStatusReport({
    productName: product.name,
    launchDate: product.actualLaunchDate ?? product.plannedLaunchDate,
    today,
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      assigneeName: task.assigneeName,
      categoryLabel: task.categoryLabel,
      dueDate: task.dueDate,
      status: task.status,
      description: task.description,
    })),
    doneColumns: doneCode ? [doneCode] : [],
    doingColumns: doingCodes,
  });

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SKYONE", width: SLIDE.w, height: SLIDE.h });
  pptx.layout = "SKYONE";
  pptx.author = "portfolio";
  pptx.title = `${product.name} · Plano de entregas`;

  // Seven blocks fit across a slide; the rest spill onto the next one rather
  // than being dropped or squeezed.
  const pages: ReportBucket[][] = [];
  for (let index = 0; index < report.buckets.length; index += BLOCK.perSlide) {
    pages.push(report.buckets.slice(index, index + BLOCK.perSlide));
  }
  if (pages.length === 0) pages.push([]);

  pages.forEach((buckets, pageIndex) => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };

    slide.addText(
      `${product.name} · Plano de entregas` +
        (pages.length > 1 ? `  (${pageIndex + 1}/${pages.length})` : ""),
      {
        x: MARGIN, y: 0.55, w: 8, h: 0.3,
        fontFace: FONT, fontSize: 10, color: COLOR.navy, bold: true, margin: 0,
      },
    );

    slide.addText(report.headline, {
      x: MARGIN, y: 0.98, w: 11.6, h: 0.72,
      fontFace: FONT, fontSize: 18, color: COLOR.navy, bold: true, valign: "top", margin: 0,
    });

    slide.addText(countsLine(report), {
      x: MARGIN, y: 1.72, w: 11.6, h: 0.24,
      fontFace: FONT, fontSize: 9, color: COLOR.owner, margin: 0,
    });

    buckets.forEach((bucket, column) => drawBlock(slide, bucket, column));

    slide.addText(
      (report.d0Label
        ? `D = dias corridos entre o prazo e o D0 (lançamento, ${report.d0Label}). `
        : "O produto não tem data de lançamento, então as entregas aparecem por prazo. ") +
        `Área = responsável e categoria da tarefa. Card verde = concluída. Gerado em ${formatDate(today)}.`,
      {
        x: MARGIN, y: 6.989, w: 11.6, h: 0.3,
        fontFace: FONT, fontSize: 7, color: COLOR.footnote, margin: 0,
      },
    );

    slide.addText(`${product.name} · Documento interno`, {
      x: MARGIN, y: 7.11, w: 7, h: 0.24,
      fontFace: FONT, fontSize: 7, color: COLOR.footnote, margin: 0,
    });
  });

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const filename = `status-${product.code.toLowerCase()}-${today}.pptx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
