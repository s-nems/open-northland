# Replace deliveryTargetFor's lettered if-else chain with an ordered rule table

**Area:** sim (settlers/drives/economy) · **Priority:** P3

`deliveryTargetFor` in `systems/settlers/drives/economy/delivery-targets.ts` is an if-else chain whose case
comments are numbered `1.` through `5.` with `3b.`, `3c.`, and `4b.` wedged in between, the signature of
special cases inserted where restructuring was due. Each rung independently re-derives
`JobAssignment`/`WorkFlag`/`SiteAssignment` and applies its own gated/ungated decision, and the
gated-vs-searched split is carried by a multi-line prose comment instead of structure. Adding the next
delivery rule means picking a letter suffix and re-reading the whole chain for ordering hazards.

## Scope

- An ordered `readonly DeliveryRule[]` table of `{ name, gated, resolve(plan, goodType) }`
  evaluated first-match; the prose comment about gating becomes the `gated` field.
- Rule order and outcomes must be exactly today's; this is a pure restructuring.
- Non-goal: adding, removing, or reordering any delivery rule.

## Verify

`npm test` (the economy delivery case suites are the direct oracle), `npm run check`,
`npm run build`. Golden state hashes must not move.
