"use client";
import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
export type WorkSurface = NonNullable<FunctionReturnType<typeof api.work.surface>>;
import { automation } from "@/lib/interactionOrigin";
export { automation } from "@/lib/interactionOrigin";
export function useStartWork(askCode: string) {
  const start = useMutation(api.work.start);
  useEffect(() => { void start({ askCode, ...automation() }).catch(() => { /* The surface's next write reports a stale/role change. */ }); }, [askCode, start]);
}
