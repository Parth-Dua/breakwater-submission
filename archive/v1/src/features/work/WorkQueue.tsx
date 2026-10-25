"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { EmptyState, LoadingState, PermissionDenied, StatusText } from "@/components/ui/states";
import { Money } from "@/components/ui/money";
export function WorkQueue() {
  const { ready, isLoading } = useWorkspaceUser(), rows = useQuery(api.workItems.listForCurrentRole, ready ? {} : "skip");
  if (isLoading || (ready && rows === undefined)) return <LoadingState/>; if (!ready) return <PermissionDenied/>;
  if (!rows?.length) return <EmptyState title="No assigned reviews" description="Questions assigned to your role will appear here when human judgment is needed."/>;
  return <div className="table-scroll"><table><thead><tr><th>Review</th><th>Voyage / vessel</th><th>Assigned role</th><th>At risk</th><th>Status</th></tr></thead><tbody>{rows.map(({ work, voyageCode, vesselName, candidateCode }) => <tr key={work._id}><td><Link className="work-question-link" href={candidateCode?`/memory/${candidateCode}`:work.type==="CONTROLLER_FINANCIAL"?"/ledger":`/work/${work._id}`}>{work.type === "OPS_FACT" ? `Review delay cause — ${voyageCode}` : work.type.replaceAll("_", " ")}</Link><span className="cell-secondary work-question-preview">{work.question}</span></td><td>{voyageCode}<span className="cell-secondary">{vesselName}</span></td><td>{work.assignedRole.replaceAll("_", " ")}</td><td>{work.amountAtRiskCents === undefined ? "—" : <Money cents={work.amountAtRiskCents}/>}</td><td><StatusText tone={work.status === "SUBMITTED" ? "verified" : "unverified"}>{work.status.replaceAll("_", " ")}</StatusText></td></tr>)}</tbody></table></div>;
}
