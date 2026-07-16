import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { probeGameFolder } from '@open-northland/asset-pipeline';
import type { GameFolderCandidate } from './ipc.js';

/**
 * Best-effort scan for an existing game install: look one level under the conventional Windows
 * install roots for a folder whose name mentions "cultures", then probe it (OpenRA's
 * detect-known-installs first-run pattern; no registry crawl — the picker is always the fallback).
 */

const CANDIDATE_LIMIT = 5;

function windowsInstallRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = ['C:\\GOG Games', 'C:\\Games', env['ProgramFiles(x86)'], env.ProgramFiles];
  return roots.filter((r): r is string => r !== undefined && r !== '');
}

/** Scan `roots` (defaults to the Windows install roots; empty elsewhere) for probe-positive folders. */
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
      const probe = await probeGameFolder(path);
      if (probe.hasArchives) found.push({ path, probe });
    }
  }
  return found;
}
