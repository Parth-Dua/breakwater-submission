"use client";
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
/** Narrow screens are read-only (UI §3); authentication/authorization remain server-side. */
export function useDesktopActions() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
