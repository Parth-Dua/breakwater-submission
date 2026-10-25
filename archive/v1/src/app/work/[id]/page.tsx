import { OperationsWorkbench } from "@/features/work/OperationsWorkbench";
export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OperationsWorkbench id={id}/>; }
