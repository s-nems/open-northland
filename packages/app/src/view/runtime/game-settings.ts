import type { SoundBus } from '@open-northland/audio';
import type { WorldEnhancements } from '@open-northland/render';
import type { CameraInputSettings } from '../camera/index.js';
import { ENHANCEMENT_KEYS, enhancementsOf } from '../graphics-enhancements.js';
import type { MenuSettings } from '../settings-store.js';

export interface GameSettingsRuntime {
  current(): MenuSettings;
  readonly pinnedUiScale: number | null;
  effectiveUiScaleFor(factor: number): number;
  readonly bootOwnedChangesDeferred: true;
  update(patch: Partial<MenuSettings>): Promise<boolean>;
  /** Play the clip that previews a bus's slider; absent without a sound driver. */
  readonly previewBus?: (bus: SoundBus) => void;
}

export interface GameSettingsRuntimeDeps {
  readonly initial: MenuSettings;
  readonly pinnedUiScale: number | null;
  readonly effectiveUiScaleFor: (factor: number) => number;
  readonly persist: (patch: Partial<MenuSettings>) => void;
  readonly setUiScaleFactor: (factor: number) => Promise<boolean>;
  readonly setSoundEnabled: (enabled: boolean) => void;
  readonly setVolumes: (volumes: MenuSettings['volumes']) => void;
  readonly setSoundInBackground: (play: boolean) => void;
  readonly setMonoSound: (mono: boolean) => void;
  readonly setJinglesEnabled: (on: boolean) => void;
  readonly setUnitResponses: (mode: MenuSettings['unitResponses']) => void;
  readonly setLanguage: (language: MenuSettings['language']) => void;
  readonly setKeyBindings: (bindings: MenuSettings['keyBindings']) => void;
  readonly setCameraInputSettings: (settings: CameraInputSettings) => void;
  readonly setDebugToolsEnabled: (enabled: boolean) => void;
  readonly setSelectionStyle: (style: MenuSettings['selectionStyle']) => void;
  readonly setGroupNumbersShown: (shown: boolean) => void;
  readonly setGraphicsEnhancements: (settings: WorldEnhancements) => void;
  readonly setMinimapFrame: (frame: MenuSettings['minimapFrame']) => void;
  readonly setWeatherEnabled: (enabled: boolean) => void;
  readonly setBloodEnabled: (enabled: boolean) => void;
  readonly previewBus?: (bus: SoundBus) => void;
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
    if (patch.volumes !== undefined) deps.setVolumes(patch.volumes);
    if (patch.soundInBackground !== undefined) deps.setSoundInBackground(patch.soundInBackground);
    if (patch.monoSound !== undefined) deps.setMonoSound(patch.monoSound);
    if (patch.jinglesEnabled !== undefined) deps.setJinglesEnabled(patch.jinglesEnabled);
    if (patch.unitResponses !== undefined) deps.setUnitResponses(patch.unitResponses);
    if (patch.language !== undefined) deps.setLanguage(patch.language);
    if (patch.keyBindings !== undefined) deps.setKeyBindings(patch.keyBindings);
    if (
      patch.keyboardScrollSpeed !== undefined ||
      patch.edgeScrollSpeed !== undefined ||
      patch.dragScrollSpeed !== undefined ||
      patch.edgeScrollEnabled !== undefined ||
      patch.invertDragScroll !== undefined
    ) {
      deps.setCameraInputSettings(current);
    }
    if (patch.debugToolsEnabled !== undefined) deps.setDebugToolsEnabled(patch.debugToolsEnabled);
    if (patch.minimapFrame !== undefined) deps.setMinimapFrame(patch.minimapFrame);
    if (patch.selectionStyle !== undefined) deps.setSelectionStyle(patch.selectionStyle);
    if (patch.groupNumbers !== undefined) deps.setGroupNumbersShown(patch.groupNumbers);
    if (patch.blood !== undefined) deps.setBloodEnabled(patch.blood);
    if (patch.weather !== undefined) deps.setWeatherEnabled(patch.weather);
    if (ENHANCEMENT_KEYS.some((key) => patch[key] !== undefined)) {
      deps.setGraphicsEnhancements(enhancementsOf(current));
    }
  };
  return {
    current: () => current,
    pinnedUiScale: deps.pinnedUiScale,
    effectiveUiScaleFor: deps.effectiveUiScaleFor,
    bootOwnedChangesDeferred: true,
    ...(deps.previewBus !== undefined ? { previewBus: deps.previewBus } : {}),
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
