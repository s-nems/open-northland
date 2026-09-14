import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isLocale, type Locale } from '@open-northland/installer/i18n';

export interface DesktopConfig {
  /** A hand-picked mod root outside the data root's `mods/`. */
  readonly modPath?: string;
  /** The last language chosen; absent falls back to the OS locale. */
  readonly locale?: Locale;
}

/** An absent or malformed file degrades to `{}`. */
export function readConfig(file: string): DesktopConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { modPath, locale } = parsed as Record<string, unknown>;
    return {
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

export function patchConfig(file: string, patch: Partial<DesktopConfig>): void {
  writeConfig(file, { ...readConfig(file), ...patch });
}
