import { buildingHitpointsFor, sameBuildingFootprintCells } from '@open-northland/data';
import { Building, ownerOf, Person, Settler, setSettlerTribe, Vehicle } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { resizeUnitHealth } from '../../lifecycle/unit-health.js';
import { isHeroJob } from '../../readviews/jobs.js';
import type { MissionPass } from '../pass.js';
import type { MissionSeatTribe } from '../script.js';

/** A thing a handover gave away, with the owner it had before. */
export interface Handed {
  readonly entity: Entity;
  readonly from: number | undefined;
}

/** `entities` with their current owners, read before a handover restamps them. */
export function withOwners(world: World, entities: readonly Entity[]): readonly Handed[] {
  return entities.map((entity) => ({ entity, from: ownerOf(world, entity) }));
}

/**
 * The safety net behind the world build's seat pass: a thing a handover just gave a re-tribed seat
 * that still carries the seat's authored people takes the chosen people, as the build would have
 * moved it. A hero keeps his people, and so does a thing that came from another re-tribed seat
 * carrying that seat's choice. A thing the seat already held was not handed: a repeated handover
 * leaves it as the build or the handover that delivered it settled it. A house keeps its tribe when
 * the chosen people do not draw it or its footprint cells differ between the two, as the build keeps
 * it, so it is no correction; a converted house keeps its health fraction of the chosen people's hit
 * points.
 */
export function retribeHanded(
  pass: MissionPass,
  mission: number,
  opcode: string,
  handed: readonly Handed[],
): void {
  const seats = pass.script.seatTribes;
  if (seats === undefined || seats.length === 0) return;
  let count = 0;
  for (const { entity, from } of handed) {
    if (!pass.world.isAlive(entity)) continue;
    const owner = ownerOf(pass.world, entity);
    if (owner === from) continue;
    const seat = seats.find((s) => s.player === owner);
    if (seat === undefined) continue;
    if (
      retribe(
        pass,
        entity,
        seat,
        seats.find((s) => s.player === from),
      )
    )
      count++;
  }
  if (count > 0) pass.ctx.events.emit({ kind: 'missionSeatTribeCorrected', mission, opcode, count });
}

/** Move `e` to the seat's chosen people when it is of the seat's authored people and not the giving
 *  seat's choice; whether it moved. */
function retribe(
  pass: MissionPass,
  e: Entity,
  seat: MissionSeatTribe,
  giver: MissionSeatTribe | undefined,
): boolean {
  const { world, ctx } = pass;
  const ours = (tribe: number): boolean => tribe === seat.authored && tribe !== giver?.chosen;
  const settler = world.tryGet(e, Settler);
  if (settler !== undefined) {
    if (!world.has(e, Person) || !ours(settler.tribe) || isHeroJob(ctx.content, settler.jobType))
      return false;
    setSettlerTribe(world, e, seat.chosen);
    return true;
  }
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle !== undefined) {
    if (!ours(vehicle.tribe)) return false;
    world.mut(e, Vehicle).tribe = seat.chosen;
    return true;
  }
  const building = world.tryGet(e, Building);
  if (building === undefined || !ours(building.tribe)) return false;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  if (
    type === undefined ||
    !seat.drawnBuildings.includes(building.buildingType) ||
    !sameBuildingFootprintCells(type, seat.authored, seat.chosen, building.record)
  )
    return false;
  const converted = world.mut(e, Building);
  converted.tribe = seat.chosen;
  converted.record = undefined; // the record is the authored people's

  const previous = buildingHitpointsFor(type, seat.authored);
  const next = buildingHitpointsFor(type, seat.chosen);
  if (previous !== undefined && next !== undefined) resizeUnitHealth(world, e, previous, next);
  return true;
}
