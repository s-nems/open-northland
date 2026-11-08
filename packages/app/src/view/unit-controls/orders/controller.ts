import type { UiCue } from '@open-northland/audio';
import type { ContentSet, EquipCategory } from '@open-northland/data';
import type { OrderMarkerKind, TargetFlashTone } from '@open-northland/render';
import {
  type Command,
  type Entity,
  type EquipPickEntry,
  entityById,
  type FormationOrder,
  type FormationSlotGroup,
  type HalfCellNode,
  MAX_UNIT_ORDER_MEMBERS,
  nodeOfPosition,
  type PlayerCommand,
  systems,
  type UnitSelectionCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  commandedVehicleOf,
  isBuilding,
  isSettler,
  positionOf,
  settlerJobType,
  workplaceOf,
} from '../../../game/snapshot/index.js';
import type { GoodIconPainter } from '../../../hud/dom/good-art.js';
import type { CameraGestures } from '../../camera/index.js';
import { clampTile, nodeBounds, type Tile } from '../../picking.js';
import { selectionEquipCommands } from '../panels/equip-picker.js';
import { openSchoolDialog, type SchoolDialog } from '../panels/school-dialog.js';
import { enemyAt, preyAt } from '../pick-targets.js';
import type { RiderPlan } from '../right-click/riders.js';
import {
  type LadderContext,
  PARTITION_RUNGS,
  pastRouteRungs,
  type RightClickAim,
  routeRungs,
  type SettlerGroup,
  type SettlerIntent,
  type SettlerPlan,
} from '../right-click/settler-ladder.js';
import type { TechnologyStatusRead } from '../types.js';
import type { UnitTargetKind, UnitTargets } from '../unit-targets.js';
import type { AnsweredOrders } from './answered.js';
import { createBuildingOrders } from './building.js';
import { assignFormation, type FormationUnit, pairFormation } from './formation.js';
import { enqueueArmyOrder, enqueueUnitSelection } from './group.js';
import { afterClickAnswer, createPendingGroundOrders, type PendingGroundOrders } from './pending-ground.js';

export interface UnitOrderDeps {
  readonly uiscale?: number;
  /** Fresh legal destinations from the simulation, requested only as a ground click lands. */
  readonly requestFormationSlots?:
    | ((
        target: HalfCellNode,
        members: readonly Entity[],
        rowSpacing: 1 | 2,
        order: FormationOrder,
      ) => Promise<readonly FormationSlotGroup[] | null>)
    | undefined;
  readonly pendingGroundOrders?: PendingGroundOrders | undefined;
  /** The selected vehicles the vehicle controller drives on the same right click. */
  readonly drivenVehicles?: (() => readonly number[]) | undefined;
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
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  readonly selectOwnSettler: (id: number) => void;
  readonly openActions: (atClient: { readonly x: number; readonly y: number }) => void;
  /** The map keeps moving under the open school dialog. */
  readonly camera: CameraGestures;
  /** The GUI click the school dialog's buttons confirm with; absent, silent. */
  readonly cue?: (cue: UiCue) => void;
  /** Paints the school dialog's goods; absent, it lists names alone. */
  readonly icons?: GoodIconPainter;
  /** Answers a walk none of its movers can take; absent, the fail click does. */
  readonly refuse?: ((movers: readonly number[]) => void) | undefined;
  /** The sim's trade-stop rule, asked as the click lands; absent, a trader's right-click puts no house on
   *  its route. */
  readonly askAttachTradeHouse?: ((trader: number, house: number) => Promise<boolean>) | undefined;
  /** Says why the sim kept `house` off a route; absent, the refusal is silent. */
  readonly onTradeRefused?: ((house: number) => void) | undefined;
  /** Acknowledges a walk or march on the ground where it was aimed; absent, nothing is drawn. */
  readonly markOrder?: ((node: Tile, kind: OrderMarkerKind) => void) | undefined;
  /** Flashes an order's target once; absent, nothing is drawn. */
  readonly flashTarget?: ((entity: number, tone: TargetFlashTone) => void) | undefined;
}

