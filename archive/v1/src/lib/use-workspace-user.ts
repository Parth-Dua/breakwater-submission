"use client";
import { useConvexAuth,useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
export function useWorkspaceUser(){
  const auth=useConvexAuth();
  const user=useQuery(api.users.current,auth.isAuthenticated?{}:"skip");
  return {...auth,user,ready:auth.isAuthenticated&&!!user?.active};
}
