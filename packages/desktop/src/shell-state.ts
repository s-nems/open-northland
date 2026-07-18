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
 * What the shell knows about its own data root. Resolved from disk on every call rather than cached:
 * the wizard installs a mod and regenerates content while the process lives, so a cached answer
 * would go stale mid-session.
 */

/** The data root's writable locations, resolved once at startup (see `paths.ts`). */
export interface ShellPaths {
  readonly dataRoot: DataRoot;
  readonly contentDir: string;
  readonly configFile: string;
  readonly modsDir: string;
}

export interface ShellState {
  /**
   * A usable mod root outside the game folder: the config's hand-picked folder (re-validated — the
   * user may have deleted it, in which case the stale entry is dropped from the config) first, then
   * a mod downloaded into the data root's `mods/`. Also the root the conversion uses — derived here,
   * never taken from the renderer, so no renderer string ever reaches the filesystem.
   */
  availableModRoot(): Promise<string | undefined>;
  /** Compare the data root's conversion stamp to this shell's pipeline; see `content-state.ts`. */
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
