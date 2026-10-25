import { Skeleton } from "@/components/ui/feedback";

export default function Loading() {
  return <div className="flex h-dvh flex-col gap-4 bg-bg p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-full w-full" /></div>;
}
