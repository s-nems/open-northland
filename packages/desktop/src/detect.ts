import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { probeGameFolder } from '@open-northland/asset-pipeline';
import type { GameFolderCandidate } from '@open-northland/installer';
import { nodeVfs } from '@open-northland/vfs/node';

/**
 * Best-effort scan for an existing game install, following OpenRA's detect-known-installs pattern:
 * no registry crawl, and the folder picker stays the fallback.
 */

const CANDIDATE_LIMIT = 5;

function windowsInstallRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = ['C:\\GOG Games', 'C:\\Games', env['ProgramFiles(x86)'], env.ProgramFiles];
  return roots.filter((r): r is string => r !== undefined && r !== '');
}

export async function detectGameFolders(
  roots: readonly string[] = process.platform === 'win32' ? windowsInstallRoots(process.env) : [],
): Promise<GameFolderCandidate[]> {
  const found: GameFolderCandidate[] = [];
  for (const root of roots) {
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (found.length >= CANDIDATE_LIMIT) return found;
      if (!entry.isDirectory() || !entry.name.toLowerCase().includes('cultures')) continue;
      const path = join(root, entry.name);
      const probe = await probeGameFolder(nodeVfs(), path);
      if (probe.hasArchives) found.push({ path, probe });
    }
  }
  return found;
}
