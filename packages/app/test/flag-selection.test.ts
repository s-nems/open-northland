import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { gathererByFlag, ownerPlayerOf, workFlagOf } from '../src/game/snapshot.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox.js';

/**
 * A gatherer's drop-off FLAG is a pure marker with no back-reference to its gatherer, so a click on a
 * flag resolves to the gatherer to select via {@link gathererByFlag} — the inverse of the WorkFlag edge.
 * This proves that inverse over the real sandbox scene, where every human gatherer is bound to its own
 * flag (the wiring the click handler in `view/unit-controls.ts` relies on).
 */
describe('flag → gatherer resolution (selecting a gatherer by clicking its flag)', () => {
  it('maps every human gatherer flag back to its owning gatherer, 1:1', () => {
    const sim = createSceneSim(sandboxScene);
    const snap = sim.snapshot();

    const byFlag = gathererByFlag(snap, HUMAN_PLAYER);
    expect(byFlag.size).toBeGreaterThan(0); // the sandbox binds every gatherer to its own flag

    // Each mapping is a genuine inverse: the resolved gatherer is human-owned and points back at the flag.
    for (const [flag, gatherer] of byFlag) {
      const ent = snap.entities.find((e) => e.id === gatherer);
      expect(ent).toBeDefined();
      if (ent === undefined) continue;
      expect(ownerPlayerOf(ent)).toBe(HUMAN_PLAYER);
      expect(workFlagOf(ent)).toBe(flag);
    }

    // 1:1 — the map covers every human gatherer that carries a flag, with none collapsed (no shared flag).
    const humanGathererFlags = snap.entities.filter(
      (e) => ownerPlayerOf(e) === HUMAN_PLAYER && workFlagOf(e) !== undefined,
    ).length;
    expect(byFlag.size).toBe(humanGathererFlags);
  });

  it('resolves only the queried player, so another slot sees no flags', () => {
    const sim = createSceneSim(sandboxScene);
    const snap = sim.snapshot();
    // No gatherer belongs to this unused player slot, so it gets no selection proxies.
    const UNUSED_PLAYER = 7;
    expect(gathererByFlag(snap, UNUSED_PLAYER).size).toBe(0);
  });
});
