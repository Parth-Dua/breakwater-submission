"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { DataTable } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";
import { EmptyState,LoadingState,StatusText } from "@/components/ui/states";
export function OverviewQueue(){
  const {ready,isLoading}=useWorkspaceUser(),claims=useQuery(api.claims.list,ready?{}:"skip");
  const rows=claims?.filter(claim=>claim.unverifiedCents+claim.disputedCents>0);
  return <><div className="panel-heading"><div><h2>Claims requiring attention</h2><p>Prioritized by unresolved financial exposure</p></div><StatusText>{rows?`${rows.length} unresolved`:"Identity required"}</StatusText></div>{isLoading||(ready&&!claims)?<LoadingState/>:!ready?<EmptyState title="Evidence is available to authorized identities" description="Sign in to review voyage exposure and source-linked claim records."/>:<DataTable rows={rows?.slice(0,5)??[]} rowKey={row=>row.claimId} columns={[
    {key:"claim",label:"Claim / Voyage",render:row=><Link className="text-link" href={`/claims/${row.claimCode}`}>{row.claimCode}<small>{row.voyageCode}</small></Link>},
    {key:"vessel",label:"Vessel",render:row=>row.vesselName},
    {key:"exposure",label:"Unresolved",numeric:true,render:row=><Money cents={row.unverifiedCents+row.disputedCents}/>},
  ]} empty="No unresolved claim exposure."/>}</>;
}
