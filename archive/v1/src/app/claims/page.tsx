import { RouteShell } from "@/components/layout/route-shell";
import { ClaimRegister } from "@/features/claims/claim-register";
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <RouteShell title="Claims" eyebrow="VOYAGE FINANCE" description={q ? `Claim search: ${q}` : "Every claim, its supporting evidence, and its unresolved exposure."}><ClaimRegister search={q}/></RouteShell>;
}
