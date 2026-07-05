import type { Entity } from '../ecs/world.js';

/**
 * One-shot things that happened during a tick (a building appeared, a settler died, an atomic
 * completed → trigger a sound/effect). Render and audio consume these; they NEVER reach into sim
 * component stores. Events are PRODUCED into an append-only per-tick buffer and exposed READ-ONLY
 * on the snapshot — never delivered via callbacks (a callback could mutate sim state and break
 * determinism). This is the decoupling seam that keeps render a pure consumer.
 *
 * Deterministic: the buffer is cleared at the start of each tick and sealed at the end, so the
 * event list for tick N is a pure function of the sim — reproducible, replayable, hashable.
 */
export type SimEvent =
  | { readonly kind: 'buildingPlaced'; readonly entity: Entity; readonly at: { x: number; y: number } }
  | { readonly kind: 'boatPlaced'; readonly entity: Entity; readonly at: { x: number; y: number } }
  | { readonly kind: 'buildingFinished'; readonly entity: Entity }
  | { readonly kind: 'buildingUpgraded'; readonly entity: Entity; readonly level: number }
  | { readonly kind: 'settlerBorn'; readonly entity: Entity }
  | { readonly kind: 'settlerDied'; readonly entity: Entity; readonly cause: string }
  | { readonly kind: 'atomicCompleted'; readonly entity: Entity; readonly atomicId: number }
  | {
      readonly kind: 'goodProduced';
      readonly building: Entity;
      readonly goodType: number;
      readonly amount: number;
    }
  | {
      /**
       * A {@link import('../components/economy.js').Felling} node was chopped down this tick — the
       * standing node `node` was destroyed and replaced at `at` by a bare `Stockpile` `trunk` (a
       * {@link import('../components/economy.js').GroundDrop} holding the whole `amount` of `goodType`)
       * plus a {@link import('../components/economy.js').Stump} decor. Render/audio use it for the
       * felling cue (a "timber!" sound, a falling-tree effect); render otherwise reconciles the new
       * trunk/stump straight from the snapshot, so this is a one-shot notification, not the source of
       * truth. Deterministic like every event: a pure function of the tick's felled nodes.
       */
      readonly kind: 'resourceFelled';
      readonly node: Entity;
      readonly trunk: Entity;
      readonly stump: Entity;
      readonly goodType: number;
      readonly amount: number;
      readonly at: { x: number; y: number };
    }
  | {
      /**
       * A ranged weapon LOOSED a {@link import('../components/combat.js').Projectile} this tick — the
       * `shooter` released an arrow/rock (`munitionType`: 1 arrow / 2 rock) at `target` from `at`, at its
       * ATTACK-event frame. `projectile` is the entity now in flight (render draws it from the snapshot
       * each frame; this one-shot is the launch CUE — a bow-twang sound, a muzzle puff). Deterministic
       * like every event: a pure function of the tick's launched shots. Paired with {@link 'projectileHit'}.
       */
      readonly kind: 'projectileLaunched';
      readonly projectile: Entity;
      readonly shooter: Entity;
      readonly target: Entity;
      readonly munitionType: number;
      readonly at: { x: number; y: number };
    }
  | {
      /**
       * A {@link import('../components/combat.js').Projectile} LANDED its blow this tick — the arrow/rock
       * `projectile` (loosed by `shooter`, `munitionType` 1 arrow / 2 rock) reached `target` at `at` and
       * dealt its damage; the projectile entity is destroyed the same tick. Render/audio use it for the
       * impact cue (a thunk sound, a hit spark) — the ranged twin of an `atomicCompleted` melee swing. A
       * projectile whose target died mid-flight EXPIRES silently (no hit event). Deterministic like every event.
       */
      readonly kind: 'projectileHit';
      readonly projectile: Entity;
      readonly shooter: Entity;
      readonly target: Entity;
      readonly munitionType: number;
      readonly at: { x: number; y: number };
    };

export type SimEventKind = SimEvent['kind'];

/** A simple deterministic per-tick event buffer. Cleared each tick, read-only via `drain`. */
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
