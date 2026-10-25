import { convexTest } from "convex-test";
import schema from "../../convex/schema";
export const modules = import.meta.glob("../../convex/**/*.ts");
export function testBackend() { return convexTest(schema,modules); }
