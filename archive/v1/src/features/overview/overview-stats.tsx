"use client";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { Stat } from "@/components/ui/stat";
import { Money } from "@/components/ui/money";
export function OverviewStats(){
  const {ready}=useWorkspaceUser(),claims=useQuery(api.claims.list,ready?{}:"skip");
  const sum=(key:"claimedCents"|"unverifiedCents"|"disputedCents")=>claims?.filter(claim=>claim.status!=="POSTED").reduce((total,claim)=>total+claim[key],0);
  const amount=(key:"claimedCents"|"unverifiedCents"|"disputedCents")=>claims?<Money cents={sum(key)!}/>:"—";
  return <div className="stat-grid"><Stat label="Open exposure" value={amount("claimedCents")} detail={claims?`${claims.filter(claim=>claim.status!=="POSTED").length} open claims`:"Sign in to load claims"}/><Stat label="Unverified amount" value={amount("unverifiedCents")} detail="Cause or evidence unresolved" tone="unverified"/><Stat label="Disputed amount" value={amount("disputedCents")} detail="Contract-backed exclusions" tone="disputed"/><Stat label="Claims in review" value={claims?claims.filter(claim=>["WAITING_OPERATIONS","WAITING_CONTROLLER"].includes(claim.status)).length:"—"} detail="Operations & Controller"/></div>;
}
