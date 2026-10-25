// CONTRACTS §5 provenance.ts — what a "why?" answer may cite (REQ-AUD-02). Pure.
import type { EvidenceRef, StatementLine } from "./laytime";

export type ProvenanceGraph = { entity: { type: string; id: string; field?: string }; citations: EvidenceRef[]; facts: string[] };
export type ProvenanceData = { lines?: StatementLine[]; journal?: { evidence: EvidenceRef[]; memo: string; authority: string } };

const key = (ref: EvidenceRef) => JSON.stringify(ref);

export function buildProvenance(entity: { type: "STATEMENT_LINE" | "CASE_TOTAL" | "JOURNAL"; id: string; field?: string }, data: ProvenanceData): ProvenanceGraph {
  const citations = new Map<string, EvidenceRef>();
  const facts: string[] = [];
  const addLine = (line: StatementLine) => {
    for (const ref of line.evidence) citations.set(key(ref), ref);
    facts.push(`${line.note} (${line.countedMinutes} min)`);
  };
  if (entity.type === "STATEMENT_LINE") {
    const line = data.lines?.find(candidate => candidate.id === entity.id);
    if (line) addLine(line);
  } else if (entity.type === "CASE_TOTAL") {
    for (const line of data.lines ?? []) if (line.countedMinutes !== 0 || line.kind === "FEE" || line.kind === "TIME_ON_LAYTIME") addLine(line);
  } else if (data.journal) {
    for (const ref of data.journal.evidence) citations.set(key(ref), ref);
    facts.push(`${data.journal.memo} · ${data.journal.authority}`);
  }
  return { entity, citations: [...citations.values()], facts };
}

/** Citation check for model-phrased explanations: every citation must be in the graph. */
export function citationsAllowed(graph: ProvenanceGraph, citations: EvidenceRef[]): boolean {
  const allowed = new Set(graph.citations.map(key));
  return citations.every(ref => allowed.has(key(ref)));
}

/** Deterministic fallback sentence (ARCHITECTURE §10). */
export function templateExplanation(graph: ProvenanceGraph): string {
  return graph.facts.slice(0, 3).join(". ") + (graph.facts.length ? "." : "");
}