/**
 * Every order reports whether it commanded anyone: a press that finds no settler in the selection, or
 * no target under the cursor, issues nothing, and the caller's click feedback follows that answer.
 */
export interface UnitOrderController {
  /** Issues the settlers' part of a resolved right click (`resolveSettlerRightClick`) for the press
   *  `event` it was resolved from. True when the press selected a settler or gave the selected settlers an order.
   *  With Shift, each settler's order waits behind its current one; one whose order is a standing setting
   *  (a post, a home, a lesson, a gathered good or a trade stop) walks to the spot instead. */
  issueSettlerPlan(plan: SettlerPlan, event: MouseEvent): boolean;
  /** Issues the riders' resolved trade-route toggle (`resolveRiderTrade`). True when any of them took the
   *  click; `onNoneTook` runs once the sim refused every one asked about, so the cart can take the click
   *  instead. */
  issueRiderPlan(plan: RiderPlan, onNoneTook: () => void): boolean;
  /** Move the selected gatherers' work flags to `target`; a resource's `goodType` there also narrows their
   *  gathering filter to it. `units` narrows the order as in `issueSetWorkFlag`. */
  issueWorkFlagAt(target: Tile, goodType: number | null, units?: readonly number[]): boolean;
  /** Plant or move `building`'s rally flag at `target`, which the sim snaps to legal ground or refuses.
   *  Always true: the sim judges the click. */
  issueRallyPoint(building: number, target: Tile): boolean;
  /** The ground orders name a half-cell node rather than a cursor, so the map overview can issue them
   *  for a spot the camera is nowhere near. Off-map nodes clamp into the map here. `units`, when given,
   *  narrows these orders to the selected settlers an armed order was issued for. A `queued` walk waits
   *  behind each settler's current order (shift-click). */
  issueSetWorkFlag(target: Tile, units?: readonly number[], unassignFirst?: boolean): boolean;
  /** `vehicles` are the ones the same press drives itself. */
  issueMoveTo(
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles?: readonly number[],
  ): boolean;
  /** `vehicles` are the ones the same press marches itself. */
  issueAttackMove(
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles?: readonly number[],
  ): boolean;
  /** Strike one enemy of an accepted kind under the cursor; a click that hits none orders nothing. A
   *  `queued` strike waits behind each settler's current order. */
  issueAttackTarget(
    event: MouseEvent,
    kind: UnitTargetKind | readonly UnitTargetKind[],
    units?: readonly number[],
    queued?: boolean,
  ): boolean;
  /** Strike the wild creature under the cursor; a click that hits none orders nothing. An `assault`
   *  fights the enemy fighters it meets first, as an attack-move does. */
  issueAttackAnimal(
    event: MouseEvent,
    units?: readonly number[],
    queued?: boolean,
    assault?: boolean,
  ): boolean;
  /** Offer `units` the courses of the school `house`; false when none of them may learn there. */
  openSchool(house: number, units: readonly number[]): boolean;
  refresh(): void;
  setUiScale(scale: number): Promise<void>;
  dispose(): void;
}

type WalkOrderKind = Extract<Command, { kind: 'moveUnit' | 'attackMoveUnit' }>['kind'];

