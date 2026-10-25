// pdfjs-dist ships no declaration for the worker module; it is imported only to register it in-process.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
