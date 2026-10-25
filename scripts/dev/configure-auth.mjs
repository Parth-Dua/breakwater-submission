// Sets the Convex Auth signing pair on the current deployment (local by default) if missing.
// Values are piped to the CLI and never printed.
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

function cli(args, input) {
  const result = spawnSync("node_modules/.bin/convex", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 60_000 });
  if (result.status !== 0) throw new Error(`convex ${args[0]} ${args[1] ?? ""} failed (exit ${result.status ?? "timeout"}); output suppressed`);
  return result.stdout;
}
const names = new Set(cli(["env", "list"]).split("\n").map(line => line.split("=")[0].trim()).filter(Boolean));
if (names.has("JWT_PRIVATE_KEY") && names.has("JWKS")) {
  console.log("Convex Auth signing pair already configured.");
} else if (names.has("JWT_PRIVATE_KEY") || names.has("JWKS")) {
  throw new Error("Incomplete signing configuration; remove JWT_PRIVATE_KEY/JWKS and rerun.");
} else {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  cli(["env", "set", "JWT_PRIVATE_KEY"], privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  cli(["env", "set", "JWKS"], JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), use: "sig", alg: "RS256" }] }));
  console.log("Convex Auth signing pair configured (values not printed).");
}
if (!names.has("SITE_URL")) { cli(["env", "set", "SITE_URL", "http://127.0.0.1:3000"]); console.log("SITE_URL set for local development."); }
