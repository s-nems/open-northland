import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_MANIFEST, readPipelineManifest } from '@open-northland/asset-pipeline';
import { readConfig, writeConfig } from './config.js';
import { type ContentStatus, classifyContent } from './content-state.js';
import { currentLocale } from './i18n/index.js';
import type { DesktopState } from './ipc.js';
import { discoverInstalledMod, findModRootUnder } from './mod-install/index.js';
import type { DataRoot } from './paths.js';

/**
 * The shell's view of its data root, read from disk on every call rather than cached: the wizard
 * installs a mod and regenerates content while the process lives, so a cache would go stale.
 */

export interface ShellPaths {
  readonly dataRoot: DataRoot;
  readonly contentDir: string;
  readonly configFile: string;
  readonly modsDir: string;
  readonly savesDir: string;
}

export interface ShellState {
  /**
   * The mod root the conversion uses when the game folder has none; derived here rather than taken
   * from the renderer, so a tampered renderer cannot choose it.
   */
  availableModRoot(): Promise<string | undefined>;
  contentStatus(): Promise<ContentStatus>;
  desktopState(): Promise<DesktopState>;
}

export function createShellState(paths: ShellPaths): ShellState {
  async function availableModRoot(): Promise<string | undefined> {
    const config = readConfig(paths.configFile);
    if (config.modPath !== undefined) {
      const validated = await findModRootUnder(config.modPath);
      if (validated !== undefined) return validated;
      const { modPath: _stale, ...rest } = config;
      writeConfig(paths.configFile, rest);
    }
    return discoverInstalledMod(paths.modsDir);
  }

  async function contentStatus(): Promise<ContentStatus> {
    const stored = await readPipelineManifest(paths.contentDir);
    return classifyContent(stored, CURRENT_MANIFEST, existsSync(join(paths.contentDir, 'ir.json')));
  }

  async function desktopState(): Promise<DesktopState> {
    // Read the remembered game path before availableModRoot() can rewrite the config to drop a
    // stale modPath.
    const remembered = readConfig(paths.configFile).gamePath;
    const modRoot = await availableModRoot();
    return {
      dataRoot: paths.dataRoot.path,
      portable: paths.dataRoot.portable,
      locale: currentLocale(),
      contentStatus: await contentStatus(),
      ...(remembered !== undefined ? { gamePath: remembered } : {}),
      ...(modRoot !== undefined ? { modRoot } : {}),
    };
  }

  return { availableModRoot, contentStatus, desktopState };
}
