// Copy linter (docs_v2/UI.md §2). Parses every .tsx under src/ with the TypeScript compiler and checks
// user-visible copy: JSX text and string-valued visible props. Fails the gate on any violation.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.argv[2] ?? "src";
const MAX_LITERAL = 80;
const VISIBLE_PROPS = new Set(["label", "title", "placeholder", "aria-label", "alt", "message", "actionLabel"]);
const LENGTH_EXEMPT_PROPS = new Set(["label", "title", "placeholder", "aria-label"]); // V01 step 6
// UI §2 rule 5 (anywhere) and rule 2 (outside the Proof tab).
const BANNED_EVERYWHERE = [/\bAI-powered\b/i, /\bintelligent\b/i, /\bseamless(ly)?\b/i, /\bleverag(e|es|ed|ing)\b/i, /\brobust\b/i, /\bmagic(al)?\b/i, /\bsimply\b/i, /\bplease note\b/i, /\bas an AI\b/i, /\bworkflows?\b/i, /\blorem ipsum\b/i];
const BANNED_OUTSIDE_PROOF = [/\bsynthetic\b/i, /\bsimulat(ed|ion)\b/i, /\bdemo\b/i, /\bfixtures?\b/i, /\bmock(ed|s)?\b/i];
// UI §3 explicitly names the presenter control "Reset demo" in the ⋯ menu; it is the one allowed use.
const ALLOWED_EXACT = new Set(["Reset demo"]);
const PROOF_FILES = [/src\/features\/desk\/ProofTab\.tsx$/];

type Violation = { file: string; line: number; rule: string; text: string };
const violations: Violation[] = [];
let simCount = 0;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(raw: string) {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) =>
    body[0] === "#" ? String.fromCodePoint(body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1))) : ENTITIES[body.toLowerCase()] ?? match);
}

function check(file: string, sf: ts.SourceFile, node: ts.Node, raw: string, opts: { lengthRule: boolean }) {
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!text || !/[A-Za-z]/.test(text)) return;
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const where = relative(".", file);
  if (opts.lengthRule && text.length > MAX_LITERAL) violations.push({ file: where, line, rule: `literal > ${MAX_LITERAL} chars`, text });
  if (ALLOWED_EXACT.has(text)) return;
  for (const pattern of BANNED_EVERYWHERE) if (pattern.test(text)) violations.push({ file: where, line, rule: `banned term ${pattern}`, text });
  if (!PROOF_FILES.some(pattern => pattern.test(where))) {
    for (const pattern of BANNED_OUTSIDE_PROOF) if (pattern.test(text)) violations.push({ file: where, line, rule: `banned outside Proof ${pattern}`, text });
  }
  if (/\bSIM\b/.test(text) && where.startsWith("src/components/shell")) simCount++;
}

for (const file of walk(ROOT)) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) check(file, sf, node, node.getText(sf), { lengthRule: true });
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (VISIBLE_PROPS.has(name)) {
        const init = node.initializer;
        const literal = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) ? init.expression : null;
        if (literal) check(file, sf, node, literal.text, { lengthRule: !LENGTH_EXEMPT_PROPS.has(name) });
      }
    }
    // String literals rendered directly as JSX children: {"…"}
    if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      check(file, sf, node, node.expression.text, { lengthRule: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (simCount > 1) violations.push({ file: "src/components/shell", line: 0, rule: "more than one SIM badge", text: `${simCount} occurrences` });

if (violations.length) {
  for (const v of violations) console.error(`${v.file}:${v.line}  ${v.rule}  "${v.text.slice(0, 120)}"`);
  console.error(`copy-lint: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log("copy-lint: OK");
