import type { EvidenceView } from "../../../convex/room";
import { EvidenceChip } from "@/components/ui/chip";

export function EvidenceLinks({ evidence, onEvidence }: { evidence: EvidenceView[]; onEvidence: (evidence: EvidenceView) => void }) {
  return <div className="flex flex-wrap gap-1.5">{evidence.map((ref, index) => <EvidenceChip key={index} label={ref.label} onClick={() => onEvidence(ref)} />)}</div>;
}
