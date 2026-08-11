import type { MenuSettings } from '../settings-store.js';

export type LiveGameSettings = Pick<
  MenuSettings,
  'uiScaleFactor' | 'soundEnabled' | 'soundVolume' | 'musicVolume'
>;

export interface GameSettingsRuntime {
  current(): LiveGameSettings;
  readonly pinnedUiScale: number | null;
  effectiveUiScaleFor(factor: number): number;
  update(patch: Partial<LiveGameSettings>): Promise<boolean>;
}

export interface GameSettingsRuntimeDeps {
  readonly initial: LiveGameSettings;
  readonly pinnedUiScale: number | null;
  readonly effectiveUiScaleFor: (factor: number) => number;
  readonly persist: (patch: Partial<LiveGameSettings>) => void;
  readonly setUiScaleFactor: (factor: number) => Promise<boolean>;
  readonly setSoundEnabled: (enabled: boolean) => void;
  readonly setSfxVolume: (volume: number) => void;
  readonly setMusicVolume: (volume: number) => void;
}

/** An explicit session URL choice wins over the persisted sound preference. */
export function gameSoundEnabled(params: URLSearchParams, stored: boolean): boolean {
  const override = params.get('sound');
  return override === null ? stored : override !== 'off';
}

/** Own the settings that can change an already-mounted game without a restart. */
export function createGameSettingsRuntime(deps: GameSettingsRuntimeDeps): GameSettingsRuntime {
  let current = deps.initial;
  let uiScaleTail = Promise.resolve();
  const commit = (patch: Partial<LiveGameSettings>): void => {
    current = { ...current, ...patch };
    deps.persist(patch);
    if (patch.soundEnabled !== undefined) deps.setSoundEnabled(patch.soundEnabled);
    if (patch.soundVolume !== undefined) deps.setSfxVolume(patch.soundVolume);
    if (patch.musicVolume !== undefined) deps.setMusicVolume(patch.musicVolume);
  };
  return {
    current: () => current,
    pinnedUiScale: deps.pinnedUiScale,
    effectiveUiScaleFor: deps.effectiveUiScaleFor,
    update(patch): Promise<boolean> {
      if (patch.uiScaleFactor === undefined) {
        commit(patch);
        return Promise.resolve(true);
      }
      const factor = patch.uiScaleFactor;
      const completion = uiScaleTail.then(async () => {
        let applied = false;
        try {
          applied = await deps.setUiScaleFactor(factor);
        } catch {
          return false;
        }
        if (!applied) return false;
        commit(patch);
        return true;
      });
      uiScaleTail = completion.then(
        () => undefined,
        () => undefined,
      );
      return completion;
    },
  };
}
