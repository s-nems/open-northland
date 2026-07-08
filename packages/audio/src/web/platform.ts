/**
 * The browser seams the impure audio layer runs on. Each is an injectable function type with the
 * real browser behaviour as its default, so the whole `web/` layer is unit-testable without a
 * browser (a fake context, a stub loader, a scripted random) while production code passes nothing.
 */

/** Creates the `AudioContext` (null → no Web Audio on this platform; the engine stays silent). */
export type ContextFactory = () => AudioContext | null;

/** Fetch one wav's bytes by URL; reject on any failure (the sample cache memoises the failure). */
export type FetchBytes = (url: string) => Promise<ArrayBuffer>;

/** A `Math.random`-shaped source of [0, 1) — injected so clip/settler picks are testable. */
export type RandomFn = () => number;

/** The real Web Audio context, with the old-Safari `webkitAudioContext` fallback. */
export function webAudioContextFactory(): AudioContext | null {
  const Ctor =
    typeof globalThis.AudioContext !== 'undefined'
      ? globalThis.AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor === undefined ? null : new Ctor(); // no Web Audio (headless/unsupported) → silent
}

/** The real network loader: HTTP-fetch a wav's bytes, throwing on a non-OK status. */
export async function httpFetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Pick a uniformly random element of a non-empty list. */
export function pickRandom<T>(items: readonly T[], random: RandomFn): T {
  return items[Math.floor(random() * items.length)] as T;
}
