import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isLocale, type Locale } from './i18n/index.js';

/** The shell's remembered state: the last game folder converted, and a hand-picked mod root. */
export interface DesktopConfig {
  readonly gamePath?: string;
  /** A mod root the user pointed the wizard at (outside the game folder and the data root's mods/). */
  readonly modPath?: string;
  /** The installer language the user last chose; absent falls back to the detected OS locale. */
  readonly locale?: Locale;
}

/** Read the config; absent or malformed degrades to `{}` (first run, or a hand-edited file). */
export function readConfig(file: string): DesktopConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { gamePath, modPath, locale } = parsed as Record<string, unknown>;
    return {
      ...(typeof gamePath === 'string' ? { gamePath } : {}),
      ...(typeof modPath === 'string' ? { modPath } : {}),
      ...(isLocale(locale) ? { locale } : {}),
    };
  } catch {
    return {};
  }
}

export function writeConfig(file: string, config: DesktopConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
