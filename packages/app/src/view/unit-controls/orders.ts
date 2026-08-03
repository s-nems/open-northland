import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import {
  type Command,
  type Entity,
  entityById,
  nodeOfPosition,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  assignmentPriorityFor,
  canonicalJobType,
  trainsRatherThanEmploys,
} from '../../game/sandbox/index.js';
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
  readonly openActions: (atClient: { readonly x: number; readonly y: number }) => void;
}

export interface UnitOrderController {
  /** `onBuilding` is a building resolved from a marker rather than the world pixel under the cursor
   *  (a garrison flag hangs far above the tower it stands for). */
  issueRightClick(event: MouseEvent, onBuilding?: number | null): void;
  issueSetWorkFlag(event: MouseEvent): void;
  issueAttackMove(event: MouseEvent): void;
}

type WalkOrderKind = Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>['kind'];

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

  // A carrying settler stays in the formation: the sim makes it set its load down before walking, so
  // there is no client-side filtering.
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

  const issueRightClick = (event: MouseEvent, onBuilding?: number | null): void => {
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
    const building = onBuilding ?? pickTopAt(deps.targets.owned('building'), world.x, world.y);
    if (building !== null) {
      const snapshot = deps.snapshot();
      const entity = entityById(snapshot, building);
      const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
      const def = type !== undefined ? buildingsByType.get(type) : undefined;
      const slots = def?.workers;
      const underConstruction = entity?.components.UnderConstruction !== undefined;
      const employsTrade = (jobType: number | undefined): boolean =>
        jobType !== undefined &&
        (slots ?? []).some((slot) => canonicalJobType(slot.jobType) === canonicalJobType(jobType));
      for (const target of commanded) {
        const self = entityById(snapshot, target.ref);
        const currentJob = self !== undefined ? settlerJobType(self) : undefined;
        // A site that employs this very trade posts instead of pinning a builder: the sim sends a posted
        // builder to raise its own site, and it keeps the seat once the workshop stands.
        const joinsCrew =
          currentJob !== undefined &&
          systems.jobCanBuild(deps.content, currentJob) &&
          !employsTrade(currentJob);
        if (underConstruction && joinsCrew) {
          deps.enqueue({ kind: 'assignBuilder', entity: target.ref as Entity, site: building as Entity });
          continue;
        }
        // Moving in and drilling need the building standing, so a foundation falls through to employment,
        // whose slots are open from the moment it is placed.
        if (!underConstruction) {
          if (def?.kind === 'home') {
            deps.enqueue({ kind: 'assignHouse', entity: target.ref as Entity, house: building as Entity });
            continue;
          }
          if (trainsRatherThanEmploys(def, currentJob)) {
            deps.enqueue({ kind: 'trainSoldier', entity: target.ref as Entity, house: building as Entity });
            continue;
          }
        }
        // The sim gates every candidate in the priority list, so an unoffered or full trade falls through.
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
