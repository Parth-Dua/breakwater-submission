import { v } from "convex/values";

export const role = v.union(v.literal("operations_reviewer"), v.literal("finance_controller"), v.literal("auditor"), v.literal("demo_admin"));
export const cause = v.union(v.literal("PORT_CLOSURE"), v.literal("CUSTOMS"), v.literal("BERTH"), v.literal("WEATHER"), v.literal("UNKNOWN"));
export const claimStatus = v.union(...["RECEIVED", "INVESTIGATING", "WAITING_OPERATIONS", "WAITING_CONTROLLER", "DISPUTE_PREPARED", "AWAITING_VENDOR_REVISION", "ACCEPTED", "POSTING_PENDING", "POSTED", "REOPENED", "ON_HOLD"].map(value => v.literal(value)));
export const scope = v.object({ claimType: v.literal("DELAY"), clauseFamilies: v.array(v.string()), requiresUnexplainedInterval: v.boolean(), archiveAccess: v.union(v.literal("NONE"), v.literal("SIGNED_OPS_LOG")) });
export const step = v.object({ op: v.union(...["FIND_EVIDENCE", "VERIFY_EVIDENCE", "MATCH_INTERVAL", "READ_CHARTER", "CLASSIFY_CAUSE", "CALCULATE_ELIGIBLE_MINUTES", "ESCALATE_IF_MISSING", "RECORD_FINDING"].map(value => v.literal(value))), type: v.optional(v.string()), repository: v.optional(v.string()), checks: v.optional(v.array(v.string())), target: v.optional(v.string()), field: v.optional(v.string()), source: v.optional(v.string()), role: v.optional(v.string()) });
export const details = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null(), v.array(v.string())));
export const testReport = v.object({ revision: v.number(), testedAt: v.number(), results: v.array(v.object({ fixtureId: v.string(), expected: v.string(), actual: v.string(), passed: v.boolean() })) });
export const toolOutcome = v.object({ tool: v.string(), arguments: v.string(), result: v.string(), status: v.string(), sourceIds: v.array(v.string()), at: v.number() });
export const finding = v.object({ cause, startAt: v.number(), endAt: v.number(), evidenceIds: v.array(v.id("evidence")), note: v.string(), unavailable: v.boolean() });

export const journalLine = v.object({accountCode:v.union(v.literal("VOYAGE_EXPENSE"),v.literal("ACCRUED_LIABILITY"),v.literal("ACCOUNTS_PAYABLE")),side:v.union(v.literal("DEBIT"),v.literal("CREDIT")),amountCents:v.number()});
