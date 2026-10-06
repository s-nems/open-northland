import type { UiCue } from '@open-northland/audio';
import { type ContentSet, type EquipCategory, lastByTypeId } from '@open-northland/data';
import type { ElevationField, OrderMarkerKind } from '@open-northland/render';
import {
  type Command,
  type Entity,
  type EquipPickEntry,
  entityById,
  type FormationSlotGroup,
  type GroupMember,
  type GroupWorker,
  type HalfCellNode,
  MAX_UNIT_ORDER_MEMBERS,
  nodeOfPosition,
  type PlayerCommand,
  systems,
  type UnitSelectionCommand,
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
  commandedVehicleOf,
  isBuilding,
  isSettler,
  isVehicle,
  num,
  positionOf,
  settlerJobType,
  vehicleSeatsOf,
  workplaceOf,
} from '../../game/snapshot.js';
import { clampTile, nodeBounds, pickNearestAt, pickTopAt, type Tile, worldToTile } from '../picking.js';
import type { AnsweredOrders } from './answered-orders.js';
import { selectionEquipCommands } from './equip-picker.js';
import { assignFormation, type FormationUnit, pairFormation } from './formation.js';
import { enqueueArmyOrder, enqueueUnitSelection } from './group-orders.js';
import { tradeHousePick } from './highlights/index.js';
import { createPendingGroundOrders, type PendingGroundOrders } from './pending-ground-orders.js';
import { openSchoolDialog, type SchoolDialog } from './school-dialog.js';
import type { TechnologyStatusRead } from './types.js';
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

export interface UnitOrderDeps {
  readonly uiscale?: number;
  /** Fresh legal destinations from the simulation, requested only as a ground click lands. */
  readonly requestFormationSlots?:
    | ((
        target: HalfCellNode,
        members: readonly Entity[],
        rowSpacing: 1 | 2,
      ) => Promise<readonly FormationSlotGroup[] | null>)
    | undefined;
  readonly pendingGroundOrders?: PendingGroundOrders | undefined;
  /** Defer this press's normal acknowledgement until its queried formation is accepted. */
  readonly deferGroundConfirmation?: (() => () => void) | undefined;
  readonly technologyStatus?: TechnologyStatusRead | undefined;
  /** Bumped when a `technologyStatus` answer changes, which the school dialog rebuilds on. */
  readonly technologyVersion?: (() => number) | undefined;
  /** The sim's equip pick-list (`SessionHost.equipPickList`), asked as the click lands; absent, a click
   *  on a goods heap is a walk. */
  readonly requestEquipPicks?:
    | ((entity: number, group: EquipCategory) => Promise<readonly EquipPickEntry[]>)
    | undefined;
  /** Where the orders a host answer decides wait for it. */
  readonly answered: AnsweredOrders;
  readonly selected: () => ReadonlySet<number>;
  readonly targets: UnitTargets;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly onOrderLimit?: (() => void) | undefined;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  readonly selectOwnSettler: (id: number) => void;
  readonly openActions: (atClient: { readonly x: number; readonly y: number }) => void;
  /** The GUI click the school dialog's buttons confirm with; absent, silent. */
  readonly cue?: (cue: UiCue) => void;
  /** The sim's trade-stop rule, asked as the click lands; absent, a trader's right-click puts no house on
   *  its route. */
  readonly askAttachTradeHouse?: ((trader: number, house: number) => Promise<boolean>) | undefined;
  /** Acknowledges a walk or march on the ground where it was aimed; absent, nothing is drawn. */
  readonly markOrder?: ((node: Tile, kind: OrderMarkerKind) => void) | undefined;
}

/**
 * Every order reports whether it commanded anyone: a press that finds no settler in the selection, or
 * no target under the cursor, issues nothing, and the caller's click feedback follows that answer.
 */
