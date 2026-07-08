import type { Camera } from '@vinland/render/data';
import type { SimEvent, SimEventKind, WorldSnapshot } from '@vinland/sim';
import type { SoundIndex } from './bank.js';

/**
 * The audio package's pure vocabulary — the data the {@link import('./director.js').directAudio}
 * decision function consumes and produces, with no Web Audio / DOM in sight. The impure
 * {@link import('../web/sound-driver.js').SoundDriver} turns these plain requests into actual
 * `AudioContext` playback. Keeping the decision layer pure is what lets the "what should be
 * audible right now" logic be unit-tested headless, the same self-verifiable split `render` keeps
 * between its `data/` viewport math and its Pixi `gpu/` layer.
 */

/**
 * One resolved request to play a sound **once**. `files` are the group's interchangeable wavs — the
 * pure layer never picks (that would need randomness, which belongs in the impure engine); it hands
 * the whole group over and the engine chooses one per play. `gain`/`pan` are already spatialised
 * (see {@link import('./spatial.js').computeSpatial}); `key` identifies the emitter so the engine can
 * debounce a burst of identical events (a settler completing the same chop atomic every few ticks).
 */
export interface OneShot {
  /** The group's interchangeable wav paths (relative to the sounds root); the engine picks one. */
  readonly files: readonly string[];
  /** Final playback gain, 0..1 (spatial attenuation already applied; 1 for non-spatial jingles). */
  readonly gain: number;
  /** Stereo pan, -1 (hard left) .. +1 (hard right); 0 for non-spatial jingles. */
  readonly pan: number;
  /** Emitter identity for debounce/dedup (e.g. `"atomicCompleted:42"`). */
  readonly key: string;
}

/**
 * One ambient bed that should be looping **now** at `gain`. The director returns the full set of
 * active beds each frame; the engine reconciles its running loops to match (starting new ones,
 * cross-fading gains, stopping departed ones) so a bed fades in as its terrain scrolls on screen and
 * out as it leaves — the "only what's on screen makes sound" contract for the ambient layer.
 */
export interface AmbientLoop {
  /** The bed's name — its stable loop identity across frames (e.g. `"Meadow Green"`). */
  readonly name: string;
  /** The wav to loop for this bed (relative to the sounds root). */
  readonly file: string;
  /** Target loop gain, 0..1 (coverage-weighted: more of the screen = louder). */
  readonly gain: number;
}

/** One frame's full audio decision: the one-shots to fire and the ambient loops that should be live. */
export interface AudioFrame {
  readonly oneShots: readonly OneShot[];
  readonly ambient: readonly AmbientLoop[];
}

/**
 * How a single sim event maps to a sound. A `spatial` binding names a {@link SoundBank} static group
 * that plays **positioned** at the event's world location (viewport-culled + attenuated + panned). A
 * `jingle` binding names a `MusicType` that plays as a **non-spatial** life-event stinger (full gain,
 * centred) — UI feedback, not world sound. This is the game-specific "engine event semantics" layer:
 * the original triggers these off animation/`LogicSoundType`/`MusicType` ids we have only partially
 * reversed, so the app supplies the concrete map (see {@link defaultBindings}) faithfully by name.
 */
export type EventSound =
  | { readonly kind: 'spatial'; readonly group: string }
  | { readonly kind: 'jingle'; readonly musicType: number };

/**
 * The event→sound map the director resolves against. `byEvent` covers events identified by their
 * kind alone; `byAtomic` covers `atomicCompleted`, whose meaning is the numeric `atomicId` (a
 * content-specific id — a chop vs. a hammer-swing), so the app keys it by the ids its content defines.
 */
export interface SoundBindings {
  readonly byEvent: Partial<Record<SimEventKind, EventSound>>;
  readonly byAtomic: ReadonlyMap<number, EventSound>;
}

/** The row-major landscape grid the ambient layer samples (the terrain the snapshot is positioned over). */
export interface AudioTerrain {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
}

/**
 * Everything one {@link import('./director.js').directAudio} call needs. `terrain` is optional —
 * absent, no ambient plays.
 */
export interface DirectorInput {
  readonly events: readonly SimEvent[];
  readonly snapshot: WorldSnapshot;
  readonly camera: Camera;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly terrain?: AudioTerrain;
  readonly index: SoundIndex;
  readonly bindings: SoundBindings;
}
