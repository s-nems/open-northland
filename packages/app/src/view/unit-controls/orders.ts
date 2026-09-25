import type { UiCue } from '@open-northland/audio';
import { type ContentSet, type EquipCategory, lastByTypeId } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import {
  type Command,
  type Entity,
  type EquipPickEntry,
  entityById,
  type GroupMember,
  type GroupWorker,
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
  builderCrewSize,
  buildingTypeOf,
  buildSiteOf,
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
import { type TradeHouseRule, tradeHousePick } from './highlights/index.js';
import { openSchoolDialog, type SchoolDialog } from './school-dialog.js';
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

export interface UnitOrderDeps {
  readonly uiscale?: number;
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
  /** The sim's trade-stop rule; absent, a trader's right-click puts no house on its route. */
  readonly canAttachTradeHouse?: TradeHouseRule | undefined;
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
  /** The trade-route toggle for the selected traders riding inside their carts, which the settlers'
   *  click skips as they stand nowhere on the map. True when any of them took the house. */
  issueRiderTradeHouse(event: MouseEvent, onBuilding?: number | null): boolean;
  /** Move the selected gatherers' work flags to a world click; clicking a resource also narrows their
   *  gathering filter to that resource's good. */
  issueSetWorkFlagAt(event: MouseEvent): boolean;
  /** The ground orders name a half-cell node rather than a cursor, so the map overview can issue them
   *  for a spot the camera is nowhere near. Off-map nodes clamp into the map here. `units`, when given,
   *  narrows these orders to the selected settlers an armed order was issued for. */
  issueSetWorkFlag(target: Tile, units?: readonly number[]): boolean;
  issueMoveTo(target: Tile, units?: readonly number[]): boolean;
  issueAttackMove(target: Tile, units?: readonly number[]): boolean;
  /** Strike one enemy of an accepted kind under the cursor; a click that hits none orders nothing. */
  issueAttackTarget(
    event: MouseEvent,
    kind: UnitTargetKind | readonly UnitTargetKind[],
    units?: readonly number[],
  ): boolean;
  /** Strike the wild creature under the cursor; a click that hits none orders nothing. */
  issueAttackAnimal(event: MouseEvent, units?: readonly number[]): boolean;
  /** Offer `units` the courses of the school `house`; false when none of them may learn there. */
  openSchool(house: number, units: readonly number[]): boolean;
  refresh(): void;
  setUiScale(scale: number): Promise<void>;
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
  let school: SchoolDialog | undefined;
  let uiScale = deps.uiscale ?? 1;
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
  const issueWalkOrder = (target: Tile, movers: readonly FormationUnit[], kind: WalkOrderKind): boolean => {
    if (movers.length === 0) return false;
    const { width, height } = nodeBounds(deps.mapSize);
    const seat = clampTile(target, width, height);
    // Only the movers vacate their nodes; a selected settler the order skips keeps its ground.
    const blocked = occupiedTiles(new Set(movers.map((mover) => mover.ref)));
    for (const order of assignFormation(movers, seat, width, height, blocked)) {
      deps.enqueue({ kind, entity: order.ref as Entity, x: order.tile.col, y: order.tile.row });
    }
    return true;
  };

  const openSchool = (house: number, units: readonly number[]): boolean => {
    school?.dispose();
    school = openSchoolDialog({
      content: deps.content,
      snapshot: deps.snapshot,
      settlers: units,
      house,
      enqueue: deps.enqueue,
      status: deps.technologyStatus,
      cue: deps.cue,
      scale: uiScale,
    });
    return school !== undefined;
  };

  const issueRightClick = (event: MouseEvent, onBuilding?: number | null): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const own = pickTopAt(deps.targets.owned('settler'), world.x, world.y);
    if (own !== null) {
      deps.selectOwnSettler(own);
      deps.openActions({ x: event.clientX, y: event.clientY });
      return true;
    }
    // A selected building, flag or signpost takes no orders: nobody to command, nothing to confirm.
    const commanded = deps.targets.ownedSettlersIn(deps.selected());
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
    const routed = routeTradeHouse(
      commanded,
      onBuilding ?? pickTopAt(deps.targets.buildings(), world.x, world.y),
    );
    const others = routed.size === 0 ? commanded : commanded.filter((unit) => !routed.has(unit.ref));
    if (others.length === 0) return true;
    const building = onBuilding ?? pickTopAt(deps.targets.owned('building'), world.x, world.y);
    if (building !== null) return orderAtBuilding(event, others, building) || routed.size > 0;
    return issueWalkOrder(worldToTile(world.x, world.y, deps.elevation), others, 'moveUnit');
  };

  /** The right-click ladder over an own building; true when it opened the school dialog or enqueued an
   *  order, so a building that takes none of the selection stays silent. */
  const orderAtBuilding = (
    event: MouseEvent,
    commanded: readonly FormationUnit[],
    building: number,
  ): boolean => {
    const snapshot = deps.snapshot();
    const entity = entityById(snapshot, building);
    const type = entity !== undefined ? buildingTypeOf(entity) : undefined;
    const def = type !== undefined ? buildingsByType.get(type) : undefined;
    const underConstruction = entity?.components.UnderConstruction !== undefined;
    const damaged = entity?.components.Damaged !== undefined;
    const slots = def?.workers;
    const employsTrade = (jobType: number | undefined): boolean =>
      jobType !== undefined &&
      (slots ?? []).some((slot) => canonicalJobType(slot.jobType) === canonicalJobType(jobType));
    let ordered = false;
    const order = (command: PlayerCommand): void => {
      deps.enqueue(command);
      ordered = true;
    };
    // A foundation or damaged building takes a builder as its crew before anything else, as in the
    // original, while a standing building's repair crew has room. A site's own worker takes a workplace
    // post and carries materials while it is built, then keeps the seat when it stands, so only a builder
    // without a matching workplace slot joins the crew.
    let crewRoom =
      entity === undefined || underConstruction
        ? Number.POSITIVE_INFINITY
        : systems.REPAIR_CREW_LIMIT - builderCrewSize(snapshot, building);
    const crew = new Set<number>();
    if (entity !== undefined && (underConstruction || damaged)) {
      for (const target of commanded) {
        const self = entityById(snapshot, target.ref);
        const currentJob = self !== undefined ? settlerJobType(self) : undefined;
        if (
          currentJob === undefined ||
          !systems.jobCanBuild(deps.content, currentJob) ||
          employsTrade(currentJob)
        ) {
          continue;
        }
        const member = self !== undefined && buildSiteOf(self) === building;
        if (!member && crewRoom <= 0) continue;
        if (!member) crewRoom--;
        crew.add(target.ref);
        order({ kind: 'assignBuilder', entity: target.ref as Entity, site: building as Entity });
      }
    }
    const rest = commanded.filter((target) => !crew.has(target.ref));
    if (def !== undefined && systems.isSchoolType(def) && !underConstruction) {
      if (rest.length === 0) return ordered;
      const opened = openSchool(
        building,
        rest.map((t) => t.ref),
      );
      // The press's default would pull focus off the modal it just opened.
      if (opened) event.preventDefault();
      return opened || ordered;
    }
    // Homes and workplaces have limited room, so each goes out as one group order and the sim seats
    // the homeless and the unemployed first.
    const movers: GroupMember[] = [];
    const workers: GroupWorker[] = [];
    for (const target of rest) {
      const self = entityById(snapshot, target.ref);
      const currentJob = self !== undefined ? settlerJobType(self) : undefined;
      // A home may be reserved before it stands; its household drives wait for completed construction.
      if (def?.kind === 'home') {
        movers.push({ entity: target.ref as Entity });
        continue;
      }
      // Drilling needs the building standing, so a foundation falls through to employment, whose slots
      // are open from the moment it is placed.
      if (!underConstruction && trainsRatherThanEmploys(def, currentJob)) {
        order({ kind: 'trainSoldier', entity: target.ref as Entity, house: building as Entity });
        continue;
      }
      // The sim gates every candidate in the priority list, so an unoffered or full trade falls through.
      const jobPriority = assignmentPriorityFor(currentJob, slots);
      if (jobPriority.length > 0) workers.push({ entity: target.ref as Entity, jobPriority });
    }
    if (movers.length > 0) order({ kind: 'assignHouseGroup', members: movers, house: building as Entity });
    if (workers.length > 0) {
      order({ kind: 'assignWorkerGroup', building: building as Entity, members: workers });
    }
    return ordered;
  };

  /**
   * Original behavior: a trader's right-click on a standing house puts it on the trade route, another
   * tribe's house included, and takes it off when the route already names it. Which houses a route
   * takes is the sim's rule. The traders that took the order are returned; the rest of the selection
   * handles the click as usual.
   */
  const routeTradeHouse = (
    commanded: readonly { readonly ref: number }[],
    house: number | null,
  ): Set<number> => {
    const routed = new Set<number>();
    if (house === null) return routed;
    const snapshot = deps.snapshot();
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      if (self === undefined || !systems.isTraderJob(deps.content, settlerJobType(self) ?? null)) continue;
      if (tradeHousePick.onRoute(snapshot, house, unit.ref)) {
        deps.enqueue({ kind: 'detachTradeHouse', entity: unit.ref as Entity, house: house as Entity });
      } else if (deps.canAttachTradeHouse?.(unit.ref, house) === true) {
        deps.enqueue({ kind: 'attachTradeHouse', entity: unit.ref as Entity, house: house as Entity });
      } else continue;
      routed.add(unit.ref);
    }
    return routed;
  };

  const issueRiderTradeHouse = (event: MouseEvent, onBuilding?: number | null): boolean => {
    const snapshot = deps.snapshot();
    const riders: { readonly ref: number }[] = [];
    for (const ref of deps.selected()) {
      const e = entityById(snapshot, ref);
      if (e !== undefined && e.components.Rider !== undefined && positionOf(e) === undefined)
        riders.push({ ref });
    }
    if (riders.length === 0) return false;
    const world = deps.toWorld(event.clientX, event.clientY);
    return (
      routeTradeHouse(riders, onBuilding ?? pickTopAt(deps.targets.buildings(), world.x, world.y)).size > 0
    );
  };

  /** Send every commanded settler that may open the chest; true when anyone was sent. Filtered here as
   *  the original's default click offers it only to a settler that may open it, and so a settler the
   *  sim would refuse never lands in the replay log; the sim re-checks each on arrival, so two senders
   *  race and the loser walks back into autonomy. */
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
   * The original's default click on a good lying on the ground (a landscape
   * of a good's `landscapetype`): each selected human who can equip the good now and does
   * not already wear that item type gets the equip order by good type, so the sim fetches its nearest
   * reachable unit rather than this exact heap. A misc good (mead, potions, amulets) skips the worn
   * check, as its slots stack. The gate is the sim's pick list, the same read the equip window shows.
   * Unlike an order from the equip window or the ring, the settler does not walk back to where it stood.
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
    const commands = selectionEquipCommands(snapshot, wearers, { goodType, group }, { skipReturn: true });
    for (const command of commands) deps.enqueue(command);
    return commands.length > 0;
  };

  /** The selected settlers an order goes to: all of them, or only `units` among them. */
  const commandedAmong = (units?: readonly number[]): FormationUnit[] => {
    const commanded = deps.targets.ownedSettlersIn(deps.selected());
    if (units === undefined) return commanded;
    const eligible = new Set(units);
    return commanded.filter((unit) => eligible.has(unit.ref));
  };

  const strike = (commanded: readonly FormationUnit[], enemy: number): boolean => {
    for (const unit of commanded) {
      deps.enqueue({ kind: 'attackUnit', entity: unit.ref as Entity, target: enemy as Entity });
    }
    return commanded.length > 0;
  };

  const issueAttackTarget = (
    event: MouseEvent,
    kind: UnitTargetKind | readonly UnitTargetKind[],
    units?: readonly number[],
  ): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const accepts =
      typeof kind === 'string'
        ? (candidate: UnitTargetKind) => candidate === kind
        : (candidate: UnitTargetKind) => kind.includes(candidate);
    const enemy = pickTopAt(
      deps.targets
        .enemies({ neutralWalls: true })
        .filter((p) =>
          p.kind === 'settler' || p.kind === 'building' || p.kind === 'palisade' ? accepts(p.kind) : false,
        ),
      world.x,
      world.y,
    );
    return enemy !== null && strike(commandedAmong(units), enemy);
  };

  const issueAttackAnimal = (event: MouseEvent, units?: readonly number[]): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const prey = pickTopAt(deps.targets.wildlife(), world.x, world.y);
    return prey !== null && strike(commandedAmong(units), prey);
  };

  const issueMoveTo = (target: Tile, units?: readonly number[]): boolean =>
    issueWalkOrder(target, commandedAmong(units), 'moveUnit');

  const issueAttackMove = (target: Tile, units?: readonly number[]): boolean =>
    issueWalkOrder(target, commandedAmong(units), 'attackMoveUnit');

  const setWorkFlags = (movers: readonly FormationUnit[], target: Tile, goodType?: number): boolean => {
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

  const issueSetWorkFlag = (target: Tile, units?: readonly number[]): boolean =>
    setWorkFlags(commandedAmong(units), target);

  const issueSetWorkFlagAt = (event: MouseEvent): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const resources = deps.targets.resources();
    const resource = pickNearestAt(resources, world.x, world.y);
    const goodType =
      resource === null ? undefined : resources.find((target) => target.ref === resource)?.goodType;
    return setWorkFlags(commandedAmong(), worldToTile(world.x, world.y, deps.elevation), goodType);
  };

  return {
    refresh: () => school?.refresh(),
    setUiScale: async (scale) => {
      uiScale = scale;
      await school?.setUiScale(scale);
    },
    dispose: () => school?.dispose(),
    issueRightClick,
    issueRiderTradeHouse,
    issueSetWorkFlagAt,
    issueSetWorkFlag,
    issueMoveTo,
    issueAttackMove,
    issueAttackTarget,
    issueAttackAnimal,
    openSchool,
  };
}
