import { expect, test, afterEach, vi } from "vitest";
import { computeTraceDiff } from "../../../src/domain/diff";
import { decideMemory } from "../../../src/domain/memory-gate";
import { parseMemoryPayload, payloadConsistent, makeLesson, type LessonContext } from "../../../src/domain/lesson";
import { runBacktest } from "../../../src/domain/backtest";
import { generateHistory } from "../../../src/world/history";
import type { ClassifierResult, HistoricalCase, HumanEvent, LessonJson, Procedure, TraceDiff } from "../../../src/domain/learning-types";
import { JevClassifier } from "../../../convex/node/classifier/jev";
import { getClassifier } from "../../../convex/node/classifier";
import { QUESTIONS } from "../../../convex/node/classifier/questions";
import sample from "../../../fixtures/classifier/jev-response.sample.json";
import calibration from "../../../fixtures/learning/calibration.json";

const procedure: Procedure = { dslVersion: 2, trigger: { intervalKind: "CUSTOMS_HOLD", missingEvidence: "CUSTOMS_RELEASE", ports: "ALL" }, grants: [{ system: "CUSTOMS_PORTAL", scope: "CASE_VESSEL_AND_INTERVAL" }], steps: [{ op: "SEARCH_SOURCE", system: "CUSTOMS_PORTAL", match: { vessel: true, interval: true } }, { op: "VERIFY_DOCUMENT", checks: ["SAME_VESSEL","COVERS_INTERVAL","ISSUER_IS_AUTHORITY"] }, { op: "MARK_VERIFIED" }, { op: "ESCALATE_IF_MISSING", role: "ops" }] };
const baseDiff: TraceDiff = { type: "VALUE_CORRECTION", agentSide: { value: "HALF" }, humanSide: { lineKind: "PORT_CLOSURE", from: "HALF", to: "COUNT", basis: { clause: "8", note: "Already on demurrage" } }, provenanceEventIds: [], ignoredEventIds: [], humanEvidence: false };
const context: LessonContext = { diff: baseDiff, caseCode: "renamable", role: "controller", formCode: "EXAMPLE-CP", portCode: "BRSSZ", counterpartyCode: "EXAMPLE", history: { corroborating: 2, contradicting: 0 }, amountAtRiskCents: 1_200_000 };
const fact = makeLesson(context, { lesson_text: "Closures count in full once on demurrage", proposed_payload: { type: "CONTRACT_RULE_OVERRIDE", formCode: context.formCode, clause: "8", rule: "EXCEPTIONS_APPLY_ON_DEMURRAGE", value: false } });
afterEach(() => vi.unstubAllEnvs());

test("L-01: only submitted evidence's active link/open/search chain contributes; browsing and an unlinked earlier link are ignored", () => {
  const ref = { kind: "DOC" as const, documentId: "release" };
  const events: HumanEvent[] = [
    { id: "1", seq: 1, type: "SOURCE_SEARCHED", origin: "AUTOMATED_TEST", payload: { system: "MAILBOX", query: "noise", resultDocumentCodes: ["noise"] } },
    { id: "2", seq: 2, type: "DOCUMENT_OPENED", origin: "AUTOMATED_TEST", payload: { system: "MAILBOX", documentCode: "noise" } },
    { id: "3", seq: 3, type: "SOURCE_SEARCHED", origin: "AUTOMATED_TEST", payload: { system: "CUSTOMS_PORTAL", query: "vessel", resultDocumentCodes: ["release"] } },
    { id: "4", seq: 4, type: "DOCUMENT_OPENED", origin: "AUTOMATED_TEST", payload: { system: "CUSTOMS_PORTAL", documentKind: "CUSTOMS_RELEASE", documentCode: "release", searchSeq: 3 } },
    { id: "5", seq: 5, type: "EVIDENCE_LINKED", origin: "AUTOMATED_TEST", payload: { evidence: ref, linkedTo: "hold:1" } },
    { id: "6", seq: 6, type: "EVIDENCE_UNLINKED", origin: "AUTOMATED_TEST", payload: { evidence: ref } },
    { id: "7", seq: 7, type: "DOCUMENT_OPENED", origin: "AUTOMATED_TEST", payload: { system: "MAILBOX", documentCode: "noise" } },
    { id: "8", seq: 8, type: "EVIDENCE_LINKED", origin: "AUTOMATED_TEST", payload: { evidence: { documentId: "release", kind: "DOC" }, linkedTo: "hold:1" } },
    { id: "9", seq: 9, type: "ANSWER_SUBMITTED", origin: "AUTOMATED_TEST", payload: {} },
  ];
  const [diff] = computeTraceDiff({ agentOps: [{ op: "SEARCH", system: "MAILBOX" }], humanEvents: events, ask: { kind: "CONFIRM_FACT", role: "ops", subject: "CUSTOMS_HOLD", answer: { optionId: "CONFIRM", evidence: [ref] } } });
  expect(diff.type).toBe("MISSING_SOURCE"); expect(diff.provenanceEventIds).toEqual(["3","4","8","9"]); expect(diff.ignoredEventIds).toEqual(["1","2","5","6","7"]); expect(diff.humanEvidence).toBe(false);
  expect(diff.humanSide).toMatchObject({ system: "CUSTOMS_PORTAL", documentKind: "CUSTOMS_RELEASE", linkedTo: "hold:1" });
});

