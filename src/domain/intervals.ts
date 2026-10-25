export type Interval = { startAt: number; endAt: number };
export function intervalMinutes(interval: Interval): number {
  const { startAt, endAt } = interval;
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || endAt <= startAt || (endAt - startAt) % 60_000 !== 0) throw new Error("Intervals require positive whole minutes and UTC millisecond timestamps");
  return (endAt - startAt) / 60_000;
}
export function validateIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a,b) => a.startAt - b.startAt);
  sorted.forEach((interval,index) => { intervalMinutes(interval); if (index && sorted[index-1].endAt > interval.startAt) throw new Error("Overlapping evidence intervals"); });
  return sorted;
}
export function covers(outer: Interval, inner: Interval): boolean { return outer.startAt <= inner.startAt && outer.endAt >= inner.endAt; }
