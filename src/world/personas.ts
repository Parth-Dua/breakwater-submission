// Demo personas (WORLD §1.1). Shared by Convex functions and the UI.
export type Role = "agent" | "ops" | "controller" | "trader" | "observer";
export type PersonaCode = "AGENT" | "OBSERVER" | "OPS" | "CONTROLLER" | "TRADER";
export type SelectablePersonaCode = Exclude<PersonaCode, "AGENT">;

export type PersonaDefinition = { code: PersonaCode; displayName: string; role: Role; label: string };

export const PERSONAS: readonly PersonaDefinition[] = [
  { code: "AGENT", displayName: "Breakwater", role: "agent", label: "Breakwater" },
  { code: "OBSERVER", displayName: "Observer", role: "observer", label: "Observer" },
  { code: "OPS", displayName: "Dana Ruiz", role: "ops", label: "Dana Ruiz · Ops" },
  { code: "CONTROLLER", displayName: "Marcus Hale", role: "controller", label: "Marcus Hale · Controller" },
  { code: "TRADER", displayName: "Priya Shah", role: "trader", label: "Priya Shah · Trader" },
] as const;

export const SELECTABLE_PERSONA_CODES: readonly SelectablePersonaCode[] = ["OBSERVER", "OPS", "CONTROLLER", "TRADER"];

export const DEMO_NS = "demo";

export function personaDefinition(code: PersonaCode): PersonaDefinition {
  const found = PERSONAS.find(persona => persona.code === code);
  if (!found) throw new Error(`Unknown persona ${code}`);
  return found;
}
