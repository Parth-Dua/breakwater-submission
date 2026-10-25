import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// Source-bound Jev transport and calibration evidence.
export const JEV_TRANSPORT_SOURCES=["convex/node/classifier/index.ts","convex/node/classifier/jev.ts","convex/node/classifier/calibrate.ts","convex/learning.ts","convex/memory.ts","src/features/desk/ProofTab.tsx"];
export const jevHashes=()=>Object.fromEntries(JEV_TRANSPORT_SOURCES.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")]));
export const JEV_REPORT="fixtures/classifier/jev-openrouter-live.json";
export function savedJevEvidence(){
  if(!existsSync(JEV_REPORT))return null;
  const report=JSON.parse(readFileSync(JEV_REPORT,"utf8")),rows:{model:string;correct:boolean}[]=report.calibration?.perItem??[];
  return report.verified&&report.realProvider&&report.probe?.transport==="openrouter"&&report.probe.requestedModel==="typesafe/jev-1.13"&&report.probe.result?.provider==="jev"&&report.probe.result?.model?.startsWith("typesafe/jev-1.13-")&&report.probe.latencyMs>0&&report.calibration?.provider==="jev"&&report.calibration.total===40&&rows.length===40&&rows.every(row=>row.model===report.calibration.model)&&report.calibration.correct===rows.filter(row=>row.correct).length&&Object.entries(jevHashes()).every(([path,hash])=>report.sourceHashes?.[path]===hash)?report:null;
}
