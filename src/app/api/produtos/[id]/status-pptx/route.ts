/**
 * The delivery plan as a PowerPoint deck, in the Nimbus standard.
 *
 * The slide is NOT drawn here. The route turns the product's deliveries into
 * the `plano-entregas` spec, and an external generator (`vendor/deck/`) draws
 * it from the brand's own Master.
 * A hand-rebuilt slide comes out close and wrong — wrong fonts, wrong margins,
 * wrong palette — and "close" is exactly what a brand standard exists to
 * prevent.
 *
 * The generator is Python, so the route shells out to it. That is the price of
 * using the real template instead of an imitation of it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import {
  buildDeckColumns,
  buildStatusReport,
  type DeckColumn,
} from "@/lib/engine/status-report";
import { formatDate, todayIso } from "@/lib/format";
import { findDoneColumn, listEnumValues } from "@/lib/queries/enums";
import { getProduct } from "@/lib/queries/products";
import { listTasks } from "@/lib/queries/tasks";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

const VENDOR = join(process.cwd(), "vendor", "deck");
const PYTHON = join(process.cwd(), ".venv-pptx", "bin", "python");

/** The spec the official generator reads. One slide per page of columns. */
function buildSpec(
  productName: string,
  report: ReturnType<typeof buildStatusReport>,
  pages: DeckColumn[][],
  today: string,
) {
  const anchorNote = report.d0TaskName
    ? `D = dias úteis até o D0 (${report.d0TaskName}, ${report.d0Label}).`
    : report.d0Label
      ? `D = dias úteis até a data prevista de lançamento (${report.d0Label}).`
      : "Nenhuma entrega está marcada como o evento de lançamento, então não há D.";

  return {
    rodape: `${productName} · Documento interno`,
    slides: pages.map((columns, index) => ({
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
      nota:
        `${anchorNote} Feriados não são considerados. ` +
        `Card verde = concluída; vermelho = vencida. Gerado em ${formatDate(today)}.`,
    })),
  };
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
      dueDate: task.dueDate,
      status: task.status,
      description: task.description,
    })),
    doneColumns: doneCode ? [doneCode] : [],
    doingColumns: doingCodes,
    // The Master's grid: six columns of six cards.
    perBucket: 6,
  });

  const pages = buildDeckColumns(report);
  const spec = buildSpec(product.name, report, pages, today);

  const dir = await mkdtemp(join(tmpdir(), "status-deck-"));
  try {
    const specPath = join(dir, "spec.json");
    const outPath = join(dir, "deck.pptx");
    await writeFile(specPath, JSON.stringify(spec), "utf8");

    // The generator resolves the Master as ../assets/template.pptx relative to
    // its own file, which is why the vendor directory keeps the skill's
    // scripts/ + assets/ shape instead of a flat folder.
    await run(PYTHON, [join(VENDOR, "scripts", "build_deck.py"), specPath, "-o", outPath], {
      cwd: VENDOR,
      timeout: 60_000,
    });

    const buffer = await readFile(outPath);
    const filename = `status-${product.code.toLowerCase()}-${today}.pptx`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // The deck is generated by an external process: when it fails, say so
    // instead of handing back a corrupt file the user only discovers in
    // PowerPoint.
    console.error("falha ao gerar o deck de status", error);
    return new Response(
      "Não foi possível gerar o PowerPoint. Confira se o gerador e o template estão em " +
        "vendor/deck/ (veja o README de lá) e se o Python do projeto foi instalado " +
        "com npm run setup:pptx.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
