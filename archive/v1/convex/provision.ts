import { createAccount } from "@convex-dev/auth/server";
import { internalAction,internalMutation,internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { role } from "./validators";
import { DEFAULT_SCENARIO } from "../src/domain/fixtures";

export const findAccount=internalQuery({args:{email:v.string()},returns:v.union(v.null(),v.id("users")),handler:async(ctx,args)=>{
  const account=await ctx.db.query("authAccounts").withIndex("providerAndAccountId",q=>q.eq("provider","password").eq("providerAccountId",args.email)).unique();return account?.userId??null;
}});
export const activate=internalMutation({args:{userId:v.id("users"),role,displayName:v.string(),automationOnly:v.optional(v.boolean())},returns:v.null(),handler:async(ctx,args)=>{
  const user=await ctx.db.get(args.userId);if(!user)throw new Error("User not found");
  if(user.active&&user.role===args.role&&user.displayName===args.displayName&&!!user.automationOnly===!!args.automationOnly)return null;
  await ctx.db.patch(args.userId,{role:args.role,displayName:args.displayName,active:true,automationOnly:!!args.automationOnly});
  const scenario=await ctx.db.query("scenarioRuns").withIndex("by_code",q=>q.eq("scenarioCode",DEFAULT_SCENARIO)).unique();
  if(scenario)await ctx.db.insert("auditEvents",{scenarioId:scenario._id,synthetic:true,actor:"internal:administrator",eventType:"IDENTITY_PROVISIONED",entityType:"user",entityId:args.userId,correlationId:`provision:${args.userId}`,at:Date.now(),details:{role:args.role}});
  return null;
}});
export const automationAccount=internalAction({args:{},returns:v.object({configured:v.boolean()}),handler:async ctx=>{
  const raw=process.env.BREAKWATER_AUTOMATION_CREDENTIALS;if(!raw)throw new Error("Automation credentials not configured");
  const value=JSON.parse(raw) as {email:string;password:string;displayName:string};
  if(value.email!=="automation-operations@meridian.example"||typeof value.password!=="string"||value.password.length<20)throw new Error("Invalid automation identity");
  let userId=await ctx.runQuery(internal.provision.findAccount,{email:value.email});
  if(!userId){const result=await createAccount(ctx,{provider:"password",account:{id:value.email,secret:value.password},profile:{email:value.email,identity:`password:${value.email}`,role:"auditor",active:false,displayName:value.displayName},shouldLinkViaEmail:false,shouldLinkViaPhone:false});userId=result.user._id;}
  await ctx.runMutation(internal.provision.activate,{userId,role:"operations_reviewer",displayName:value.displayName,automationOnly:true});
  return {configured:true};
}});
export const accounts=internalAction({args:{},returns:v.object({count:v.number()}),handler:async ctx=>{
  const raw=process.env.BREAKWATER_DEMO_CREDENTIALS;if(!raw)throw new Error("Cloud demo credentials are not configured");
  const entries:unknown=JSON.parse(raw);if(!Array.isArray(entries)||entries.length!==4)throw new Error("Four provisioned identities required");
  let count=0;
  for(const value of entries){
    if(!value||typeof value!=="object"||!("email" in value)||!("password" in value)||!("role" in value)||!("displayName" in value))throw new Error("Invalid account configuration");
    const {email,password,role:accountRole,displayName}=value;
    if(typeof email!=="string"||typeof password!=="string"||password.length<20||typeof displayName!=="string"||!["operations_reviewer","finance_controller","auditor","demo_admin"].includes(String(accountRole)))throw new Error("Invalid provisioned identity fields");
    const userRole=accountRole as "operations_reviewer"|"finance_controller"|"auditor"|"demo_admin";
    let userId=await ctx.runQuery(internal.provision.findAccount,{email});
    if(!userId){
      const created=await createAccount(ctx,{provider:"password",account:{id:email,secret:password},profile:{email,identity:`password:${email}`,role:"auditor",active:false,displayName},shouldLinkViaEmail:false,shouldLinkViaPhone:false});
      userId=created.user._id;
    }
    await ctx.runMutation(internal.provision.activate,{userId,role:userRole,displayName});count++;
  }
  return {count};
}});
export const automationControllerAccount=internalAction({args:{},returns:v.object({configured:v.boolean()}),handler:async ctx=>{
 const raw=process.env.BREAKWATER_AUTOMATION_CONTROLLER_CREDENTIALS;if(!raw)throw new Error('Automation Controller credentials unavailable');const value=JSON.parse(raw) as {email:string;password:string;displayName:string};if(value.email!=='automation-controller@meridian.example'||typeof value.password!=='string'||value.password.length<20)throw new Error('Invalid automation Controller identity');let userId=await ctx.runQuery(internal.provision.findAccount,{email:value.email});if(!userId){const result=await createAccount(ctx,{provider:'password',account:{id:value.email,secret:value.password},profile:{email:value.email,identity:`password:${value.email}`,role:'auditor',active:false,displayName:value.displayName},shouldLinkViaEmail:false,shouldLinkViaPhone:false});userId=result.user._id;}await ctx.runMutation(internal.provision.activate,{userId,role:'finance_controller',displayName:value.displayName,automationOnly:true});return{configured:true};
}});

export const automationAdminAccount=internalAction({args:{},returns:v.object({configured:v.boolean()}),handler:async ctx=>{
 const raw=process.env.BREAKWATER_AUTOMATION_ADMIN_CREDENTIALS;if(!raw)throw new Error('Automation Admin credentials unavailable');const value=JSON.parse(raw) as {email:string;password:string;displayName:string};if(value.email!=='automation-admin@meridian.example'||typeof value.password!=='string'||value.password.length<20)throw new Error('Invalid automation Admin identity');let userId=await ctx.runQuery(internal.provision.findAccount,{email:value.email});if(!userId){const result=await createAccount(ctx,{provider:'password',account:{id:value.email,secret:value.password},profile:{email:value.email,identity:`password:${value.email}`,role:'auditor',active:false,displayName:value.displayName},shouldLinkViaEmail:false,shouldLinkViaPhone:false});userId=result.user._id;}await ctx.runMutation(internal.provision.activate,{userId,role:'demo_admin',displayName:value.displayName,automationOnly:true});return{configured:true};
}});
