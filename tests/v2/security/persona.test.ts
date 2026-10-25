import { describe, expect, test } from "vitest";
import { api } from "../../../convex/_generated/api";
import { requirePersona } from "../../../convex/lib/persona";
import { chainHash, GENESIS_HASH } from "../../../src/domain/canonical";
import { anonymousIdentity, modules, testBackend } from "../helpers/convex";

describe("persona sessions (V00)", () => {
  test("me defaults to Observer before and after sign-in", async () => {
    const t = testBackend();
    expect(await t.query(api.session.me, {})).toEqual({ persona: { code: "OBSERVER", displayName: "Observer", role: "observer" } });
    const { identity } = await anonymousIdentity(t);
    expect((await t.withIdentity(identity).query(api.session.me, {})).persona.code).toBe("OBSERVER");
  });

  test("unauthenticated callers cannot set a persona", async () => {
    const t = testBackend();
    await expect(t.mutation(api.session.setActingAs, { code: "OPS" })).rejects.toThrow(/NOT_PERMITTED/);
  });

  test("persona round trip: set → me → audited ACTING_AS_CHANGED, hash-chained", async () => {
    const t = testBackend();
    const { identity, userId } = await anonymousIdentity(t);
    const as = t.withIdentity(identity);
    expect(await as.mutation(api.session.setActingAs, { code: "OPS" })).toEqual({ code: "OPS", displayName: "Dana Ruiz", role: "ops" });
    expect((await as.query(api.session.me, {})).persona).toEqual({ code: "OPS", displayName: "Dana Ruiz", role: "ops" });
    await as.mutation(api.session.setActingAs, { code: "CONTROLLER" });
    await as.mutation(api.session.setActingAs, { code: "CONTROLLER" }); // no-op, not audited

    const events = await t.run(ctx => ctx.db.query("auditEvents").withIndex("by_ns_seq", q => q.eq("ns", "demo")).collect());
    expect(events.map(event => [event.seq, event.type, event.before, event.after, event.actor])).toEqual([
      [1, "ACTING_AS_CHANGED", { persona: "OBSERVER" }, { persona: "OPS" }, "persona:OBSERVER"],
      [2, "ACTING_AS_CHANGED", { persona: "OPS" }, { persona: "CONTROLLER" }, "persona:OPS"],
    ]);
    expect(events.every(event => event.entityId === userId && event.origin === "HUMAN")).toBe(true);
    // Chain integrity: each hash covers the event and the previous hash.
    let prev = GENESIS_HASH;
    for (const event of events) {
      const { _id, _creationTime, hash, ...body } = event;
      void _id; void _creationTime;
      expect(event.prevHash).toBe(prev);
      expect(hash).toBe(chainHash(prev, body));
      prev = hash;
    }
    const sessions = await t.run(ctx => ctx.db.query("demoSessions").collect());
    expect(sessions).toHaveLength(1);
  });

  test("personas are seeded once", async () => {
    const t = testBackend();
    const { identity } = await anonymousIdentity(t);
    await t.withIdentity(identity).mutation(api.session.setActingAs, { code: "TRADER" });
    await t.withIdentity(identity).mutation(api.session.setActingAs, { code: "OPS" });
    const personas = await t.run(ctx => ctx.db.query("personas").collect());
    expect(personas.map(persona => persona.code).sort()).toEqual(["AGENT", "CONTROLLER", "OBSERVER", "OPS", "TRADER"]);
  });
});

describe("S-01: roles are never accepted from arguments", () => {
  test("extra role argument is rejected by the validator", async () => {
    const t = testBackend();
    const { identity } = await anonymousIdentity(t);
    // @ts-expect-error role is not an accepted argument
    await expect(t.withIdentity(identity).mutation(api.session.setActingAs, { code: "OPS", role: "controller" })).rejects.toThrow();
  });
  test("the agent persona cannot be selected", async () => {
    const t = testBackend();
    const { identity } = await anonymousIdentity(t);
    // @ts-expect-error AGENT is not selectable
    await expect(t.withIdentity(identity).mutation(api.session.setActingAs, { code: "AGENT" })).rejects.toThrow();
  });
});

