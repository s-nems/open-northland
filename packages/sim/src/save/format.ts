import type { CommandEnvelope } from '../core/commands/index.js';

/** Discriminates a save payload from any other JSON document. */
export const SAVE_KIND = 'open-northland-save';

/** Single monotonic version of the whole persisted layout; any layout change bumps it. */
export const SAVE_FORMAT_VERSION = 1;

/** The oldest formatVersion this build still migrates; anything older is rejected, never silently
 *  parsed. */
export const OLDEST_SUPPORTED_SAVE_VERSION = 1;

/** The single key wrapping a serialized `Map`'s entry pairs; reserved, so a plain record carrying it
 *  is rejected at export. */
export const SAVE_MAP_KEY = '$map';

/** The identity block a reader classifies compatibility from before touching sections; the full
 *  format contract lives in docs/DATA-FORMAT.md. */
export interface SaveGameHeader {
  readonly kind: typeof SAVE_KIND;
  readonly formatVersion: number;
  /** Content identity: the IR schema version and pipeline conversion revision the run was built on. */
  readonly irVersion: number;
  readonly contentRevision: number;
  /** Provenance of the decoded map the run loaded, or null for scenes and mapless sims. */
  readonly mapId: string | null;
  readonly mapFingerprint: string | null;
  /** The RNG construction seed, provenance only; the live stream position is in the rng section. */
  readonly seed: number;
  readonly tick: number;
}

/** Entity allocation: ids are never recycled, so the counter plus the alive list is complete. */
export interface EntitiesSection {
  readonly id: 'entities';
  readonly nextId: number;
  readonly alive: readonly number[];
}

/**
 * One component store. `entries` keeps per-store insertion order (the query iteration contract), and
 * the sections appear in first-registration order (the order `hashSimState` consumes).
 */
export interface ComponentSection {
  readonly id: 'component';
  readonly name: string;
  readonly entries: ReadonlyArray<readonly [number, unknown]>;
}

export interface RngSection {
  readonly id: 'rng';
  /** The whole mulberry32 state; continuing the stream needs no draw counter. */
  readonly state: number;
}

/**
 * Fog beyond the components: the masks plus the two cadence fields that survive tick boundaries.
 * The may-hold-VISIBLE boxes are derived bookkeeping and stay out.
 */
export interface FogSection {
  readonly id: 'fog';
  readonly activeMode: number;
  readonly lastRebuildTick: number;
  /** `[player, mask]` ascending by player; a mask is one FOG_STATE digit per cell, row-major. */
  readonly masks: ReadonlyArray<readonly [number, string]>;
}

export interface CommandsSection {
  readonly id: 'commands';
  readonly nextSequence: number;
  /** Enqueued but not yet applied envelopes, in enqueue order. */
  readonly pending: readonly CommandEnvelope[];
}

/** Section identifiers are append-only: a retired id stays reserved, and a reader treats an unknown
 *  id as fatal. */
export type SaveGameSection = EntitiesSection | ComponentSection | RngSection | FogSection | CommandsSection;

/** A complete run state at one tick boundary, as canonical plain data (see `exportSaveGame`). */
export interface SaveGame {
  readonly header: SaveGameHeader;
  readonly sections: readonly SaveGameSection[];
}
