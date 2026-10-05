import { FNV_OFFSET_BASIS, fnvMixWord, type PersonalNamePool } from '@open-northland/data';
import { Female } from '../components/family.js';
import { NameIdentity, Person, Settler } from '../components/settler.js';
import type { Entity, World } from '../ecs/world.js';
import { stringWord } from './hash-value.js';
import { Rng } from './rng.js';

export interface NameCursor {
  readonly pool: string;
  readonly next: number;
}

/** Independent seeded decks: naming never consumes the gameplay RNG. Cursors survive deaths. */
export class PersonalNames {
  private readonly pools = new Map<string, PersonalNamePool>();
  private readonly bindings = new Map<string, PersonalNamePool>();
  private readonly decks = new Map<string, readonly string[]>();
  private readonly cursors = new Map<string, number>();
  private cachedDigest: number | undefined;

  constructor(
    private readonly seed: number,
    pools: readonly PersonalNamePool[],
  ) {
    for (const pool of pools) {
      this.pools.set(pool.id, pool);
      this.bindings.set(`${pool.tribe}:${pool.sex}`, pool);
    }
  }

  assign(world: World, entity: Entity, tribe: number, sex: 'male' | 'female'): void {
    if (world.has(entity, NameIdentity)) throw new Error('Personal name already assigned');
    const pool = this.bindings.get(`${tribe}:${sex}`) ?? this.bindings.get(`${tribe}:neutral`);
    if (pool === undefined) return;
    let deck = this.decks.get(pool.id);
    if (deck === undefined) {
      const shuffled = [...pool.names];
      const rng = new Rng(fnvMixWord(this.seed, stringWord(pool.id)));
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const a = shuffled[i];
        const b = shuffled[j];
        if (a === undefined || b === undefined) throw new Error('Invalid name deck');
        shuffled[i] = b;
        shuffled[j] = a;
      }
      deck = shuffled;
      this.decks.set(pool.id, deck);
    }
    const next = this.cursors.get(pool.id) ?? 0;
    const name = deck[next];
    if (name === undefined) throw new Error('Invalid name cursor');
    world.add(entity, NameIdentity, { pool: pool.id, name });
    this.cursors.set(pool.id, (next + 1) % deck.length);
    this.cachedDigest = undefined;
  }

  snapshot(): NameCursor[] {
    return [...this.cursors]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([pool, next]) => ({ pool, next }));
  }

  restore(cursors: readonly NameCursor[]): void {
    const validated = new Map<string, number>();
    for (const { pool, next } of cursors) {
      const source = this.pools.get(pool);
      if (
        source === undefined ||
        validated.has(pool) ||
        !Number.isSafeInteger(next) ||
        next < 0 ||
        next >= source.names.length
      ) {
        throw new Error(`Invalid personal name cursor: ${pool}`);
      }
      validated.set(pool, next);
    }
    this.cursors.clear();
    for (const [pool, next] of validated) this.cursors.set(pool, next);
    this.cachedDigest = undefined;
  }

  validate(world: World): void {
    for (const entity of world.query(Person, Settler)) {
      const tribe = world.get(entity, Settler).tribe;
      const sex = world.has(entity, Female) ? 'female' : 'male';
      if (
        (this.bindings.has(`${tribe}:${sex}`) || this.bindings.has(`${tribe}:neutral`)) &&
        !world.has(entity, NameIdentity)
      ) {
        throw new Error(`Missing personal name on entity ${entity}`);
      }
    }
    for (const entity of world.query(NameIdentity)) {
      const identity = world.get(entity, NameIdentity);
      const pool = this.pools.get(identity.pool);
      if (
        !world.has(entity, Person) ||
        pool === undefined ||
        !pool.names.includes(identity.name) ||
        !this.cursors.has(identity.pool)
      ) {
        throw new Error(`Invalid personal name on entity ${entity}`);
      }
    }
  }

  digest(): number {
    if (this.cachedDigest !== undefined) return this.cachedDigest;
    let word = fnvMixWord(FNV_OFFSET_BASIS, this.seed);
    for (const { pool, next } of this.snapshot()) {
      word = fnvMixWord(fnvMixWord(word, stringWord(pool)), next);
    }
    this.cachedDigest = word;
    return word;
  }
}
