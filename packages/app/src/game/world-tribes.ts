import { decodeMissionResult, type MapScript, type TerrainMapFile } from '@open-northland/data';
import type { FlowingThing } from './match/seat-flows.js';
import { MAP_TRIBES, type SeatTribeRemap } from './match/seat-tribes.js';
import { PRIMARY_TRIBE } from './rules.js';
import { type AuthoredJoinRows, contentJoins } from './world/index.js';

/**
 * The civilizations one world draws, the first of which is the base: it backs a building type or a
 * character look the other tribes do not skin, and an entity of a tribe whose art was never loaded.
 * Non-empty by construction, so a consumer never needs a fallback of its own.
 */
export type WorldTribes = readonly [number, ...number[]];

/**
 * The civilizations a world fields: the seats' roster tribes plus the tribes of every authored building
 * and settler, including later mission reinforcements, as the session's seat tribes restamp them. Each
 * one costs its own atlas pages, so the loaders take this set rather than every tribe the content
 * describes.
 */
export function worldTribes(
  script: (Pick<MapScript, 'players'> & Partial<Pick<MapScript, 'missions' | 'ai'>>) | null,
  entities: TerrainMapFile['entities'],
  rows: AuthoredJoinRows,
  seatTribes: SeatTribeRemap = MAP_TRIBES,
): WorldTribes {
  // The base is pinned even on a map that fields no viking: it backs every building type and character
  // look the other tribes do not skin, at the cost of its own pages on such a map.
  const tribes = new Set<number>([PRIMARY_TRIBE]);
  // An animal species draws through the wildlife lane rather than a people's bob sets.
  const species = new Set(
    (rows.animals ?? []).flatMap((a) => (a.tribeType === undefined ? [] : [a.tribeType])),
  );
  const add = (tribe: number | undefined): void => {
    if (tribe !== undefined && tribe > 0 && !species.has(tribe)) tribes.add(tribe);
  };
  for (const seat of script?.players ?? []) add(seat.tribeId);
  // The same joins the placements themselves resolve through, so the art loaded and the tribe the sim
  // stamps can never disagree.
  const joins = contentJoins(rows);
  // A settler's tribe as the sim stamps it: its unit pair first, then its seat's people choice.
  const settlerTribe = (thing: FlowingThing, tribe: number | undefined, job: number | undefined) => {
    if (tribe === undefined) return undefined;
    const unit = job === undefined ? { tribe, job } : joins.unit(tribe, job);
    return seatTribes.human(thing, unit.job, unit.tribe);
  };
  for (const seat of script?.ai ?? []) {
    for (const task of seat.tasks) {
      if (task.kind !== 'createCreatures') continue;
      const raised = { owner: seat.player, missionId: task.missionId, at: { hx: task.x, hy: task.y } };
      add(settlerTribe(raised, task.tribe, joins.jobId(task.job)));
    }
  }
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
      const job = op.job.ref === 'id' ? joins.jobId(op.job.id) : joins.job(op.job.name);
      const spawn = { owner: op.player, missionId: op.humanId, at: op.point };
      add(settlerTribe(spawn, tribe, job));
    }
  }
  for (const human of entities?.humans ?? []) {
    const placed = { owner: human.player, missionId: human.missionId, at: human };
    add(settlerTribe(placed, joins.tribe(human.tribe), joins.job(human.role)));
  }
  for (const building of entities?.buildings ?? []) {
    const hit = joins.buildingBob(building.name, building.level);
    const placed = { owner: building.player, missionId: building.missionId, at: building };
    add(hit === undefined ? undefined : seatTribes.building(placed, hit.typeId, hit.tribeId));
  }
  return [PRIMARY_TRIBE, ...[...tribes].filter((t) => t !== PRIMARY_TRIBE).sort((a, b) => a - b)];
}