export function createUnitOrderController(deps: UnitOrderDeps): UnitOrderController {
  const pending = deps.pendingGroundOrders ?? createPendingGroundOrders();
  if (deps.pendingGroundOrders === undefined) {
    const enqueue = deps.enqueue;
    deps = { ...deps, enqueue: (command) => pending.submit(command, enqueue) };
  }
  let disposed = false;
  let school: SchoolDialog | undefined;
  let uiScale = deps.uiscale ?? 1;
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
    allMovers: readonly FormationUnit[],
    kind: WalkOrderKind,
    queued = false,
    drivenVehicles: ReadonlySet<number> = new Set(),
  ): boolean => {
    // A commander's queued walk would queue a drive of its vehicle beside the one the same press gives
    // the vehicle itself, so it stays out; an unqueued one only replaces that drive.
    const movers = queued ? withoutDrivenCommanders(allMovers, drivenVehicles) : allMovers;
    if (movers.length === 0) return allMovers.length > 0;
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
        if (deps.refuse !== undefined) deps.refuse(currentMovers.map((mover) => mover.ref));
        else deps.cue?.('fail');
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
        kind === 'moveUnit' ? 'move' : 'attackMove',
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
      camera: deps.camera,
      enqueue: deps.enqueue,
      status: deps.technologyStatus,
      answersVersion: deps.technologyVersion,
      cue: deps.cue,
      icons: deps.icons,
      onOrderLimit,
      scale: uiScale,
    });
    return school !== undefined;
  };

  const ladderContext = (): LadderContext => ({
    snapshot: deps.snapshot(),
    content: deps.content,
    asks: {
      tradeHouse: deps.askAttachTradeHouse !== undefined,
      equip: deps.requestEquipPicks !== undefined,
      formation: deps.requestFormationSlots !== undefined,
    },
  });

  const issueSettlerPlan = (plan: SettlerPlan, event: MouseEvent): boolean => {
    switch (plan.kind) {
      case 'none':
        return false;
      case 'select':
        deps.selectOwnSettler(plan.settler);
        deps.openActions({ x: event.clientX, y: event.clientY });
        return true;
      case 'orderLimit':
        onOrderLimit();
        return false;
      case 'orders':
        return issueGroups(plan.groups, plan.aim, event, event.shiftKey);
    }
  };

  /** Issues the groups in ladder order. The press confirms on the orders past the partition rungs, or on
   *  the partitions when they took everyone. */
  const issueGroups = (
    groups: readonly SettlerGroup[],
    aim: RightClickAim,
    event: MouseEvent,
    queued: boolean,
  ): boolean => {
    let terminal = false;
    let took = false;
    for (const group of groups) {
      const issued = issueGroup(group, aim, event, queued);
      if (PARTITION_RUNGS.has(group.intent.kind)) continue;
      terminal = true;
      took = issued || took;
    }
    return terminal ? took : groups.length > 0;
  };

  const issueGroup = (
    group: SettlerGroup,
    aim: RightClickAim,
    event: MouseEvent,
    queued: boolean,
  ): boolean => {
    const { units, intent } = group;
    const sendFlashing = (commands: readonly UnitSelectionCommand[], target: number): boolean => {
      const sent = enqueueUnitSelection(commands, deps.enqueue, onOrderLimit);
      if (sent) deps.flashTarget?.(target, 'order');
      return sent;
    };
    const queuedFlag = queued ? { queued } : {};
    switch (intent.kind) {
      case 'claimAnimal':
        // The sim judges the animal when each order starts.
        return sendFlashing(
          units.map((unit) => ({
            kind: 'claimAnimal',
            entity: unit.ref as Entity,
            animal: intent.animal as Entity,
            ...queuedFlag,
          })),
          intent.animal,
        );
      case 'attack':
        return strike(units, intent.enemy, queued);
      case 'hunt':
        return strike(units, intent.prey, queued);
      case 'openChest':
        // The sim re-checks each on arrival, so two senders race and the loser walks back into autonomy.
        return sendFlashing(
          units.map((unit) => ({
            kind: 'openChest',
            entity: unit.ref as Entity,
            chest: intent.chest as Entity,
            ...queuedFlag,
          })),
          intent.chest,
        );
      case 'eat': {
        const eating = enqueueArmyOrder(
          {
            kind: 'unitActionGroup',
            members: units.map((unit) => ({ entity: unit.ref as Entity })),
            action: { kind: 'orderNeed', need: 'hunger', ...queuedFlag },
          },
          deps.enqueue,
          onOrderLimit,
        );
        if (eating) deps.flashTarget?.(intent.pile, 'order');
        return eating;
      }
      case 'equip':
        return wearFromGround(units, intent, aim, event, queued);
      case 'gather':
        // The work flag stays where it stands (Ctrl moves the flag too).
        return enqueueUnitSelection(
          units.map((unit) => ({
            kind: 'setGatherGood',
            entity: unit.ref as Entity,
            goodType: intent.goodType,
          })),
          deps.enqueue,
          onOrderLimit,
        );
      case 'tradeHouse': {
        const asking = new Set(intent.ask);
        routeTradeHouse(
          intent.house,
          intent.detach,
          units.filter((unit) => asking.has(unit.ref)),
          (refused) => issueGroups(pastRouteRungs(ladderContext(), refused, aim, false), aim, event, false),
        );
        return true;
      }
      case 'walk':
        return walkTo(intent.tile, units, queued);
      case 'school':
      case 'building':
      case 'queueAtBuilding':
      case 'site':
        return issueBuildingIntent(intent, event, queued);
    }
  };

  /** A `queued` walk leaves out the commanders of the vehicles the same press drives (`issueWalkOrder`). */
  const walkTo = (tile: Tile, units: readonly FormationUnit[], queued: boolean): boolean =>
    issueWalkOrder(tile, units, 'moveUnit', queued, queued ? new Set(deps.drivenVehicles?.()) : undefined);

  const issueBuildingIntent = createBuildingOrders({ ...deps, onOrderLimit, walkTo, openSchool });

  /**
   * The trade-route toggle: `detach` take the house off their route now; `asked` are put on it once the
   * sim's trade-stop rule admits each, as the click lands, and those it refuses reach `onRefused`.
   */
  const routeTradeHouse = <U extends { readonly ref: number }>(
    house: number,
    detach: readonly number[],
    asked: readonly U[],
    onRefused: (refused: readonly U[]) => void,
  ): void => {
    enqueueUnitSelection(
      detach.map((ref) => ({ kind: 'detachTradeHouse', entity: ref as Entity, house: house as Entity })),
      deps.enqueue,
      onOrderLimit,
    );
    const ask = deps.askAttachTradeHouse;
    if (ask === undefined || asked.length === 0) return;
    deps.answered.after(Promise.all(asked.map((unit) => ask(unit.ref, house))), (verdicts) => {
      const refused = asked.filter((_unit, index) => verdicts[index] !== true);
      const attached: UnitSelectionCommand[] = [];
      for (const unit of asked) {
        if (refused.includes(unit)) continue;
        attached.push({ kind: 'attachTradeHouse', entity: unit.ref as Entity, house: house as Entity });
      }
      enqueueUnitSelection(attached, deps.enqueue, onOrderLimit);
      if (refused.length > 0) {
        deps.onTradeRefused?.(house);
        onRefused(refused);
      }
    });
  };

  const issueRiderPlan = (plan: RiderPlan, onNoneTook: () => void): boolean => {
    if (plan.kind === 'none') return false;
    if (plan.kind === 'orderLimit') {
      onOrderLimit();
      return false;
    }
    const took = plan.detach.length + plan.ask.length;
    routeTradeHouse(
      plan.house,
      plan.detach,
      plan.ask.map((ref) => ({ ref })),
      (refused) => {
        if (refused.length === took) onNoneTook();
      },
    );
    return true;
  };

  /**
   * The equip rung's order once the pick lists answered: each candidate the sim's pick list lets wear
   * the good gets the equip order by good type, so the sim fetches its nearest reachable unit rather
   * than this exact heap. Unlike an order from the equip window or the ring, the settler does not walk
   * back to where it stood. With nobody able to wear it, the click goes on from the trade route down.
   */
  const wearFromGround = (
    units: readonly FormationUnit[],
    intent: Extract<SettlerIntent, { kind: 'equip' }>,
    aim: RightClickAim,
    event: MouseEvent,
    queued: boolean,
  ): boolean => {
    const request = deps.requestEquipPicks;
    if (request === undefined) return false;
    const { candidates, goodType, group, pile } = intent;
    // The pick lists are asked as the click lands and answered in click order.
    const lists = Promise.all(candidates.map((ref) => request(ref, group)));
    afterClickAnswer(pending, deps.answered, candidates, queued, lists, (answers, current) => {
      const wearers = candidates.filter(
        (ref, index) => current(ref) && answers[index]?.some((row) => row.goodType === goodType),
      );
      const commands = selectionEquipCommands(
        deps.snapshot(),
        wearers,
        { goodType, group },
        { skipReturn: true, queued },
      );
      if (enqueueUnitSelection(commands, deps.enqueue, onOrderLimit)) deps.flashTarget?.(pile, 'order');
      if (commands.length > 0) return;
      const unworn = units.filter(({ ref }) => !candidates.includes(ref) || current(ref));
      issueGroups(routeRungs(ladderContext(), unworn, aim, queued), aim, event, queued);
    });
    return true;
  };

  const withoutDrivenCommanders = (
    movers: readonly FormationUnit[],
    vehicles: ReadonlySet<number>,
  ): readonly FormationUnit[] => {
    if (vehicles.size === 0) return movers;
    const snapshot = deps.snapshot();
    return movers.filter(({ ref }) => {
      const self = entityById(snapshot, ref);
      const vehicle = self === undefined ? undefined : commandedVehicleOf(snapshot, self);
      return vehicle === undefined || !vehicles.has(vehicle);
    });
  };

  /** The selected settlers an order goes to: all of them, or only `units` among them. */
  const commandedAmong = (units?: readonly number[]): FormationUnit[] => {
    const commanded = deps.targets.ownedSettlersIn(deps.selected());
    if (units === undefined) return commanded;
    const eligible = new Set(units);
    return commanded.filter((unit) => eligible.has(unit.ref));
  };

  const strike = (
    commanded: readonly FormationUnit[],
    enemy: number,
    queued = false,
    assault = false,
  ): boolean => {
    const accepted = enqueueArmyOrder(
      {
        kind: 'attackUnitGroup',
        members: commanded.map((unit) => ({ entity: unit.ref as Entity })),
        target: enemy as Entity,
        ...(queued ? { queued } : {}),
        ...(assault ? { assault } : {}),
      },
      deps.enqueue,
      onOrderLimit,
    );
    if (accepted) deps.flashTarget?.(enemy, 'attack');
    return accepted;
  };

  const issueAttackTarget = (
    event: MouseEvent,
    kind: UnitTargetKind | readonly UnitTargetKind[],
    units?: readonly number[],
    queued = false,
  ): boolean => {
    const world = deps.toWorld(event.clientX, event.clientY);
    const enemy = enemyAt(deps.targets, world, typeof kind === 'string' ? [kind] : kind, true);
    return enemy !== null && strike(commandedAmong(units), enemy, queued);
  };

  const issueAttackAnimal = (
    event: MouseEvent,
    units?: readonly number[],
    queued = false,
    assault = false,
  ): boolean => {
    const prey = preyAt(deps.targets, deps.toWorld(event.clientX, event.clientY));
    return prey !== null && strike(commandedAmong(units), prey, queued, assault);
  };

  const issueMoveTo = (
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles: readonly number[] = [],
  ): boolean => issueWalkOrder(target, commandedAmong(units), 'moveUnit', queued, new Set(vehicles));

  const issueAttackMove = (
    target: Tile,
    units?: readonly number[],
    queued?: boolean,
    vehicles: readonly number[] = [],
  ): boolean => issueWalkOrder(target, commandedAmong(units), 'attackMoveUnit', queued, new Set(vehicles));

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

  const issueWorkFlagAt = (target: Tile, goodType: number | null, units?: readonly number[]): boolean =>
    setWorkFlags(commandedAmong(units), target, goodType ?? undefined);

  const issueRallyPoint = (building: number, target: Tile): boolean => {
    const { width, height } = nodeBounds(deps.mapSize);
    const point = clampTile(target, width, height);
    deps.enqueue({ kind: 'setRallyPoint', building: building as Entity, x: point.col, y: point.row });
    return true;
  };

  return {
    refresh: () => school?.refresh(),
    issueRallyPoint,
    setUiScale: async (scale) => {
      uiScale = scale;
      await school?.setUiScale(scale);
    },
    dispose: () => {
      disposed = true;
      if (deps.pendingGroundOrders === undefined) pending.dispose();
      school?.dispose();
    },
    issueSettlerPlan,
    issueRiderPlan,
    issueWorkFlagAt,
    issueSetWorkFlag,
    issueMoveTo,
    issueAttackMove,
    issueAttackTarget,
    issueAttackAnimal,
    openSchool,
  };
}
