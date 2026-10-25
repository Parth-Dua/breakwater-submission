// CONTRACTS §5, §8 policy.ts — escalation routing and delegation, from the stored policy register. Pure.
export type PolicyCode = "AP_POSTING" | "ACCRUAL" | "RECOVERY_FILING" | "WAIVER" | "MATERIALITY" | "DEADLINE_FALLBACK" | "PRUDENCE" | "MEMORY_APPROVAL";
export type PolicySet = Partial<Record<PolicyCode, Record<string, unknown>>>;
export type Need = "FACT" | "PAYMENT" | "RECOVERY_FILING" | "WAIVER" | "MEMORY";
export type AskRoute = { required: boolean; role?: "ops" | "controller" | "trader"; policyCode: PolicyCode | null };

const DAY = 86_400_000;
const num = (policies: PolicySet, code: PolicyCode, key: string): number => {
  const value = policies[code]?.[key];
  if (typeof value !== "number") throw new Error(`Policy ${code}.${key} missing`);
  return value;
};

export type DelegationContext = { counterpartyStrategic?: boolean; openDisputeAboveMateriality?: boolean; currencyMismatch?: boolean; statementComplete?: boolean };

export function withinDelegation(action: "AP_POSTING" | "ACCRUAL" | "RECOVERY_FILING", cents: number, ctx: DelegationContext, policies: PolicySet): boolean {
  switch (action) {
    case "ACCRUAL": return Math.abs(cents) <= num(policies, "ACCRUAL", "maxCentsPerCase");
    case "AP_POSTING": return cents <= num(policies, "AP_POSTING", "maxCents") && ctx.statementComplete !== false && !ctx.openDisputeAboveMateriality && !ctx.currencyMismatch;
    case "RECOVERY_FILING": return cents <= num(policies, "RECOVERY_FILING", "maxCents") && !ctx.counterpartyStrategic;
  }
}

/** Which role must be asked (CONTRACTS §8). The agent cannot choose a different role: gateway.createAsk re-checks this. */
export function routeAsk(input: { need: Need; amountCents?: number; ctx?: DelegationContext; policies: PolicySet }): AskRoute {
  const { need, amountCents = 0, ctx = {}, policies } = input;
  switch (need) {
    case "FACT": return { required: true, role: "ops", policyCode: null };
    case "PAYMENT": return withinDelegation("AP_POSTING", amountCents, ctx, policies) ? { required: false, policyCode: "AP_POSTING" } : { required: true, role: "controller", policyCode: "AP_POSTING" };
    case "RECOVERY_FILING": return withinDelegation("RECOVERY_FILING", amountCents, ctx, policies) ? { required: false, policyCode: "RECOVERY_FILING" } : { required: true, role: "trader", policyCode: "RECOVERY_FILING" };
    case "WAIVER": return { required: true, role: "trader", policyCode: "WAIVER" };
    case "MEMORY": return { required: true, role: "controller", policyCode: "MEMORY_APPROVAL" };
  }
}

export function belowMateriality(cents: number, policies: PolicySet): boolean {
  return Math.abs(cents) < num(policies, "MATERIALITY", "thresholdCents");
}

/** REQ-AGT-07: a recovery ask is unanswered and the time bar is under N days away → file a protective claim. */
export function deadlineFallbackDue(ask: { kind: string; status: string }, simNow: number, timeBarAt: number, policies: PolicySet): boolean {
  return ask.kind === "COMMERCIAL_DECISION" && ask.status === "OPEN" && timeBarAt - simNow < num(policies, "DEADLINE_FALLBACK", "daysBeforeTimeBar") * DAY && timeBarAt > simNow;
}
