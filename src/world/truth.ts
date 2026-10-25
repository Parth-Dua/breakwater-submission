// Ground-truth laytime statements for generated data (WORLD §7–8: "ground truth computed by the generator itself").
// Deliberately independent of src/domain/laytime.ts (the V05 engine): a plain minute-by-minute walk.
import type { ContractTerms, ExceptionKind, IntervalTruth, StatementLineTruth, StatementTruth, Treatment } from "./types";

const MINUTE = 60_000;
const EXCEPTIONS: ExceptionKind[] = ["PORT_CLOSURE", "WEATHER", "SHIFTING", "CUSTOMS_HOLD"];

/** Integer half-up rounding of minutes × ratePerHour / 60. */
export function proRata(minutes: number, ratePerHourCents: number): number {
  const numerator = BigInt(minutes) * BigInt(ratePerHourCents);
  return Number((numerator * 2n + 60n) / 120n);
}

export function truthStatement(input: {
  terms: ContractTerms; laytimeStartAt: number; completionAt: number;
  intervals: IntervalTruth[]; fees?: { label: string; cents: number }[];
}): StatementTruth {
  const { terms, laytimeStartAt, completionAt } = input;
  if (completionAt <= laytimeStartAt) throw new Error("completion must follow laytime start");
  const exceptions = input.intervals
    .filter(interval => (EXCEPTIONS as string[]).includes(interval.kind))
    .map(interval => ({ ...interval, kind: interval.kind as ExceptionKind, startAt: Math.max(interval.startAt, laytimeStartAt), endAt: Math.min(interval.endAt, completionAt) }))
    .filter(interval => interval.endAt > interval.startAt)
    .sort((a, b) => a.startAt - b.startAt);
  for (let index = 1; index < exceptions.length; index++) if (exceptions[index].startAt < exceptions[index - 1].endAt) throw new Error("overlapping intervals");

  const totalMinutes = (completionAt - laytimeStartAt) / MINUTE;
  const laytimeHalves = terms.laytimeMinutes * 2;
  let countedHalves = 0;
  let onDemurrageAt: number | undefined;
  const intervalHalves = exceptions.map(() => 0);
  const effective = (interval: { kind: keyof typeof terms.treatments; verified: boolean }): Treatment => {
    const rule = terms.treatments[interval.kind];
    return interval.verified || (rule.treatment === "COUNT" && !rule.requiresEvidence?.length) ? rule.treatment : "UNVERIFIED";
  };
  const appliedTreatment: Treatment[] = exceptions.map(effective);
  let pointer = 0;
  for (let minute = 0; minute < totalMinutes; minute++) {
    const at = laytimeStartAt + minute * MINUTE;
    if (onDemurrageAt === undefined && countedHalves >= laytimeHalves) onDemurrageAt = at;
    while (pointer < exceptions.length && exceptions[pointer].endAt <= at) pointer++;
    const current = pointer < exceptions.length && exceptions[pointer].startAt <= at ? pointer : -1;
    let weight = 2;
    if (current >= 0) {
      const interval = exceptions[current];
      let treatment: Treatment = effective(interval);
      const onDemurrage = onDemurrageAt !== undefined;
      if (onDemurrage && !terms.exceptionsApplyOnDemurrage && interval.verified && (interval.kind === "PORT_CLOSURE" || interval.kind === "WEATHER")) treatment = "COUNT";
      if (interval.startAt === at) appliedTreatment[current] = treatment; // reported treatment = at the interval's first minute
      weight = treatment === "COUNT" ? 2 : treatment === "HALF" ? 1 : 0;
      intervalHalves[current] += weight;
    }
    countedHalves += weight;
  }
  if (onDemurrageAt === undefined && countedHalves >= laytimeHalves) onDemurrageAt = completionAt;

  const counted = Math.floor(countedHalves / 2);
  const lines: StatementLineTruth[] = [{ kind: "TIME_ON_LAYTIME", startAt: laytimeStartAt, endAt: completionAt, minutes: totalMinutes, treatment: "COUNT", countedMinutes: totalMinutes }];
  exceptions.forEach((interval, index) => {
    const minutes = (interval.endAt - interval.startAt) / MINUTE;
    lines.push({ kind: interval.kind, startAt: interval.startAt, endAt: interval.endAt, minutes, treatment: appliedTreatment[index], countedMinutes: Math.floor(intervalHalves[index] / 2) - minutes, clause: terms.treatments[interval.kind].clause });
  });
  const demurrageMinutes = Math.max(0, counted - terms.laytimeMinutes);
  const demurrageCents = proRata(demurrageMinutes, terms.ratePerHourCents);
  lines.push({ kind: "LAYTIME_ALLOWED", minutes: terms.laytimeMinutes, treatment: "COUNT", countedMinutes: -terms.laytimeMinutes });
  const fees = input.fees ?? [];
  for (const fee of fees) lines.push({ kind: "FEE", minutes: 0, treatment: "COUNT", countedMinutes: 0, clause: fee.label });
  const feesCents = fees.reduce((sum, fee) => sum + fee.cents, 0);
  return {
    laytimeStartAt, completionAt, lines, countedMinutes: counted, laytimeMinutes: terms.laytimeMinutes, demurrageMinutes,
    demurrageCents, feesCents, totalCents: demurrageCents + feesCents, onDemurrageAt,
  };
}
