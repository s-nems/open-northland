# Bind the civilian body's remaining action clips

**Area:** app · **Focus:** settler animation · **Priority:** P3

The source ships `[gfxanimatomic]` frame lists for two actions no `CharacterSpec.atomics` entry names
and whose rows sit on a job outside the civilian look's `baseJob` chain, so the tribe-row fallback in
`characterBinding` never reaches them and they fall through `resolveSettlerBobId` to the standing idle.
Verified against the generated IR, tribe 1:

| Action | Job | Clip the source binds |
| --- | --- | --- |
| 16 jest | 28 | `human_man_generic_beeing_satisfied` |
| 31 harvest herb | 29 | `human_man_farmer_work_reap_grain` |

The road and wall swings (41, 42 on job 7, `human_man_constructionworker_Work_Hammer`) are in the same
position, but no sim mechanic drives them yet.

Consequence: a herb picker plays no gathering motion.

## Scope

- Transcribe the two actions into the civilian spec, the way the collector and farmer rows already are.
- Leave the road/wall swings out until a mechanic drives them.

## Verify

- Unit: each newly bound action resolves a frame range on the civilian body rather than the idle bob.
- Human pass on `?scene=berries`: a herb picker reaps rather than standing.
