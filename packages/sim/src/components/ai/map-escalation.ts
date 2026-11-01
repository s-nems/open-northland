import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import { defineWorldSingleton } from '../../ecs/world-singleton.js';

/** The attack a map escalation has under way. */
export interface MapEscalationAttackRecord {
  /** The attack's number, from 1. */
  wave: number;
  launchedTick: number;
  /** How many men it spawned, land and sea: the base its dead share is counted against. */
  sent: number;
  /** The men it spawned and that may still live, ascending by id; the end check drops the dead. */
  men: Entity[];
}

/** One catapult the fortress stood with on its first turn: what it raises again once that one is gone. */
export interface MapEscalationCatapultRecord {
  vehicleType: number;
  tribe: number;
  /** The anchor's half-cell node. */
  hx: number;
  hy: number;
  /** The catapult standing for this record; null while it is lost. */
  entity: Entity | null;
  /** The tick its loss was seen; null while it stands. */
  lostTick: number | null;
}

/** A ship a sea landing sent: inbound with its men aboard, outbound empty back to where it came from. */
export interface MapEscalationLandingRecord {
  ship: Entity;
  /** The targeted seat whose landing points it sails. */
  seat: number;
  /** Which of the seat's landing points, by index. */
  point: number;
  /** The node the players' view was last revealed around; null before the first reveal. */
  seen: { hx: number; hy: number } | null;
  leg: 'inbound' | 'outbound';
}

/**
 * What a targeted seat's attack is aimed at: its headquarters; once that falls, another of the seat's
 * buildings; once none stands, one of its people.
 */
export interface MapEscalationFocusRecord {
  seat: number;
  kind: 'headquarters' | 'building' | 'person';
  entity: Entity;
}

/** A map escalation's progress; the schedule itself is immutable input, like the AI script. */
export interface MapEscalationProgress {
  /** The scheduled launches that fell due so far, spawned or not. */
  launches: number;
  attack: MapEscalationAttackRecord | null;
  /** The gear steps that fell due so far. */
  gearSteps: number;
  /** Every entity below this id has had the passed gear steps; meaningful once a step passed. */
  gearedBelow: number;
  /** The remembered catapults, in entity order; null before the first turn remembers them. */
  catapults: MapEscalationCatapultRecord[] | null;
  /** The ships under way, in launch order. */
  landings: MapEscalationLandingRecord[];
  /** Each targeted seat's aim, in the variant's target order; a seat without a record has not been aimed at yet. */
  focus: MapEscalationFocusRecord[];
  /** Whether the start's computer seats were looked at for soldiers to turn civilian. */
  demobilized: boolean;
  /** The defenders placed at match start, in the variant's order, a dead one kept; null before. */
  heroes: Entity[] | null;
}

/** No carrier exists until the escalation first writes, so a world before it hashes as one without it. */
const escalation = defineWorldSingleton<MapEscalationProgress>(
  'MapEscalation',
  'players',
  () => ({
    launches: 0,
    attack: null,
    gearSteps: 0,
    gearedBelow: 0,
    catapults: null,
    landings: [],
    focus: [],
    demobilized: false,
    heroes: null,
  }),
  { simOnly: true },
);

export const MapEscalationState = escalation.component;

export function mapEscalationProgress(world: World): DeepReadonly<MapEscalationProgress> {
  return escalation.read(world);
}

export function writeMapEscalation(world: World, apply: (value: MapEscalationProgress) => void): void {
  escalation.write(world, apply);
}