export interface UnitOrderController {
  /** `onBuilding` is a building resolved from a marker rather than the world pixel under the cursor
   *  (a garrison flag hangs far above the tower it stands for). True when the press selected a settler
   *  or gave the selected settlers an order. With Shift, it queues a walk to the ground. */
  issueRightClick(event: MouseEvent, onBuilding?: number | null): boolean;
  /** The trade-route toggle for the selected traders off the map (riding inside a cart, or inside a
   *  house), which the settlers' click skips, and for the crew of a selected cart, whose window shows its
   *  trader's route. True when any of them took the click; `onNoneTook` runs once the sim refused every
   *  one asked about, so the cart can take the click instead. */
  issueRiderTradeHouse(
    event: MouseEvent,
    onBuilding: number | null | undefined,
    onNoneTook: () => void,
  ): boolean;
  /** Move the selected gatherers' work flags to a world click; clicking a resource also narrows their
   *  gathering filter to that resource's good. */
  issueSetWorkFlagAt(event: MouseEvent): boolean;
  /** The ground orders name a half-cell node rather than a cursor, so the map overview can issue them
   *  for a spot the camera is nowhere near. Off-map nodes clamp into the map here. `units`, when given,
   *  narrows these orders to the selected settlers an armed order was issued for. A `queued` walk waits
   *  behind each settler's current order (shift-click). */
  issueSetWorkFlag(target: Tile, units?: readonly number[], unassignFirst?: boolean): boolean;
  issueMoveTo(target: Tile, units?: readonly number[], queued?: boolean): boolean;
  issueAttackMove(target: Tile, units?: readonly number[], queued?: boolean): boolean;
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

/** What a right-click lands on, read as it lands: an order decided later still aims there. */
interface RightClickAim {
  /** Any building under the cursor, a trader's route candidate. */
  readonly house: number | null;
  /** An own building under the cursor, the ladder's building rung. */
  readonly building: number | null;
  /** An own wall or road site under the cursor, which the selected builders take as their site. */
  readonly site: number | null;
  readonly tile: Tile;
}

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
  const pending = deps.pendingGroundOrders ?? createPendingGroundOrders();
  if (deps.pendingGroundOrders === undefined) {
    const enqueue = deps.enqueue;
    deps = { ...deps, enqueue: (command) => pending.submit(command, enqueue) };
  }
  let disposed = false;
  let school: SchoolDialog | undefined;
  let uiScale = deps.uiscale ?? 1;
  const buildingsByType = lastByTypeId(deps.content.buildings);
  const goodsByType = lastByTypeId(deps.content.goods);
  const vehiclesByType = lastByTypeId(deps.content.vehicles);
  const onOrderLimit = (): void => {
    deps.onOrderLimit?.();
    deps.cue?.('fail');
  };

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
    kind: WalkOrderKind,
    queued = false,
  ): boolean => {
    if (movers.length === 0) return false;
    if (movers.length > MAX_UNIT_ORDER_MEMBERS) {
      onOrderLimit();
      return false;
    }
    const { width, height } = nodeBounds(deps.mapSize);
    const seat = clampTile(target, width, height);
    const snapshot = deps.snapshot();
    const military = movers.some((mover) => {
      const self = entityById(snapshot, mover.ref);
      return self !== undefined && systems.isFighterJob(deps.content, settlerJobType(self) ?? null);
    });
    const dispatch = (
      currentMovers: readonly FormationUnit[],
      groups: readonly FormationSlotGroup[] | null,
    ): boolean => {
      const orders =
        groups === null
          ? assignFormation(
              currentMovers,
              seat,
              width,
              height,
              occupiedTiles(new Set(currentMovers.map((mover) => mover.ref))),
              military ? 2 : 1,
            )
          : groups.flatMap((group) => {
              const ids = new Set<number>(group.members);
              return pairFormation(
                currentMovers.filter((mover) => ids.has(mover.ref)),
                seat,
                group.slots.map(({ hx, hy }) => ({ col: hx, row: hy })),
              );
            });
      const members = orders.map((order) => ({
        entity: order.ref as Entity,
        x: order.tile.col,
        y: order.tile.row,
      }));
      if (members.length === 0) {
        deps.cue?.('fail');
        return false;
      }
      const accepted = enqueueArmyOrder(
        {
          kind: kind === 'moveUnit' ? 'moveUnitGroup' : 'attackMoveUnitGroup',
          members,
          ...(queued ? { queued: true } : {}),
        },
        deps.enqueue,
        onOrderLimit,
      );
      if (!accepted) return false;
      deps.markOrder?.(seat, kind === 'attackMoveUnit' ? 'attack' : 'move');
      return true;
    };
    const request = deps.requestFormationSlots;
    if (request === undefined) return dispatch(movers, null);
    const vehicles = new Map<number, number[]>();
    for (const { ref } of movers) {
      const self = entityById(snapshot, ref);
      const vehicle = self === undefined ? undefined : commandedVehicleOf(snapshot, self);
      if (vehicle !== undefined) vehicles.set(ref, [vehicle]);
    }
    const ticket = pending.begin([...movers.map(({ ref }) => ref), ...[...vehicles.values()].flat()], queued);
    const current = ({ ref }: FormationUnit): boolean => {
      const aliases = vehicles.get(ref);
      return pending.current(ticket, ref) && (aliases?.every((id) => pending.current(ticket, id)) ?? true);
    };
    const acknowledge = deps.deferGroundConfirmation?.();
    // The query reads the actual terrain and structure bodies on its simulation thread. A newer
    // unqueued command cancels only its own actors; a captain also follows its vehicle's intent.
    // Shift waits for overlapping predecessors, including those same vehicle aliases.
    const refused = (): void =>
      pending.settle(ticket, () => {
        if (!disposed && movers.some(current)) deps.cue?.('fail');
      });
    try {
      void request(
        { hx: seat.col, hy: seat.row },
        movers.map(({ ref }) => ref as Entity),
        military ? 2 : 1,
      ).then((groups) => {
        for (const group of groups ?? []) {
          if (group.commandedVehicle === undefined) continue;
          for (const entity of group.members) {
            if (!pending.current(ticket, entity)) continue;
            const aliases = vehicles.get(entity) ?? [];
            if (!aliases.includes(group.commandedVehicle)) aliases.push(group.commandedVehicle);
            vehicles.set(entity, aliases);
          }
        }
        // Keep earlier aliases too: unloading after the click must not revive it as a foot order.
        pending.includeActors(ticket, [...vehicles.values()].flat());
        pending.settle(ticket, () => {
          if (disposed) return;
          const currentMovers = movers.filter(current);
          if (currentMovers.length > 0 && dispatch(currentMovers, groups)) acknowledge?.();
        });
      }, refused);
    } catch {
      refused();
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
      answersVersion: deps.technologyVersion,
      cue: deps.cue,
      onOrderLimit,
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
    if (commanded.length > MAX_UNIT_ORDER_MEMBERS) {
      onOrderLimit();
      return false;
    }
    const chest = pickTopAt(deps.targets.chests(), world.x, world.y);
    // Shift queues a chest to open or a walk behind each settler's current order; no order on another
    // target is queueable, so the ground under it is walked to instead.
    if (event.shiftKey) {
      if (chest !== null && openChest(commanded, chest, true)) return true;
      return issueWalkOrder(worldToTile(world.x, world.y, deps.elevation), commanded, 'moveUnit', true);
    }
    const enemy = pickTopAt(deps.targets.enemies(), world.x, world.y);
    if (enemy !== null) return strike(commanded, enemy);
    // A chest nobody selected may open is walked to like any ground.
    if (chest !== null && openChest(commanded, chest)) return true;
    const goods = deps.targets.goods();
    const pile = pickTopAt(goods, world.x, world.y);
    const pileGood = pile === null ? undefined : goods.find((target) => target.ref === pile)?.goodType;
    const aim: RightClickAim = {
      house: onBuilding ?? pickTopAt(deps.targets.buildings(), world.x, world.y),
      building: onBuilding ?? pickTopAt(deps.targets.owned('building'), world.x, world.y),
      site: siteAt(world.x, world.y),
      tile: worldToTile(world.x, world.y, deps.elevation),
    };
    if (
      pileGood !== undefined &&
      wearFromGround(commanded, pileGood, (unworn) => rightClickRest(event, unworn, aim))
    ) {
      return true;
    }
    const others = gatherFromResource(commanded, world.x, world.y);
    if (others.length === 0) return true;
    return rightClickRest(event, others, aim);
  };

  /** A right click on a resource switches the gatherers among `commanded` that gather its good to it,
   *  leaving their work flag where it stands (Ctrl moves the flag too); returns the rest. */
  const gatherFromResource = (
    commanded: readonly FormationUnit[],
    wx: number,
    wy: number,
  ): readonly FormationUnit[] => {
    const resources = deps.targets.resources();
    const resource = pickNearestAt(resources, wx, wy);
    const goodType =
      resource === null ? undefined : resources.find((target) => target.ref === resource)?.goodType;
    if (goodType === undefined) return commanded;
    const snapshot = deps.snapshot();
    const gathers = (unit: FormationUnit): boolean => {
      const self = entityById(snapshot, unit.ref);
      const job = self === undefined ? undefined : settlerJobType(self);
      return (
        job !== undefined &&
        systems.jobChangesProduction(deps.content, job) &&
        systems.jobGathersGood({ content: deps.content }, job, goodType)
      );
    };
    const others: FormationUnit[] = [];
    const commands: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      if (gathers(unit)) commands.push({ kind: 'setGatherGood', entity: unit.ref as Entity, goodType });
      else others.push(unit);
    }
    enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
    return others;
  };

  /** The ladder past the goods heap: a trader's route toggle, then the building, then the walk. A trader
   *  the sim then refuses the house to takes the rest of the ladder once the answer lands. */
  const rightClickRest = (
    event: MouseEvent,
    commanded: readonly FormationUnit[],
    aim: RightClickAim,
  ): boolean => {
    const routed = routeTradeHouse(commanded, aim.house, (refused) => orderPastRoute(event, refused, aim));
    const others = routed.size === 0 ? commanded : commanded.filter((unit) => !routed.has(unit.ref));
    if (others.length === 0) return true;
    return orderPastRoute(event, others, aim) || routed.size > 0;
  };

  const orderPastRoute = (event: MouseEvent, units: readonly FormationUnit[], aim: RightClickAim): boolean =>
    aim.building !== null
      ? orderAtBuilding(event, units, aim.building)
      : aim.site !== null
        ? orderAtSite(units, aim.site, aim.tile)
        : issueWalkOrder(aim.tile, units, 'moveUnit');

  /** An own wall segment or road site still to be built under the cursor. */
  const siteAt = (wx: number, wy: number): number | null => {
    const snapshot = deps.snapshot();
    const walls = deps.targets
      .owned('palisade')
      .filter((target) => entityById(snapshot, target.ref)?.components.UnderConstruction !== undefined);
    return pickTopAt([...walls, ...deps.targets.owned('roadsite')], wx, wy);
  };

  /** A wall or road site pins the builders among `commanded` to it; the rest walk there. */
  const orderAtSite = (commanded: readonly FormationUnit[], site: number, tile: Tile): boolean => {
    const snapshot = deps.snapshot();
    const walkers: FormationUnit[] = [];
    const commands: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      const job = self !== undefined ? settlerJobType(self) : undefined;
      if (job !== undefined && systems.jobCanBuild(deps.content, job)) {
        commands.push({ kind: 'assignBuilder', entity: unit.ref as Entity, site: site as Entity });
      } else {
        walkers.push(unit);
      }
    }
    enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
    if (walkers.length > 0) issueWalkOrder(tile, walkers, 'moveUnit');
    return true;
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
    const pending: UnitSelectionCommand[] = [];
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
        pending.push({ kind: 'assignBuilder', entity: target.ref as Entity, site: building as Entity });
      }
    }
    const rest = commanded.filter((target) => !crew.has(target.ref));
    if (def !== undefined && systems.isSchoolType(def)) {
      const ordered = enqueueUnitSelection(pending, deps.enqueue, onOrderLimit);
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
      // A recruit sent to a foundation waits at its door until it stands.
      if (trainsRatherThanEmploys(def, currentJob)) {
        pending.push({ kind: 'trainSoldier', entity: target.ref as Entity, house: building as Entity });
        continue;
      }
      // The sim gates every candidate in the priority list, so an unoffered or full trade falls through.
      const jobPriority = assignmentPriorityFor(currentJob, slots);
      if (jobPriority.length > 0) workers.push({ entity: target.ref as Entity, jobPriority });
    }
    let ordered = enqueueUnitSelection(pending, deps.enqueue, onOrderLimit);
    if (movers.length > 0) {
      deps.enqueue({ kind: 'assignHouseGroup', members: movers, house: building as Entity });
      ordered = true;
    }
    if (workers.length > 0) {
      deps.enqueue({ kind: 'assignWorkerGroup', building: building as Entity, members: workers });
      ordered = true;
    }
    return ordered;
  };

  /**
   * Original behavior: a trader's right-click on a standing house puts it on the trade route, another
   * tribe's house included, and takes it off when the route already names it. Which houses a route
   * takes is the sim's rule, asked as the click lands. The traders that took the click are returned,
   * those asked about included; the rest of the selection handles the click as usual, and the asked
   * traders the sim refuses reach `onRefused` once the answer lands.
   */
  const routeTradeHouse = <U extends { readonly ref: number }>(
    commanded: readonly U[],
    house: number | null,
    onRefused: (refused: readonly U[]) => void,
  ): Set<number> => {
    const routed = new Set<number>();
    const ask = deps.askAttachTradeHouse;
    if (house === null) return routed;
    const snapshot = deps.snapshot();
    const asked: U[] = [];
    const detached: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      if (self === undefined || !systems.isTraderJob(deps.content, settlerJobType(self) ?? null)) continue;
      if (tradeHousePick.onRoute(snapshot, house, unit.ref)) {
        detached.push({ kind: 'detachTradeHouse', entity: unit.ref as Entity, house: house as Entity });
      } else if (ask !== undefined) asked.push(unit);
      else continue;
      routed.add(unit.ref);
    }
    enqueueUnitSelection(detached, deps.enqueue, onOrderLimit);
    if (ask === undefined || asked.length === 0) return routed;
    deps.answered.after(Promise.all(asked.map((unit) => ask(unit.ref, house))), (verdicts) => {
      const refused = asked.filter((_unit, index) => verdicts[index] !== true);
      const attached: UnitSelectionCommand[] = [];
      for (const unit of asked) {
        if (refused.includes(unit)) continue;
        attached.push({ kind: 'attachTradeHouse', entity: unit.ref as Entity, house: house as Entity });
      }
      enqueueUnitSelection(attached, deps.enqueue, onOrderLimit);
      if (refused.length > 0) onRefused(refused);
    });
    return routed;
  };

  /** A house click for the selected settlers off the map and the riders of a selected cart. A ship's
   *  passengers are left out: the ship takes the click itself, as its window has no Trade tab. */
  const issueRiderTradeHouse = (
    event: MouseEvent,
    onBuilding: number | null | undefined,
    onNoneTook: () => void,
  ): boolean => {
    const snapshot = deps.snapshot();
    const traders: { readonly ref: number }[] = [];
    for (const id of deps.selected()) {
      const e = entityById(snapshot, id);
      if (e === undefined) continue;
      if (!isVehicle(e)) {
        if (positionOf(e) === undefined) traders.push({ ref: id });
        continue;
      }
      const v = e.components.Vehicle as { vehicleType?: unknown; passengers?: unknown };
      const type = vehiclesByType.get(num(v.vehicleType) ?? -1);
      if (type === undefined || systems.isShipVehicle(type)) continue;
      for (const seat of vehicleSeatsOf(v.passengers)) traders.push({ ref: seat.entity });
    }
    const uniqueTraders = [...new Map(traders.map((unit) => [unit.ref, unit])).values()];
    if (uniqueTraders.length === 0) return false;
    if (uniqueTraders.length > MAX_UNIT_ORDER_MEMBERS) {
      onOrderLimit();
      return false;
    }
    const world = deps.toWorld(event.clientX, event.clientY);
    const house = onBuilding ?? pickTopAt(deps.targets.buildings(), world.x, world.y);
    const took = routeTradeHouse(uniqueTraders, house, (refused) => {
      if (refused.length === took.size) onNoneTook();
    });
    return took.size > 0;
  };

  /** Send every commanded settler that may open the chest; true when anyone was sent. Filtered here as
   *  the original's default click offers it only to a settler that may open it, and so a settler the
   *  sim would refuse never lands in the replay log; the sim re-checks each on arrival, so two senders
   *  race and the loser walks back into autonomy. A `queued` chest waits behind each one's current order. */
  const openChest = (commanded: readonly FormationUnit[], chest: number, queued = false): boolean => {
    const snapshot = deps.snapshot();
    const target = entityById(snapshot, chest);
    const kind = target === undefined ? undefined : chestKindOf(target);
    if (kind === undefined) return false;
    const commands: UnitSelectionCommand[] = [];
    for (const unit of commanded) {
      const self = entityById(snapshot, unit.ref);
      if (self === undefined || !canOpenChest(self, kind, deps.content)) continue;
      commands.push({
        kind: 'openChest',
        entity: unit.ref as Entity,
        chest: chest as Entity,
        ...(queued ? { queued } : {}),
      });
    }
    return enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
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
  const wearFromGround = (
    commanded: readonly FormationUnit[],
    goodType: number,
    onNoneWears: (commanded: readonly FormationUnit[]) => void,
  ): boolean => {
    const request = deps.requestEquipPicks;
    const group = goodsByType.get(goodType)?.equip?.category;
    if (request === undefined || group === undefined) return false;
    const snapshot = deps.snapshot();
    const candidates = commanded
      .map((unit) => unit.ref)
      .filter((ref) => {
        const self = entityById(snapshot, ref);
        return self !== undefined && (group === 'misc' || !wearsGood(self.components, group, goodType));
      });
    if (candidates.length === 0) return false;
    // The pick lists are asked as the click lands; with nobody able to wear it the click walks on.
    deps.answered.after(Promise.all(candidates.map((ref) => request(ref, group))), (lists) => {
      const wearers = candidates.filter((_ref, index) =>
        lists[index]?.some((row) => row.goodType === goodType),
      );
      const commands = selectionEquipCommands(
        deps.snapshot(),
        wearers,
        { goodType, group },
        { skipReturn: true },
      );
      enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
      if (commands.length === 0) onNoneWears(commanded);
    });
    return true;
  };

  /** The selected settlers an order goes to: all of them, or only `units` among them. */
  const commandedAmong = (units?: readonly number[]): FormationUnit[] => {
    const commanded = deps.targets.ownedSettlersIn(deps.selected());
    if (units === undefined) return commanded;
    const eligible = new Set(units);
    return commanded.filter((unit) => eligible.has(unit.ref));
  };

  const strike = (commanded: readonly FormationUnit[], enemy: number): boolean => {
    return enqueueArmyOrder(
      {
        kind: 'attackUnitGroup',
        members: commanded.map((unit) => ({ entity: unit.ref as Entity })),
        target: enemy as Entity,
      },
      deps.enqueue,
      onOrderLimit,
    );
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

  const issueMoveTo = (target: Tile, units?: readonly number[], queued?: boolean): boolean =>
    issueWalkOrder(target, commandedAmong(units), 'moveUnit', queued);

  const issueAttackMove = (target: Tile, units?: readonly number[], queued?: boolean): boolean =>
    issueWalkOrder(target, commandedAmong(units), 'attackMoveUnit', queued);

  const setWorkFlags = (
    movers: readonly FormationUnit[],
    target: Tile,
    goodType?: number,
    unassignFirst = false,
  ): boolean => {
    if (movers.length === 0) return false;
    const { width, height } = nodeBounds(deps.mapSize);
    const flag = clampTile(target, width, height);
    const commands: UnitSelectionCommand[] = [];
    for (const mover of movers) {
      const entity = entityById(deps.snapshot(), mover.ref);
      if (unassignFirst && entity !== undefined && workplaceOf(entity) !== undefined) {
        commands.push({ kind: 'unassignWorker', entity: mover.ref as Entity });
      }
      commands.push({
        kind: 'setWorkFlag',
        entity: mover.ref as Entity,
        x: flag.col,
        y: flag.row,
      });
      if (goodType === undefined) continue;
      // This is player intent; the sim is the authority on whether each selected settler may gather the
      // clicked good. Keeping the app out of that gate also avoids dropping the filter against a stale
      // render/snapshot pair while still letting setWorkFlag reject non-gatherers normally.
      commands.push({ kind: 'setGatherGood', entity: mover.ref as Entity, goodType });
    }
    return enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
  };

  const issueSetWorkFlag = (target: Tile, units?: readonly number[], unassignFirst = false): boolean =>
    setWorkFlags(commandedAmong(units), target, undefined, unassignFirst);

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
    dispose: () => {
      disposed = true;
      if (deps.pendingGroundOrders === undefined) pending.dispose();
      school?.dispose();
    },
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
