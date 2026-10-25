import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-bg">
      <h1 className="section-title">Not found</h1>
      <Link className="text-[14px] text-agent" href="/">Back to Desk</Link>
    </main>
  );
}
