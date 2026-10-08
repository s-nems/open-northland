import type { VoiceCall } from './types.js';

/**
 * The player's "unit responses" choice: whether a settler's voice answers an order and a selection
 * (`all`), only a selection (`selection`, the player's "first selection only"), or neither (`off`). A
 * silenced call keeps its GUI click, so an order is still confirmed. Authored: the original always
 * answers; players of the genre ask for this switch.
 */
export type UnitResponses = 'all' | 'selection' | 'off';

/** The choices in the order a settings page lists them. */
export const UNIT_RESPONSE_MODES: readonly UnitResponses[] = ['all', 'selection', 'off'];

export const DEFAULT_UNIT_RESPONSES: UnitResponses = 'all';

/** What the player addressed: an order given, or a selection taken. */
export type ResponseKind = 'order' | 'selection';

/** Whether a settler's voice answers a call of `kind` under `mode`. */
export function responseSpeaks(mode: UnitResponses, kind: ResponseKind): boolean {
  switch (mode) {
    case 'all':
      return true;
    case 'selection':
      return kind === 'selection';
    case 'off':
      return false;
  }
}

/** `call` as `mode` lets it speak: unchanged, or with no member to speak so only its fallback cue plays. */
export function gateResponse<T extends VoiceCall>(call: T, mode: UnitResponses, kind: ResponseKind): T {
  return responseSpeaks(mode, kind) ? call : { ...call, members: [] };
}

/** A stored choice read back: a known mode, else the default. */
export function parseUnitResponses(value: unknown): UnitResponses {
  return UNIT_RESPONSE_MODES.find((mode) => mode === value) ?? DEFAULT_UNIT_RESPONSES;
}
