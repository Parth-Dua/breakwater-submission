export const QUESTIONS = {
  kind: { type: "choice", instructions: "What kind of lesson is this for a demurrage desk?", criteria: { FACT: "A fact or contract interpretation that changes how a rule is applied", PROCEDURE: "A reusable investigation step: where to look or what to check", PRECEDENT: "A one-off decision tied to a specific situation or relationship", POLICY_CHANGE: "A change to authority, limits or approval rules" } },
  scope: { type: "choice", instructions: "How widely should this lesson apply?", criteria: { THIS_CASE: "Only this case", COUNTERPARTY: "All cases with this counterparty", PORT: "All cases at this port", CHARTER_FORM: "All voyages under this contract form", ALL: "All cases where the trigger occurs" } },
  discretionary: { type: "noul", instructions: "Is this a commercial judgment call rather than a rule that should be repeated?" },
} as const;
