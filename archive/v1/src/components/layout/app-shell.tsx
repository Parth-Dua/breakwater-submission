"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexConnectionState } from "convex/react";
import { Anchor, ArrowUpRight, BookOpen, ClipboardList, Files, LayoutDashboard, Menu, Search, ShieldCheck, Waves, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspaceUser } from "@/lib/use-workspace-user";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
const navigation = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/claims", label: "Claims", icon: Files },
  { href: "/work", label: "Work Queue", icon: ClipboardList },
  { href: "/memory", label: "Institutional Memory", icon: BookOpen },
  { href: "/ledger", label: "Ledger", icon: BookOpen },
  { href: "/audit", label: "Audit Trail", icon: ShieldCheck },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const connection = useConvexConnectionState();
  const {user,isAuthenticated,isLoading}=useWorkspaceUser(),{signOut}=useAuthActions(),router=useRouter();
  const links=user?.active&&user.role==="demo_admin"?[...navigation,{href:"/scenarios",label:"Scenario Controls",icon:ShieldCheck}]:navigation;
  return <div className="app-shell" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    {open && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`} id="main-navigation" aria-label="Main navigation">
      <Link href="/overview" className="brand" aria-label="Breakwater overview" onClick={() => setOpen(false)}><span className="brand-icon"><Waves size={26} /></span><span>BREAKWATER<small>VOYAGE INTELLIGENCE</small></span></Link>
      <p className="nav-section-label">WORKSPACE</p><nav>{links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return <Link href={href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} key={href} onClick={() => setOpen(false)}><Icon size={18} strokeWidth={1.6} /><span>{label}</span>{active && <span className="nav-active-marker" />}</Link>;
      })}</nav>
      <div className="sidebar-bottom"><div className="simulation-note"><Anchor size={18} /><div>Synthetic workspace<small>No real funds move.</small></div></div><div className="sidebar-version">MERIDIAN COMMODITIES <span>BW / 01</span></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="topbar-company"><Button size="icon" variant="ghost" className="mobile-menu" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</Button><span className="company-mark">M<span>↗</span></span><span className="company-name">Meridian Commodities</span><span className="simulation-badge">SIMULATION</span></div><div className="topbar-actions"><form action="/claims" className="global-search"><Search size={15} /><input type="search" name="q" aria-label="Search claims" placeholder="Search claims…" /></form><span className={`connection-state ${connection.isWebSocketConnected ? "connected" : ""}`} title="Convex realtime connection"><i />{connection.isWebSocketConnected ? "Live" : connection.hasEverConnected ? "Reconnecting" : "Connecting"}</span><div className="identity-label">{isLoading?"Checking identity…":isAuthenticated?<><span className="identity-name">{user?.displayName??"Loading identity"}<small>{user?.role.replaceAll("_"," ")}</small></span><button className="sign-out" onClick={async()=>{await signOut();router.replace("/sign-in");}}>Sign out</button></>:<Link href="/sign-in">Sign in</Link>}</div></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span><ShieldCheck size={13} /> Evidence-led decisions · Controlled authority</span><Link href="/audit">View audit trail <ArrowUpRight size={13} /></Link></footer>
    </div>
  </div>;
}