test("L-02: submitted line edits and commercial deviations produce their diff; unchanged confirmations produce no reusable lesson", () => {
  const event = { id: "edit", seq: 1, type: "LINE_EDITED", origin: "AUTOMATED_TEST", payload: { editId: "e1", lineId: "l1", lineKind: "PORT_CLOSURE", from: "HALF", to: "COUNT", basis: { clause: "8", note: "Already on demurrage" } } };
  const submitted = { id: "answer", seq: 2, type: "ANSWER_SUBMITTED", origin: "AUTOMATED_TEST", payload: {} };
  const [correction] = computeTraceDiff({ agentOps: [], humanEvents: [event, submitted], ask: { kind: "PAYMENT_APPROVAL", role: "controller", subject: "PAYMENT", answer: { optionId: "APPROVE", editIds: ["e1"] } } });
  expect(correction.type).toBe("VALUE_CORRECTION");
  expect(computeTraceDiff({ agentOps: [], humanEvents: [{ ...event, payload: { ...event.payload, to: "HALF" } }, submitted], ask: { kind: "PAYMENT_APPROVAL", role: "controller", subject: "PAYMENT", answer: { optionId: "APPROVE", editIds: ["e1"] } } })[0].type).toBe("CONFIRMATION");
  expect(computeTraceDiff({ agentOps: [], humanEvents: [submitted], ask: { kind: "COMMERCIAL_DECISION", role: "trader", subject: "RECOVERY", amountAtRiskCents: 9_360_000, answer: { optionId: "PARTIAL", amountCents: 9_060_000, reason: "Goodwill" } } })[0].type).toBe("COMMERCIAL_DECISION");
});

test("L-03: payloads cannot execute code, expand access, change a different clause/form or turn a demurrage proviso into unconditional COUNT", () => {
  expect(parseMemoryPayload({ type: "PROCEDURE", procedure })).toBeTruthy();
  expect(parseMemoryPayload({ type: "PROCEDURE", procedure: { ...procedure, code: "execute()" } })).toBeNull();
  expect(parseMemoryPayload({ type: "PROCEDURE", procedure: { ...procedure, grants: [{ system: "CUSTOMS_PORTAL", scope: "GLOBAL_READONLY" }] } })).toBeNull();
  expect(parseMemoryPayload({ type: "PROCEDURE", procedure: { ...procedure, steps: [{ op: "EXECUTE", code: "pay()" }] } })).toBeNull();
  expect(payloadConsistent(fact.proposed_payload, context)).toBe(true);
  expect(payloadConsistent({ type: "PROCEDURE", procedure }, context)).toBe(false);
  expect(payloadConsistent({ type: "CONTRACT_RULE_OVERRIDE", formCode: "OTHER", clause: "8", rule: "EXCEPTIONS_APPLY_ON_DEMURRAGE", value: false }, context)).toBe(false);
  expect(payloadConsistent({ type: "CONTRACT_RULE_OVERRIDE", formCode: context.formCode, clause: "8", rule: "TREATMENT", intervalKind: "PORT_CLOSURE", value: "COUNT" }, context)).toBe(false);
});

test("L-04/L-10: Jev contract fixture and curated calibration coverage", async () => {
  const client = new JevClassifier({ apiKey: "contract-test-only", fetch: async () => new Response(JSON.stringify(sample.response), { status: 200, headers: { "content-type": "application/json" } }) });
  expect(await client.classify(fact)).toMatchObject({ provider: "jev", kind: { choice: "FACT" } });
  expect(calibration.items).toHaveLength(40);
  expect(Object.fromEntries(["MISSING_SOURCE","VALUE_CORRECTION","COMMERCIAL_DECISION","POLICY_CHANGE"].map(kind => [kind,calibration.items.filter(item => item.category === kind).length]))).toEqual({ MISSING_SOURCE: 10, VALUE_CORRECTION: 14, COMMERCIAL_DECISION: 12, POLICY_CHANGE: 4 });
  for (const item of calibration.items) if (item.category === "POLICY_CHANGE") expect(parseMemoryPayload(item.lesson.proposed_payload)).toBeNull();
});

