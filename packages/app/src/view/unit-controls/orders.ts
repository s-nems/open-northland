import { type ContentSet, indexById } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import { type Command, type Entity, nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { assignmentPriorityFor } from '../../game/sandbox/index.js';
import {
  buildingTypeOf,
  entityById,
  isBuilding,
  isSettler,
  positionOf,
  settlerJobType,
} from '../../game/snapshot.js';
import { clampTile, nodeBounds, type Pickable, pickTopAt, worldToTile } from '../picking.js';
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
  readonly openActions: () => void;
}

export interface UnitOrderController {
  issueRightClick(event: MouseEvent): void;
  issueSetWorkFlag(event: MouseEvent): void;
}

/** Route right-click RTS intent into the one-way sim command seam. */
export function createUnitOrderController(deps: UnitOrderDeps): UnitOrderController {
  const buildingsByType = indexById(deps.content.buildings);

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

  const issueMoveOrder = (event: MouseEvent, ownSettlers: readonly Pickable[]): void => {
    if (deps.selected.size === 0) return;
    const movers: FormationUnit[] = ownSettlers.filter((target) => deps.selected.has(target.ref));
    if (movers.length === 0) return;
    const { width, height } = nodeBounds(deps.mapSize);
    const world = deps.toWorld(event.clientX, event.clientY);
    const target = clampTile(worldToTile(world.x, world.y, deps.elevation), width, height);
    const blocked = occupiedTiles(deps.selected);
    for (const order of assignFormation(movers, target, width, height, blocked)) {
      deps.enqueue({
        kind: 'moveUnit',
        entity: order.ref as Entity,
        x: order.tile.col,
        y: order.tile.row,
      });
    }
  };

  const issueRightClick = (event: MouseEvent): void => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const ownSettlers = deps.targets.owned('settler');
    const own = pickTopAt(ownSettlers, world.x, world.y);
    if (own !== null) {
      deps.selectOwnSettler(own);
      deps.openActions();
      return;
    }
    if (deps.selected.size === 0) return;
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    if (enemy !== null) {
      for (const target of ownSettlers) {
        if (deps.selected.has(target.ref)) {
          deps.enqueue({ kind: 'attackUnit', entity: target.ref as Entity, target: enemy as Entity });
        }
      }
      return;
    }
    const building = pickTopAt(deps.targets.owned('building'), world.x, world.y);
    if (building !== null) {
      const snapshot = deps.snapshot();
      const entity = entityById(snapshot, building);
      // A construction site takes the builder-assignment path (the original's "put a builder on a
      // foundation"): every selected settler gets the order, and the sim binds only the builder trade
      // (a non-builder is a logged no-op — a site offers no worker jobs to fall back to).
      if (entity?.components.UnderConstruction !== undefined) {
        for (const target of ownSettlers) {
          if (deps.selected.has(target.ref)) {
            deps.enqueue({ kind: 'assignBuilder', entity: target.ref as Entity, site: building as Entity });
          }
        }
        return;
      }
      const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
      const slots = type !== undefined ? buildingsByType.get(type)?.workers : undefined;
      // One command per selected settler, its priority computed from ITS current trade: keep it where the
      // building offers that slot (a miller stays a miller at the mill; a hunter stays a gatherer at a
      // warehouse's gatherer slot), else the building's default order (craftsman → carrier, gatherers
      // excluded for a non-gatherer — so a plain settler on a warehouse becomes a carrier). The sim gates
      // every candidate, so an unoffered/full trade just falls through.
      for (const target of ownSettlers) {
        if (!deps.selected.has(target.ref)) continue;
        const self = entityById(snapshot, target.ref);
        const currentJob = self !== undefined ? settlerJobType(self) : undefined;
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
    issueMoveOrder(event, ownSettlers);
  };

  const issueSetWorkFlag = (event: MouseEvent): void => {
    if (deps.selected.size === 0) return;
    const movers = deps.targets.owned('settler').filter((target) => deps.selected.has(target.ref));
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

  return { issueRightClick, issueSetWorkFlag };
}
