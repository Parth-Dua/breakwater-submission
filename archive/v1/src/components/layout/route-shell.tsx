import { PageHeader } from "./page-header";
import { EmptyState } from "@/components/ui/states";
export function RouteShell({ title, eyebrow, description, emptyTitle, emptyDescription, children }: { title: string; eyebrow: string; description: string; emptyTitle?: string; emptyDescription?: string; children?: React.ReactNode }) {
  return <><PageHeader title={title} eyebrow={eyebrow} description={description} /><section className="panel">{children ?? <EmptyState title={emptyTitle} description={emptyDescription ?? "Records will appear here when they are available to your identity."} />}</section></>;
}
