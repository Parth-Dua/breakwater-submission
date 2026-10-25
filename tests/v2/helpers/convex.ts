import { convexTest } from "convex-test";
import schema from "../../../convex/schema";

export const modules = import.meta.glob("../../../convex/**/*.ts");
export function testBackend() { return convexTest(schema, modules); }

/** Creates an auth user and returns an identity accepted by getAuthUserId ("userId|sessionId"). */
export async function anonymousIdentity(t: ReturnType<typeof testBackend>) {
  const userId = await t.run(ctx => ctx.db.insert("users", { isAnonymous: true }));
  return { userId, identity: { subject: `${userId}|test-session`, tokenIdentifier: `test|${userId}` } };
}
