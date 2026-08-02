import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import {
  type Command,
  type Entity,
  entityById,
  nodeOfPosition,
  type WorldSnapshot,
} from '@open-northland/sim';
import { JOB_BUILDER } from '../../catalog/jobs.js';
import { assignmentPriorityFor, trainsRatherThanEmploys } from '../../game/sandbox/index.js';
import { buildingTypeOf, isBuilding, isSettler, positionOf, settlerJobType } from '../../game/snapshot.js';
import { clampTile, nodeBounds, pickTopAt, worldToTile } from '../picking.js';
import { assignFormation, type FormationUnit } from './formation.js';
import type { UnitTargets } from './unit-targets.js';

export interface UnitOrderDeps {
  readonly selected: ReadonlySet<number>;
  readonly targets: UnitTargets;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: Command) => void;
  readonly selectOwnSettler: (id: number) => void;
  /** Bring up the settler action menu, pinned on the click's client point (the original stores the cursor). */
  readonly openActions: (atClient: { readonly x: number; readonly y: number }) => void;
}

export interface UnitOrderController {
  issueRightClick(event: MouseEvent): void;
  issueSetWorkFlag(event: MouseEvent): void;
  /** Send the selection to the clicked spot fighting everything on the way (the armed attack-move click). */
  issueAttackMove(event: MouseEvent): void;
}

/** The two walk orders a formation click can issue: go there, or fight your way there. */
type WalkOrderKind = Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>['kind'];

/** Route right-click RTS intent into the one-way sim command seam. */
export function createUnitOrderController(deps: UnitOrderDeps): UnitOrderController {
  const buildingsByType = lastByTypeId(deps.content.buildings);

  const occupiedTiles = (exclude: ReadonlySet<number>): ((col: number, row: number) => boolean) => {
    const occupied = new Set<string>();
    for (const entity of deps.snapshot().entities) {
      if (exclude.has(entity.id)) continue;
      if (!isSettler(entity) && !isBuilding(entity)) continue;
      const position = positionOf(entity);
      if (position === undefined) continue;
      const node = nodeOfPosition(position.x, position.y);
      occupied.add(`${node.hx},${node.hy}`);
    }
    return (col, row) => occupied.has(`${col},${row}`);
  };

  // A carrying settler is ordered like any other - the sim makes it set its load down first, then walk
  // (moveUnit / PlayerOrder.pendingGoal). So it stays in the formation; no client-side filtering.
  const issueWalkOrder = (event: MouseEvent, movers: readonly FormationUnit[], kind: WalkOrderKind): void => {
    if (movers.length === 0) return;
    const { width, height } = nodeBounds(deps.mapSize);
    const world = deps.toWorld(event.clientX, event.clientY);
    const target = clampTile(worldToTile(world.x, world.y, deps.elevation), width, height);
    const blocked = occupiedTiles(deps.selected);
    for (const order of assignFormation(movers, target, width, height, blocked)) {
      deps.enqueue({ kind, entity: order.ref as Entity, x: order.tile.col, y: order.tile.row });
    }
  };

  const issueRightClick = (event: MouseEvent): void => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const own = pickTopAt(deps.targets.owned('settler'), world.x, world.y);
    if (own !== null) {
      deps.selectOwnSettler(own);
      deps.openActions({ x: event.clientX, y: event.clientY });
      return;
    }
    if (deps.selected.size === 0) return;
    const commanded = deps.targets.ownedSettlersIn(deps.selected);
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    if (enemy !== null) {
      for (const target of commanded) {
        deps.enqueue({ kind: 'attackUnit', entity: target.ref as Entity, target: enemy as Entity });
      }
      return;
    }
    const building = pickTopAt(deps.targets.owned('building'), world.x, world.y);
    if (building !== null) {
      const snapshot = deps.snapshot();
      const entity = entityById(snapshot, building);
      const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
      const def = type !== undefined ? buildingsByType.get(type) : undefined;
      // A construction site splits by trade: a BUILDER is put on the foundation (the original's "put a
      // builder on a foundation"), anyone else is hired into the building it will become - its worker
      // slots are open from the moment the foundation is placed, and the staff waits at the site.
      if (entity?.components.UnderConstruction !== undefined) {
        for (const target of commanded) {
          const self = entityById(snapshot, target.ref);
          const currentJob = self !== undefined ? settlerJobType(self) : undefined;
          if (currentJob === JOB_BUILDER) {
            deps.enqueue({ kind: 'assignBuilder', entity: target.ref as Entity, site: building as Entity });
            continue;
          }
          const jobPriority = assignmentPriorityFor(currentJob, def?.workers);
          if (jobPriority.length === 0) continue;
          deps.enqueue({
            kind: 'assignWorker',
            entity: target.ref as Entity,
            building: building as Entity,
            jobPriority,
          });
        }
        return;
      }
      // A built home takes the move-in path: right-click = "live here" for every selected settler (the
      // family moves as one - the sim's assignHouse validates the free family slot and no-ops otherwise).
      if (def?.kind === 'home') {
        for (const target of commanded) {
          deps.enqueue({ kind: 'assignHouse', entity: target.ref as Entity, house: building as Entity });
        }
        return;
      }
      const slots = def?.workers;
      // One command per selected settler, its priority computed from ITS current trade: keep it where the
      // building offers that slot (a miller stays a miller at the mill; a hunter stays a gatherer at a
      // warehouse's gatherer slot), else the building's default order (craftsman → carrier, gatherers
      // excluded for a non-gatherer - so a plain settler on a warehouse becomes a carrier). The sim gates
      // every candidate, so an unoffered/full trade just falls through.
      for (const target of commanded) {
        const self = entityById(snapshot, target.ref);
        const currentJob = self !== undefined ? settlerJobType(self) : undefined;
        if (trainsRatherThanEmploys(def, currentJob)) {
          deps.enqueue({ kind: 'trainSoldier', entity: target.ref as Entity, house: building as Entity });
          continue;
        }
        const jobPriority = assignmentPriorityFor(currentJob, slots);
        if (jobPriority.length === 0) continue;
        deps.enqueue({
          kind: 'assignWorker',
          entity: target.ref as Entity,
          building: building as Entity,
          jobPriority,
        });
      }
      return;
    }
    issueWalkOrder(event, commanded, 'moveUnit');
  };

  const issueAttackMove = (event: MouseEvent): void => {
    issueWalkOrder(event, deps.targets.ownedSettlersIn(deps.selected), 'attackMoveUnit');
  };

  const issueSetWorkFlag = (event: MouseEvent): void => {
    const movers = deps.targets.ownedSettlersIn(deps.selected);
    if (movers.length === 0) return;
    const { width, height } = nodeBounds(deps.mapSize);
    const world = deps.toWorld(event.clientX, event.clientY);
    const target = clampTile(worldToTile(world.x, world.y, deps.elevation), width, height);
    for (const mover of movers) {
      deps.enqueue({
        kind: 'setWorkFlag',
        entity: mover.ref as Entity,
        x: target.col,
        y: target.row,
      });
    }
  };

  return { issueRightClick, issueSetWorkFlag, issueAttackMove };
}
