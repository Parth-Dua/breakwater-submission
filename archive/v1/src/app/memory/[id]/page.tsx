import{RouteShell}from'@/components/layout/route-shell';
import{ProcedureDetail}from'@/features/memory/ProcedureDetail';
export default async function MemoryDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <RouteShell title={`Memory ${id}`} eyebrow="PROVENANCE & AUTHORITY" description="Source observations, scope, tests, and approval history."><ProcedureDetail code={id}/></RouteShell>;}
