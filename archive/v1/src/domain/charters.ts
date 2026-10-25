import { covers,intervalMinutes,validateIntervals,type Interval } from "./intervals";
import { allocateClaimCents } from "./money";
import { assertReconciliation } from "./claims";
export type DelayCause="PORT_CLOSURE"|"CUSTOMS"|"BERTH"|"WEATHER"|"UNKNOWN";
export type CharterTerms={version:number;rateCentsPerDay:number;payableCauses:DelayCause[];excludedCauses:DelayCause[];effectiveFrom:number;effectiveTo:number};
export type SourceEvidence=Interval & {id:string;voyageId:string;type:"PORT_NOTICE"|"SIGNED_OPS_LOG";signed:boolean;cause:DelayCause};
export type DelaySegment=Interval & {cause:DelayCause;evidenceIds:string[]};
export function reconcileClaim(input:{voyageId:string;interval:Interval;claimedCents:number;expectedCharterVersion:number;charter:CharterTerms;segments:DelaySegment[];evidence:SourceEvidence[]}) {
  const totalMinutes=intervalMinutes(input.interval),{charter}=input;
  if(charter.version!==input.expectedCharterVersion || charter.version<1 || !Number.isInteger(charter.version))throw new Error("Wrong charter version");
  if(!Number.isSafeInteger(charter.effectiveFrom)||!Number.isSafeInteger(charter.effectiveTo)||charter.effectiveFrom>input.interval.startAt || charter.effectiveTo<input.interval.endAt || charter.effectiveFrom>=charter.effectiveTo)throw new Error("Charter not effective for voyage");
  if([...charter.payableCauses,...charter.excludedCauses].includes("UNKNOWN") || charter.payableCauses.some(cause=>charter.excludedCauses.includes(cause)))throw new Error("Ambiguous charter treatment");
  validateIntervals(input.segments);
  let supported=0,disputed=0;
  for(const segment of input.segments){
    if(!["PORT_CLOSURE","CUSTOMS","BERTH","WEATHER","UNKNOWN"].includes(segment.cause))throw new Error("Unknown cause type");
    if(!covers(input.interval,segment))throw new Error("Evidence interval outside claim");
    if(segment.cause==="UNKNOWN")continue;
    if(!segment.evidenceIds.length)throw new Error("Known cause requires evidence");
    for(const id of segment.evidenceIds){
      const source=input.evidence.find(item=>item.id===id);
      if(source)intervalMinutes(source);
      if(!source || !["PORT_NOTICE","SIGNED_OPS_LOG"].includes(source.type) || source.voyageId!==input.voyageId || !source.signed || source.cause!==segment.cause || !covers(source,segment))throw new Error("Invalid evidence reference, signature, voyage, cause or coverage");
      if(source.type==="PORT_NOTICE" && segment.cause!=="PORT_CLOSURE")throw new Error("Port notice cannot establish operational cause");
    }
    if(charter.payableCauses.includes(segment.cause))supported+=intervalMinutes(segment);
    else if(charter.excludedCauses.includes(segment.cause))disputed+=intervalMinutes(segment);
  }
  const minutes={supported,disputed,unverified:totalMinutes-supported-disputed};
  const result=allocateClaimCents(minutes,charter.rateCentsPerDay);
  if(result.claimedCents!==input.claimedCents)throw new Error("Invoice line differs from effective charter rate and minutes");
  assertReconciliation(result);
  return {...result,supportedMinutes:supported,disputedMinutes:disputed,unverifiedMinutes:minutes.unverified};
}
