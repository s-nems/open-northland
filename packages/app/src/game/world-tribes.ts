import { decodeMissionResult, type MapScript, type TerrainMapFile } from '@open-northland/data';
import { PRIMARY_TRIBE } from './rules.js';
import { MAP_TRIBES, type SeatTribeRemap } from './seat-tribes.js';
import { type AuthoredJoinRows, contentJoins } from './world/index.js';

/**
 * The civilizations one world draws, the first of which is the base: it backs a building type or a
 * character look the other tribes do not skin, and an entity of a tribe whose art was never loaded.
 * Non-empty by construction, so a consumer never needs a fallback of its own.
 */
export type WorldTribes = readonly [number, ...number[]];

/** The highest `TRIBE_TYPE_HUMAN_*` id (`logicdefines.inc`): above it the ids are animal species, which
 *  draw through the wildlife lane rather than a civilization's bob sets. */
const LAST_HUMAN_TRIBE = 7;

/**
 * The civilizations a world fields: the seats' roster tribes plus the tribes of every authored building
 * and settler, including later mission reinforcements, as the session's seat tribes restamp them. Each
 * one costs its own atlas pages, so the loaders take this set rather than every tribe the content
 * describes.
 */
export function worldTribes(
  script: (Pick<MapScript, 'players'> & Partial<Pick<MapScript, 'missions'>>) | null,
  entities: TerrainMapFile['entities'],
  rows: AuthoredJoinRows,
  seatTribes: SeatTribeRemap = MAP_TRIBES,
): WorldTribes {
  // The base is pinned even on a map that fields no viking: it backs every building type and character
  // look the other tribes do not skin, at the cost of its own pages on such a map.
  const tribes = new Set<number>([PRIMARY_TRIBE]);
  const add = (tribe: number | undefined): void => {
    if (tribe !== undefined && tribe > 0 && tribe <= LAST_HUMAN_TRIBE) tribes.add(tribe);
  };
  for (const seat of script?.players ?? []) add(seat.tribeId);
  // The same joins the placements themselves resolve through, so the art loaded and the tribe the sim
  // stamps can never disagree.
  const joins = contentJoins(rows);
  for (const mission of script?.missions ?? []) {
    for (const line of mission.results) {
      const op = decodeMissionResult(line);
      // A script-enabled house makes its nation a build nation of the seat, so its art must load too.
      if (op.opcode === 'EnableHouse') {
        const tribe = op.tribe.ref === 'id' ? op.tribe.id : joins.tribe(op.tribe.name);
        add(tribe === undefined ? undefined : seatTribes.tribe(op.player, tribe));
        continue;
      }
      if (op.opcode !== 'SetHuman' && op.opcode !== 'SetHumanX') continue;
      const tribe = op.tribe.ref === 'id' ? op.tribe.id : joins.tribe(op.tribe.name);
      const job = op.job.ref === 'id' ? op.job.id : joins.job(op.job.name);
      add(tribe === undefined ? undefined : seatTribes.human(op.player, job, tribe));
    }
  }
  for (const human of entities?.humans ?? []) {
    const tribe = joins.tribe(human.tribe);
    add(tribe === undefined ? undefined : seatTribes.human(human.player, joins.job(human.role), tribe));
  }
  for (const building of entities?.buildings ?? []) {
    const hit = joins.buildingBob(building.name, building.level);
    add(hit === undefined ? undefined : seatTribes.building(building.player, hit.typeId, hit.tribeId));
  }
  return [PRIMARY_TRIBE, ...[...tribes].filter((t) => t !== PRIMARY_TRIBE).sort((a, b) => a - b)];
}
