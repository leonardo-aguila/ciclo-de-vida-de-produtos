"use client";

import { Check, Copy, Download, FileText, Presentation } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { buildWrittenUpdate, type StatusReport } from "@/lib/engine/status-report";

/**
 * The two status exports: the deck and the written update.
 *
 * Both read the same report the table on screen is built from, so what gets
 * sent out cannot disagree with what the author just looked at.
 *
 * The written one opens in a dialog instead of downloading straight away: it
 * is a draft that needs the author's reading of why each item matters before
 * it goes to anyone, and a file that lands in Downloads is a file that gets
 * forwarded unread.
 */
export function StatusExport({
  productId,
  report,
  today,
}: {
  productId: string;
  report: StatusReport;
  today: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const text = React.useMemo(() => buildWrittenUpdate(report, today), [report, today]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, denied permission): the textarea
      // below is selectable, so there is still a way out.
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `status-${today}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="secondary" size="sm">
        {/* A plain link, not fetch + blob: the browser handles the download,
            the filename comes from the server, and it still works if the
            JavaScript on this page fails. */}
        <a href={`/api/produtos/${productId}/status-pptx`} download>
          <Presentation className="h-4 w-4" />
          PowerPoint
        </a>
      </Button>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm">
            <FileText className="h-4 w-4" />
            Status em texto
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Status em texto"
          description="Rascunho gerado a partir das entregas. Revise antes de enviar."
          className="w-[min(52rem,calc(100vw-2rem))]"
        >
          <div className="space-y-3 p-4">
            <label className="sr-only" htmlFor="status-texto">
              Texto do status
            </label>
            <textarea
              id="status-texto"
              readOnly
              value={text}
              rows={22}
              className="input w-full font-mono text-xs leading-relaxed"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={download}>
                <Download className="h-4 w-4" />
                Baixar .txt
              </Button>
              <p className="text-[11px] text-fg-muted">
                O impacto de cada item não é gerado — por que ele importa é leitura sua.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
