import type { Entity } from './ecs/world.js';

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
  | { readonly kind: 'buildingFinished'; readonly entity: Entity }
  | { readonly kind: 'settlerBorn'; readonly entity: Entity }
  | { readonly kind: 'settlerDied'; readonly entity: Entity; readonly cause: string }
  | { readonly kind: 'atomicCompleted'; readonly entity: Entity; readonly atomicId: number }
  | {
      readonly kind: 'goodProduced';
      readonly building: Entity;
      readonly goodType: number;
      readonly amount: number;
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
