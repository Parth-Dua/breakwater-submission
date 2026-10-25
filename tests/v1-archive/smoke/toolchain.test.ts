import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

describe("Phase 00 toolchain", () => {
  it("runs strict TypeScript and provides reproducible commands", () => {
    const config = JSON.parse(readFileSync("tsconfig.json", "utf8"));
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(config.compilerOptions.strict).toBe(true);
    for (const script of ["lint", "typecheck", "test", "build", "gate"]) expect(pkg.scripts[script]).toBeTruthy();
    expect(existsSync("convex/schema.ts")).toBe(true);
  });

  it("rejects unknown and multiple phase IDs instead of passing silently", () => {
    for (const args of [["99"], [], ["00", "01"]]) {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/gates.ts", ...args], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).status).toBe("FAIL");
    }
  });

  it("ignores local secrets while allowing the sanitized example", () => {
    const result = spawnSync("git", ["check-ignore", ".env.local"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const example = spawnSync("git", ["check-ignore", ".env.example"], { encoding: "utf8" });
    expect(example.status).toBe(1);
  });
});
