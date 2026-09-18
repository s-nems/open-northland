import { components, type FogMode, type FogSettings, fogModeOf, fogSettings } from '@open-northland/sim';

const { isFogMode } = components;

/** The map setting: `classic` starts black, `recon` knows the terrain from the start. */
export type MapModeName = 'classic' | 'recon';

export const MAP_MODES: readonly MapModeName[] = ['classic', 'recon'];

export function isMapMode(value: string): value is MapModeName {
  return MAP_MODES.some((mode) => mode === value);
}

/** A choice is requested when it differs from the last one requested, so a change the room has not
 *  acknowledged yet can still be taken back. */
export function ruleChoiceState<T>(choices: readonly T[], change: (value: T) => void) {
  let current: T | undefined;
  let requested: T | undefined;
  let disabled = true;
  return {
    update(value: T, frozen: boolean): void {
      current = value;
      requested = value;
      disabled = frozen;
    },
    value: () => current,
    request(value: T): void {
      if (disabled || !choices.includes(value) || value === requested) return;
      requested = value;
      change(value);
    },
  };
}

/** What the lobby starts a fog request from when the shown rule holds no settings (OFF, or the
 *  world's own): the original's classic map without fog of war. */
const FIRST_FOG_REQUEST: FogSettings = { terrainKnown: false, fogOfWar: false };

/**
 * The map and fog-of-war controls behind one fog rule: each request patches its own setting over the
 * request still pending, else over the shown rule. A view that does not acknowledge the pending
 * request leaves it pending, since a room view arrives for every change in the room, not only for a
 * settings acknowledgement.
 */
export function fogRuleComposer() {
  let shown: FogSettings | null = null;
  let requested: FogSettings | null = null;
  return {
    /** Adopt the rule a view shows; its settings, or null for OFF and the world's own rule. */
    show(fog: number | null): FogSettings | null {
      shown = fog !== null && isFogMode(fog) ? fogSettings(fog) : null;
      if (requested !== null && fog === fogModeOf(requested)) requested = null;
      return shown;
    },
    /** The mode the next request asks for. */
    request(patch: Partial<FogSettings>): FogMode {
      requested = { ...(requested ?? shown ?? FIRST_FOG_REQUEST), ...patch };
      return fogModeOf(requested);
    },
    /** The pending request was refused; the next one starts from the shown rule again. */
    reject(): void {
      requested = null;
    },
  };
}
