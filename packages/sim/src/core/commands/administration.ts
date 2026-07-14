import type { Entity } from '../../ecs/world.js';

/** Commands that change deterministic world-wide simulation rules. */
export type RulesCommand =
  | {
      /**
       * Toggle the needs mechanic globally: hunger/fatigue/piety/enjoyment stop rising (and starvation stops
       * draining) while disabled. Sets the {@link import('../../components/index.js').WorldRules} singleton
       * (created on first use), so the toggle hashes and replays like any other state. A dev/admin lever (user
       * decision): acceptance scenes issue `enabled: false` at build so test units don't starve mid-checklist;
       * live maps keep the default (enabled). The admin panel flips it at runtime.
       */
      readonly kind: 'setNeedsEnabled';
      readonly enabled: boolean;
    }
  | {
      /**
       * Set the fog-of-war mode globally — one of the {@link import('../../components/rules.js').FOG_MODE} ids
       * (`OFF` / `REVEAL` sticky exploration / `RECON` known terrain with current entity vision). Sets the
       * {@link import('../../components/index.js').FogRules} singleton (created on first use), so the mode hashes
       * and replays like any other state; the VisionSystem rebuilds the per-player masks the same tick.
       * Switching to `OFF` drops the masks (exploration history resets). A `mode` outside the three ids is
       * recoverable bad input — skipped, still logged.
       */
      readonly kind: 'setFogMode';
      /** The target {@link import('../../components/rules.js').FOG_MODE} id (0..2). */
      readonly mode: number;
    };

/** Replayable admin commands used to drive existing mechanics during testing. */
export type DebugCommand =
  /**
   * Debug / cheat commands — the admin panel's "make testing trivial" seam. Each is a real, serializable
   * {@link Command} that mutates through the one command path (so a debug poke replays and hashes like any
   * order — never an app-side reach into `sim.world`), but is issued only by the debug panel: no system or AI
   * emits them, so they never fire on a golden/replay run and the goldens stay put. Every one targets an entity
   * by ref and is a recoverable-bad-input no-op when the target is dead or the wrong kind (a raced/stale ref).
   * Source basis: pure test affordances, not original mechanics — they drive existing systems (the CleanupSystem
   * reaps a 0-HP kill; the NeedsSystem reacts to a set need) rather than inventing behaviour.
   */
  /** Kill `target` outright — a settler only (animals included): drain its
   *  {@link import('../../components/combat.js').Health} pool to 0 so the CleanupSystem reaps it next tick with
   *  the normal `settlerDied` event (the real death path, not a silent destroy). A non-settler is a no-op —
   *  including a building placed under construction, which carries a `Health` pool but must be torn down via
   *  `demolish` (its worker-unbind seam), never reaped as if it were a unit. */
  | { readonly kind: 'debugKill'; readonly target: Entity }
  /** Set `target`'s needs to whole-percent levels (`0` = fully sated, `100` = maxed → the NeedsSystem's
   *  starvation/rest drive kicks in). Each field is optional; an omitted need is left untouched. Percents
   *  (not raw `Fixed`) keep the command serializable; the handler converts to the `0..ONE` need `Fixed`.
   *  A non-settler target is a no-op. */
  | {
      readonly kind: 'debugSetNeeds';
      readonly target: Entity;
      readonly hunger?: number;
      readonly fatigue?: number;
      readonly piety?: number;
      readonly enjoyment?: number;
    }
  /** Fill `target` building's {@link import('../../components/economy/index.js').Stockpile} to capacity: every good
   *  its building type declares a stock slot for is set to that slot's `capacity`. A non-building target,
   *  or one without a `Stockpile`, is a no-op. */
  | { readonly kind: 'debugFillStockpile'; readonly target: Entity }
  /** Finish `target`'s construction now: force a site carrying an
   *  {@link import('../../components/economy/index.js').UnderConstruction} marker straight to built (full `Health`,
   *  marker removed, `buildingFinished` emitted) regardless of delivered material or builder labor. A
   *  target that is not a construction site is a no-op. */
  | { readonly kind: 'debugCompleteConstruction'; readonly target: Entity };
