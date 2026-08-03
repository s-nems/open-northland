import type { Entity } from '../ecs/world.js';
import { type HalfCellNode, nodeOfPosition } from '../nav/halfcell.js';
import type { Fixed } from './fixed.js';

/**
 * One-shot things that happened during a tick, exposed read-only on the snapshot for render and audio.
 * Never delivered by callback: a callback could mutate sim state and break determinism.
 *
 * Every positioned event's `at` is a {@link HalfCellNode}, the same space command payloads use; ask
 * {@link eventNode} whether an event carries one.
 */
export type SimEvent =
  | {
      readonly kind: 'buildingPlaced';
      readonly entity: Entity;
      readonly at: HalfCellNode;
    }
  | {
      readonly kind: 'boatPlaced';
      readonly entity: Entity;
      readonly at: HalfCellNode;
    }
  | { readonly kind: 'buildingFinished'; readonly entity: Entity }
  | {
      /**
       * A player raised the alarm on one of its garrison buildings; lowering it again is silent.
       * `player` is the building's owner, so the bells ring for that player alone.
       */
      readonly kind: 'defenceAlarmRaised';
      readonly entity: Entity;
      readonly player: number;
    }
  | { readonly kind: 'buildingUpgraded'; readonly entity: Entity; readonly level: number }
  | { readonly kind: 'settlerBorn'; readonly entity: Entity }
  | {
      /**
       * Two settlers became spouses this tick. `at` is the kiss node, for the marriage jingle
       * (`DM_MUSIC_TYPE_JINGLE_MARRIAGE`, `logicdefines.inc`).
       */
      readonly kind: 'settlersMarried';
      readonly a: Entity;
      readonly b: Entity;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A combatant was reaped this tick. `player` is the dead unit's owner slot and `at` its last
       * position, both read before the destroy because the entity is gone by the snapshot; `player` is
       * `null` for an unowned death (wildlife, a neutral).
       */
      readonly kind: 'settlerDied';
      readonly entity: Entity;
      readonly cause: string;
      readonly player: number | null;
      /** Set when the dead unit was a wild/livestock animal, which leaves no bone pile. Observation: only
       *  humans leave bones, overruling the readable drained-cadaver REMOVE transition to landscape 81
       *  `cadaver_skeleton` in landscapetypes.ini. */
      readonly animal?: boolean;
      readonly at?: HalfCellNode;
    }
  | {
      /**
       * A building came down this tick, razed in combat or demolished by its owner; both paths share the
       * one cue. `player` is its owner slot (`null` for an unowned structure), `at` its node and
       * `buildingType` its content type, all read before the destroy so a consumer can still resolve the
       * collapse sprite after the entity leaves the snapshot.
       */
      readonly kind: 'buildingDestroyed';
      readonly entity: Entity;
      readonly player: number | null;
      readonly buildingType: number;
      /** Build progress at destruction as a fixed-point fraction of ONE (65536 = finished), so an
       *  unfinished site collapses through its construction-stage body. */
      readonly built: number;
      readonly at?: HalfCellNode;
    }
  | { readonly kind: 'atomicCompleted'; readonly entity: Entity; readonly atomicId: number }
  | {
      /**
       * An atomic reached its authored mid-animation sound frame
       * (`ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX`), which lands on the visual strike rather than at
       * the swing end. Fires only for an atomic whose animation carries the cue.
       */
      readonly kind: 'atomicSound';
      readonly entity: Entity;
      readonly atomicId: number;
    }
  | {
      /**
       * A chat half's talk/listen clip crossed its authored sound frame (`event <frame> 34 <id>` in
       * `atomicanimations.ini`). `soundType` is that event's value: the sound bank's `logicSoundType` id
       * of the voice group (`soundfx.cif` "SocialTalk Male" 61 / "SocialTalk Female" 62).
       */
      readonly kind: 'chatVoice';
      readonly entity: Entity;
      readonly soundType: number;
    }
  | {
      /**
       * A melee blow connected this tick; a swing that struck air emits nothing. `at` is the victim's
       * node, `weaponMainType` the striker's weapon class (1 fist / 2 spear / 3 sword / 4 saber / 5 axe,
       * `WEAPON_MAIN_TYPE_*`) or `undefined` when the weapon lists no class, and `structure` marks a blow
       * that landed on a building rather than a body.
       */
      readonly kind: 'combatHit';
      readonly attacker: Entity;
      readonly target: Entity;
      readonly weaponMainType?: number;
      readonly structure?: boolean;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A melee swing was loosed at the attacker's node, whether it connects or whiffs; the impact is the
       * separate `combatHit`. Ranged swings emit `projectileLaunched` instead.
       */
      readonly kind: 'combatSwing';
      readonly attacker: Entity;
      readonly at: HalfCellNode;
    }
  | {
      readonly kind: 'goodProduced';
      readonly building: Entity;
      readonly goodType: number;
      readonly amount: number;
    }
  | {
      /**
       * A tree was chopped down this tick: the standing `node` was destroyed and replaced at `at` by a
       * `trunk` ground drop holding the whole `amount` of `goodType`, plus a `stump` decor.
       */
      readonly kind: 'resourceFelled';
      readonly node: Entity;
      readonly trunk: Entity;
      readonly stump: Entity;
      readonly goodType: number;
      readonly amount: number;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A ranged weapon loosed a projectile at `target` from `at` (`munitionType`: 1 arrow / 2 rock).
       * `projectile` is the entity now in flight, which render draws from the snapshot.
       */
      readonly kind: 'projectileLaunched';
      readonly projectile: Entity;
      readonly shooter: Entity;
      readonly target: Entity;
      readonly munitionType: number;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A projectile reached `target` at `at` and dealt its damage; the projectile entity is destroyed
       * the same tick. `structure` marks a shot that struck a building rather than a body. A projectile
       * whose target died mid-flight expires silently.
       */
      readonly kind: 'projectileHit';
      readonly projectile: Entity;
      readonly shooter: Entity;
      readonly target: Entity;
      readonly munitionType: number;
      readonly structure?: boolean;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A shot reached its frozen aim point `at` without striking anything and is destroyed the same
       * tick. The no-hit cue hook (`weapons.ini` carries per-terrain `soundtype_NoHit` tables); a silent
       * expiry, when the target died mid-flight, announces nothing.
       */
      readonly kind: 'projectileMissed';
      readonly projectile: Entity;
      readonly shooter: Entity;
      readonly munitionType: number;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A resource node was exhausted and removed this tick: a mined deposit whose last unit was chipped
       * off, or a direct-pickup node after its single harvest. Unlike `resourceFelled` it leaves nothing
       * standing behind.
       */
      readonly kind: 'resourceDepleted';
      readonly node: Entity;
      readonly goodType: number;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * One unit was chipped off a still-standing mine deposit; the node survives, and removal of its
       * last unit emits `resourceDepleted` instead. Fires the first time a virgin node is worked, so a
       * consumer can hand it from a retained static decor layer to a live sprite.
       */
      readonly kind: 'resourceMined';
      readonly node: Entity;
      readonly goodType: number;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A berry bush's last ripe fruit was eaten this tick, so it flips ripe to bare and starts
       * regrowing. Fires the first time a virgin bush is worked, so a consumer can hand it from a
       * retained static decor layer to a live sprite that tracks its growth stage.
       */
      readonly kind: 'berryForaged';
      readonly bush: Entity;
      readonly at: HalfCellNode;
    }
  | {
      /**
       * A wild berry bush was razed this tick because a building was placed over it. Unlike
       * `berryForaged` the bush entity is gone by the snapshot, so a snapshot-diff cull has nothing left
       * to reap its retained static-decor quad against.
       */
      readonly kind: 'berryBushRazed';
      readonly bush: Entity;
      readonly at: HalfCellNode;
    };

export type SimEventKind = SimEvent['kind'];

/** Mint a positioned event's `at` from a fixed-point Position: the half-cell node it truncates to. */
export function eventAt(x: Fixed, y: Fixed): HalfCellNode {
  return nodeOfPosition(x, y);
}

/**
 * The half-cell node an event locates at, or `null` for one that locates by its emitter entity instead.
 * Derived from the event itself, because a structural cast hides a missing variant from the compiler.
 */
export function eventNode(ev: SimEvent): HalfCellNode | null {
  return 'at' in ev && ev.at !== undefined ? ev.at : null;
}

/** A simple deterministic per-tick event buffer. Cleared each tick, read-only via `current`. */
export class EventBuffer {
  private events: SimEvent[] = [];

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Read the current tick's events (do not mutate). */
  current(): readonly SimEvent[] {
    return this.events;
  }

  /** Clear at tick start. */
  clear(): void {
    this.events = [];
  }
}
