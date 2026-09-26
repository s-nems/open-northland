/** One `[particel]` sprite: its family atlas and frame lists, the list index being the valency. */
export interface ParticleRef {
  readonly layer: string;
  readonly valencies: readonly (readonly number[])[];
  /** The frame list repeats for the particle's whole life; otherwise it holds its last frame. */
  readonly loop: boolean;
  /** The valency is the heading: valency 0 points screen-down and the lists turn counter-clockwise. */
  readonly directional: boolean;
}

/** The sprites a shot draws: itself in flight per `munitionType`, what it leaves behind every flight tick,
 *  and the smoke a landing raises. */
export interface MunitionBinding {
  readonly byMunition: Readonly<Record<number, ParticleRef>>;
  readonly trailByMunition: Readonly<Record<number, ParticleRef>>;
  readonly impactSmoke?: ParticleRef;
}

/** The frame a particle shows `age` ticks into its life at `valency`, or undefined past a one-shot's
 *  end. */
export function particleFrame(ref: ParticleRef, age: number, valency = 0): number | undefined {
  const frames = ref.valencies[valency] ?? ref.valencies[0];
  if (frames === undefined || frames.length === 0) return undefined;
  const step = Math.max(0, Math.floor(age));
  if (ref.loop) return frames[step % frames.length];
  return step < frames.length ? frames[step] : undefined;
}

/**
 * The valency a directional particle shows flying along screen angle `rotation` (radians, y down, 0 =
 * screen-east). Source basis: the served `test_arrow` frames, whose pale head points screen-down at
 * valency 0 and turns counter-clockwise, a quarter of the lists per quarter turn (8 of 32 points east).
 */
export function headingValency(rotation: number, count: number): number {
  if (count <= 0) return 0;
  const turn = (Math.PI / 2 - rotation) / (2 * Math.PI);
  return ((Math.round(turn * count) % count) + count) % count;
}
