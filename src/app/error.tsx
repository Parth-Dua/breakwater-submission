"use client";
import { InlineError } from "@/components/ui/feedback";

export default function Error({ reset }: { reset: () => void }) {
  return <main className="flex h-dvh items-center justify-center bg-bg"><InlineError message="Something went wrong" actionLabel="Retry" onAction={reset} /></main>;
}
