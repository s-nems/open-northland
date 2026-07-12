# Add the battle-stress scene and prove combat scale

**Area:** app (+ sim/render perf evidence) · **Origin:** combat plan reconciliation, 2026-07-12

`?scene=battle` exists (100 v 100 on a 34×42 map, `packages/app/src/scenes/battle.ts`) but the
scale proof does not: no `battle-stress` scene, no measured ms/tick at hundreds-per-side. The
ring-search targeting this proves out is the named scaling lever in `packages/sim/AGENTS.md`
(golden rule 6: per-tick cost scales with active work).

## Scope

- New `packages/app/src/scenes/battle-stress.ts`: hundreds per side on a 256×256 map, registered
  in `scenes/index.ts`.
- Record the sim-vs-render ms split (FPS overlay exists — `view/perf-overlay.ts`; ms/tick from a
  headless probe) in the scene notes / commit message.

## Verify

- `?scene=battle-stress` runs without collapse; ms/tick reported headless.
- Real-GPU FPS judged by the user — headless FPS is software-GL and ~50× too low.
