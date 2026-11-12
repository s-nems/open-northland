import { entityById, systems } from '@open-northland/sim';
import {
  assignmentPriorityFor,
  canonicalJobType,
  trainsRatherThanEmploys,
} from '../../../game/sandbox/index.js';
import {
  builderCrewSize,
  buildingTypeOf,
  buildSiteOf,
  type SnapshotEntity,
  settlerJobType,
} from '../../../game/snapshot/index.js';
import type { Tile } from '../../picking.js';
import { mayCoinDrillHere, paidDrillers } from '../orders/coin-drill.js';
import type { FormationUnit } from '../orders/formation.js';
import { contentLookups, type RightClickContext } from './context.js';

type BuildingContext = Pick<RightClickContext, 'snapshot' | 'content'>;

/** A settler a workplace takes, with the trades it would take there in order. */
export interface BuildingWorker {
  readonly unit: FormationUnit;
  readonly jobPriority: number[];
}

/** The right-click ladder's building rungs: an own building's crew, posts, homes and drills, and the
 *  builders a wall or road site takes. */
export type BuildingIntent =
  /** The builders join the crew; the rest are offered the school's courses. */
  | {
      readonly kind: 'school';
      readonly building: number;
      readonly crew: readonly FormationUnit[];
      readonly learners: readonly FormationUnit[];
    }
  /** Homes and workplaces have limited room, so each goes out as one group order and the sim seats the
   *  homeless and the unemployed first. At a barracks that shows a coin a soldier who may coin-drill drills,
   *  nearest first while its coins last; a civilian enlists. A settler none of them takes, a soldier who
   *  may not drill among them, gets no order. */
  | {
      readonly kind: 'building';
      readonly building: number;
      readonly crew: readonly FormationUnit[];
      readonly trainees: readonly FormationUnit[];
      readonly drillers: readonly FormationUnit[];
      readonly household: readonly FormationUnit[];
      readonly workers: readonly BuildingWorker[];
    }
  /** Shift: the crew and the barracks recruits line their order up behind their current one, and the
   *  rest walk there queued, a post or a home being a standing setting; a soldier or hero at a barracks
   *  gets no order. */
  | {
      readonly kind: 'queueAtBuilding';
      readonly building: number;
      readonly crew: readonly FormationUnit[];
      readonly recruits: readonly FormationUnit[];
      readonly walkers: readonly FormationUnit[];
      readonly tile: Tile;
    }
  /** A wall or road site pins the builders to it; the rest walk there. */
  | {
      readonly kind: 'site';
      readonly site: number;
      readonly builders: readonly FormationUnit[];
      readonly walkers: readonly FormationUnit[];
      readonly tile: Tile;
    };

function definitionOf(ctx: BuildingContext, building: number) {
  const entity = entityById(ctx.snapshot, building);
  const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
  return type !== undefined ? contentLookups(ctx.content).buildings.get(type) : undefined;
}

/**
 * The builders among `units` that join `building`'s crew: a foundation or damaged building takes a
 * builder before anything else, as in the original, while a standing building's repair crew has room.
 * A site's own worker takes a workplace post and carries materials while it is built, then keeps the
 * seat when it stands, so only a builder without a matching workplace slot joins the crew.
 */
function crewAmong(ctx: BuildingContext, units: readonly FormationUnit[], building: number): FormationUnit[] {
  const { snapshot, content } = ctx;
  const entity = entityById(snapshot, building);
  if (entity === undefined) return [];
  const underConstruction = entity.components.UnderConstruction !== undefined;
  if (!underConstruction && entity.components.Damaged === undefined) return [];
  const slots = definitionOf(ctx, building)?.workers;
  const employsTrade = (jobType: number): boolean =>
    (slots ?? []).some((slot) => canonicalJobType(slot.jobType) === canonicalJobType(jobType));
  let crewRoom = underConstruction
    ? Number.POSITIVE_INFINITY
    : systems.REPAIR_CREW_LIMIT - builderCrewSize(snapshot, building);
  return units.filter((target) => {
    const self = entityById(snapshot, target.ref);
    const currentJob = self !== undefined ? settlerJobType(self) : undefined;
    if (currentJob === undefined || !systems.jobCanBuild(content, currentJob) || employsTrade(currentJob))
      return false;
    if (self !== undefined && buildSiteOf(self) === building) return true;
    if (crewRoom <= 0) return false;
    crewRoom--;
    return true;
  });
}

