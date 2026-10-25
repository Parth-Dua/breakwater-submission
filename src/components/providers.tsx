"use client";

import { ConvexReactClient, useConvexAuth } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef, useState } from "react";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * Every browser gets an anonymous account; no sign-in page exists. Failed attempts retry with
 * bounded backoff, and a session lost after sign-in triggers a fresh anonymous sign-in.
 */
function AutoSignIn() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const inFlight = useRef(false);
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    if (isLoading || isAuthenticated || inFlight.current || failures > RETRY_DELAYS_MS.length) return;
    const delay = failures === 0 ? 0 : RETRY_DELAYS_MS[failures - 1];
    const timer = setTimeout(() => {
      inFlight.current = true;
      signIn("anonymous")
        .then(() => setFailures(0))
        .catch(() => setFailures(count => count + 1))
        .finally(() => { inFlight.current = false; });
    }, delay);
    return () => clearTimeout(timer);
  }, [isLoading, isAuthenticated, signIn, failures]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required.");
    return new ConvexReactClient(url);
  });
  return <ConvexAuthProvider client={client}><AutoSignIn />{children}</ConvexAuthProvider>;
}
