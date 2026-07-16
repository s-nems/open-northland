import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The shell's remembered state — currently just the last game folder the installer converted. */
export interface DesktopConfig {
  readonly gamePath?: string;
}

/** Read the config; absent or malformed degrades to `{}` (first run, or a hand-edited file). */
export function readConfig(file: string): DesktopConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return {};
    const gamePath = (parsed as Record<string, unknown>).gamePath;
    return typeof gamePath === 'string' ? { gamePath } : {};
  } catch {
    return {};
  }
}

export function writeConfig(file: string, config: DesktopConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
