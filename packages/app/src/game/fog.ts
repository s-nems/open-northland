import { FOG_MODE, type FogMode } from '@open-northland/sim';

/**
 * Fog mode names - the app-facing vocabulary for the sim's `FOG_MODE` ids, shared by the `?fog=` URL
 * flag and a scene's `SceneDefinition.fog` field so the two spell modes identically. The lobby picks
 * one of the last four through its two settings, the map (`classic` starts black, `recon` knows the
 * terrain from the start) and fog of war (`-fow`: sight is lost where no eye stands):
 *
 *  - `off`         - no fog; the whole map and every entity stay visible. The debug menu's pick.
 *  - `classic`     - the original's behaviour: black start, explored ground stays fully visible forever.
 *  - `classic-fow` - black start; ground out of sight falls back to grey terrain with no entities.
 *  - `recon`       - terrain known from the start (grey); ground once seen stays fully visible.
 *  - `recon-fow`   - terrain known from the start; entities show only in current sight.
 */
export type FogModeName = 'off' | 'classic' | 'classic-fow' | 'recon' | 'recon-fow';

/** Mode name → the sim's `FOG_MODE` id. */
export const FOG_MODE_BY_NAME: Readonly<Record<FogModeName, FogMode>> = {
  off: FOG_MODE.OFF,
  classic: FOG_MODE.CLASSIC,
  'classic-fow': FOG_MODE.CLASSIC_FOG_OF_WAR,
  recon: FOG_MODE.RECON,
  'recon-fow': FOG_MODE.RECON_FOG_OF_WAR,
};

/**
 * The `?fog=` URL flag: the requested `FOG_MODE` id, or null when absent or unrecognized, which leaves
 * the caller's default. An explicit `?fog=off` returns `FOG_MODE.OFF`, disabling a scene's own fog.
 */
export function fogModeParam(params: URLSearchParams): FogMode | null {
  const name = params.get('fog');
  if (name === null) return null;
  // Object.hasOwn, not `in`: `?fog=toString` matches the prototype chain and would index `undefined`.
  return Object.hasOwn(FOG_MODE_BY_NAME, name) ? FOG_MODE_BY_NAME[name as FogModeName] : null;
}

/** `FOG_MODE` id → the name the URL spells it with; null for an id no name covers. */
export function fogModeName(mode: number): FogModeName | null {
  const names = Object.keys(FOG_MODE_BY_NAME) as FogModeName[];
  return names.find((name) => FOG_MODE_BY_NAME[name] === mode) ?? null;
}
