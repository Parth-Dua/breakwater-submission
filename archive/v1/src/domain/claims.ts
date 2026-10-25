export type Reconciliation = { claimedCents: number; supportedCents: number; unverifiedCents: number; disputedCents: number };
export function assertReconciliation(value: Reconciliation): void {
  if (Object.values(value).some(amount => !Number.isSafeInteger(amount) || amount < 0)) throw new Error("Claim amounts must be nonnegative safe integer cents");
  if (value.claimedCents !== value.supportedCents + value.unverifiedCents + value.disputedCents) throw new Error("Claim partition does not balance");
}
export { centsForMinutes as lineCents } from "./money";