describe("S-02: Observer cannot mutate", () => {
  test("requirePersona denies Observer and wrong roles, allows the right role", async () => {
    const t = testBackend();
    const { identity } = await anonymousIdentity(t);
    const as = t.withIdentity(identity);
    await expect(as.run(ctx => requirePersona(ctx, ["ops"]))).rejects.toThrow(/NOT_PERMITTED/);
    await as.mutation(api.session.setActingAs, { code: "OBSERVER" });
    await expect(as.run(ctx => requirePersona(ctx, ["ops", "controller", "trader"]))).rejects.toThrow(/WRONG_ROLE/);
    await as.mutation(api.session.setActingAs, { code: "OPS" });
    await expect(as.run(ctx => requirePersona(ctx, ["controller"]))).rejects.toThrow(/WRONG_ROLE/);
    expect((await as.run(ctx => requirePersona(ctx, ["ops"]))).persona.code).toBe("OPS");
  });

  test("public mutations are the role toggle, presenter controls and guarded work endpoints", async () => {
    // Every later public mutation must call requirePersona and add itself to its own S-02 test.
    const publicMutations: string[] = [];
    for (const [path, load] of Object.entries(modules)) {
      if (path.includes("/_generated/")) continue;
      const mod = (await load()) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        const fn = value as { isMutation?: boolean; isPublic?: boolean } | null;
        if (fn && (typeof value === "function" || typeof value === "object") && fn.isMutation && fn.isPublic) publicMutations.push(`${path.replace(/^.*convex\//, "").replace(/\.ts$/, "")}:${name}`);
      }
    }
    // Presenter controls (UI §3: ⚡, let time pass, pacing) need a signed-in session and are audited, but are not
    // business actions; demo:reset is persona-guarded (Observer denied, tests/v2/integration/sim.test.ts).
    expect(publicMutations.sort()).toEqual(["asks:answer", "asks:linkEvidence", "asks:unlinkEvidence", "demo:reset", "memory:decide", "memory:revoke", "session:setActingAs", "sim:letTimePass", "sim:setPacing", "sim:startDisruption", "sources/humanSearch:openDocument", "sources/humanSearch:search", "sources:openDocument", "sources:search", "statements:editLine", "work:start"]);
  });
});


test("S-02 V09: every public work mutation denies Observer, including source aliases", async () => {
  const t = testBackend(), { identity } = await anonymousIdentity(t), as = t.withIdentity(identity);
  await as.mutation(api.session.setActingAs, { code: "OBSERVER" });
  const evidence = { kind: "DOC" as const, documentId: "not-a-document" };
  const attempts = [
    () => as.mutation(api.asks.answer, { askCode: "K-1", answer: { optionId: "CANT_FIND" }, automation: true }),
    () => as.mutation(api.asks.linkEvidence, { askCode: "K-1", evidence, automation: true }),
    () => as.mutation(api.asks.unlinkEvidence, { askCode: "K-1", evidence, automation: true }),
    () => as.mutation(api.memory.decide, { memoryCode: "x", decision: "APPROVE", automation: true }),
    () => as.mutation(api.memory.revoke, { memoryCode: "x", reason: "test", automation: true }),
    () => as.mutation(api.work.start, { askCode: "K-1", automation: true }),
    () => as.mutation(api.sources.search, { caseCode: "x", system: "CUSTOMS_PORTAL", query: "x", automation: true }),
    () => as.mutation(api.sources.openDocument, { caseCode: "x", documentCode: "x", automation: true }),
    () => as.mutation(api.sources.humanSearch.search, { caseCode: "x", system: "CUSTOMS_PORTAL", query: "x", automation: true }),
    () => as.mutation(api.sources.humanSearch.openDocument, { caseCode: "x", documentCode: "x", automation: true }),
    () => as.mutation(api.statements.editLine, { askCode: "A-2", lineId: "x", field: "treatment", to: "COUNT", basis: { clause: "8", note: "x" }, expectedVersion: 1, automation: true }),
  ];
  for (const attempt of attempts) await expect(attempt()).rejects.toThrow(/WRONG_ROLE/);
});
