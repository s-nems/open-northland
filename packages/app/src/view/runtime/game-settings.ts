import type { MenuSettings } from '../settings-store.js';

export interface GameSettingsRuntime {
  current(): MenuSettings;
  readonly pinnedUiScale: number | null;
  effectiveUiScaleFor(factor: number): number;
  readonly bootOwnedChangesDeferred: true;
  update(patch: Partial<MenuSettings>): Promise<boolean>;
}

export interface GameSettingsRuntimeDeps {
  readonly initial: MenuSettings;
  readonly pinnedUiScale: number | null;
  readonly effectiveUiScaleFor: (factor: number) => number;
  readonly persist: (patch: Partial<MenuSettings>) => void;
  readonly setUiScaleFactor: (factor: number) => Promise<boolean>;
  readonly setSoundEnabled: (enabled: boolean) => void;
  readonly setSfxVolume: (volume: number) => void;
  readonly setMusicVolume: (volume: number) => void;
  readonly setLanguage: (language: MenuSettings['language']) => void;
  readonly setDebugToolsEnabled: (enabled: boolean) => void;
}

/** An explicit session URL choice wins over the persisted sound preference. */
export function gameSoundEnabled(params: URLSearchParams, stored: boolean): boolean {
  const override = params.get('sound');
  return override === null ? stored : override !== 'off';
}

/** Serialize settings intents so a slow HUD rebuild cannot overwrite a later edit. */
export function createGameSettingsRuntime(deps: GameSettingsRuntimeDeps): GameSettingsRuntime {
  let current = deps.initial;
  let uiScaleTail = Promise.resolve();
  let revision = 0;
  const fieldRevisions = new Map<keyof MenuSettings, number>();
  const keysOf = (patch: Partial<MenuSettings>): (keyof MenuSettings)[] =>
    Object.keys(patch) as (keyof MenuSettings)[];
  const commit = (patch: Partial<MenuSettings>): void => {
    current = { ...current, ...patch };
    deps.persist(patch);
    if (patch.soundEnabled !== undefined) deps.setSoundEnabled(patch.soundEnabled);
    if (patch.soundVolume !== undefined) deps.setSfxVolume(patch.soundVolume);
    if (patch.musicVolume !== undefined) deps.setMusicVolume(patch.musicVolume);
    if (patch.language !== undefined) deps.setLanguage(patch.language);
    if (patch.debugToolsEnabled !== undefined) deps.setDebugToolsEnabled(patch.debugToolsEnabled);
  };
  return {
    current: () => current,
    pinnedUiScale: deps.pinnedUiScale,
    effectiveUiScaleFor: deps.effectiveUiScaleFor,
    bootOwnedChangesDeferred: true,
    update(patch): Promise<boolean> {
      const patchRevision = ++revision;
      const keys = keysOf(patch);
      const uiScaleFactor = patch.uiScaleFactor;
      if (uiScaleFactor === undefined) {
        for (const key of keys) fieldRevisions.set(key, patchRevision);
        commit(patch);
        return Promise.resolve(true);
      }
      const completion = uiScaleTail.then(async () => {
        let applied = false;
        try {
          applied = await deps.setUiScaleFactor(uiScaleFactor);
        } catch {
          return false;
        }
        if (!applied) return false;
        const currentPatch = Object.fromEntries(
          Object.entries(patch).filter(
            ([key]) =>
              key === 'uiScaleFactor' ||
              (fieldRevisions.get(key as keyof MenuSettings) ?? -1) <= patchRevision,
          ),
        ) as Partial<MenuSettings>;
        for (const key of keysOf(currentPatch)) fieldRevisions.set(key, patchRevision);
        commit(currentPatch);
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
