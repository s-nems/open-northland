import { type DeepReadonly, defineComponent, type Entity, type World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { aiControlEntity } from './control.js';

/** What an operation is for. `assault` is the seat's marching wave (its mechanics live on the barracks'
 *  `WaveMarch`); `hold` is a band that takes and keeps an area the map rewards holding; `raid` is a small
 *  band sent at the enemy's gatherers; `rescue` is a band the seat's ships carry to one of its colonies to
 *  fight an enemy band there; `landing` is a wave carried over the sea by the seat's ships at a rival's
 *  land; `seaScout` is one ship with one soldier aboard sailing round the rival's island for sight. A new
 *  kind is one more entry and one more handler (`systems/computer-player/military/operations`); kinds open
 *  in this order. */
export const OPERATION_KINDS = ['assault', 'hold', 'raid', 'rescue', 'landing', 'seaScout'] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** An operation's lifecycle. `done` and `failed` are terminal: the operation lets its men go and is
 *  dropped at the seat's next decision. */
export const OPERATION_STATES = ['forming', 'moving', 'acting', 'withdrawing', 'done', 'failed'] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

/** Why an operation turned back or ended, the evidence a debug view shows. */
export const OPERATION_END_REASONS = [
  'defenceMode',
  'towerInReach',
  'outmatched',
  'losses',
  'postureChanged',
  'nothingToStrike',
  'targetLost',
  'timedOut',
  'arrivedHome',
  'wiped',
  'waveSpent',
] as const;
export type OperationEndReason = (typeof OPERATION_END_REASONS)[number];

export interface OperationTarget {
  hx: number;
  hy: number;
  /** The unit or building aimed at, null for a place. */
  entity: Entity | null;
  /** The seat whose ground the target is on when chosen; relations are read live, never stored. */
  owner: number | null;
}

interface OperationBase {
  id: number;
  state: OperationState;
  /** The tick the operation entered `state`. */
  since: number;
  /** The men the operation holds, ascending id. No other operation, the muster or the home defence
   *  orders them while it does. */
  members: Entity[];
  target: OperationTarget;
  /** Why it turned back or ended; null while it runs as planned. */
  reason: OperationEndReason | null;
}

/** The wave on the seat's barracks, mirrored: its men and objective, `acting` once it has arrived. */
export interface AssaultOperation extends OperationBase {
  kind: 'assault';
}

export interface RaidOperation extends OperationBase {
  kind: 'raid';
  /** The flank waypoints the band walks before it strikes, and the index of the one it walks to; on the
   *  way home, how many of them it has yet to walk back through. */
  waypoints: HalfCellNode[];
  leg: number;
  /** The head count it set out with, for its losses. */
  startMen: number;
  /** The enemy people it was ordered to strike, ascending id. */
  struck: Entity[];
  /** How many of them died. */
  killed: number;
}

/** A band holding an area: `target` is the area's centre, the band's men stand within `range` of it. */
export interface HoldOperation extends OperationBase {
  kind: 'hold';
  /** The area's radius in map points, as the script measures presence. */
  range: number;
  /** The node on the band's land the men walk to: the reachable node nearest the centre. */
  post: HalfCellNode;
  /** The men it set out with plus every reinforcement, for its losses. */
  sentMen: number;
}

/** Where one ship of a landing is on its voyage: sailing out to its shore, lying at its shore with its men
 *  ashore to take them back, sailing back once it turned home, or moored at home with its crew freed. */
export const LANDING_LEGS = ['out', 'waiting', 'back', 'home'] as const;
export type LandingLeg = (typeof LANDING_LEGS)[number];

export interface LandingShip {
  vehicle: Entity;
  /** The shore point on its own land it docks at on its return: where it lay moored when the landing took
   *  it, or another one once that shore took it no more. */
  home: HalfCellNode;
  /** The shore point on the rival's land it docks at to set its men ashore. */
  shore: HalfCellNode;
  leg: LandingLeg;
}

/** Men carried over the sea and set ashore: the members are the men aboard or set ashore and each ship's
 *  commander until his ship is home. */
interface SeaLandingBase extends OperationBase {
  /** The land component it sets its men ashore on and strikes on. */
  land: number;
  /** Ascending vehicle id; a sunk ship is dropped. */
  ships: LandingShip[];
  /** The ships and men it set out with, for its losses. */
  startShips: number;
  startMen: number;
  /** How many men its ships set ashore. */
  landed: number;
  /** The tick its first ship lay moored at its shore with the men still aboard, or null before. */
  firstMooredAt: number | null;
  /** Its men storm covered ground: it launched on a storm, or its landed men began one at the storm's
   *  edge, so they hold on at the lower edge a storm keeps. */
  storming: boolean;
}

/** A wave sailing at a rival's land: `target` is the building it heads for. */
export interface LandingOperation extends SeaLandingBase {
  kind: 'landing';
}

/** A band sailing to one of the seat's colonies to fight the enemy band there: `target` is where the seat
 *  saw the band, its entity null. */
export interface RescueOperation extends SeaLandingBase {
  kind: 'rescue';
}

/** Either operation that sails men over the sea and sets them ashore. */
export type SeaLanding = LandingOperation | RescueOperation;

/** One ship sailing round the rival's island so the seat sees it: `target` is the rival headquarters the
 *  seat sails for, the one member the soldier aboard. */
export interface SeaScoutOperation extends OperationBase {
  kind: 'seaScout';
  ship: Entity;
  /** The shore point it lay moored at when the scouting took it, where it docks again on its return. */
  home: HalfCellNode;
  /** The shore points round the rival's island the ship sails off, in sailing order. */
  waypoints: HalfCellNode[];
  /** The index of the waypoint it sails for; past the last it sails home. */
  leg: number;
}

export type Operation =
  | AssaultOperation
  | HoldOperation
  | LandingOperation
  | RaidOperation
  | RescueOperation
  | SeaScoutOperation;

export interface ComputerOperationsState {
  /** The next operation's id, per seat. */
  nextId: number;
  /** Ascending id. */
  operations: Operation[];
  /** Per kind, the first tick a new operation of it may form. */
  readyAt: Record<OperationKind, number>;
}

/** Held on the seat's `AiControl` carrier, so it dies with the seat. */
export const ComputerOperations = defineComponent<ComputerOperationsState>('ComputerOperations', 'players');

/** A land a seat's landing or rescue found no clear way to, and the tick it may be judged again. */
export interface NoWayLand {
  kind: SeaLanding['kind'];
  land: number;
  until: number;
}

/** The lands a seat's sea landings found no way to lately, by kind in {@link OPERATION_KINDS} order then
 *  ascending land: saved, so a restored game skips the same lands the continuous one does. Held on the
 *  seat's `AiControl` carrier. */
export const ComputerNoWay = defineComponent<{ lands: NoWayLand[] }>('ComputerNoWay', 'players');

/** Whether `op` still runs: not `done` or `failed`. */
export function isOperationOpen(op: DeepReadonly<Operation>): boolean {
  return op.state !== 'done' && op.state !== 'failed';
}

/** The men `seat`'s open operations hold: no other drive of the seat orders them. */
export function operationMembersOf(world: World, seat: number): Set<Entity> {
  const members = new Set<Entity>();
  const carrier = aiControlEntity(world, seat);
  const state = carrier === null ? undefined : world.tryGet(carrier, ComputerOperations);
  for (const op of state?.operations ?? []) {
    if (isOperationOpen(op)) for (const e of op.members) members.add(e);
  }
  return members;
}
