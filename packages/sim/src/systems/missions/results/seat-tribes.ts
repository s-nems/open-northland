import { type BuildingFootprint, buildingFootprintFor, buildingHitpointsFor } from '@open-northland/data';
import { Building, ownerOf, Person, Settler, Vehicle } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity } from '../../../ecs/world.js';
import { changeUnitTribe, resizeUnitHealth } from '../../lifecycle/unit-health.js';
import { isHeroJob } from '../../readviews/jobs.js';
import type { MissionPass } from '../pass.js';
import type { MissionSeatTribe } from '../script.js';

/**
 * The safety net behind the world build's seat pass: a thing a handover just gave a re-tribed seat
 * that still carries the seat's authored people takes the chosen people, as the build would have
 * moved it. A hero keeps his people, and so does a house the chosen people do not draw or whose
 * footprint cells differ between the two, since its placement already stands; a converted house keeps
 * its health fraction of the chosen people's hit points.
 */
export function retribeHanded(
  pass: MissionPass,
  mission: number,
  opcode: string,
  handed: readonly Entity[],
): void {
  const seats = pass.script.seatTribes;
  if (seats === undefined || seats.length === 0) return;
  let found = 0;
  for (const e of handed) {
    if (!pass.world.isAlive(e)) continue;
    const owner = ownerOf(pass.world, e);
    const seat = seats.find((s) => s.player === owner);
    if (seat !== undefined && retribe(pass, e, seat)) found++;
  }
  if (found > 0) pass.ctx.events.emit({ kind: 'missionSeatTribeCorrected', mission, opcode, count: found });
}

/** Whether `e` is of the seat's authored people, moving it to the chosen one where it can. */
function retribe(pass: MissionPass, e: Entity, seat: MissionSeatTribe): boolean {
  const { world, ctx } = pass;
  const settler = world.tryGet(e, Settler);
  if (settler !== undefined) {
    if (!world.has(e, Person) || settler.tribe !== seat.authored || isHeroJob(ctx.content, settler.jobType))
      return false;
    changeUnitTribe(world, ctx.content, e, seat.chosen);
    return true;
  }
  const vehicle = world.tryGet(e, Vehicle);
  if (vehicle !== undefined) {
    if (vehicle.tribe !== seat.authored) return false;
    world.mut(e, Vehicle).tribe = seat.chosen;
    return true;
  }
  const building = world.tryGet(e, Building);
  if (building === undefined || building.tribe !== seat.authored) return false;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  if (
    type !== undefined &&
    seat.drawnBuildings.includes(building.buildingType) &&
    sameFootprint(buildingFootprintFor(type, seat.authored), buildingFootprintFor(type, seat.chosen))
  ) {
    world.mut(e, Building).tribe = seat.chosen;
    const previous = buildingHitpointsFor(type, seat.authored);
    const next = buildingHitpointsFor(type, seat.chosen);
    if (previous !== undefined && next !== undefined) resizeUnitHealth(world, e, previous, next);
  }
  return true;
}

/** Each tribe's variant carries its own footprint object, so two footprints match by their cells, in
 *  any order. */
function sameFootprint(a: BuildingFootprint | undefined, b: BuildingFootprint | undefined): boolean {
  return cellsKey(a) === cellsKey(b);
}

function cellsKey(footprint: BuildingFootprint | undefined): string {
  if (footprint === undefined) return '';
  return Object.entries(footprint)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([key, value]) =>
      Array.isArray(value)
        ? `${key}:${value
            .map((cell) => JSON.stringify(cell))
            .sort()
            .join(';')}`
        : `${key}:${JSON.stringify(value)}`,
    )
    .join('|');
}
