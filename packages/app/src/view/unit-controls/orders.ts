import type { UiCue } from '@open-northland/audio';
import { type ContentSet, type EquipCategory, lastByTypeId } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import {
  type Command,
  type Entity,
  type EquipPickEntry,
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
import {
  buildingTypeOf,
  canOpenChest,
  chestKindOf,
  isBuilding,
  isSettler,
  positionOf,
  settlerJobType,
} from '../../game/snapshot.js';
import { clampTile, nodeBounds, pickNearestAt, pickTopAt, type Tile, worldToTile } from '../picking.js';
import { selectionEquipCommands } from './equip-picker.js';
import { assignFormation, type FormationUnit } from './formation.js';
import { openSchoolDialog } from './school-dialog.js';
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

export interface UnitOrderDeps {
  readonly technologyStatus?: import('@open-northland/sim').Simulation['unlockStatus'] | undefined;
  /** The sim's equip pick-list read seam (`Simulation.equipPickList`); absent, a click on a goods heap
   *  is a walk. */
  readonly equipPickList?: ((entity: number, group: EquipCategory) => readonly EquipPickEntry[]) | undefined;
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
  /** The GUI click the school dialog's buttons confirm with; absent, silent. */
  readonly cue?: (cue: UiCue) => void;
}

/**
 * Every order reports whether it commanded anyone: a press that finds no settler in the selection, or
 * no target under the cursor, issues nothing, and the caller's click feedback follows that answer.
 */
export interface UnitOrderController {
  /** `onBuilding` is a building resolved from a marker rather than the world pixel under the cursor
   *  (a garrison flag hangs far above the tower it stands for). True when the press selected a settler
   *  or gave the selected settlers an order. */
  issueRightClick(event: MouseEvent, onBuilding?: number | null): boolean;
  /** Move the selected gatherers' work flags to a world click; clicking a resource also narrows their
   *  gathering filter to that resource's good. */
  issueSetWorkFlagAt(event: MouseEvent): boolean;
  /** The ground orders name a half-cell node rather than a cursor, so the map overview can issue them
   *  for a spot the camera is nowhere near. Off-map nodes clamp into the map here. */
  issueSetWorkFlag(target: Tile): boolean;
  issueMoveTo(target: Tile): boolean;
  issueAttackMove(target: Tile): boolean;
  /** Strike one enemy of `kind` under the cursor; a click that hits none of them orders nothing. */
  issueAttackTarget(event: MouseEvent, kind: UnitTargetKind): boolean;
  /** Strike the wild creature under the cursor; a click that hits none orders nothing. */
  issueAttackAnimal(event: MouseEvent): boolean;
  dispose(): void;
}

type WalkOrderKind = Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>['kind'];

/** Whether the snapshot settler's fixed `group` slot already holds `goodType`, worn or not. */
function wearsGood(
  components: Readonly<Record<string, unknown>>,
  group: Exclude<EquipCategory, 'misc'>,
  goodType: number,
): boolean {
  const equipment = components.Equipment as
    | Partial<Record<Exclude<EquipCategory, 'misc'>, { readonly goodType?: unknown } | null>>
    | undefined;
  return equipment?.[group]?.goodType === goodType;
}

export function createUnitOrderController(deps: UnitOrderDeps): UnitOrderController {
  let closeSchool: (() => void) | undefined;
  const buildingsByType = lastByTypeId(deps.content.buildings);
  const goodsByType = lastByTypeId(deps.content.goods);

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
    target: Tile,
    movers: readonly FormationUnit[],
    // The whole selection, not just `movers`: standing units keep their ground reserved.
    selected: ReadonlySet<number>,
    kind: WalkOrderKind,
  ): boolean => {
    if (movers.length === 0) return false;
    const { width, height } = nodeBounds(deps.mapSize);
    const seat = clampTile(target, width, height);
    const blocked = occupiedTiles(selected);
    for (const order of assignFormation(movers, seat, width, height, blocked)) {
      deps.enqueue({ kind, entity: order.ref as Entity, x: order.tile.col, y: order.tile.row });
    }
    return true;
  };

  const issueRightClick = (event: MouseEvent, onBuilding?: number | null): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const own = pickTopAt(deps.targets.owned('settler'), world.x, world.y);
    if (own !== null) {
      deps.selectOwnSettler(own);
      deps.openActions({ x: event.clientX, y: event.clientY });
      return true;
    }
    const selected = deps.selected();
    // A selected building, flag or signpost takes no orders: nobody to command, nothing to confirm.
    const commanded = deps.targets.ownedSettlersIn(selected);
    if (commanded.length === 0) return false;
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    if (enemy !== null) return strike(commanded, enemy);
    // A chest nobody selected may open is walked to like any ground.
    const chest = pickTopAt(deps.targets.chests(), world.x, world.y);
    if (chest !== null && openChest(commanded, chest)) return true;
    const goods = deps.targets.goods();
    const pile = pickTopAt(goods, world.x, world.y);
    const pileGood = pile === null ? undefined : goods.find((target) => target.ref === pile)?.goodType;
    if (pileGood !== undefined && wearFromGround(commanded, pileGood)) return true;
    const building = onBuilding ?? pickTopAt(deps.targets.owned('building'), world.x, world.y);
    if (building !== null) {
      const snapshot = deps.snapshot();
      const entity = entityById(snapshot, building);
      const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
      const def = type !== undefined ? buildingsByType.get(type) : undefined;
      if (
        def?.kind === 'training' &&
        def.workers.length === 0 &&
        entity?.components.UnderConstruction === undefined
      ) {
        closeSchool?.();
        closeSchool = openSchoolDialog(
          deps.content,
          snapshot,
          commanded.map((t) => t.ref),
          building,
          deps.enqueue,
          deps.technologyStatus,
          deps.cue,
        );
        return true;
      }
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
        // A home may be reserved before it stands; its household drives wait for completed construction.
        if (def?.kind === 'home') {
          deps.enqueue({ kind: 'assignHouse', entity: target.ref as Entity, house: building as Entity });
          continue;
        }
        // Drilling needs the building standing, so a foundation falls through to employment, whose slots
        // are open from the moment it is placed.
        if (!underConstruction) {
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
      return true;
    }
    return issueWalkOrder(worldToTile(world.x, world.y, deps.elevation), commanded, selected, 'moveUnit');
  };

  /** Send every commanded settler that may open the chest; true when anyone was sent. Filtered here as
   *  the original's default click gates on `Item_IsAbleToOpenChest`, and so a settler the sim would refuse
   *  never lands in the replay log; the sim re-checks each on arrival, so two senders race and the loser
   *  walks back into autonomy. */
  const openChest = (commanded: readonly FormationUnit[], chest: number): boolean => {
    const snapshot = deps.snapshot();
    const target = entityById(snapshot, chest);
    const kind = target === undefined ? undefined : chestKindOf(target);
    if (kind === undefined) return false;
    let sent = false;
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      if (self === undefined || !canOpenChest(self, kind, deps.content)) continue;
      deps.enqueue({ kind: 'openChest', entity: unit.ref as Entity, chest: chest as Entity });
      sent = true;
    }
    return sent;
  };

  /**
   * Send every commanded settler that may wear the clicked good to put it on; true when anyone was sent.
   * The original's default click on a good lying on the ground (`UserControl_GetDefaultInteractionCommand`
   * over a landscape of a good's `landscapetype`): each selected human who can equip the good now and does
   * not already wear that item type gets the equip order by good type, so the sim fetches its nearest
   * reachable unit rather than this exact heap. A misc good (mead, potions, amulets) skips the worn
   * check, as its slots stack. The gate is the sim's pick list, the same read the equip window shows.
   */
  const wearFromGround = (commanded: readonly FormationUnit[], goodType: number): boolean => {
    const pickList = deps.equipPickList;
    const group = goodsByType.get(goodType)?.equip?.category;
    if (pickList === undefined || group === undefined) return false;
    const snapshot = deps.snapshot();
    const wearers = commanded
      .map((unit) => unit.ref)
      .filter((ref) => {
        const self = entityById(snapshot, ref);
        if (self === undefined || (group !== 'misc' && wearsGood(self.components, group, goodType))) {
          return false;
        }
        return pickList(ref, group).some((row) => row.goodType === goodType);
      });
    const commands = selectionEquipCommands(snapshot, wearers, { goodType, group });
    for (const command of commands) deps.enqueue(command);
    return commands.length > 0;
  };

  const strike = (commanded: readonly FormationUnit[], enemy: number): boolean => {
    for (const unit of commanded) {
      deps.enqueue({ kind: 'attackUnit', entity: unit.ref as Entity, target: enemy as Entity });
    }
    return commanded.length > 0;
  };

  const issueAttackTarget = (event: MouseEvent, kind: UnitTargetKind): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const enemy = pickTopAt(
      deps.targets.enemies().filter((p) => p.kind === kind),
      world.x,
      world.y,
    );
    return enemy !== null && strike(deps.targets.ownedSettlersIn(deps.selected()), enemy);
  };

  const issueAttackAnimal = (event: MouseEvent): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const prey = pickTopAt(deps.targets.wildlife(), world.x, world.y);
    return prey !== null && strike(deps.targets.ownedSettlersIn(deps.selected()), prey);
  };

  const issueMoveTo = (target: Tile): boolean => {
    const selected = deps.selected();
    return issueWalkOrder(target, deps.targets.ownedSettlersIn(selected), selected, 'moveUnit');
  };

  const issueAttackMove = (target: Tile): boolean => {
    const selected = deps.selected();
    return issueWalkOrder(target, deps.targets.ownedSettlersIn(selected), selected, 'attackMoveUnit');
  };

  const issueSetWorkFlag = (target: Tile, goodType?: number): boolean => {
    const movers = deps.targets.ownedSettlersIn(deps.selected());
    if (movers.length === 0) return false;
    const { width, height } = nodeBounds(deps.mapSize);
    const flag = clampTile(target, width, height);
    for (const mover of movers) {
      deps.enqueue({
        kind: 'setWorkFlag',
        entity: mover.ref as Entity,
        x: flag.col,
        y: flag.row,
      });
      if (goodType === undefined) continue;
      // This is player intent; the sim is the authority on whether each selected settler may gather the
      // clicked good. Keeping the app out of that gate also avoids dropping the filter against a stale
      // render/snapshot pair while still letting setWorkFlag reject non-gatherers normally.
      deps.enqueue({ kind: 'setGatherGood', entity: mover.ref as Entity, goodType });
    }
    return true;
  };

  const issueSetWorkFlagAt = (event: MouseEvent): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const resources = deps.targets.resources();
    const resource = pickNearestAt(resources, world.x, world.y);
    const goodType =
      resource === null ? undefined : resources.find((target) => target.ref === resource)?.goodType;
    return issueSetWorkFlag(worldToTile(world.x, world.y, deps.elevation), goodType);
  };

  return {
    dispose: () => closeSchool?.(),
    issueRightClick,
    issueSetWorkFlagAt,
    issueSetWorkFlag,
    issueMoveTo,
    issueAttackMove,
    issueAttackTarget,
    issueAttackAnimal,
  };
}
