import{AuditTrail}from"@/features/audit/AuditTrail";
import Link from "next/link";
import { ArrowUpRight, FileCheck2, ScanLine, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { OverviewQueue } from "@/features/overview/overview-queue";
import { OverviewStats } from "@/features/overview/overview-stats";
export default function OverviewPage() {
  return <><PageHeader eyebrow="CONTROL ROOM" title="Overview" description="A clear view of voyage exposure, evidence, and the work that needs your judgment." action={<Button asChild variant="primary"><Link href="/claims">Open claims <ArrowUpRight size={16} /></Link></Button>} />
    <div className="workspace-notice"><span className="notice-dot" /><span>SIMULATION WORKSPACE</span><p>All vessel, document, and accounting records are synthetic.</p></div>
    <OverviewStats/>
    <div className="overview-grid"><section className="panel"><OverviewQueue/><div className="panel-bottom-note"><ShieldCheck size={15} /> Financial actions require verified evidence and appropriate authority.</div></section>
    <section className="panel process-panel"><div className="panel-heading"><div><h2>From evidence to resolution</h2><p>Human judgment at the right moment</p></div></div><ol className="process-list"><li><span><ScanLine size={19} /></span><div><small>01 / INVESTIGATE</small><h3>Establish the facts</h3><p>Reconcile invoices, vessel movement, port notices, and effective charter terms.</p></div></li><li><span><FileCheck2 size={19} /></span><div><small>02 / REVIEW</small><h3>Resolve uncertainty</h3><p>Operations supplies missing facts. Controllers approve reusable procedures and exceptions.</p></div></li><li><span><ShieldCheck size={19} /></span><div><small>03 / RESOLVE</small><h3>Act within authority</h3><p>Record supported outcomes and balanced journals with a traceable approval basis.</p></div></li></ol></section></div>
    <section className="panel activity-panel"><div className="panel-heading"><div><h2>Latest activity</h2><p>Source-linked actions, findings, and approvals</p></div><Link className="text-link" href="/audit">Audit trail <ArrowUpRight size={15} /></Link></div><AuditTrail compact/></section>
  </>;
}
