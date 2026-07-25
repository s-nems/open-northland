# Guard the AI collector veteran steal against ungated goods

**Area:** sim · **Priority:** P3

The veteran-repost fallback in `allocateCollectors`
(`packages/sim/src/systems/ai-player/workforce/collectors.ts`) is documented as "for an XP-gated
good", but has no gate check on the good being filled. With a dry pool and two or more ungated
wanted goods held by a single collector, the steal fires for every empty ungated good: within one
decision the same veteran is re-posted through mud → stone → wood (conflicting
`setJob`/`setWorkFlag`/`setGatherGood` triples, last wins), and the bounce repeats every decision
until a spare man appears — perpetual re-plan churn that cancels in-flight hauls. Verified present
on main before the 2026-07-25 workforce ladder; the holders-array refactor preserved it faithfully.

## Scope

Add `if (!needGated(tribe, w.good.typeId)) continue;` (or equivalent) before the veteran scan, so
only XP-gated goods may steal a veteran, plus a churn regression test: two ungated goods, one
collector, empty pool, two consecutive decisions must not re-post the same man.

## Verify

`npm test`, `npm run check`, `npm run build`.
