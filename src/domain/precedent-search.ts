import type { HistoricalCase, TraceDiff } from "./learning-types";
export function precedentSearch(diff: TraceDiff, formCode: string, history: HistoricalCase[]) {
  let corroborating = 0, contradicting = 0;
  if (diff.type === "VALUE_CORRECTION") for (const item of history.filter(item => item.formCode === formCode)) for (const edit of item.edits.filter(edit => edit.lineKind === diff.humanSide.lineKind && edit.from === diff.humanSide.from && edit.clause === (diff.humanSide.basis as { clause?: string } | undefined)?.clause)) {
    if (edit.to === diff.humanSide.to) corroborating++; else contradicting++;
  }
  if (diff.type === "MISSING_SOURCE") for (const item of history) for (const hold of item.holds) { if (hold.resolution === "VERIFIED" && item.records.some(record => record.kind === "RELEASE" && record.from <= hold.from && (record.to ?? 0) >= hold.to)) corroborating++; }
  return { corroborating, contradicting };
}
