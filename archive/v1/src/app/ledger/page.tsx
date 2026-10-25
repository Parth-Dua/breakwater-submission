import { RouteShell } from "@/components/layout/route-shell";
import { LedgerView } from "@/features/finance/LedgerView";
export default function LedgerPage() { return <RouteShell title="Ledger" eyebrow="FINANCIAL CONTROL" description="Balanced journals, accruals, accounts payable, and accounting periods."><LedgerView/></RouteShell>; }
