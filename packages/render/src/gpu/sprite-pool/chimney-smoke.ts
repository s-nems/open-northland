import { Container, Sprite, Texture } from 'pixi.js';
import { frac } from '../../data/effects/random.js';
import { SMOKE_PUFF_PERIOD_TICKS, smokePuff, smokeWindBlow } from '../../data/effects/smoke.js';
import {
  type ChimneyFire,
  type ChimneyPoint,
  type ChimneySmokeKind,
  stokeChimney,
} from '../../data/scene/chimney-smoke.js';
import type { WindSway } from '../../data/weather/climate.js';
import type { DamageSubject } from '../building-damage/building-damage.js';
import { worldBatched } from '../world-batch/batcher.js';

/** One drawn finished building whose body has chimneys. */
export interface ChimneyHouse {
  readonly ref: number;
  readonly points: readonly ChimneyPoint[];
}

/** The shape of a chimney plume against the shared smoke model, tuned by eye: puffs per chimney, how
 *  much slower than a burning roof's they rise, and their height against the model's. */
const PUFFS = 8;
const RISE_RATE = 0.4;
const PLUME_STRETCH = 1.9;

/** A fire's smoke, tuned by eye: puff size against the model's, opacity at full draught, and the grey a
 *  puff leaves the flue with and thins out to. A forge smokes darker and heavier than a hearth. */
interface PlumeLook {
  readonly scale: number;
  readonly alpha: number;
  readonly fresh: number;
  readonly thin: number;
}
const PLUME_LOOK: Readonly<Record<ChimneySmokeKind, PlumeLook>> = {
  forge: { scale: 0.072, alpha: 0.95, fresh: 0xa8a39b, thin: 0xf0ece4 },
  hearth: { scale: 0.064, alpha: 0.8, fresh: 0xd0ccc4, thin: 0xf6f3ed },
};

/** How chimneys differ from one another, each a share either way around the look: a chimney's rise
 *  speed and size, and a puff's own size. */
const RISE_SPREAD = 0.15;
const CHIMNEY_SIZE_SPREAD = 0.12;
const PUFF_SIZE_SPREAD = 0.18;
/** A fire draws in slow breaths: the share of its opacity a breath takes away at its trough, and the
 *  range of one breath's length in ticks. */
const BREATH_DEPTH = 0.3;
const BREATH_MIN_TICKS = 70;
const BREATH_MAX_TICKS = 140;
/** Seed lanes of the per-chimney and per-puff variations. */
const RISE_LANE = 1;
const SIZE_LANE = 2;
const BREATH_LENGTH_LANE = 3;
const BREATH_PHASE_LANE = 4;
const PUFF_SIZE_LANE = 5;
const LANES = 8;

/** A seeded share in -1..1 for variation `lane` of chimney `chimney` (or one of its puffs) of house `ref`. */
function spread(ref: number, chimney: number, lane: number, puff = 0): number {
  return frac(ref, (chimney * PUFFS + puff) * LANES + lane) * 2 - 1;
}
/** Slow turn of a puff, radians per tick. */
const PUFF_SPIN = 0.004;
/** Smoke art tiles a puff picks among. */
const SMOKE_VARIANTS = 4;

interface Hearth {
  readonly subject: DamageSubject;
  readonly container: Container;
  readonly puffs: Sprite[];
  readonly fire: ChimneyFire;
  readonly points: readonly ChimneyPoint[];
  /** Each puff's age at the last draw, negative before its first, and what the wind has blown it since
   *  its birth (x, y pairs): a puff keeps that offset when the wind drops or turns. */
  readonly ages: Float32Array;
  readonly blown: Float32Array;
  tick: number;
}

const UNDRAWN = -1;
const NO_BODIES: readonly Container[] = [];

const RED = 16;
const GREEN = 8;
const BLUE = 0;

/** One colour channel of the grey between `fresh` and `thin` at `age` 0..1, in place in the tint. */
function channel(fresh: number, thin: number, shift: number, age: number): number {
  const from = (fresh >> shift) & 0xff;
  return Math.round(from + (((thin >> shift) & 0xff) - from) * age) << shift;
}

/** The grey of a puff of `look` at `age` 0..1, from fresh out of the flue to thinned out. */
function puffTint(look: PlumeLook, age: number): number {
  const { fresh, thin } = look;
  return channel(fresh, thin, RED, age) | channel(fresh, thin, GREEN, age) | channel(fresh, thin, BLUE, age);
}

/** The share of its opacity chimney `chimney` of house `ref` draws at `tick`: each breathes at its own
 *  pace and out of step with its neighbours. */
function breath(ref: number, chimney: number, tick: number): number {
  const length =
    BREATH_MIN_TICKS +
    (BREATH_MAX_TICKS - BREATH_MIN_TICKS) * frac(ref, chimney * PUFFS * LANES + BREATH_LENGTH_LANE);
  const phase = frac(ref, chimney * PUFFS * LANES + BREATH_PHASE_LANE);
  const trough = (1 - Math.cos((tick / length + phase) * 2 * Math.PI)) / 2;
  return 1 - BREATH_DEPTH * trough;
}

/**
 * The smoke over the chimneys of the houses whose fire someone tends. It rides each house's depth-sorted
 * parent, so a nearer house covers it, and holds a node only for a house that smokes, so its cost
 * follows the working houses in view.
 */
export class ChimneySmoke {
  private readonly hearths = new Map<number, Hearth>();
  /** The chimney houses in view last frame: one that comes into view tended is already smoking. */
  private inView = new Set<number>();
  private nextInView = new Set<number>();
  private readonly pose = { x: 0, y: 0, radius: 0, alpha: 0, age: 0 };
  private readonly blow = { x: 0, y: 0 };

