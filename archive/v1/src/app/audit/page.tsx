import{RouteShell}from'@/components/layout/route-shell';
import{AuditTrail}from'@/features/audit/AuditTrail';
export default function AuditPage(){return <RouteShell title="Audit Trail" eyebrow="ACCOUNTABILITY" description="Trace each source, action, finding, approval, and financial posting."><AuditTrail/></RouteShell>;}
