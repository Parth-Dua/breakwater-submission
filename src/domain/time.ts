// CONTRACTS §5 time.ts — DST-aware local ↔ UTC conversion. Pure, no I/O.
import { DateTime, IANAZone } from "luxon";

const MINUTE = 60_000;

/**
 * Converts a local wall-clock ISO time ("2026-10-25T02:30") in an IANA zone to UTC ms.
 * Ambiguous times (the repeated hour when DST ends) require `fold`: 0 = first occurrence, 1 = second.
 * Non-existent times (the skipped hour when DST starts) throw.
 */
export function localToUtc(localIso: string, ianaZone: string, opts: { fold?: 0 | 1 } = {}): number {
  if (!IANAZone.isValidZone(ianaZone)) throw new Error(`Unknown time zone ${ianaZone}`);
  const naive = DateTime.fromISO(localIso, { zone: "utc" });
  if (!naive.isValid) throw new Error(`Invalid local time ${localIso}`);
  const zone = IANAZone.create(ianaZone);
  const naiveMs = naive.toMillis();
  // Candidate instants: interpret the wall time with the offsets in force around it.
  const offsets = new Set([zone.offset(naiveMs - 3 * 3_600_000), zone.offset(naiveMs), zone.offset(naiveMs + 3 * 3_600_000)]);
  const candidates = [...offsets]
    .map(offsetMinutes => naiveMs - offsetMinutes * MINUTE)
    .filter(at => zone.offset(at) * MINUTE === naiveMs - at)
    .sort((a, b) => a - b);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) throw new Error(`Local time ${localIso} does not exist in ${ianaZone}`);
  if (unique.length === 1) return unique[0];
  if (opts.fold === undefined) throw new Error(`Local time ${localIso} is ambiguous in ${ianaZone}; fold required`);
  return opts.fold === 0 ? unique[0] : unique[unique.length - 1];
}

/** SOF-style local text "24.10 08:00" (dd.MM HH:mm) → ISO local "2026-10-24T08:00". */
export function sofTextToIso(localText: string, year: number): string {
  const match = /^(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(localText.trim());
  if (!match) throw new Error(`Unrecognised SOF time "${localText}"`);
  const [, day, month, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/** "02.11 07:00 CET" — for display next to document quotes only. */
export function utcToLocalText(at: number, ianaZone: string): string {
  const local = DateTime.fromMillis(at, { zone: ianaZone }).setLocale("en-GB");
  return `${local.toFormat("dd.LL HH:mm")} ${local.offsetNameShort}`;
}

/** Exact whole minutes between two UTC ms instants; throws on fractional minutes. */
export function minutesBetween(a: number, b: number): number {
  const diff = b - a;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || diff % MINUTE !== 0) throw new Error("Timestamps must be whole minutes apart");
  return diff / MINUTE;
}

/** UTC ms from "2026-10-24T18:00" (UTC). Convenience for world definitions. */
export function utc(isoWithoutZone: string): number {
  const dt = DateTime.fromISO(isoWithoutZone, { zone: "utc" });
  if (!dt.isValid) throw new Error(`Invalid UTC time ${isoWithoutZone}`);
  return dt.toMillis();
}
