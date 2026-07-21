# Evict a widower when his raising carve-out expires (child grows up or dies)

**Area:** sim · **Origin:** discovered + gameplay review executing sim/home-widower-release 2026-07-18 · **Priority:** P2

The death-path widower eviction (`systems/lifecycle/cleanup.ts`, `reap`) frees a lone man's
`Residence` when his wife dies and no child is still growing, but carves out the widowed parent still
raising a minor: he keeps the home while the child grows (his `Marriage` carries the parent-child
edge). That carve-out is temporary and must free his slot when he is
left "a lone man, wife dead, no growing child." There are **two** ways it expires, and neither is
handled today:

1. **The child grows up.** `GrowthSystem` (`systems/lifecycle/ageclass.ts`, the `graduated` list)
   removes only the CHILD's `Residence`; nothing re-evaluates the widowed parent.
2. **The child dies.** `reap` on the child touches no parent (a child carries no `Marriage`), and
   nothing else re-evaluates the widower. Children run the needs ladder and can be killed/starve, so
   this path is reachable.

In both cases the widower is now the exact "lone man, no growing child" case the eviction targets,
yet keeps his `Residence` (and a stale dead-spouse `Marriage`) and squats a family slot until he
happens to remarry. That needs a surplus single woman, which is not guaranteed since the AI breeds women to
the house-place count (`ai-player/population.ts`). So the same slot-blocking bug reappears via either
carve-out-expiry path.

Source basis, user-specified design (the widower-eviction rule, 2026-07-18): a lone man with a dead
wife and no growing child vacates his home.

## Scope

Introduce one shared decision, "a lone widower with no growing child frees his home slot", and call
it from every point where that state can begin:

- the death path (`reap`) already does it inline for the wife's death; refactor it to the shared
  helper (the "deduplicate at the second real caller" trigger is now met);
- the grow-up path (`growthSystem`, when a graduate was a widowed parent's last minor);
- the child-death path (`reap` on a child whose surviving parent is a lone widower).

Mirror the death-path gate: evict only a MALE survivor (`!world.has(spouse, Female)`); a widow keeps
her home. Finding the widower from a grown/dead child is a reverse lookup (`Marriage.child ===
child`, `spouse` dead); graduations and child deaths are rare and event-driven, so a scoped scan per
event is within the per-tick budget. Do not add a whole-world per-tick sweep.

## Verify

- Family-system unit tests, both expiry paths: woman dies while the man raises a minor (man keeps the
  slot, already covered), then (a) the child grows up, or (b) the child dies → the man's `Residence`
  is gone and `familiesOf(home)` frees his slot; a widow in the same transition keeps hers.
- `npm test`, `npm run check`, `npm run build`.
