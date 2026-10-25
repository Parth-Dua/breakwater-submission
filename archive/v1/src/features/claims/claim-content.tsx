"use client";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { EmptyState,LoadingState,PermissionDenied,StatusText } from "@/components/ui/states";
import { TimeMachine } from "@/features/voyage/TimeMachine";
export function ClaimContent({code}:{code:string}){
  const {ready,isLoading}=useWorkspaceUser(),detail=useQuery(api.claims.getDetail,ready?{code}:"skip");
  if(isLoading||(ready&&detail===undefined))return <LoadingState/>;
  if(!ready)return <PermissionDenied/>;
  if(!detail)return <EmptyState title="Claim not found" description="This claim record is not available in the current workspace."/>;
  return <><div className="detail-summary"><div><h2>{detail.vessel.name} · {detail.voyage.voyageCode}</h2><p className="muted">{detail.invoice.invoiceCode} · {detail.charter.charterCode} v{detail.charter.version} · Synthetic records</p></div><StatusText tone={detail.claim.unverifiedCents?"unverified":"verified"}>{detail.claim.status.replaceAll("_"," ")}</StatusText></div>
    <TimeMachine detail={detail}/>
  </>;
}
