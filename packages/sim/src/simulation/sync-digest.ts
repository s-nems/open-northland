import { FNV_OFFSET_BASIS, fnvMixWord } from '@open-northland/data';
import { type MixText, type MixWord, mixValue } from '../core/hash-value.js';
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

/** One touched component's per-entity words, in the order the digest folded them. */
export interface DigestComponentInputs {
  /** `Component.name`. */
  readonly name: string;
  readonly domain: SyncDomain;
  /** The entities the tick wrote, in first-touch order. */
  readonly entities: Uint32Array;
  /** The entity word folded for `entities[i]`: its id and its value at the seal, or absence. */
  readonly words: Uint32Array;
}

/**
 * Everything one {@link SyncDigest} was folded from, kept so two clients' inputs at a disputed tick can
 * be diffed down to the first entity and component that differ.
 */
export interface SyncDigestInputs {
  readonly tick: number;
  readonly rng: number;
  readonly nextEntityId: number;
  readonly entityCount: number;
  readonly allocations: Uint32Array;
  /** The words `fog.syncFoldInto` produced, in order; empty when the world has no fog. */
  readonly fog: Uint32Array;
  /** Touched components in first-touch order. */
  readonly components: readonly DigestComponentInputs[];
}

export interface SealedSyncDigest {
  readonly digest: SyncDigest;
  /** Null unless the recorder captures inputs. */
  readonly inputs: SyncDigestInputs | null;
}

export interface SyncDigestRecorderOptions {
  /** Keep each seal's {@link SyncDigestInputs}; off by default, and free while off. */
  readonly captureInputs?: boolean;
}

/** Shared by every fogless capture; a zero-length view has nothing to mutate. */
const NO_WORDS = new Uint32Array(0);

/**
 * Collects the tick's mutations through the {@link MutationSink} and folds them at the tick boundary.
 * Values are read at {@link seal}, never when the write is reported: `World.mut` hands out the live
 * value before its caller changes it.
 *
 * Each touched (component, entity) pair folds into one entity word, the component word folds its name
 * and its entity words, and the domain folds one word per component.
 */
export class SyncDigestRecorder implements MutationSink {
  readonly captureInputs: boolean;
  /** The entities whose stored value changed this tick, per component. Both this map's entry order and
   *  each set's are first-touch order within the tick, deterministic like every other sim decision. */
  private readonly touched = new Map<Component<unknown>, Set<Entity>>();
  /** The components touched this tick, in first-touch order; the sets above outlive the tick, so this
   *  list is what says which of them are current. */
  private readonly order: Array<Component<unknown>> = [];
  private readonly allocations: Entity[] = [];
  /** Reused per seal to collect fog words before they are copied into their typed array. */
  private readonly fogScratch: number[] = [];
  /** The word the bound mixers below fold into. */
  private word = FNV_OFFSET_BASIS;
  private readonly mix: MixWord = (word) => {
    this.word = fnvMixWord(this.word, word);
  };
  private readonly mixText: MixText = (text) => {
    this.word = fnvMixWord(this.word, stringWord(text));
  };
  private readonly mixFogCapturing: MixWord = (word) => {
    this.fogScratch.push(word);
    this.word = fnvMixWord(this.word, word);
  };

  constructor(options: SyncDigestRecorderOptions = {}) {
    this.captureInputs = options.captureInputs ?? false;
  }

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
  seal(world: World, tick: number, rngState: number, fog: FogState | undefined): SealedSyncDigest {
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
    const capture = this.captureInputs;

    this.word = FNV_OFFSET_BASIS;
    this.mix(rngState);
    domains.rng = fnvMixWord(domains.rng, this.word);

    this.word = FNV_OFFSET_BASIS;
    this.mix(world.nextEntityId);
    this.mix(world.entityCount);
    for (const entity of this.allocations) this.mix(entity);
    domains.entities = fnvMixWord(domains.entities, this.word);

    let fogWords = NO_WORDS;
    if (fog !== undefined) {
      this.word = FNV_OFFSET_BASIS;
      if (capture) {
        this.fogScratch.length = 0;
        fog.syncFoldInto(this.mixFogCapturing);
        fogWords = Uint32Array.from(this.fogScratch);
      } else {
        fog.syncFoldInto(this.mix);
      }
      domains.fog = fnvMixWord(domains.fog, this.word);
    }

    const digest: SyncDigest = { tick, domains };
    if (!capture) {
      this.foldComponents(world, domains);
      return { digest, inputs: null };
    }
    const components = this.foldComponentsCapturing(world, domains);
    const inputs: SyncDigestInputs = {
      tick,
      rng: rngState,
      nextEntityId: world.nextEntityId,
      entityCount: world.entityCount,
      allocations: Uint32Array.from(this.allocations),
      fog: fogWords,
      components,
    };
    return { digest, inputs };
  }

  private foldComponents(world: World, domains: Record<SyncDomain, number>): void {
    for (const component of this.order) {
      const entities = this.touched.get(component);
      if (entities === undefined) continue; // unreachable: `order` only holds components with a set
      let componentWord = fnvMixWord(FNV_OFFSET_BASIS, stringWord(component.name));
      for (const entity of entities) {
        componentWord = fnvMixWord(componentWord, this.entityWord(world, component, entity));
      }
      domains[component.domain] = fnvMixWord(domains[component.domain], componentWord);
    }
  }

  /** {@link foldComponents}, keeping every entity word it folds. */
  private foldComponentsCapturing(
    world: World,
    domains: Record<SyncDomain, number>,
  ): DigestComponentInputs[] {
    const captured: DigestComponentInputs[] = [];
    for (const component of this.order) {
      const entities = this.touched.get(component);
      if (entities === undefined) continue; // unreachable: `order` only holds components with a set
      const ids = new Uint32Array(entities.size);
      const words = new Uint32Array(entities.size);
      let componentWord = fnvMixWord(FNV_OFFSET_BASIS, stringWord(component.name));
      let i = 0;
      for (const entity of entities) {
        const word = this.entityWord(world, component, entity);
        componentWord = fnvMixWord(componentWord, word);
        ids[i] = entity;
        words[i] = word;
        i++;
      }
      domains[component.domain] = fnvMixWord(domains[component.domain], componentWord);
      captured.push({ name: component.name, domain: component.domain, entities: ids, words });
    }
    return captured;
  }

  private entityWord(world: World, component: Component<unknown>, entity: Entity): number {
    this.word = FNV_OFFSET_BASIS;
    this.mix(entity);
    // A removed component (and every component of a destroyed entity) reads absent, which `mixValue`
    // folds as its own value - the removal itself is the state change.
    mixValue(this.mix, this.mixText, world.tryGet(entity, component));
    return this.word;
  }
}
