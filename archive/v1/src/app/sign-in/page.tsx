"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
export default function SignInPage(){
  const {signIn}=useAuthActions(),router=useRouter();
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  return <><PageHeader title="Sign in" eyebrow="MERIDIAN WORKSPACE" description="Use your assigned workspace identity. Permissions are enforced on the server."/><section className="panel auth-panel"><form onSubmit={async event=>{
    event.preventDefault();setError("");setBusy(true);
    try{const data=new FormData(event.currentTarget);data.set("flow","signIn");await signIn("password",data);router.replace("/overview");}
    catch{setError("Sign-in failed. Check your assigned credentials and try again.");}finally{setBusy(false);}
  }}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required/><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required/>{error&&<p role="alert" className="form-error">{error}</p>}<Button type="submit" variant="primary" disabled={busy}>{busy?"Signing in…":"Sign in"}</Button><p className="muted">Accounts and password resets are managed by the project administrator.</p></form></section></>;
}
