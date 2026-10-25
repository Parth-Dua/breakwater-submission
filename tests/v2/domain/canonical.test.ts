import { describe, expect, test } from "vitest";
import { canonicalJson, chainHash, GENESIS_HASH } from "../../../src/domain/canonical";

describe("canonical JSON and chain hash", () => {
  test("key order does not change the canonical form", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }] })).toBe(canonicalJson({ a: [2, { c: "x", d: null }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: true })).toBe('{"b":true}');
  });
  test("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
  test("hash is deterministic, 64 hex chars, and sensitive to prevHash and content", () => {
    const one = chainHash(GENESIS_HASH, { seq: 1, type: "X" });
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(chainHash(GENESIS_HASH, { type: "X", seq: 1 })).toBe(one);
    expect(chainHash(one, { seq: 1, type: "X" })).not.toBe(one);
    expect(chainHash(GENESIS_HASH, { seq: 1, type: "Y" })).not.toBe(one);
  });
});
