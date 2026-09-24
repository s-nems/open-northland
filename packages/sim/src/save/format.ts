import type { FogMode } from '../components/rules.js';
import type { CommandEnvelope } from '../core/commands/index.js';
import type { SavedCommand } from '../core/continuation.js';

export type { SavedCommand } from '../core/continuation.js';

/** Discriminates a save payload from any other JSON document. */
export const SAVE_KIND = 'open-northland-save';

/** Single monotonic version of the whole persisted layout; any layout change bumps it. A reader accepts
 *  exactly this version and rejects any other, never migrating. */
export const SAVE_FORMAT_VERSION = 47;

/** The single key wrapping a serialized `Map`'s entry pairs; reserved, so a plain record carrying it
 *  is rejected at export. */
export const SAVE_MAP_KEY = '$map';

/** The identity block a reader classifies compatibility from before touching sections; the full
 *  format contract lives in docs/DATA-FORMAT.md. */
export interface SaveGameHeader {
  readonly kind: typeof SAVE_KIND;
  readonly formatVersion: number;
  /** Content identity: the IR schema version the run was built on. */
  readonly irVersion: number;
  readonly contentFingerprint: string | null;
  /** Unix milliseconds supplied by the caller, or null when no creation time was recorded. */
  readonly savedAt: number | null;
  /** Provenance of the decoded map the run loaded, or null for scenes and mapless sims. */
  readonly mapId: string | null;
  readonly mapFingerprint: string | null;
  /** Caller-recorded relaunch token, opaque to the sim like `mapId`; the app stores the entry URL
   *  search that reboots the session. Null when the caller records none. */
  readonly entry: string | null;
  /** Caller-owned session metadata, validated by its owner; null when the caller records no session. */
  readonly session: unknown;
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
 * Fog beyond the components: the shared-vision groups, the masks and the two cadence fields that
 * survive tick boundaries. The may-hold-VISIBLE boxes are derived bookkeeping and stay out.
 */
export interface FogSection {
  readonly id: 'fog';
  readonly activeMode: FogMode;
  readonly lastRebuildTick: number;
  /** Each group of players sharing one mask, its members ascending, ascending by first member; a
   *  player listed nowhere keeps a mask of its own. */
  readonly sharedVision: ReadonlyArray<readonly number[]>;
  /** `[group, mask]` ascending by group, a group being its lowest member; a mask is one digit per cell,
   *  row-major: a FOG_STATE or the script-revealed byte 3. */
  readonly masks: ReadonlyArray<readonly [number, string]>;
}

export interface CommandsSection {
  readonly id: 'commands';
  readonly nextSequence: number;
  /** Enqueued but not yet applied envelopes, in enqueue order. */
  readonly pending: readonly CommandEnvelope[];
  /** Accepted future input retained independently of any live transport. */
  readonly continuation: readonly SavedCommand[];
}

/** A reader treats an unknown section id as fatal. */
export type SaveGameSection = EntitiesSection | ComponentSection | RngSection | FogSection | CommandsSection;

/** A complete run state at one tick boundary, as canonical plain data (see `exportSaveGame`). */
export interface SaveGame {
  readonly header: SaveGameHeader;
  readonly sections: readonly SaveGameSection[];
  readonly parent?: SaveGame;
}
