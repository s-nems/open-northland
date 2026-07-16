import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The shell's remembered state: the last game folder converted, and a hand-picked mod root. */
export interface DesktopConfig {
  readonly gamePath?: string;
  /** A mod root the user pointed the wizard at (outside the game folder and the data root's mods/). */
  readonly modPath?: string;
}

/** Read the config; absent or malformed degrades to `{}` (first run, or a hand-edited file). */
export function readConfig(file: string): DesktopConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return {};
    const { gamePath, modPath } = parsed as Record<string, unknown>;
    return {
      ...(typeof gamePath === 'string' ? { gamePath } : {}),
      ...(typeof modPath === 'string' ? { modPath } : {}),
    };
  } catch {
    return {};
  }
}

export function writeConfig(file: string, config: DesktopConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
