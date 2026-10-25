# V03 — Documents and Systems of Record

**Status:** SOURCE PRESENT; VALIDATION NOT RUN · **Estimate:** 4 h · **Depends on:** V02
**Requirements:** REQ-SRC-01..03, WORLD §2, §10, ARCHITECTURE §11

## Objective
Real PDFs that look like they came from different companies, stored in Convex and reachable only through typed source tools.

## Sequence
1. Install `pdf-lib` and `pdfjs-dist`. Create 4 document templates per kind in `scripts/world/templates/` (letterheads, tables, stamps, signature lines; one "scanned" style: grey background, 0.6° rotation, stamp, embedded text layer). Fonts: embed standard fonts plus one monospace for the email printouts.
2. `scripts/world/generate-documents.ts`: deterministic PDFs for all WORLD §10 documents, plus history and scoreboard documents → `fixtures/documents/`. Include the injection line in the Nordhavn invoice footer.
3. `convex/node/documents.ts` (`"use node"`): `extractTextLayer(storageId)` with pdfjs. `convex/world/importDocuments.ts`: upload to storage and create `documents` rows with `textLayer`, `system`, `kind`, `vesselId`, `portId`.
4. Systems of record: `mailMessages`, `customsRecords`, `documents` linkage. The Kestrel customs release lives **only** in `customsRecords`/`DOC_STORE` with `system: CUSTOMS_PORTAL`, never in the mailbox.
5. Source query functions (internal, typed): `sources.mailbox.search`, `sources.docs.get`, `sources.customs.search`, `sources.ais.window`, `sources.contracts.terms`, `sources.ports.get`. Each takes a `Capability` and the case context and enforces scope (ARCHITECTURE §6). The human-facing equivalents (`sources.search` mutation for Ops) reuse them with role grants.
6. Tests: every WORLD fact has a verbatim quote present in its document's text layer (programmatic check against a quote table `fixtures/documents/quotes.json`); scope enforcement (S-06 groundwork); determinism of generated text layers.
7. Visual check: open each WORLD PDF and screenshot page 1 into `artifacts/v2/V03/`. Inspect: realistic, legible, varied.

## Required artifacts
`scripts/world/templates/**`, `scripts/world/generate-documents.ts`, `fixtures/documents/**`, `convex/node/documents.ts`, `convex/sources/*.ts`, `tests/v2/integration/sources.test.ts`.

## Acceptance
- [ ] All WORLD §10 PDFs exist, are deterministic, and contain the quoted facts.
- [ ] The customs release is unreachable without `CUSTOMS_PORTAL` capability (test).
- [ ] Document screenshots reviewed.
- [ ] `npm run gate -- V03` passes.