/** A hero takes no building: no home, post, drill or lesson. */
function takesBuilding(ctx: BuildingContext, self: SnapshotEntity | undefined): boolean {
  return self === undefined || !systems.isHeroJob(ctx.content, settlerJobType(self) ?? null);
}

export function atBuilding(
  ctx: BuildingContext,
  units: readonly FormationUnit[],
  building: number,
): BuildingIntent {
  const { snapshot } = ctx;
  const def = definitionOf(ctx, building);
  const crew = crewAmong(ctx, units, building);
  const rest = units.filter(
    (target) => !crew.includes(target) && takesBuilding(ctx, entityById(snapshot, target.ref)),
  );
  if (def !== undefined && systems.isSchoolType(def))
    return { kind: 'school', building, crew, learners: rest };
  const trainees: FormationUnit[] = [];
  const drillers: FormationUnit[] = [];
  const house = entityById(snapshot, building);
  const buildings = contentLookups(ctx.content).buildings;
  const household: FormationUnit[] = [];
  const workers: BuildingWorker[] = [];
  for (const target of rest) {
    const self = entityById(snapshot, target.ref);
    const currentJob = self !== undefined ? settlerJobType(self) : undefined;
    // A home may be reserved before it stands; its household drives wait for completed construction.
    if (def?.kind === 'home') household.push(target);
    // A recruit sent to a foundation waits at its door until it stands.
    else if (trainsRatherThanEmploys(def, currentJob)) {
      // A soldier never enlists again: the barracks drills him for coins or leaves him be.
      if (!systems.isFighterJob(ctx.content, currentJob ?? null)) trainees.push(target);
      else if (
        self !== undefined &&
        house !== undefined &&
        mayCoinDrillHere(ctx.content, self, house, buildings)
      )
        drillers.push(target);
    } else {
      // The sim gates every candidate in the priority list, so an unoffered or full trade falls through.
      const jobPriority = assignmentPriorityFor(currentJob, def?.workers);
      if (jobPriority.length > 0) workers.push({ unit: target, jobPriority });
    }
  }
  return {
    kind: 'building',
    building,
    crew,
    trainees,
    drillers: paidDrillers(ctx.content, snapshot, building, drillers, (unit) => unit.ref),
    household,
    workers,
  };
}

export function queueAtBuilding(
  ctx: BuildingContext,
  units: readonly FormationUnit[],
  building: number,
  tile: Tile,
): BuildingIntent {
  const def = definitionOf(ctx, building);
  const crew = crewAmong(ctx, units, building);
  const recruits: FormationUnit[] = [];
  const walkers: FormationUnit[] = [];
  const barracks = def !== undefined && systems.isBarracksType(def);
  for (const target of units) {
    if (crew.includes(target)) continue;
    const self = entityById(ctx.snapshot, target.ref);
    const job = self === undefined ? undefined : settlerJobType(self);
    // A coin drill is never queued, and a soldier never enlists again: he stays where he is.
    if (barracks && systems.isFighterJob(ctx.content, job ?? null)) continue;
    const recruit =
      def !== undefined &&
      !systems.isSchoolType(def) &&
      self !== undefined &&
      takesBuilding(ctx, self) &&
      trainsRatherThanEmploys(def, job);
    (recruit ? recruits : walkers).push(target);
  }
  return { kind: 'queueAtBuilding', building, crew, recruits, walkers, tile };
}

export function atSite(
  ctx: BuildingContext,
  units: readonly FormationUnit[],
  site: number,
  tile: Tile,
): BuildingIntent {
  const builders = units.filter((unit) => {
    const self = entityById(ctx.snapshot, unit.ref);
    const job = self !== undefined ? settlerJobType(self) : undefined;
    return job !== undefined && systems.jobCanBuild(ctx.content, job);
  });
  const walkers = units.filter((unit) => !builders.includes(unit));
  return { kind: 'site', site, builders, walkers, tile };
}
