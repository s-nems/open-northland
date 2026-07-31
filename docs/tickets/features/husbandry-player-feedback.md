# Surface husbandry state to the player

**Area:** app/render · **Priority:** P3

Two feedback gaps left by the livestock slice (verified against the current worktree behaviour):

1. **The heart shows ownership only.** The original's overlay is a LIFE heart; the drain economy
   (a herd close to the processing floor) is invisible in play. Encode the HP fraction in the heart
   (fill level or size) in `packages/render/src/gpu/overlays/heart-layer.ts` /
   `packages/app/src/view/projections/livestock-hearts.ts`.
2. **A no-animal stall is unreadable.** A staffed farm with full water/wheat but no penned animal
   shows 0% production bars with no reason surfaced; unlike input starvation this gate is not even
   inferable from the stock rows. Add a "no animals in pen" hint to the animal farm's details panel
   (the feed gate is `feedAnimalsAvailable`, `packages/sim/src/systems/livestock/processing.ts`).

## Verify

- Browser `?scene=livestock`: a drained herd reads visibly weaker; an empty pen names its stall.
