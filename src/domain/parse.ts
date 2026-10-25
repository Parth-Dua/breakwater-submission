// Deterministic parsers for verified document quotes (REQ-SRC-02). Values used by the engines come from the quoted
// text itself, never from a model's paraphrase. Pure.
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "24 Oct 2026 06:00", "2 Nov 2026 07:00 UTC", "NOR tendered 24 Oct 2026 06:00 UTC." → UTC ms (text assumed UTC). */
export function parseUtcDateTime(text: string): number | null {
  const match = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]));
}

/** Every UTC date-time in a text, in order of appearance ("from 28 Oct 2026 12:00 UTC until 29 Oct 2026 12:00 UTC"). */
export function parseUtcDateTimes(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/\d{1,2}\s+[A-Za-z]{3}[a-z]*\s+\d{4}\s+\d{2}:\d{2}/g)) {
    const at = parseUtcDateTime(match[0]);
    if (at !== null) out.push(at);
  }
  return out;
}

/** "211.00 h", "-72.00 h" → minutes (whole). */
export function parseHoursToMinutes(text: string): number | null {
  const match = /(-?\d+(?:\.\d+)?)\s*h\b/.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]) * 60;
  return Number.isFinite(minutes) && Math.abs(minutes - Math.round(minutes)) < 1e-6 ? Math.round(minutes) : null;
}

/** "USD 139,150.00", "EUR 1,234.50", "$150" → { currency, cents }. */
export function parseMoney(text: string): { currency: "USD" | "EUR"; cents: number } | null {
  const match = /(USD|EUR|\$|€)\s*(-?[\d,]+(?:\.\d{1,2})?)/.exec(text);
  if (!match) return null;
  const currency = match[1] === "EUR" || match[1] === "€" ? "EUR" : "USD";
  const [whole, fraction = ""] = match[2].replace(/,/g, "").split(".");
  const cents = Number(whole) * 100 + Math.sign(Number(whole) || 1) * Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? { currency, cents } : null;
}

/** "24.10 20:00" (SOF local) → { day, month, hour, minute } or null. */
export function parseSofLocal(text: string): string | null {
  const match = /(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(text);
  return match ? `${match[1]}.${match[2]} ${match[3]}:${match[4]}` : null;
}
