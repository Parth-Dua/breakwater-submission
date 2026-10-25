"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { DocumentView } from "../../../convex/room";
import { Button } from "@/components/ui/button";
import { InlineError, Skeleton } from "@/components/ui/feedback";
import { formatTime } from "@/lib/format";

function highlightQuote(container: HTMLElement, quote: string) {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  const spans = [...container.querySelectorAll("span")].filter(span => span.textContent?.trim());
  const target = normalize(quote), combined = normalize(spans.map(span => span.textContent).join(" "));
  const start = combined.indexOf(target); if (!target || start < 0) return;
  let cursor = 0;
  for (const span of spans) {
    const text = normalize(span.textContent ?? ""), end = cursor + text.length;
    if (end > start && cursor < start + target.length) { span.style.backgroundColor = "rgba(245,181,68,.45)"; span.setAttribute("data-quote-highlight", "true"); }
    cursor = end + 1;
  }
}

export function DocumentViewer({ document: doc, quote, initialPage = 1, onBack }: { document: DocumentView; quote?: string; initialPage?: number; onBack: () => void }) {
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), text = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [page, setPage] = useState(initialPage), [width, setWidth] = useState(700), [error, setError] = useState(false), [rendered, setRendered] = useState(false);
  useEffect(() => { if (!root.current) return; const observer = new ResizeObserver(entries => setWidth(Math.max(200, entries[0].contentRect.width - 32))); observer.observe(root.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (!doc.url) return;
    let cancelled = false, task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | null = null;
    void import("pdfjs-dist").then(async lib => {
      lib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      task = lib.getDocument({ url: doc.url!, enableXfa: false });
      const document = await task.promise;
      if (cancelled) { await task.destroy(); return; }
      setPdf(document);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [doc.url]);
  useEffect(() => {
    if (!pdf || !canvas.current || !text.current) return;
    let cancelled = false, render: { cancel: () => void } | null = null, layer: { cancel: () => void } | null = null;
    void import("pdfjs-dist").then(async lib => {
      const sheet = await pdf.getPage(Math.max(1, Math.min(page, pdf.numPages)));
      if (cancelled || !canvas.current || !text.current) return;
      const scale = Math.min(1.6, width / sheet.getViewport({ scale: 1 }).width), viewport = sheet.getViewport({ scale }), ratio = window.devicePixelRatio || 1;
      const surface = canvas.current, overlay = text.current;
      surface.width = Math.floor(viewport.width * ratio); surface.height = Math.floor(viewport.height * ratio); surface.style.width = `${viewport.width}px`; surface.style.height = `${viewport.height}px`;
      overlay.replaceChildren(); overlay.style.width = `${viewport.width}px`; overlay.style.height = `${viewport.height}px`; overlay.style.setProperty("--scale-factor", String(scale)); overlay.style.setProperty("--total-scale-factor", String(scale));
      render = sheet.render({ canvas: surface, canvasContext: surface.getContext("2d")!, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await (render as ReturnType<typeof sheet.render>).promise;
      if (cancelled) return;
      const content = await sheet.getTextContent();
      layer = new lib.TextLayer({ textContentSource: content, container: overlay, viewport });
      await (layer as InstanceType<typeof lib.TextLayer>).render();
      if (quote) highlightQuote(overlay, quote);
      if (!cancelled) setRendered(true);
    }).catch(error => { if (!cancelled && (error as Error).name !== "RenderingCancelledException") setError(true); });
    return () => { cancelled = true; render?.cancel(); layer?.cancel(); };
  }, [pdf, page, width, quote]);
  return <div className="flex h-full min-h-0 flex-col" data-testid="document-viewer" data-document={doc.code}>
    <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-3"><Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={14} />Map</Button><span className="min-w-0 flex-1 truncate text-[12px] font-medium">{doc.title}</span>{doc.receivedAt !== null && <span className="font-mono text-[12px] text-ink-2">{formatTime(doc.receivedAt)}</span>}</div>
    <div ref={root} className="min-h-0 flex-1 overflow-auto bg-surface-2 p-4">{error || !doc.url ? <InlineError message="Could not load document" /> : <>{!rendered && <Skeleton className="mx-auto h-72 w-full max-w-xl" />}<div className="relative mx-auto w-fit bg-white"><canvas ref={canvas} aria-label={doc.title} /><div ref={text} className="textLayer absolute inset-0" /></div></>}</div>
    {pdf && <div className="flex h-10 shrink-0 items-center justify-center gap-3 border-t border-border"><Button size="icon" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} /></Button><span className="font-mono text-[12px] text-ink-2">{page} / {pdf.numPages}</span><Button size="icon" variant="ghost" aria-label="Next page" disabled={page >= pdf.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={14} /></Button></div>}
  </div>;
}
