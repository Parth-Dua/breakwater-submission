// Display formats (docs_v2/UI.md §1.5). Formatting only: values always come from the backend.
export { formatUsd } from "@/domain/money";

const MINUS = "−";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "30 Oct 12:00" — UTC, without the "UTC" suffix (it appears once, in the top-bar clock). */
export function formatTime(at: number): string {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "9 Dec" */
export function formatDate(at: number): string {
  const d = new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Top-bar clock: "Sat 24 Oct 2026 · 00:00 UTC" */
export function formatClock(at: number): string {
  const d = new Date(at);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "122 h", "30 h 15 m" */
export function formatDuration(minutes: number): string {
  if (!Number.isSafeInteger(minutes)) throw new Error("Durations are integer minutes");
  const sign = minutes < 0 ? MINUS : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60), m = abs % 60;
  return m ? `${sign}${h} h ${pad(m)} m` : `${sign}${h} h`;
}

/** "24.0 nm" */
export function formatNm(nm: number): string {
  return `${nm.toFixed(1)} nm`;
}
