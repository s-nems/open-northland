# Release a widowed man's home slot when his family is gone

**Area:** sim · **Origin:** user feedback on the AI build-placement branch 2026-07-18 · **Priority:** P2

When a home's woman dies, the surviving man keeps his `Residence` (`components/family.ts`) and the
home keeps counting his dead family against `homeSize`, so the settlement's women (who auto-refill
homes with fresh families) cannot move a new family in. User rule: a man left alone in a home — his
wife dead and no growing child in the home — is evicted (his `Residence` removed) so the slot frees
for a new family. The widowed-parent carve-out in `systems/lifecycle/cleanup.ts` (a dead-spouse
`Marriage` survives while a minor child grows, carrying the parent-child edge) marks exactly the
case that must NOT be evicted.

Scope: on the death path (or a lifecycle sweep), when a woman's death leaves her home with a lone
adult man and no growing child of that family, remove his `Residence`; he stays employable and can
remarry into a new home. Cover with a family-system test: woman dies → man's slot frees → a new
couple can `assignHouse` into the home; the raising-widower case keeps the slot.

## Verify

- Unit test on the death → eviction path (both branches: lone man evicted, raising widower kept);
  `npm test`, `npm run check`, `npm run build`.
