import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const { auth,signIn,signOut,store,isAuthenticated }=convexAuth({
  providers:[Password<DataModel>({profile(params){
    if(params.flow!=="signIn")throw new Error("Workspace accounts are provisioned by the project administrator");
    if(typeof params.email!=="string"||!params.email.includes("@"))throw new Error("Valid email required");
    const email=params.email.trim().toLowerCase();
    // Sign-in only retrieves the existing account. These profile defaults never grant authority.
    return {email,identity:`password:${email}`,role:"auditor",active:false,displayName:email};
  }})],
  callbacks:{async beforeSessionCreation(ctx,{userId}){
    const user=await (ctx as MutationCtx).db.get(userId);
    if(!user?.active)throw new Error("Account is not active");
  }},
});
