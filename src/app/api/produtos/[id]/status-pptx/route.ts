/**
 * O plano de entregas como baralho, no layout de playbook: as janelas de prazo
 * em cima, as áreas como raias à esquerda, cada entrega um bloco que atravessa
 * as colunas do seu início até o seu prazo.
 *
 * A geometria e a paleta foram lidas do template de referência — não há como
 * delegar: o gerador oficial da marca só conhece o layout de colunas de cards,
 * e nenhum dos seus layouts produz uma grade de raias. O que dá para garantir
 * é fidelidade de medida e de cor, e é o que está em `G` e em `C` abaixo.
 */
import { notFound } from "next/navigation";
import PptxGenJS from "pptxgenjs";
import { requireUser } from "@/lib/auth/guard";
import {
  buildPlaybook,
  buildStatusReport,
  countsLine,
  deckText,
  type Playbook,
  type PlaybookLane,
  type StatusKind,
  type StatusReport,
} from "@/lib/engine/status-report";
import { formatDate, todayIso } from "@/lib/format";
import { findDoneColumn, listEnumValues } from "@/lib/queries/enums";
import { getProduct } from "@/lib/queries/products";
import { listTasks } from "@/lib/queries/tasks";

export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/* Playbook: geometria e paleta lidas do template de referência               */
/* -------------------------------------------------------------------------- */

const SLIDE = { w: 13.333, h: 7.5 };
const FONT = "Inter";

const C = {
  navy: "000A62",
  ink: "1E2235",
  grey: "595959",
  laneBand: "F3F5FB",
  areaBand: "E8EBF5",
  line: "D9DCE8",
  launchTint: "FFF0F9",
  pink: "FF5EC4",
  pinkInk: "B0127F",
  white: "FFFFFF",
} as const;

/** Cor do bloco por situação. Rosa é o atraso, como pedido. */
const CARD: Record<StatusKind, { fill: string; text: string; line: string }> = {
  done: { fill: C.navy, text: C.white, line: C.navy },
  doing: { fill: C.line, text: C.navy, line: C.line },
  todo: { fill: C.white, text: C.grey, line: C.line },
  overdue: { fill: C.launchTint, text: C.pinkInk, line: C.pink },
};

const G = {
  areaX: 0.47, areaW: 1.1,
  gridX: 1.59, gridW: 11.27,
  colX: 1.62, colW: 1.56, colStep: 1.615,
  headerY: 1.93, headerH: 0.42,
  lanesY: 2.39, lanesBottom: 6.95,
  cardH: 0.23, cardGap: 0.04, lanePad: 0.04, laneGap: 0.03,
};

const columnLeft = (index: number) => G.colX + index * G.colStep;

