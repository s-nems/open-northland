import { FNV_OFFSET_BASIS, fnvMixWord } from '@open-northland/data';
import { type MixWord, mixValue } from '../core/hash-value.js';
import type { Component, Entity, MutationSink, SyncDomain, World } from '../ecs/world.js';
import type { FogState } from '../systems/vision/index.js';

/**
 * What one tick changed, folded per {@link SyncDomain}: the cheap per-tick equality check two clients of
 * one deterministic session compare, where a full `hashState()` would cost hundreds of times a tick.
 *
 * The component domains cover only the stores the tick wrote, so a divergence shows up on the tick it
 * happens rather than for ever after; `rng`, `entities` and `fog` carry their whole state every tick.
 * The full hash stays the rare cross-check for a state that already drifted.
 */
export interface SyncDigest {
  readonly tick: number;
  /** Unsigned 32-bit FNV fold per domain, so a mismatch names where the two runs parted. */
  readonly domains: Readonly<Record<SyncDomain, number>>;
}

/**
 * Module state under the memo exception: `stringWord` is a pure function of its argument, no simulation
 * decision reads the table, and a string is immutable, so an entry can never go stale.
 */
const stringWords = new Map<string, number>();

/** Vocabulary size past which the table is dropped rather than grown forever - reachable only if a
 *  component ever holds open-ended text. Recomputing an entry yields the same word, so nothing moves. */
const STRING_WORD_LIMIT = 4096;

function stringWord(text: string): number {
  const known = stringWords.get(text);
  if (known !== undefined) return known;
  let word = fnvMixWord(FNV_OFFSET_BASIS, text.length);
  for (let i = 0; i < text.length; i++) word = fnvMixWord(word, text.charCodeAt(i));
  if (stringWords.size >= STRING_WORD_LIMIT) stringWords.clear();
  stringWords.set(text, word);
  return word;
}

/**
 * Collects the tick's mutations through the {@link MutationSink} and folds them at the tick boundary.
 * Values are read at {@link seal}, never when the write is reported: `World.mut` hands out the live
 * value before its caller changes it.
 */
export class SyncDigestRecorder implements MutationSink {
  /** The entities whose stored value changed this tick, per component. Both this map's entry order and
   *  each set's are first-touch order within the tick, deterministic like every other sim decision. */
  private readonly touched = new Map<Component<unknown>, Set<Entity>>();
  /** The components touched this tick, in first-touch order; the sets above outlive the tick, so this
   *  list is what says which of them are current. */
  private readonly order: Array<Component<unknown>> = [];
  private readonly allocations: Entity[] = [];

  /** Drop the previous tick's mutations, at the tick's start, so the set holds exactly one tick's
   *  writes however often the caller snapshots. */
  beginTick(): void {
    for (const component of this.order) this.touched.get(component)?.clear();
    this.order.length = 0;
    this.allocations.length = 0;
  }

  componentWritten(component: Component<unknown>, entity: Entity): void {
    let entities = this.touched.get(component);
    if (entities === undefined) {
      entities = new Set<Entity>();
      this.touched.set(component, entities);
    }
    if (entities.size === 0) this.order.push(component);
    entities.add(entity);
  }

  allocationChanged(entity: Entity): void {
    this.allocations.push(entity);
  }

  /** Fold the tick into a digest. Reads live values, so it belongs at a tick boundary. */
  seal(world: World, tick: number, rngState: number, fog: FogState | undefined): SyncDigest {
    const domains: Record<SyncDomain, number> = {
      rng: FNV_OFFSET_BASIS,
      entities: FNV_OFFSET_BASIS,
      players: FNV_OFFSET_BASIS,
      movement: FNV_OFFSET_BASIS,
      settlers: FNV_OFFSET_BASIS,
      economy: FNV_OFFSET_BASIS,
      combat: FNV_OFFSET_BASIS,
      fog: FNV_OFFSET_BASIS,
    };
    // A domain receives one word per component, not one per mixed word.
    let running = FNV_OFFSET_BASIS;
    const mix: MixWord = (word) => {
      running = fnvMixWord(running, word);
    };
    const mixText: (text: string) => void = (text) => {
      running = fnvMixWord(running, stringWord(text));
    };
    const foldInto = (domain: SyncDomain): void => {
      domains[domain] = fnvMixWord(domains[domain], running);
      running = FNV_OFFSET_BASIS;
    };

    mix(rngState);
    foldInto('rng');

    mix(world.nextEntityId);
    mix(world.entityCount);
    for (const entity of this.allocations) mix(entity);
    foldInto('entities');

    if (fog !== undefined) {
      fog.syncFoldInto(mix);
      foldInto('fog');
    }

    for (const component of this.order) {
      const entities = this.touched.get(component);
      if (entities === undefined) continue; // unreachable: `order` only holds components with a set
      mixText(component.name);
      for (const entity of entities) {
        mix(entity);
        // A removed component (and every component of a destroyed entity) reads absent, which
        // `mixValue` folds as its own value - the removal itself is the state change.
        mixValue(mix, mixText, world.tryGet(entity, component));
      }
      foldInto(component.domain);
    }
    return { tick, domains };
  }
}
