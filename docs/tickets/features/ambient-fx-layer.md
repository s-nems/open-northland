# Ambient FX layer: chimney smoke, fire, birds, drifting leaves

**Area:** render + app · **Origin:** visual-polish review, 2026-07-16 · **Priority:** P3

The scene has no ambient life beyond authored frame loops: no chimney smoke over working buildings,
no fire/spark emitters, nothing in the air. The original ships the art. The IR classifies loop
animations as waves/fire/smoke (`packages/app/src/content/ir.ts` `GfxLoopAnimation`), and `fx smoke`
/ `fx fire*` records bind `ls_smoke.bmd` with dedicated palettes (see `content/ir.json`), but no
emitter draws them.

Task (a player-visible slice): a deterministic ambient-effects layer following the pure, seeded,
tick-decayed, capped, and viewport-culled combat-effects pattern in
`packages/render/src/data/effects/`:

- chimney smoke over buildings mid production cycle (the snapshot's `working` flag the mill rotor
  already keys on), using the decoded `ls_smoke` frames; the damage-smoke overlay
  (`packages/render/src/gpu/overlays/damage-smoke-layer.ts`) draws procedural puffs today and is the
  second swap-in site for the same art;
- fire/spark loops where records place them (campfires, braziers);
- optional beyond-original ambience, such as birds over forest or drifting leaves, seeded from the
  tick so `?shot` reproduces it.

Budget: screen-bounded (emit only for on-screen sources), batched sprites, a hard active-particle
cap like `MAX_ACTIVE_EFFECTS`. Acceptance scene with a headless check (emitter count/decay) plus a
human browser pass per `packages/app/AGENTS.md`.
