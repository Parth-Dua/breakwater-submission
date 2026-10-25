"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { DataTable } from "@/components/ui/data-table";
import { Money } from "@/components/ui/money";
import { LoadingState,PermissionDenied,StatusText } from "@/components/ui/states";
import { formatUtc } from "@/lib/format";
export function ClaimRegister({search}:{search?:string}){
  const {ready,isLoading}=useWorkspaceUser();
  const rows=useQuery(api.claims.list,ready?{search}:"skip");
  if(isLoading||(ready&&rows===undefined))return <LoadingState label="Loading claims…"/>;
  if(!ready)return <PermissionDenied/>;
  return <DataTable rows={rows??[]} rowKey={row=>row.claimId} columns={[
    {key:"claim",label:"Claim",render:row=><Link className="text-link" href={`/claims/${row.claimCode}`}>{row.claimCode}</Link>},
    {key:"vessel",label:"Vessel / Voyage",render:row=><div>{row.vesselName}<small className="cell-secondary">{row.voyageCode}{row.heldOut?" · Held-out scenario":""}</small></div>},
    {key:"carrier",label:"Carrier",render:row=>row.carrier},
    ...(["claimedCents","supportedCents","unverifiedCents","disputedCents"] as const).map(key=>({key,label:key.replace("Cents","").replace(/^./,c=>c.toUpperCase()),numeric:true,render:(row:NonNullable<typeof rows>[number])=><Money cents={row[key]}/>})),
    {key:"status",label:"Status",render:row=><StatusText tone={row.unverifiedCents?"unverified":"neutral"}>{row.status.replaceAll("_"," ").toLowerCase()}</StatusText>},
    {key:"updated",label:"Updated",render:row=>formatUtc(row.updatedAt)},
  ]} empty="No claims match the current search."/>;
}