function drawPlaybookSlide(
  pptx: PptxGenJS,
  playbook: Playbook,
  lanes: PlaybookLane[],
  report: StatusReport,
  productName: string,
  today: string,
  page: { index: number; total: number },
) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };

  slide.addText(
    `${productName} · Plano de entregas por área` +
      (page.total > 1 ? `  (${page.index + 1}/${page.total})` : ""),
    { x: G.areaX, y: 0.5, w: 9, h: 0.26, fontFace: FONT, fontSize: 10, color: C.navy, bold: true, margin: 0 },
  );
  slide.addText(report.headline, {
    x: G.areaX, y: 0.84, w: 12.3, h: 0.7, fontFace: FONT, fontSize: 18, color: C.navy,
    bold: true, valign: "top", margin: 0,
  });
  slide.addText(countsLine(report), {
    x: G.areaX, y: 1.6, w: 12.3, h: 0.22, fontFace: FONT, fontSize: 9, color: C.grey, margin: 0,
  });

  // Cabeçalho: as janelas de prazo, em cima.
  for (const [index, column] of playbook.columns.entries()) {
    const launch = column.isLaunch;
    slide.addShape("roundRect", {
      x: columnLeft(index), y: G.headerY, w: G.colW, h: G.headerH, rectRadius: 0.03,
      fill: { color: launch ? C.pink : C.navy }, line: { color: launch ? C.pink : C.navy, width: 0 },
    });
    slide.addText(column.period, {
      x: columnLeft(index) + 0.06, y: G.headerY + 0.04, w: G.colW - 0.12, h: 0.2,
      fontFace: FONT, fontSize: 7.5, color: C.white, bold: true, align: "center", margin: 0,
    });
    // A segunda linha traz as datas: repetir o D aqui não informa nada.
    slide.addText(launch ? `Lançamento · ${column.dateRange}` : column.dateRange, {
      x: columnLeft(index) + 0.06, y: G.headerY + 0.22, w: G.colW - 0.12, h: 0.16,
      fontFace: FONT, fontSize: 6, color: C.white, align: "center", margin: 0,
    });
  }

  // Raias: as áreas, à esquerda.
  let y = G.lanesY;
  for (const lane of lanes) {
    const h = lane.rows * G.cardH + (lane.rows - 1) * G.cardGap + 2 * G.lanePad;

    slide.addShape("roundRect", {
      x: G.areaX, y, w: G.areaW, h, rectRadius: 0.03,
      fill: { color: C.areaBand }, line: { color: C.areaBand, width: 0 },
    });
    slide.addText(lane.area, {
      x: G.areaX + 0.06, y, w: G.areaW - 0.12, h, fontFace: FONT, fontSize: 7,
      color: C.navy, bold: true, valign: "middle", margin: 0,
    });
    slide.addShape("rect", {
      x: G.gridX, y, w: G.gridW, h, fill: { color: C.laneBand }, line: { color: C.laneBand, width: 0 },
    });

    // A coluna do evento fica tingida ao longo de toda a raia.
    const launchIndex = playbook.columns.findIndex((column) => column.isLaunch);
    if (launchIndex >= 0) {
      slide.addShape("rect", {
        x: columnLeft(launchIndex), y, w: G.colW, h,
        fill: { color: C.launchTint }, line: { color: C.launchTint, width: 0 },
      });
    }

    for (const card of lane.cards) {
      const left = columnLeft(card.startColumn) + 0.05;
      const right = columnLeft(card.endColumn) + G.colW - 0.05;
      const tone = CARD[card.item.kind];
      const cardY = y + G.lanePad + card.row * (G.cardH + G.cardGap);

      slide.addShape("roundRect", {
        x: left, y: cardY, w: Math.max(0.5, right - left), h: G.cardH, rectRadius: 0.03,
        fill: { color: tone.fill }, line: { color: tone.line, width: 0.75 },
      });
      slide.addText(
        [
          { text: `${card.item.dLabel ?? ""}  `, options: { fontSize: 5.5, color: tone.text, bold: true } },
          { text: deckText(card.item.name, 58), options: { fontSize: 6.5, color: tone.text } },
        ],
        {
          x: left + 0.06, y: cardY, w: Math.max(0.4, right - left - 0.12), h: G.cardH,
          fontFace: FONT, valign: "middle", margin: 0,
        },
      );
    }

    y += h + G.laneGap;
  }

  slide.addText(
    (report.d0TaskName
      ? `D = dias úteis até o D0 (${report.d0TaskName}, ${report.d0Label}).`
      : "Sem entrega marcada como evento de lançamento.") +
      " Feriados não entram. Azul-marinho = concluída; cinza = em andamento; branco = a iniciar; " +
      `rosa = vencida. Cada entrega fica na raia da sua área. Gerado em ${formatDate(today)}.`,
    { x: G.areaX, y: 7.05, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 6.5, color: C.grey, margin: 0 },
  );
}

/** Quantas raias cabem numa página, sem espremer nada. */
function paginate(lanes: PlaybookLane[]): PlaybookLane[][] {
  const altura = (lane: PlaybookLane) =>
    lane.rows * G.cardH + (lane.rows - 1) * G.cardGap + 2 * G.lanePad + G.laneGap;
  const disponivel = G.lanesBottom - G.lanesY;
  const paginas: PlaybookLane[][] = [];
  let atual: PlaybookLane[] = [];
  let usado = 0;
  for (const lane of lanes) {
    const h = altura(lane);
    // Uma raia que sozinha não cabe vai inteira numa página: cortá-la ao meio
    // esconderia entregas, que é pior do que uma página mais cheia.
    if (atual.length > 0 && usado + h > disponivel) {
      paginas.push(atual);
      atual = [];
      usado = 0;
    }
    atual.push(lane);
    usado += h;
  }
  if (atual.length > 0) paginas.push(atual);
  return paginas.length > 0 ? paginas : [[]];
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      startDate: task.startDate,
      dueDate: task.dueDate,
      status: task.status,
      description: task.description,
    })),
    doneColumns: doneCode ? [doneCode] : [],
    doingColumns: doingCodes,
    // The Master's grid: six columns of six cards.
    perBucket: 6,
  });

  const playbook = buildPlaybook(report);
  const pages = paginate(playbook.lanes);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PLAYBOOK", width: SLIDE.w, height: SLIDE.h });
  pptx.layout = "PLAYBOOK";
  pptx.author = "portfolio";
  pptx.title = `${product.name} · Plano de entregas por área`;

  pages.forEach((lanes, index) =>
    drawPlaybookSlide(pptx, playbook, lanes, report, product.name, today, {
      index,
      total: pages.length,
    }),
  );

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
