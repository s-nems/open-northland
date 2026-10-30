import { type DeepReadonly, defineComponent, type Entity, type World } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';
import { aiControlEntity } from './control.js';

/** What an operation is for. `assault` is the seat's marching wave (its mechanics live on the barracks'
 *  `WaveMarch`); `hold` is a band that takes and keeps an area the map rewards holding; `raid` is a small
 *  band sent at the enemy's gatherers. A new kind is one more entry and one more handler
 *  (`systems/computer-player/military/operations`); kinds open in this order. */
export const OPERATION_KINDS = ['assault', 'hold', 'raid'] as const;
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
  /** The flank waypoints the band walks before it strikes, and the index of the one it walks to. */
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

export type Operation = AssaultOperation | HoldOperation | RaidOperation;

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
