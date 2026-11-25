import { loadGuiStrings } from '../../content/gui/gfx.js';
import type { Locale } from '../../i18n/index.js';
import type { LocalizedMapString } from '../../game/map/strings.js';
import { createMissionTranslator, type MissionTranslator } from '../../i18n/translate/mission-translate.js';
import { sharedMapTextTranslator } from '../../i18n/translate/service.js';
import { translatedTribeName } from '../../i18n/translate/tribe-name.js';
import { menuSettings, onSettingsChange } from './settings/state.js';

/** The translation surface a menu screen reads map-authored text through. */
export interface MenuMapTextReader {
  text(found: LocalizedMapString): string;
  target(): Locale | null;
  enabled(): boolean;
  tribeName(tribe: number | undefined): string;
  dispose(): void;
}

/** One bridge for the menu: map cards and the lobby share its in-flight and completed text cache. */
let shared: MissionTranslator | null = null;
const settingsLifetime = new AbortController();
const listeners = new Set<() => void>();
let englishTribeNames: Readonly<Record<string, string>> = {};

function targetLanguage(): Locale | null {
  const settings = menuSettings();
  if (settings.missionBookLanguage === 'original') return null;
  return settings.missionBookLanguage === 'auto' ? settings.language : settings.missionBookLanguage;
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function translator(): MissionTranslator {
  if (shared !== null) return shared;
  const initial = menuSettings();
  let lastTarget = targetLanguage();
  let lastLanguage = initial.language;
  let lastEnabled = initial.mapTextTranslation;
  shared = createMissionTranslator({
    target: targetLanguage,
    enabled: () => menuSettings().mapTextTranslation,
    translator: sharedMapTextTranslator(),
    onChange: notify,
  });
  void loadGuiStrings('eng').then((strings) => {
    if (strings === null) return;
    englishTribeNames = strings.tribes ?? {};
    notify();
  });
  onSettingsChange((settings) => {
    const nextTarget = targetLanguage();
    if (
      nextTarget === lastTarget &&
      settings.language === lastLanguage &&
      settings.mapTextTranslation === lastEnabled
    ) {
      return;
    }
    lastTarget = nextTarget;
    lastLanguage = settings.language;
    lastEnabled = settings.mapTextTranslation;
    const before = shared?.version() ?? 0;
    shared?.retarget();
    if (shared?.version() === before) notify();
  }, settingsLifetime.signal);
  return shared;
}

/** Subscribe a mounted menu surface; dispose it when the screen leaves the menu. */
export function menuMapTextReader(onChange: () => void): MenuMapTextReader {
  const bridge = translator();
  listeners.add(onChange);
  return {
    text(found) {
      // A null source means the menu's own locale; the optional mission-book target may differ.
      return bridge.text({ text: found.text, lang: found.lang ?? menuSettings().language });
    },
    target: targetLanguage,
    enabled: () => menuSettings().mapTextTranslation,
    tribeName: (tribe) =>
      translatedTribeName(
        tribe,
        englishTribeNames[String(tribe)],
        bridge.text,
        targetLanguage(),
        menuSettings().mapTextTranslation,
      ),
    dispose: () => listeners.delete(onChange),
  };
}
