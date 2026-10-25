// CONTRACTS §5 reconcile.ts — owner invoice vs our statement. Pure.
// Owners bill elapsed time from their own laytime start to their own completion, minus whatever they deducted.
// Variances: start, completion, each of our deductions the owner did not make, fees not in the CP, currency.
import { proRataCents } from "./money";
import type { StatementLine, StatementTotals } from "./laytime";

const MINUTE = 60_000;

export type ExtractedInvoice = {
  invoiceNo: string; currency: "USD" | "EUR";
  laytimeStartAt: number; completionAt: number;
  timeUsedMinutes: number; demurrageMinutes: number; demurrageCents: number;
  fees: { label: string; cents: number }[]; totalCents: number;
};
export type VarianceKind = "LAYTIME_START" | "COMPLETION_TIME" | "SHIFTING" | "PORT_CLOSURE" | "WEATHER" | "CUSTOMS_HOLD" | "FEE" | "CURRENCY" | "UNEXPLAINED";
export type Variance = { kind: VarianceKind; lineId?: string; minutes: number; cents: number; owner: string; ours: string; note: string };

export function reconcileInvoice(lines: StatementLine[], totals: StatementTotals, invoice: ExtractedInvoice, materialityCents: number, ratePerHourCents: number):
  { variances: Variance[]; acceptedBelowMateriality: Variance[]; payableCents: number; disputeCents: number } {
  const start = lines.find(line => line.kind === "TIME_ON_LAYTIME");
  if (!start?.startAt || !start.endAt) throw new Error("statement has no time on laytime");
  const variances: Variance[] = [];
  const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  const startDiff = (start.startAt - invoice.laytimeStartAt) / MINUTE;
  if (startDiff) variances.push({ kind: "LAYTIME_START", lineId: start.id, minutes: startDiff, cents: proRataCents(Math.abs(startDiff), ratePerHourCents) * Math.sign(startDiff), owner: at(invoice.laytimeStartAt), ours: at(start.startAt), note: startDiff > 0 ? "Laytime started early on owner's invoice" : "Laytime started late on owner's invoice" });
  const endDiff = (invoice.completionAt - start.endAt) / MINUTE;
  if (endDiff) variances.push({ kind: "COMPLETION_TIME", lineId: start.id, minutes: endDiff, cents: proRataCents(Math.abs(endDiff), ratePerHourCents) * Math.sign(endDiff), owner: at(invoice.completionAt), ours: at(start.endAt), note: endDiff > 0 ? "Completion time later on owner's invoice" : "Completion time earlier on owner's invoice" });

  // Owner deductions = owner elapsed − owner time used. Match them to a subset of our deduction lines; the rest are variances.
  const ownerElapsed = (invoice.completionAt - invoice.laytimeStartAt) / MINUTE;
  const ownerDeducted = ownerElapsed - invoice.timeUsedMinutes;
  const deductions = lines.filter(line => line.countedMinutes < 0 && line.kind !== "LAYTIME_ALLOWED");
  let matched: StatementLine[] | null = null;
  for (let mask = 0; mask < 1 << deductions.length && matched === null; mask++) {
    const subset = deductions.filter((_, index) => mask & (1 << index));
    if (subset.reduce((sum, line) => sum - line.countedMinutes, 0) === ownerDeducted) matched = subset;
  }
  if (matched === null) {
    const ours = deductions.reduce((sum, line) => sum - line.countedMinutes, 0);
    variances.push({ kind: "UNEXPLAINED", minutes: ours - ownerDeducted, cents: proRataCents(Math.abs(ours - ownerDeducted), ratePerHourCents), owner: `${ownerDeducted} min deducted`, ours: `${ours} min deducted`, note: "Owner deductions do not match our statement" });
  } else {
    for (const line of deductions.filter(line => !matched!.includes(line))) {
      variances.push({ kind: line.kind as VarianceKind, lineId: line.id, minutes: -line.countedMinutes, cents: proRataCents(-line.countedMinutes, ratePerHourCents), owner: "counted", ours: line.treatment.toLowerCase(), note: `${line.note}; owner counted it` });
    }
  }
  const acceptedBelowMateriality: Variance[] = [];
  let acceptedFees = 0;
  for (const fee of invoice.fees) {
    const variance: Variance = { kind: "FEE", minutes: 0, cents: fee.cents, owner: fee.label, ours: "not in charter party", note: `${fee.label} not in charter party` };
    if (fee.cents < materialityCents) { acceptedBelowMateriality.push(variance); acceptedFees += fee.cents; } else variances.push(variance);
  }
  if (invoice.currency !== "USD") variances.push({ kind: "CURRENCY", minutes: 0, cents: 0, owner: invoice.currency, ours: "USD", note: "Invoice currency differs from the charter party" });
  const payableCents = totals.demurrageCents + acceptedFees;
  return { variances, acceptedBelowMateriality, payableCents, disputeCents: Math.max(0, invoice.totalCents - payableCents) };
}
