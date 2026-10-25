"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { automation } from "@/lib/interactionOrigin";
import { api } from "../../../convex/_generated/api";
import { useDesktopActions } from "@/lib/useDesktopActions";
import { Select } from "@/components/ui/select";
import { PERSONAS, SELECTABLE_PERSONA_CODES, type SelectablePersonaCode } from "@/world/personas";

const OPTIONS = SELECTABLE_PERSONA_CODES.map(code => PERSONAS.find(persona => persona.code === code)!);

/** Role toggle (UI §3, §6). The server resolves the acting persona; this only asks to switch. */
export function ActingAs() {
  const desktop = useDesktopActions();
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.session.me);
  const setActingAs = useMutation(api.session.setActingAs);
  const current = me?.persona.code === "AGENT" ? "OBSERVER" : (me?.persona.code ?? "OBSERVER");
  return (
    <label className="flex items-center gap-2">
      <span className="label whitespace-nowrap max-[1350px]:sr-only">Acting as</span>
      <Select
        className="max-[1023px]:max-w-28 max-[1023px]:text-[12px]"
        aria-label="Acting as"
        data-testid="acting-as"
        value={current}
        disabled={!desktop || !isAuthenticated || me === undefined}
        onChange={event => { void setActingAs({ code: event.target.value as SelectablePersonaCode, ...automation() }).catch(() => undefined); }}
      >
        {OPTIONS.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}
      </Select>
    </label>
  );
}
