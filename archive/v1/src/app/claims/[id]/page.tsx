import Link from "next/link";
import { RouteShell } from "@/components/layout/route-shell";
import { ClaimContent } from "@/features/claims/claim-content";
export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><Link className="back-link" href="/claims">← All claims</Link><RouteShell title={`Claim ${id}`} eyebrow="CLAIM INVESTIGATION" description="Evidence, contractual treatment, and financial reconciliation in one view."><ClaimContent code={id}/></RouteShell></>;
}
