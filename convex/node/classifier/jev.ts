"use node";
import { TypeSafeClassifier, type ClassificationResponse } from "@langchain/typesafe";
import type { ClassifierProvider } from "./index";
import type { ClassifierResult, KindChoice, LessonJson, ScopeChoice } from "../../../src/domain/learning-types";
import { QUESTIONS } from "./questions";

export class ClassifierUnavailable extends Error { constructor(message: string) { super(message); this.name = "CLASSIFIER_UNAVAILABLE"; } }
const probability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
export function mapJevResponse(response: Pick<ClassificationResponse, "answers" | "model" | "requestId">): ClassifierResult {
  const kind = response.answers.kind, scope = response.answers.scope, discretionary = response.answers.discretionary;
  if (kind?.type !== "choice" || scope?.type !== "choice" || discretionary?.type !== "noul" || !Object.keys(QUESTIONS.kind.criteria).includes(kind.choice) || !Object.keys(QUESTIONS.scope.criteria).includes(scope.choice) || ![kind.confidence, scope.confidence, discretionary.noul, ...Object.values(kind.probabilities), ...Object.values(scope.probabilities)].every(probability)) throw new ClassifierUnavailable("Invalid classifier response");
  return { kind: { choice: kind.choice as KindChoice, confidence: kind.confidence, probabilities: kind.probabilities }, scope: { choice: scope.choice as ScopeChoice, confidence: scope.confidence, probabilities: scope.probabilities }, discretionary: { noul: discretionary.noul }, provider: "jev", model: response.model, ...(response.requestId ? { requestId: response.requestId } : {}) };
}
/** Installed @langchain/typesafe 0.0.2: verified README and constructor types (model, timeout, fetch). */
export class JevClassifier implements ClassifierProvider {
  readonly id = "jev" as const; readonly model: string; private readonly client: TypeSafeClassifier;
  constructor(input: { apiKey: string; transport?: "typesafe"|"openrouter"; fetch?: typeof fetch }) {
    if (!input.apiKey) throw new ClassifierUnavailable("TYPESAFE_API_KEY is required");
    this.model = input.transport === "openrouter" ? "typesafe/jev-1.13" : "jev-1.13.0";
    this.client = new TypeSafeClassifier({ questions: QUESTIONS, apiKey: input.apiKey, model: this.model, baseUrl: input.transport === "openrouter" ? "https://openrouter.ai/api" : "https://api.typesafe.ai", dangerouslyAllowBrowser: false, timeout: 10_000, maxRetries: 2, ...(input.fetch ? { fetch: input.fetch } : {}) });
  }
  async classify(lesson: LessonJson): Promise<ClassifierResult> {
    try { return mapJevResponse(await this.client.invoke(JSON.parse(JSON.stringify(lesson)))); }
    catch { throw new ClassifierUnavailable("Jev classification unavailable"); }
  }
}
