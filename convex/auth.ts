import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";

// Demo identity: every browser gets an anonymous account; the acting persona is chosen
// server-side in demoSessions (ARCHITECTURE §12). No passwords exist.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous],
});
