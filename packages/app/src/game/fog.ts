import { FOG_MODE } from '@open-northland/sim';

/**
 * Fog-of-war mode names — the app-facing vocabulary for the sim's `FOG_MODE` ids, shared by the
 * `?fog=` URL flag and a scene's `SceneDefinition.fog` field so the two spell modes identically:
 *
 *  - `off`    — no fog; the whole map and every entity stay visible.
 *  - `reveal` — the original's behaviour: black start, explored ground stays fully visible forever.
 *  - `recon`  — terrain known from the start (grey), with entities visible only in current vision.
 */
export type FogModeName = 'off' | 'reveal' | 'recon';

/** Mode name → the sim's `FOG_MODE` id. */
export const FOG_MODE_BY_NAME: Readonly<Record<FogModeName, number>> = {
  off: FOG_MODE.OFF,
  reveal: FOG_MODE.REVEAL,
  recon: FOG_MODE.RECON,
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
