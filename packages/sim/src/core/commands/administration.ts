import type { Entity } from '../../ecs/world.js';

/** Commands that change deterministic world-wide simulation rules. */
export type RulesCommand =
  | {
      /**
       * Toggle the needs mechanic globally, as `WorldRules.needsEnabled` defines it. Sets that singleton
       * (created on first use), so the toggle hashes and replays like any other state.
       */
      readonly kind: 'setNeedsEnabled';
      readonly enabled: boolean;
    }
  | {
      /**
       * Set the fog-of-war mode globally (`OFF`, `REVEAL` sticky exploration, `RECON` known terrain with
       * current entity vision). Sets the `FogRules` singleton (created on first use), so the mode hashes
       * and replays like any other state, and the VisionSystem rebuilds the per-player masks the same
       * tick. Switching to `OFF` drops the masks, resetting exploration history. A `mode` outside the
       * three ids is skipped.
       */
      readonly kind: 'setFogMode';
      /** The target {@link import('../../components/rules.js').FOG_MODE} id (0..2). */
      readonly mode: number;
    }
  | {
      /**
       * Toggle signpost-navigation confinement globally: while enabled, a civilian settler may only work
       * and walk within its local reach plus a reachable signpost group's circles. Sets the
       * `SignpostRules` singleton (created on first use), so the toggle hashes and replays like any
       * other state. Deviation: the original always confines, but this defaults off and maps opt in.
       */
      readonly kind: 'setSignpostNavigation';
      readonly enabled: boolean;
    }
  | {
      /**
       * Toggle the profession-progression tech tree globally: while disabled, the `needfor*` XP
       * thresholds and the `jobEnables` presence graph stop gating civilian jobs and goods, so every
       * settler may take any civilian trade from the start. XP still accrues, so experience bonuses keep
       * paying off, and fighter-band jobs stay gated because barracks training unlocks those. Sets the
       * `ProgressionRules` singleton (created on first use). Default on, as the original always gates.
       */
      readonly kind: 'setProfessionProgression';
      readonly enabled: boolean;
    };

/** Replayable admin commands used to drive existing mechanics during testing. */
export type DebugCommand =
  /**
   * Each mutates through the one command path, so a debug poke replays and hashes like any order, but
   * only the debug panel issues them: no system or AI emits them, so goldens stay put. Every one targets
   * an entity by ref and is a no-op when the target is dead or the wrong kind. Source basis: test
   * affordances that drive existing systems rather than original mechanics.
   */
  /** Kill `target`, a settler or animal only: drain its `Health` pool to 0 so the CleanupSystem reaps it
   *  next tick with the normal `settlerDied` event. A non-settler is a no-op, including a building under
   *  construction, which carries a `Health` pool but must be torn down through `demolish` for its
   *  worker-unbind seam. */
  | { readonly kind: 'debugKill'; readonly target: Entity }
  /** Set `target`'s needs to whole-percent levels (`0` fully sated, `100` maxed, where the NeedsSystem's
   *  starvation and rest drives kick in); an omitted need is left untouched. Percents rather than raw
   *  `Fixed` keep the command serializable. A non-settler target is a no-op. */
  | {
      readonly kind: 'debugSetNeeds';
      readonly target: Entity;
      readonly hunger?: number;
      readonly fatigue?: number;
      readonly piety?: number;
      readonly enjoyment?: number;
    }
  /** Fill `target` building's stockpile: every good its type declares a stock slot for is set to that
   *  slot's `capacity`. A non-building target, or one without a `Stockpile`, is a no-op. */
  | { readonly kind: 'debugFillStockpile'; readonly target: Entity }
  /** Finish `target`'s construction now, regardless of delivered material or builder labor: full
   *  `Health`, marker removed, `buildingFinished` emitted. A target that is not a construction site is a
   *  no-op. */
  | { readonly kind: 'debugCompleteConstruction'; readonly target: Entity };
