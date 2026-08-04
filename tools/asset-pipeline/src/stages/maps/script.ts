import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MapScript } from '@open-northland/data';
import { extractMapScript, iniBytesToSections, type RuleSection } from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitiveInDirs } from '../../roots.js';

/**
 * The plaintext script files an unpacked map folder ships: `player.inc` usually carries
 * `[playerdata]`/`[playermisc]`/`[multiplayer]`, `mission.inc` the repeated `[MissionData]` triggers,
 * while `misc.inc` and `map.ini` sometimes host those sections instead of `#include`ing the others.
 * The order matches the maps' `map.ini` include order: a few maps author `[multiplayer]` in two files
 * with differing `playeroption` rows, and keeping the first row per slot is a named approximation.
 */
const SCRIPT_INC_FILES = ['player.inc', 'mission.inc', 'misc.inc', 'map.ini'] as const;

/**
 * Resolves one map folder's player roster, diplomacy and mission triggers: the already-decoded sibling
 * `map.cif` sections when they carry script data, else the folder's plaintext `SCRIPT_INC_FILES`. An
 * unreadable `.inc` warns and is skipped so one bad file cannot drop the whole script. Returns
 * undefined when neither source yields anything.
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
      if (path === undefined) continue;
      try {
        sections.push(...iniBytesToSections(await readFile(path)));
        read.push(inc);
      } catch (err) {
        console.warn(`[pipeline] map ${rel}: ${inc} unreadable: ${errorMessage(err)}`);
      }
    }
    if (read.length > 0) {
      script = extractMapScript(sections, { file: `${mapDir}/${read.join('+')}` });
    }
  }
  return script === undefined ? undefined : attachPlayerNames(script, strings);
}

/**
 * Decorates the roster with authored display names: the `nametribe <player> <stringId>` lines kept in
 * `misc`, resolved through the map's string table. A slot without a resolvable name stays nameless.
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
