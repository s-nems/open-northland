# Bind the civilian body's remaining action clips

**Area:** app · **Focus:** settler animation · **Priority:** P3

The source ships `[gfxanimatomic]` frame lists for actions no `CharacterSpec.atomics` entry names, so
those actions fall through `resolveSettlerBobId` to the standing idle. Verified against the generated IR,
tribe 1, excluding the wait ladder and the sub-clip records; the clip's own job is in brackets where it
is not the civilist's:

| Action | Clip the source binds |
| --- | --- |
| 9 eat map, 45 produce honey | `human_man_generic_eat`, `human_man_generic_pick_up` |
| 13 monologuize, 16 jest [28], 17 enjoy | `human_man_generic_wait`, `human_man_generic_beeing_satisfied` |
| 31 harvest herb [29] | `human_man_farmer_work_reap_grain` |
| 41 build road, 42 build wall [7] | `human_man_constructionworker_Work_Hammer` |

Consequence: the actions the sim already runs draw nothing of their own. A herb picker plays no
gathering motion, and `enjoy` has a clip while the settler just stands.

## Scope

- Bind the actions whose mechanic the sim runs today: produce honey, eat map, enjoy, jest, harvest herb.
- Leave the road/wall swings out: no sim mechanic drives them yet. Fishing atomics 36/37/38 are
  bound by the fishing mechanic and no longer belong to this ticket.

## Verify

- Unit: each newly bound action resolves a frame range on the civilian body rather than the idle bob.
- Human pass on `?scene=berries`: a herb picker reaps rather than standing.
