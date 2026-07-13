/** Commands that change deterministic world-wide simulation rules. */
export type RulesCommand =
  | {
      /**
       * Toggle the needs mechanic globally: hunger/fatigue/piety/enjoyment stop rising (and starvation
       * stops draining) while disabled. Sets the {@link import('../../components/index.js').WorldRules}
       * SINGLETON (created on first use), so the toggle hashes and replays like any other state. A
       * dev/admin lever (user decision 2026-07-11): acceptance scenes issue `enabled: false` at build
       * so test units don't starve mid-checklist; live maps keep the default (enabled). The admin
       * panel's "Potrzeby" button flips it at runtime.
       */
      readonly kind: 'setNeedsEnabled';
      readonly enabled: boolean;
    }
  | {
      /**
       * Set the fog-of-war mode globally — one of the
       * {@link import('../../components/rules.js').FOG_MODE} ids (`OFF` / `REVEAL` sticky exploration /
       * `RECON` known-terrain grey / `FULL` classic fog). Sets the
       * {@link import('../../components/index.js').FogRules} SINGLETON (created on first use), so the
       * mode hashes and replays like any other state; the VisionSystem rebuilds the per-player masks
       * the same tick. Switching to `OFF` drops the masks (exploration history resets). A `mode`
       * outside the four ids is recoverable bad input — skipped, still logged for faithful replay
       * (the `setStance` stance).
       */
      readonly kind: 'setFogMode';
      /** The target {@link import('../../components/rules.js').FOG_MODE} id (0..3). */
      readonly mode: number;
    };
