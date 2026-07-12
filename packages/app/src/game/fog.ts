import { FOG_MODE } from '@vinland/sim';

/**
 * Fog-of-war mode names — the app-facing vocabulary for the sim's `FOG_MODE` ids, shared by the
 * `?fog=` URL flag and a scene's `SceneDefinition.fog` field so the two spell modes identically:
 *
 *  - `off`    — no fog (the sim default; every scene/map that never opts in).
 *  - `reveal` — the original's behaviour: black start, explored ground stays fully visible forever.
 *  - `recon`  — terrain known from the start (grey), current vision visible, regresses to grey — the
 *               modern multiplayer courtesy mode (user decision 2026-07-11).
 *  - `full`   — classic RTS fog: black start, seen ground regresses to grey out of sight.
 */
export type FogModeName = 'off' | 'reveal' | 'recon' | 'full';

/** Mode name → the sim's `FOG_MODE` id. */
export const FOG_MODE_BY_NAME: Readonly<Record<FogModeName, number>> = {
  off: FOG_MODE.OFF,
  reveal: FOG_MODE.REVEAL,
  recon: FOG_MODE.RECON,
  full: FOG_MODE.FULL,
};

/**
 * The `?fog=` URL flag: the requested `FOG_MODE` id, or null when absent/unrecognized (the caller
 * then keeps its default — a scene's own `fog` field, or no fog). An explicit `?fog=off` DOES return
 * `FOG_MODE.OFF`, so the flag can also disable a scene's default fog.
 */
export function fogModeParam(params: URLSearchParams): number | null {
  const name = params.get('fog');
  if (name === null) return null;
  // Object.hasOwn, not `in`: `?fog=toString` matches the prototype chain and would index `undefined`.
  return Object.hasOwn(FOG_MODE_BY_NAME, name) ? FOG_MODE_BY_NAME[name as FogModeName] : null;
}
