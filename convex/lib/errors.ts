import { ConvexError } from "convex/values";

// CONTRACTS §12
export type ErrorCode =
  | "NOT_PERMITTED" | "WRONG_ROLE" | "SOD_VIOLATION" | "PERIOD_LOCKED" | "UNBALANCED" | "DUPLICATE"
  | "OVER_DELEGATION" | "MISSING_EVIDENCE" | "QUOTE_NOT_FOUND" | "CAPABILITY_DENIED" | "STALE_VERSION"
  | "ASK_CLOSED" | "MODEL_UNAVAILABLE" | "CLASSIFIER_UNAVAILABLE";

export function fail(code: ErrorCode, message?: string): never {
  throw new ConvexError({ code, message: message ?? code });
}
