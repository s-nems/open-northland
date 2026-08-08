import type { Entity } from '../../ecs/world.js';

/** Commands that change deterministic world-wide simulation rules. Each sets its rules singleton in
 *  `components/rules.ts`, so the setting hashes and replays like any other state. */
export type RulesCommand =
  | {
      /** Toggle the needs mechanic globally (`WorldRules.needsEnabled`). */
      readonly kind: 'setNeedsEnabled';
      readonly enabled: boolean;
    }
  | {
      /**
       * Set the fog-of-war mode globally (`FogRules`). The VisionSystem rebuilds the per-player masks
       * the same tick, and switching to `OFF` drops them, resetting exploration history.
       */
      readonly kind: 'setFogMode';
      /** The target {@link import('../../components/rules.js').FOG_MODE} id (0..2); any other value is
       *  skipped. */
      readonly mode: number;
    }
  | {
      /**
       * Toggle signpost-navigation confinement globally (`SignpostRules`): while enabled, a civilian
       * settler may only work and walk within its local reach plus a reachable signpost group's circles.
       * Default off, a named deviation from the original.
       */
      readonly kind: 'setSignpostNavigation';
      readonly enabled: boolean;
    }
  | {
      /**
       * Toggle the profession-progression tech tree globally (`ProgressionRules`): while disabled, the
       * `needfor*` XP thresholds and the `jobEnables` presence graph stop gating civilian jobs and goods.
       * Default on.
       */
      readonly kind: 'setProfessionProgression';
      readonly enabled: boolean;
    };

/**
 * Replayable admin commands that drive existing mechanics during testing: each mutates through the one
 * command path, so a debug poke replays and hashes like any order, and each is a no-op when the target is
 * dead or the wrong kind. No system or AI emits them, so goldens stay put. Source basis: test affordances
 * over existing systems rather than original mechanics.
 */
export type DebugCommand =
  /** Kill `target`, a settler or animal only: drain its `Health` pool to 0 so the CleanupSystem reaps it
   *  next tick with the normal `settlerDied` event. A building under construction carries a `Health` pool
   *  but is not killable here; `demolish` owns its worker-unbind seam. */
  | { readonly kind: 'debugKill'; readonly target: Entity }
  /** Set `target`'s needs to whole-percent levels (`0` fully sated, `100` maxed, where the NeedsSystem's
   *  starvation and rest drives kick in); an omitted need is left untouched. */
  | {
      readonly kind: 'debugSetNeeds';
      readonly target: Entity;
      readonly hunger?: number;
      readonly fatigue?: number;
      readonly piety?: number;
      readonly enjoyment?: number;
    }
  /** Fill `target` building's stockpile: every good its type declares a stock slot for is set to that
   *  slot's `capacity`. A building without a `Stockpile` is a no-op. */
  | { readonly kind: 'debugFillStockpile'; readonly target: Entity }
  /** Finish `target`'s construction now, regardless of delivered material or builder labor: full
   *  `Health`, marker removed, `buildingFinished` emitted. An already-built building is a no-op. */
  | { readonly kind: 'debugCompleteConstruction'; readonly target: Entity };
