/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_state from "../agent/state.js";
import type * as agent_tools from "../agent/tools.js";
import type * as asks from "../asks.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as books from "../books.js";
import type * as demo from "../demo.js";
import type * as desk from "../desk.js";
import type * as explain from "../explain.js";
import type * as filingDocuments from "../filingDocuments.js";
import type * as gateway from "../gateway.js";
import type * as http from "../http.js";
import type * as human from "../human.js";
import type * as learning from "../learning.js";
import type * as learningData from "../learningData.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_clock from "../lib/clock.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_persona from "../lib/persona.js";
import type * as lib_validators from "../lib/validators.js";
import type * as memory from "../memory.js";
import type * as node_agent from "../node/agent.js";
import type * as node_classifier_calibrate from "../node/classifier/calibrate.js";
import type * as node_classifier_index from "../node/classifier/index.js";
import type * as node_classifier_jev from "../node/classifier/jev.js";
import type * as node_classifier_questions from "../node/classifier/questions.js";
import type * as node_claude from "../node/claude.js";
import type * as node_documents from "../node/documents.js";
import type * as node_explain from "../node/explain.js";
import type * as node_extract from "../node/extract.js";
import type * as node_lessons from "../node/lessons.js";
import type * as node_prompts_agent from "../node/prompts/agent.js";
import type * as node_tools_definitions from "../node/tools/definitions.js";
import type * as orchestrator from "../orchestrator.js";
import type * as proof from "../proof.js";
import type * as room from "../room.js";
import type * as score from "../score.js";
import type * as session from "../session.js";
import type * as sim from "../sim.js";
import type * as sources from "../sources.js";
import type * as sources_humanSearch from "../sources/humanSearch.js";
import type * as sources_read from "../sources/read.js";
import type * as statements from "../statements.js";
import type * as views_timeBar from "../views/timeBar.js";
import type * as work from "../work.js";
import type * as world_import from "../world/import.js";
import type * as world_importDocuments from "../world/importDocuments.js";
import type * as world_release from "../world/release.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/state": typeof agent_state;
  "agent/tools": typeof agent_tools;
  asks: typeof asks;
  audit: typeof audit;
  auth: typeof auth;
  books: typeof books;
  demo: typeof demo;
  desk: typeof desk;
  explain: typeof explain;
  filingDocuments: typeof filingDocuments;
  gateway: typeof gateway;
  http: typeof http;
  human: typeof human;
  learning: typeof learning;
  learningData: typeof learningData;
  "lib/audit": typeof lib_audit;
  "lib/clock": typeof lib_clock;
  "lib/errors": typeof lib_errors;
  "lib/persona": typeof lib_persona;
  "lib/validators": typeof lib_validators;
  memory: typeof memory;
  "node/agent": typeof node_agent;
  "node/classifier/calibrate": typeof node_classifier_calibrate;
  "node/classifier/index": typeof node_classifier_index;
  "node/classifier/jev": typeof node_classifier_jev;
  "node/classifier/questions": typeof node_classifier_questions;
  "node/claude": typeof node_claude;
  "node/documents": typeof node_documents;
  "node/explain": typeof node_explain;
  "node/extract": typeof node_extract;
  "node/lessons": typeof node_lessons;
  "node/prompts/agent": typeof node_prompts_agent;
  "node/tools/definitions": typeof node_tools_definitions;
  orchestrator: typeof orchestrator;
  proof: typeof proof;
  room: typeof room;
  score: typeof score;
  session: typeof session;
  sim: typeof sim;
  sources: typeof sources;
  "sources/humanSearch": typeof sources_humanSearch;
  "sources/read": typeof sources_read;
  statements: typeof statements;
  "views/timeBar": typeof views_timeBar;
  work: typeof work;
  "world/import": typeof world_import;
  "world/importDocuments": typeof world_importDocuments;
  "world/release": typeof world_release;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