  constructor(private readonly art: () => readonly Texture[]) {}

  draw(
    houses: readonly ChimneyHouse[],
    subjectOf: (ref: number) => DamageSubject | undefined,
    tended: ReadonlyMap<number, number>,
    tick: number,
    wind: WindSway | undefined,
  ): void {
    const seen = this.nextInView;
    seen.clear();
    for (const { ref, points } of houses) {
      const subject = subjectOf(ref);
      if (subject === undefined) continue;
      seen.add(ref);
      const atWork = tended.has(ref);
      let hearth = this.hearths.get(ref);
      // A house that changed its pooled entity or its body keeps its fire under new puffs.
      if (hearth !== undefined && (hearth.subject !== subject || hearth.points !== points)) {
        hearth.container.destroy({ children: true });
        hearth = this.kindle(subject, points, hearth.tick, hearth.fire);
        this.hearths.set(ref, hearth);
      }
      if (hearth === undefined) {
        if (!atWork) continue;
        hearth = this.kindle(subject, points, tick, { draught: this.inView.has(ref) ? 0 : 1, hold: 0 });
        this.hearths.set(ref, hearth);
      }
      const elapsed = tick - hearth.tick;
      stokeChimney(hearth.fire, atWork, elapsed);
      hearth.tick = tick;
      if (!atWork && hearth.fire.draught <= 0) {
        hearth.container.destroy({ children: true });
        this.hearths.delete(ref);
        continue;
      }
      this.keepOverBody(hearth);
      this.place(ref, hearth, tick, elapsed, wind);
    }
    for (const [ref, hearth] of this.hearths) {
      if (seen.has(ref)) continue;
      hearth.container.destroy({ children: true });
      this.hearths.delete(ref);
    }
    this.nextInView = this.inView;
    this.inView = seen;
  }

  private kindle(
    subject: DamageSubject,
    points: readonly ChimneyPoint[],
    tick: number,
    fire: ChimneyFire,
  ): Hearth {
    const container = new Container();
    const art = this.art();
    const puffs: Sprite[] = [];
    for (let i = 0; i < points.length * PUFFS; i++) {
      const puff = worldBatched(new Sprite(art[i % SMOKE_VARIANTS] ?? Texture.EMPTY));
      puff.anchor.set(0.5);
      puffs.push(puff);
      container.addChild(puff);
    }
    subject.container.addChild(container);
    const ages = new Float32Array(puffs.length).fill(UNDRAWN);
    return { subject, container, puffs, fire, points, ages, blown: new Float32Array(puffs.length * 2), tick };
  }

  /** A rebind appends body sprites after the smoke, which would then draw under them. */
  private keepOverBody(hearth: Hearth): void {
    const { subject, container } = hearth;
    const children = subject.container.children;
    const bodies = subject.damageBodies ?? NO_BODIES;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child === container) return;
      if (child !== undefined && bodies.includes(child)) break;
    }
    subject.container.addChild(container);
  }

  /** Poses the puffs `elapsed` ticks after the hearth's last draw. */
  private place(
    ref: number,
    hearth: Hearth,
    tick: number,
    elapsed: number,
    wind: WindSway | undefined,
  ): void {
    const { puffs, points, fire, ages, blown } = hearth;
    for (let chimney = 0; chimney < points.length; chimney++) {
      const point = points[chimney];
      if (point === undefined) continue;
      const look = PLUME_LOOK[point.smoke];
      const rise = RISE_RATE * (1 + RISE_SPREAD * spread(ref, chimney, RISE_LANE));
      const size = look.scale * (1 + CHIMNEY_SIZE_SPREAD * spread(ref, chimney, SIZE_LANE));
      const alpha = look.alpha * fire.draught * breath(ref, chimney, tick);
      // A clock that ran back, or on past a whole rise, leaves no puff of the last draw in the air.
      const stale = elapsed < 0 || elapsed * rise >= SMOKE_PUFF_PERIOD_TICKS;
      for (let slot = 0; slot < PUFFS; slot++) {
        const i = chimney * PUFFS + slot;
        const puff = puffs[i];
        if (puff === undefined) continue;
        const pose = smokePuff(ref, chimney, slot, tick * rise, undefined, this.pose);
        const last = ages[i] ?? UNDRAWN;
        // A puff first drawn mid-rise, or born anew, has been in this wind since it left the flue.
        const born = stale || last < 0 || pose.age < last;
        const step = smokeWindBlow(wind, born ? 0 : last, pose.age, this.blow);
        const x = (born ? 0 : (blown[i * 2] ?? 0)) + step.x;
        const y = (born ? 0 : (blown[i * 2 + 1] ?? 0)) + step.y;
        blown[i * 2] = x;
        blown[i * 2 + 1] = y;
        ages[i] = pose.age;
        puff.position.set(point.x + (pose.x + x) * PLUME_STRETCH, point.y + (pose.y + y) * PLUME_STRETCH);
        puff.scale.set(
          pose.radius * size * (1 + PUFF_SIZE_SPREAD * spread(ref, chimney, PUFF_SIZE_LANE, slot)),
        );
        puff.rotation = i + tick * PUFF_SPIN;
        puff.tint = puffTint(look, pose.age);
        puff.alpha = pose.alpha * alpha;
      }
    }
  }

  destroy(): void {
    for (const hearth of this.hearths.values()) hearth.container.destroy({ children: true });
    this.hearths.clear();
  }
}
