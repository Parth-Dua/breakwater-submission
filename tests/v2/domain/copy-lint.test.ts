import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const LINTER = resolve("scripts/copy-lint.ts");
const TSX = resolve("node_modules/.bin/tsx");

/** Runs the linter with cwd = a temp project so path-scoped rules (shell SIM, Proof tab) apply to src/… paths. */
function lint(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "copy-lint-"));
  for (const [name, body] of Object.entries(files)) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), body); }
  const result = spawnSync(TSX, [LINTER, "src"], { cwd: root, encoding: "utf8" });
  const violations = result.stderr.split("\n").filter(line => line.includes("  ") && !line.startsWith("copy-lint:"));
  return { status: result.status, stderr: result.stderr, violations };
}
const one = (body: string, name = "src/a.tsx") => lint({ [name]: body });

describe("copy linter (UI §2)", () => {
  test("clean copy, the allowed presenter label and long exempt props pass", () => {
    const result = one(`export const A = () => <div><button>Approve $122,150</button><span>Reset demo</span><input placeholder="Search" label="${"x ".repeat(50)}" aria-label="${"y ".repeat(50)}" /><p>We can&apos;t file this claim until the controller&apos;s signed note is attached.</p></div>;`);
    expect(result.status, result.stderr).toBe(0);
  });
  test.each([
    ["AI-powered", "<p>AI-powered desk</p>"],
    ["seamless", "<p>It works seamlessly</p>"],
    ["leverag", "<p>We leverage data</p>"],
    ["workflow", "<p>Your workflow</p>"],
  ])("banned term on its own: %s", (term, jsx) => {
    const result = one(`export const B = () => ${jsx};`);
    expect(result.status).toBe(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatch(new RegExp(`banned term .*${term}`, "i"));
  });
  test("simulation words fail outside the Proof tab but pass inside it", () => {
    expect(one(`export const C = () => <span title="synthetic data">x</span>;`).violations[0]).toMatch(/banned outside Proof/);
    expect(one(`export const C = () => <p>Real vs simulated</p>;`, "src/features/desk/ProofTab.tsx").status).toBe(0);
  });
  test("long JSX text and {\"…\"} children fail the 80-char rule", () => {
    expect(one(`export const D = () => <p>${"word ".repeat(20)}</p>;`).violations[0]).toMatch(/literal > 80 chars/);
    expect(one(`export const E = () => <p>{"${"word ".repeat(20)}"}</p>;`).violations[0]).toMatch(/literal > 80 chars/);
  });
  test("more than one SIM badge in the shell fails", () => {
    expect(one(`export const S = () => <span>SIM</span>;`, "src/components/shell/A.tsx").status).toBe(0);
    const result = lint({ "src/components/shell/A.tsx": `export const S = () => <span>SIM</span>;`, "src/components/shell/B.tsx": `export const T = () => <span>SIM</span>;` });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/more than one SIM badge/);
  });
});
