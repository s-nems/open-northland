# Add a scripted battle golden and strengthen the battle scene's behavior checks

**Area:** sim + app · **Origin:** combat plan reconciliation, 2026-07-12

The only integration golden is the economy slice (`packages/sim/test/core/golden-trace.test.ts` —
no combat). `combat-system.test.ts` has a same-seed determinism hash but no scripted-battle golden
trace. The `battle` scene checks only crowd shape (`casualties≥60`, `nobodyStacks`, both-engaged) —
not the combat behaviors the mechanic promises.

**Source basis for the asymmetry check (extracted weapons.ini):** iron spear 2090 vs PLATE / 950 vs
CHAIN; long sword 2090 vs CHAIN / 950 vs PLATE — armor-piercing asymmetry is faithful data and
should be visible in the casualty pattern.

## Scope

- A small scripted battle golden in `packages/sim/test`: state hash + `atomicCompleted`/
  `settlerDied` trace over N ticks.
- Add behavior checks to a battle scene: deterministic winner; plate falls to spears faster than to
  swords (needs a mixed-armor roster the current all-even battle lacks); archers open fire before
  melee contact; every death produced a `settlerDied`.

## Verify

- `npm test`; `?scene=battle`.
- New goldens are additive — existing goldens stay byte-identical.
