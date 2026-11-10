import { FNV_OFFSET_BASIS, fnvMixWord } from '@open-northland/data';
import { type MixText, type MixWord, mixValue, stringWord } from '../core/hash-value.js';
import type { Component, Entity, MutationSink, SyncDomain, World } from '../ecs/world.js';
import type { FogState } from '../systems/vision/index.js';

/**
 * What one tick changed, folded per {@link SyncDomain}: the cheap per-tick equality check two clients of
 * one deterministic session compare, where a full `hashState()` would cost hundreds of times a tick.
 *
 * The component domains cover only the stores the tick wrote, so a divergence shows up on the tick it
 * happens rather than for ever after; `rng`, `entities`, `fog` and the personal-name allocator carry their whole state every tick.
 * The full hash stays the rare cross-check for a state that already drifted.
 */
export interface SyncDigest {
  readonly tick: number;
  /** Unsigned 32-bit FNV fold per domain, so a mismatch names where the two runs parted. */
  readonly domains: Readonly<Record<SyncDomain, number>>;
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
  readonly names: number;
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

/** Entity ids below this are stamped in a dense array; a higher id (only a crafted save can name one)
 *  falls back to a set, so a hostile id cannot size the array. */
const DENSE_STAMP_LIMIT = 1 << 24;
const INITIAL_STAMPS = 1024;
const INITIAL_COMPONENTS = 256;
/** The last pass a 32-bit stamp can name; the stamps start over past it. */
const LAST_PASS = 0xffffffff;

function grown(buffer: Uint32Array<ArrayBuffer>, needed: number): Uint32Array<ArrayBuffer> {
  let length = buffer.length * 2;
  while (length < needed) length *= 2;
  const next = new Uint32Array(length);
  next.set(buffer);
  return next;
}

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
  /** The entities whose stored value changed this tick, per `Component.id`, in write order: the first
   *  `counts[id]` entries of a list, which keeps its storage from tick to tick. A write is logged without
   *  a lookup, so an entity written twice is listed twice until {@link distinct} drops the repeats. */
  private readonly written: Entity[][] = [];
  private counts = new Uint32Array(INITIAL_COMPONENTS);
  /** The components touched this tick, in first-touch order, deterministic like every other sim
   *  decision. */
  private readonly order: Array<Component<unknown>> = [];
  /** Per dense entity id, the {@link distinct} pass that last met it. */
  private seen = new Uint32Array(INITIAL_STAMPS);
  private readonly sparseSeen = new Set<Entity>();
  private pass = 0;
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
    for (const component of this.order) this.counts[component.id] = 0;
    this.order.length = 0;
    this.allocations.length = 0;
  }

  componentWritten(component: Component<unknown>, entity: Entity): void {
    const id = component.id;
    if (id >= this.counts.length) this.counts = grown(this.counts, id + 1);
    while (this.written.length <= id) this.written.push([]);
    const list = this.written[id] as Entity[];
    const count = this.counts[id] as number;
    if (count === 0) this.order.push(component);
    if (count < list.length) list[count] = entity;
    else list.push(entity);
    this.counts[id] = count + 1;
  }

  allocationChanged(entity: Entity): void {
    this.allocations.push(entity);
  }

  /** Fold the tick into a digest. Reads live values, so it belongs at a tick boundary. */
  seal(
    world: World,
    tick: number,
    rngState: number,
    fog: FogState | undefined,
    names = FNV_OFFSET_BASIS,
  ): SealedSyncDigest {
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
    domains.settlers = fnvMixWord(domains.settlers, names);

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
      names,
      nextEntityId: world.nextEntityId,
      entityCount: world.entityCount,
      allocations: Uint32Array.from(this.allocations),
      fog: fogWords,
      components,
    };
    return { digest, inputs };
  }

  /** Drop the repeats from the component's written entities, keeping each at its first touch, and
   *  answer how many are left at the head of its list. */
  private distinct(component: Component<unknown>): number {
    const list = this.written[component.id] as Entity[];
    const count = this.counts[component.id] as number;
    if (this.pass === LAST_PASS) {
      this.seen.fill(0);
      this.pass = 0;
    }
    const pass = ++this.pass;
    if (this.sparseSeen.size > 0) this.sparseSeen.clear();
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const entity = list[i] as Entity;
      if (entity >= DENSE_STAMP_LIMIT) {
        if (this.sparseSeen.has(entity)) continue;
        this.sparseSeen.add(entity);
      } else {
        if (entity >= this.seen.length) this.seen = grown(this.seen, entity + 1);
        if (this.seen[entity] === pass) continue;
        this.seen[entity] = pass;
      }
      list[kept++] = entity;
    }
    this.counts[component.id] = kept;
    return kept;
  }

  private foldComponents(world: World, domains: Record<SyncDomain, number>): void {
    for (const component of this.order) {
      const count = this.distinct(component);
      const entities = this.written[component.id] as Entity[];
      let componentWord = fnvMixWord(FNV_OFFSET_BASIS, stringWord(component.name));
      for (let i = 0; i < count; i++) {
        componentWord = fnvMixWord(componentWord, this.entityWord(world, component, entities[i] as Entity));
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
      const count = this.distinct(component);
      const entities = this.written[component.id] as Entity[];
      const ids = new Uint32Array(count);
      const words = new Uint32Array(count);
      let componentWord = fnvMixWord(FNV_OFFSET_BASIS, stringWord(component.name));
      for (let i = 0; i < count; i++) {
        const entity = entities[i] as Entity;
        const word = this.entityWord(world, component, entity);
        componentWord = fnvMixWord(componentWord, word);
        ids[i] = entity;
        words[i] = word;
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
