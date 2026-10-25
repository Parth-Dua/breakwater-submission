import{covers,intervalMinutes,type Interval}from'./intervals';
import type{DelaySegment,SourceEvidence}from'./charters';
export function resolveSourceSegments(interval:Interval,evidence:SourceEvidence[]){
 intervalMinutes(interval);for(const source of evidence)intervalMinutes(source);
 const verified=evidence.filter(source=>source.signed&&source.cause!=='UNKNOWN'&&source.startAt<interval.endAt&&source.endAt>interval.startAt),cuts=[...new Set([interval.startAt,interval.endAt,...verified.flatMap(source=>[Math.max(interval.startAt,source.startAt),Math.min(interval.endAt,source.endAt)])])].sort((a,b)=>a-b),segments:DelaySegment[]=[],conflicts:(Interval&{evidenceIds:string[]})[]=[];
 for(let i=0;i<cuts.length-1;i++){const window={startAt:cuts[i],endAt:cuts[i+1]},sources=verified.filter(source=>covers(source,window));if(!sources.length)continue;const causes=new Set(sources.map(source=>source.cause));if(causes.size>1){conflicts.push({...window,evidenceIds:sources.map(s=>s.id)});segments.push({...window,cause:'UNKNOWN',evidenceIds:[]});}else segments.push({...window,cause:sources[0].cause,evidenceIds:sources.map(source=>source.id)});}
 return{segments,conflicts};
}
