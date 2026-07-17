import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MapScript } from '@open-northland/data';
import { decodeIni, extractMapScript, parseIniSections, type RuleSection } from '../../decoders/ini.js';
import { findPathCaseInsensitiveInDirs } from './case-path.js';

/**
 * The plaintext script twins an unpacked map folder ships: `player.inc` carries
 * `[playerdata]`/`[playermisc]`, `mission.inc` the repeated `[MissionData]` triggers.
 */
const SCRIPT_INC_FILES = ['player.inc', 'mission.inc'] as const;

/**
 * Resolves one map folder's {@link MapScript} — the player roster, diplomacy and mission triggers
 * the menu and the game load. Source preference mirrors the entities layer: the already-decoded
 * sibling `map.cif` sections when they carry script data (the packed tutorial/multiplayer maps),
 * else the folder's plaintext {@link SCRIPT_INC_FILES} (the unpacked mod majority). An unreadable
 * `.inc` warns and is skipped — one bad file must not drop the whole map's script. Returns
 * undefined when neither source yields anything (the caller then emits no script sidecar).
 *
 * `strings` is the map's already-loaded string table (or undefined): each roster slot's authored
 * display name is the `playermisc` `nametribe <player> <stringId>` line resolved through it.
 */
export async function resolveMapScript(
  mapDirs: readonly string[],
  rel: string,
  cifSections: readonly RuleSection[] | undefined,
  strings: Record<number, string> | undefined,
): Promise<MapScript | undefined> {
  const mapDir = dirname(rel);
  let script =
    cifSections !== undefined ? extractMapScript(cifSections, { file: `${mapDir}/map.cif` }) : undefined;
  if (script === undefined) {
    const sections: RuleSection[] = [];
    const read: string[] = [];
    for (const inc of SCRIPT_INC_FILES) {
      const path = await findPathCaseInsensitiveInDirs(mapDirs, [inc]);
      if (path === null) continue;
      try {
        sections.push(...parseIniSections(decodeIni(await readFile(path))));
        read.push(inc);
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: ${inc} unreadable: ${(err as Error).message}`);
      }
    }
    if (read.length > 0) {
      script = extractMapScript(sections, { file: `${mapDir}/${read.join('+')}` });
    }
  }
  return script === undefined ? undefined : attachPlayerNames(script, strings);
}

/**
 * Decorates the roster with authored display names: `nametribe <player> <stringId>` (kept lossless
 * in `misc`) resolved through the map's string table. A slot without a resolvable name stays
 * nameless — the menu then labels it generically.
 */
function attachPlayerNames(script: MapScript, strings: Record<number, string> | undefined): MapScript {
  if (strings === undefined || script.players.length === 0) return script;
  const nameBySlot = new Map<number, string>();
  for (const line of script.misc) {
    if (line.key !== 'nametribe') continue;
    const player = Number.parseInt(line.values[0] ?? '', 10);
    const stringId = Number.parseInt(line.values[1] ?? '', 10);
    const name = strings[stringId];
    if (!Number.isNaN(player) && name !== undefined && !nameBySlot.has(player)) {
      nameBySlot.set(player, name);
    }
  }
  if (nameBySlot.size === 0) return script;
  return {
    ...script,
    players: script.players.map((p) => {
      const name = nameBySlot.get(p.player);
      return name === undefined ? p : { ...p, name };
    }),
  };
}
