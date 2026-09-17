# Bind the civilian body's remaining action clip

**Area:** app · **Focus:** settler animation · **Priority:** P3

The source ships a `[gfxanimatomic]` frame list for one action no `CharacterSpec.atomics` entry names
and whose row sits on a job outside the civilian look's `baseJob` chain, so the tribe-row fallback in
`characterBinding` never reaches it and it falls through `resolveSettlerBobId` to the standing idle.
Verified against the generated IR, tribe 1:

| Action | Job | Clip the source binds |
| --- | --- | --- |
| 16 jest | 28 | `human_man_generic_beeing_satisfied` |

The road and wall swings (41, 42 on job 7, `human_man_constructionworker_Work_Hammer`) are in the same
position, but no sim mechanic drives them yet.

Consequence: a jesting settler stands in its idle.

## Scope

- Transcribe the action into the civilian spec, the way the collector, farmer and herb rows already are.
- Leave the road/wall swings out until a mechanic drives them.

## Verify

- Unit: the newly bound action resolves a frame range on the civilian body rather than the idle bob.
