import {createHash} from "node:crypto";
import {existsSync,readFileSync} from "node:fs";
export const PROOF_SOURCES=["convex/schema.ts","convex/room.ts","convex/explain.ts","convex/node/explain.ts","convex/proof.ts","convex/score.ts","convex/sources/read.ts","src/domain/capabilities.ts","src/domain/score.ts","src/features/desk/ProofTab.tsx","src/features/room/MemoryDetail.tsx","convex/node/agent.ts","convex/agent/tools.ts"];
export const proofHashes=()=>Object.fromEntries(PROOF_SOURCES.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")]));
export const PROOF_REPORT="fixtures/agent-transcripts/v11-proof-live.json";
export function savedProofEvidence(){
 if(!existsSync(PROOF_REPORT)||!existsSync("fixtures/agent-transcripts/v11-score-live.json"))return null;
 const report=JSON.parse(readFileSync(PROOF_REPORT,"utf8")),score=JSON.parse(readFileSync("fixtures/agent-transcripts/v11-score-live.json","utf8"));
 return report.verified&&report.realProvider&&report.humanEvidence===false&&report.why?.some((row:{model:string;usage?:{tokensOut:number}})=>row.model==="claude-sonnet-5-5"&&(row.usage?.tokensOut??0)>0)&&report.chain?.ok&&report.classifierDetailsVisible===false&&Object.entries(proofHashes()).every(([path,hash])=>report.sourceHashes?.[path]===hash)&&score.verified&&score.realProvider&&score.result?.voyages===24&&score.result?.perVoyage?.length===24&&score.result?.metrics?.status==="COMPLETE"&&Object.entries(score.sourceHashes as Record<string,string>).every(([path,hash])=>existsSync(path)&&createHash("sha256").update(readFileSync(path)).digest("hex")===hash)?report:null;
}
