# Retire the legacy unstamped strikes component shape

**Area:** sim (footprint, agents/effects-goods) · **Priority:** P3

The strikes mechanic is implemented twice to keep old state hashes alive. `footprint/resources.ts`
stamps `strikesPerUnit`/`strikes` only when supplied ("legacy 1-strike hash shape"),
`effects-goods/harvest.ts` branches on `strikesPerUnit > 1` with an else branch that exists purely
so the unstamped component shape survives being worked, and `footprint/placement/blockers.ts`
keeps a "legacy anchor-only resource" same-tile rule. The only real producer,
`packages/app/src/game/sandbox/place/resources.ts`, throws unless `strikesPerUnit` is positive, so
the legacy path is reachable only from old fixtures and goldens. The "goldens move only for
intentional changes" rule is being satisfied by permanently duplicating a mechanic instead of by
one deliberate behavior commit.

## Scope

- Stamp `strikesPerUnit`/`strikes` unconditionally, collapse the harvest branch to the single
  general path, drop the optional-field shape from `components/economy/resources.ts`, and remove
  the legacy anchor-only placement rule if fixtures are its only remaining user (verify that claim
  first).
- Migrate affected fixtures and move the goldens in the same commit, stating the intentional
  behavior change in the commit message.

## Verify

`npm test`, `npm run check`, `npm run build`. Golden hash moves are expected and must be confined
to scenarios that place resources; diff the failing goldens first to confirm only the component
shape (not harvest outcomes) changed.
