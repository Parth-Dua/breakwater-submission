// CONTRACTS §5 nor.ts — Notice of Readiness validity against port limits. Pure.
import { distanceToPolygonNm, pointInPolygon, type Polygon } from "./geo";
import type { ContractTerms } from "../world/types";

export type NorEvaluation = {
  valid: boolean;
  /** When the NOR takes effect: tender (in limits) or deemed on arrival; null if the vessel has not arrived. */
  effectiveAt: number | null;
  distanceNm: number;
  laytimeStartAt: number | null;
  reason: "IN_LIMITS" | "DEEMED_ON_ARRIVAL" | "NOT_ARRIVED";
};

export function evaluateNor(input: { tenderedAt: number; arrivalAt: number | null; positionAtTender: [number, number]; portLimits: Polygon; terms: ContractTerms }): NorEvaluation {
  const { tenderedAt, arrivalAt, positionAtTender, portLimits, terms } = input;
  const inLimits = pointInPolygon(positionAtTender, portLimits);
  const distanceNm = distanceToPolygonNm(positionAtTender, portLimits);
  const notice = terms.noticeMinutes * 60_000;
  if (inLimits && (arrivalAt === null || arrivalAt <= tenderedAt)) {
    return { valid: true, effectiveAt: tenderedAt, distanceNm: 0, laytimeStartAt: tenderedAt + notice, reason: "IN_LIMITS" };
  }
  if (arrivalAt !== null && terms.deemedNorOnArrival) {
    const effectiveAt = Math.max(arrivalAt, tenderedAt);
    return { valid: false, effectiveAt, distanceNm, laytimeStartAt: effectiveAt + notice, reason: "DEEMED_ON_ARRIVAL" };
  }
  return { valid: false, effectiveAt: null, distanceNm, laytimeStartAt: null, reason: "NOT_ARRIVED" };
}
