import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Explicit V10 delta: no SDK wrapper, agent prompt, tool definitions or money engines.
export const LEARNING_DELTAS = ["convex/agent/state.ts","convex/asks.ts","convex/gateway.ts","convex/schema.ts","convex/sim.ts","convex/node/documents.ts","src/documents/letters.ts","convex/node/lessons.ts","convex/node/classifier/index.ts","convex/node/classifier/jev.ts","convex/node/classifier/questions.ts","convex/node/classifier/calibrate.ts","src/domain/backtest.ts","src/domain/diff.ts","src/domain/learning-types.ts","src/domain/lesson.ts","src/domain/memory-gate.ts","src/domain/precedent-search.ts","src/domain/procedures.ts"];
export const LEARNING_SOURCES = [...LEARNING_DELTAS,"convex/lib/validators.ts","convex/sources/humanSearch.ts","convex/sources.ts","convex/human.ts","convex/work.ts","convex/learning.ts","convex/learningData.ts","convex/memory.ts","convex/filingDocuments.ts","convex/statements.ts","convex/session.ts","convex/demo.ts","convex/room.ts","src/features/work/OpsDesk.tsx","src/features/work/StatementEditor.tsx","src/features/work/RecoveryDecision.tsx","src/features/work/TeachBackCard.tsx","src/features/work/useWork.ts","src/features/room/Room.tsx","src/features/room/MemoryList.tsx","src/features/room/MemoryDetail.tsx","src/features/desk/ProofTab.tsx","src/lib/interactionOrigin.ts"];
export const learningHashes = () => Object.fromEntries(LEARNING_SOURCES.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")]));
export const LEARNING_REPORT = "fixtures/agent-transcripts/v10-learning-live.json";
export function savedLearningEvidence() {
  if (!existsSync(LEARNING_REPORT)) return null;
  const report = JSON.parse(readFileSync(LEARNING_REPORT,"utf8"));
  const kinds = ["AIS_UPDATE","ASK_ANSWERED","DEADLINE_CHECK","DOCUMENT_RECEIVED","FLEET_SCAN","MONTH_END","PORT_NOTICE"];
  const tasks: {kind:string;state:string;model:string}[] = report.storm?.tasks??[];
  const memory: {kind:string;status:string;approved:boolean;usedIn:string[];backtest?:{total:number;consistent:number}}[] = report.learning?.memories??[];
  const lessons: {model:string;origin:string;usage?:{tokensIn:number;tokensOut:number};classifier:{status:string;provider:string;model:string}[]}[] = report.learning?.lessons??[];
  const hashes=learningHashes();
  return report.phase==="V10"&&report.verified&&report.realProvider&&report.humanEvidence===false&&report.testProcedureSeed===false&&report.model==="claude-sonnet-5-5"&&Object.entries(hashes).every(([path,hash])=>report.sourceHashes?.[path]===hash)&&tasks.length>0&&tasks.every(task=>task.state==="SUCCEEDED"&&task.model===report.model)&&kinds.every(kind=>tasks.some(task=>task.kind===kind))&&lessons.length===3&&lessons.every(lesson=>lesson.model===report.model&&lesson.origin==="AUTOMATED_TEST"&&(lesson.usage?.tokensIn??0)>0&&(lesson.usage?.tokensOut??0)>0&&lesson.classifier.filter(call=>call.status==="OK"&&call.provider==="jev").length===1&&lesson.classifier.every(call=>call.status==="OK"||call.model==="not-called"))&&memory.some(item=>item.kind==="PROCEDURE"&&item.status==="ACTIVE"&&item.approved&&item.backtest?.consistent===6&&item.backtest.total===6&&item.usedIn.includes("DC-2026-0412"))&&memory.some(item=>item.kind==="FACT"&&item.status==="ACTIVE"&&item.approved)&&memory.some(item=>item.kind==="PRECEDENT"&&item.status==="PRECEDENT_ONLY"&&!item.approved)&&report.money?.oweCents===12_215_000&&report.money?.recoverCents===9_060_000&&report.money?.netCents===-3_155_000?report:null;
}
