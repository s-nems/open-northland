import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_MANIFEST, readPipelineManifest } from '@open-northland/asset-pipeline/manifest';
import { type ContentStatus, classifyContent, type ShellSetupState } from '@open-northland/installer';
import { currentLocale } from '@open-northland/installer/i18n';
import { discoverInstalledMod, findModRootUnder } from '@open-northland/installer/mod-install';
import { nodeVfs } from '@open-northland/vfs/node';
import { readConfig, writeConfig } from './config.js';
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
  /** The mod root the conversion reads, derived here rather than taken from the renderer, so a
   *  tampered renderer cannot choose it. */
  availableModRoot(): Promise<string | undefined>;
  contentStatus(): Promise<ContentStatus>;
  desktopState(): Promise<ShellSetupState>;
}

export function createShellState(paths: ShellPaths): ShellState {
  async function availableModRoot(): Promise<string | undefined> {
    const config = readConfig(paths.configFile);
    if (config.modPath !== undefined) {
      const validated = await findModRootUnder(nodeVfs(), config.modPath);
      if (validated !== undefined) return validated;
      const { modPath: _stale, ...rest } = config;
      writeConfig(paths.configFile, rest);
    }
    return discoverInstalledMod(nodeVfs(), paths.modsDir);
  }

  async function contentStatus(): Promise<ContentStatus> {
    const stored = await readPipelineManifest(nodeVfs(), paths.contentDir);
    return classifyContent(stored, CURRENT_MANIFEST, existsSync(join(paths.contentDir, 'ir.json')));
  }

  async function desktopState(): Promise<ShellSetupState> {
    const modRoot = await availableModRoot();
    return {
      dataRootLabel: paths.dataRoot.path,
      portable: paths.dataRoot.portable,
      locale: currentLocale(),
      contentStatus: await contentStatus(),
      modDelivery: 'upstream-folder',
      ...(modRoot !== undefined ? { modRoot } : {}),
    };
  }

  return { availableModRoot, contentStatus, desktopState };
}