test("L-05: each memory gate branch, including confidence boundaries and financial/source-role approval requirements", async () => {
  const result: ClassifierResult = { provider: "jev", model: "contract-test", kind: { choice: "FACT", confidence: .84, probabilities: { FACT: .84 } }, scope: { choice: "CHARTER_FORM", confidence: .81, probabilities: { CHARTER_FORM: .81 } }, discretionary: { noul: .12 } };
  const gate = (r: ClassifierResult | null, l: LessonJson = fact) => decideMemory({ lesson: l, result: r, policies: {} });
  expect(gate(null).status).toBe("NEEDS_REVIEW");
  expect(gate({ ...result, discretionary: { noul: .70 } }).status).toBe("PRECEDENT_ONLY");
  expect(gate({ ...result, kind: { ...result.kind, choice: "PRECEDENT" } }).status).toBe("PRECEDENT_ONLY");
  expect(gate({ ...result, kind: { ...result.kind, choice: "POLICY_CHANGE" } }).status).toBe("REJECTED");
  expect(gate({ ...result, kind: { ...result.kind, confidence: .59 } }).status).toBe("NEEDS_REVIEW");
  expect(gate({ ...result, scope: { ...result.scope, confidence: .49 } }).status).toBe("NEEDS_REVIEW");
  expect(gate({ ...result, kind: { ...result.kind, confidence: .60 }, scope: { ...result.scope, confidence: .50 } }).status).toBe("PENDING_TEACHBACK");
  expect(gate(result, { ...fact, proposed_payload: { type: "PROCEDURE", procedure } }).requires).toEqual(["TEACH_BACK","BACKTEST","CONTROLLER"]);
  expect(gate(result, { ...fact, source: { ...fact.source, role: "ops" } }).requires).toEqual(["TEACH_BACK","CONTROLLER"]);
  expect(gate(result).requires).toEqual(["TEACH_BACK"]);
  expect(gate(result, { ...fact, financial_impact: false }).requires).toEqual(["TEACH_BACK"]);
});

test("L-07: history sources replay to 6/6 (four verified and two escalated); wrong-vessel evidence changes the result", () => {
  const history: HistoricalCase[] = generateHistory().map(item => ({ caseCode: item.caseCode, formCode: item.voyage.charterCode.split("/")[0], portCode: item.voyage.portCode, vesselId: item.voyage.vesselCode, holds: item.intervals.filter(i => i.kind === "CUSTOMS_HOLD").map(i => ({ from: i.startAt, to: i.endAt, resolution: item.outcome.customsResolution! })), records: item.customs.map(record => ({ kind: record.kind, from: record.startAt, ...(record.endAt ? { to: record.endAt } : {}), vesselId: record.vesselCode, documentCode: record.documentCode, authority: true })), edits: item.edits.map(edit => ({ lineKind: edit.lineKind, from: edit.from, to: edit.to, clause: edit.clause, note: edit.note })) }));
  const report = runBacktest(procedure, history); expect(report.total).toBe(6); expect(report.consistent).toBe(6); expect(report.cases.filter(row => row.procedureOutcome === "VERIFIED")).toHaveLength(4);
  const valid = history.find(item => item.holds.some(hold => hold.resolution === "VERIFIED"))!;
  const altered = history.map(item => item === valid ? { ...item, records: item.records.map(record => ({ ...record, vesselId: "wrong-vessel" })) } : item);
  expect(runBacktest(procedure, altered).consistent).toBe(5);
});

test("L-09/T-23: installed Jev SDK request/response contract, exact questions and model pin; missing Jev never falls back", async () => {
  let request: Record<string, unknown> = {};
  const client = new JevClassifier({ apiKey: "contract-test-only", fetch: async (_url, init) => { request = JSON.parse(String(init?.body)); return new Response(JSON.stringify(sample.response), { status: 200, headers: { "content-type": "application/json", "x-typesafe-request-id": "contract-sample" } }); } });
  const result = await client.classify(fact); expect(result).toMatchObject({ provider: "jev", model: "jev-1.13.0", kind: { choice: "FACT", confidence: .84 }, scope: { choice: "CHARTER_FORM", confidence: .81 }, discretionary: { noul: .12 }, requestId: "contract-sample" });
  expect(request.model).toBe("jev-1.13.0"); expect(request.questions).toEqual(QUESTIONS);
  vi.stubEnv("BREAKWATER_JEV_TRANSPORT", "typesafe"); vi.stubEnv("TYPESAFE_API_KEY", ""); expect(() => getClassifier()).toThrow(/TYPESAFE_API_KEY/);
});

test("User OpenRouter route uses only its key, fixed System One endpoint and pinned Jev identifier",async()=>{
  let url="",request:Record<string,unknown>={},authorization="";
  const client=new JevClassifier({apiKey:"openrouter-contract-only",transport:"openrouter",fetch:async(input,init)=>{url=String(input);request=JSON.parse(String(init?.body));authorization=new Headers(init?.headers).get("authorization")??"";return new Response(JSON.stringify({...sample.response,model:"typesafe/jev-1.13"}),{status:200,headers:{"content-type":"application/json"}});}});
  expect((await client.classify(fact)).model).toBe("typesafe/jev-1.13");expect(url).toBe("https://openrouter.ai/api/v1/systemone");expect(request.model).toBe("typesafe/jev-1.13");expect(request.questions).toEqual(QUESTIONS);expect(authorization).toBe("Bearer openrouter-contract-only");
  vi.stubEnv("BREAKWATER_JEV_TRANSPORT","openrouter");vi.stubEnv("OPENROUTER_API_KEY","");vi.stubEnv("TYPESAFE_API_KEY","wrong-provider-key");expect(()=>getClassifier()).toThrow(/OPENROUTER_API_KEY/);
});
