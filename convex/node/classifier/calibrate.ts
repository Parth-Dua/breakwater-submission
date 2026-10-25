"use node";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import calibration from "../../../fixtures/learning/calibration.json";
import type { LessonJson } from "../../../src/domain/learning-types";
import { getClassifier } from "./index";

export const run = internalAction({ args: {}, returns: v.any(), handler: async (ctx): Promise<{ provider: "jev"; model: string; total: number; correct: number }> => {
  const classifier = getClassifier();
  const rows = [];
  for (const item of calibration.items) {
    // Deliberate policy-payload negatives are classification input only, never activatable memory.
    const result = await classifier.classify(item.lesson as unknown as LessonJson);
    rows.push({ id: item.id, model: result.model, expected: item.expected, actual: { kind: result.kind.choice, scope: result.scope.choice, discretionary: result.discretionary.noul >= .70 }, correct: result.kind.choice === item.expected.kind && result.scope.choice === item.expected.scope && (result.discretionary.noul >= .70) === item.expected.discretionary });
  }
  const summary = { provider: classifier.id, model: [...new Set(rows.map(row => row.model))].join(", "), total: rows.length, correct: rows.filter(row => row.correct).length };
  await ctx.runMutation(internal.learning.saveCalibration, { ...summary, perItem: rows });
  return summary;
} });

export const probe = internalAction({ args:{index:v.number()}, returns:v.any(), handler:async(_ctx,{index})=>{
  if(!Number.isSafeInteger(index)||index<0||index>=calibration.items.length) throw Error("Invalid calibration index");
  const classifier=getClassifier();
  const lesson=calibration.items[index].lesson as unknown as LessonJson,started=Date.now(),result=await classifier.classify(lesson);
  return {transport:process.env.BREAKWATER_JEV_TRANSPORT??"typesafe",requestedModel:classifier.model,request:lesson,result,latencyMs:Date.now()-started,ranAt:new Date().toISOString()};
} });
