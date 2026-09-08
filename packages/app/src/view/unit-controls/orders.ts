import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import {
  type Command,
  type Entity,
  entityById,
  nodeOfPosition,
  type PlayerCommand,
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
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

export interface UnitOrderDeps {
  readonly selected: () => ReadonlySet<number>;
  readonly targets: UnitTargets;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  readonly selectOwnSettler: (id: number) => void;
  readonly openActions: (atClient: { readonly x: number; readonly y: number }) => void;
}

export interface UnitOrderController {
  /** `onBuilding` is a building resolved from a marker rather than the world pixel under the cursor
   *  (a garrison flag hangs far above the tower it stands for). */
  issueRightClick(event: MouseEvent, onBuilding?: number | null): void;
  issueSetWorkFlag(event: MouseEvent): void;
  issueMoveTo(event: MouseEvent): void;
  issueAttackMove(event: MouseEvent): void;
  /** Strike one enemy of `kind` under the cursor; a click that hits none of them orders nothing. */
  issueAttackTarget(event: MouseEvent, kind: UnitTargetKind): void;
  /** Strike the wild creature under the cursor; a click that hits none orders nothing. */
  issueAttackAnimal(event: MouseEvent): void;
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
  const issueWalkOrder = (
    event: MouseEvent,
    movers: readonly FormationUnit[],
    // The whole selection, not just `movers`: standing units keep their ground reserved.
    selected: ReadonlySet<number>,
    kind: WalkOrderKind,
  ): void => {
    if (movers.length === 0) return;
    const { width, height } = nodeBounds(deps.mapSize);
    const world = deps.toWorld(event.clientX, event.clientY);
    const target = clampTile(worldToTile(world.x, world.y, deps.elevation), width, height);
    const blocked = occupiedTiles(selected);
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
    const selected = deps.selected();
    if (selected.size === 0) return;
    const commanded = deps.targets.ownedSettlersIn(selected);
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    if (enemy !== null) {
      strike(commanded, enemy);
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
    issueWalkOrder(event, commanded, selected, 'moveUnit');
  };

  const strike = (commanded: readonly FormationUnit[], enemy: number): void => {
    for (const unit of commanded) {
      deps.enqueue({ kind: 'attackUnit', entity: unit.ref as Entity, target: enemy as Entity });
    }
  };

  const issueAttackTarget = (event: MouseEvent, kind: UnitTargetKind): void => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const enemy = pickTopAt(
      deps.targets.enemies().filter((p) => p.kind === kind),
      world.x,
      world.y,
    );
    if (enemy !== null) strike(deps.targets.ownedSettlersIn(deps.selected()), enemy);
  };

  const issueAttackAnimal = (event: MouseEvent): void => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const prey = pickTopAt(deps.targets.wildlife(), world.x, world.y);
    if (prey !== null) strike(deps.targets.ownedSettlersIn(deps.selected()), prey);
  };

  const issueMoveTo = (event: MouseEvent): void => {
    const selected = deps.selected();
    issueWalkOrder(event, deps.targets.ownedSettlersIn(selected), selected, 'moveUnit');
  };

  const issueAttackMove = (event: MouseEvent): void => {
    const selected = deps.selected();
    issueWalkOrder(event, deps.targets.ownedSettlersIn(selected), selected, 'attackMoveUnit');
  };

  const issueSetWorkFlag = (event: MouseEvent): void => {
    const movers = deps.targets.ownedSettlersIn(deps.selected());
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

  return {
    issueRightClick,
    issueSetWorkFlag,
    issueMoveTo,
    issueAttackMove,
    issueAttackTarget,
    issueAttackAnimal,
  };
}
