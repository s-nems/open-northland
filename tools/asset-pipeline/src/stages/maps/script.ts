import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MapScript } from '@open-northland/data';
import { decodeIni, extractMapScript, parseIniSections, type RuleSection } from '../../decoders/ini.js';
import { errorMessage } from '../../errors.js';
import { findPathCaseInsensitiveInDirs } from '../../roots.js';

/**
 * The plaintext script files an unpacked map folder ships: `player.inc` usually carries
 * `[playerdata]`/`[playermisc]`/`[multiplayer]`, `mission.inc` the repeated `[MissionData]`
 * triggers, and `misc.inc` sometimes hosts all three player sections instead (9 corpus maps author
 * `[playerdata]` there and 7 the `[multiplayer]` table). `map.ini` normally only `#include`s the
 * others (unknown sections are ignored), but one corpus map (`oasis_o_plenty`) authors its whole
 * script inline there. Three corpus maps (Wody_Nilu, KROL_PRZELECZY, WYSPA LUPIEZCOW) author
 * `[multiplayer]` in BOTH player.inc and misc.inc with differing `playeroption` rows; this list's
 * order matches their `map.ini` include order, and keeping the first row per slot is the named
 * approximation (which duplicate the original engine keeps is unpinned). Every other section is
 * single-homed, and `player` slot rows dedupe first-wins regardless.
 */
const SCRIPT_INC_FILES = ['player.inc', 'mission.inc', 'misc.inc', 'map.ini'] as const;

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
      if (path === undefined) continue;
      try {
        sections.push(...parseIniSections(decodeIni(await readFile(path))));
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
