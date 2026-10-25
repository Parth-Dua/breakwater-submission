"use node";
import type { ClassifierResult, LessonJson } from "../../../src/domain/learning-types";
import { ClassifierUnavailable, JevClassifier } from "./jev";
export interface ClassifierProvider { readonly id: "jev"; readonly model: string; classify(lesson: LessonJson): Promise<ClassifierResult> }
let cached: { transport:string; key:string; client:JevClassifier } | null = null;
export function getClassifier(): ClassifierProvider {
  const transport = process.env.BREAKWATER_JEV_TRANSPORT ?? "typesafe";
  if (transport !== "typesafe" && transport !== "openrouter") throw new ClassifierUnavailable("Unknown Jev transport");
  const apiKey = transport === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new ClassifierUnavailable(transport === "openrouter" ? "OPENROUTER_API_KEY is required for Jev" : "TYPESAFE_API_KEY is required for Jev");
  if (!cached || cached.transport !== transport || cached.key !== apiKey) cached = { transport, key:apiKey, client:new JevClassifier({ apiKey, transport }) };
  return cached.client;
}
